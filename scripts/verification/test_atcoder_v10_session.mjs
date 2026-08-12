import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  VerificationState,
  buildChromeArguments,
  buildResult,
  classifyLocation,
  extractIdentities,
  extractSessionUpdate,
  observationPasses,
  sanitizeCapture,
  sanitizeRecheckOutput,
  validateCookieValue,
  validateOutputPath,
  writeJsonExclusive,
} from "./atcoder_v10_session.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const EXTENSION_DIRECTORY = path.join(
  SCRIPT_DIRECTORY,
  "atcoder_v10_browser_extension",
);
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(EXTENSION_DIRECTORY, "manifest.json"), "utf8"),
);
const WORKER_SOURCE = fs.readFileSync(
  path.join(EXTENSION_DIRECTORY, "service_worker.js"),
  "utf8",
);
const CONTENT_SOURCE = fs.readFileSync(
  path.join(EXTENSION_DIRECTORY, "atcoder.js"),
  "utf8",
);
const HELPER_SOURCE = fs.readFileSync(
  path.join(SCRIPT_DIRECTORY, "atcoder_v10_session.mjs"),
  "utf8",
);
const KEYCHAIN_SOURCE = fs.readFileSync(
  path.join(SCRIPT_DIRECTORY, "atcoder_v10_keychain.swift"),
  "utf8",
);

function validObservation() {
  return {
    started_at_utc: "2026-08-12T00:00:00.000Z",
    finished_at_utc: "2026-08-12T00:00:00.100Z",
    duration_ms: 100,
    method: "GET",
    target: "https://atcoder.jp/settings",
    http_status: 200,
    redirect_class: "none",
    content_type_class: "text/html",
    response_body_oversized: false,
    cloudflare_challenge_detected: false,
    identity_count: 1,
    identity_matches_expected: true,
    set_cookie_header_present: true,
    set_cookie_header_count: 1,
    revel_session_update_count: 1,
    classification: "authenticated_candidate",
  };
}

function validCapture() {
  return {
    candidate_count: 1,
    cookie_name: "REVEL_SESSION",
    cookie_domain: "atcoder.jp",
    cookie_path: "/",
    cookie_secure: true,
    cookie_http_only: true,
    cookie_host_only: false,
    cookie_session: true,
    cookie_partitioned: false,
    cookie_value: "safe%3Avalue_123",
    expected_identity: "expected_user",
  };
}

test("launches an empty visible Chrome without a remote-control or identity override flag", () => {
  const args = buildChromeArguments(
    "/private/tmp/profile",
    "http://127.0.0.1:12345/bootstrap#token=local",
  );
  assert.ok(args.includes("--user-data-dir=/private/tmp/profile"));
  assert.ok(args.includes("chrome://extensions/"));
  assert.equal(args.some((value) => value.startsWith("--load-extension=")), false);
  assert.equal(
    args.some((value) =>
      /remote-debugging|headless|AutomationControlled|user-agent/i.test(value)
    ),
    false,
  );
});

test("declares only the cookie, session-storage, AtCoder, and loopback permissions", () => {
  assert.deepEqual(MANIFEST.permissions, ["cookies", "storage"]);
  assert.deepEqual(MANIFEST.host_permissions, [
    "https://atcoder.jp/*",
    "http://127.0.0.1/*",
  ]);
  assert.deepEqual(MANIFEST.content_scripts[1].matches, [
    "https://atcoder.jp/settings*",
  ]);
  const serialized = JSON.stringify(MANIFEST);
  for (const forbidden of [
    "debugger",
    "webRequest",
    "nativeMessaging",
    "tabs",
    "scripting",
    "<all_urls>",
  ]) assert.equal(serialized.includes(`\"${forbidden}\"`), false);
});

