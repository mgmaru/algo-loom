#!/usr/bin/env python3
"""Observe one AtCoder submission verdict for JudgeAdapter V-04.

The helper reads the V-03 temporary state from an owner-only file, verifies the
method-C account, and queries only that submission ID through AtCoder's status
endpoint.  It records allowlisted observations only.  Cookie values, account
names, the actual submission ID, raw headers, raw HTML, and raw JSON are never
persisted.

V-04 passes only when both a pending state and a final verdict are observed from
the real service with UTC timestamps.  A final-only observation remains useful,
but is deliberately reported as incomplete instead of being promoted to a pass.
"""

from __future__ import annotations

import argparse
import getpass
import http.client
import json
import os
import platform
import re
import ssl
import stat
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlencode

import atcoder_v02_session_check as v02
import atcoder_v03_submit as v03


HOST = "atcoder.jp"
SETTINGS_PATH = "/settings"
STATUS_PATH_TEMPLATE = "/contests/{contest_id}/submissions/me/status/json"
SUBMISSION_ALIAS = "submission-A"
STATE_PURPOSE = "temporary-state-for-V-04-and-V-06"
MAX_STATE_BYTES = 4096
MAX_RESPONSE_BYTES = 256 * 1024
MAX_STATUS_HTML_CHARACTERS = 32 * 1024
CONNECT_TIMEOUT_SECONDS = 5.0
REQUEST_TIMEOUT_SECONDS = 20.0
MIN_INTERVAL_SECONDS = 2.0
MAX_SERVER_INTERVAL_MILLISECONDS = 60_000
MAX_STATUS_REQUESTS = 10
MAX_POLLING_SECONDS = 120.0
MAX_OBSERVATION_GAP_SECONDS = 5 * 60.0
USER_AGENT = "AlgoLoom-JudgeAdapter-Verification/0.1"
CONTEST_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
PROBLEM_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
SUBMISSION_ID_PATTERN = re.compile(r"[0-9]{1,20}\Z")
UTC_TIMESTAMP_PATTERN = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]{1,9})?Z\Z"
)
FINAL_VERDICTS = {
    "AC",
    "WA",
    "TLE",
    "MLE",
    "RE",
    "CE",
    "OLE",
    "IE",
}
PENDING_LABELS = {"WJ", "WR", "Judging"}
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


def attributes_dict(
    attributes: Sequence[Tuple[str, Optional[str]]],
) -> Dict[str, str]:
    return {name: value or "" for name, value in attributes}


def repository_root() -> Optional[Path]:
    candidate = Path(__file__).resolve().parents[2]
    return candidate if (candidate / ".git").exists() else None


def path_is_in_repository(path: Path) -> bool:
    root = repository_root()
    return root is not None and os.path.commonpath([str(root), str(path)]) == str(
        root
    )


def validate_input_state_path(path: Path) -> Tuple[Optional[Path], Optional[str]]:
    if not path.is_absolute():
        return None, "state path must be absolute"
    try:
        resolved = path.resolve(strict=True)
        info = resolved.stat()
    except OSError:
        return None, "state file cannot be resolved"
    if path_is_in_repository(resolved):
        return None, "state file must be outside the repository"
    if not stat.S_ISREG(info.st_mode):
        return None, "state path must be a regular file"
    if info.st_uid != os.getuid():
        return None, "state file must be owned by the current user"
    if stat.S_IMODE(info.st_mode) & 0o077:
        return None, "state file must be owner-only"
    if info.st_size <= 0 or info.st_size > MAX_STATE_BYTES:
        return None, "state file size is invalid"
    return resolved, None


def validate_output_path(path: Path) -> Tuple[Optional[Path], Optional[str]]:
    if not path.is_absolute():
        return None, "output path must be absolute"
    resolved = path.resolve(strict=False)
    if path_is_in_repository(resolved):
        return None, "output path must be outside the repository"
    if not resolved.parent.is_dir():
        return None, "output parent directory does not exist"
    try:
        parent_info = resolved.parent.stat()
    except OSError:
        return None, "output parent directory cannot be inspected"
    if parent_info.st_uid != os.getuid():
        return None, "output parent directory must be owned by the current user"
    if stat.S_IMODE(parent_info.st_mode) & 0o077:
        return None, "output parent directory must be owner-only"
    if resolved.exists():
        return None, "output path already exists"
    return resolved, None


