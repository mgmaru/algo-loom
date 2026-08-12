#!/usr/bin/env python3

import io
import json
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import atcoder_v06_recovery as target


def temporary_state(submission_id: str = "12345678") -> dict:
    return {
        "schema_version": 1,
        "purpose": "temporary-state-for-V-04-and-V-06",
        "submission_alias": "submission-A",
        "contest_id": "abc300",
        "problem_id": "abc300_a",
        "recorded_at_utc": "2026-08-12T06:29:51.643Z",
        "submission_id": submission_id,
    }


def ready_account() -> dict:
    return {
        "classification": "ready",
        "identity_count": 1,
        "identity_matches_expected": True,
    }


def browser_setup() -> dict:
    return {
        "workflow": "guided-google-chrome-method-C-v06",
        "browser_cookie_database_read_by_helper": False,
        "clipboard_read_by_helper": False,
    }


class ResultTest(unittest.TestCase):
    def test_final_for_exact_target_passes_v06(self) -> None:
        result = target.build_result(
            "2026-08-13T01:00:00.000Z",
            temporary_state(),
            ready_account(),
            {
                "classification": "final",
                "remote_state": "FINAL",
                "status_label": "AC",
                "finished_at_utc": "2026-08-13T01:00:02.100Z",
            },
            2000,
            browser_setup(),
            "auto-discovered-single-owner-only-state",
        )
        self.assertEqual(result["v06"], "pass")
        self.assertEqual(result["recovered_remote_state"], "FINAL")
        self.assertEqual(result["recovered_final_status"], "AC")
        self.assertTrue(result["recovery"]["same_submission_reacquired"])
        self.assertFalse(result["recovery"]["submission_entrypoint_called"])
        self.assertEqual(result["request_count"], {
            "account_check_get": 1,
            "status_get": 1,
            "post": 0,
        })

    def test_pending_for_exact_target_also_recovers_without_resubmission(self) -> None:
        result = target.build_result(
            "2026-08-13T01:00:00.000Z",
            temporary_state(),
            ready_account(),
            {
                "classification": "pending",
                "remote_state": "VERDICT_PENDING",
                "status_label": "WJ",
            },
            2000,
            browser_setup(),
            "explicit-owner-only-state",
        )
        self.assertEqual(result["v06"], "pass")
        self.assertEqual(result["completion"], "same_submission_pending_reacquired")
        self.assertIsNone(result["recovered_final_status"])

    def test_ambiguous_or_failed_status_does_not_pass(self) -> None:
        result = target.build_result(
            "2026-08-13T01:00:00.000Z",
            temporary_state(),
            ready_account(),
            {"classification": "target_submission_not_unique"},
            2000,
            browser_setup(),
            "explicit-owner-only-state",
        )
        self.assertEqual(result["v06"], "fail")
        self.assertFalse(result["recovery"]["same_submission_reacquired"])

    def test_status_cannot_pass_without_a_verified_account(self) -> None:
        result = target.build_result(
            "2026-08-13T01:00:00.000Z",
            temporary_state(),
            {"classification": "identity_mismatch"},
            {"classification": "final", "remote_state": "FINAL", "status_label": "AC"},
            2000,
            browser_setup(),
            "explicit-owner-only-state",
        )
        self.assertEqual(result["v06"], "fail")
        self.assertFalse(result["recovery"]["same_submission_reacquired"])

    def test_result_excludes_actual_submission_id_and_is_owner_only(self) -> None:
        result = target.build_result(
            "2026-08-13T01:00:00.000Z",
            temporary_state("98765432"),
            ready_account(),
            {"classification": "final", "remote_state": "FINAL", "status_label": "WA"},
            2000,
            browser_setup(),
            "explicit-owner-only-state",
        )
        self.assertNotIn("98765432", json.dumps(result))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            output = root / "result.json"
            target.v04.write_json_exclusive(output, result)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)


