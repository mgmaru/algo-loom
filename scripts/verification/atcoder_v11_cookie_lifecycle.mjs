#!/usr/bin/env node

/**
 * Verify fail-closed Cookie lifecycle handling for JudgeAdapter V-11.
 *
 * Local mode uses synthetic values and temporary macOS Keychain items only.
 * Live mode reuses the V-10 manually loaded extension in an empty, visible
 * Chrome profile. A person performs login and Turnstile; the helper receives
 * only REVEL_SESSION after an explicit action. It sends bounded GET requests
 * to /settings, never follows redirects, retries, posts, or submits code.
 */

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  VerificationState,
  buildChromeArguments,
  classifyLocation,
  extractIdentities,
  sanitizeCapture,
  validateCookieValue,
  validateOutputPath,
  writeJsonExclusive,
} from "./atcoder_v10_session.mjs";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const XCRUN_PATH = "/usr/bin/xcrun";
const TARGET_ORIGIN = "https://atcoder.jp";
const SETTINGS_PATH = "/settings";
const SETTINGS_URL = `${TARGET_ORIGIN}${SETTINGS_PATH}`;
const COOKIE_NAME = "REVEL_SESSION";
const KEYCHAIN_ACCOUNT = "temporary-session-record";
const KEYCHAIN_SERVICE_PREFIX = "io.algoloom.verification.v11";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_LOOPBACK_BODY_BYTES = 32 * 1024;
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const CONNECT_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MIN_REQUEST_INTERVAL_MS = 2_000;
const INTERACTION_TIMEOUT_MS = 20 * 60 * 1_000;
const USER_AGENT = "AlgoLoom-JudgeAdapter-Verification/0.1";
const ACCOUNT_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const REASON_PATTERN = /^[a-z0-9_]{1,96}$/;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const EXTENSION_DIRECTORY = path.join(
  SCRIPT_DIRECTORY,
  "atcoder_v10_browser_extension",
);
const KEYCHAIN_SOURCE_PATH = path.join(
  SCRIPT_DIRECTORY,
  "atcoder_v11_keychain.swift",
);

function utcNow() {
  return new Date().toISOString();
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function exactKeys(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function newGeneration() {
  return crypto.randomBytes(16).toString("hex");
}

function cookieAttributes(parts) {
  const attributes = new Map();
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    const separator = part.indexOf("=");
    const name = (separator < 0 ? part : part.slice(0, separator)).toLowerCase();
    if (attributes.has(name)) throw new Error("set_cookie_attribute_ambiguous");
    attributes.set(name, separator < 0 ? null : part.slice(separator + 1));
  }
  return attributes;
}

function explicitExpiry(attributes, observedAt) {
  if (attributes.has("max-age")) {
    const raw = attributes.get("max-age");
    if (!/^-?[0-9]+$/.test(raw || "")) throw new Error("set_cookie_max_age_invalid");
    const seconds = Number(raw);
    if (!Number.isSafeInteger(seconds)) throw new Error("set_cookie_max_age_invalid");
    return {
      present: true,
      source: "set_cookie_max_age",
      expiresAt: new Date(observedAt.getTime() + seconds * 1_000),
      invalidates: seconds <= 0,
    };
  }
  if (attributes.has("expires")) {
    const milliseconds = Date.parse(attributes.get("expires") || "");
    if (!Number.isFinite(milliseconds)) throw new Error("set_cookie_expires_invalid");
    return {
      present: true,
      source: "set_cookie_expires",
      expiresAt: new Date(milliseconds),
      invalidates: milliseconds <= observedAt.getTime(),
    };
  }
  return {
    present: false,
    source: "unknown",
    expiresAt: null,
    invalidates: false,
  };
}

export function parseSessionDirective(setCookieHeaders, currentValue, observedAt) {
  if (validateCookieValue(currentValue) !== null) throw new Error("current_cookie_invalid");
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    throw new Error("observation_time_invalid");
  }
  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];
  const candidates = [];
  for (const header of headers) {
    if (typeof header !== "string") continue;
    const parts = header.split(";");
    const separator = parts[0].indexOf("=");
    if (separator < 1 || parts[0].slice(0, separator).trim() !== COOKIE_NAME) continue;
    const value = parts[0].slice(separator + 1);
    const attributes = cookieAttributes(parts.slice(1));
    const domain = attributes.get("domain");
    if (
      domain !== undefined &&
      !new Set(["atcoder.jp", ".atcoder.jp"]).has(String(domain).toLowerCase())
    ) throw new Error("set_cookie_domain_invalid");
    const cookiePath = attributes.get("path");
    if (cookiePath !== undefined && cookiePath !== "/") {
      throw new Error("set_cookie_path_invalid");
    }
    if (!attributes.has("secure")) throw new Error("set_cookie_secure_missing");
    if (!attributes.has("httponly")) throw new Error("set_cookie_http_only_missing");
    const expiry = explicitExpiry(attributes, observedAt);
    const invalidates = value.length === 0 || expiry.invalidates;
    if (!invalidates && validateCookieValue(value) !== null) {
      throw new Error("set_cookie_value_invalid");
    }
    candidates.push({ value, expiry, invalidates });
  }
  if (candidates.length > 1) throw new Error("set_cookie_directive_ambiguous");
  if (candidates.length === 0) {
    return {
      candidateValue: null,
      serverExpiresAt: null,
      publicObservation: {
        set_cookie_header_present: headers.length > 0,
        set_cookie_header_count: headers.length,
        revel_session_directive_count: 0,
        directive: "absent",
        value_changed: null,
        explicit_expiry_present: false,
        expiry_source: "unknown",
      },
    };
  }
  const candidate = candidates[0];
  if (candidate.invalidates) {
    return {
      candidateValue: null,
      serverExpiresAt: candidate.expiry.expiresAt,
      publicObservation: {
        set_cookie_header_present: true,
        set_cookie_header_count: headers.length,
        revel_session_directive_count: 1,
        directive: "invalidate",
        value_changed: true,
        explicit_expiry_present: candidate.expiry.present,
        expiry_source: candidate.expiry.source,
      },
    };
  }
  return {
    candidateValue: candidate.value,
    serverExpiresAt: candidate.expiry.expiresAt,
    publicObservation: {
      set_cookie_header_present: true,
      set_cookie_header_count: headers.length,
      revel_session_directive_count: 1,
      directive: "set",
      value_changed: candidate.value !== currentValue,
      explicit_expiry_present: candidate.expiry.present,
      expiry_source: candidate.expiry.source,
    },
  };
}