def read_temporary_state(path: Path) -> Tuple[Optional[Dict[str, str]], Optional[str]]:
    resolved, reason = validate_input_state_path(path)
    if resolved is None:
        return None, reason
    try:
        raw = resolved.read_bytes()
        value = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None, "state file is not valid UTF-8 JSON"
    expected_keys = {
        "schema_version",
        "purpose",
        "submission_alias",
        "contest_id",
        "problem_id",
        "recorded_at_utc",
        "submission_id",
    }
    if not isinstance(value, dict) or set(value) != expected_keys:
        return None, "state schema keys are invalid"
    if value.get("schema_version") != 1:
        return None, "state schema version is unsupported"
    if value.get("purpose") != STATE_PURPOSE:
        return None, "state purpose is invalid"
    if value.get("submission_alias") != SUBMISSION_ALIAS:
        return None, "state submission alias is invalid"
    contest_id = value.get("contest_id")
    problem_id = value.get("problem_id")
    recorded_at = value.get("recorded_at_utc")
    submission_id = value.get("submission_id")
    if not isinstance(contest_id, str) or CONTEST_ID_PATTERN.fullmatch(contest_id) is None:
        return None, "state contest ID is invalid"
    if not isinstance(problem_id, str) or PROBLEM_ID_PATTERN.fullmatch(problem_id) is None:
        return None, "state problem ID is invalid"
    if not isinstance(recorded_at, str) or UTC_TIMESTAMP_PATTERN.fullmatch(recorded_at) is None:
        return None, "state recorded timestamp is invalid"
    if not isinstance(submission_id, str) or SUBMISSION_ID_PATTERN.fullmatch(submission_id) is None:
        return None, "state submission ID is invalid"
    return {
        "contest_id": contest_id,
        "problem_id": problem_id,
        "recorded_at_utc": recorded_at,
        "submission_id": submission_id,
    }, None


def write_json_exclusive(path: Path, value: Dict[str, Any]) -> None:
    resolved, reason = validate_output_path(path)
    if resolved is None:
        raise ValueError(reason)
    descriptor = os.open(resolved, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, indent=2, sort_keys=True)
        output.write("\n")


class StatusHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.root_count = 0
        self.root_attributes = []  # type: List[Dict[str, str]]
        self.text_parts = []  # type: List[str]

    def handle_starttag(
        self, tag: str, attributes: Sequence[Tuple[str, Optional[str]]]
    ) -> None:
        if self.depth == 0:
            self.root_count += 1
            self.root_attributes.append(attributes_dict(attributes))
        if tag not in VOID_TAGS:
            self.depth += 1

    def handle_startendtag(
        self, tag: str, attributes: Sequence[Tuple[str, Optional[str]]]
    ) -> None:
        if self.depth == 0:
            self.root_count += 1
            self.root_attributes.append(attributes_dict(attributes))

    def handle_endtag(self, tag: str) -> None:
        if tag not in VOID_TAGS and self.depth > 0:
            self.depth -= 1

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.text_parts.append(data)


