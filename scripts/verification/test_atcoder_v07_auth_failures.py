#!/usr/bin/env python3

import io
import json
import socket
import ssl
import stat
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import atcoder_v07_auth_failures as target


class CredentialClassificationTest(unittest.TestCase):
    def test_distinguishes_absent_and_explicitly_expired_credentials(self) -> None:
        observed_at = datetime(2026, 8, 13, tzinfo=timezone.utc)
        expired_at = datetime(2026, 8, 12, tzinfo=timezone.utc)
        absent = target.classify_credential_preflight(False, None, observed_at)
        expired = target.classify_credential_preflight(
            True, expired_at, observed_at
        )
        self.assertEqual(absent["classification"], "unauthenticated")
        self.assertFalse(absent["external_request_allowed"])
        self.assertEqual(expired["classification"], "expired")
        self.assertFalse(expired["external_request_allowed"])

    def test_does_not_invent_expiry_when_server_expiry_is_unknown(self) -> None:
        observed_at = datetime(2026, 8, 13, tzinfo=timezone.utc)
        result = target.classify_credential_preflight(True, None, observed_at)
        self.assertEqual(result["classification"], "indeterminate")
        self.assertEqual(
            result["detail"], "credential_present_without_server_expiry"
        )
        self.assertTrue(result["external_request_allowed"])

    def test_rejects_naive_expiry_timestamps(self) -> None:
        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            target.classify_credential_preflight(
                True,
                datetime(2026, 8, 12),
                datetime(2026, 8, 13, tzinfo=timezone.utc),
            )


class HttpClassificationTest(unittest.TestCase):
    def test_distinguishes_login_redirect_by_credential_context(self) -> None:
        headers = {"Location": "https://atcoder.jp/login?continue=%2Fsettings"}
        absent = target.classify_http_response(302, headers, b"", "absent")
        existing = target.classify_http_response(
            302, headers, b"", "present_unknown_expiry"
        )
        self.assertEqual(absent["classification"], "unauthenticated")
        self.assertEqual(existing["classification"], "unauthenticated_or_expired")

    def test_classifies_server_rejections_without_retry(self) -> None:
        forbidden = target.classify_http_response(403, {}, b"", "absent")
        limited = target.classify_http_response(
            429, {"Retry-After": "5"}, b"", "absent"
        )
        challenge = target.classify_http_response(
            403,
            {"CF-Mitigated": "challenge", "Content-Type": "text/html"},
            b"",
            "absent",
        )
        self.assertEqual(
            (forbidden["classification"], forbidden["detail"]),
            ("server_rejection", "http_forbidden"),
        )
        self.assertEqual(
            (limited["classification"], limited["detail"]),
            ("server_rejection", "rate_limited"),
        )
        self.assertTrue(limited["retry_after_present"])
        self.assertEqual(
            (challenge["classification"], challenge["detail"]),
            ("server_rejection", "cloudflare_challenge"),
        )

    def test_distinguishes_authenticated_shape_and_structure_change(self) -> None:
        valid = target.classify_http_response(
            200,
            {"Content-Type": "text/html; charset=utf-8"},
            b'var userScreenName = "fixture_user";',
            "absent",
        )
        missing = target.classify_http_response(
            200, {"Content-Type": "text/html"}, b"<html></html>", "absent"
        )
        ambiguous = target.classify_http_response(
            200,
            {"Content-Type": "text/html"},
            (
                b'var userScreenName = "fixture_one";'
                b'var userScreenName = "fixture_two";'
            ),
            "absent",
        )
        self.assertEqual(valid["classification"], "authenticated_control")
        self.assertEqual(
            (missing["classification"], missing["detail"]),
            ("page_structure_changed", "identity_missing"),
        )
        self.assertEqual(
            (ambiguous["classification"], ambiguous["detail"]),
            ("page_structure_changed", "identity_ambiguous"),
        )

    def test_does_not_follow_unallowlisted_redirect(self) -> None:
        result = target.classify_http_response(
            302, {"Location": "https://example.com/login"}, b"", "absent"
        )
        self.assertEqual(result["classification"], "unexpected_http_status")
        self.assertEqual(result["redirect_class"], "other_host")


