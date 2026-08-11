import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SUBMISSION_BLOCKER_SOURCE,
  buildResult,
  classifySnapshot,
  sanitizeLoginSnapshot,
  sanitizeSnapshot,
  validateOutputPath,
  writeJsonExclusive,
} from "./atcoder_v03_turnstile_probe.mjs";

const HELPER_SOURCE = fs.readFileSync(
  new URL("./atcoder_v03_turnstile_probe.mjs", import.meta.url),
  "utf8",
);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readySnapshot(overrides = {}) {
  return {
    url_class: "target_submit",
    target_form_count: 1,
    target_form_method_post: true,
    csrf_field_count: 1,
    task_select_count: 1,
    target_task_selected: true,
    language_select_count: 1,
    source_code_field_count: 1,
    source_code_nonempty_count: 0,
    turnstile_widget_count: 1,
    turnstile_response_field_count: 1,
    document_turnstile_response_field_count: 1,
    turnstile_response_nonempty_count: 1,
    account_identity_present: true,
    submission_blocker_present: true,
    blocked_submit_event_count: 0,
    blocked_direct_submit_count: 0,
    token_value_returned: false,
    ...overrides,
  };
}

test("classifies a nonempty runtime response without returning its value", () => {
  const snapshot = sanitizeSnapshot(readySnapshot());
  assert.equal(classifySnapshot(snapshot), "turnstile_response_present");
  assert.equal(snapshot.token_value_returned, false);
  assert.equal(JSON.stringify(snapshot).includes("TOKEN"), false);
});

test("keeps empty and structurally ambiguous states separate", () => {
  assert.equal(
    classifySnapshot(
      sanitizeSnapshot(readySnapshot({ turnstile_response_nonempty_count: 0 })),
    ),
    "turnstile_response_empty",
  );
  assert.equal(
    classifySnapshot(
      sanitizeSnapshot(readySnapshot({ turnstile_response_field_count: 0 })),
    ),
    "turnstile_response_field_not_unique",
  );
  assert.equal(
    classifySnapshot(sanitizeSnapshot(readySnapshot({ target_form_count: 2 }))),
    "submit_page_structure_not_ready",
  );
  assert.equal(
    classifySnapshot(sanitizeSnapshot(readySnapshot({ url_class: "atcoder_login" }))),
    "target_page_not_ready",
  );
});

test("rejects unbounded or secret-bearing snapshot shapes", () => {
  assert.throws(
    () => sanitizeSnapshot(readySnapshot({ target_form_count: 101 })),
    /snapshot_count_invalid/,
  );
  assert.throws(
    () => sanitizeSnapshot(readySnapshot({ token_value_returned: true })),
    /snapshot_token_boundary_violated/,
  );
  assert.throws(
    () => sanitizeSnapshot({ ...readySnapshot(), token: "secret" }),
    /snapshot/,
  );
});

test("installs a form blocker without network interception or automation", () => {
  assert.match(SUBMISSION_BLOCKER_SOURCE, /preventDefault/);
  assert.match(SUBMISSION_BLOCKER_SOURCE, /HTMLFormElement\.prototype\.submit/);
  assert.doesNotMatch(SUBMISSION_BLOCKER_SOURCE, /Network\./);
  assert.doesNotMatch(SUBMISSION_BLOCKER_SOURCE, /\.click\s*\(/);
  assert.doesNotMatch(SUBMISSION_BLOCKER_SOURCE, /fetch\s*\(/);
});

test("keeps browser control outside cookie and network protocol domains", () => {
  assert.doesNotMatch(HELPER_SOURCE, /["']Network\./);
  assert.doesNotMatch(HELPER_SOURCE, /["'](?:Network|Storage)\.getCookies/);
  assert.doesNotMatch(HELPER_SOURCE, /--remote-debugging-port/);
  assert.ok(
    HELPER_SOURCE.indexOf('"Page.navigate", { url: LOGIN_URL }') <
      HELPER_SOURCE.indexOf('"Page.addScriptToEvaluateOnNewDocument"'),
  );
});

test("keeps login observation free of page injection and secret values", () => {
  const result = buildResult("2026-08-11T00:00:00.000Z");
  assert.equal(result.method.page_script_injected_during_login, false);
  assert.equal(result.method.login_navigation_count, 0);
  assert.deepEqual(
    sanitizeLoginSnapshot({
      atcoder_origin: true,
      login_page: false,
      account_identity_present: true,
    }),
    {
      atcoder_origin: true,
      login_page: false,
      account_identity_present: true,
    },
  );
  assert.throws(
    () =>
      sanitizeLoginSnapshot({
        atcoder_origin: true,
        login_page: false,
        account_identity_present: true,
        account_identity: "secret-user",
      }),
    /login_snapshot_invalid/,
  );
});

test("requires an owner-only output parent outside the repository", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "algoloom-probe-test-"));
  fs.chmodSync(root, 0o700);
  const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "algoloom-probe-shared-"));
  fs.chmodSync(sharedRoot, 0o755);
  try {
    const output = path.join(root, "result.json");
    const valid = validateOutputPath(output);
    assert.equal(valid.reason, null);
    const resolvedOutput = path.join(fs.realpathSync(root), "result.json");
    assert.equal(valid.path, resolvedOutput);
    writeJsonExclusive(resolvedOutput, { token_value_persisted: false });
    assert.equal(fs.statSync(resolvedOutput).mode & 0o777, 0o600);
    assert.equal(
      validateOutputPath(resolvedOutput).reason,
      "output_path_already_exists",
    );
    assert.equal(validateOutputPath("result.json").reason, "output_path_must_be_absolute");
    assert.equal(
      validateOutputPath(path.join(REPOSITORY_ROOT, "probe-result.json")).reason,
      "output_path_inside_repository",
    );
    assert.equal(
      validateOutputPath(path.join(sharedRoot, "result.json")).reason,
      "output_parent_not_owner_only",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: false });
    fs.rmSync(sharedRoot, { recursive: true, force: false });
  }
});