def parse_status_html(html: str, submission_id: str) -> Dict[str, Any]:
    if not isinstance(html, str) or len(html) > MAX_STATUS_HTML_CHARACTERS:
        return {"classification": "status_html_invalid"}
    parser = StatusHtmlParser()
    try:
        parser.feed(html)
        parser.close()
    except (ValueError, TypeError):
        return {"classification": "status_html_parse_error"}
    if parser.root_count == 0:
        return {
            "classification": "status_html_structure_changed",
            "root_element_count": parser.root_count,
        }
    waiting_roots = [
        attributes
        for attributes in parser.root_attributes
        if "waiting-judge" in set(attributes.get("class", "").split())
    ]
    label = normalize_text("".join(parser.text_parts))
    if waiting_roots:
        if len(waiting_roots) != 1:
            return {
                "classification": "pending_status_not_unique",
                "waiting_root_count": len(waiting_roots),
            }
        if waiting_roots[0].get("data-id") != submission_id:
            return {"classification": "pending_submission_id_mismatch"}
        label_class = (
            "known_pending"
            if label in PENDING_LABELS or re.fullmatch(r"[0-9]+\s*/\s*[0-9]+", label)
            else "other_pending"
        )
        return {
            "classification": "pending",
            "remote_state": "VERDICT_PENDING",
            "status_label": label,
            "pending_label_class": label_class,
        }
    data_ids = {
        attributes["data-id"]
        for attributes in parser.root_attributes
        if attributes.get("data-id")
    }
    if data_ids - {submission_id}:
        return {"classification": "final_submission_id_mismatch"}
    final_candidates = [
        normalize_text(part)
        for part in parser.text_parts
        if normalize_text(part) in FINAL_VERDICTS
    ]
    if len(final_candidates) == 1:
        return {
            "classification": "final",
            "remote_state": "FINAL",
            "status_label": final_candidates[0],
        }
    return {
        "classification": "status_html_structure_changed",
        "root_element_count": parser.root_count,
        "status_label_present": bool(label),
        "final_candidate_count": len(final_candidates),
    }


def parse_status_payload(body: bytes, submission_id: str) -> Dict[str, Any]:
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"classification": "status_json_invalid"}
    if not isinstance(value, dict) or not isinstance(value.get("Result"), dict):
        return {"classification": "status_json_structure_changed"}
    results = value["Result"]
    if set(results) != {submission_id}:
        return {
            "classification": "target_submission_not_unique",
            "result_count": len(results),
            "target_present": submission_id in results,
        }
    target = results[submission_id]
    if not isinstance(target, dict) or not isinstance(target.get("Html"), str):
        return {"classification": "target_status_structure_changed"}
    interval = value.get("Interval")
    if interval is not None and (
        isinstance(interval, bool)
        or not isinstance(interval, int)
        or interval < 0
        or interval > MAX_SERVER_INTERVAL_MILLISECONDS
    ):
        return {"classification": "server_interval_invalid"}
    parsed = parse_status_html(target["Html"], submission_id)
    parsed["server_interval_ms"] = interval
    return parsed


@dataclass
class StatusHttpResult:
    observation: Dict[str, Any]
    body: bytes
    session_cookie: Optional[str]
    finished_monotonic: float


def status_path(contest_id: str, submission_id: str) -> str:
    query = urlencode({"reload": "true", "sids[]": submission_id})
    return STATUS_PATH_TEMPLATE.format(contest_id=contest_id) + "?" + query


