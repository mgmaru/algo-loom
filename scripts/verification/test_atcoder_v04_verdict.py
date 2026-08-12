#!/usr/bin/env python3

import io
import json
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import atcoder_v04_verdict as target


def temporary_state(submission_id: str = "12345678") -> dict:
    return {
        "schema_version": 1,
        "purpose": "temporary-state-for-V-04-and-V-06",
        "submission_alias": "submission-A",
        "contest_id": "abc300",
        "problem_id": "abc300_a",
        "recorded_at_utc": "2026-08-12T06:29:51.644Z",
        "submission_id": submission_id,
    }


class TemporaryStateTest(unittest.TestCase):
    def test_reads_owner_only_state_without_returning_extra_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text(json.dumps(temporary_state()), encoding="utf-8")
            path.chmod(0o600)
            value, reason = target.read_temporary_state(path)
        self.assertIsNone(reason)
        self.assertEqual(value["submission_id"], "12345678")
        self.assertEqual(set(value), {
            "contest_id",
            "problem_id",
            "recorded_at_utc",
            "submission_id",
        })

    def test_rejects_permissive_mode_and_invalid_submission_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text(json.dumps(temporary_state()), encoding="utf-8")
            path.chmod(0o644)
            value, reason = target.read_temporary_state(path)
            self.assertIsNone(value)
            self.assertEqual(reason, "state file must be owner-only")
            path.chmod(0o600)
            path.write_text(json.dumps(temporary_state("not-a-number")), encoding="utf-8")
            value, reason = target.read_temporary_state(path)
        self.assertIsNone(value)
        self.assertEqual(reason, "state submission ID is invalid")

    def test_discovers_exactly_one_owner_only_v03_browser_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_directory = root / "algoloom-v03-one"
            run_directory.mkdir(mode=0o700)
            path = run_directory / "v03-browser-state-1.json"
            path.write_text(json.dumps(temporary_state()), encoding="utf-8")
            path.chmod(0o600)
            discovered, reason = target.discover_temporary_state_path(root)
        self.assertIsNone(reason)
        self.assertEqual(discovered, path.resolve())

    def test_rejects_ambiguous_state_discovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index in (1, 2):
                run_directory = root / f"algoloom-v03-{index}"
                run_directory.mkdir(mode=0o700)
                path = run_directory / f"v03-browser-state-{index}.json"
                path.write_text(json.dumps(temporary_state()), encoding="utf-8")
                path.chmod(0o600)
            discovered, reason = target.discover_temporary_state_path(root)
        self.assertIsNone(discovered)
        self.assertEqual(
            reason, "multiple valid V-03 temporary states were discovered"
        )

    def test_default_output_stays_with_owner_only_state(self) -> None:
        state_path = Path("/private/tmp/example/state.json")
        output_path = target.default_output_path(state_path)
        self.assertEqual(output_path.parent, state_path.parent)
        self.assertTrue(output_path.name.startswith("v04-guided-result-"))
        self.assertEqual(output_path.suffix, ".json")


class StatusPayloadTest(unittest.TestCase):
    def test_classifies_pending_for_exact_submission(self) -> None:
        body = json.dumps({
            "Interval": 2500,
            "Result": {
                "12345678": {
                    "Html": (
                        '<span class="label label-default waiting-judge" '
                        'data-id="12345678"><span>3 / 10</span></span>'
                    ),
                    "Score": 0,
                }
            },
        }).encode()
        parsed = target.parse_status_payload(body, "12345678")
        self.assertEqual(parsed["classification"], "pending")
        self.assertEqual(parsed["remote_state"], "VERDICT_PENDING")
        self.assertEqual(parsed["status_label"], "3 / 10")
        self.assertEqual(parsed["server_interval_ms"], 2500)

    def test_classifies_final_without_persisting_score_or_html(self) -> None:
        body = json.dumps({
            "Result": {
                "12345678": {
                    "Html": '<span class="label label-success">AC</span>',
                    "Score": 100,
                }
            },
        }).encode()
        parsed = target.parse_status_payload(body, "12345678")
        self.assertEqual(parsed, {
            "classification": "final",
            "remote_state": "FINAL",
            "status_label": "AC",
            "server_interval_ms": None,
        })
        self.assertNotIn("Html", parsed)
        self.assertNotIn("Score", parsed)

    def test_classifies_final_from_current_multi_root_fragment_shape(self) -> None:
        body = json.dumps({
            "Result": {
                "12345678": {
                    "Html": (
                        '<span class="label label-success">AC</span>'
                        '<span class="status-extra">1 ms</span>'
                        '<span class="status-extra">1024 KB</span>'
                    ),
                    "Score": 100,
                }
            },
        }).encode()
        parsed = target.parse_status_payload(body, "12345678")
        self.assertEqual(parsed["classification"], "final")
        self.assertEqual(parsed["status_label"], "AC")

    def test_rejects_multiple_final_verdict_candidates(self) -> None:
        parsed = target.parse_status_html(
            "<span>AC</span><span>WA</span>", "12345678"
        )
        self.assertEqual(parsed["classification"], "status_html_structure_changed")
        self.assertEqual(parsed["final_candidate_count"], 2)

    def test_rejects_other_or_multiple_submission_results(self) -> None:
        for result in (
            {"99999999": {"Html": "<span>AC</span>"}},
            {
                "12345678": {"Html": "<span>AC</span>"},
                "99999999": {"Html": "<span>WA</span>"},
            },
        ):
            with self.subTest(result_count=len(result)):
                parsed = target.parse_status_payload(
                    json.dumps({"Result": result}).encode(), "12345678"
                )
                self.assertEqual(parsed["classification"], "target_submission_not_unique")

    def test_rejects_pending_fragment_with_mismatched_data_id(self) -> None:
        parsed = target.parse_status_html(
            '<span class="waiting-judge" data-id="99999999">WJ</span>',
            "12345678",
        )
        self.assertEqual(parsed["classification"], "pending_submission_id_mismatch")