class EntryPointSafetyTest(unittest.TestCase):
    def test_discovers_integrated_state_and_rejects_ambiguity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            integrated = root / "algoloom-v04-integrated-one"
            integrated.mkdir(mode=0o700)
            state_path = integrated / "v03-state.json"
            state_path.write_text(json.dumps(temporary_state()), encoding="utf-8")
            state_path.chmod(0o600)
            with mock.patch.object(target.tempfile, "gettempdir", return_value=directory):
                with mock.patch.object(target.Path, "glob", autospec=True) as glob:
                    def matches(path, pattern):
                        if path == root and pattern == target.STATE_PATTERNS[1]:
                            return iter([state_path])
                        return iter([])

                    glob.side_effect = matches
                    discovered, reason = target.discover_temporary_state_path()
            self.assertIsNone(reason)
            self.assertEqual(discovered, state_path.resolve())

            browser = root / "algoloom-v03-two"
            browser.mkdir(mode=0o700)
            second = browser / "v03-browser-state-2.json"
            second.write_text(json.dumps(temporary_state("87654321")), encoding="utf-8")
            second.chmod(0o600)
            with mock.patch.object(target.tempfile, "gettempdir", return_value=directory):
                with mock.patch.object(target.Path, "glob", autospec=True) as glob:
                    def ambiguous_matches(path, pattern):
                        if path != root:
                            return iter([])
                        if pattern == target.STATE_PATTERNS[0]:
                            return iter([second])
                        if pattern == target.STATE_PATTERNS[1]:
                            return iter([state_path])
                        return iter([])

                    glob.side_effect = ambiguous_matches
                    discovered, reason = target.discover_temporary_state_path()
            self.assertIsNone(discovered)
            self.assertEqual(reason, "multiple valid V-03 temporary states were discovered")

    def test_refuses_non_tty_before_state_or_network(self) -> None:
        with mock.patch.object(target.sys.stdin, "isatty", return_value=False):
            with mock.patch.object(target.sys, "stderr", new=io.StringIO()):
                with mock.patch.object(target, "select_state") as state:
                    with mock.patch.object(target.v03, "bounded_request") as request:
                        self.assertEqual(target.main(["--discover-state"]), 64)
        state.assert_not_called()
        request.assert_not_called()

    def test_recommended_arguments_have_no_source_or_submit_option(self) -> None:
        args = target.parse_args(["--discover-state", "--guided-chrome"])
        self.assertTrue(args.discover_state)
        self.assertTrue(args.guided_chrome)
        self.assertFalse(hasattr(args, "source"))
        self.assertFalse(hasattr(args, "submit"))

    def test_account_failure_never_requests_submission_status(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            state_path = root / "state.json"
            state_path.write_text(json.dumps(temporary_state()), encoding="utf-8")
            state_path.chmod(0o600)
            account_result = mock.Mock(session_cookie="session", finished_monotonic=1.0)
            with mock.patch.object(target.sys.stdin, "isatty", return_value=True):
                with mock.patch.object(target.v04, "read_confirmation", return_value=True):
                    with mock.patch.object(target.v04, "read_cookie_value", return_value="safe%3Avalue"):
                        with mock.patch.object(target.v04, "read_hidden_value", return_value="expected_user"):
                            with mock.patch.object(target.v03, "bounded_request", return_value=account_result):
                                with mock.patch.object(target.v03, "settings_observation", return_value={}):
                                    with mock.patch.object(target.v03, "classify_authenticated_html", return_value="identity_mismatch"):
                                        with mock.patch.object(target.v04, "bounded_status_request") as status:
                                            self.assertEqual(target.main([
                                                "--state", str(state_path),
                                            ]), 1)
        status.assert_not_called()

    def test_success_uses_one_account_get_and_one_exact_status_get(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            state_path = root / "state.json"
            state_path.write_text(json.dumps(temporary_state()), encoding="utf-8")
            state_path.chmod(0o600)
            output_path = root / "result.json"
            account_result = mock.Mock(
                session_cookie="updated_session", finished_monotonic=1.0
            )
            status_result = mock.Mock()
            with mock.patch.object(target.sys.stdin, "isatty", return_value=True):
                with mock.patch.object(target.v04, "read_confirmation", return_value=True):
                    with mock.patch.object(
                        target.v04, "read_cookie_value", return_value="safe%3Avalue"
                    ):
                        with mock.patch.object(
                            target.v04, "read_hidden_value", return_value="expected_user"
                        ):
                            with mock.patch.object(
                                target.v03, "bounded_request", return_value=account_result
                            ) as account_get:
                                with mock.patch.object(
                                    target.v03,
                                    "settings_observation",
                                    return_value=ready_account(),
                                ):
                                    with mock.patch.object(
                                        target.v03,
                                        "classify_authenticated_html",
                                        return_value="ready",
                                    ):
                                        with mock.patch.object(
                                            target.v04, "wait_for_interval", return_value=2000
                                        ):
                                            with mock.patch.object(
                                                target.v04,
                                                "bounded_status_request",
                                                return_value=status_result,
                                            ) as status_get:
                                                with mock.patch.object(
                                                    target.v04,
                                                    "classify_status_response",
                                                    return_value={
                                                        "classification": "final",
                                                        "remote_state": "FINAL",
                                                        "status_label": "AC",
                                                    },
                                                ):
                                                    self.assertEqual(target.main([
                                                        "--state", str(state_path),
                                                        "--json-output", str(output_path),
                                                    ]), 0)
        account_get.assert_called_once_with("GET", "/settings", "safe%3Avalue")
        status_get.assert_called_once_with("abc300", "12345678", "updated_session")


if __name__ == "__main__":
    unittest.main()