export function makeSessionRecord(cookieValue, serverExpiresAt, expirySource) {
  if (validateCookieValue(cookieValue) !== null) throw new Error("record_cookie_invalid");
  if (serverExpiresAt !== null) {
    if (!(serverExpiresAt instanceof Date) || !Number.isFinite(serverExpiresAt.getTime())) {
      throw new Error("record_expiry_invalid");
    }
    if (!new Set([
      "browser_expiration_date",
      "set_cookie_expires",
      "set_cookie_max_age",
    ]).has(expirySource)) throw new Error("record_expiry_source_invalid");
  } else if (expirySource !== "unknown") {
    throw new Error("record_unknown_expiry_source_invalid");
  }
  return {
    schema_version: 1,
    cookie_value: cookieValue,
    server_expires_at_utc: serverExpiresAt === null ? null : serverExpiresAt.toISOString(),
    expiry_source: expirySource,
  };
}

export function parseSessionRecord(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > 20 * 1024) {
    throw new Error("record_size_invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch (_) {
    throw new Error("record_json_invalid");
  }
  if (
    !exactKeys(parsed, [
      "schema_version",
      "cookie_value",
      "server_expires_at_utc",
      "expiry_source",
    ]) ||
    parsed.schema_version !== 1 ||
    validateCookieValue(parsed.cookie_value) !== null
  ) throw new Error("record_shape_invalid");
  let expiresAt = null;
  if (parsed.server_expires_at_utc !== null) {
    const milliseconds = Date.parse(parsed.server_expires_at_utc);
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== parsed.server_expires_at_utc) {
      throw new Error("record_expiry_invalid");
    }
    expiresAt = new Date(milliseconds);
    if (!new Set([
      "browser_expiration_date",
      "set_cookie_expires",
      "set_cookie_max_age",
    ]).has(parsed.expiry_source)) throw new Error("record_expiry_source_invalid");
  } else if (parsed.expiry_source !== "unknown") {
    throw new Error("record_unknown_expiry_source_invalid");
  }
  return { cookieValue: parsed.cookie_value, serverExpiresAt: expiresAt, expirySource: parsed.expiry_source };
}

export function serializeSessionRecord(record) {
  return Buffer.from(`${JSON.stringify(makeSessionRecord(
    record.cookieValue,
    record.serverExpiresAt,
    record.expirySource,
  ))}\n`, "utf8");
}

export function credentialPreflight(record, observedAt) {
  if (record === null) {
    return {
      classification: "unauthenticated",
      detail: "credential_absent",
      request_allowed: false,
      expiry_inferred: false,
    };
  }
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    throw new Error("observation_time_invalid");
  }
  if (record.serverExpiresAt !== null && record.serverExpiresAt <= observedAt) {
    return {
      classification: "expired",
      detail: "server_expiry_elapsed",
      request_allowed: false,
      expiry_inferred: false,
    };
  }
  return {
    classification: "indeterminate",
    detail: record.serverExpiresAt === null
      ? "credential_present_without_server_expiry"
      : "server_expiry_not_elapsed",
    request_allowed: true,
    expiry_inferred: false,
  };
}

export function submissionGate({ preflight, identityVerified, storeState }) {
  const safe = preflight?.request_allowed === true &&
    identityVerified === true && storeState === "available";
  return {
    submission_allowed: safe,
    stopped_before_submission: !safe,
    reason: safe
      ? "ready"
      : storeState === "invalidated"
        ? "server_invalidated_session"
      : storeState === "generation_conflict"
        ? "cookie_update_conflict"
        : storeState !== "available"
          ? "secret_store_failure"
          : preflight?.classification === "expired"
            ? "expired"
            : "identity_not_verified",
  };
}

function responseClassification(status, redirectClass, identityCount, challenge) {
  if (challenge || status === 403 || status === 429) return "server_rejection";
  if (new Set([301, 302, 303, 307, 308]).has(status) && redirectClass === "atcoder_login") {
    return "unauthenticated_or_expired";
  }
  if (status === 200 && identityCount === 1) return "authenticated_candidate";
  if (status === 200) return "page_structure_changed";
  return "unexpected_http_status";
}

function observationPasses(observation) {
  return observation?.classification === "authenticated_candidate" &&
    observation.identity_count === 1 &&
    observation.identity_matches_expected === true &&
    observation.response_body_oversized === false &&
    observation.cloudflare_challenge_detected === false;
}

