#!/usr/bin/env python3

import json
import stat
import tempfile
import unittest
from pathlib import Path

import atcoder_v04_integrated as target


def temporary_state() -> dict:
    return {
        "schema_version": 1,
        "purpose": "temporary-state-for-V-04-and-V-06",
        "submission_alias": "submission-A",
        "contest_id": "abc300",
        "problem_id": "abc300_a",
        "recorded_at_utc": "2026-08-12T08:00:00.000Z",
        "submission_id": "12345678",
    }


class FakeRunningProcess:
    def __init__(self) -> None:
        self.poll_calls = 0

    def poll(self):
        self.poll_calls += 1
        return None


class GuidanceTest(unittest.TestCase):
    def test_guidance_distinguishes_browsers_and_numbers_manual_actions(self) -> None:
        warning = target.initial_warning_text()
        guidance = target.session_preparation_text() + target.v03_manual_guidance_text()
        for expected in (
            "新しい提出を1件",
            "検証計画を更新",
            "通常のGoogle Chrome",
            "空の専用Chrome",
            "デベロッパー モード",
            "パッケージ化されていない拡張機能を読み込む",
            "Diagnostics passed",
            "プレーン欄→Ace→プレーン欄",
            "Turnstileを自分で完了",
            "SUBMIT abc300_a",
            "AtCoder本体の提出ボタンを1回だけ押す",
            "フェーズ3のV-04が自動的に始まります",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, warning + guidance)


class PathTest(unittest.TestCase):
    def test_accepts_only_owner_only_external_utf8_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            source = root / "source.py"
            source.write_text("print(0)\n", encoding="utf-8")
            source.chmod(0o600)
            accepted, reason = target.validate_source_path(source)
            self.assertIsNone(reason)
            self.assertEqual(accepted, source.resolve())
            source.chmod(0o644)
            accepted, reason = target.validate_source_path(source)
            self.assertIsNone(accepted)
            self.assertEqual(reason, "source file must be owner-only")

    def test_creates_separate_owner_only_outputs(self) -> None:
        paths = target.create_run_paths()
        try:
            self.assertEqual(stat.S_IMODE(paths.directory.stat().st_mode), 0o700)
            self.assertEqual(
                len({paths.v03_result, paths.v03_state, paths.v04_result}), 3
            )
            self.assertTrue(all(path.parent == paths.directory for path in (
                paths.v03_result, paths.v03_state, paths.v04_result
            )))
            self.assertTrue(all(not path.exists() for path in (
                paths.v03_result, paths.v03_state, paths.v04_result
            )))
        finally:
            paths.directory.rmdir()

    def test_v03_command_uses_integrated_mode_without_secret_arguments(self) -> None:
        paths = target.RunPaths(
            Path("/private/tmp/run"),
            Path("/private/tmp/run/v03-result.json"),
            Path("/private/tmp/run/v03-state.json"),
            Path("/private/tmp/run/v04-result.json"),
        )
        command = target.build_v03_command(
            "/usr/local/bin/node", Path("/private/tmp/source.py"), paths
        )
        self.assertIn("--integrated-v04", command)
        self.assertNotIn("REVEL_SESSION", json.dumps(command))
        self.assertNotIn("account", json.dumps(command).lower())


class HandoffTest(unittest.TestCase):
    def test_reads_valid_state_before_waiting_for_v03_process_exit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            state_path = root / "v03-state.json"
            state_path.write_text(json.dumps(temporary_state()), encoding="utf-8")
            state_path.chmod(0o600)
            process = FakeRunningProcess()
            state, reason = target.wait_for_v03_state(process, state_path)
        self.assertIsNone(reason)
        self.assertEqual(state["submission_id"], "12345678")
        self.assertEqual(process.poll_calls, 0)

    def test_calculates_state_to_first_status_handoff_delay(self) -> None:
        gap = target.state_to_first_status_gap_ms(
            {
                "recorded_at_utc": "2026-08-12T08:00:00.000Z",
                "submission_id": "12345678",
            },
            [{"started_at_utc": "2026-08-12T08:00:00.125Z"}],
        )
        self.assertEqual(gap, 125)


if __name__ == "__main__":
    unittest.main()
