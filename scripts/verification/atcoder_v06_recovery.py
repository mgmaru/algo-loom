#!/usr/bin/env python3
"""Reconcile one accepted AtCoder submission from a fresh recovery process.

This V-06 helper reads the owner-only V-03 handoff state, verifies the account
with a method-C session, and performs one GET for exactly that submission ID.
It has no source-code input, submit operation, POST request, or automatic retry.
Secrets and the actual submission ID are excluded from the result JSON.
"""

from __future__ import annotations

import argparse
import platform
import ssl
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import atcoder_v02_session_check as v02
import atcoder_v03_submit as v03
import atcoder_v04_verdict as v04


SETTINGS_PATH = "/settings"
SUBMISSION_ALIAS = "submission-A"
STATUS_REQUEST_LIMIT = 1
STATE_PATTERNS = (
    "algoloom-v03-*/v03-browser-state-*.json",
    "algoloom-v04-integrated-*/v03-state.json",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def elapsed_from_record_ms(recorded_at: str, recovery_started_at: str) -> Optional[int]:
    try:
        recorded = datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
        started = datetime.fromisoformat(recovery_started_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    return round((started - recorded).total_seconds() * 1000)


def default_output_path(state_path: Path) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return state_path.parent / ("v06-recovery-result-" + timestamp + ".json")


def build_result(
    started_at: str,
    state: Dict[str, str],
    account_observation: Dict[str, Any],
    status_observation: Optional[Dict[str, Any]],
    wait_ms: Optional[int],
    browser_setup: Dict[str, Any],
    state_selection: str,
) -> Dict[str, Any]:
    status_class = (
        status_observation.get("classification")
        if status_observation is not None
        else None
    )
    recovered = (
        account_observation.get("classification") == "ready"
        and status_class in {"pending", "final"}
    )
    if status_class == "final":
        completion = "same_submission_final_reacquired"
    elif status_class == "pending":
        completion = "same_submission_pending_reacquired"
    elif account_observation.get("classification") != "ready":
        completion = "account_not_verified"
    elif status_class is None:
        completion = "status_not_requested"
    else:
        completion = "submission_reconciliation_failed"
    elapsed_ms = elapsed_from_record_ms(state["recorded_at_utc"], started_at)
    return {
        "schema_version": 1,
        "verification_item": "V-06",
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
        "recovery": {
            "process_role": "standalone-v06-recovery",
            "state_selection": state_selection,
            "owner_only_state_loaded": True,
            "recovery_started_after_v03_record": (
                elapsed_ms is not None and elapsed_ms >= 0
            ),
            "v03_record_to_recovery_start_ms": elapsed_ms,
            "source_input_supported": False,
            "submission_entrypoint_called": False,
            "same_submission_reacquired": recovered,
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
            "status_request_limit": STATUS_REQUEST_LIMIT,
            "minimum_interval_ms": int(v04.MIN_INTERVAL_SECONDS * 1000),
            "connect_timeout_ms": int(v04.CONNECT_TIMEOUT_SECONDS * 1000),
            "request_timeout_ms": int(v04.REQUEST_TIMEOUT_SECONDS * 1000),
            "max_response_bytes": v04.MAX_RESPONSE_BYTES,
        },
        "browser_setup": browser_setup,
        "account_observation": account_observation,
        "status_observation": status_observation,
        "wait_ms": wait_ms,
        "request_count": {
            "account_check_get": 1,
            "status_get": 1 if status_observation is not None else 0,
            "post": 0,
        },
        "recovered_remote_state": (
            status_observation.get("remote_state")
            if recovered and status_observation is not None
            else None
        ),
        "recovered_final_status": (
            status_observation.get("status_label")
            if status_class == "final" and status_observation is not None
            else None
        ),
        "v06": "pass" if recovered else "fail",
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


def chrome_guidance_text() -> str:
    return "\n".join(
        [
            "使用するブラウザはGoogle Chromeです。Safariは使用しません。",
            "V-06は方式Cの技術検証として、通常のGoogle Chromeプロファイルを使います。",
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
            "V-03の所有者専用状態を別プロセスで読み、追加提出なしで"
            "同じ提出IDの判定を1回だけ再照合します。"
        )
    )
    state_group = parser.add_mutually_exclusive_group(required=True)
    state_group.add_argument(
        "--state",
        type=Path,
        help="V-03が作成した所有者専用一時状態の絶対パス。",
    )
    state_group.add_argument(
        "--discover-state",
        action="store_true",
        help="所有者専用のV-03状態が1件だけなら自動選択する。",
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


def select_state(args: argparse.Namespace) -> Tuple[Optional[Path], str, Optional[str]]:
    if args.discover_state:
        path, reason = discover_temporary_state_path()
        return path, "auto-discovered-single-owner-only-state", reason
    return args.state, "explicit-owner-only-state", None


def discover_temporary_state_path() -> Tuple[Optional[Path], Optional[str]]:
    roots = {Path("/private/tmp"), Path(tempfile.gettempdir())}
    candidates = set()
    try:
        for root in roots:
            for pattern in STATE_PATTERNS:
                for path in root.glob(pattern):
                    state, reason = v04.read_temporary_state(path)
                    if state is not None and reason is None:
                        candidates.add(path.resolve())
    except OSError:
        return None, "state discovery roots cannot be inspected"
    if not candidates:
        return None, "no valid V-03 temporary state was discovered"
    if len(candidates) > 1:
        return None, "multiple valid V-03 temporary states were discovered"
    return next(iter(candidates)), None


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if not sys.stdin.isatty():
        print("対話ターミナルから実行してください。", file=sys.stderr)
        return 64
    if args.guided_chrome and platform.system() != "Darwin":
        print("--guided-chromeはmacOS専用です。", file=sys.stderr)
        return 64

    state_path, state_selection, state_path_error = select_state(args)
    if state_path is None:
        print("一時状態を検出できません:", state_path_error, file=sys.stderr)
        print("--stateで対象ファイルを明示してください。", file=sys.stderr)
        return 64
    state, state_error = v04.read_temporary_state(state_path)
    if state is None:
        print("一時状態を受理できません:", state_error, file=sys.stderr)
        return 64

    output_path = args.json_output or default_output_path(state_path)
    resolved_output, output_error = v04.validate_output_path(output_path)
    if resolved_output is None:
        print("結果の保存先を受理できません:", output_error, file=sys.stderr)
        return 64
    output_path = resolved_output
    started_at = utc_now()
    browser_setup: Dict[str, Any] = {
        "workflow": "terminal-method-C",
        "browser_cookie_database_read_by_helper": False,
        "clipboard_read_by_helper": False,
        "devtools_console_command_required": False,
        "browser_closed_by_helper": False,
        "state_selection": state_selection,
    }

    print("\nAlgoLoom V-06 提出IDによる読み取り専用の再照合")
    print("V-03のsubmission-Aを、今回起動した別プロセスから再確認します。")
    print("対象IDは表示せず、GET /settingsを1回、判定GETを1回だけ送ります。")
    print("ソースコード入力、POST、追加提出、提出一覧走査、自動再試行はありません。")

    if args.guided_chrome:
        launched, launch_error = v04.launch_google_chrome_settings()
        browser_setup.update(launched)
        browser_setup["workflow"] = "guided-google-chrome-method-C-v06"
        browser_setup["state_selection"] = state_selection
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
            title="AlgoLoom V-06: 手順1/4 Chromeログイン",
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
            title="AlgoLoom V-06: 手順2/4 Cookie確認",
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
            print("確認されなかったため、検証支援コードのHTTP通信なしで停止しました。")
            return 2
        browser_setup["login_state_confirmed_by_user"] = True
        browser_setup["cookie_row_confirmed_by_user"] = True

    cookie_value = v04.read_cookie_value(
        macos_gui_input=args.guided_chrome,
        title="AlgoLoom V-06: 手順3/4 Cookie貼り付け",
    )
    if cookie_value is None:
        print("Cookie入力を受理できないため、外部通信なしで中止しました。")
        return 2
    expected_identity = v04.read_hidden_value(
        "期待するAtCoderアカウント名を入力してください。値は表示・保存されません。",
        macos_gui_input=args.guided_chrome,
        title="AlgoLoom V-06: 手順4/4 アカウント名",
    )
    if (
        expected_identity is None
        or v02.ACCOUNT_PATTERN.fullmatch(expected_identity) is None
    ):
        cookie_value = ""
        print("アカウント名の形式を受理できないため、外部通信なしで中止しました。")
        return 2

    print("\n送信予定:")
    print("- REVEL_SESSIONだけを付けたGET /settingsを1回")
    print("- 2秒以上空け、submission-Aだけを指定する判定GETを1回")
    print("- リダイレクト追従・自動再試行・POST・追加提出なし")
    if not v04.read_confirmation(
        "本人確認GETを1回送り、2秒以上空けてsubmission-Aだけの判定GETを1回送ります。"
        "POST・追加提出・自動再試行はありません。V-06を実行しますか。",
        "RUN V-06",
        macos_gui_input=args.guided_chrome,
        title="AlgoLoom V-06: 通信確認",
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
    cookie_value = settings_result.session_cookie or ""
    expected_identity = ""
    safe_account = v04.safe_account_observation(account_observation)
    if account_class != "ready" or not cookie_value:
        result = build_result(
            started_at,
            state,
            safe_account,
            None,
            None,
            browser_setup,
            state_selection,
        )
        cookie_value = ""
        v04.write_json_exclusive(output_path, result)
        print("本人アカウントを確認できないため、判定GETを送らず停止しました。")
        print("匿名化済みJSONを保存しました:", output_path)
        return 1

    wait_ms = v04.wait_for_interval(settings_result.finished_monotonic, None)
    status_result = v04.bounded_status_request(
        state["contest_id"], state["submission_id"], cookie_value
    )
    status_observation = v04.classify_status_response(
        status_result, state["submission_id"]
    )
    cookie_value = ""
    result = build_result(
        started_at,
        state,
        safe_account,
        status_observation,
        wait_ms,
        browser_setup,
        state_selection,
    )
    v04.write_json_exclusive(output_path, result)

    print("\n再照合結果:")
    print("  アカウント照合: 一致")
    print("  判定GET回数: 1")
    print("  回復した状態:", result["recovered_remote_state"] or "未取得")
    print("  最終判定:", result["recovered_final_status"] or "未確定")
    print("  V-06:", result["v06"])
    print("匿名化済みJSONを保存しました:", output_path)
    print("Cookie、アカウント名、実際の提出ID、生応答は保存していません。")
    return 0 if result["v06"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
