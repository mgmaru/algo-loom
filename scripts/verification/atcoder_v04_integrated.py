#!/usr/bin/env python3
"""Run a human-operated V-03 submission and start V-04 immediately.

The method-C session and expected account are prepared before V-03.  The
helper then watches only the owner-only V-03 state path created for this run.
As soon as that state contains the accepted submission ID, V-04 starts without
waiting for the V-03 browser process to finish cleanup.  Secrets and the actual
submission ID are not passed in argv, environment variables, or anonymized
results.
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import atcoder_v02_session_check as v02
import atcoder_v03_submit as v03
import atcoder_v04_verdict as v04


SCRIPT_DIRECTORY = Path(__file__).resolve().parent
REPOSITORY_ROOT = SCRIPT_DIRECTORY.parents[1]
V03_BROWSER_SCRIPT = SCRIPT_DIRECTORY / "atcoder_v03_browser_submit.mjs"
EXTENSION_DIRECTORY = SCRIPT_DIRECTORY / "atcoder_v03_browser_extension"
MAX_SOURCE_BYTES = 512 * 1024
STATE_POLL_INTERVAL_SECONDS = 0.01
STATE_WAIT_LIMIT_SECONDS = 21 * 60.0
V03_CLEANUP_WAIT_SECONDS = 30.0


@dataclass(frozen=True)
class RunPaths:
    directory: Path
    v03_result: Path
    v03_state: Path
    v04_result: Path


@dataclass
class PreparedSession:
    session_cookie: str
    account_observation: Dict[str, Any]
    account_finished_monotonic: float
    browser_setup: Dict[str, Any]
    v04_started_at_utc: str


def path_is_in_repository(path: Path) -> bool:
    return os.path.commonpath([str(REPOSITORY_ROOT), str(path)]) == str(
        REPOSITORY_ROOT
    )


def validate_source_path(path: Path) -> Tuple[Optional[Path], Optional[str]]:
    if not path.is_absolute():
        return None, "source path must be absolute"
    try:
        resolved = path.resolve(strict=True)
        info = resolved.stat()
        parent_info = resolved.parent.stat()
    except OSError:
        return None, "source file cannot be resolved"
    if path_is_in_repository(resolved):
        return None, "source file must be outside the repository"
    if not stat.S_ISREG(info.st_mode):
        return None, "source path must be a regular file"
    if info.st_uid != os.getuid() or parent_info.st_uid != os.getuid():
        return None, "source file and parent must be owned by the current user"
    if stat.S_IMODE(info.st_mode) & 0o077:
        return None, "source file must be owner-only"
    if stat.S_IMODE(parent_info.st_mode) & 0o077:
        return None, "source parent directory must be owner-only"
    if info.st_size <= 0 or info.st_size > MAX_SOURCE_BYTES:
        return None, "source file size is invalid"
    try:
        resolved.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None, "source file must be valid UTF-8"
    return resolved, None


def create_run_paths() -> RunPaths:
    directory = Path(tempfile.mkdtemp(prefix="algoloom-v04-integrated-"))
    directory.chmod(0o700)
    return RunPaths(
        directory=directory,
        v03_result=directory / "v03-result.json",
        v03_state=directory / "v03-state.json",
        v04_result=directory / "v04-result.json",
    )


def build_v03_command(
    node_executable: str, source_path: Path, paths: RunPaths
) -> List[str]:
    return [
        node_executable,
        str(V03_BROWSER_SCRIPT),
        "--source",
        str(source_path),
        "--json-output",
        str(paths.v03_result),
        "--state-output",
        str(paths.v03_state),
        "--integrated-v04",
    ]


def initial_warning_text() -> str:
    return "\n".join(
        [
            "AlgoLoom V-03→V-04 統合検証",
            "",
            "このスクリプトはAtCoderへ新しい提出を1件だけ行います。",
            "既存のsubmission-Aを確認するだけのスクリプトではありません。",
            "現行計画で提出上限を使い切っている場合は実行しないでください。",
            "検証計画を更新し、この統合実行の新規提出1件を明示的に許可した後だけ進みます。",
            "",
            "自動ログイン、Turnstile自動操作、提出ボタンの自動クリック、",
            "自動再提出、CDP、WebDriver、リモートデバッグは行いません。",
        ]
    )


def session_preparation_text() -> str:
    return "\n".join(
        [
            "【フェーズ1/3】V-04の観測準備（普段使う通常のGoogle Chrome）",
            "",
            "提出後にCookieを探すと判定待ちを取り逃すため、先に準備します。",
            "1. Google Chromeで https://atcoder.jp/settings を確認します。",
            "2. ログイン画面なら、本人が通常ログインと必要なTurnstileを完了します。",
            "3. /settingsに期待する本人アカウントが表示されていることを確認します。",
            "4. 同じChromeで⌥⌘Iを押し、Applicationを開きます。",
            "5. Storage > Cookies > https://atcoder.jp を開きます。",
            "6. Name=REVEL_SESSION、Domain=atcoder.jp、Path=/の行が1件か確認します。",
            "7. Valueセルだけをコピーします。REVEL_SESSION=は含めません。",
            "8. 続く非表示ダイアログへ貼り付けます。",
            "",
            "ConsoleへコマンドやJavaScriptを入力しません。",
            "ヘルパーはCookie DBとクリップボードを自動読取しません。",
        ]
    )


def v03_manual_guidance_text() -> str:
    return "\n".join(
        [
            "【フェーズ2/3】V-03の新規提出（これから開く空の専用Chrome）",
            "",
            "通常Chromeとは別に、空の専用Chromeウインドウが開きます。",
            "ターミナルは閉じず、専用Chromeで次の順に操作してください。",
            "",
            "1. chrome://extensions の『デベロッパー モード』を有効にする。",
            "2. 『パッケージ化されていない拡張機能を読み込む』を押す。",
            f"3. 読込対象として {EXTENSION_DIRECTORY} を選ぶ。",
            "4. 『AlgoLoom V-03 検証の準備』タブへ戻り、1回だけ再読み込みする。",
            "5. 公式互換性チェッカーを開き、Diagnostics passedを目視確認する。",
            "6. 確認ボタンを押し、表示されたリンクからAtCoder /settingsを開く。",
            "7. 専用Chrome上で本人がログインし、本人アカウント名を入力して照合する。",
            "   フェーズ1と同じアカウント名を、もう一度入力します。",
            "8. 表示されたリンクからabc300_aの提出ページを開く。",
            "9. 画面内ガイドに従い、エディタをプレーン欄へ切り替える。",
            "10. ソース設定後、プレーン欄→Ace→プレーン欄と往復する。",
            "11. Ace上にソースが見えることを目視し、同期確認ボタンを押す。",
            "12. Turnstileを自分で完了する。トークン値は読み取りません。",
            "13. 確認項目を読み、承認句 SUBMIT abc300_a を入力する。",
            "14. 『提出を承認する』を押した後、AtCoder本体の提出ボタンを1回だけ押す。",
            "",
            "提出結果が不明でも、もう一度押したり最初からやり直したりしません。",
            "提出IDを取得すると、フェーズ3のV-04が自動的に始まります。",
        ]
    )


def prepare_v04_session() -> Tuple[Optional[PreparedSession], Optional[str]]:
    started_at = v04.utc_now()
    browser_setup, launch_error = v04.launch_google_chrome_settings()
    browser_setup.update(
        {
            "workflow": "integrated-v03-v04-prepared-google-chrome-method-C",
            "v04_session_prepared_before_v03": True,
            "v03_state_watched_locally": True,
            "v03_process_exit_waited_before_status": False,
            "updated_plan_submission_confirmed_by_user": True,
        }
    )
    if launch_error is not None:
        return None, launch_error

    print("\n" + session_preparation_text())
    if not v04.read_confirmation(
        "通常のGoogle Chromeで/settingsを確認してください。ログイン画面なら本人が"
        "ログインし、期待する本人アカウントが表示された後だけ確認ボタンを押します。",
        "NORMAL CHROME ACCOUNT CONFIRMED",
        macos_gui_input=True,
        title="統合検証 フェーズ1: 1/4 本人ログイン",
        confirm_label="本人アカウントを確認済み",
    ):
        return None, "normal_chrome_account_not_confirmed"
    browser_setup["login_state_confirmed_by_user"] = True

    if not v04.read_confirmation(
        "同じGoogle Chromeで⌥⌘Iを押し、Application > Storage > Cookies > "
        "https://atcoder.jpを開いてください。Name=REVEL_SESSION、"
        "Domain=atcoder.jp、Path=/の行が1件であることを確認し、Valueセルだけを"
        "コピーした後に確認ボタンを押します。Consoleには何も入力しません。",
        "COOKIE VALUE COPIED",
        macos_gui_input=True,
        title="統合検証 フェーズ1: 2/4 Cookie確認",
        confirm_label="CookieのValueをコピー済み",
    ):
        return None, "cookie_row_not_confirmed"
    browser_setup["cookie_row_confirmed_by_user"] = True

    cookie_value = v04.read_cookie_value(
        macos_gui_input=True,
        title="統合検証 フェーズ1: 3/4 Cookie貼り付け",
    )
    if cookie_value is None:
        return None, "cookie_input_not_accepted"
    expected_identity = v04.read_hidden_value(
        "期待する本人のAtCoderアカウント名を入力してください。値は表示・保存されません。",
        macos_gui_input=True,
        title="統合検証 フェーズ1: 4/4 アカウント名",
    )
    if (
        expected_identity is None
        or v02.ACCOUNT_PATTERN.fullmatch(expected_identity) is None
    ):
        cookie_value = ""
        return None, "account_input_not_accepted"

    print("\nV-04観測セッションの本人確認として、次の読み取り専用通信を行います。")
    print("- REVEL_SESSIONだけを付けたGET /settingsを1回")
    print("- リダイレクト追従、自動再試行、POSTなし")
    if not v04.read_confirmation(
        "V-03を始める前に、REVEL_SESSIONだけを付けたGET /settingsを1回送り、"
        "期待する本人アカウントと一致することを確認します。実行しますか。",
        "CHECK V04 SESSION",
        macos_gui_input=True,
        title="統合検証 フェーズ1: 読み取り通信",
        confirm_label="本人確認GETを実行",
    ):
        cookie_value = ""
        expected_identity = ""
        return None, "account_request_not_approved"

    settings_result = v03.bounded_request("GET", v04.SETTINGS_PATH, cookie_value)
    account_observation = v03.settings_observation(
        settings_result, expected_identity
    )
    account_class = v03.classify_authenticated_html(
        settings_result, expected_identity, require_identity=True
    )
    account_observation["classification"] = account_class
    expected_identity = ""
    cookie_value = settings_result.session_cookie or ""
    if account_class != "ready" or not cookie_value:
        cookie_value = ""
        return None, "account_identity_not_ready"

    print("V-04観測セッションの本人アカウント一致を確認しました。")
    print("Cookie値とアカウント名はファイルへ保存していません。")
    print("クリップボードは自動消去しません。必要なら安全な文字列で上書きしてください。")
    return PreparedSession(
        session_cookie=cookie_value,
        account_observation=v04.safe_account_observation(account_observation),
        account_finished_monotonic=settings_result.finished_monotonic,
        browser_setup=browser_setup,
        v04_started_at_utc=started_at,
    ), None


def wait_for_v03_state(
    process: subprocess.Popen[Any], state_path: Path
) -> Tuple[Optional[Dict[str, str]], Optional[str]]:
    deadline = time.monotonic() + STATE_WAIT_LIMIT_SECONDS
    while time.monotonic() < deadline:
        if state_path.exists():
            state, _ = v04.read_temporary_state(state_path)
            if state is not None:
                return state, None
        exit_code = process.poll()
        if exit_code is not None:
            if state_path.exists():
                state, _ = v04.read_temporary_state(state_path)
                if state is not None:
                    return state, None
            return None, "V-03 exited without a valid accepted-submission state"
        time.sleep(STATE_POLL_INTERVAL_SECONDS)
    return None, "timed out waiting for the bounded V-03 interaction"


def finish_v03_process(process: subprocess.Popen[Any]) -> int:
    if process.poll() is not None:
        return int(process.returncode or 0)
    try:
        return process.wait(timeout=V03_CLEANUP_WAIT_SECONDS)
    except subprocess.TimeoutExpired:
        process.terminate()
    try:
        return process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        return process.wait(timeout=5)


def state_to_first_status_gap_ms(
    state: Dict[str, str], observations: Sequence[Dict[str, Any]]
) -> Optional[int]:
    if not observations:
        return None
    first_started = observations[0].get("started_at_utc")
    if not isinstance(first_started, str):
        return None
    try:
        state_time = datetime.fromisoformat(
            state["recorded_at_utc"].replace("Z", "+00:00")
        )
        status_time = datetime.fromisoformat(first_started.replace("Z", "+00:00"))
    except ValueError:
        return None
    return round((status_time - state_time).total_seconds() * 1000)


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "V-04合格観測のため、V-04認証準備、V-03の人による1件提出、"
            "提出ID取得直後のV-04有限ポーリングを順に実行します。"
        )
    )
    parser.add_argument(
        "--source",
        required=True,
        type=Path,
        help="本人が作成した提出用UTF-8ソースの所有者専用絶対パス。",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if platform.system() != "Darwin":
        print("この統合導線は現在macOSだけを対象にしています。", file=sys.stderr)
        return 64
    if not sys.stdin.isatty():
        print("リポジトリルートの対話ターミナルから実行してください。", file=sys.stderr)
        return 64
    node_executable = shutil.which("node")
    if node_executable is None:
        print("Node.jsの実行ファイルが見つかりません。", file=sys.stderr)
        return 64
    source_path, source_error = validate_source_path(args.source)
    if source_path is None:
        print("提出用ソースを受理できません:", source_error, file=sys.stderr)
        return 64

    print(initial_warning_text())
    if not v04.read_confirmation(
        "この実行は新しい提出を1件行います。更新済みの検証計画で、この"
        "V-03→V-04統合実行の新規提出1件が許可されている場合だけ続行してください。",
        "UPDATED PLAN AUTHORIZES ONE SUBMISSION",
        macos_gui_input=True,
        title="統合検証: 新規提出の許可確認",
        confirm_label="更新済み計画で1件を許可済み",
    ):
        print("新規提出の許可を確認できないため、外部通信なしで停止しました。")
        return 2

    prepared, preparation_error = prepare_v04_session()
    if prepared is None:
        print(
            "V-04観測準備を完了できないため、V-03を開始せず停止しました:",
            preparation_error,
            file=sys.stderr,
        )
        return 2

    print("\n" + v03_manual_guidance_text())
    if not v04.read_confirmation(
        "次に空の専用Chromeを起動します。画面とターミナルの手順を読み、"
        "人の操作でV-03を1回だけ実行します。提出ID取得後のV-04は自動です。"
        "専用Chromeを起動しますか。",
        "START V03",
        macos_gui_input=True,
        title="統合検証 フェーズ2: 専用Chrome起動",
        confirm_label="V-03専用Chromeを起動",
    ):
        prepared.session_cookie = ""
        print("V-03を開始せず停止しました。AtCoderへの提出は0件です。")
        return 2

    paths = create_run_paths()
    command = build_v03_command(node_executable, source_path, paths)
    print("\n所有者専用の統合検証用一時ディレクトリを作成しました:", paths.directory)
    print("専用Chromeを起動します。上のフェーズ2手順に沿って操作してください。")
    process: Optional[subprocess.Popen[Any]] = None
    v03_exit_code = 3
    try:
        process = subprocess.Popen(command, cwd=REPOSITORY_ROOT)
        state, state_error = wait_for_v03_state(process, paths.v03_state)
        if state is None:
            v03_exit_code = finish_v03_process(process)
            prepared.session_cookie = ""
            print("\nV-03で提出IDを取得できなかったため、V-04の判定GETは送りません。")
            print("理由:", state_error)
            print("V-03匿名化済み結果:", paths.v03_result)
            print("応答が不明でも再提出しないでください。")
            return v03_exit_code if v03_exit_code != 0 else 2

        print("\n【フェーズ3/3】V-04自動観測")
        print("V-03の提出ID取得を検出しました。ここから手動操作はありません。")
        print("V-03プロセスの終了を待たず、同じ提出ID1件だけを直ちに観測します。")
        print("判定待ちではAtCoderのIntervalと2秒の長い方を待ちます。")
        print("判定GETは最大10回、全体120秒、POST・自動再提出なしです。")

        polling = v04.poll_submission_status(
            state["contest_id"],
            state["submission_id"],
            prepared.session_cookie,
            prepared.account_finished_monotonic,
        )
        prepared.session_cookie = ""
        polling.session_cookie = None
        result = v04.build_result(
            prepared.v04_started_at_utc,
            state,
            prepared.account_observation,
            polling.observations,
            polling.waits_ms,
            prepared.browser_setup,
        )
        result["integration"] = {
            "workflow": "prepared-V04-then-V03-then-immediate-V04",
            "updated_plan_submission_confirmed_by_user": True,
            "v03_state_watched_locally": True,
            "v03_process_exit_waited_before_status": False,
            "state_to_first_status_request_ms": state_to_first_status_gap_ms(
                state, polling.observations
            ),
            "v03_result_path_persisted": False,
            "v03_state_path_persisted": False,
        }
        v04.write_json_exclusive(paths.v04_result, result)
        v03_exit_code = finish_v03_process(process)
        process = None

        print("\n統合観測結果:")
        print("  V-03プロセス終了コード:", v03_exit_code)
        print("  判定GET回数:", len(polling.observations))
        print("  判定待ち観測:", result["pending_observed"])
        print("  最終判定観測:", result["final_observed"])
        print("  最終判定:", result["final_status"] or "未観測")
        print("  V-04:", result["v04"])
        print("V-03匿名化済み結果:", paths.v03_result)
        print("V-03一時状態（V-06まで保持）:", paths.v03_state)
        print("V-04匿名化済み結果:", paths.v04_result)
        print("Cookie、アカウント名、実際の提出ID、生応答は結果へ保存していません。")
        print("応答が不明またはV-04未完了でも再提出しないでください。")
        if v03_exit_code != 0:
            return 3
        return 0 if result["v04"] == "pass" else 1
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        prepared.session_cookie = ""
        print("統合検証ヘルパーを完了できませんでした:", type(error).__name__, file=sys.stderr)
        print("提出状態が不明でも再提出しないでください。", file=sys.stderr)
        return 3
    except KeyboardInterrupt:
        prepared.session_cookie = ""
        print("\n利用者の中断を受け付けました。再提出しないでください。", file=sys.stderr)
        return 130
    finally:
        if process is not None:
            try:
                finish_v03_process(process)
            except (OSError, subprocess.SubprocessError):
                pass


if __name__ == "__main__":
    sys.exit(main())
