import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  VerificationState,
  buildChromeArguments,
  buildResult,
  sanitizeEvent,
  validateOutputPath,
  validateSourcePath,
  writeJsonExclusive,
} from "./atcoder_v03_browser_submit.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const EXTENSION_DIRECTORY = path.join(
  SCRIPT_DIRECTORY,
  "atcoder_v03_browser_extension",
);
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(EXTENSION_DIRECTORY, "manifest.json"), "utf8"),
);
const CONTENT_SOURCE = fs.readFileSync(
  path.join(EXTENSION_DIRECTORY, "atcoder.js"),
  "utf8",
);
const WORKER_SOURCE = fs.readFileSync(
  path.join(EXTENSION_DIRECTORY, "service_worker.js"),
  "utf8",
);
const SOURCE_GUARD_SOURCE = fs.readFileSync(
  path.join(EXTENSION_DIRECTORY, "source_guard.js"),
  "utf8",
);
const SOURCE_GUARD = require(
  path.join(EXTENSION_DIRECTORY, "source_guard.js"),
);

function formPrepared(sourceByteCount = 9) {
  return {
    type: "form_prepared",
    identity_count: 1,
    identity_matches_expected: true,
    navigator_webdriver: false,
    target_form_count: 1,
    target_form_method_post: true,
    csrf_field_count: 1,
    target_task_count: 1,
    source_field_count: 1,
    source_editor_count: 1,
    source_editor_toggle_count: 1,
    plain_editor_mode: true,
    editor_round_trip_verified: true,
    canonical_language_candidate_count: 1,
    resolved_language: {
      atcoder_language_id: "5078",
      display_name: "Python (CPython 3.13.7)",
      interpreter: "CPython",
      version: "3.13.7",
    },
    source_byte_count: sourceByteCount,
    baseline_submission_count: 0,
    turnstile_widget_count: 1,
    turnstile_response_field_count: 1,
    turnstile_token_read: false,
  };
}

function approvalGranted() {
  return {
    type: "approval_granted",
    source_ownership_confirmed: true,
    unique_submission_confirmed: true,
    turnstile_completed_by_user: true,
    ai_policy_presented: true,
    no_automatic_resend_confirmed: true,
  };
}

test("launches visible Chrome for manual extension loading without a remote-control flag", () => {
  const args = buildChromeArguments(
    "/private/tmp/profile",
    "http://127.0.0.1:12345/bootstrap#token=local",
  );
  assert.ok(args.some((value) => value.startsWith("--user-data-dir=")));
  assert.ok(args.includes("chrome://extensions/"));
  assert.equal(args.some((value) => value.startsWith("--load-extension=")), false);
  assert.equal(
    args.some((value) =>
      /remote-debugging|headless|AutomationControlled|user-agent/i.test(value),
    ),
    false,
  );
});

test("keeps extension permissions limited to storage and loopback", () => {
  assert.deepEqual(MANIFEST.permissions, ["storage"]);
  assert.deepEqual(MANIFEST.host_permissions, ["http://127.0.0.1/*"]);
  assert.deepEqual(
    MANIFEST.content_scripts[1].js,
    ["source_guard.js", "atcoder.js"],
  );
  const serialized = JSON.stringify(MANIFEST);
  for (const permission of ["cookies", "debugger", "webRequest", "nativeMessaging", "tabs", "scripting"]) {
    assert.equal(serialized.includes(`\"${permission}\"`), false);
  }
  assert.doesNotMatch(WORKER_SOURCE, /chrome\.(?:cookies|debugger|webRequest|tabs|scripting)/);
});

