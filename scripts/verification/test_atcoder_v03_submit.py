import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import atcoder_v03_submit as target


def submit_form_html(
    *,
    include_task=True,
    csrf_values=("csrf-value",),
    language_selects=None,
):
    if language_selects is None:
        language_selects = [
            (
                "select-lang-abc300_a",
                [
                    ("5078", "Python (CPython 3.13.3)"),
                    ("5079", "Python (PyPy 3.11-v7.3.19)"),
                ],
            )
        ]
    csrf = "".join(
        '<input type="hidden" name="csrf_token" value="{}">'.format(value)
        for value in csrf_values
    )
    task_option = (
        '<option value="abc300_a">A</option>'
        if include_task
        else '<option value="abc300_b">B</option>'
    )
    selects = []
    for select_id, options in language_selects:
        option_html = "".join(
            '<option value="{}">{}</option>'.format(value, text)
            for value, text in options
        )
        selects.append(
            '<div id="container-{}"><select id="{}" '
            'name="data.LanguageId">{}</select></div>'.format(
                select_id, select_id, option_html
            )
        )
    return (
        '<html><body><form method="post" action="/contests/abc300/submit">'
        + csrf
        + '<select name="data.TaskScreenName">'
        + task_option
        + "</select>"
        + "".join(selects)
        + "</form></body></html>"
    ).encode()


class SubmitFormParserTest(unittest.TestCase):
    def test_resolves_one_problem_specific_cpython(self):
        parsed = target.parse_submit_form(submit_form_html())

        self.assertEqual(parsed["classification"], "ready")
        self.assertEqual(parsed["target_form_count"], 1)
        self.assertEqual(parsed["csrf_token_count"], 1)
        self.assertTrue(parsed["target_task_present"])
        self.assertEqual(parsed["canonical_language_candidate_count"], 1)
        self.assertEqual(
            parsed["resolved_language"],
            {
                "atcoder_language_id": "5078",
                "display_name": "Python (CPython 3.13.3)",
                "interpreter": "CPython",
                "version": "3.13.3",
            },
        )
        self.assertEqual(parsed["_csrf_token"], "csrf-value")

    def test_accepts_one_generic_language_select(self):
        html = submit_form_html(
            language_selects=[
                (
                    "select-lang",
                    [("5000", "Python (CPython 3.12.9)")],
                )
            ]
        )

        parsed = target.parse_submit_form(html)

        self.assertEqual(parsed["classification"], "ready")
        self.assertEqual(parsed["language_selection_method"], "single_select")

    def test_rejects_multiple_non_target_language_selects(self):
        html = submit_form_html(
            language_selects=[
                ("select-lang-abc300_b", [("1", "Python (CPython 3.12.9)")]),
                ("select-lang-abc300_c", [("1", "Python (CPython 3.12.9)")]),
            ]
        )

        parsed = target.parse_submit_form(html)

        self.assertEqual(parsed["classification"], "submit_page_structure_changed")
        self.assertEqual(
            parsed["language_selection_method"], "target_language_select_not_unique"
        )

    def test_rejects_multiple_cpython_candidates(self):
        html = submit_form_html(
            language_selects=[
                (
                    "select-lang-abc300_a",
                    [
                        ("1", "Python (CPython 3.12.9)"),
                        ("2", "Python (CPython 3.13.3)"),
                    ],
                )
            ]
        )

        parsed = target.parse_submit_form(html)

        self.assertEqual(parsed["classification"], "submit_page_structure_changed")
        self.assertEqual(parsed["canonical_language_candidate_count"], 2)
        self.assertIsNone(parsed["resolved_language"])

    def test_rejects_missing_task_or_csrf(self):
        missing_task = target.parse_submit_form(
            submit_form_html(include_task=False)
        )
        missing_csrf = target.parse_submit_form(
            submit_form_html(csrf_values=())
        )

        self.assertEqual(
            missing_task["classification"], "submit_page_structure_changed"
        )
        self.assertEqual(
            missing_csrf["classification"], "submit_page_structure_changed"
        )

    def test_public_projection_removes_csrf(self):
        parsed = target.parse_submit_form(submit_form_html())

        public = target.public_form_observation(parsed)

        self.assertNotIn("_csrf_token", public)
        self.assertNotIn("csrf-value", json.dumps(public))