def bounded_status_request(
    contest_id: str, submission_id: str, session_cookie: str
) -> StatusHttpResult:
    started_at = utc_now()
    started = time.monotonic()
    connection = http.client.HTTPSConnection(
        HOST,
        443,
        timeout=CONNECT_TIMEOUT_SECONDS,
        context=ssl.create_default_context(),
    )
    headers = {
        "Accept": "application/json",
        "Accept-Language": "ja,en;q=0.5",
        "Cache-Control": "no-cache",
        "Cookie": "REVEL_SESSION=" + session_cookie,
        "User-Agent": USER_AGENT,
    }
    try:
        connection.connect()
        if connection.sock is not None:
            connection.sock.settimeout(REQUEST_TIMEOUT_SECONDS)
        connection.request(
            "GET", status_path(contest_id, submission_id), headers=headers
        )
        response = connection.getresponse()
        status = response.status
        location_class = v03.classify_location(response.getheader("Location"))
        cf_mitigated_class = v03.classify_cf_mitigated(
            response.getheader("Cf-Mitigated")
        )
        set_cookie_headers = response.headers.get_all("Set-Cookie", [])
        content_type = (response.getheader("Content-Type") or "").split(";", 1)[0]
        response_body = response.read(MAX_RESPONSE_BYTES + 1)
        oversized = len(response_body) > MAX_RESPONSE_BYTES
        if oversized:
            response_body = b""
        (
            updated_cookie,
            update_count,
            cookie_updated,
            update_error,
        ) = v03.parse_session_cookie_headers(set_cookie_headers, session_cookie)
        return StatusHttpResult(
            observation={
                "started_at_utc": started_at,
                "finished_at_utc": utc_now(),
                "duration_ms": round((time.monotonic() - started) * 1000),
                "method": "GET",
                "target_class": "target_submission_status",
                "http_status": status,
                "redirect_class": location_class,
                "content_type_class": content_type,
                "set_cookie_header_present": bool(set_cookie_headers),
                "set_cookie_header_count": len(set_cookie_headers),
                "session_cookie_directive_count": update_count,
                "session_cookie_updated": cookie_updated,
                "session_cookie_update_error": update_error,
                "response_body_oversized": oversized,
                "cf_mitigated_class": cf_mitigated_class,
            },
            body=response_body,
            session_cookie=updated_cookie,
            finished_monotonic=time.monotonic(),
        )
    except (OSError, ssl.SSLError, http.client.HTTPException) as error:
        return StatusHttpResult(
            observation={
                "started_at_utc": started_at,
                "finished_at_utc": utc_now(),
                "duration_ms": round((time.monotonic() - started) * 1000),
                "method": "GET",
                "target_class": "target_submission_status",
                "classification": "communication_failure",
                "error_class": type(error).__name__,
            },
            body=b"",
            session_cookie=session_cookie,
            finished_monotonic=time.monotonic(),
        )
    finally:
        connection.close()


def classify_status_response(
    result: StatusHttpResult, submission_id: str
) -> Dict[str, Any]:
    observation = dict(result.observation)
    if observation.get("classification") == "communication_failure":
        return observation
    if observation.get("http_status") in {301, 302, 303, 307, 308} and observation.get(
        "redirect_class"
    ) == "atcoder_login":
        observation["classification"] = "unauthenticated"
        return observation
    if observation.get("http_status") in {403, 429}:
        observation["classification"] = "server_rejection"
        return observation
    if observation.get("cf_mitigated_class") == "challenge":
        observation["classification"] = "cloudflare_challenge"
        return observation
    if observation.get("http_status") != 200:
        observation["classification"] = "unexpected_http_status"
        return observation
    if observation.get("content_type_class") != "application/json":
        observation["classification"] = "unexpected_content_type"
        return observation
    if observation.get("response_body_oversized"):
        observation["classification"] = "response_body_oversized"
        return observation
    if observation.get("session_cookie_update_error") is not None:
        observation["classification"] = "session_cookie_update_error"
        return observation
    observation.update(parse_status_payload(result.body, submission_id))
    return observation


def wait_for_interval(
    finished_monotonic: float, server_interval_ms: Optional[int]
) -> int:
    requested_seconds = max(
        MIN_INTERVAL_SECONDS,
        (server_interval_ms or 0) / 1000.0,
    )
    remaining = requested_seconds - (time.monotonic() - finished_monotonic)
    if remaining > 0:
        time.sleep(remaining)
    return round(max(0.0, remaining) * 1000)


