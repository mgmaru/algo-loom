#!/usr/bin/env python3
"""Verify nullable AtCoder judge metrics for JudgeAdapter V-08.

The live path identifies the already submitted p0-22 ``submission-A`` from one
filtered page of the authenticated user's submissions.  It uses only the
non-secret fingerprint already recorded by p0-22: contest, problem, submission
second, language, and final verdict.  The recorded local source size is checked
as a separate observation but is not trusted as a remote identity field.  The
actual submission ID, account name, raw HTML, raw headers, and Cookie value are
never persisted.

The helper performs no POST, submission, pagination, or automatic retry.  Its
local fixture matrix also proves that a verdict observation survives missing or
unrecognized metric fields without inventing zero values.
"""

from __future__ import annotations

import argparse
import json
import platform
import re
import ssl
import sys
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlencode

import atcoder_v02_session_check as v02
import atcoder_v03_submit as v03
import atcoder_v04_verdict as v04


SETTINGS_PATH = "/settings"
CONTEST_ID = "abc300"
PROBLEM_ID = "abc300_a"
TASK_PATH = "/contests/abc300/tasks/abc300_a"
SUBMISSIONS_PATH = "/contests/abc300/submissions/me"
SUBMISSION_PATH_PATTERN = re.compile(r"/contests/abc300/submissions/[0-9]+\Z")
SUBMISSION_ALIAS = "submission-A"
SOURCE_ALIAS = "source-B"
CANONICAL_LANGUAGE_ID = "python-cpython"
ATCODER_LANGUAGE_ID = "6082"
LANGUAGE_LABEL = "Python (CPython 3.13.7)"
SOURCE_SIZE_BYTES = 110
EXPECTED_VERDICT = "AC"
RECORDED_AT_UTC = "2026-08-12T13:48:56.667Z"
SUBMISSION_SECOND_JST = "2026-08-12 22:48:56+0900"
MAX_PAGE_ROWS = 100
NUMBER_WITH_UNIT_PATTERN = re.compile(
    r"(?P<value>[0-9]+(?:\.[0-9]+)?)\s*(?P<unit>[A-Za-z]+)\Z"
)
TIME_FACTORS_MS = {
    "ms": Decimal(1),
    "s": Decimal(1000),
}
MEMORY_FACTORS_BYTES = {
    "B": Decimal(1),
    "KB": Decimal(1000),
    "KiB": Decimal(1024),
    "MB": Decimal(1000 * 1000),
    "MiB": Decimal(1024 * 1024),
}


def utc_now() -> str:
    return v04.utc_now()


def normalize_text(value: str) -> str:
    return " ".join(value.split())


def submissions_path() -> str:
    query = urlencode(
        {
            "f.Task": PROBLEM_ID,
            "f.Language": ATCODER_LANGUAGE_ID,
            "f.Status": EXPECTED_VERDICT,
            "orderBy": "created",
            "desc": "true",
        }
    )
    return SUBMISSIONS_PATH + "?" + query


@dataclass
class TableCell:
    text: str
    hrefs: List[str]