export async function requestSession(cookieValue, expectedIdentity, requestFactory = https.request) {
  if (
    validateCookieValue(cookieValue) !== null ||
    !ACCOUNT_PATTERN.test(expectedIdentity || "")
  ) throw new Error("request_secret_input_invalid");
  const startedAt = utcNow();
  const started = performance.now();
  return await new Promise((resolve, reject) => {
    let connectTimer = null;
    let settled = false;
    const finishReject = (reason) => {
      if (settled) return;
      settled = true;
      if (connectTimer !== null) clearTimeout(connectTimer);
      reject(new Error(reason));
    };
    const request = requestFactory({
      hostname: "atcoder.jp",
      port: 443,
      path: SETTINGS_PATH,
      method: "GET",
      agent: false,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en;q=0.5",
        "Cache-Control": "no-cache",
        Cookie: `${COOKIE_NAME}=${cookieValue}`,
        "User-Agent": USER_AGENT,
      },
    }, (response) => {
      if (connectTimer !== null) clearTimeout(connectTimer);
      const chunks = [];
      let total = 0;
      let oversized = false;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
          oversized = true;
          chunks.length = 0;
        } else if (!oversized) chunks.push(chunk);
      });
      response.once("error", () => finishReject("response_failure"));
      response.once("end", () => {
        if (settled) return;
        try {
          const body = oversized ? Buffer.alloc(0) : Buffer.concat(chunks);
          const identities = oversized ? [] : extractIdentities(body);
          body.fill(0);
          for (const chunk of chunks) chunk.fill(0);
          const identity = identities.length === 1 ? identities[0] : null;
          const redirectClass = classifyLocation(response.headers.location);
          const challenge = response.headers["cf-mitigated"] === "challenge";
          const directive = parseSessionDirective(
            response.headers["set-cookie"],
            cookieValue,
            new Date(),
          );
          settled = true;
          resolve({
            observation: {
              started_at_utc: startedAt,
              finished_at_utc: utcNow(),
              duration_ms: Math.round(performance.now() - started),
              method: "GET",
              target: SETTINGS_URL,
              http_status: response.statusCode ?? null,
              redirect_class: redirectClass,
              content_type_class: String(response.headers["content-type"] || "").split(";", 1)[0],
              response_body_oversized: oversized,
              cloudflare_challenge_detected: challenge,
              identity_count: identities.length,
              identity_matches_expected: identity === null ? null : identity === expectedIdentity,
              classification: responseClassification(
                response.statusCode ?? 0,
                redirectClass,
                identities.length,
                challenge,
              ),
              cookie_directive: directive.publicObservation,
            },
            candidateValue: directive.candidateValue,
            serverExpiresAt: directive.serverExpiresAt,
          });
        } catch (error) {
          finishReject(REASON_PATTERN.test(error?.message || "")
            ? error.message
            : "response_classification_failure");
        }
      });
    });
    connectTimer = setTimeout(
      () => request.destroy(new Error("connect_timeout")),
      CONNECT_TIMEOUT_MS,
    );
    request.setTimeout(
      REQUEST_TIMEOUT_MS,
      () => request.destroy(new Error("request_timeout")),
    );
    request.once("socket", (socket) => {
      socket.once("secureConnect", () => {
        if (connectTimer !== null) clearTimeout(connectTimer);
      });
    });
    request.once("error", (error) => finishReject(
      new Set(["connect_timeout", "request_timeout"]).has(error.message)
        ? error.message
        : "communication_failure",
    ));
    request.end();
  });
}

function compileKeychainHelper(outputPath) {
  const compiled = spawnSync(XCRUN_PATH, [
    "swiftc",
    KEYCHAIN_SOURCE_PATH,
    "-o",
    outputPath,
  ], {
    encoding: null,
    detached: true,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    env: {},
  });
  if (compiled.status !== 0 || !fs.existsSync(outputPath)) {
    throw new Error("keychain_helper_compile_failed");
  }
  fs.chmodSync(outputPath, 0o700);
}

function keychainCommand(helperPath, args, input = null) {
  const options = {
    encoding: null,
    detached: true,
    timeout: 10_000,
    maxBuffer: MAX_CHILD_OUTPUT_BYTES,
    env: {},
  };
  if (input !== null) options.input = input;
  return spawnSync(helperPath, args, options);
}

function addKeychainRecord(helperPath, service, generation, record) {
  const input = serializeSessionRecord(record);
  try {
    const added = keychainCommand(
      helperPath,
      ["add", service, KEYCHAIN_ACCOUNT, generation],
      input,
    );
    if (added.status !== 0) throw new Error("keychain_write_failed");
  } finally {
    input.fill(0);
  }
}

function replaceKeychainRecord(helperPath, service, expected, next, record) {
  const input = serializeSessionRecord(record);
  try {
    const replaced = keychainCommand(
      helperPath,
      ["replace", service, KEYCHAIN_ACCOUNT, expected, next],
      input,
    );
    if (replaced.status === 45) throw new Error("keychain_generation_conflict");
    if (replaced.status !== 0) throw new Error("keychain_write_failed");
  } finally {
    input.fill(0);
  }
}

function readKeychainRecord(helperPath, service) {
  const found = keychainCommand(helperPath, ["read", service, KEYCHAIN_ACCOUNT]);
  if (found.status === 44) throw new Error("keychain_item_absent");
  if (found.status !== 0) throw new Error("keychain_read_failed");
  try {
    return parseSessionRecord(found.stdout);
  } finally {
    found.stdout.fill(0);
  }
}

function deleteKeychainRecord(helperPath, service) {
  return keychainCommand(helperPath, ["delete", service, KEYCHAIN_ACCOUNT]).status === 0;
}

function keychainRecordAbsent(helperPath, service) {
  return keychainCommand(helperPath, ["exists", service, KEYCHAIN_ACCOUNT]).status === 44;
}

