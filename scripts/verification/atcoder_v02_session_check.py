#!/usr/bin/env python3
"""Safely verify an AtCoder REVEL_SESSION for JudgeAdapter V-02.

This retained verification helper is reconstructed from the disposable helper
used for p0-04. It preserves the successful request and classification path and
adds fail-closed handling; it is not a byte-for-byte copy of the deleted file.

The helper performs at most two GET requests after explicit confirmation. It
sends the request with REVEL_SESSION only when the empty-session control is the
expected login redirect. It never submits code, follows redirects, retries
requests, or persists secret values.
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
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse


HOST = "atcoder.jp"
REQUEST_PATH = "/settings"
TARGET_URL = "https://atcoder.jp/settings"
MAX_BODY_BYTES = 2 * 1024 * 1024
CONNECT_TIMEOUT_SECONDS = 5.0
REQUEST_TIMEOUT_SECONDS = 20.0
MIN_INTERVAL_SECONDS = 2.0
USER_AGENT = "AlgoLoom-JudgeAdapter-Verification/0.1"
IDENTITY_PATTERN = re.compile(
    rb'var\s+userScreenName\s*=\s*"([A-Za-z0-9_]{1,64})"\s*;'
)
ACCOUNT_PATTERN = re.compile(r"[A-Za-z0-9_]{1,64}\Z")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def validate_cookie_value(value: str) -> Optional[str]:
    """Return a non-secret reason code when a Cookie value is unsafe."""
    if not value:
        return "empty"
    if value.startswith("REVEL_SESSION="):
        return "name_prefix_included"
    if value != value.strip():
        return "surrounding_whitespace"
    if value[0:1] in {'"', "'"} or value[-1:] in {'"', "'"}:
        return "quote_included"
    if any(ord(character) < 0x21 or ord(character) > 0x7E for character in value):
        return "non_visible_ascii"
    if any(character in value for character in ";\r\n"):
        return "cookie_header_delimiter"
    if len(value) > 16384:
        return "too_large"
    return None


def extract_identities(body: bytes) -> List[str]:
    return sorted(
        {match.decode("ascii") for match in IDENTITY_PATTERN.findall(body)}
    )


def classify_location(value: Optional[str]) -> str:
    if not value:
        return "none"
    parsed = urlparse(value)
    if parsed.netloc and parsed.netloc != HOST:
        return "other_host"
    if parsed.path == "/login":
        return "atcoder_login"
    return "other_atcoder_path"


def classify_response(
    status: int, location_class: str, identity_count: int
) -> str:
    if status in {301, 302, 303, 307, 308} and location_class == "atcoder_login":
        return "unauthenticated"
    if status == 200 and identity_count == 1:
        return "authenticated_candidate"
    if status == 200:
        return "page_structure_changed"
    if status in {403, 429}:
        return "server_rejection"
    return "unexpected_http_status"


def project_response(
    cookie_value: Optional[str], expected_identity: str
) -> Dict[str, Any]:
    """Perform one bounded request and return allowlisted, non-secret fields."""
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
    if cookie_value is not None:
        headers["Cookie"] = "REVEL_SESSION=" + cookie_value

    try:
        connection.connect()
        if connection.sock is not None:
            connection.sock.settimeout(REQUEST_TIMEOUT_SECONDS)
        connection.request("GET", REQUEST_PATH, headers=headers)
        response = connection.getresponse()
        status = response.status
        location_class = classify_location(response.getheader("Location"))
        set_cookie_count = len(response.headers.get_all("Set-Cookie", []))
        content_type = (response.getheader("Content-Type") or "").split(";", 1)[0]
        body = response.read(MAX_BODY_BYTES + 1)
        oversized = len(body) > MAX_BODY_BYTES
        identities = [] if oversized else extract_identities(body)
        identity = identities[0] if len(identities) == 1 else None
        return {
            "started_at_utc": started_at,
            "finished_at_utc": utc_now(),
            "duration_ms": round((time.monotonic() - started) * 1000),
            "method": "GET",
            "target": TARGET_URL,
            "http_status": status,
            "redirect_class": location_class,
            "set_cookie_header_present": set_cookie_count > 0,
            "set_cookie_header_count": set_cookie_count,
            "content_type_class": content_type,
            "response_body_oversized": oversized,
            "identity_count": len(identities),
            "identity_matches_expected": (
                identity == expected_identity if identity is not None else None
            ),
            "classification": classify_response(
                status, location_class, len(identities)
            ),
        }
    except (OSError, ssl.SSLError, http.client.HTTPException) as error:
        return {
            "started_at_utc": started_at,
            "finished_at_utc": utc_now(),
            "duration_ms": round((time.monotonic() - started) * 1000),
            "method": "GET",
            "target": TARGET_URL,
            "classification": "communication_failure",
            "error_class": type(error).__name__,
        }
    finally:
        connection.close()


def read_confirmation(prompt: str, expected: str) -> bool:
    return input(prompt).strip() == expected


def read_cookie_value() -> Tuple[Optional[str], int]:
    rejected = 0
    for _ in range(3):
        value = getpass.getpass(
            "REVEL_SESSION の Value 列だけを貼り付けて Enter（入力は表示されません）: "
        )
        reason = validate_cookie_value(value)
        if reason is None:
            return value, rejected
        rejected += 1
        print(
            "入力形式を受理できません。名前、=、引用符、前後の空白を含めず、"
            "Value 列だけをコピーし直してください。外部通信はまだ行っていません。"
        )
    return None, rejected


def build_result(
    started_at: str,
    browser_confirmed: bool,
    rejected_inputs: int,
    empty_observation: Dict[str, Any],
    session_observation: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    passed = (
        empty_observation.get("classification") == "unauthenticated"
        and session_observation is not None
        and session_observation.get("classification") == "authenticated_candidate"
        and session_observation.get("identity_count") == 1
        and session_observation.get("identity_matches_expected") is True
    )
    requests = {"empty_session": empty_observation}
    if session_observation is not None:
        requests["method_c_session"] = session_observation
    return {
        "schema_version": 1,
        "verification_item": "V-02",
        "started_at_utc": started_at,
        "finished_at_utc": utc_now(),
        "platform": {
            "os": platform.system(),
            "os_release": platform.release(),
            "architecture": platform.machine(),
            "python": platform.python_version(),
        },
        "method": {
            "authentication": "method-C",
            "browser_state_confirmed_by_user": browser_confirmed,
            "cookie_name": "REVEL_SESSION",
            "cookie_scope_confirmed_by_user": browser_confirmed,
            "cookie_input_was_hidden": True,
            "expected_identity_input_was_hidden": True,
            "rejected_local_cookie_inputs": rejected_inputs,
            "redirect_following": False,
            "automatic_retries": 0,
            "connect_timeout_ms": int(CONNECT_TIMEOUT_SECONDS * 1000),
            "request_timeout_ms": int(REQUEST_TIMEOUT_SECONDS * 1000),
            "max_response_bytes": MAX_BODY_BYTES,
            "user_agent_class": "explicit-verification-client",
        },
        "requests": requests,
        "request_count": len(requests),
        "submission_count": 0,
        "verdict": "pass" if passed else "fail",
        "secret_persistence": {
            "cookie_written_to_file": False,
            "expected_identity_written_to_file": False,
            "raw_headers_written_to_file": False,
            "raw_html_written_to_file": False,
        },
    }


def repository_root() -> Optional[Path]:
    candidate = Path(__file__).resolve().parents[2]
    return candidate if (candidate / ".git").exists() else None


def validate_json_output_path(path: Path) -> Tuple[Optional[Path], Optional[str]]:
    if not path.is_absolute():
        return None, "JSON output path must be absolute"
    resolved = path.resolve(strict=False)
    root = repository_root()
    if root is not None and os.path.commonpath([str(root), str(resolved)]) == str(root):
        return None, "JSON output path must be outside the repository"
    if not resolved.parent.is_dir():
        return None, "JSON output parent directory does not exist"
    if resolved.exists():
        return None, "JSON output path already exists"
    return resolved, None


def write_json_result(path: Path, result: Dict[str, Any]) -> None:
    resolved, reason = validate_json_output_path(path)
    if resolved is None:
        raise ValueError(reason)
    descriptor = os.open(resolved, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False, indent=2, sort_keys=True)
        output.write("\n")


def print_observation(label: str, observation: Dict[str, Any]) -> None:
    print(label)
    print("  HTTP状態:", observation.get("http_status", "取得不能"))
    print("  分類:", observation.get("classification"))
    print("  誘導先:", observation.get("redirect_class", "取得不能"))
    print("  識別情報の件数:", observation.get("identity_count", "取得不能"))
    print("  期待値との一致:", observation.get("identity_matches_expected"))
    print("  処理時間(ms):", observation.get("duration_ms"))


def save_result_if_requested(
    output_path: Optional[Path], result: Dict[str, Any]
) -> bool:
    if output_path is None:
        return True
    try:
        write_json_result(output_path, result)
    except (OSError, ValueError) as error:
        print("匿名化済みJSONを保存できませんでした:", str(error), file=sys.stderr)
        return False
    print("匿名化済みJSONを指定先へ保存しました。")
    return True


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="AtCoder JudgeAdapter V-02の方式Cセッションを安全に確認します。"
    )
    parser.add_argument(
        "--json-output",
        type=Path,
        help="匿名化済み結果の保存先。リポジトリ外の既存しない絶対パスだけを許可します。",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if not sys.stdin.isatty():
        print(
            "対話ターミナルではないため、秘密情報の非表示入力を保証できません。",
            file=sys.stderr,
        )
        return 64
    if args.json_output is not None:
        _, output_error = validate_json_output_path(args.json_output)
        if output_error is not None:
            print("JSON保存先を受理できません:", output_error, file=sys.stderr)
            return 64
    started_at = utc_now()
    print("\nAlgoLoom V-02 方式C・1回限りの診断")
    print("Cookie値とアカウント名は表示・保存しません。AtCoderへの提出は行いません。")
    print("\n先に通常のブラウザで次を実施してください。")
    print("1. https://atcoder.jp/settings を再読み込みする。")
    print("2. ログイン画面へ移動せず、画面上で期待する本人アカウントだと確認する。")
    print("3. 開発者ツールで https://atcoder.jp のCookie一覧を開く。")
    print("4. NameがREVEL_SESSION、Domainがatcoder.jp、Pathが/の行を1件選ぶ。")
    print("5. その行のValue列だけをコピーする。名前やREVEL_SESSION=は含めない。")

    browser_confirmed = read_confirmation(
        "上の5項目を同じブラウザセッションで確認したら CONFIRMED と入力: ",
        "CONFIRMED",
    )
    if not browser_confirmed:
        print("確認されなかったため、外部通信なしで中止しました。")
        return 2

    expected_identity = getpass.getpass(
        "期待するAtCoderアカウント名を入力（表示・保存されません）: "
    )
    if ACCOUNT_PATTERN.fullmatch(expected_identity) is None:
        print("期待アカウント名の形式を受理できないため、外部通信なしで中止しました。")
        return 2

    cookie_value, rejected_inputs = read_cookie_value()
    if cookie_value is None:
        print("Cookie入力を受理できないため、外部通信なしで中止しました。")
        return 2

    print("\n送信予定: CookieなしのGET /settingsを1回、2秒以上空け、")
    print("REVEL_SESSIONだけを付けた同じGETを1回。リダイレクト追従・再試行なし。")
    if not read_confirmation("実行する場合だけ RUN と入力: ", "RUN"):
        print("承認されなかったため、外部通信なしで中止しました。")
        return 2

    empty_observation = project_response(None, expected_identity)
    if empty_observation.get("classification") != "unauthenticated":
        cookie_value = None
        expected_identity = ""
        result = build_result(
            started_at,
            browser_confirmed,
            rejected_inputs,
            empty_observation,
            None,
        )
        print()
        print_observation("空のセッション", empty_observation)
        print("方式Cのセッションは送信せず、安全側で停止しました。")
        if not save_result_if_requested(args.json_output, result):
            return 3
        print("Cookie値とアカウント名はファイルへ保存していません。")
        return 1

    empty_finished = time.monotonic()
    remaining_interval = MIN_INTERVAL_SECONDS - (time.monotonic() - empty_finished)
    if remaining_interval > 0:
        time.sleep(remaining_interval)
    session_observation = project_response(cookie_value, expected_identity)
    cookie_value = None
    expected_identity = ""

    result = build_result(
        started_at,
        browser_confirmed,
        rejected_inputs,
        empty_observation,
        session_observation,
    )
    print()
    print_observation("空のセッション", empty_observation)
    print_observation("方式Cのセッション", session_observation)
    print("\n診断結果:", "V-02 合格" if result["verdict"] == "pass" else "V-02 不合格")

    if not save_result_if_requested(args.json_output, result):
        return 3

    print("Cookie値とアカウント名はファイルへ保存していません。")
    print("クリップボードは変更していません。必要なら安全な文字列で上書きしてください。")
    return 0 if result["verdict"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