def build_result(
    started_at: str,
    state: Dict[str, str],
    account_observation: Dict[str, Any],
    status_observations: List[Dict[str, Any]],
    waits_ms: List[int],
) -> Dict[str, Any]:
    pending_observations = [
        item for item in status_observations if item.get("classification") == "pending"
    ]
    pending_observed = bool(pending_observations)
    final_observations = [
        item for item in status_observations if item.get("classification") == "final"
    ]
    final_observed = bool(final_observations)
    observation_gap_ms = None  # type: Optional[int]
    observation_sequence_valid = False
    if pending_observations and final_observations:
        pending_timestamp = pending_observations[0].get("finished_at_utc")
        final_timestamp = final_observations[-1].get("finished_at_utc")
        if isinstance(pending_timestamp, str) and isinstance(final_timestamp, str):
            try:
                pending_time = datetime.fromisoformat(
                    pending_timestamp.replace("Z", "+00:00")
                )
                final_time = datetime.fromisoformat(
                    final_timestamp.replace("Z", "+00:00")
                )
                observation_gap_ms = round(
                    (final_time - pending_time).total_seconds() * 1000
                )
                observation_sequence_valid = (
                    0 <= observation_gap_ms <= MAX_OBSERVATION_GAP_SECONDS * 1000
                )
            except ValueError:
                observation_sequence_valid = False
    if pending_observed and final_observed and observation_sequence_valid:
        verdict = "pass"
        completion = "pending_and_final_observed"
    elif pending_observed and final_observed:
        verdict = "incomplete"
        completion = "pending_and_final_sequence_unverified"
    elif final_observed:
        verdict = "incomplete"
        completion = "final_observed_pending_not_observed"
    elif pending_observed:
        verdict = "incomplete"
        completion = "pending_observed_polling_stopped_before_final"
    else:
        verdict = "fail"
        completion = "no_verdict_state_observed"
    return {
        "schema_version": 1,
        "verification_item": "V-04",
        "started_at_utc": started_at,
        "finished_at_utc": utc_now(),
        "platform": {
            "os": platform.system(),
            "os_release": platform.release(),
            "architecture": platform.machine(),
            "python": platform.python_version(),
            "tls": ssl.OPENSSL_VERSION,
        },
        "target": {
            "contest_id": state["contest_id"],
            "problem_id": state["problem_id"],
            "submission_alias": SUBMISSION_ALIAS,
            "v03_recorded_at_utc": state["recorded_at_utc"],
            "actual_submission_id_persisted": False,
        },
        "method": {
            "authentication": "method-C",
            "cookie_name": "REVEL_SESSION",
            "cookie_input_was_hidden": True,
            "expected_identity_input_was_hidden": True,
            "redirect_following": False,
            "automatic_retries": 0,
            "submission_requests": 0,
            "status_endpoint": "own-submission-status-with-single-sids-filter",
            "status_request_limit": MAX_STATUS_REQUESTS,
            "polling_limit_ms": int(MAX_POLLING_SECONDS * 1000),
            "minimum_interval_ms": int(MIN_INTERVAL_SECONDS * 1000),
            "server_interval_respected": True,
            "connect_timeout_ms": int(CONNECT_TIMEOUT_SECONDS * 1000),
            "request_timeout_ms": int(REQUEST_TIMEOUT_SECONDS * 1000),
            "max_response_bytes": MAX_RESPONSE_BYTES,
        },
        "account_observation": account_observation,
        "status_observations": status_observations,
        "waits_ms": waits_ms,
        "request_count": {
            "account_check_get": 1,
            "status_get": len(status_observations),
            "post": 0,
        },
        "pending_observed": pending_observed,
        "final_observed": final_observed,
        "observation_sequence_valid": observation_sequence_valid,
        "pending_to_final_gap_ms": observation_gap_ms,
        "final_status": (
            final_observations[-1].get("status_label")
            if final_observations
            else None
        ),
        "v04": verdict,
        "completion": completion,
        "secret_persistence": {
            "cookie_written_to_file": False,
            "expected_identity_written_to_file": False,
            "actual_submission_id_written_to_result": False,
            "raw_headers_written_to_file": False,
            "raw_html_written_to_file": False,
            "raw_json_written_to_file": False,
        },
    }


def safe_account_observation(observation: Dict[str, Any]) -> Dict[str, Any]:
    allowed = {
        "started_at_utc",
        "finished_at_utc",
        "duration_ms",
        "method",
        "target_class",
        "http_status",
        "redirect_class",
        "content_type_class",
        "set_cookie_header_present",
        "set_cookie_header_count",
        "session_cookie_directive_count",
        "session_cookie_updated",
        "session_cookie_update_error",
        "response_body_oversized",
        "cf_mitigated_class",
        "identity_count",
        "identity_matches_expected",
        "classification",
        "error_class",
    }
    return {key: value for key, value in observation.items() if key in allowed}