class SubmissionTableParser(HTMLParser):
    """Collect table cells without retaining markup after parsing."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tbody_depth = 0
        self.tbody_count = 0
        self.current_row = None  # type: Optional[List[TableCell]]
        self.current_text = None  # type: Optional[List[str]]
        self.current_hrefs = None  # type: Optional[List[str]]
        self.rows = []  # type: List[List[TableCell]]

    def handle_starttag(
        self, tag: str, attributes: Sequence[Tuple[str, Optional[str]]]
    ) -> None:
        attrs = {name: value or "" for name, value in attributes}
        if tag == "tbody":
            if self.tbody_depth == 0:
                self.tbody_count += 1
            self.tbody_depth += 1
            return
        if self.tbody_depth == 0:
            return
        if tag == "tr" and self.current_row is None:
            self.current_row = []
        elif tag == "td" and self.current_row is not None and self.current_text is None:
            self.current_text = []
            self.current_hrefs = []
        elif tag == "a" and self.current_hrefs is not None:
            href = attrs.get("href")
            if href:
                self.current_hrefs.append(href)

    def handle_data(self, data: str) -> None:
        if self.current_text is not None:
            self.current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self.current_text is not None:
            assert self.current_row is not None
            self.current_row.append(
                TableCell(
                    text=normalize_text("".join(self.current_text)),
                    hrefs=list(self.current_hrefs or []),
                )
            )
            self.current_text = None
            self.current_hrefs = None
        elif tag == "tr" and self.current_row is not None:
            self.rows.append(self.current_row)
            self.current_row = None
        elif tag == "tbody" and self.tbody_depth > 0:
            self.tbody_depth -= 1


def normalized_quantity(
    raw_value: str,
    factors: Dict[str, Decimal],
    normalized_unit: str,
) -> Dict[str, Any]:
    text_value = normalize_text(raw_value)
    if text_value in {"", "-"}:
        return {"status": "not_returned", "value": None, "unit": normalized_unit}
    matched = NUMBER_WITH_UNIT_PATTERN.fullmatch(text_value)
    if matched is None or matched.group("unit") not in factors:
        return {
            "status": "unrecognized_format",
            "value": None,
            "unit": normalized_unit,
        }
    try:
        normalized = Decimal(matched.group("value")) * factors[matched.group("unit")]
    except InvalidOperation:
        return {
            "status": "unrecognized_format",
            "value": None,
            "unit": normalized_unit,
        }
    if normalized != normalized.to_integral_value() or normalized < 0:
        return {
            "status": "unrecognized_format",
            "value": None,
            "unit": normalized_unit,
        }
    integer_value = int(normalized)
    if integer_value > 2**63 - 1:
        return {
            "status": "out_of_range",
            "value": None,
            "unit": normalized_unit,
        }
    return {
        "status": "available",
        "value": integer_value,
        "unit": normalized_unit,
        "source_unit": matched.group("unit"),
    }


def normalized_execution_time(raw_value: str) -> Dict[str, Any]:
    return normalized_quantity(raw_value, TIME_FACTORS_MS, "ms")


def normalized_memory(raw_value: str) -> Dict[str, Any]:
    return normalized_quantity(raw_value, MEMORY_FACTORS_BYTES, "byte")


def row_has_href(cell: TableCell, expected: str) -> bool:
    return expected in cell.hrefs


def row_matches_target(row: List[TableCell]) -> bool:
    if len(row) not in {8, 10}:
        return False
    return (
        row[0].text == SUBMISSION_SECOND_JST
        and row_has_href(row[1], TASK_PATH)
        and row[3].text == LANGUAGE_LABEL
        and row[6].text == EXPECTED_VERDICT
    )


def safe_row_diagnostics(row: List[TableCell]) -> Dict[str, Any]:
    """Return match booleans only; never project cell text or link values."""
    has_fixed_columns = len(row) >= 7
    return {
        "column_count": len(row),
        "supported_column_count": len(row) in {8, 10},
        "submission_second_matches": (
            has_fixed_columns and row[0].text == SUBMISSION_SECOND_JST
        ),
        "task_path_matches": (
            has_fixed_columns and row_has_href(row[1], TASK_PATH)
        ),
        "language_label_matches": (
            has_fixed_columns and row[3].text == LANGUAGE_LABEL
        ),
        "source_size_matches": (
            has_fixed_columns
            and row[5].text == str(SOURCE_SIZE_BYTES) + " Byte"
        ),
        "verdict_matches": (
            has_fixed_columns and row[6].text == EXPECTED_VERDICT
        ),
        "detail_link_shape_matches": (
            bool(row)
            and sum(
                1
                for href in row[-1].hrefs
                if SUBMISSION_PATH_PATTERN.fullmatch(href)
            )
            == 1
        ),
    }


def parse_submission_page(body: bytes, observed_at: str) -> Dict[str, Any]:
    parser = SubmissionTableParser()
    try:
        parser.feed(body.decode("utf-8"))
        parser.close()
    except (UnicodeDecodeError, ValueError, AssertionError):
        return {
            "classification": "submission_page_parse_error",
            "verdict_persisted": False,
        }
    if parser.tbody_count != 1:
        return {
            "classification": "submission_page_structure_changed",
            "tbody_count": parser.tbody_count,
            "page_row_count": len(parser.rows),
            "verdict_persisted": False,
        }
    if len(parser.rows) > MAX_PAGE_ROWS:
        return {
            "classification": "submission_page_row_limit_exceeded",
            "page_row_count": len(parser.rows),
            "verdict_persisted": False,
        }
    candidates = [row for row in parser.rows if row_matches_target(row)]
    if len(candidates) != 1:
        projection = {
            "classification": (
                "target_submission_not_found"
                if not candidates
                else "target_submission_not_unique"
            ),
            "page_row_count": len(parser.rows),
            "target_candidate_count": len(candidates),
            "verdict_persisted": False,
        }
        if len(parser.rows) == 1:
            projection["single_row_diagnostics"] = safe_row_diagnostics(
                parser.rows[0]
            )
        return projection
    row = candidates[0]
    detail_links = [
        href for href in row[-1].hrefs if SUBMISSION_PATH_PATTERN.fullmatch(href)
    ]
    if len(detail_links) != 1:
        return {
            "classification": "target_submission_link_not_unique",
            "page_row_count": len(parser.rows),
            "target_candidate_count": 1,
            "target_submission_link_count": len(detail_links),
            "verdict_persisted": False,
        }
    if len(row) == 8:
        execution_time = normalized_execution_time("")
        memory = normalized_memory("")
    else:
        execution_time = normalized_execution_time(row[7].text)
        memory = normalized_memory(row[8].text)
    metric_statuses = {execution_time["status"], memory["status"]}
    classification = (
        "target_submission_observed"
        if metric_statuses <= {"available", "not_returned"}
        else "target_submission_metrics_unrecognized"
    )
    return {
        "classification": classification,
        "page_row_count": len(parser.rows),
        "target_candidate_count": 1,
        "target_submission_link_count": 1,
        "actual_submission_id_persisted": False,
        "recorded_source_size_matches_remote_display": (
            row[5].text == str(SOURCE_SIZE_BYTES) + " Byte"
        ),
        "verdict_persisted": True,
        "verdict_observation": {
            "observed_at_utc": observed_at,
            "remote_state": "FINAL",
            "status_label": EXPECTED_VERDICT,
            "source": "atcoder-own-submissions-filtered-page",
        },
        "judge_execution_time": execution_time,
        "judge_memory": memory,
    }


def fixture_row(
    execution_time: Optional[str],
    memory: Optional[str],
    *,
    submission_id: str = "12345678",
) -> str:
    metric_cells = ""
    if execution_time is not None and memory is not None:
        metric_cells = "<td>{}</td><td>{}</td>".format(execution_time, memory)
    return (
        "<tr>"
        "<td>{}</td>"
        '<td><a href="{}">A</a></td>'
        '<td><a href="/users/fixture-user">fixture-user</a></td>'
        "<td>{}</td><td>100</td><td>{} Byte</td><td>{}</td>"
        "{}"
        '<td><a href="/contests/{}/submissions/{}">Detail</a></td>'
        "</tr>"
    ).format(
        SUBMISSION_SECOND_JST,
        TASK_PATH,
        LANGUAGE_LABEL,
        SOURCE_SIZE_BYTES,
        EXPECTED_VERDICT,
        metric_cells,
        CONTEST_ID,
        submission_id,
    )


def fixture_page(*rows: str) -> bytes:
    return ("<html><body><table><tbody>" + "".join(rows) + "</tbody></table></body></html>").encode()


def run_local_fixture_checks() -> Dict[str, Any]:
    checks = []  # type: List[Dict[str, Any]]

    normalized = parse_submission_page(
        fixture_page(fixture_row("0.123 s", "1.5 MB")),
        "2026-08-12T18:00:00.000Z",
    )
    checks.append(
        {
            "name": "returned_units_normalized",
            "passed": (
                normalized.get("classification") == "target_submission_observed"
                and normalized.get("judge_execution_time", {}).get("value") == 123
                and normalized.get("judge_execution_time", {}).get("unit") == "ms"
                and normalized.get("judge_memory", {}).get("value") == 1_500_000
                and normalized.get("judge_memory", {}).get("unit") == "byte"
            ),
        }
    )

    missing = parse_submission_page(
        fixture_page(fixture_row("-", "-")),
        "2026-08-12T18:00:01.000Z",
    )
    checks.append(
        {
            "name": "missing_metrics_verdict_persisted",
            "passed": (
                missing.get("classification") == "target_submission_observed"
                and missing.get("verdict_persisted") is True
                and missing.get("verdict_observation", {}).get("status_label") == "AC"
                and missing.get("judge_execution_time", {}).get("status")
                == "not_returned"
                and missing.get("judge_memory", {}).get("status") == "not_returned"
            ),
        }
    )

    unrecognized = parse_submission_page(
        fixture_page(fixture_row("fast", "many")),
        "2026-08-12T18:00:02.000Z",
    )
    checks.append(
        {
            "name": "unrecognized_metrics_verdict_persisted",
            "passed": (
                unrecognized.get("classification")
                == "target_submission_metrics_unrecognized"
                and unrecognized.get("verdict_persisted") is True
                and unrecognized.get("verdict_observation", {}).get("status_label")
                == "AC"
            ),
        }
    )

    duplicate = parse_submission_page(
        fixture_page(
            fixture_row("1 ms", "1 KiB", submission_id="12345678"),
            fixture_row("2 ms", "2 KiB", submission_id="12345679"),
        ),
        "2026-08-12T18:00:03.000Z",
    )
    checks.append(
        {
            "name": "target_uniqueness_enforced",
            "passed": (
                duplicate.get("classification") == "target_submission_not_unique"
                and duplicate.get("target_candidate_count") == 2
                and duplicate.get("verdict_persisted") is False
            ),
        }
    )

    passed_count = sum(1 for check in checks if check["passed"])
    return {
        "fixture_count": len(checks),
        "passed_count": passed_count,
        "all_passed": passed_count == len(checks),
        "checks": checks,
        "external_requests": 0,
    }


def classify_submission_response(result: v03.HttpResult) -> Dict[str, Any]:
    observation = dict(result.observation)
    if observation.get("classification") == "communication_failure":
        return safe_http_observation(observation)
    if observation.get("http_status") in {301, 302, 303, 307, 308} and observation.get(
        "redirect_class"
    ) == "atcoder_login":
        observation["classification"] = "unauthenticated"
    elif observation.get("http_status") in {403, 429}:
        observation["classification"] = "server_rejection"
    elif observation.get("cf_mitigated_class") == "challenge":
        observation["classification"] = "cloudflare_challenge"
    elif observation.get("http_status") != 200:
        observation["classification"] = "unexpected_http_status"
    elif observation.get("content_type_class") != "text/html":
        observation["classification"] = "unexpected_content_type"
    elif observation.get("response_body_oversized"):
        observation["classification"] = "response_body_oversized"
    elif observation.get("session_cookie_update_error") is not None:
        observation["classification"] = "session_cookie_update_error"
    else:
        observation.update(
            parse_submission_page(result.body, observation["finished_at_utc"])
        )
    return safe_http_observation(observation)


def safe_http_observation(observation: Dict[str, Any]) -> Dict[str, Any]:
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
        "classification",
        "error_class",
        "page_row_count",
        "tbody_count",
        "target_candidate_count",
        "target_submission_link_count",
        "actual_submission_id_persisted",
        "recorded_source_size_matches_remote_display",
        "verdict_persisted",
        "verdict_observation",
        "judge_execution_time",
        "judge_memory",
        "single_row_diagnostics",
    }
    return {key: value for key, value in observation.items() if key in allowed}


def build_result(
    started_at: str,
    local_checks: Dict[str, Any],
    account_observation: Dict[str, Any],
    submission_observation: Optional[Dict[str, Any]],
    wait_ms: Optional[int],
    browser_setup: Dict[str, Any],
) -> Dict[str, Any]:
    classification = (
        submission_observation.get("classification")
        if submission_observation is not None
        else None
    )
    metric_statuses = set()
    if submission_observation is not None:
        for key in ("judge_execution_time", "judge_memory"):
            value = submission_observation.get(key)
            if isinstance(value, dict):
                metric_statuses.add(value.get("status"))
    live_supported = (
        classification == "target_submission_observed"
        and submission_observation is not None
        and submission_observation.get("verdict_persisted") is True
        and metric_statuses
        and metric_statuses <= {"available", "not_returned"}
    )
    passed = (
        local_checks.get("all_passed") is True
        and account_observation.get("classification") == "ready"
        and live_supported
    )
    if passed:
        completion = "live_metrics_and_nullable_verdict_storage_verified"
    elif account_observation.get("classification") != "ready":
        completion = "account_not_verified"
    elif submission_observation is None:
        completion = "submission_page_not_requested"
    else:
        completion = "metric_verification_incomplete"
    return {
        "schema_version": 1,
        "verification_item": "V-08",
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
            "contest_id": CONTEST_ID,
            "problem_id": PROBLEM_ID,
            "submission_alias": SUBMISSION_ALIAS,
            "source_alias": SOURCE_ALIAS,
            "source_size_bytes": SOURCE_SIZE_BYTES,
            "canonical_language_id": CANONICAL_LANGUAGE_ID,
            "atcoder_language_id": ATCODER_LANGUAGE_ID,
            "language_label": LANGUAGE_LABEL,
            "recorded_at_utc": RECORDED_AT_UTC,
            "match_granularity": "submission-second-and-recorded-fingerprint",
            "recorded_source_size_used_for_selection": False,
            "expected_final_status": EXPECTED_VERDICT,
            "actual_submission_id_persisted": False,
        },
        "method": {
            "authentication": "method-C",
            "cookie_name": "REVEL_SESSION",
            "cookie_input_was_hidden": True,
            "expected_identity_input_was_hidden": True,
            "target_selection": "single-filtered-own-submissions-page",
            "pages_requested": 1,
            "pagination_followed": False,
            "redirect_following": False,
            "automatic_retries": 0,
            "submission_requests": 0,
            "minimum_interval_ms": int(v03.MIN_INTERVAL_SECONDS * 1000),
            "connect_timeout_ms": int(v03.CONNECT_TIMEOUT_SECONDS * 1000),
            "request_timeout_ms": int(v03.REQUEST_TIMEOUT_SECONDS * 1000),
            "max_response_bytes": v03.MAX_BODY_BYTES,
        },
        "browser_setup": browser_setup,
        "local_fixture_checks": local_checks,
        "account_observation": account_observation,
        "submission_observation": submission_observation,
        "wait_ms": wait_ms,
        "request_count": {
            "account_check_get": 1,
            "filtered_submission_page_get": 1 if submission_observation is not None else 0,
            "submission_detail_get": 0,
            "post": 0,
        },
        "verdict_storage_continues_without_metrics": (
            local_checks.get("all_passed") is True
            and any(
                check.get("name") == "missing_metrics_verdict_persisted"
                and check.get("passed") is True
                for check in local_checks.get("checks", [])
            )
        ),
        "v08": "pass" if passed else "fail",
        "completion": completion,
        "secret_persistence": {
            "cookie_written_to_file": False,
            "expected_identity_written_to_file": False,
            "actual_account_name_written_to_result": False,
            "actual_submission_id_written_to_result": False,
            "raw_headers_written_to_file": False,
            "raw_html_written_to_file": False,
        },
    }


def chrome_guidance_text() -> str:
    return "\n".join(
        [
            "使用するブラウザはGoogle Chromeです。Safariは使用しません。",
            "V-08は方式Cの技術検証として、通常のGoogle Chromeプロファイルを使います。",
            "",
            "1. /settingsがログイン画面なら、本人が通常どおりログインし、",
            "   必要なTurnstileも本人が操作してから/settingsへ戻る。",
            "2. 画面上のアカウントが期待する本人であることを確認する。",
            "3. 同じChromeで⌥⌘Iを押し、Applicationを開く。",
            "4. Storage > Cookies > https://atcoder.jpを開く。",
            "5. Name=REVEL_SESSION、Domain=atcoder.jp、Path=/の行が1件か確認する。",
            "6. Valueセルだけをコピーする。REVEL_SESSION=は含めない。",
            "",
            "ConsoleへコマンドやJavaScriptを入力しません。",
            "ヘルパーはCookie DBとクリップボードを自動読取しません。",
        ]
    )


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "V-08の単位正規化とnullable保存を固定入力で確認し、任意で"
            "p0-22のsubmission-Aを読み取り専用GETで実サービス確認します。"
        )
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="本人確認後にAtCoderへ読み取り専用GETを2回送る。",
    )
    parser.add_argument(
        "--json-output",
        type=Path,
        help="匿名化済み結果を新規作成するリポジトリ外の絶対パス。",
    )
    parser.add_argument(
        "--guided-chrome",
        action="store_true",
        help="macOSのGoogle ChromeとGUIダイアログを使う段階式導線。",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    local_checks = run_local_fixture_checks()
    if not args.live:
        print(json.dumps(local_checks, ensure_ascii=False, indent=2, sort_keys=True))
        return 0 if local_checks["all_passed"] else 1
    if args.json_output is None:
        print("--liveには--json-outputが必要です。", file=sys.stderr)
        return 64
    if not sys.stdin.isatty():
        print("--liveは対話ターミナルから実行してください。", file=sys.stderr)
        return 64
    if args.guided_chrome and platform.system() != "Darwin":
        print("--guided-chromeはmacOS専用です。", file=sys.stderr)
        return 64
    output_path, output_error = v04.validate_output_path(args.json_output)
    if output_path is None:
        print("結果の保存先を受理できません:", output_error, file=sys.stderr)
        return 64

    started_at = utc_now()
    browser_setup: Dict[str, Any] = {
        "workflow": "terminal-method-C-v08",
        "browser_cookie_database_read_by_helper": False,
        "clipboard_read_by_helper": False,
        "devtools_console_command_required": False,
        "browser_closed_by_helper": False,
    }

    print("\nAlgoLoom V-08 ジャッジ実行時間・メモリの検証")
    print("固定入力:", local_checks["passed_count"], "/", local_checks["fixture_count"], "合格")
    print("p0-22のsubmission-Aを、記録済みの指紋で先頭1ページから一意に照合します。")
    print("実際の提出ID、アカウント名、生HTML、Cookieは表示・保存しません。")
    print("POST、追加提出、提出詳細GET、ページ送り、自動再試行はありません。")

    if args.guided_chrome:
        launched, launch_error = v04.launch_google_chrome_settings()
        browser_setup.update(launched)
        browser_setup["workflow"] = "guided-google-chrome-method-C-v08"
        if launch_error is not None:
            print("Google Chromeを起動できませんでした:", launch_error, file=sys.stderr)
            return 2
        print("\nGoogle Chromeで/settingsを明示的に開きました。")
        print(chrome_guidance_text())
        if not v04.read_confirmation(
            "Google Chromeの/settingsで期待する本人アカウントを確認してください。"
            "ログイン画面なら本人がログインして/settingsへ戻った後だけ続行してください。",
            "CHROME LOGIN CONFIRMED",
            macos_gui_input=True,
            title="AlgoLoom V-08: 手順1/4 Chromeログイン",
            confirm_label="Chromeログイン確認済み",
        ):
            print("Chromeのログイン状態が確認されなかったため停止しました。")
            return 2
        browser_setup["login_state_confirmed_by_user"] = True
        if not v04.read_confirmation(
            "同じGoogle ChromeでApplication > Storage > Cookies > https://atcoder.jpを開き、"
            "Name=REVEL_SESSION、Domain=atcoder.jp、Path=/の行が1件であることを確認し、"
            "Valueセルだけをコピーしてください。Consoleには何も入力しません。",
            "COOKIE VALUE COPIED",
            macos_gui_input=True,
            title="AlgoLoom V-08: 手順2/4 Cookie確認",
            confirm_label="CookieのValueをコピー済み",
        ):
            print("ChromeのCookie対象行が確認されなかったため停止しました。")
            return 2
        browser_setup["cookie_row_confirmed_by_user"] = True
    else:
        if not v04.read_confirmation(
            "通常ブラウザの/settingsで本人アカウントと、atcoder.jp・Path=/の"
            "REVEL_SESSIONが1件であることを確認した場合だけCONFIRMEDと入力: ",
            "CONFIRMED",
            macos_gui_input=False,
        ):
            print("確認されなかったため、外部通信なしで停止しました。")
            return 2
        browser_setup["login_state_confirmed_by_user"] = True
        browser_setup["cookie_row_confirmed_by_user"] = True

    cookie_value = v04.read_cookie_value(
        macos_gui_input=args.guided_chrome,
        title="AlgoLoom V-08: 手順3/4 Cookie貼り付け",
    )
    if cookie_value is None:
        print("Cookie入力を受理できないため、外部通信なしで中止しました。")
        return 2
    expected_identity = v04.read_hidden_value(
        "期待するAtCoderアカウント名を入力してください。値は表示・保存されません。",
        macos_gui_input=args.guided_chrome,
        title="AlgoLoom V-08: 手順4/4 アカウント名",
    )
    if expected_identity is None or v02.ACCOUNT_PATTERN.fullmatch(expected_identity) is None:
        cookie_value = ""
        print("アカウント名の形式を受理できないため、外部通信なしで中止しました。")
        return 2

    print("\n送信予定:")
    print("- REVEL_SESSIONだけを付けたGET /settingsを1回")
    print("- 2秒以上空け、本人の提出一覧を固定filter・先頭1ページだけGET 1回")
    print("- リダイレクト追従・ページ送り・自動再試行・POST・追加提出なし")
    if not v04.read_confirmation(
        "本人確認GETを1回送り、2秒以上空けてp0-22のsubmission-Aを含む"
        "固定filterの先頭1ページをGET 1回送ります。V-08を実行しますか。",
        "RUN V-08",
        macos_gui_input=args.guided_chrome,
        title="AlgoLoom V-08: 通信確認",
        confirm_label="読み取り専用GETを実行",
    ):
        cookie_value = ""
        expected_identity = ""
        print("承認されなかったため、外部通信なしで中止しました。")
        return 2

    settings_result = v03.bounded_request("GET", SETTINGS_PATH, cookie_value)
    account_observation = v03.settings_observation(settings_result, expected_identity)
    account_class = v03.classify_authenticated_html(
        settings_result, expected_identity, require_identity=True
    )
    account_observation["classification"] = account_class
    safe_account = v04.safe_account_observation(account_observation)
    cookie_value = settings_result.session_cookie or ""
    expected_identity = ""
    if account_class != "ready" or not cookie_value:
        result = build_result(
            started_at,
            local_checks,
            safe_account,
            None,
            None,
            browser_setup,
        )
        cookie_value = ""
        v04.write_json_exclusive(output_path, result)
        print("本人アカウントを確認できないため、提出一覧GETを送らず停止しました。")
        print("匿名化済みJSONを保存しました:", output_path)
        return 1

    wait_ms = v04.wait_for_interval(settings_result.finished_monotonic, None)
    page_result = v03.bounded_request("GET", submissions_path(), cookie_value)
    submission_observation = classify_submission_response(page_result)
    cookie_value = ""
    result = build_result(
        started_at,
        local_checks,
        safe_account,
        submission_observation,
        wait_ms,
        browser_setup,
    )
    v04.write_json_exclusive(output_path, result)

    print("\n検証結果:")
    print("  アカウント照合: 一致")
    print("  提出一覧GET回数: 1")
    print("  対象候補数:", submission_observation.get("target_candidate_count", 0))
    print("  判定保存:", "継続" if submission_observation.get("verdict_persisted") else "未成立")
    execution = submission_observation.get("judge_execution_time", {})
    memory = submission_observation.get("judge_memory", {})
    print("  ジャッジ実行時間:", execution.get("status", "未取得"))
    print("  ジャッジメモリ:", memory.get("status", "未取得"))
    print("  V-08:", result["v08"])
    print("匿名化済みJSONを保存しました:", output_path)
    print("Cookie、アカウント名、実際の提出ID、生応答は保存していません。")
    return 0 if result["v08"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
