import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  credentialPreflight,
  makeSessionRecord,
  parseSessionDirective,
  parseSessionRecord,
  runLocalMatrix,
  serializeSessionRecord,
  submissionGate,
} from "./atcoder_v11_cookie_lifecycle.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_SOURCE = fs.readFileSync(
  path.join(SCRIPT_DIRECTORY, "atcoder_v11_cookie_lifecycle.mjs"),
  "utf8",
);
const KEYCHAIN_SOURCE = fs.readFileSync(
  path.join(SCRIPT_DIRECTORY, "atcoder_v11_keychain.swift"),
  "utf8",
);
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

const OBSERVED_AT = new Date("2026-08-13T00:00:00.000Z");

test("distinguishes absent, unchanged, and changed REVEL_SESSION directives", () => {
  const absent = parseSessionDirective([], "current", OBSERVED_AT);
  assert.equal(absent.candidateValue, null);
  assert.deepEqual(absent.publicObservation, {
    set_cookie_header_present: false,
    set_cookie_header_count: 0,
    revel_session_directive_count: 0,
    directive: "absent",
    value_changed: null,
    explicit_expiry_present: false,
    expiry_source: "unknown",
  });

  const unchanged = parseSessionDirective(
    ["REVEL_SESSION=current; Path=/; Secure; HttpOnly"],
    "current",
    OBSERVED_AT,
  );
  assert.equal(unchanged.candidateValue, "current");
  assert.equal(unchanged.publicObservation.value_changed, false);

  const changed = parseSessionDirective(
    [
      "OTHER=value; Path=/; Secure",
      "REVEL_SESSION=next; Domain=.atcoder.jp; Path=/; Secure; HttpOnly; SameSite=Lax",
    ],
    "current",
    OBSERVED_AT,
  );
  assert.equal(changed.candidateValue, "next");
  assert.equal(changed.publicObservation.set_cookie_header_count, 2);
  assert.equal(changed.publicObservation.value_changed, true);
  assert.equal(changed.publicObservation.expiry_source, "unknown");
});

test("uses only explicit server expiry and recognizes invalidation", () => {
  const expires = parseSessionDirective(
    [
      "REVEL_SESSION=next; Path=/; Secure; HttpOnly; Expires=Fri, 14 Aug 2026 00:00:00 GMT",
    ],
    "current",
    OBSERVED_AT,
  );
  assert.equal(expires.publicObservation.expiry_source, "set_cookie_expires");
  assert.equal(expires.serverExpiresAt.toISOString(), "2026-08-14T00:00:00.000Z");

  const maxAge = parseSessionDirective(
    ["REVEL_SESSION=next; Path=/; Secure; HttpOnly; Max-Age=60"],
    "current",
    OBSERVED_AT,
  );
  assert.equal(maxAge.publicObservation.expiry_source, "set_cookie_max_age");
  assert.equal(maxAge.serverExpiresAt.toISOString(), "2026-08-13T00:01:00.000Z");

  for (const header of [
    "REVEL_SESSION=; Path=/; Secure; HttpOnly",
    "REVEL_SESSION=next; Path=/; Secure; HttpOnly; Max-Age=0",
    "REVEL_SESSION=next; Path=/; Secure; HttpOnly; Expires=Wed, 12 Aug 2026 00:00:00 GMT",
  ]) {
    assert.equal(
      parseSessionDirective([header], "current", OBSERVED_AT).publicObservation.directive,
      "invalidate",
    );
  }
});

test("rejects ambiguous or unsafe session directives", () => {
  for (const headers of [
    ["REVEL_SESSION=next; Path=/; HttpOnly"],
    ["REVEL_SESSION=next; Path=/; Secure"],
    ["REVEL_SESSION=next; Domain=example.com; Path=/; Secure; HttpOnly"],
    ["REVEL_SESSION=next; Path=/settings; Secure; HttpOnly"],
    ["REVEL_SESSION=next; Path=/; Path=/; Secure; HttpOnly"],
    ["REVEL_SESSION=one; Path=/; Secure; HttpOnly", "REVEL_SESSION=two; Path=/; Secure; HttpOnly"],
  ]) assert.throws(() => parseSessionDirective(headers, "current", OBSERVED_AT), /set_cookie/);
});