export function runLocalMatrix() {
  const observedAt = new Date("2026-08-13T00:00:00.000Z");
  const current = "fixture_current";
  const future = "Fri, 14 Aug 2026 00:00:00 GMT";
  const scenarios = [];
  const add = (name, actual, expected) => scenarios.push({
    name,
    expected,
    actual,
    matched_expected: JSON.stringify(actual) === JSON.stringify(expected),
  });
  const absent = parseSessionDirective([], current, observedAt).publicObservation;
  add("set_cookie_absent", [absent.directive, absent.expiry_source], ["absent", "unknown"]);
  const same = parseSessionDirective(
    [`REVEL_SESSION=${current}; Path=/; Secure; HttpOnly`],
    current,
    observedAt,
  ).publicObservation;
  add("set_cookie_same_value", [same.directive, same.value_changed], ["set", false]);
  const changed = parseSessionDirective(
    [`REVEL_SESSION=fixture_next; Path=/; Secure; HttpOnly; Expires=${future}`],
    current,
    observedAt,
  ).publicObservation;
  add(
    "set_cookie_changed_with_expiry",
    [changed.value_changed, changed.explicit_expiry_present, changed.expiry_source],
    [true, true, "set_cookie_expires"],
  );
  const invalidated = parseSessionDirective(
    ["REVEL_SESSION=; Path=/; Secure; HttpOnly; Max-Age=0"],
    current,
    observedAt,
  ).publicObservation;
  add("explicit_invalidation", invalidated.directive, "invalidate");
  const invalidationGate = submissionGate({
    preflight: { request_allowed: false, classification: "expired" },
    identityVerified: false,
    storeState: "invalidated",
  });
  add(
    "explicit_invalidation_stops_submission",
    [invalidationGate.submission_allowed, invalidationGate.reason],
    [false, "server_invalidated_session"],
  );
  const unknown = credentialPreflight(
    { serverExpiresAt: null },
    observedAt,
  );
  add(
    "unknown_expiry_not_inferred",
    [unknown.request_allowed, unknown.expiry_inferred],
    [true, false],
  );
  const expired = credentialPreflight(
    { serverExpiresAt: new Date("2026-08-12T00:00:00.000Z") },
    observedAt,
  );
  add(
    "explicit_expiry_stops_before_request",
    [expired.classification, expired.request_allowed, expired.expiry_inferred],
    ["expired", false, false],
  );
  const conflict = submissionGate({
    preflight: unknown,
    identityVerified: true,
    storeState: "generation_conflict",
  });
  add(
    "generation_conflict_stops_submission",
    [conflict.submission_allowed, conflict.reason],
    [false, "cookie_update_conflict"],
  );
  const storeFailure = submissionGate({
    preflight: unknown,
    identityVerified: true,
    storeState: "read_failure",
  });
  add(
    "secret_store_failure_stops_submission",
    [storeFailure.submission_allowed, storeFailure.reason],
    [false, "secret_store_failure"],
  );
  return {
    evidence: "local_fixed_input",
    external_request_count: 0,
    scenario_count: scenarios.length,
    passed_scenario_count: scenarios.filter((scenario) => scenario.matched_expected).length,
    verdict: scenarios.every((scenario) => scenario.matched_expected) ? "pass" : "fail",
    scenarios,
  };
}

function runKeychainMatrix(helperPath) {
  const service = `${KEYCHAIN_SERVICE_PREFIX}.${crypto.randomBytes(16).toString("hex")}.matrix`;
  const generation0 = newGeneration();
  const generation1 = newGeneration();
  const generation2 = newGeneration();
  const original = { cookieValue: "fixture_original", serverExpiresAt: null, expirySource: "unknown" };
  const winner = { cookieValue: "fixture_winner", serverExpiresAt: null, expirySource: "unknown" };
  let created = false;
  const result = {
    evidence: "local_keychain_control",
    synthetic_secret_only: true,
    external_request_count: 0,
    initial_add_succeeded: false,
    duplicate_add_classified_as_store_failure: false,
    missing_read_classified_as_store_failure: false,
    compare_and_swap_succeeded: false,
    stale_generation_rejected: false,
    winner_readback_matched: false,
    secret_store_failure_stopped_submission: false,
    generation_conflict_stopped_submission: false,
    cleanup_succeeded: false,
    verdict: "fail",
  };
  try {
    addKeychainRecord(helperPath, service, generation0, original);
    created = true;
    result.initial_add_succeeded = true;
    try {
      readKeychainRecord(helperPath, `${service}.absent`);
    } catch (error) {
      result.missing_read_classified_as_store_failure = error.message === "keychain_item_absent";
    }
    try {
      addKeychainRecord(helperPath, service, generation0, original);
    } catch (error) {
      result.duplicate_add_classified_as_store_failure = error.message === "keychain_write_failed";
    }
    replaceKeychainRecord(helperPath, service, generation0, generation1, winner);
    result.compare_and_swap_succeeded = true;
    try {
      replaceKeychainRecord(helperPath, service, generation0, generation2, original);
    } catch (error) {
      result.stale_generation_rejected = error.message === "keychain_generation_conflict";
    }
    const readback = readKeychainRecord(helperPath, service);
    result.winner_readback_matched = readback.cookieValue === winner.cookieValue;
    result.secret_store_failure_stopped_submission = !submissionGate({
      preflight: credentialPreflight(winner, new Date()),
      identityVerified: true,
      storeState: "write_failure",
    }).submission_allowed;
    result.generation_conflict_stopped_submission = !submissionGate({
      preflight: credentialPreflight(winner, new Date()),
      identityVerified: true,
      storeState: "generation_conflict",
    }).submission_allowed;
  } finally {
    result.cleanup_succeeded = !created || (
      deleteKeychainRecord(helperPath, service) && keychainRecordAbsent(helperPath, service)
    );
  }
  result.verdict = Object.entries(result)
    .filter(([key]) => !new Set(["evidence", "synthetic_secret_only", "external_request_count", "verdict"]).has(key))
    .every(([, value]) => value === true)
    ? "pass"
    : "fail";
  return result;
}