class CookieUpdateTest(unittest.TestCase):
    def test_keeps_current_cookie_without_revel_directive(self):
        value, count, updated, error = target.parse_session_cookie_headers(
            ["OTHER=value; Path=/"], "current"
        )

        self.assertEqual(value, "current")
        self.assertEqual(count, 0)
        self.assertFalse(updated)
        self.assertIsNone(error)

    def test_updates_one_valid_revel_cookie(self):
        value, count, updated, error = target.parse_session_cookie_headers(
            ["REVEL_SESSION=new-value; Path=/; Secure; HttpOnly"], "current"
        )

        self.assertEqual(value, "new-value")
        self.assertEqual(count, 1)
        self.assertTrue(updated)
        self.assertIsNone(error)

    def test_rejects_conflicting_revel_updates(self):
        value, count, updated, error = target.parse_session_cookie_headers(
            [
                "REVEL_SESSION=first; Path=/",
                "REVEL_SESSION=second; Path=/",
            ],
            "current",
        )

        self.assertEqual(value, "current")
        self.assertEqual(count, 2)
        self.assertFalse(updated)
        self.assertEqual(error, "conflicting_session_updates")

    def test_rejects_deleted_revel_cookie(self):
        value, count, updated, error = target.parse_session_cookie_headers(
            ["REVEL_SESSION=; Path=/; Max-Age=0"], "current"
        )

        self.assertEqual(value, "current")
        self.assertEqual(count, 1)
        self.assertFalse(updated)
        self.assertEqual(error, "invalid_session_update")


class SubmissionIdParserTest(unittest.TestCase):
    def test_extracts_target_problem_rows_in_order(self):
        html = b"""
        <table><tbody>
          <tr><td><a href="/contests/abc300/tasks/abc300_a">A</a></td>
              <td><a href="/contests/abc300/submissions/9002">detail</a></td></tr>
          <tr><td><a href="/contests/abc300/tasks/abc300_b">B</a></td>
              <td><a href="/contests/abc300/submissions/9001">detail</a></td></tr>
          <tr><td><a href="/contests/abc300/tasks/abc300_a">A</a></td>
              <td><a href="/contests/abc300/submissions/9000">detail</a></td></tr>
        </tbody></table>
        """

        self.assertEqual(target.parse_submission_ids(html), ["9002", "9000"])

    def test_does_not_extract_navigation_link(self):
        html = b'<a href="/contests/abc300/submissions/9999">outside row</a>'

        self.assertEqual(target.parse_submission_ids(html), [])

    def test_classifies_allowlisted_locations(self):
        self.assertEqual(
            target.classify_location("/contests/abc300/submissions/me"),
            "own_submissions",
        )
        self.assertEqual(
            target.classify_location("https://atcoder.jp/contests/abc300/submissions/42"),
            "submission_detail",
        )
        self.assertEqual(
            target.extract_direct_submission_id(
                "https://atcoder.jp/contests/abc300/submissions/42"
            ),
            "42",
        )
        self.assertIsNone(
            target.extract_direct_submission_id(
                "https://example.com/contests/abc300/submissions/42"
            )
        )


class FileBoundaryTest(unittest.TestCase):
    def test_reads_external_utf8_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "main.py"
            path.write_bytes(b"print(1)\n")

            data, error = target.read_source(path.resolve())

            self.assertEqual(data, b"print(1)\n")
            self.assertIsNone(error)

    def test_rejects_source_inside_repository(self):
        path = Path(__file__).resolve()

        data, error = target.read_source(path)

        self.assertIsNone(data)
        self.assertEqual(error, "source file must be outside the repository")

    def test_writes_owner_only_json_exclusively(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o700)
            path = Path(directory) / "result.json"

            target.write_json_exclusive(path, {"value": 1})

            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(json.loads(path.read_text()), {"value": 1})
            with self.assertRaises(ValueError):
                target.write_json_exclusive(path, {"value": 2})

    def test_rejects_output_parent_visible_to_group(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o755)
            path = Path(directory) / "result.json"

            resolved, error = target.validate_output_path(path)

            self.assertIsNone(resolved)
            self.assertEqual(error, "output parent directory must be owner-only")


class MarkerTest(unittest.TestCase):
    def test_detects_cloudflare_markers(self):
        self.assertTrue(target.contains_challenge_marker(b"<div class='cf-turnstile'>"))
        self.assertFalse(target.contains_challenge_marker(b"<html>normal page</html>"))