test("does not read challenge tokens or programmatically submit the form", () => {
  assert.match(CONTENT_SOURCE, /cf-turnstile-response/);
  assert.doesNotMatch(CONTENT_SOURCE, /requestSubmit\s*\(/);
  assert.doesNotMatch(CONTENT_SOURCE, /\.click\s*\(/);
  assert.doesNotMatch(CONTENT_SOURCE, /HTMLFormElement\.prototype\.submit/);
  assert.ok(
    CONTENT_SOURCE.indexOf("event.preventDefault()") <
      CONTENT_SOURCE.indexOf("await fetchBaseline"),
  );
  assert.doesNotMatch(
    CONTENT_SOURCE,
    /cf-turnstile-response[^\n]{0,240}\.value/,
  );
});

test("requires the visible plain editor and rechecks serialized source before send", () => {
  assert.match(
    CONTENT_SOURCE,
    /await waitForPlainEditor\(\s*panel,\s*prepared\.sourceField,\s*prepared\.editorElement,\s*prepared\.editorToggle/,
  );
  assert.match(CONTENT_SOURCE, /SOURCE_GUARD\.serializedSourceMatches/);
  assert.match(CONTENT_SOURCE, /await verifyEditorRoundTrip/);
  assert.match(SOURCE_GUARD_SOURCE, /new FormData\(value\)/);
  assert.match(SOURCE_GUARD_SOURCE, /classList\.contains\("active"\)/);
  assert.match(CONTENT_SOURCE, /document\.querySelectorAll\("\.btn-toggle-editor"\)/);
  assert.match(CONTENT_SOURCE, /return "source_not_synchronized"/);
  assert.ok(
    CONTENT_SOURCE.indexOf("const failure = preparationFailure()") <
      CONTENT_SOURCE.indexOf('event: { type: "send_started" }'),
  );
});

test("reproduces the p0-14 hidden-Ace mismatch and accepts only plain mode", () => {
  const expectedSource = "print(0)\n";
  const form = {};
  const sourceField = {
    disabled: false,
    form,
    name: "sourceCode",
    value: expectedSource,
  };
  const editorElement = {};
  let toggleActive = false;
  const editorToggle = {
    classList: { contains: (name) => name === "active" && toggleActive },
  };
  const visibility = new Map([
    [sourceField, false],
    [editorElement, true],
  ]);
  const dependencies = {
    isVisible: (element) => visibility.get(element) === true,
    createFormData: () => ({ getAll: () => [sourceField.value] }),
    byteLength: (value) => Buffer.byteLength(value, "utf8"),
  };
  const input = {
    form,
    sourceField,
    editorElement,
    editorToggle,
    expectedSource,
    expectedByteCount: 9,
  };

  // This was the p0-14 check: the hidden textarea alone looked correct.
  assert.equal(sourceField.value === expectedSource, true);
  assert.equal(SOURCE_GUARD.serializedSourceMatches(input, dependencies), false);

  visibility.set(sourceField, true);
  visibility.set(editorElement, false);
  toggleActive = true;
  assert.equal(SOURCE_GUARD.serializedSourceMatches(input, dependencies), true);
  assert.equal(
    SOURCE_GUARD.isAceEditorMode(
      sourceField,
      editorElement,
      editorToggle,
      dependencies.isVisible,
    ),
    false,
  );

  // Model the manual plain -> Ace transition copying the textarea into Ace.
  const aceValue = sourceField.value;
  visibility.set(sourceField, false);
  visibility.set(editorElement, true);
  toggleActive = false;
  assert.equal(
    SOURCE_GUARD.isAceEditorMode(
      sourceField,
      editorElement,
      editorToggle,
      dependencies.isVisible,
    ),
    true,
  );

  // Model the manual Ace -> plain transition copying Ace back to the form field.
  sourceField.value = aceValue;
  visibility.set(sourceField, true);
  visibility.set(editorElement, false);
  toggleActive = true;
  assert.equal(SOURCE_GUARD.serializedSourceMatches(input, dependencies), true);

  // The official submit handler keys off this class, not visibility alone.
  toggleActive = false;
  assert.equal(SOURCE_GUARD.serializedSourceMatches(input, dependencies), false);
});

test("rejects a source value overwritten by the page submit synchronizer", () => {
  const expectedSource = "print(0)\n";
  const form = {};
  const sourceField = {
    disabled: false,
    form,
    name: "sourceCode",
    value: "",
  };
  const editorElement = {};
  const editorToggle = {
    classList: { contains: (name) => name === "active" },
  };
  const input = {
    form,
    sourceField,
    editorElement,
    editorToggle,
    expectedSource,
    expectedByteCount: 9,
  };
  assert.equal(
    SOURCE_GUARD.serializedSourceMatches(input, {
      isVisible: (element) => element === sourceField,
      createFormData: () => ({ getAll: () => [""] }),
      byteLength: (value) => Buffer.byteLength(value, "utf8"),
    }),
    false,
  );
});

test("cancels the modeled p0-14 submit after Ace overwrites the textarea", () => {
  const expectedSource = "print(0)\n";
  const form = new EventTarget();
  const sourceField = {
    disabled: false,
    form,
    name: "sourceCode",
    value: expectedSource,
  };
  const editorElement = {};
  const editorToggle = {
    classList: { contains: () => false },
  };
  let serializedValues = [expectedSource];
  const input = {
    form,
    sourceField,
    editorElement,
    editorToggle,
    expectedSource,
    expectedByteCount: 9,
  };
  const dependencies = {
    isVisible: (element) => element === editorElement,
    createFormData: () => ({ getAll: () => serializedValues }),
    byteLength: (value) => Buffer.byteLength(value, "utf8"),
  };

  // Model p0-14: AtCoder's earlier submit handler reads empty visible Ace.
  form.addEventListener("submit", () => {
    sourceField.value = "";
    serializedValues = [""];
  });
  form.addEventListener("submit", (event) => {
    if (!SOURCE_GUARD.serializedSourceMatches(input, dependencies)) {
      event.preventDefault();
    }
  });

  const submitted = form.dispatchEvent(new Event("submit", { cancelable: true }));
  assert.equal(submitted, false);
});

test("keeps one submit tab active and can resume the pre-approval stage", () => {
  assert.match(WORKER_SOURCE, /message\.type === "claim_submit_page"/);
  assert.match(WORKER_SOURCE, /activeTab === sender\.tab\.id/);
  assert.match(CONTENT_SOURCE, /if \(!claim\?\.claimed\)/);
  assert.match(CONTENT_SOURCE, /config\.helper_stage === "await_approval"/);
  assert.match(CONTENT_SOURCE, /type: "get_baseline_ids"/);
});

test("preserves a bounded local 409 reason for diagnosis", () => {
  assert.match(WORKER_SOURCE, /SERVER_ERROR_PATTERN/);
  assert.match(WORKER_SOURCE, /response\.status === 409/);
  assert.match(WORKER_SOURCE, /reason = body\.error/);
});

test("accepts exactly one ordered approval and submission", () => {
  const state = new VerificationState(9);
  state.apply({ type: "bootstrap_ready", navigator_webdriver: false });
  state.apply({ type: "compatibility_confirmed" });
  state.apply({
    type: "account_checked",
    identity_count: 1,
    identity_matches_expected: true,
    navigator_webdriver: false,
  });
  state.apply(formPrepared());
  state.apply(approvalGranted());
  state.apply({ type: "send_started" });
  state.apply({ type: "remote_accepted", submission_id: "123456789" });
  assert.equal(state.terminal, "complete");
  assert.throws(
    () => state.apply({ type: "remote_accepted", submission_id: "123456790" }),
    /event_after_terminal/,
  );
});

test("does not downgrade a post-send unknown state to an ordinary abort", () => {
  const state = new VerificationState(9);
  state.apply({ type: "bootstrap_ready", navigator_webdriver: false });
  state.apply({ type: "compatibility_confirmed" });
  state.apply({
    type: "account_checked",
    identity_count: 1,
    identity_matches_expected: true,
    navigator_webdriver: false,
  });
  state.apply(formPrepared());
  state.apply(approvalGranted());
  state.apply({ type: "send_started" });
  assert.throws(
    () => state.apply({ type: "aborted", reason: "user_interrupt" }),
    /event_out_of_order/,
  );
  state.apply({ type: "remote_status_unknown", reason: "user_interrupt" });
  assert.equal(state.terminal, "remote_status_unknown");
});

test("labels the browser signal as a form event rather than a network observation", () => {
  const result = buildResult("2026-08-12T00:00:00.000Z", 9, "151.0");
  assert.equal(result.browser_internal_request_count_known, false);
  assert.equal(result.helper_observed_requests.submission_form_submit_event, 0);
  assert.equal("submission_post" in result.helper_observed_requests, false);
});

test("fails closed on automation, account, form, and source mismatches", () => {
  assert.throws(
    () => new VerificationState(9).apply({ type: "bootstrap_ready", navigator_webdriver: true }),
    /automation_signal/,
  );

  const accountState = new VerificationState(9);
  accountState.apply({ type: "bootstrap_ready", navigator_webdriver: false });
  accountState.apply({ type: "compatibility_confirmed" });
  assert.throws(
    () =>
      accountState.apply({
        type: "account_checked",
        identity_count: 1,
        identity_matches_expected: false,
        navigator_webdriver: false,
      }),
    /account_gate/,
  );

  const formState = new VerificationState(9);
  formState.apply({ type: "bootstrap_ready", navigator_webdriver: false });
  formState.apply({ type: "compatibility_confirmed" });
  formState.apply({
    type: "account_checked",
    identity_count: 1,
    identity_matches_expected: true,
    navigator_webdriver: false,
  });
  assert.throws(() => formState.apply(formPrepared(10)), /submission_gate/);

  const editorState = new VerificationState(9);
  editorState.apply({ type: "bootstrap_ready", navigator_webdriver: false });
  editorState.apply({ type: "compatibility_confirmed" });
  editorState.apply({
    type: "account_checked",
    identity_count: 1,
    identity_matches_expected: true,
    navigator_webdriver: false,
  });
  assert.throws(
    () => editorState.apply({ ...formPrepared(), plain_editor_mode: false }),
    /submission_gate/,
  );
});

test("rejects secret-bearing or unbounded event shapes", () => {
  assert.throws(
    () => sanitizeEvent({ type: "remote_accepted", submission_id: "123", cookie: "secret" }),
    /submission_id_invalid/,
  );
  assert.throws(
    () => sanitizeEvent({ ...formPrepared(), turnstile_token: "secret" }),
    /form_invalid/,
  );
  assert.throws(
    () => sanitizeEvent({ ...formPrepared(), baseline_submission_count: 101 }),
    /form_invalid/,
  );
});

test("requires owner-only paths outside the repository", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "algoloom-v03-browser-test-"));
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), "algoloom-v03-browser-shared-"));
  fs.chmodSync(root, 0o700);
  fs.chmodSync(shared, 0o755);
  try {
    const source = path.join(root, "source.py");
    fs.writeFileSync(source, "print(0)\n", { mode: 0o600 });
    assert.equal(validateSourcePath(source).reason, null);
    assert.equal(
      validateSourcePath(path.join(REPOSITORY_ROOT, "README.md")).reason,
      "source_path_inside_repository",
    );
    assert.equal(validateOutputPath(path.join(root, "result.json")).reason, null);
    assert.equal(
      validateOutputPath(path.join(shared, "result.json")).reason,
      "output_parent_not_owner_only",
    );
    const output = path.join(root, "result.json");
    writeJsonExclusive(output, buildResult("2026-08-12T00:00:00.000Z", 9, "151.0"));
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: false });
    fs.rmSync(shared, { recursive: true, force: false });
  }
});