def read_confirmation(
    prompt: str, expected: str, *, macos_gui_input: bool
) -> bool:
    if not macos_gui_input:
        return input(prompt).strip() == expected
    escaped_prompt = prompt.replace("\\", "\\\\").replace('"', '\\"')
    apple_script = (
        'display dialog "'
        + escaped_prompt
        + '" buttons {"Cancel", "Confirm"} '
        + 'default button "Confirm" cancel button "Cancel"'
    )
    try:
        completed = subprocess.run(
            ["/usr/bin/osascript", "-e", apple_script],
            check=False,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0


def read_hidden_value(prompt: str, *, macos_gui_input: bool) -> Optional[str]:
    if not macos_gui_input:
        return getpass.getpass(prompt)
    escaped_prompt = prompt.replace("\\", "\\\\").replace('"', '\\"')
    apple_script = (
        'text returned of (display dialog "'
        + escaped_prompt
        + '" default answer "" with hidden answer '
        + 'buttons {"Cancel", "OK"} default button "OK" cancel button "Cancel")'
    )
    try:
        completed = subprocess.run(
            ["/usr/bin/osascript", "-e", apple_script],
            check=False,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout.rstrip("\r\n")


def read_cookie_value(*, macos_gui_input: bool) -> Optional[str]:
    for _ in range(3):
        value = read_hidden_value(
            "REVEL_SESSIONのValue列だけを入力してください。値は表示・保存されません。",
            macos_gui_input=macos_gui_input,
        )
        if value is None:
            return None
        if v02.validate_cookie_value(value) is None:
            return value
        print(
            "入力形式を受理できません。名前、=、引用符、前後の空白を含めず、"
            "Value列だけをコピーし直してください。外部通信はまだ行っていません。"
        )
    return None


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="AtCoder JudgeAdapter V-04の判定状態を安全に観測します。"
    )
    parser.add_argument(
        "--state",
        required=True,
        type=Path,
        help="V-03が作成した所有者専用一時状態ファイル。",
    )
    parser.add_argument(
        "--json-output",
        required=True,
        type=Path,
        help="匿名化済み結果の未作成パス。リポジトリ外だけを許可します。",
    )
    parser.add_argument(
        "--macos-gui-input",
        action="store_true",
        help="秘密入力だけをmacOSの非表示ダイアログで受け取ります。",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.macos_gui_input and platform.system() != "Darwin":
        print("macOS以外ではGUI秘密入力を使用できません。", file=sys.stderr)
        return 64
    if not args.macos_gui_input and not sys.stdin.isatty():
        print(
            "対話ターミナルではないため、秘密情報の非表示入力を保証できません。",
            file=sys.stderr,
        )
        return 64
    state, state_error = read_temporary_state(args.state)
    if state is None:
        print("一時状態を受理できません:", state_error, file=sys.stderr)
        return 64
    _, output_error = validate_output_path(args.json_output)
    if output_error is not None:
        print("JSON保存先を受理できません:", output_error, file=sys.stderr)
        return 64

    started_at = utc_now()
    print("\nAlgoLoom V-04 判定確認・読み取り専用検証")
    print("対象はV-03のsubmission-Aだけです。実際の提出IDは表示・保存しません。")
    print("POST、追加提出、ページ列の走査、自動再試行は行いません。")
    print("\n先に通常のブラウザで次を実施してください。")
    print("1. https://atcoder.jp/settings を再読み込みする。")
    print("2. ログイン画面へ移動せず、期待する本人アカウントだと確認する。")
    print("3. atcoder.jp、Path=/のREVEL_SESSIONを1件だけ選ぶ。")
    print("4. その行のValue列だけをコピーする。")
    if not read_confirmation(
        "通常のブラウザでsettingsを再読み込みし、本人アカウントであることと、"
        "atcoder.jp・Path=/のREVEL_SESSIONが1件であることを確認してください。"
        "確認できた場合だけ続行します。",
        "CONFIRMED",
        macos_gui_input=args.macos_gui_input,
    ):
        print("確認されなかったため、外部通信なしで中止しました。")
        return 2

    expected_identity = read_hidden_value(
        "期待するAtCoderアカウント名を入力してください。値は表示・保存されません。",
        macos_gui_input=args.macos_gui_input,
    )
    if (
        expected_identity is None
        or v02.ACCOUNT_PATTERN.fullmatch(expected_identity) is None
    ):
        print("アカウント名の形式を受理できないため、外部通信なしで中止しました。")
        return 2
    cookie_value = read_cookie_value(macos_gui_input=args.macos_gui_input)
    if cookie_value is None:
        expected_identity = ""
        print("Cookie入力を受理できないため、外部通信なしで中止しました。")
        return 2

    print("\n送信予定:")
    print("- REVEL_SESSIONだけを付けたGET /settingsを1回")
    print("- 2秒以上空け、submission-Aだけを指定する判定GETを最大10回")
    print("- 判定待ちではAtCoder指定のIntervalと2秒の長い方を待つ")
    print("- 全体120秒で停止。リダイレクト追従・自動再試行・POSTなし")
    if not read_confirmation(
        "本人確認GETを1回送り、2秒以上空けてsubmission-Aだけの判定GETを"
        "最大10回送ります。POST・追加提出・自動再試行はありません。"
        "V-04を実行しますか。",
        "RUN V-04",
        macos_gui_input=args.macos_gui_input,
    ):
        cookie_value = None
        expected_identity = ""
        print("承認されなかったため、外部通信なしで中止しました。")
        return 2

    settings_result = v03.bounded_request(
        "GET", SETTINGS_PATH, cookie_value
    )
    account_observation = v03.settings_observation(
        settings_result, expected_identity
    )
    account_class = v03.classify_authenticated_html(
        settings_result, expected_identity, require_identity=True
    )
    account_observation["classification"] = account_class
    cookie_value = settings_result.session_cookie
    expected_identity = ""
    safe_account = safe_account_observation(account_observation)
    if account_class != "ready" or cookie_value is None:
        cookie_value = None
        result = build_result(started_at, state, safe_account, [], [])
        write_json_exclusive(args.json_output, result)
        print("本人アカウントを確認できないため、判定GETを送らず停止しました。")
        print("匿名化済みJSONを指定先へ保存しました。")
        return 1

    waits_ms = [wait_for_interval(settings_result.finished_monotonic, None)]
    observations = []  # type: List[Dict[str, Any]]
    polling_started = time.monotonic()
    for _ in range(MAX_STATUS_REQUESTS):
        response = bounded_status_request(
            state["contest_id"], state["submission_id"], cookie_value
        )
        observation = classify_status_response(response, state["submission_id"])
        observations.append(observation)
        cookie_value = response.session_cookie
        if observation.get("classification") == "final":
            break
        if observation.get("classification") != "pending" or cookie_value is None:
            break
        interval_ms = observation.get("server_interval_ms")
        next_wait_seconds = max(MIN_INTERVAL_SECONDS, (interval_ms or 0) / 1000.0)
        if time.monotonic() - polling_started + next_wait_seconds > MAX_POLLING_SECONDS:
            break
        waits_ms.append(
            wait_for_interval(response.finished_monotonic, interval_ms)
        )

    cookie_value = None
    result = build_result(
        started_at,
        state,
        safe_account,
        observations,
        waits_ms,
    )
    write_json_exclusive(args.json_output, result)
    print("\n観測結果:")
    print("  アカウント照合: 一致")
    print("  判定GET回数:", len(observations))
    print("  判定待ち観測:", result["pending_observed"])
    print("  最終判定観測:", result["final_observed"])
    print("  最終判定:", result["final_status"] or "未観測")
    print("  V-04:", result["v04"])
    if result["completion"] == "final_observed_pending_not_observed":
        print("  判定待ちは実サービスで観測していないため、V-04合格にはしません。")
    print("匿名化済みJSONを指定先へ保存しました。")
    print("Cookie、アカウント名、実際の提出ID、生応答は保存していません。")
    return 0 if result["v04"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