test("round-trips an opaque Keychain record without inventing an expiry", () => {
  const record = {
    cookieValue: "safe%3Afixture",
    serverExpiresAt: null,
    expirySource: "unknown",
  };
  const serialized = serializeSessionRecord(record);
  try {
    const parsed = parseSessionRecord(serialized);
    assert.equal(parsed.cookieValue, record.cookieValue);
    assert.equal(parsed.serverExpiresAt, null);
    assert.equal(parsed.expirySource, "unknown");
  } finally {
    serialized.fill(0);
  }
  assert.throws(
    () => makeSessionRecord("safe", null, "guessed"),
    /unknown_expiry_source/,
  );
});

test("stops before network for an explicit elapsed expiry", () => {
  const expired = credentialPreflight(
    { serverExpiresAt: new Date("2026-08-12T00:00:00.000Z") },
    OBSERVED_AT,
  );
  assert.deepEqual(expired, {
    classification: "expired",
    detail: "server_expiry_elapsed",
    request_allowed: false,
    expiry_inferred: false,
  });
  const unknown = credentialPreflight({ serverExpiresAt: null }, OBSERVED_AT);
  assert.equal(unknown.request_allowed, true);
  assert.equal(unknown.expiry_inferred, false);
});

test("blocks submission for expiry, update conflict, and secret store failures", () => {
  const expired = credentialPreflight(
    { serverExpiresAt: new Date("2026-08-12T00:00:00.000Z") },
    OBSERVED_AT,
  );
  const usable = credentialPreflight({ serverExpiresAt: null }, OBSERVED_AT);
  assert.deepEqual(
    submissionGate({ preflight: expired, identityVerified: false, storeState: "available" }),
    { submission_allowed: false, stopped_before_submission: true, reason: "expired" },
  );
  assert.equal(submissionGate({
    preflight: usable,
    identityVerified: true,
    storeState: "generation_conflict",
  }).reason, "cookie_update_conflict");
  assert.equal(submissionGate({
    preflight: usable,
    identityVerified: true,
    storeState: "read_failure",
  }).reason, "secret_store_failure");
});

test("local matrix covers all V-11 fail-closed boundaries", () => {
  const matrix = runLocalMatrix();
  assert.equal(matrix.verdict, "pass");
  assert.equal(matrix.scenario_count, 9);
  assert.equal(matrix.passed_scenario_count, 9);
  assert.equal(matrix.external_request_count, 0);
});

test("uses an atomic Keychain generation match and no plaintext fallback", () => {
  assert.match(KEYCHAIN_SOURCE, /SecItemUpdate/);
  assert.match(KEYCHAIN_SOURCE, /kSecAttrGeneric/);
  assert.match(KEYCHAIN_SOURCE, /keychain_generation_conflict/);
  assert.match(KEYCHAIN_SOURCE, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.match(KEYCHAIN_SOURCE, /FileHandle\.standardInput\.readDataToEndOfFile\(\)/);
  assert.match(KEYCHAIN_SOURCE, /FileHandle\.standardOutput\.write\(record\)/);
  assert.doesNotMatch(KEYCHAIN_SOURCE, /String\(data: record|print\(record/);
  assert.match(SCRIPT_SOURCE, /plaintext_fallback_used: false/);
  assert.match(SCRIPT_SOURCE, /env: \{\}/);
});

test("keeps the live flow read-only, finite, and value-free in results", () => {
  assert.match(SCRIPT_SOURCE, /method: "GET"/);
  assert.match(SCRIPT_SOURCE, /automatic_retries: 0/);
  assert.match(SCRIPT_SOURCE, /redirect_following: false/);
  assert.match(SCRIPT_SOURCE, /post_or_submission_count: 0/);
  assert.doesNotMatch(SCRIPT_SOURCE, /method: "POST"[\s\S]{0,300}atcoder\.jp/);
  assert.doesNotMatch(
    SCRIPT_SOURCE,
    /console\.(?:log|error)\([^\n]*(?:cookieValue|expectedIdentity|candidateValue)/,
  );
});

test("reuses the V-10 exact-scope manually triggered extension boundary", () => {
  assert.deepEqual(MANIFEST.permissions, ["cookies", "storage"]);
  assert.deepEqual(MANIFEST.host_permissions, [
    "https://atcoder.jp/*",
    "http://127.0.0.1/*",
  ]);
  assert.match(WORKER_SOURCE, /message\.type === "capture_session"/);
  assert.match(WORKER_SOURCE, /chrome\.cookies\.getAll\(\{/);
  assert.doesNotMatch(WORKER_SOURCE, /chrome\.cookies\.(?:set|remove|getAllCookieStores)/);
  assert.doesNotMatch(WORKER_SOURCE, /chrome\.(?:debugger|webRequest|tabs|scripting)/);
});