class CommunicationClassificationTest(unittest.TestCase):
    def test_distinguishes_communication_failure_classes(self) -> None:
        cases = [
            (socket.gaierror("fixture"), "name_resolution_failure"),
            (ssl.SSLError("fixture"), "tls_failure"),
            (TimeoutError("fixture"), "timeout"),
            (ConnectionRefusedError("fixture"), "connection_failure"),
            (
                target.http.client.RemoteDisconnected("fixture"),
                "http_protocol_failure",
            ),
        ]
        for error, detail in cases:
            with self.subTest(detail=detail):
                result = target.classify_communication_error(error)
                self.assertEqual(result["classification"], "communication_failure")
                self.assertEqual(result["detail"], detail)


class LiveRequestSafetyTest(unittest.TestCase):
    class FakeSocket:
        def __init__(self) -> None:
            self.timeout = None

        def settimeout(self, timeout: float) -> None:
            self.timeout = timeout

    class FakeResponse:
        status = 302

        def getheader(self, name: str):
            values = {
                "Location": "https://atcoder.jp/login?continue=%2Fsettings",
                "Content-Type": "text/html; charset=utf-8",
            }
            return values.get(name)

        def read(self, _size: int) -> bytes:
            return b""

    class FakeConnection:
        def __init__(self) -> None:
            self.sock = LiveRequestSafetyTest.FakeSocket()
            self.requests = []
            self.closed = False

        def connect(self) -> None:
            return None

        def request(self, method: str, path: str, headers=None) -> None:
            self.requests.append((method, path, headers))

        def getresponse(self):
            return LiveRequestSafetyTest.FakeResponse()

        def close(self) -> None:
            self.closed = True

    def test_live_control_sends_one_cookie_free_get(self) -> None:
        connection = self.FakeConnection()
        result = target.project_live_unauthenticated(lambda: connection)
        self.assertEqual(result["classification"], "unauthenticated")
        self.assertEqual(len(connection.requests), 1)
        method, path, headers = connection.requests[0]
        self.assertEqual((method, path), ("GET", "/settings"))
        self.assertNotIn("Cookie", headers)
        self.assertTrue(connection.closed)
        self.assertFalse(result["cookie_sent"])
        self.assertEqual(result["automatic_retries"], 0)


class ResultAndEntryPointTest(unittest.TestCase):
    def test_local_matrix_covers_required_boundaries(self) -> None:
        matrix = target.run_local_matrix()
        self.assertEqual(matrix["verdict"], "pass")
        self.assertEqual(matrix["scenario_count"], 13)
        categories = {item["classification"] for item in matrix["scenarios"]}
        self.assertTrue(
            {
                "unauthenticated",
                "expired",
                "unauthenticated_or_expired",
                "server_rejection",
                "page_structure_changed",
                "communication_failure",
            }.issubset(categories)
        )
        self.assertEqual(matrix["external_request_count"], 0)

    def test_writes_exclusive_mode_600_json_without_secret_fields(self) -> None:
        result = target.build_result(
            "2026-08-13T00:00:00.000Z", target.run_local_matrix(), None
        )
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "result.json"
            target.write_json_result(output, result)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            persisted = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(persisted["verdict"], "pass")
            serialized = output.read_text(encoding="utf-8")
            self.assertNotIn("REVEL_SESSION=", serialized)
            self.assertNotIn("Cookie:", serialized)
            with self.assertRaisesRegex(ValueError, "already exists"):
                target.write_json_result(output, result)

    def test_refuses_live_mode_without_tty_before_network_access(self) -> None:
        with mock.patch.object(target.sys.stdin, "isatty", return_value=False):
            with mock.patch.object(target.sys, "stderr", new=io.StringIO()):
                with mock.patch.object(target, "project_live_unauthenticated") as request:
                    self.assertEqual(target.main(["--live-unauthenticated"]), 64)
        request.assert_not_called()

    def test_local_only_mode_does_not_request_confirmation_or_network(self) -> None:
        output = io.StringIO()
        with mock.patch.object(target.sys.stdin, "isatty", return_value=False):
            with mock.patch.object(target.sys, "stdout", new=output):
                with mock.patch.object(target, "project_live_unauthenticated") as request:
                    self.assertEqual(target.main([]), 0)
        request.assert_not_called()
        self.assertIn("13/13 pass", output.getvalue())


if __name__ == "__main__":
    unittest.main()
