#!/usr/bin/env python3

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import atcoder_v08_metrics as target


OBSERVED_AT = "2026-08-12T18:00:00.000Z"


class QuantityNormalizationTest(unittest.TestCase):
    def test_normalizes_time_to_milliseconds(self) -> None:
        cases = {
            "7 ms": (7, "ms"),
            "0.123 s": (123, "s"),
        }
        for raw, (value, source_unit) in cases.items():
            with self.subTest(raw=raw):
                normalized = target.normalized_execution_time(raw)
                self.assertEqual(normalized["status"], "available")
                self.assertEqual(normalized["value"], value)
                self.assertEqual(normalized["unit"], "ms")
                self.assertEqual(normalized["source_unit"], source_unit)

    def test_normalizes_decimal_and_binary_memory_to_bytes(self) -> None:
        cases = {
            "2 KB": (2000, "KB"),
            "2 KiB": (2048, "KiB"),
            "1.5 MB": (1_500_000, "MB"),
            "1.5 MiB": (1_572_864, "MiB"),
        }
        for raw, (value, source_unit) in cases.items():
            with self.subTest(raw=raw):
                normalized = target.normalized_memory(raw)
                self.assertEqual(normalized["status"], "available")
                self.assertEqual(normalized["value"], value)
                self.assertEqual(normalized["unit"], "byte")
                self.assertEqual(normalized["source_unit"], source_unit)

    def test_keeps_missing_and_unrecognized_values_nullable(self) -> None:
        for raw in ("", "-"):
            with self.subTest(raw=raw):
                normalized = target.normalized_memory(raw)
                self.assertEqual(normalized, {
                    "status": "not_returned",
                    "value": None,
                    "unit": "byte",
                })
        invalid = target.normalized_execution_time("0.0001 ms")
        self.assertEqual(invalid["status"], "unrecognized_format")
        self.assertIsNone(invalid["value"])


class SubmissionPageTest(unittest.TestCase):
    def parse(self, *rows: str) -> dict:
        return target.parse_submission_page(target.fixture_page(*rows), OBSERVED_AT)

    def test_extracts_verdict_and_normalized_live_shape(self) -> None:
        parsed = self.parse(target.fixture_row("7 ms", "3348 KiB"))
        self.assertEqual(parsed["classification"], "target_submission_observed")
        self.assertTrue(parsed["verdict_persisted"])
        self.assertEqual(parsed["verdict_observation"], {
            "observed_at_utc": OBSERVED_AT,
            "remote_state": "FINAL",
            "status_label": "AC",
            "source": "atcoder-own-submissions-filtered-page",
        })
        self.assertEqual(parsed["judge_execution_time"]["value"], 7)
        self.assertEqual(parsed["judge_execution_time"]["unit"], "ms")
        self.assertEqual(parsed["judge_memory"]["value"], 3_428_352)
        self.assertEqual(parsed["judge_memory"]["unit"], "byte")

    def test_preserves_final_verdict_when_metric_columns_are_absent(self) -> None:
        parsed = self.parse(target.fixture_row(None, None))
        self.assertEqual(parsed["classification"], "target_submission_observed")
        self.assertTrue(parsed["verdict_persisted"])
        self.assertEqual(parsed["verdict_observation"]["status_label"], "AC")
        self.assertEqual(parsed["judge_execution_time"]["status"], "not_returned")
        self.assertEqual(parsed["judge_memory"]["status"], "not_returned")
        self.assertIsNone(parsed["judge_memory"]["value"])

    def test_keeps_each_metric_independently_nullable(self) -> None:
        parsed = self.parse(target.fixture_row("-", "2 KiB"))
        self.assertEqual(parsed["classification"], "target_submission_observed")
        self.assertTrue(parsed["verdict_persisted"])
        self.assertEqual(parsed["judge_execution_time"]["status"], "not_returned")
        self.assertEqual(parsed["judge_memory"]["status"], "available")
        self.assertEqual(parsed["judge_memory"]["value"], 2048)

    def test_preserves_verdict_but_flags_unrecognized_metrics(self) -> None:
        parsed = self.parse(target.fixture_row("fast", "many"))
        self.assertEqual(
            parsed["classification"], "target_submission_metrics_unrecognized"
        )
        self.assertTrue(parsed["verdict_persisted"])
        self.assertEqual(parsed["verdict_observation"]["status_label"], "AC")
        self.assertEqual(
            parsed["judge_execution_time"]["status"], "unrecognized_format"
        )

    def test_requires_target_fingerprint_to_be_unique(self) -> None:
        parsed = self.parse(
            target.fixture_row("1 ms", "1 KiB", submission_id="12345678"),
            target.fixture_row("2 ms", "2 KiB", submission_id="12345679"),
        )
        self.assertEqual(parsed["classification"], "target_submission_not_unique")
        self.assertEqual(parsed["target_candidate_count"], 2)
        self.assertFalse(parsed["verdict_persisted"])

    def test_does_not_match_different_submission_fingerprint(self) -> None:
        row = target.fixture_row("1 ms", "1 KiB").replace(
            target.SUBMISSION_SECOND_JST,
            "2026-08-12 22:48:57+0900",
        )
        parsed = self.parse(row)
        self.assertEqual(parsed["classification"], "target_submission_not_found")
        self.assertFalse(parsed["verdict_persisted"])
        diagnostics = parsed["single_row_diagnostics"]
        self.assertFalse(diagnostics["submission_second_matches"])
        self.assertTrue(diagnostics["task_path_matches"])
        self.assertTrue(diagnostics["language_label_matches"])
        serialized = json.dumps(diagnostics)
        self.assertNotIn("2026-08-12", serialized)
        self.assertNotIn("abc300", serialized)
        self.assertNotIn("Python", serialized)

    def test_local_source_size_mismatch_is_observed_but_not_used_as_identity(self) -> None:
        row = target.fixture_row("1 ms", "1 KiB").replace(
            "110 Byte", "109 Byte"
        )
        parsed = self.parse(row)
        self.assertEqual(parsed["classification"], "target_submission_observed")
        self.assertFalse(parsed["recorded_source_size_matches_remote_display"])
        self.assertTrue(parsed["verdict_persisted"])

    def test_rejects_missing_or_multiple_tbody_sections(self) -> None:
        for html, count in (
            (b"<html></html>", 0),
            (b"<table><tbody></tbody></table><table><tbody></tbody></table>", 2),
        ):
            with self.subTest(count=count):
                parsed = target.parse_submission_page(html, OBSERVED_AT)
                self.assertEqual(
                    parsed["classification"], "submission_page_structure_changed"
                )
                self.assertEqual(parsed["tbody_count"], count)

    def test_excludes_submission_id_user_and_raw_html_from_projection(self) -> None:
        parsed = self.parse(
            target.fixture_row("1 ms", "1 KiB", submission_id="987654321")
        )
        serialized = json.dumps(parsed)
        self.assertNotIn("987654321", serialized)
        self.assertNotIn("fixture-user", serialized)
        self.assertNotIn("<td>", serialized)
        self.assertFalse(parsed["actual_submission_id_persisted"])