test("reads one allowlisted cookie only after an account-gated explicit action", () => {
  assert.match(WORKER_SOURCE, /message\.type === "capture_session"/);
  assert.match(WORKER_SOURCE, /chrome\.cookies\.getAll\(\{/);
  assert.match(WORKER_SOURCE, /url: "https:\/\/atcoder\.jp\/"/);
  assert.match(WORKER_SOURCE, /name: "REVEL_SESSION"/);
  assert.match(WORKER_SOURCE, /path: "\/"/);
  assert.match(WORKER_SOURCE, /secure: true/);
  assert.match(WORKER_SOURCE, /candidates\.length !== 1 \|\| allowed\.length !== 1/);
  assert.doesNotMatch(WORKER_SOURCE, /chrome\.cookies\.(?:set|remove|getAllCookieStores)/);
  assert.doesNotMatch(WORKER_SOURCE, /chrome\.(?:debugger|webRequest|tabs|scripting)/);
  assert.match(CONTENT_SOURCE, /type: "capture_session"/);
  assert.match(CONTENT_SOURCE, /capture\.disabled = false/);
  assert.ok(
    CONTENT_SOURCE.indexOf("identity_matches_expected: true") <
      CONTENT_SOURCE.indexOf("capture.disabled = false"),
  );
});

test("does not automate login, Turnstile, navigation, or form submission", () => {
  assert.doesNotMatch(CONTENT_SOURCE, /\.click\s*\(/);
  assert.doesNotMatch(CONTENT_SOURCE, /requestSubmit\s*\(/);
  assert.doesNotMatch(CONTENT_SOURCE, /HTMLFormElement|cf-turnstile-response/);
  assert.doesNotMatch(WORKER_SOURCE, /chrome\.tabs\.|chrome\.scripting\./);
  assert.deepEqual(MANIFEST.content_scripts[1].matches, [
    "https://atcoder.jp/settings*",
  ]);
});

test("accepts only an exact cookie scope and returns a value-free observation", () => {
  const captured = sanitizeCapture(validCapture());
  assert.equal(captured.cookieValue, "safe%3Avalue_123");
  assert.equal(captured.expectedIdentity, "expected_user");
  const serialized = JSON.stringify(captured.publicObservation);
  assert.equal(serialized.includes("safe%3Avalue_123"), false);
  assert.equal(serialized.includes("expected_user"), false);

  for (const invalid of [
    { ...validCapture(), candidate_count: 2 },
    { ...validCapture(), cookie_name: "other" },
    { ...validCapture(), cookie_domain: "example.com" },
    { ...validCapture(), cookie_path: "/settings" },
    { ...validCapture(), cookie_secure: false },
    { ...validCapture(), cookie_partitioned: true },
    { ...validCapture(), cookie_value: "value;other=secret" },
    { ...validCapture(), expected_identity: "invalid identity" },
    { ...validCapture(), another_cookie: "secret" },
  ]) assert.throws(() => sanitizeCapture(invalid), /capture_|cookie_/);
});

test("rejects unsafe cookie header values", () => {
  assert.equal(validateCookieValue("safe%3Avalue_123"), null);
  for (const value of [
    "",
    "REVEL_SESSION=value",
    " value",
    "value ",
    "value;other",
    "value\n",
    "x".repeat(16_385),
  ]) assert.notEqual(validateCookieValue(value), null);
});

test("extracts a unique allowlisted account identity and classifies redirects", () => {
  const body = Buffer.from(
    'var userScreenName = "first_user";var userScreenName = "second_user";var userScreenName = "first_user";',
  );
  assert.deepEqual(extractIdentities(body), ["first_user", "second_user"]);
  assert.equal(classifyLocation("https://atcoder.jp/login?continue=x"), "atcoder_login");
  assert.equal(classifyLocation("/settings"), "other_atcoder_path");
  assert.equal(classifyLocation("https://example.com/login"), "other_origin");
});

test("accepts at most one correctly scoped REVEL_SESSION update", () => {
  const update = extractSessionUpdate([
    "OTHER=value; Path=/; Secure",
    "REVEL_SESSION=updated%3Avalue; Domain=atcoder.jp; Path=/; Secure; HttpOnly",
  ]);
  assert.equal(update.headerCount, 2);
  assert.equal(update.updateCount, 1);
  assert.equal(update.updatedValue, "updated%3Avalue");
  assert.equal(extractSessionUpdate([]).updatedValue, null);
  assert.throws(
    () => extractSessionUpdate([
      "REVEL_SESSION=one; Path=/",
      "REVEL_SESSION=two; Path=/",
    ]),
    /ambiguous/,
  );
  assert.throws(
    () => extractSessionUpdate(["REVEL_SESSION=value; Domain=example.com; Path=/"]),
    /domain_invalid/,
  );
});

test("requires the ordered compatibility and account gates", () => {
  const state = new VerificationState();
  state.apply({ type: "bootstrap_ready", navigator_webdriver: false });
  state.apply({ type: "compatibility_confirmed" });
  state.apply({
    type: "account_checked",
    identity_count: 1,
    identity_matches_expected: true,
    navigator_webdriver: false,
  });
  assert.equal(state.stage, "await_capture");

  const automated = new VerificationState();
  assert.throws(
    () => automated.apply({ type: "bootstrap_ready", navigator_webdriver: true }),
    /automation_signal/,
  );
  const mismatched = new VerificationState();
  mismatched.apply({ type: "bootstrap_ready", navigator_webdriver: false });
  mismatched.apply({ type: "compatibility_confirmed" });
  assert.throws(() => mismatched.apply({
    type: "account_checked",
    identity_count: 1,
    identity_matches_expected: false,
    navigator_webdriver: false,
  }), /account_gate/);
});

test("accepts only a successful fresh-process Keychain recheck shape", () => {
  const observation = validObservation();
  assert.equal(observationPasses(observation), true);
  assert.equal(sanitizeRecheckOutput({
    schema_version: 1,
    process_role: "keychain-session-recheck",
    session_loaded_from_keychain: true,
    observation,
  }), observation);
  assert.throws(() => sanitizeRecheckOutput({
    schema_version: 1,
    process_role: "keychain-session-recheck",
    session_loaded_from_keychain: true,
    observation: { ...observation, identity_matches_expected: false },
  }), /recheck_output_invalid/);
});

test("keeps Cookie and account identity out of argv, environment, files, and result", () => {
  assert.match(HELPER_SOURCE, /compileKeychainHelper/);
  assert.match(HELPER_SOURCE, /input: Buffer\.from|const input = Buffer\.from/);
  assert.match(HELPER_SOURCE, /detached: true/);
  assert.match(HELPER_SOURCE, /env: \{\}/);
  assert.match(HELPER_SOURCE, /expected_identity_transport: "anonymous-stdin-pipe"/);
  assert.match(HELPER_SOURCE, /readback_value_matches: true/);
  assert.match(HELPER_SOURCE, /response_cookie_update_persisted: false/);
  assert.doesNotMatch(HELPER_SOURCE, /console\.(?:log|error)\([^\n]*(?:cookieValue|expectedIdentity)/);
  const result = buildResult("2026-08-12T00:00:00.000Z", "151.0");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("safe%3Avalue_123"), false);
  assert.equal(serialized.includes("expected_user"), false);
  assert.equal(result.secret_persistence.cookie_or_identity_in_argv, false);
  assert.equal(result.secret_persistence.cookie_or_identity_in_environment, false);
});

test("uses exact-scope Security Framework data operations for the temporary Keychain item", () => {
  assert.match(KEYCHAIN_SOURCE, /kSecClassGenericPassword/);
  assert.match(KEYCHAIN_SOURCE, /kSecAttrService/);
  assert.match(KEYCHAIN_SOURCE, /kSecAttrAccount/);
  assert.match(KEYCHAIN_SOURCE, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.match(KEYCHAIN_SOURCE, /FileHandle\.standardInput\.readDataToEndOfFile\(\)/);
  assert.match(KEYCHAIN_SOURCE, /SecItemAdd/);
  assert.match(KEYCHAIN_SOURCE, /SecItemCopyMatching/);
  assert.match(KEYCHAIN_SOURCE, /SecItemDelete/);
  assert.match(KEYCHAIN_SOURCE, /FileHandle\.standardOutput\.write\(secret\)/);
  assert.doesNotMatch(KEYCHAIN_SOURCE, /print\(secret|String\(data: secret/);
});

test("requires an exclusive owner-only result path outside the repository", () => {
  const ownerOnly = fs.mkdtempSync(path.join(os.tmpdir(), "algoloom-v10-test-"));
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), "algoloom-v10-shared-"));
  fs.chmodSync(ownerOnly, 0o700);
  fs.chmodSync(shared, 0o755);
  try {
    const output = path.join(ownerOnly, "result.json");
    assert.equal(validateOutputPath(output).reason, null);
    assert.equal(
      validateOutputPath(path.join(REPOSITORY_ROOT, "result.json")).reason,
      "output_path_inside_repository",
    );
    assert.equal(
      validateOutputPath(path.join(shared, "result.json")).reason,
      "output_parent_not_owner_only",
    );
    writeJsonExclusive(output, buildResult("2026-08-12T00:00:00.000Z", "151.0"));
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.equal(validateOutputPath(output).reason, "output_path_already_exists");
  } finally {
    fs.rmSync(ownerOnly, { recursive: true, force: false });
    fs.rmSync(shared, { recursive: true, force: false });
  }
});