async function waitMinimum(startedAt) {
  const remaining = MIN_REQUEST_INTERVAL_MS - (performance.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

async function runRecheckMode(service, helperPath) {
  if (
    !service.startsWith(`${KEYCHAIN_SERVICE_PREFIX}.`) ||
    !path.isAbsolute(helperPath) ||
    !fs.existsSync(helperPath)
  ) return 64;
  const input = fs.readFileSync(0);
  if (input.length > 256) {
    input.fill(0);
    return 64;
  }
  const expectedIdentity = input.toString("utf8").replace(/\n$/, "");
  input.fill(0);
  if (!ACCOUNT_PATTERN.test(expectedIdentity)) return 64;
  let record = null;
  try {
    record = readKeychainRecord(helperPath, service);
    const preflight = credentialPreflight(record, new Date());
    if (!preflight.request_allowed) {
      process.stdout.write(`${JSON.stringify({
        schema_version: 1,
        process_role: "v11-session-recheck",
        session_loaded_from_keychain: true,
        preflight,
        request_sent: false,
      })}\n`);
      return 1;
    }
    const checked = await requestSession(record.cookieValue, expectedIdentity);
    process.stdout.write(`${JSON.stringify({
      schema_version: 1,
      process_role: "v11-session-recheck",
      session_loaded_from_keychain: true,
      preflight,
      request_sent: true,
      observation: checked.observation,
    })}\n`);
    return observationPasses(checked.observation) ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema_version: 1,
      process_role: "v11-session-recheck",
      session_loaded_from_keychain: false,
      error: REASON_PATTERN.test(error?.message || "") ? error.message : "recheck_failed",
    })}\n`);
    return 1;
  } finally {
    if (record !== null) record.cookieValue = "";
  }
}

function runRestartedRecheck(helperPath, service, expectedIdentity) {
  const input = Buffer.from(`${expectedIdentity}\n`, "utf8");
  try {
    const child = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--recheck", service, helperPath],
      {
        input,
        encoding: null,
        timeout: CONNECT_TIMEOUT_MS + REQUEST_TIMEOUT_MS + 10_000,
        maxBuffer: MAX_CHILD_OUTPUT_BYTES,
        env: {},
      },
    );
    let parsed;
    try {
      parsed = JSON.parse(child.stdout.toString("utf8"));
    } finally {
      child.stdout.fill(0);
    }
    if (
      child.status !== 0 ||
      !exactKeys(parsed, [
        "schema_version",
        "process_role",
        "session_loaded_from_keychain",
        "preflight",
        "request_sent",
        "observation",
      ]) ||
      parsed.schema_version !== 1 ||
      parsed.process_role !== "v11-session-recheck" ||
      parsed.session_loaded_from_keychain !== true ||
      parsed.request_sent !== true ||
      !observationPasses(parsed.observation)
    ) throw new Error("restarted_recheck_failed");
    return parsed;
  } finally {
    input.fill(0);
  }
}

function chromeVersion() {
  const checked = spawnSync(CHROME_PATH, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (checked.status !== 0) return null;
  return String(checked.stdout).trim().replace(/^Google Chrome /, "") || null;
}

function safeRequestHost(request, port) {
  return request.headers.host === `127.0.0.1:${port}`;
}

function safeRemoteAddress(request) {
  return new Set(["127.0.0.1", "::ffff:127.0.0.1", "::1"]).has(
    request.socket.remoteAddress,
  );
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_LOOPBACK_BODY_BYTES) throw new Error("request_body_oversized");
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  try {
    return JSON.parse(buffer.toString("utf8"));
  } finally {
    buffer.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

function jsonResponse(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function bootstrapResponse(response) {
  const escapedDirectory = EXTENSION_DIRECTORY
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const body = `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>AlgoLoom V-11</title><body style="font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:24px"><h1>AlgoLoom V-11 検証の準備</h1><p>別タブの拡張機能管理画面で次を手動実行してください。</p><ol><li>「デベロッパー モード」を有効にする。</li><li>「パッケージ化されていない拡張機能を読み込む」を押す。</li><li><code>${escapedDirectory}</code> を選ぶ。</li><li>このタブへ戻り、1回だけ再読み込みする。</li></ol><p>この専用ChromeはCDP、WebDriver、リモートデバッグを使用しません。拡張機能は明示操作後にAtCoderの<code>REVEL_SESSION</code>だけを読み取ります。</p></body>`;
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function stopBrowser(child) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  child.kill("SIGTERM");
  if (await waitForExit(child, 8_000)) return true;
  child.kill("SIGKILL");
  return await waitForExit(child, 3_000);
}

function profileProcessIds(profileDirectory) {
  const listed = spawnSync("/bin/ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (listed.status !== 0) return [];
  const marker = `--user-data-dir=${profileDirectory}`;
  const ids = [];
  for (const line of listed.stdout.split("\n")) {
    if (!line.includes(marker)) continue;
    const match = line.trim().match(/^([0-9]+)\s/);
    if (match) ids.push(Number(match[1]));
  }
  return ids;
}

async function stopProfileProcesses(profileDirectory) {
  for (const pid of profileProcessIds(profileDirectory)) {
    try { process.kill(pid, "SIGTERM"); } catch (_) { /* already gone */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  for (const pid of profileProcessIds(profileDirectory)) {
    try { process.kill(pid, "SIGKILL"); } catch (_) { /* already gone */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  return profileProcessIds(profileDirectory).length;
}

async function closeServer(server) {
  if (!server.listening) return true;
  return await new Promise((resolve) => {
    server.close(() => resolve(true));
    setTimeout(() => {
      server.closeAllConnections();
      resolve(!server.listening);
    }, 2_000);
  });
}

function buildResult(startedAt, localMatrix, keychainMatrix, liveRequested) {
  return {
    schema_version: 1,
    verification_scope: ["V-11"],
    started_at_utc: startedAt,
    finished_at_utc: null,
    platform: {
      os: os.type(),
      os_release: os.release(),
      architecture: os.arch(),
      node: process.versions.node,
      chrome: liveRequested ? chromeVersion() : null,
      secret_store: "macOS Keychain",
      secret_store_api: "macOS Security Framework",
    },
    method: {
      local_fixed_input_matrix: true,
      local_keychain_fault_control: true,
      live_method_a_requested: liveRequested,
      live_visible_browser: liveRequested,
      dedicated_empty_profile: liveRequested,
      existing_profile_referenced: false,
      remote_debugging: false,
      cdp: false,
      webdriver: false,
      headless: false,
      automated_login_or_turnstile: false,
      connect_timeout_ms: CONNECT_TIMEOUT_MS,
      request_timeout_ms: REQUEST_TIMEOUT_MS,
      minimum_request_interval_ms: MIN_REQUEST_INTERVAL_MS,
      maximum_response_bytes: MAX_BODY_BYTES,
      redirect_following: false,
      automatic_retries: 0,
      post_or_submission_count: 0,
    },
    local_matrix: localMatrix,
    keychain_matrix: keychainMatrix,
    browser_events: [],
    live_observations: null,
    atcoder_request_count: 0,
    submission_count: 0,
    v11: liveRequested ? "not_run" : "local_pass",
    cleanup: {
      browser_exit_confirmed: !liveRequested,
      orphan_profile_process_count: liveRequested ? null : 0,
      temporary_profile_removed: !liveRequested,
      temporary_keychain_helper_removed: false,
      loopback_server_closed: !liveRequested,
      live_keychain_item_removed: !liveRequested,
    },
    secret_persistence: {
      password_received_by_helper: false,
      non_allowlisted_cookie_read_by_extension: false,
      cookie_written_to_file: false,
      expected_identity_written_to_file: false,
      cookie_or_identity_in_environment: false,
      raw_headers_written_to_file: false,
      raw_html_written_to_file: false,
      expiry_inferred: false,
      plaintext_fallback_used: false,
    },
  };
}

async function runLive(result, helperPath) {
  const state = new VerificationState();
  const token = crypto.randomBytes(32).toString("hex");
  const service = `${KEYCHAIN_SERVICE_PREFIX}.${crypto.randomBytes(16).toString("hex")}.live`;
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "algoloom-v11-browser-"));
  fs.chmodSync(profileDirectory, 0o700);
  let browser = null;
  let keychainCreated = false;
  let activeCapture = false;
  let completed = false;
  let terminalResolve;
  let captureSettledResolve;
  let signalReason = null;
  const terminalPromise = new Promise((resolve) => { terminalResolve = resolve; });
  const captureSettledPromise = new Promise((resolve) => { captureSettledResolve = resolve; });

  result.live_observations = {
    profile_preflight: {
      created_outside_repository: !isInside(REPOSITORY_ROOT, profileDirectory),
      owner_only: (fs.statSync(profileDirectory).mode & 0o077) === 0,
      initial_entry_count: fs.readdirSync(profileDirectory).length,
    },
  };

  const server = http.createServer(async (request, response) => {
    const port = server.address()?.port;
    if (!safeRemoteAddress(request) || !safeRequestHost(request, port)) {
      response.writeHead(403).end();
      return;
    }
    const requestUrl = new URL(request.url || "/", `http://127.0.0.1:${port}`);
    if (request.method === "GET" && requestUrl.pathname === "/bootstrap") {
      bootstrapResponse(response);
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    try {
      if (request.method === "POST" && requestUrl.pathname === "/event") {
        const event = state.apply(await readJsonBody(request));
        result.browser_events.push({ ...state.events.at(-1) });
        console.log(`[${state.events.at(-1).observed_at_utc}] ブラウザ観測: ${event.type}`);
        jsonResponse(response, 200, { accepted: true, stage: state.stage });
        if (state.terminal !== null) terminalResolve(state.terminal);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/capture") {
        if (state.stage !== "await_capture" || activeCapture) throw new Error("capture_out_of_order");
        activeCapture = true;
        let cookieValue = "";
        let expectedIdentity = "";
        let persistedRecord = null;
        try {
          const capture = sanitizeCapture(await readJsonBody(request));
          cookieValue = capture.cookieValue;
          expectedIdentity = capture.expectedIdentity;
          result.live_observations.cookie_capture = {
            ...capture.publicObservation,
            observed_at_utc: utcNow(),
          };
          const capturedRecord = {
            cookieValue,
            serverExpiresAt: null,
            expirySource: "unknown",
          };
          const preflight = credentialPreflight(capturedRecord, new Date());
          result.live_observations.initial_preflight = preflight;
          if (!preflight.request_allowed) throw new Error("captured_session_expired");

          const initial = await requestSession(cookieValue, expectedIdentity);
          const initialFinished = performance.now();
          result.atcoder_request_count += 1;
          result.live_observations.initial_account_check = initial.observation;
          if (!observationPasses(initial.observation)) throw new Error("initial_account_check_failed");
          if (initial.observation.cookie_directive.directive === "invalidate") {
            throw new Error("server_invalidated_session");
          }

          const generation0 = newGeneration();
          addKeychainRecord(helperPath, service, generation0, capturedRecord);
          keychainCreated = true;
          persistedRecord = capturedRecord;
          result.live_observations.initial_secret_store = {
            write_succeeded_after_identity_check: true,
            plaintext_fallback_used: false,
          };

          if (initial.observation.cookie_directive.directive === "set") {
            const candidateRecord = {
              cookieValue: initial.candidateValue,
              serverExpiresAt: initial.serverExpiresAt,
              expirySource: initial.observation.cookie_directive.expiry_source,
            };
            if (initial.observation.cookie_directive.value_changed) {
              await waitMinimum(initialFinished);
              const candidateCheck = await requestSession(
                candidateRecord.cookieValue,
                expectedIdentity,
              );
              result.atcoder_request_count += 1;
              result.live_observations.updated_session_account_check = candidateCheck.observation;
              if (!observationPasses(candidateCheck.observation)) {
                throw new Error("updated_session_account_check_failed");
              }
            } else {
              result.live_observations.updated_session_account_check = {
                reused_initial_account_check: true,
                reason: "set_cookie_value_unchanged",
                identity_matches_expected: true,
              };
            }
            const generation1 = newGeneration();
            replaceKeychainRecord(
              helperPath,
              service,
              generation0,
              generation1,
              candidateRecord,
            );
            const updateReadback = readKeychainRecord(helperPath, service);
            if (
              updateReadback.cookieValue !== candidateRecord.cookieValue ||
              updateReadback.expirySource !== candidateRecord.expirySource ||
              updateReadback.serverExpiresAt?.toISOString() !==
                candidateRecord.serverExpiresAt?.toISOString()
            ) throw new Error("keychain_update_readback_mismatch");
            persistedRecord = candidateRecord;
            result.live_observations.cookie_update_persistence = {
              directive_observed: true,
              value_changed: initial.observation.cookie_directive.value_changed,
              updated_value_verified_before_persistence: true,
              compare_and_swap_succeeded: true,
              immediate_readback_matched: true,
              explicit_expiry_present: candidateRecord.serverExpiresAt !== null,
              expiry_source: candidateRecord.expirySource,
              expiry_inferred: false,
            };
          } else {
            result.live_observations.cookie_update_persistence = {
              directive_observed: false,
              value_changed: null,
              original_verified_value_persisted: true,
              explicit_expiry_present: false,
              expiry_source: "unknown",
              expiry_inferred: false,
            };
          }

          const beforeRestart = performance.now();
          await waitMinimum(beforeRestart);
          const restarted = runRestartedRecheck(helperPath, service, expectedIdentity);
          result.atcoder_request_count += 1;
          result.live_observations.restarted_process = {
            fresh_process_completed: true,
            session_loaded_from_keychain: true,
            preflight: restarted.preflight,
            account_check: restarted.observation,
            cookie_or_identity_in_argv: false,
            cookie_or_identity_in_environment: false,
          };
          result.live_observations.final_submission_gate = submissionGate({
            preflight: credentialPreflight(persistedRecord, new Date()),
            identityVerified: true,
            storeState: "available",
          });
          completed = true;
          state.terminal = "complete";
          result.browser_events.push({
            type: "cookie_lifecycle_rechecked",
            observed_at_utc: utcNow(),
          });
          jsonResponse(response, 200, { accepted: true, stage: "complete" });
          terminalResolve("complete");
          return;
        } finally {
          cookieValue = "";
          expectedIdentity = "";
          if (persistedRecord !== null) persistedRecord.cookieValue = "";
          activeCapture = false;
          captureSettledResolve();
        }
      }
      response.writeHead(404).end();
    } catch (error) {
      const reason = REASON_PATTERN.test(error?.message || "")
        ? error.message
        : "request_failed";
      result.live_observations.stop_reason = reason;
      result.live_observations.safe_stop = {
        stopped_before_submission: true,
        submission_count: 0,
      };
      jsonResponse(response, 409, { accepted: false, error: reason });
      terminalResolve("capture_failed");
    }
  });

  const onSignal = (signal) => {
    signalReason = signal === "SIGINT" ? "user_interrupt" : "termination_signal";
    terminalResolve("signal");
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  let exitCode = 1;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    const bootstrapUrl = `http://127.0.0.1:${port}/bootstrap#port=${port}&token=${token}`;
    const chromeArguments = buildChromeArguments(profileDirectory, bootstrapUrl);
    if (chromeArguments.some((argument) =>
      /remote-debugging|headless|AutomationControlled|user-agent/i.test(argument)
    )) throw new Error("forbidden_browser_argument");

    console.log("\nAlgoLoom V-11 Cookie更新・失効検証");
    console.log("空の専用Google Chromeを通常表示で起動します。");
    console.log("検証専用拡張を人が手動読込してください:", EXTENSION_DIRECTORY);
    console.log("ログイン、Turnstile、本人確認、Cookie取り込みは人が操作します。");
    console.log("ヘルパーのAtCoder通信はGET /settingsだけ、最大3回、2秒以上の間隔です。");
    console.log("POST・提出・自動再試行・セッション維持用通信は行いません。\n");

    browser = spawn(CHROME_PATH, chromeArguments, { stdio: "ignore" });
    browser.once("error", () => terminalResolve("browser_error"));
    browser.once("exit", () => {
      if (state.terminal === null && !activeCapture) terminalResolve("browser_closed");
    });
    const startupTimeout = setTimeout(
      () => state.stage === "await_bootstrap" && terminalResolve("extension_startup_timeout"),
      10 * 60 * 1_000,
    );
    const interactionTimeout = setTimeout(
      () => terminalResolve("interaction_timeout"),
      INTERACTION_TIMEOUT_MS,
    );
    const terminal = await terminalPromise;
    clearTimeout(startupTimeout);
    clearTimeout(interactionTimeout);
    if (activeCapture && !completed) {
      await Promise.race([
        captureSettledPromise,
        new Promise((resolve) => setTimeout(
          resolve,
          REQUEST_TIMEOUT_MS + CONNECT_TIMEOUT_MS + 15_000,
        )),
      ]);
    }
    if (!completed) {
      result.live_observations.stop_reason ||= signalReason || terminal;
      result.live_observations.safe_stop ||= {
        stopped_before_submission: true,
        submission_count: 0,
      };
      exitCode = terminal === "browser_closed" || terminal === "interaction_timeout" ? 2 : 1;
    } else {
      exitCode = 0;
    }
  } catch (error) {
    result.live_observations.stop_reason = REASON_PATTERN.test(error?.message || "")
      ? error.message
      : "helper_failure";
    result.live_observations.safe_stop = {
      stopped_before_submission: true,
      submission_count: 0,
    };
    exitCode = 3;
  } finally {
    if (browser !== null) result.cleanup.browser_exit_confirmed = await stopBrowser(browser);
    result.cleanup.orphan_profile_process_count = await stopProfileProcesses(profileDirectory);
    result.cleanup.loopback_server_closed = await closeServer(server);
    result.cleanup.live_keychain_item_removed = keychainCreated
      ? deleteKeychainRecord(helperPath, service) && keychainRecordAbsent(helperPath, service)
      : keychainRecordAbsent(helperPath, service);
    try {
      fs.rmSync(profileDirectory, { recursive: true, force: false });
      result.cleanup.temporary_profile_removed = !fs.existsSync(profileDirectory);
    } catch (_) {
      result.cleanup.temporary_profile_removed = false;
    }
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
  const cleanupPassed = result.cleanup.browser_exit_confirmed &&
    result.cleanup.orphan_profile_process_count === 0 &&
    result.cleanup.temporary_profile_removed &&
    result.cleanup.loopback_server_closed &&
    result.cleanup.live_keychain_item_removed;
  result.v11 = completed && cleanupPassed ? "pass" : completed ? "fail" : "aborted";
  if (completed && !cleanupPassed) exitCode = 3;
  return exitCode;
}