class FixtureMatrixTest(unittest.TestCase):
    def test_all_fixture_checks_pass_without_external_requests(self) -> None:
        result = target.run_local_fixture_checks()
        self.assertTrue(result["all_passed"])
        self.assertEqual(result["passed_count"], 4)
        self.assertEqual(result["fixture_count"], 4)
        self.assertEqual(result["external_requests"], 0)


class ResultTest(unittest.TestCase):
    def test_pass_requires_ready_account_live_projection_and_fixtures(self) -> None:
        local = target.run_local_fixture_checks()
        submission = target.parse_submission_page(
            target.fixture_page(target.fixture_row("7 ms", "3348 KiB")),
            OBSERVED_AT,
        )
        result = target.build_result(
            "2026-08-12T17:59:00.000Z",
            local,
            {"classification": "ready"},
            submission,
            2000,
            {"workflow": "fixture"},
        )
        self.assertEqual(result["v08"], "pass")
        self.assertTrue(result["verdict_storage_continues_without_metrics"])
        self.assertEqual(result["request_count"]["post"], 0)
        self.assertEqual(result["method"]["pages_requested"], 1)
        self.assertFalse(result["method"]["pagination_followed"])

    def test_unrecognized_live_metrics_fail_without_losing_verdict(self) -> None:
        submission = target.parse_submission_page(
            target.fixture_page(target.fixture_row("fast", "many")),
            OBSERVED_AT,
        )
        result = target.build_result(
            "2026-08-12T17:59:00.000Z",
            target.run_local_fixture_checks(),
            {"classification": "ready"},
            submission,
            2000,
            {"workflow": "fixture"},
        )
        self.assertEqual(result["v08"], "fail")
        self.assertTrue(result["submission_observation"]["verdict_persisted"])

    def test_serialized_result_has_no_actual_submission_id(self) -> None:
        submission = target.parse_submission_page(
            target.fixture_page(
                target.fixture_row("7 ms", "3348 KiB", submission_id="987654321")
            ),
            OBSERVED_AT,
        )
        result = target.build_result(
            "2026-08-12T17:59:00.000Z",
            target.run_local_fixture_checks(),
            {"classification": "ready"},
            submission,
            2000,
            {"workflow": "fixture"},
        )
        self.assertNotIn("987654321", json.dumps(result))
        self.assertFalse(
            result["secret_persistence"]["actual_submission_id_written_to_result"]
        )


class EntryPointSafetyTest(unittest.TestCase):
    def test_non_live_mode_runs_only_local_checks(self) -> None:
        with mock.patch.object(target.v03, "bounded_request") as request:
            with mock.patch.object(target.sys, "stdout", new=io.StringIO()):
                self.assertEqual(target.main([]), 0)
        request.assert_not_called()

    def test_live_requires_output_before_network(self) -> None:
        with mock.patch.object(target.v03, "bounded_request") as request:
            with mock.patch.object(target.sys, "stderr", new=io.StringIO()):
                self.assertEqual(target.main(["--live"]), 64)
        request.assert_not_called()

    def test_live_refuses_non_tty_before_network(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "result.json"
            with mock.patch.object(target.sys.stdin, "isatty", return_value=False):
                with mock.patch.object(target.sys, "stderr", new=io.StringIO()):
                    with mock.patch.object(target.v03, "bounded_request") as request:
                        self.assertEqual(
                            target.main(["--live", "--json-output", str(output)]),
                            64,
                        )
        request.assert_not_called()

    def test_fixed_request_is_one_filtered_page(self) -> None:
        path = target.submissions_path()
        self.assertTrue(path.startswith(target.SUBMISSIONS_PATH + "?"))
        self.assertIn("f.Task=abc300_a", path)
        self.assertIn("f.Language=6082", path)
        self.assertIn("f.Status=AC", path)
        self.assertNotIn("page=", path)


if __name__ == "__main__":
    unittest.main()