def fake_http_result(
    *,
    method="GET",
    status=200,
    redirect_class="none",
    body=b"",
    cookie="cookie-value",
    direct_id=None,
):
    return target.HttpResult(
        observation={
            "started_at_utc": "2026-08-11T00:00:00.000Z",
            "finished_at_utc": "2026-08-11T00:00:00.010Z",
            "duration_ms": 10,
            "method": method,
            "target_class": "test",
            "http_status": status,
            "redirect_class": redirect_class,
            "content_type_class": "text/html",
            "set_cookie_header_present": False,
            "set_cookie_header_count": 0,
            "session_cookie_directive_count": 0,
            "session_cookie_updated": False,
            "session_cookie_update_error": None,
            "response_body_oversized": False,
            "challenge_marker_present": False,
            "direct_submission_id_present": direct_id is not None,
        },
        body=body,
        session_cookie=cookie,
        finished_monotonic=1.0,
        direct_submission_id=direct_id,
    )


class EntryPointSafetyTest(unittest.TestCase):
    def setUp(self):
        self.account_body = b'var userScreenName = "expected";'
        self.submit_body = self.account_body + submit_form_html()
        self.baseline_body = self.account_body + b"<table><tbody></tbody></table>"
        self.after_body = self.account_body + b"""
        <table><tbody><tr>
          <td><a href="/contests/abc300/tasks/abc300_a">A</a></td>
          <td><a href="/contests/abc300/submissions/100">detail</a></td>
        </tr></tbody></table>
        """
        self.empty = fake_http_result(
            status=302, redirect_class="atcoder_login", body=b"", cookie=None
        )
        self.account = fake_http_result(body=self.account_body)
        self.form = fake_http_result(body=self.submit_body)
        self.baseline = fake_http_result(body=self.baseline_body)

    def common_patches(self):
        return (
            mock.patch.object(target.sys.stdin, "isatty", return_value=True),
            mock.patch.object(target, "read_source", return_value=(b"print(1)\n", None)),
            mock.patch.object(
                target,
                "validate_output_path",
                side_effect=lambda path: (path, None),
            ),
            mock.patch.object(target, "read_cookie_value", return_value=("cookie-value", 0)),
            mock.patch.object(target, "wait_after", return_value=0),
        )

    def test_no_post_occurs_without_exact_submission_approval(self):
        calls = []

        def request(method, path, cookie, **kwargs):
            calls.append((method, path))
            return [self.empty, self.account, self.form, self.baseline][len(calls) - 1]

        patches = self.common_patches()
        with patches[0], patches[1], patches[2], patches[3], patches[4], mock.patch.object(
            target, "bounded_request", side_effect=request
        ), mock.patch.object(
            target.getpass, "getpass", return_value="expected"
        ), mock.patch(
            "builtins.input", side_effect=["CONFIRMED", "RUN_READ_GATE", "NO"]
        ), mock.patch.object(
            target, "stop_with_result", return_value=2
        ):
            code = target.main(
                [
                    "--source",
                    "/tmp/source.py",
                    "--json-output",
                    "/tmp/result.json",
                    "--state-output",
                    "/tmp/state.json",
                ]
            )

        self.assertEqual(code, 2)
        self.assertEqual([method for method, _ in calls], ["GET"] * 4)
        self.assertNotIn("POST", [method for method, _ in calls])

    def test_exact_approval_triggers_only_one_post(self):
        submitted = fake_http_result(
            method="POST", status=302, redirect_class="own_submissions", body=b""
        )
        after = fake_http_result(body=self.after_body)
        responses = [
            self.empty,
            self.account,
            self.form,
            self.baseline,
            submitted,
            after,
        ]
        calls = []

        def request(method, path, cookie, **kwargs):
            calls.append((method, path))
            return responses[len(calls) - 1]

        patches = self.common_patches()
        with patches[0], patches[1], patches[2], patches[3], patches[4], mock.patch.object(
            target, "bounded_request", side_effect=request
        ), mock.patch.object(
            target.getpass, "getpass", return_value="expected"
        ), mock.patch(
            "builtins.input",
            side_effect=["CONFIRMED", "RUN_READ_GATE", "SUBMIT abc300_a"],
        ), mock.patch.object(
            target, "write_json_exclusive"
        ) as write_state, mock.patch.object(
            target, "save_result"
        ) as save_result:
            code = target.main(
                [
                    "--source",
                    "/tmp/source.py",
                    "--json-output",
                    "/tmp/result.json",
                    "--state-output",
                    "/tmp/state.json",
                ]
            )

        self.assertEqual(code, 0)
        self.assertEqual([method for method, _ in calls], ["GET"] * 4 + ["POST", "GET"])
        self.assertEqual([method for method, _ in calls].count("POST"), 1)
        write_state.assert_called_once()
        saved_state = write_state.call_args.args[1]
        self.assertEqual(saved_state["submission_id"], "100")
        save_result.assert_called_once()


if __name__ == "__main__":
    unittest.main()