class ResultTest(unittest.TestCase):
    def test_pass_requires_real_pending_and_final_observations(self) -> None:
        state = {
            "contest_id": "abc300",
            "problem_id": "abc300_a",
            "recorded_at_utc": "2026-08-12T06:29:51.644Z",
            "submission_id": "12345678",
        }
        account = {"classification": "ready"}
        passed = target.build_result(
            "2026-08-12T07:00:00.000Z",
            state,
            account,
            [
                {
                    "classification": "pending",
                    "status_label": "WJ",
                    "finished_at_utc": "2026-08-12T07:00:01.000Z",
                },
                {
                    "classification": "final",
                    "status_label": "AC",
                    "finished_at_utc": "2026-08-12T07:00:03.000Z",
                },
            ],
            [2000, 2500],
        )
        self.assertEqual(passed["v04"], "pass")
        self.assertTrue(passed["pending_observed"])
        self.assertTrue(passed["final_observed"])
        self.assertTrue(passed["observation_sequence_valid"])
        self.assertEqual(passed["pending_to_final_gap_ms"], 2000)

        final_only = target.build_result(
            "2026-08-12T07:00:00.000Z",
            state,
            account,
            [{
                "classification": "final",
                "status_label": "AC",
                "finished_at_utc": "2026-08-12T07:00:03.000Z",
            }],
            [2000],
        )
        self.assertEqual(final_only["v04"], "incomplete")
        self.assertEqual(
            final_only["completion"], "final_observed_pending_not_observed"
        )

    def test_rejects_fixture_like_pending_and_final_without_valid_sequence(self) -> None:
        state = {
            "contest_id": "abc300",
            "problem_id": "abc300_a",
            "recorded_at_utc": "2026-08-12T06:29:51.644Z",
            "submission_id": "12345678",
        }
        result = target.build_result(
            "2026-08-12T07:00:00.000Z",
            state,
            {"classification": "ready"},
            [
                {"classification": "pending", "status_label": "WJ"},
                {"classification": "final", "status_label": "AC"},
            ],
            [2000, 2000],
        )
        self.assertEqual(result["v04"], "incomplete")
        self.assertEqual(
            result["completion"], "pending_and_final_sequence_unverified"
        )

    def test_excludes_actual_submission_id_from_persisted_result(self) -> None:
        state = {
            "contest_id": "abc300",
            "problem_id": "abc300_a",
            "recorded_at_utc": "2026-08-12T06:29:51.644Z",
            "submission_id": "12345678",
        }
        result = target.build_result(
            "2026-08-12T07:00:00.000Z",
            state,
            {"classification": "ready"},
            [{"classification": "final", "status_label": "AC"}],
            [2000],
        )
        serialized = json.dumps(result)
        self.assertNotIn("12345678", serialized)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            output = root / "result.json"
            target.write_json_exclusive(output, result)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)