function parseArgs(argv) {
  if (argv.length !== 3 || !new Set(["--local-only", "--live"]).has(argv[0]) || argv[1] !== "--json-output") {
    throw new Error("usage_invalid");
  }
  return { live: argv[0] === "--live", jsonOutput: argv[2] };
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (_) {
    console.error("使用方法: node scripts/verification/atcoder_v11_cookie_lifecycle.mjs (--local-only|--live) --json-output <リポジトリ外の絶対パス>");
    return 64;
  }
  if (process.platform !== "darwin") {
    console.error("このV-11検証ヘルパーはmacOS Keychainを使うため、macOS専用です。");
    return 64;
  }
  const output = validateOutputPath(args.jsonOutput);
  if (output.reason !== null) {
    console.error("匿名化済み結果の保存先を受理できません:", output.reason);
    return 64;
  }
  if (
    !fs.existsSync(XCRUN_PATH) ||
    !fs.existsSync(KEYCHAIN_SOURCE_PATH) ||
    (args.live && (!fs.existsSync(CHROME_PATH) || !fs.existsSync(EXTENSION_DIRECTORY)))
  ) {
    console.error("V-11検証に必要な実行環境が見つかりません。");
    return 64;
  }

  const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "algoloom-v11-runtime-"));
  fs.chmodSync(runtimeDirectory, 0o700);
  const helperPath = path.join(runtimeDirectory, "keychain-helper");
  let result = null;
  let exitCode = 3;
  try {
    compileKeychainHelper(helperPath);
    const localMatrix = runLocalMatrix();
    const keychainMatrix = runKeychainMatrix(helperPath);
    result = buildResult(utcNow(), localMatrix, keychainMatrix, args.live);
    console.log("AlgoLoom V-11 ローカル検証");
    console.log(`固定入力: ${localMatrix.passed_scenario_count}/${localMatrix.scenario_count} ${localMatrix.verdict}`);
    console.log(`Keychain障害・競合: ${keychainMatrix.verdict}`);
    if (localMatrix.verdict !== "pass" || keychainMatrix.verdict !== "pass") {
      throw new Error("local_preflight_failed");
    }
    exitCode = args.live ? await runLive(result, helperPath) : 0;
  } catch (error) {
    if (result === null) {
      result = buildResult(utcNow(), runLocalMatrix(), {
        evidence: "local_keychain_control",
        verdict: "fail",
        stop_reason: REASON_PATTERN.test(error?.message || "") ? error.message : "helper_failure",
      }, args.live);
    } else if (result.live_observations === null) {
      result.local_stop_reason = REASON_PATTERN.test(error?.message || "")
        ? error.message
        : "helper_failure";
      result.v11 = "aborted";
    }
    exitCode = 3;
  } finally {
    try {
      fs.rmSync(runtimeDirectory, { recursive: true, force: false });
      if (result !== null) result.cleanup.temporary_keychain_helper_removed =
        !fs.existsSync(runtimeDirectory);
    } catch (_) {
      if (result !== null) result.cleanup.temporary_keychain_helper_removed = false;
    }
  }

  result.finished_at_utc = utcNow();
  if (!args.live && result.local_matrix.verdict === "pass" && result.keychain_matrix.verdict === "pass" && result.cleanup.temporary_keychain_helper_removed) {
    result.v11 = "local_pass";
  }
  try {
    writeJsonExclusive(output.path, result);
  } catch (error) {
    console.error("匿名化済み結果を保存できませんでした:", error.message);
    return 3;
  }
  console.log(`V-11検証結果: ${result.v11}`);
  console.log("Cookie、実際のアカウント名、生ヘッダー、Keychain項目識別子は結果へ保存していません。");
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--recheck") {
    process.exitCode = await runRecheckMode(process.argv[3] || "", process.argv[4] || "");
  } else {
    process.exitCode = await main(process.argv.slice(2));
  }
}
