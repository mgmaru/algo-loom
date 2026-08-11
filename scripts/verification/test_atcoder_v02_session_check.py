#!/usr/bin/env python3

import io
import json
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import atcoder_v02_session_check as target


class CookieValidationTest(unittest.TestCase):
    def test_accepts_visible_value_without_header_delimiters(self) -> None:
        self.assertIsNone(target.validate_cookie_value("safe%3Avalue_123"))

    def test_rejects_unsafe_or_ambiguous_forms(self) -> None:
        cases = {
            "": "empty",
            "REVEL_SESSION=value": "name_prefix_included",
            " value": "surrounding_whitespace",
            "value ": "surrounding_whitespace",
            '"value"': "quote_included",
            "value\n": "surrounding_whitespace",
            "value;other": "cookie_header_delimiter",
            "x" * 16385: "too_large",
        }
        for value, reason in cases.items():
            with self.subTest(reason=reason):
                self.assertEqual(target.validate_cookie_value(value), reason)


class ResponseClassificationTest(unittest.TestCase):
    def test_extracts_only_unique_valid_identities(self) -> None:
        body = (
            b'var userScreenName = "first_user";'
            b'var userScreenName = "second_user";'
            b'var userScreenName = "first_user";'
            b'var userScreenName = "";'
            b'var userScreenName = null;'
        )
        self.assertEqual(
            target.extract_identities(body), ["first_user", "second_user"]
        )

    def test_classifies_redirects_and_response_shapes(self) -> None:
        self.assertEqual(
            target.classify_location("https://atcoder.jp/login?continue=x"),
            "atcoder_login",
        )
        self.assertEqual(
            target.classify_location("https://example.com/login"), "other_host"
        )
        self.assertEqual(
            target.classify_response(302, "atcoder_login", 0), "unauthenticated"
        )
        self.assertEqual(
            target.classify_response(200, "none", 1), "authenticated_candidate"
        )
        self.assertEqual(
            target.classify_response(200, "none", 0), "page_structure_changed"
        )
        self.assertEqual(
            target.classify_response(200, "none", 2), "page_structure_changed"
        )
        self.assertEqual(
            target.classify_response(403, "none", 0), "server_rejection"
        )


class ResultPersistenceTest(unittest.TestCase):
    def test_writes_exclusive_mode_600_json_without_secret_fields(self) -> None:
        result = target.build_result(
            "2026-08-11T00:00:00.000Z",
            True,
            0,
            {"classification": "unauthenticated"},
            {
                "classification": "authenticated_candidate",
                "identity_count": 1,
                "identity_matches_expected": True,
            },
        )
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "result.json"
            target.write_json_result(output, result)
            mode = stat.S_IMODE(output.stat().st_mode)
            self.assertEqual(mode, 0o600)
            persisted = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(persisted["verdict"], "pass")
            serialized = output.read_text(encoding="utf-8")
            self.assertNotIn("expected_user", serialized)
            self.assertNotIn("safe%3Avalue_123", serialized)
            with self.assertRaisesRegex(ValueError, "already exists"):
                target.write_json_result(output, result)

    def test_rejects_relative_and_repository_output_paths(self) -> None:
        relative, relative_reason = target.validate_json_output_path(
            Path("result.json")
        )
        self.assertIsNone(relative)
        self.assertEqual(relative_reason, "JSON output path must be absolute")

        repository_output = target.repository_root() / "result.json"
        resolved, repository_reason = target.validate_json_output_path(
            repository_output
        )
        self.assertIsNone(resolved)
        self.assertEqual(
            repository_reason, "JSON output path must be outside the repository"
        )


class EntryPointSafetyTest(unittest.TestCase):
    def test_refuses_non_tty_before_prompting_or_network_access(self) -> None:
        with mock.patch.object(target.sys.stdin, "isatty", return_value=False):
            with mock.patch.object(target.sys, "stderr", new=io.StringIO()):
                with mock.patch.object(target, "read_confirmation") as confirmation:
                    with mock.patch.object(target, "project_response") as request:
                        self.assertEqual(target.main([]), 64)
        confirmation.assert_not_called()
        request.assert_not_called()

    def test_live_flow_uses_two_allowlisted_requests_without_printing_secrets(self) -> None:
        empty = {
            "classification": "unauthenticated",
            "http_status": 302,
            "redirect_class": "atcoder_login",
            "identity_count": 0,
            "identity_matches_expected": None,
            "duration_ms": 1,
        }
        session = {
            "classification": "authenticated_candidate",
            "http_status": 200,
            "redirect_class": "none",
            "identity_count": 1,
            "identity_matches_expected": True,
            "duration_ms": 1,
        }
        output = io.StringIO()
        with mock.patch.object(target.sys.stdin, "isatty", return_value=True):
            with mock.patch.object(target.sys, "stdout", new=output):
                with mock.patch.object(
                    target, "read_confirmation", side_effect=[True, True]
                ):
                    with mock.patch.object(
                        target.getpass,
                        "getpass",
                        side_effect=["expected_user", "safe%3Avalue_123"],
                    ):
                        with mock.patch.object(
                            target,
                            "project_response",
                            side_effect=[empty, session],
                        ) as request:
                            with mock.patch.object(target.time, "sleep"):
                                self.assertEqual(target.main([]), 0)
        self.assertEqual(
            request.call_args_list,
            [
                mock.call(None, "expected_user"),
                mock.call("safe%3Avalue_123", "expected_user"),
            ],
        )
        self.assertNotIn("expected_user", output.getvalue())
        self.assertNotIn("safe%3Avalue_123", output.getvalue())

    def test_does_not_send_session_when_empty_control_is_unexpected(self) -> None:
        rejected = {
            "classification": "server_rejection",
            "http_status": 429,
            "redirect_class": "none",
            "duration_ms": 1,
        }
        output = io.StringIO()
        with mock.patch.object(target.sys.stdin, "isatty", return_value=True):
            with mock.patch.object(target.sys, "stdout", new=output):
                with mock.patch.object(
                    target, "read_confirmation", side_effect=[True, True]
                ):
                    with mock.patch.object(
                        target.getpass,
                        "getpass",
                        side_effect=["expected_user", "safe%3Avalue_123"],
                    ):
                        with mock.patch.object(
                            target, "project_response", return_value=rejected
                        ) as request:
                            self.assertEqual(target.main([]), 1)
        request.assert_called_once_with(None, "expected_user")
        self.assertIn("方式Cのセッションは送信せず", output.getvalue())
        self.assertNotIn("expected_user", output.getvalue())
        self.assertNotIn("safe%3Avalue_123", output.getvalue())


if __name__ == "__main__":
    unittest.main()
