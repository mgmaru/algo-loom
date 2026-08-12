#!/usr/bin/env python3
"""Run the one-submission JudgeAdapter V-03 verification safely.

This helper is intentionally fixed to abc300_a and Python (CPython). It first
re-checks the method-C account identity, resolves the current AtCoder language
from the authenticated submit form, and shows a mandatory one-screen approval
gate. Only the exact approval phrase can trigger the single submission POST.

The helper never retries the POST. It writes an anonymized observation file and,
after acceptance, a separate temporary state file containing the actual
submission ID for V-04/V-06. Cookie values, CSRF tokens, source bytes, source
hashes, raw headers, and raw HTML are never persisted by this helper.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import http.client
import json
import os
import platform
import re
import ssl
import stat
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.cookies import CookieError, SimpleCookie
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import parse_qs, urlencode, urlparse

import atcoder_v02_session_check as v02


HOST = "atcoder.jp"
CONTEST_ID = "abc300"
PROBLEM_ID = "abc300_a"
PROBLEM_URL = "https://atcoder.jp/contests/abc300/tasks/abc300_a"
SETTINGS_PATH = "/settings"
SUBMIT_PATH = "/contests/abc300/submit"
SUBMIT_FORM_PATH = SUBMIT_PATH + "?taskScreenName=" + PROBLEM_ID
SUBMISSIONS_PATH = "/contests/abc300/submissions/me"
CANONICAL_LANGUAGE_ID = "python-cpython"
SOURCE_ALIAS = "source-B"
SUBMISSION_ALIAS = "submission-A"
TASK_SELECT_ID = "select-task"
LANGUAGE_WRAPPER_ID = "select-lang"
LANGUAGE_FIELD_NAME = "data.LanguageId"
TARGET_LANGUAGE_CONTAINER_ID = "select-lang-" + PROBLEM_ID
MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_SOURCE_BYTES = 512 * 1024
CONNECT_TIMEOUT_SECONDS = 5.0
REQUEST_TIMEOUT_SECONDS = 20.0
MIN_INTERVAL_SECONDS = 2.0
USER_AGENT = "AlgoLoom-JudgeAdapter-Verification/0.1"
AI_POLICY_URL = "https://info.atcoder.jp/overview/about/ai-training-opt-out"
TERMS_URL = "https://atcoder.jp/tos?lang=ja"
CPYTHON_PATTERN = re.compile(
    r"^Python\s+\(CPython\s+([0-9][0-9A-Za-z._+\-]*)\)$"
)
SUBMISSION_PATH_PATTERN = re.compile(
    r"^/contests/abc300/submissions/([0-9]+)$"
)
TURNSTILE_REFERENCE_MARKERS = (
    b"cf-turnstile",
    b"challenges.cloudflare.com",
    b"cdn-cgi/challenge-platform",
)
TURNSTILE_EXPLICIT_BINDING_PATTERN = re.compile(
    rb"\bturnstile\s*\.\s*(?:render|execute)\s*\(", re.IGNORECASE
)
VOID_TAGS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def normalize_text(value: str) -> str:
    return " ".join(value.split())


def attributes_dict(attributes: Sequence[Tuple[str, Optional[str]]]) -> Dict[str, str]:
    return {name: value or "" for name, value in attributes}


def contains_turnstile_reference(body: bytes) -> bool:
    lowered = body.lower()
    return any(marker in lowered for marker in TURNSTILE_REFERENCE_MARKERS)


def contains_turnstile_explicit_binding(body: bytes) -> bool:
    return TURNSTILE_EXPLICIT_BINDING_PATTERN.search(body) is not None


def classify_cf_mitigated(value: Optional[str]) -> str:
    """Project the Cloudflare header without retaining unexpected raw values."""
    if value is None:
        return "absent"
    if value.strip().lower() == "challenge":
        return "challenge"
    return "unexpected"


def classify_location(value: Optional[str]) -> str:
    if not value:
        return "none"
    parsed = urlparse(value)
    if parsed.netloc and parsed.netloc != HOST:
        return "other_host"
    if parsed.path == "/login":
        return "atcoder_login"
    if SUBMISSION_PATH_PATTERN.fullmatch(parsed.path):
        return "submission_detail"
    if parsed.path == SUBMISSIONS_PATH:
        return "own_submissions"
    return "other_atcoder_path"


def extract_direct_submission_id(location: Optional[str]) -> Optional[str]:
    if not location:
        return None
    parsed = urlparse(location)
    if parsed.netloc and parsed.netloc != HOST:
        return None
    match = SUBMISSION_PATH_PATTERN.fullmatch(parsed.path)
    return match.group(1) if match is not None else None


def parse_session_cookie_headers(
    headers: Sequence[str], current_value: str
) -> Tuple[str, int, bool, Optional[str]]:
    """Return updated value and non-secret metadata for REVEL_SESSION only."""
    candidates = []  # type: List[str]
    for header in headers:
        cookie = SimpleCookie()
        try:
            cookie.load(header)
        except CookieError:
            return current_value, 0, False, "set_cookie_parse_error"
        morsel = cookie.get("REVEL_SESSION")
        if morsel is not None:
            candidates.append(morsel.value)

    distinct = list(dict.fromkeys(candidates))
    if not distinct:
        return current_value, 0, False, None
    if len(distinct) != 1:
        return current_value, len(candidates), False, "conflicting_session_updates"
    reason = v02.validate_cookie_value(distinct[0])
    if reason is not None:
        return current_value, len(candidates), False, "invalid_session_update"
    return distinct[0], len(candidates), distinct[0] != current_value, None


@dataclass
class HttpResult:
    observation: Dict[str, Any]
    body: bytes
    session_cookie: Optional[str]
    finished_monotonic: float
    direct_submission_id: Optional[str]


def bounded_request(
    method: str,
    path: str,
    session_cookie: Optional[str],
    *,
    body: Optional[bytes] = None,
    referer: Optional[str] = None,
) -> HttpResult:
    """Perform one non-redirecting request and retain raw data in memory only."""
    started_at = utc_now()
    started = time.monotonic()
    connection = http.client.HTTPSConnection(
        HOST,
        443,
        timeout=CONNECT_TIMEOUT_SECONDS,
        context=ssl.create_default_context(),
    )
    headers = {
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en;q=0.5",
        "Cache-Control": "no-cache",
        "User-Agent": USER_AGENT,
    }
    if session_cookie is not None:
        headers["Cookie"] = "REVEL_SESSION=" + session_cookie
    if referer is not None:
        headers["Referer"] = referer
    if body is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        headers["Content-Length"] = str(len(body))
        headers["Origin"] = "https://atcoder.jp"

    try:
        connection.connect()
        if connection.sock is not None:
            connection.sock.settimeout(REQUEST_TIMEOUT_SECONDS)
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        status = response.status
        location = response.getheader("Location")
        cf_mitigated_class = classify_cf_mitigated(
            response.getheader("Cf-Mitigated")
        )
        set_cookie_headers = response.headers.get_all("Set-Cookie", [])
        content_type = (response.getheader("Content-Type") or "").split(";", 1)[0]
        response_body = response.read(MAX_BODY_BYTES + 1)
        oversized = len(response_body) > MAX_BODY_BYTES
        if oversized:
            response_body = b""

        updated_cookie = session_cookie
        update_count = 0
        cookie_updated = False
        update_error = None  # type: Optional[str]
        if session_cookie is not None:
            (
                updated_cookie,
                update_count,
                cookie_updated,
                update_error,
            ) = parse_session_cookie_headers(set_cookie_headers, session_cookie)

        observation = {
            "started_at_utc": started_at,
            "finished_at_utc": utc_now(),
            "duration_ms": round((time.monotonic() - started) * 1000),
            "method": method,
            "target_class": classify_target(path),
            "http_status": status,
            "redirect_class": classify_location(location),
            "content_type_class": content_type,
            "set_cookie_header_present": bool(set_cookie_headers),
            "set_cookie_header_count": len(set_cookie_headers),
            "session_cookie_directive_count": update_count,
            "session_cookie_updated": cookie_updated,
            "session_cookie_update_error": update_error,
            "response_body_oversized": oversized,
            "cf_mitigated_class": cf_mitigated_class,
            "turnstile_reference_present": (
                False if oversized else contains_turnstile_reference(response_body)
            ),
        }
        direct_id = extract_direct_submission_id(location)
        observation["direct_submission_id_present"] = direct_id is not None
        return HttpResult(
            observation=observation,
            body=response_body,
            session_cookie=updated_cookie,
            finished_monotonic=time.monotonic(),
            direct_submission_id=direct_id,
        )
    except (OSError, ssl.SSLError, http.client.HTTPException) as error:
        return HttpResult(
            observation={
                "started_at_utc": started_at,
                "finished_at_utc": utc_now(),
                "duration_ms": round((time.monotonic() - started) * 1000),
                "method": method,
                "target_class": classify_target(path),
                "classification": "communication_failure",
                "error_class": type(error).__name__,
            },
            body=b"",
            session_cookie=session_cookie,
            finished_monotonic=time.monotonic(),
            direct_submission_id=None,
        )
    finally:
        connection.close()


def classify_target(path: str) -> str:
    parsed = urlparse(path)
    if parsed.path == SETTINGS_PATH:
        return "account_settings"
    if parsed.path == SUBMIT_PATH:
        return "contest_submit"
    if parsed.path == SUBMISSIONS_PATH:
        return "own_submission_list"
    return "unexpected"


def wait_after(finished_monotonic: float) -> int:
    remaining = MIN_INTERVAL_SECONDS - (time.monotonic() - finished_monotonic)
    if remaining > 0:
        time.sleep(remaining)
    return round(max(0.0, remaining) * 1000)


def is_target_submit_action(value: str) -> bool:
    parsed = urlparse(value)
    if parsed.scheme or parsed.netloc:
        if parsed.scheme != "https" or parsed.netloc != HOST:
            return False
    return (
        parsed.path == SUBMIT_PATH
        and not parsed.params
        and not parsed.query
        and not parsed.fragment
    )


class SubmissionFormParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.element_ids = []  # type: List[Optional[str]]
        self.target_form_depth = None  # type: Optional[int]
        self.target_form_count = 0
        self.target_form_methods = []  # type: List[str]
        self.csrf_field_count = 0
        self.csrf_values = []  # type: List[str]
        self.task_select_count = 0
        self.task_select_id_count = 0
        self.task_select_id_match_count = 0
        self.task_values = []  # type: List[str]
        self.source_code_field_count = 0
        self.turnstile_widget_count = 0
        self.turnstile_response_field_count = 0
        self.language_wrapper_id_count = 0
        self.language_wrapper_count = 0
        self.language_wrapper_data_names = []  # type: List[str]
        self.target_language_container_id_count = 0
        self.target_language_container_count = 0
        self.all_language_selects = []  # type: List[Dict[str, Any]]
        self.language_selects = []  # type: List[Dict[str, Any]]
        self.target_language_selects = []  # type: List[Dict[str, Any]]
        self.current_select = None  # type: Optional[Dict[str, Any]]
        self.current_option = None  # type: Optional[Dict[str, Any]]

    @property
    def in_target_form(self) -> bool:
        return self.target_form_depth is not None

    def handle_starttag(
        self, tag: str, attributes: Sequence[Tuple[str, Optional[str]]]
    ) -> None:
        attrs = attributes_dict(attributes)
        if tag not in VOID_TAGS:
            self.element_ids.append(attrs.get("id"))
        if tag == "form" and is_target_submit_action(attrs.get("action", "")):
            self.target_form_count += 1
            self.target_form_methods.append(attrs.get("method", "").lower())
            if self.target_form_depth is None:
                self.target_form_depth = len(self.element_ids)
        if not self.in_target_form:
            return
        parent_id = self.element_ids[-2] if len(self.element_ids) >= 2 else None
        if attrs.get("id") == TASK_SELECT_ID:
            self.task_select_id_count += 1
        if attrs.get("id") == LANGUAGE_WRAPPER_ID:
            self.language_wrapper_id_count += 1
        if tag == "div" and attrs.get("id") == LANGUAGE_WRAPPER_ID:
            self.language_wrapper_count += 1
            self.language_wrapper_data_names.append(attrs.get("data-name", ""))
        if attrs.get("id") == TARGET_LANGUAGE_CONTAINER_ID:
            self.target_language_container_id_count += 1
        if (
            tag == "div"
            and attrs.get("id") == TARGET_LANGUAGE_CONTAINER_ID
            and parent_id == LANGUAGE_WRAPPER_ID
        ):
            self.target_language_container_count += 1
        classes = set(attrs.get("class", "").lower().split())
        if "cf-turnstile" in classes or "data-sitekey" in attrs:
            self.turnstile_widget_count += 1
        if tag == "input" and attrs.get("name") == "csrf_token":
            self.csrf_field_count += 1
            if attrs.get("value"):
                self.csrf_values.append(attrs["value"])
        if tag == "input" and attrs.get("name") == "cf-turnstile-response":
            self.turnstile_response_field_count += 1
        if tag in {"input", "textarea"} and attrs.get("name") == "sourceCode":
            self.source_code_field_count += 1
        inside_language_wrapper = (
            tag == "select" and LANGUAGE_WRAPPER_ID in self.element_ids[:-1]
        )
        is_task_select = (
            tag == "select" and attrs.get("name") == "data.TaskScreenName"
        )
        is_language_select = tag == "select" and (
            attrs.get("name") == LANGUAGE_FIELD_NAME or inside_language_wrapper
        )
        if is_task_select or is_language_select:
            if is_task_select:
                self.task_select_count += 1
                if attrs.get("id") == TASK_SELECT_ID:
                    self.task_select_id_match_count += 1
            self.current_select = {
                "name": attrs.get("name", ""),
                "id": attrs.get("id", ""),
                "context_ids": [value for value in self.element_ids if value],
                "direct_parent_id": parent_id or "",
                "inside_language_wrapper": inside_language_wrapper,
                "is_task_select": is_task_select,
                "options": [],
            }
        if tag == "option" and self.current_select is not None:
            self.current_option = {
                "value": attrs.get("value", ""),
                "selected": "selected" in attrs,
                "text_parts": [],
            }

    def handle_startendtag(
        self, tag: str, attributes: Sequence[Tuple[str, Optional[str]]]
    ) -> None:
        self.handle_starttag(tag, attributes)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if self.current_option is not None:
            self.current_option["text_parts"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "option" and self.current_option is not None:
            option = {
                "value": self.current_option["value"],
                "selected": self.current_option["selected"],
                "text": normalize_text("".join(self.current_option["text_parts"])),
            }
            if self.current_select is not None:
                self.current_select["options"].append(option)
            self.current_option = None
        if tag == "select" and self.current_select is not None:
            if self.current_select["is_task_select"]:
                self.task_values.extend(
                    option["value"]
                    for option in self.current_select["options"]
                    if option["value"]
                )
            else:
                select = self.current_select
                self.all_language_selects.append(select)
                if select["name"] == LANGUAGE_FIELD_NAME:
                    self.language_selects.append(select)
                if (
                    select["inside_language_wrapper"]
                    and select["direct_parent_id"] == TARGET_LANGUAGE_CONTAINER_ID
                ):
                    self.target_language_selects.append(select)
            self.current_select = None

        if (
            tag == "form"
            and self.target_form_depth is not None
            and len(self.element_ids) == self.target_form_depth
        ):
            self.target_form_depth = None
        if self.element_ids:
            self.element_ids.pop()


def classify_language_wrapper_data_name(parser: SubmissionFormParser) -> str:
    if parser.language_wrapper_count == 0:
        return "absent"
    if (
        parser.language_wrapper_count != 1
        or parser.language_wrapper_id_count != 1
    ):
        return "not_unique"
    value = parser.language_wrapper_data_names[0]
    if value == LANGUAGE_FIELD_NAME:
        return "expected"
    if not value:
        return "missing"
    return "unexpected"


def classify_target_language_select_name(parser: SubmissionFormParser) -> str:
    if parser.language_wrapper_count == 0:
        return "not_applicable"
    if len(parser.target_language_selects) != 1:
        return "not_unique"
    value = parser.target_language_selects[0]["name"]
    if value == LANGUAGE_FIELD_NAME:
        return "expected"
    if not value:
        return "missing_before_javascript"
    return "unexpected"


def select_problem_languages(
    parser: SubmissionFormParser, problem_id: str
) -> Tuple[Optional[List[Dict[str, Any]]], str]:
    wrapper_class = classify_language_wrapper_data_name(parser)
    if parser.language_wrapper_count > 0:
        if wrapper_class != "expected":
            return None, "language_wrapper_data_name_" + wrapper_class
        if parser.task_select_id_match_count != 1:
            return None, "task_select_id_not_unique"
        if parser.task_select_id_count != 1:
            return None, "task_select_id_not_unique"
        if (
            parser.target_language_container_id_count != 1
            or parser.target_language_container_count != 1
        ):
            return None, "target_language_container_not_unique"
        if len(parser.target_language_selects) != 1:
            return None, "target_language_select_not_unique"
        if parser.target_language_selects[0]["name"] not in {
            "",
            LANGUAGE_FIELD_NAME,
        }:
            return None, "target_language_select_name_unexpected"
        return parser.target_language_selects[0]["options"], "problem_container"

    selects = parser.language_selects
    targeted = []  # type: List[Dict[str, Any]]
    for select in selects:
        identifiers = [select.get("id", "")] + list(select.get("context_ids", []))
        if any(problem_id in identifier for identifier in identifiers):
            targeted.append(select)
    if len(targeted) == 1:
        return targeted[0]["options"], "problem_specific"
    if len(targeted) > 1:
        return None, "multiple_problem_specific_selects"
    if len(selects) == 1:
        return selects[0]["options"], "single_select"
    return None, "target_language_select_not_unique"


def resolve_cpython_language(
    options: Sequence[Dict[str, Any]]
) -> Tuple[List[Dict[str, str]], Optional[Dict[str, str]]]:
    candidates = []  # type: List[Dict[str, str]]
    for option in options:
        match = CPYTHON_PATTERN.fullmatch(option.get("text", ""))
        if option.get("value") and match is not None:
            candidates.append(
                {
                    "atcoder_language_id": option["value"],
                    "display_name": option["text"],
                    "interpreter": "CPython",
                    "version": match.group(1),
                }
            )
    return candidates, candidates[0] if len(candidates) == 1 else None


def parse_submit_form(body: bytes) -> Dict[str, Any]:
    parser = SubmissionFormParser()
    try:
        parser.feed(body.decode("utf-8"))
        parser.close()
    except (UnicodeDecodeError, ValueError):
        return {"classification": "submit_page_parse_error"}

    unique_csrf_values = list(dict.fromkeys(parser.csrf_values))
    options, selection_method = select_problem_languages(parser, PROBLEM_ID)
    candidates = []  # type: List[Dict[str, str]]
    resolved = None  # type: Optional[Dict[str, str]]
    if options is not None:
        candidates, resolved = resolve_cpython_language(options)
    turnstile_reference_present = contains_turnstile_reference(body)
    turnstile_explicit_binding_present = contains_turnstile_explicit_binding(body)
    if (
        parser.turnstile_widget_count > 0
        or parser.turnstile_response_field_count > 0
    ):
        turnstile_binding_class = "target_form_widget"
    elif turnstile_explicit_binding_present:
        turnstile_binding_class = "explicit_or_deferred"
    elif turnstile_reference_present:
        turnstile_binding_class = "reference_only"
    else:
        turnstile_binding_class = "absent"
    passed = (
        parser.target_form_count == 1
        and parser.target_form_methods == ["post"]
        and parser.csrf_field_count == 1
        and len(parser.csrf_values) == 1
        and len(unique_csrf_values) == 1
        and parser.task_select_count == 1
        and parser.task_values.count(PROBLEM_ID) == 1
        and parser.source_code_field_count == 1
        and resolved is not None
    )
    submission_ready = passed and turnstile_binding_class in {
        "absent",
        "reference_only",
    }
    return {
        "classification": "ready" if passed else "submit_page_structure_changed",
        "target_form_count": parser.target_form_count,
        "target_form_method_post": parser.target_form_methods == ["post"],
        "csrf_field_count": parser.csrf_field_count,
        "csrf_token_count": len(parser.csrf_values),
        "task_select_count": parser.task_select_count,
        "task_select_id_count": parser.task_select_id_count,
        "task_select_id_match_count": parser.task_select_id_match_count,
        "target_task_option_count": parser.task_values.count(PROBLEM_ID),
        "target_task_present": parser.task_values.count(PROBLEM_ID) == 1,
        "source_code_field_count": parser.source_code_field_count,
        "language_wrapper_id_count": parser.language_wrapper_id_count,
        "language_wrapper_count": parser.language_wrapper_count,
        "language_wrapper_data_name_class": (
            classify_language_wrapper_data_name(parser)
        ),
        "language_select_count": len(parser.language_selects),
        "all_language_select_count": len(parser.all_language_selects),
        "unnamed_language_select_count": sum(
            1 for select in parser.all_language_selects if not select["name"]
        ),
        "target_language_container_count": (
            parser.target_language_container_count
        ),
        "target_language_container_id_count": (
            parser.target_language_container_id_count
        ),
        "target_language_select_count": len(parser.target_language_selects),
        "target_language_select_name_class": (
            classify_target_language_select_name(parser)
        ),
        "language_selection_method": selection_method,
        "canonical_language_id": CANONICAL_LANGUAGE_ID,
        "canonical_language_candidate_count": len(candidates),
        "resolved_language": resolved,
        "turnstile_binding_class": turnstile_binding_class,
        "turnstile_widget_count": parser.turnstile_widget_count,
        "turnstile_response_field_count": parser.turnstile_response_field_count,
        "turnstile_explicit_binding_present": turnstile_explicit_binding_present,
        "submission_ready": submission_ready,
        "_csrf_token": (
            unique_csrf_values[0]
            if parser.csrf_field_count == 1 and len(unique_csrf_values) == 1
            else None
        ),
    }


class SubmissionListParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.row_depth = 0
        self.row_has_problem = False
        self.row_ids = []  # type: List[str]
        self.submission_ids = []  # type: List[str]

    def handle_starttag(
        self, tag: str, attributes: Sequence[Tuple[str, Optional[str]]]
    ) -> None:
        attrs = attributes_dict(attributes)
        if tag == "tr":
            self.row_depth += 1
            if self.row_depth == 1:
                self.row_has_problem = False
                self.row_ids = []
        if self.row_depth == 0 or tag != "a":
            return
        path = urlparse(attrs.get("href", "")).path
        if path == "/contests/abc300/tasks/abc300_a":
            self.row_has_problem = True
        match = SUBMISSION_PATH_PATTERN.fullmatch(path)
        if match is not None:
            self.row_ids.append(match.group(1))

    def handle_endtag(self, tag: str) -> None:
        if tag != "tr" or self.row_depth == 0:
            return
        if self.row_depth == 1 and self.row_has_problem:
            for submission_id in self.row_ids:
                if submission_id not in self.submission_ids:
                    self.submission_ids.append(submission_id)
        self.row_depth -= 1


def parse_submission_ids(body: bytes) -> Optional[List[str]]:
    parser = SubmissionListParser()
    try:
        parser.feed(body.decode("utf-8"))
        parser.close()
    except (UnicodeDecodeError, ValueError):
        return None
    return parser.submission_ids


def settings_observation(result: HttpResult, expected_identity: str) -> Dict[str, Any]:
    observation = dict(result.observation)
    if "http_status" not in observation:
        return observation
    identities = (
        []
        if observation["response_body_oversized"]
        else v02.extract_identities(result.body)
    )
    identity = identities[0] if len(identities) == 1 else None
    observation.update(
        {
            "identity_count": len(identities),
            "identity_matches_expected": (
                identity == expected_identity if identity is not None else None
            ),
            "classification": v02.classify_response(
                observation["http_status"],
                observation["redirect_class"],
                len(identities),
            ),
        }
    )
    return observation


def classify_authenticated_html(
    result: HttpResult, expected_identity: str, *, require_identity: bool
) -> str:
    observation = result.observation
    if observation.get("http_status") != 200:
        return "unexpected_http_status"
    if observation.get("content_type_class") != "text/html":
        return "unexpected_content_type"
    if observation.get("response_body_oversized"):
        return "response_body_oversized"
    if observation.get("cf_mitigated_class") == "challenge":
        return "cloudflare_challenge"
    if observation.get("cf_mitigated_class") != "absent":
        return "unexpected_cf_mitigated_header"
    if observation.get("session_cookie_update_error") is not None:
        return "session_cookie_update_error"
    if not require_identity:
        return "ready"
    identities = v02.extract_identities(result.body)
    if len(identities) != 1:
        return "identity_not_unique"
    if identities[0] != expected_identity:
        return "identity_mismatch"
    return "ready"


def read_source(path: Path) -> Tuple[Optional[bytes], Optional[str]]:
    if not path.is_absolute():
        return None, "source path must be absolute"
    try:
        resolved = path.resolve(strict=True)
        info = resolved.stat()
    except OSError:
        return None, "source file cannot be resolved"
    root = repository_root()
    if root is not None and os.path.commonpath([str(root), str(resolved)]) == str(root):
        return None, "source file must be outside the repository"
    if not stat.S_ISREG(info.st_mode):
        return None, "source path must be a regular file"
    try:
        data = resolved.read_bytes()
    except OSError:
        return None, "source file cannot be read"
    if not data:
        return None, "source file is empty"
    if len(data) > MAX_SOURCE_BYTES:
        return None, "source file is too large"
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return None, "source file must be UTF-8"
    return data, None


def repository_root() -> Optional[Path]:
    candidate = Path(__file__).resolve().parents[2]
    return candidate if (candidate / ".git").exists() else None


def validate_output_path(path: Path) -> Tuple[Optional[Path], Optional[str]]:
    if not path.is_absolute():
        return None, "output path must be absolute"
    resolved = path.resolve(strict=False)
    root = repository_root()
    if root is not None and os.path.commonpath([str(root), str(resolved)]) == str(root):
        return None, "output path must be outside the repository"
    if not resolved.parent.is_dir():
        return None, "output parent directory does not exist"
    try:
        parent_mode = stat.S_IMODE(resolved.parent.stat().st_mode)
    except OSError:
        return None, "output parent directory cannot be inspected"
    if parent_mode & 0o077:
        return None, "output parent directory must be owner-only"
    if resolved.exists():
        return None, "output path already exists"
    return resolved, None


def write_json_exclusive(path: Path, value: Dict[str, Any]) -> None:
    resolved, reason = validate_output_path(path)
    if resolved is None:
        raise ValueError(reason)
    descriptor = os.open(resolved, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, indent=2, sort_keys=True)
        output.write("\n")


def public_form_observation(parsed: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in parsed.items() if not key.startswith("_")}


def build_result(started_at: str, source_size: int) -> Dict[str, Any]:
    return {
        "schema_version": 3,
        "verification_scope": ["V-02-recheck", "V-05", "V-03"],
        "started_at_utc": started_at,
        "finished_at_utc": None,
        "platform": {
            "os": platform.system(),
            "os_release": platform.release(),
            "architecture": platform.machine(),
            "python": platform.python_version(),
            "tls": ssl.OPENSSL_VERSION,
        },
        "target": {
            "contest_id": CONTEST_ID,
            "problem_id": PROBLEM_ID,
            "problem_url": PROBLEM_URL,
            "canonical_language_id": CANONICAL_LANGUAGE_ID,
        },
        "source": {
            "alias": SOURCE_ALIAS,
            "byte_count": source_size,
            "hash_persisted": False,
            "content_persisted": False,
        },
        "method": {
            "authentication": "method-C",
            "cookie_name": "REVEL_SESSION",
            "cookie_input_was_hidden": True,
            "expected_identity_input_was_hidden": True,
            "redirect_following": False,
            "automatic_retries": 0,
            "submission_post_limit": 1,
            "submission_limit_scope": "approved-real-service-verification-run",
            "connect_timeout_ms": int(CONNECT_TIMEOUT_SECONDS * 1000),
            "request_timeout_ms": int(REQUEST_TIMEOUT_SECONDS * 1000),
            "minimum_interval_ms": int(MIN_INTERVAL_SECONDS * 1000),
            "max_response_bytes": MAX_BODY_BYTES,
            "user_agent_class": "explicit-verification-client",
        },
        "observations": {},
        "request_count": {"GET": 0, "POST": 0},
        "submission_count": 0,
        "submission_post_attempts": 0,
        "approval": {
            "approved": False,
            "source_ownership_confirmed": False,
            "unique_submission_confirmed": False,
            "ai_policy_presented": False,
            "no_automatic_resend_confirmed": False,
            "turnstile_classification_presented": False,
        },
        "v02_recheck": "not_run",
        "v05": "not_run",
        "v03": "not_run",
        "remote_state": "PREPARED",
        "submission_id_obtained": False,
        "submission_alias": None,
        "temporary_state_written": False,
        "secret_persistence": {
            "cookie_written_to_file": False,
            "csrf_token_written_to_file": False,
            "expected_identity_written_to_file": False,
            "raw_headers_written_to_file": False,
            "raw_html_written_to_file": False,
            "source_written_by_helper": False,
            "source_hash_written_to_file": False,
        },
    }


def save_result(path: Path, result: Dict[str, Any]) -> None:
    result["finished_at_utc"] = utc_now()
    write_json_exclusive(path, result)


def stop_with_result(path: Path, result: Dict[str, Any], message: str, code: int) -> int:
    print(message)
    try:
        save_result(path, result)
    except (OSError, ValueError) as error:
        print("匿名化済み結果を保存できませんでした:", str(error), file=sys.stderr)
        return 3
    print("匿名化済み結果を指定先へ保存しました。")
    return code


def record_request(result: Dict[str, Any], name: str, request: HttpResult) -> None:
    result["request_count"][request.observation["method"]] += 1
    result["observations"][name] = dict(request.observation)


def read_cookie_value() -> Tuple[Optional[str], int]:
    rejected = 0
    for _ in range(3):
        value = getpass.getpass(
            "REVEL_SESSION の Value 列だけを貼り付けて Enter（入力は表示されません）: "
        )
        reason = v02.validate_cookie_value(value)
        if reason is None:
            return value, rejected
        rejected += 1
        print(
            "入力形式を受理できません。名前、=、引用符、前後の空白を含めず、"
            "Value 列だけをコピーし直してください。外部通信はまだ行っていません。"
        )
    return None, rejected


def filtered_submissions_path(language_id: str) -> str:
    return SUBMISSIONS_PATH + "?" + urlencode(
        {
            "f.Task": PROBLEM_ID,
            "f.Language": language_id,
            "orderBy": "created",
            "desc": "true",
        }
    )


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="AtCoder JudgeAdapter V-03を明示承認後に1件だけ検証します。"
    )
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--json-output", required=True, type=Path)
    parser.add_argument("--state-output", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if not sys.stdin.isatty():
        print("対話ターミナルではないため実行できません。", file=sys.stderr)
        return 64
    source, source_error = read_source(args.source)
    if source is None:
        print("ソースコードを受理できません:", source_error, file=sys.stderr)
        return 64
    json_path, json_error = validate_output_path(args.json_output)
    state_path, state_error = validate_output_path(args.state_output)
    if json_path is None or state_path is None:
        print(
            "出力先を受理できません:", json_error or state_error, file=sys.stderr
        )
        return 64
    if json_path == state_path:
        print("2つの出力先は別のパスにしてください。", file=sys.stderr)
        return 64

    started_at = utc_now()
    result = build_result(started_at, len(source))
    source_hash = hashlib.sha256(source).hexdigest()

    print("\nAlgoLoom V-03・1回限りの提出検証")
    print("Cookie、アカウント名、CSRFトークン、ソース本文は表示・保存しません。")
    print("\n通常のブラウザで次を確認してください。")
    print("1. https://atcoder.jp/settings を再読み込みし、本人アカウントを確認する。")
    print("2. 開発者ツールで https://atcoder.jp のCookie一覧を開く。")
    print("3. Name=REVEL_SESSION、Domain=atcoder.jp、Path=/ の行を1件選ぶ。")
    print("4. Value列だけをコピーする。REVEL_SESSION= や引用符を含めない。")
    if input("確認後に CONFIRMED と入力: ").strip() != "CONFIRMED":
        print("確認されなかったため、外部通信なしで中止しました。")
        return 2

    expected_identity = getpass.getpass(
        "期待するAtCoderアカウント名を入力（表示・保存されません）: "
    )
    if v02.ACCOUNT_PATTERN.fullmatch(expected_identity) is None:
        print("アカウント名の形式を受理できません。外部通信なしで中止しました。")
        return 2
    session_cookie, rejected_inputs = read_cookie_value()
    result["method"]["rejected_local_cookie_inputs"] = rejected_inputs
    if session_cookie is None:
        print("Cookie入力を受理できません。外部通信なしで中止しました。")
        return 2

    print("\n読み取りゲートでは、認証確認、提出フォーム、直前の提出一覧を")
    print("各1回だけ取得します。2秒以上の間隔、再試行なし、リダイレクト追従なしです。")
    if input("読み取りゲートを実行する場合だけ RUN_READ_GATE と入力: ").strip() != "RUN_READ_GATE":
        session_cookie = None
        expected_identity = ""
        print("承認されなかったため、外部通信なしで中止しました。")
        return 2

    empty = bounded_request("GET", SETTINGS_PATH, None)
    empty_public = settings_observation(empty, expected_identity)
    empty.observation = empty_public
    record_request(result, "empty_session_account_check", empty)
    if empty_public.get("classification") != "unauthenticated":
        session_cookie = None
        expected_identity = ""
        return stop_with_result(
            json_path,
            result,
            "空セッションを未認証と分類できず、Cookieを送らず停止しました。",
            1,
        )

    wait_after(empty.finished_monotonic)
    account = bounded_request("GET", SETTINGS_PATH, session_cookie)
    account_public = settings_observation(account, expected_identity)
    account.observation = account_public
    record_request(result, "method_c_account_check", account)
    session_cookie = account.session_cookie
    account_ok = (
        account_public.get("classification") == "authenticated_candidate"
        and account_public.get("identity_count") == 1
        and account_public.get("identity_matches_expected") is True
        and account_public.get("cf_mitigated_class") == "absent"
        and account_public.get("session_cookie_update_error") is None
    )
    if not account_ok or session_cookie is None:
        session_cookie = None
        expected_identity = ""
        result["v02_recheck"] = "fail"
        return stop_with_result(
            json_path, result, "V-02再確認を通過できず、提出前に停止しました。", 1
        )
    result["v02_recheck"] = "pass"

    wait_after(account.finished_monotonic)
    submit_page = bounded_request("GET", SUBMIT_FORM_PATH, session_cookie)
    submit_html_classification = classify_authenticated_html(
        submit_page, expected_identity, require_identity=False
    )
    submit_page.observation["authenticated_html_classification"] = (
        submit_html_classification
    )
    record_request(result, "submit_form", submit_page)
    session_cookie = submit_page.session_cookie
    if session_cookie is None or submit_html_classification != "ready":
        session_cookie = None
        expected_identity = ""
        result["v05"] = "aborted"
        return stop_with_result(
            json_path,
            result,
            "提出ページのHTTP応答を安全に解釈できず停止しました。",
            1,
        )

    parsed_form = parse_submit_form(submit_page.body)
    result["observations"]["submit_form_structure"] = public_form_observation(
        parsed_form
    )
    if parsed_form.get("classification") != "ready":
        session_cookie = None
        expected_identity = ""
        result["v05"] = "fail"
        return stop_with_result(
            json_path, result, "V-05で言語を一意に解決できず停止しました。", 1
        )
    language = parsed_form["resolved_language"]
    turnstile_binding_class = parsed_form["turnstile_binding_class"]
    csrf_token = parsed_form["_csrf_token"]
    parsed_form["_csrf_token"] = None
    result["v05"] = "pass"

    if parsed_form.get("submission_ready") is not True:
        session_cookie = None
        expected_identity = ""
        csrf_token = None
        result["v03"] = "aborted"
        return stop_with_result(
            json_path,
            result,
            "提出フォームにTurnstileの能動的な関連付けを観測したため、"
            "提出POST前に停止しました。",
            1,
        )

    wait_after(submit_page.finished_monotonic)
    list_path = filtered_submissions_path(language["atcoder_language_id"])
    baseline = bounded_request("GET", list_path, session_cookie)
    baseline_html_classification = classify_authenticated_html(
        baseline, expected_identity, require_identity=True
    )
    baseline.observation["authenticated_html_classification"] = (
        baseline_html_classification
    )
    record_request(result, "submission_list_before_send", baseline)
    session_cookie = baseline.session_cookie
    baseline_ids = parse_submission_ids(baseline.body)
    baseline_ok = (
        session_cookie is not None
        and baseline_html_classification == "ready"
        and baseline_ids is not None
    )
    result["observations"]["submission_list_before_send_structure"] = {
        "parse_succeeded": baseline_ids is not None,
        "target_submission_count_on_page": (
            len(baseline_ids) if baseline_ids is not None else None
        ),
        "actual_submission_ids_persisted": False,
    }
    if not baseline_ok:
        session_cookie = None
        expected_identity = ""
        csrf_token = None
        return stop_with_result(
            json_path, result, "直前の本人提出一覧を確認できず停止しました。", 1
        )

    print("\n========== V-03 提出ゲート ==========")
    print("問題:", PROBLEM_ID)
    print("公式URL:", PROBLEM_URL)
    print("アカウント: 同じ方式Cセッションから識別情報を1件取得し、期待値と一致")
    print("正規言語ID:", CANONICAL_LANGUAGE_ID)
    print("AtCoder言語ID:", language["atcoder_language_id"])
    print("表示名:", language["display_name"])
    print("処理系:", language["interpreter"])
    print("バージョン:", language["version"])
    print("Cloudflare Challenge Page: cf-mitigatedヘッダー上は未観測")
    print("提出フォームのTurnstile分類:", turnstile_binding_class)
    print("ソースコード:", SOURCE_ALIAS, str(len(source)) + "バイト")
    print("SHA-256（確認専用・成果物へ保存しません）:", source_hash)
    print("提出許可: 明示承認済み実サービス検証実行の最大1件")
    print("今回のPOST上限: 1回。応答不明でも自動再送・再提出しません")
    print("利用規約:", TERMS_URL)
    print("AI学習・販売の拒否設定案内:", AI_POLICY_URL)
    print("2026年8月以降は、拒否設定が未反映の提出が初期状態で対象になり得ます。")
    print("======================================")
    print(
        "上記、source-Bを本人のアカウントから提出してよいこと、これを明示承認済み"
    )
    print(
        "実サービス検証の最大1件とすること、AI設定、自動再送・再提出禁止を"
        "確認してください。"
    )
    approval = input("承認する場合だけ SUBMIT abc300_a と入力: ").strip()
    if approval != "SUBMIT abc300_a":
        session_cookie = None
        expected_identity = ""
        csrf_token = None
        source = None
        result["v03"] = "aborted"
        result["remote_state"] = "PREPARED"
        return stop_with_result(
            json_path, result, "承認されなかったため、提出POSTなしで中止しました。", 2
        )

    result["approval"] = {
        "approved": True,
        "approved_at_utc": utc_now(),
        "source_ownership_confirmed": True,
        "unique_submission_confirmed": True,
        "ai_policy_presented": True,
        "no_automatic_resend_confirmed": True,
        "turnstile_classification_presented": True,
    }
    result["remote_state"] = "SEND_STARTED"
    result["submission_post_attempts"] = 1

    post_body = urlencode(
        {
            "data.TaskScreenName": PROBLEM_ID,
            "data.LanguageId": language["atcoder_language_id"],
            "sourceCode": source.decode("utf-8"),
            "csrf_token": csrf_token,
        }
    ).encode("utf-8")
    csrf_token = None
    source = None
    source_hash = ""

    wait_after(baseline.finished_monotonic)
    submitted = bounded_request(
        "POST",
        SUBMIT_PATH,
        session_cookie,
        body=post_body,
        referer="https://atcoder.jp" + SUBMIT_FORM_PATH,
    )
    post_body = None
    record_request(result, "submission_post", submitted)
    result["request_count"]["POST"] = 1
    session_cookie = submitted.session_cookie
    direct_id = submitted.direct_submission_id

    should_recover = (
        submitted.observation.get("classification") == "communication_failure"
        or submitted.observation.get("redirect_class") == "own_submissions"
        or submitted.observation.get("redirect_class") == "submission_detail"
    )
    recovered_ids = None  # type: Optional[List[str]]
    recovery = None  # type: Optional[HttpResult]
    if should_recover and session_cookie is not None:
        wait_after(submitted.finished_monotonic)
        recovery = bounded_request("GET", list_path, session_cookie)
        recovery_html_classification = classify_authenticated_html(
            recovery, expected_identity, require_identity=True
        )
        recovery.observation["authenticated_html_classification"] = (
            recovery_html_classification
        )
        record_request(result, "submission_list_after_send", recovery)
        session_cookie = recovery.session_cookie
        if recovery_html_classification == "ready":
            recovered_ids = parse_submission_ids(recovery.body)

    baseline_set = set(baseline_ids or [])
    new_ids = []  # type: List[str]
    if direct_id is not None and direct_id not in baseline_set:
        new_ids.append(direct_id)
    if recovered_ids is not None:
        for submission_id in recovered_ids:
            if submission_id not in baseline_set and submission_id not in new_ids:
                new_ids.append(submission_id)

    result["observations"]["submission_id_resolution"] = {
        "baseline_parse_succeeded": baseline_ids is not None,
        "post_response_received": submitted.observation.get("http_status") is not None,
        "recovery_get_performed": recovery is not None,
        "recovery_parse_succeeded": recovered_ids is not None,
        "new_submission_candidate_count": len(new_ids),
        "actual_submission_id_persisted_in_anonymized_result": False,
    }

    session_cookie = None
    expected_identity = ""
    if len(new_ids) != 1:
        result["v03"] = "fail" if submitted.observation.get("http_status") else "unknown"
        result["remote_state"] = "REMOTE_STATUS_UNKNOWN"
        return stop_with_result(
            json_path,
            result,
            "提出IDを一意に取得できませんでした。自動再送せず状態不明として停止します。",
            1,
        )

    state = {
        "schema_version": 1,
        "purpose": "temporary-state-for-V-04-and-V-06",
        "submission_alias": SUBMISSION_ALIAS,
        "contest_id": CONTEST_ID,
        "problem_id": PROBLEM_ID,
        "atcoder_language_id": language["atcoder_language_id"],
        "submission_id": new_ids[0],
        "recorded_at_utc": utc_now(),
    }
    try:
        write_json_exclusive(state_path, state)
    except (OSError, ValueError) as error:
        result["v03"] = "pass"
        result["remote_state"] = "REMOTE_ACCEPTED"
        result["submission_count"] = 1
        result["submission_id_obtained"] = True
        result["submission_alias"] = SUBMISSION_ALIAS
        print(
            "提出は受理されIDも取得しましたが、一時状態を保存できませんでした:",
            str(error),
            file=sys.stderr,
        )
        return stop_with_result(json_path, result, "再提出せず停止します。", 3)

    result["v03"] = "pass"
    result["remote_state"] = "REMOTE_ACCEPTED"
    result["submission_count"] = 1
    result["submission_id_obtained"] = True
    result["submission_alias"] = SUBMISSION_ALIAS
    result["temporary_state_written"] = True
    try:
        save_result(json_path, result)
    except (OSError, ValueError) as error:
        print("匿名化済み結果を保存できませんでした:", str(error), file=sys.stderr)
        print("提出は再送しないでください。")
        return 3

    print("\nV-03 合格: AtCoderが提出を受理し、submission-AのIDを取得しました。")
    print("実際の提出IDはV-04/V-06用の一時状態へだけ保存しました。")
    print("匿名化済み結果を指定先へ保存しました。")
    print("Cookie、CSRFトークン、ソース本文、ハッシュは保存していません。")
    print("クリップボードは変更していません。必要なら安全な文字列で上書きしてください。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