class EntryPointSafetyTest(unittest.TestCase):
    def test_refuses_non_tty_before_reading_state_or_network(self) -> None:
        with mock.patch.object(target.sys.stdin, "isatty", return_value=False):
            with mock.patch.object(target.sys, "stderr", new=io.StringIO()):
                with mock.patch.object(target, "read_temporary_state") as state:
                    with mock.patch.object(target.v03, "bounded_request") as request:
                        self.assertEqual(target.main([
                            "--state", "/tmp/state.json",
                            "--json-output", "/tmp/result.json",
                        ]), 64)
        state.assert_not_called()
        request.assert_not_called()

    def test_gui_secret_input_does_not_place_secret_in_process_arguments(self) -> None:
        completed = mock.Mock(returncode=0, stdout="safe%3Avalue_123\n")
        with mock.patch.object(target.subprocess, "run", return_value=completed) as run:
            value = target.read_hidden_value(
                "秘密入力", macos_gui_input=True
            )
        self.assertEqual(value, "safe%3Avalue_123")
        arguments = run.call_args.args[0]
        self.assertNotIn("safe%3Avalue_123", json.dumps(arguments))
        self.assertTrue(run.call_args.kwargs["capture_output"])

    def test_gui_confirmation_uses_static_dialog_without_tty_input(self) -> None:
        completed = mock.Mock(returncode=0, stdout="button returned:Confirm\n")
        with mock.patch.object(target.subprocess, "run", return_value=completed) as run:
            confirmed = target.read_confirmation(
                "読み取り専用の確認", "RUN V-04", macos_gui_input=True
            )
        self.assertTrue(confirmed)
        self.assertEqual(run.call_args.args[0][0], "/usr/bin/osascript")

    def test_guidance_names_chrome_login_devtools_and_no_console_command(self) -> None:
        guidance = target.chrome_guidance_text()
        for expected in (
            "Google Chrome",
            "Safariは使用しません",
            "通常のGoogle Chromeプロファイル",
            "ログイン画面が出た場合",
            "⌥⌘I",
            "Application",
            "Storage > Cookies",
            "REVEL_SESSION",
            "ConsoleではコマンドやJavaScriptを一切実行しません",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, guidance)

    def test_launches_settings_with_google_chrome_and_never_safari(self) -> None:
        completed = mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch.object(target.subprocess, "run", return_value=completed) as run:
            observation, reason = target.launch_google_chrome_settings()
        self.assertIsNone(reason)
        arguments = run.call_args.args[0]
        self.assertEqual(arguments, [
            "/usr/bin/open",
            "-a",
            "Google Chrome",
            "https://atcoder.jp/settings",
        ])
        self.assertNotIn("Safari", arguments)
        self.assertNotIn("--remote-debugging-pipe", arguments)
        self.assertTrue(observation["settings_url_launch_succeeded"])
        self.assertEqual(observation["browser_profile_kind"], "normal-user-profile")
        self.assertFalse(observation["browser_cookie_database_read_by_helper"])

    def test_recommended_args_need_no_state_or_output_path(self) -> None:
        args = target.parse_args(["--discover-state", "--guided-chrome"])
        self.assertTrue(args.discover_state)
        self.assertTrue(args.guided_chrome)
        self.assertIsNone(args.state)
        self.assertIsNone(args.json_output)

    def test_guided_chrome_launch_failure_stops_before_http_client(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            state_path = root / "state.json"
            state_path.write_text(json.dumps(temporary_state()), encoding="utf-8")
            state_path.chmod(0o600)
            with mock.patch.object(target.platform, "system", return_value="Darwin"):
                with mock.patch.object(
                    target,
                    "launch_google_chrome_settings",
                    return_value=({}, "google_chrome_launch_failed"),
                ):
                    with mock.patch.object(target.v03, "bounded_request") as request:
                        with mock.patch.object(target.sys, "stderr", new=io.StringIO()):
                            self.assertEqual(target.main([
                                "--state",
                                str(state_path),
                                "--guided-chrome",
                            ]), 2)
        request.assert_not_called()

    def test_cookie_dialog_precedes_account_dialog_after_copy_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            state_path = root / "state.json"
            state_path.write_text(json.dumps(temporary_state()), encoding="utf-8")
            state_path.chmod(0o600)
            browser_setup = {
                "workflow": "guided-google-chrome-method-C",
                "settings_url_launch_succeeded": True,
            }
            with mock.patch.object(target.platform, "system", return_value="Darwin"):
                with mock.patch.object(
                    target,
                    "launch_google_chrome_settings",
                    return_value=(browser_setup, None),
                ):
                    with mock.patch.object(
                        target, "read_confirmation", return_value=True
                    ) as confirmation:
                        with mock.patch.object(
                            target, "read_cookie_value", return_value=None
                        ) as cookie_input:
                            with mock.patch.object(
                                target, "read_hidden_value"
                            ) as account_input:
                                with mock.patch.object(
                                    target.v03, "bounded_request"
                                ) as request:
                                    self.assertEqual(target.main([
                                        "--state",
                                        str(state_path),
                                        "--guided-chrome",
                                    ]), 2)
        cookie_input.assert_called_once_with(
            macos_gui_input=True,
            title="AlgoLoom V-04: 手順3/4 Cookie貼り付け",
        )
        self.assertEqual(
            [call.kwargs["title"] for call in confirmation.call_args_list],
            [
                "AlgoLoom V-04: 手順1/4 Chromeログイン",
                "AlgoLoom V-04: 手順2/4 Cookie確認",
            ],
        )
        account_input.assert_not_called()
        request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
