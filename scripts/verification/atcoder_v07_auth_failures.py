#!/usr/bin/env python3
"""Verify fail-closed authentication failure classification for V-07.

The default execution uses fixed local inputs and performs no network access.
With ``--live-unauthenticated``, the helper performs exactly one explicitly
confirmed GET to AtCoder's settings page without cookies. It never accepts a
credential, follows a redirect, retries, or submits code.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import platform
import re
import socket
import ssl
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple
from urllib.parse import urlparse


HOST = "atcoder.jp"
REQUEST_PATH = "/settings"
TARGET_URL = "https://atcoder.jp/settings"
MAX_BODY_BYTES = 2 * 1024 * 1024
CONNECT_TIMEOUT_SECONDS = 5.0
REQUEST_TIMEOUT_SECONDS = 20.0
USER_AGENT = "AlgoLoom-JudgeAdapter-Verification/0.1"
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
IDENTITY_PATTERN = re.compile(
    rb'var\s+userScreenName\s*=\s*"([A-Za-z0-9_]{1,64})"\s*;'
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
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


def extract_identities(body: bytes) -> List[str]:
    return sorted(
        {match.decode("ascii") for match in IDENTITY_PATTERN.findall(body)}
    )


def classification(
    category: str,
    detail: str,
    safe_action: str,
    **fields: Any,
) -> Dict[str, Any]:
    result = {
        "classification": category,
        "detail": detail,
        "safe_action": safe_action,
    }
    result.update(fields)
    return result


def classify_credential_preflight(
    credential_present: bool,
    server_expires_at: Optional[datetime],
    observed_at: datetime,
) -> Dict[str, Any]:
    """Classify only absence or an explicit server-originated expiry.

    ``server_expires_at`` must be timezone-aware when present. Callers must not
    invent an expiry for a real credential; an unknown expiry remains unknown.
    """
    if not credential_present:
        return classification(
            "unauthenticated",
            "credential_absent",
            "request_reauthentication",
            external_request_allowed=False,
        )
    if server_expires_at is None:
        return classification(
            "indeterminate",
            "credential_present_without_server_expiry",
            "perform_bounded_identity_check",
            external_request_allowed=True,
        )
    if server_expires_at.tzinfo is None or observed_at.tzinfo is None:
        raise ValueError("expiry timestamps must be timezone-aware")
    if server_expires_at <= observed_at:
        return classification(
            "expired",
            "server_expiry_elapsed",
            "request_reauthentication",
            external_request_allowed=False,
        )
    return classification(
        "indeterminate",
        "server_expiry_not_elapsed",
        "perform_bounded_identity_check",
        external_request_allowed=True,
    )


def classify_http_response(
    status: int,
    headers: Mapping[str, str],
    body: bytes,
    credential_context: str,
    oversized: bool = False,
) -> Dict[str, Any]:
    """Project an HTTP response onto non-secret V-07 classifications."""
    normalized_headers = {key.lower(): value for key, value in headers.items()}
    location_class = classify_location(normalized_headers.get("location"))
    content_type = normalized_headers.get("content-type", "").split(";", 1)[0]
    challenge = normalized_headers.get("cf-mitigated", "").lower() == "challenge"

    common = {
        "http_status": status,
        "redirect_class": location_class,
        "content_type_class": content_type or "none",
        "cloudflare_challenge": challenge,
    }
    if challenge:
        return classification(
            "server_rejection",
            "cloudflare_challenge",
            "stop_without_retry",
            **common,
        )
    if status == 403:
        return classification(
            "server_rejection",
            "http_forbidden",
            "stop_without_retry",
            **common,
        )
    if status == 429:
        return classification(
            "server_rejection",
            "rate_limited",
            "honor_server_wait_without_automatic_retry",
            retry_after_present=bool(normalized_headers.get("retry-after")),
            **common,
        )
    if status in REDIRECT_STATUSES and location_class == "atcoder_login":
        if credential_context == "absent":
            return classification(
                "unauthenticated",
                "login_redirect_without_credential",
                "request_reauthentication",
                **common,
            )
        if credential_context == "present_unknown_expiry":
            return classification(
                "unauthenticated_or_expired",
                "login_redirect_with_unexpired_or_unknown_credential",
                "discard_credential_and_request_reauthentication",
                **common,
            )
        raise ValueError("unsupported credential context")
    if status == 200:
        identities = [] if oversized else extract_identities(body)
        shape = {
            "identity_count": len(identities),
            "response_body_oversized": oversized,
        }
        if not oversized and content_type == "text/html" and len(identities) == 1:
            return classification(
                "authenticated_control",
                "unique_identity",
                "compare_expected_identity_before_submission",
                **common,
                **shape,
            )
        if oversized:
            detail = "response_body_oversized"
        elif content_type != "text/html":
            detail = "unexpected_content_type"
        elif len(identities) == 0:
            detail = "identity_missing"
        else:
            detail = "identity_ambiguous"
        return classification(
            "page_structure_changed",
            detail,
            "stop_for_adapter_compatibility_review",
            **common,
            **shape,
        )
    return classification(
        "unexpected_http_status",
        "unallowlisted_status_or_redirect",
        "stop_without_retry",
        **common,
    )


def classify_communication_error(error: BaseException) -> Dict[str, Any]:
    if isinstance(error, socket.gaierror):
        detail = "name_resolution_failure"
    elif isinstance(error, ssl.SSLError):
        detail = "tls_failure"
    elif isinstance(error, TimeoutError):
        detail = "timeout"
    elif isinstance(error, http.client.HTTPException):
        detail = "http_protocol_failure"
    elif isinstance(error, ConnectionError):
        detail = "connection_failure"
    elif isinstance(error, OSError):
        detail = "operating_system_network_failure"
    else:
        raise TypeError("unsupported communication error")
    return classification(
        "communication_failure",
        detail,
        "stop_and_report_pre_send_boundary",
        error_class=type(error).__name__,
    )


def project_live_unauthenticated(
    connection_factory: Optional[Callable[[], http.client.HTTPSConnection]] = None,
) -> Dict[str, Any]:
    """Perform one bounded, cookie-free GET and return allowlisted fields."""
    started_at = utc_now()
    started = time.monotonic()
    factory = connection_factory or (
        lambda: http.client.HTTPSConnection(
            HOST,
            443,
            timeout=CONNECT_TIMEOUT_SECONDS,
            context=ssl.create_default_context(),
        )
    )
    connection = factory()
    headers = {
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en;q=0.5",
        "Cache-Control": "no-cache",
        "User-Agent": USER_AGENT,
    }
    try:
        connection.connect()
        if connection.sock is not None:
            connection.sock.settimeout(REQUEST_TIMEOUT_SECONDS)
        connection.request("GET", REQUEST_PATH, headers=headers)
        response = connection.getresponse()
        body = response.read(MAX_BODY_BYTES + 1)
        projected = classify_http_response(
            response.status,
            {
                "Location": response.getheader("Location") or "",
                "Content-Type": response.getheader("Content-Type") or "",
                "CF-Mitigated": response.getheader("CF-Mitigated") or "",
                "Retry-After": response.getheader("Retry-After") or "",
            },
            body if len(body) <= MAX_BODY_BYTES else b"",
            "absent",
            oversized=len(body) > MAX_BODY_BYTES,
        )
    except (OSError, ssl.SSLError, http.client.HTTPException) as error:
        projected = classify_communication_error(error)
    finally:
        connection.close()
    projected.update(
        {
            "started_at_utc": started_at,
            "finished_at_utc": utc_now(),
            "duration_ms": round((time.monotonic() - started) * 1000),
            "method": "GET",
            "target": TARGET_URL,
            "cookie_sent": False,
            "redirect_following": False,
            "automatic_retries": 0,
        }
    )
    return projected


def local_scenario(
    name: str, observed: Dict[str, Any], expected: Tuple[str, str]
) -> Dict[str, Any]:
    passed = (
        observed.get("classification"), observed.get("detail")
    ) == expected
    return {
        "scenario": name,
        "evidence": "fixed_local_input",
        "classification": observed.get("classification"),
        "detail": observed.get("detail"),
        "safe_action": observed.get("safe_action"),
        "matched_expected": passed,
        "external_request_count": 0,
    }


def run_local_matrix() -> Dict[str, Any]:
    observed_at = datetime(2026, 8, 13, tzinfo=timezone.utc)
    server_expiry = datetime(2026, 8, 12, tzinfo=timezone.utc)
    scenarios = [
        local_scenario(
            "credential_absent",
            classify_credential_preflight(False, None, observed_at),
            ("unauthenticated", "credential_absent"),
        ),
        local_scenario(
            "explicit_server_expiry_elapsed",
            classify_credential_preflight(True, server_expiry, observed_at),
            ("expired", "server_expiry_elapsed"),
        ),
        local_scenario(
            "login_redirect_with_unknown_expiry",
            classify_http_response(
                302,
                {"Location": "https://atcoder.jp/login?continue=%2Fsettings"},
                b"",
                "present_unknown_expiry",
            ),
            (
                "unauthenticated_or_expired",
                "login_redirect_with_unexpired_or_unknown_credential",
            ),
        ),
        local_scenario(
            "http_forbidden",
            classify_http_response(403, {}, b"", "absent"),
            ("server_rejection", "http_forbidden"),
        ),
        local_scenario(
            "rate_limited",
            classify_http_response(429, {"Retry-After": "5"}, b"", "absent"),
            ("server_rejection", "rate_limited"),
        ),
        local_scenario(
            "cloudflare_challenge",
            classify_http_response(
                403,
                {"CF-Mitigated": "challenge", "Content-Type": "text/html"},
                b"",
                "absent",
            ),
            ("server_rejection", "cloudflare_challenge"),
        ),
        local_scenario(
            "identity_missing",
            classify_http_response(
                200,
                {"Content-Type": "text/html; charset=utf-8"},
                b"<html></html>",
                "absent",
            ),
            ("page_structure_changed", "identity_missing"),
        ),
        local_scenario(
            "identity_ambiguous",
            classify_http_response(
                200,
                {"Content-Type": "text/html"},
                (
                    b'var userScreenName = "fixture_one";'
                    b'var userScreenName = "fixture_two";'
                ),
                "absent",
            ),
            ("page_structure_changed", "identity_ambiguous"),
        ),
        local_scenario(
            "name_resolution_failure",
            classify_communication_error(socket.gaierror("local fixture")),
            ("communication_failure", "name_resolution_failure"),
        ),
        local_scenario(
            "tls_failure",
            classify_communication_error(ssl.SSLError("local fixture")),
            ("communication_failure", "tls_failure"),
        ),
        local_scenario(
            "timeout",
            classify_communication_error(TimeoutError("local fixture")),
            ("communication_failure", "timeout"),
        ),
        local_scenario(
            "connection_failure",
            classify_communication_error(ConnectionRefusedError("local fixture")),
            ("communication_failure", "connection_failure"),
        ),
        local_scenario(
            "http_protocol_failure",
            classify_communication_error(
                http.client.RemoteDisconnected("local fixture")
            ),
            ("communication_failure", "http_protocol_failure"),
        ),
    ]
    return {
        "evidence": "local_control",
        "fixture_values_are_synthetic": True,
        "external_request_count": 0,
        "scenario_count": len(scenarios),
        "passed_scenario_count": sum(
            1 for scenario in scenarios if scenario["matched_expected"]
        ),
        "verdict": "pass"
        if all(scenario["matched_expected"] for scenario in scenarios)
        else "fail",
        "scenarios": scenarios,
    }


def build_result(
    started_at: str,
    local_matrix: Dict[str, Any],
    live_observation: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    live_allowed = live_observation is None or live_observation.get(
        "classification"
    ) in {
        "unauthenticated",
        "server_rejection",
        "page_structure_changed",
        "communication_failure",
    }
    passed = local_matrix.get("verdict") == "pass" and live_allowed
    result = {
        "schema_version": 1,
        "verification_item": "V-07",
        "started_at_utc": started_at,
        "finished_at_utc": utc_now(),
        "platform": {
            "os": platform.system(),
            "os_release": platform.release(),
            "architecture": platform.machine(),
            "python": platform.python_version(),
            "tls": ssl.OPENSSL_VERSION,
        },
        "method": {
            "local_fixed_input_matrix": True,
            "live_unauthenticated_control_requested": live_observation is not None,
            "live_cookie_sent": False,
            "redirect_following": False,
            "automatic_retries": 0,
            "connect_timeout_ms": int(CONNECT_TIMEOUT_SECONDS * 1000),
            "request_timeout_ms": int(REQUEST_TIMEOUT_SECONDS * 1000),
            "max_response_bytes": MAX_BODY_BYTES,
        },
        "local_matrix": local_matrix,
        "live_observation": live_observation,
        "atcoder_request_count": 1 if live_observation is not None else 0,
        "submission_requests": 0,
        "submission_count": 0,
        "verdict": "pass" if passed else "fail",
        "limits": {
            "known_server_expiry_can_be_classified": True,
            "login_redirect_without_expiry_cannot_prove_expiration": True,
            "real_expired_session_observed": False,
        },
        "secret_persistence": {
            "credential_accepted": False,
            "cookie_written_to_file": False,
            "raw_headers_written_to_file": False,
            "raw_html_written_to_file": False,
        },
    }
    return result


def repository_root() -> Optional[Path]:
    candidate = Path(__file__).resolve().parents[2]
    return candidate if (candidate / ".git").exists() else None


def validate_json_output_path(path: Path) -> Tuple[Optional[Path], Optional[str]]:
    if not path.is_absolute():
        return None, "JSON output path must be absolute"
    resolved = path.resolve(strict=False)
    root = repository_root()
    if (
        root is not None
        and os.path.commonpath([str(root), str(resolved)]) == str(root)
    ):
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


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="JudgeAdapter V-07の認証失敗分類を安全に検証します。"
    )
    parser.add_argument(
        "--live-unauthenticated",
        action="store_true",
        help="明示確認後、CookieなしのGET /settingsを1回だけ実行します。",
    )
    parser.add_argument(
        "--json-output",
        type=Path,
        help=(
            "匿名化済み結果の保存先。"
            "リポジトリ外の既存しない絶対パスだけを許可します。"
        ),
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.json_output is not None:
        _, output_error = validate_json_output_path(args.json_output)
        if output_error is not None:
            print("JSON保存先を受理できません:", output_error, file=sys.stderr)
            return 64
    if args.live_unauthenticated and not sys.stdin.isatty():
        print(
            "実サービス確認は対話ターミナルからだけ実行できます。",
            file=sys.stderr,
        )
        return 64

    started_at = utc_now()
    local_matrix = run_local_matrix()
    print("AlgoLoom V-07 認証失敗分類")
    print(
        "ローカル固定入力:",
        f"{local_matrix['passed_scenario_count']}/{local_matrix['scenario_count']}",
        local_matrix["verdict"],
    )

    live_observation = None
    if args.live_unauthenticated:
        print("\nAtCoderへCookieなしのGET /settingsを1回だけ送ります。")
        print(
            "Cookie入力、リダイレクト追従、自動再試行、POST、提出はありません。"
        )
        if input("実行する場合だけ RUN と入力: ").strip() != "RUN":
            print("承認されなかったため、外部通信なしで中止しました。")
            return 2
        live_observation = project_live_unauthenticated()
        print("実サービスの分類:", live_observation.get("classification"))
        print("詳細:", live_observation.get("detail"))
        print("処理時間(ms):", live_observation.get("duration_ms"))

    result = build_result(started_at, local_matrix, live_observation)
    print("V-07支援コードの検証結果:", result["verdict"])
    if args.json_output is not None:
        try:
            write_json_result(args.json_output, result)
        except (OSError, ValueError) as error:
            print(
                "匿名化済みJSONを保存できませんでした:",
                str(error),
                file=sys.stderr,
            )
            return 3
        print("匿名化済みJSONを指定先へ保存しました。")
    return 0 if result["verdict"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
