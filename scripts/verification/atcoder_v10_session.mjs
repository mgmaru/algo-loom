#!/usr/bin/env node

/**
 * Verify the redesigned method-A session boundary for JudgeAdapter V-10.
 *
 * A person manually loads the verification-only extension into an empty,
 * visible Chrome profile and completes AtCoder login and Turnstile. The
 * extension reads one allowlisted REVEL_SESSION only after an explicit action.
 * This helper verifies the account, stores the session temporarily in macOS
 * Keychain, and launches a fresh process that reads and verifies that session.
 * It never submits code or persists a cookie, account name, raw header, or HTML
 * outside the temporary Keychain item and Chrome profile removed at cleanup.
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

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const XCRUN_PATH = "/usr/bin/xcrun";
const TARGET_ORIGIN = "https://atcoder.jp";
const SETTINGS_PATH = "/settings";
const SETTINGS_URL = `${TARGET_ORIGIN}${SETTINGS_PATH}`;
const COMPATIBILITY_URL = "https://browser-compat.turnstile.workers.dev/";
const COOKIE_NAME = "REVEL_SESSION";
const KEYCHAIN_ACCOUNT = "temporary-session";
const KEYCHAIN_SERVICE_PREFIX = "io.algoloom.verification.v10";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_LOOPBACK_BODY_BYTES = 32 * 1024;
const MAX_CHILD_OUTPUT_BYTES = 32 * 1024;
const CONNECT_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MIN_REQUEST_INTERVAL_MS = 2_000;
const INTERACTION_TIMEOUT_MS = 20 * 60 * 1_000;
const USER_AGENT = "AlgoLoom-JudgeAdapter-Verification/0.1";
const ACCOUNT_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const REASON_PATTERN = /^[a-z0-9_]{1,80}$/;
const IDENTITY_PATTERN = /var\s+userScreenName\s*=\s*"([A-Za-z0-9_]{1,64})"\s*;/g;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const EXTENSION_DIRECTORY = path.join(
  SCRIPT_DIRECTORY,
  "atcoder_v10_browser_extension",
);
const KEYCHAIN_SOURCE_PATH = path.join(
  SCRIPT_DIRECTORY,
  "atcoder_v10_keychain.swift",
);

export const CHROME_ARGUMENT_PREFIXES = [
  "--new-window",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-sync",
];

function utcNow() {
  return new Date().toISOString();
}

function exactKeys(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function validateCookieValue(value) {
  if (typeof value !== "string" || value.length === 0) return "cookie_empty";
  if (value.startsWith(`${COOKIE_NAME}=`)) return "cookie_name_prefix_included";
  if (value !== value.trim()) return "cookie_surrounding_whitespace";
  if (value.length > 16_384) return "cookie_too_large";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x21 || code > 0x7e) return "cookie_non_visible_ascii";
  }
  if (/[;\r\n]/.test(value)) return "cookie_header_delimiter";
  return null;
}

export function sanitizeCapture(value) {
  const keys = [
    "candidate_count",
    "cookie_domain",
    "cookie_host_only",
    "cookie_http_only",
    "cookie_name",
    "cookie_partitioned",
    "cookie_path",
    "cookie_secure",
    "cookie_session",
    "cookie_value",
    "expected_identity",
  ];
  if (
    !exactKeys(value, keys) ||
    value.candidate_count !== 1 ||
    value.cookie_name !== COOKIE_NAME ||
    !new Set(["atcoder.jp", ".atcoder.jp"]).has(value.cookie_domain) ||
    value.cookie_path !== "/" ||
    value.cookie_secure !== true ||
    typeof value.cookie_http_only !== "boolean" ||
    typeof value.cookie_host_only !== "boolean" ||
    typeof value.cookie_session !== "boolean" ||
    value.cookie_partitioned !== false ||
    !ACCOUNT_PATTERN.test(value.expected_identity || "")
  ) {
    throw new Error("capture_scope_invalid");
  }
  const cookieError = validateCookieValue(value.cookie_value);
  if (cookieError !== null) throw new Error(cookieError);
  return {
    cookieValue: value.cookie_value,
    expectedIdentity: value.expected_identity,
    publicObservation: {
      candidate_count: 1,
      cookie_name: COOKIE_NAME,
      cookie_domain_allowlisted: true,
      cookie_path: "/",
      cookie_secure: true,
      cookie_http_only: value.cookie_http_only,
      cookie_host_only: value.cookie_host_only,
      cookie_session: value.cookie_session,
      cookie_partitioned: false,
      value_persisted_in_result: false,
    },
  };
}

export function extractIdentities(body) {
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
  const identities = new Set();
  for (const match of text.matchAll(IDENTITY_PATTERN)) identities.add(match[1]);
  return [...identities].sort();
}

export function classifyLocation(value) {
  if (!value) return "none";
  let parsed;
  try {
    parsed = new URL(value, TARGET_ORIGIN);
  } catch (_) {
    return "invalid";
  }
  if (parsed.origin !== TARGET_ORIGIN) return "other_origin";
  return parsed.pathname === "/login" ? "atcoder_login" : "other_atcoder_path";
}

export function extractSessionUpdate(setCookieHeaders) {
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
    if (separator < 1 || parts[0].slice(0, separator) !== COOKIE_NAME) continue;
    const attributes = new Map();
    for (const rawPart of parts.slice(1)) {
      const part = rawPart.trim();
      const attributeSeparator = part.indexOf("=");
      const name = (attributeSeparator < 0 ? part : part.slice(0, attributeSeparator))
        .toLowerCase();
      const attributeValue = attributeSeparator < 0 ? "" : part.slice(attributeSeparator + 1);
      attributes.set(name, attributeValue);
    }
    const domain = attributes.get("domain");
    if (domain !== undefined && !new Set(["atcoder.jp", ".atcoder.jp"]).has(domain.toLowerCase())) {
      throw new Error("set_cookie_domain_invalid");
    }
    const cookiePath = attributes.get("path");
    if (cookiePath !== undefined && cookiePath !== "/") {
      throw new Error("set_cookie_path_invalid");
    }
    const cookieValue = parts[0].slice(separator + 1);
    const valueError = validateCookieValue(cookieValue);
    if (valueError !== null) throw new Error("set_cookie_value_invalid");
    candidates.push(cookieValue);
  }
  if (candidates.length > 1) throw new Error("set_cookie_update_ambiguous");
  return {
    headerCount: headers.length,
    updateCount: candidates.length,
    updatedValue: candidates[0] ?? null,
  };
}

function classifyResponse(status, redirectClass, identityCount, challengeDetected) {
  if (challengeDetected || status === 403 || status === 429) return "server_rejection";
  if (new Set([301, 302, 303, 307, 308]).has(status) && redirectClass === "atcoder_login") {
    return "unauthenticated";
  }
  if (status === 200 && identityCount === 1) return "authenticated_candidate";
  if (status === 200) return "page_structure_changed";
  return "unexpected_http_status";
}

export async function projectSession(cookieValue, expectedIdentity) {
  const cookieError = validateCookieValue(cookieValue);
  if (cookieError !== null || !ACCOUNT_PATTERN.test(expectedIdentity || "")) {
    throw new Error("request_secret_input_invalid");
  }
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
    const request = https.request({
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
          return;
        }
        if (!oversized) chunks.push(chunk);
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
          const challengeDetected = response.headers["cf-mitigated"] === "challenge";
          const update = extractSessionUpdate(response.headers["set-cookie"]);
          const classification = classifyResponse(
            response.statusCode ?? 0,
            redirectClass,
            identities.length,
            challengeDetected,
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
              content_type_class: String(response.headers["content-type"] || "")
                .split(";", 1)[0],
              response_body_oversized: oversized,
              cloudflare_challenge_detected: challengeDetected,
              identity_count: identities.length,
              identity_matches_expected: identity === null ? null : identity === expectedIdentity,
              set_cookie_header_present: update.headerCount > 0,
              set_cookie_header_count: update.headerCount,
              revel_session_update_count: update.updateCount,
              classification,
            },
          });
        } catch (error) {
          finishReject(
            REASON_PATTERN.test(error?.message || "")
              ? error.message
              : "response_classification_failure",
          );
        }
      });
    });
    connectTimer = setTimeout(() => request.destroy(new Error("connect_timeout")), CONNECT_TIMEOUT_MS);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("request_timeout")));
    request.once("socket", (socket) => {
      socket.once("secureConnect", () => {
        if (connectTimer !== null) clearTimeout(connectTimer);
      });
    });
    request.once("error", (error) => {
      const reason = new Set(["connect_timeout", "request_timeout"]).has(error.message)
        ? error.message
        : "communication_failure";
      finishReject(reason);
    });
    request.end();
  });
}

export function observationPasses(observation) {
  return observation?.classification === "authenticated_candidate" &&
    observation.identity_count === 1 &&
    observation.identity_matches_expected === true &&
    observation.response_body_oversized === false &&
    observation.cloudflare_challenge_detected === false;
}

export function buildChromeArguments(profileDirectory, bootstrapUrl) {
  return [
    ...CHROME_ARGUMENT_PREFIXES,
    `--user-data-dir=${profileDirectory}`,
    bootstrapUrl,
    "chrome://extensions/",
  ];
}

export function validateOutputPath(outputPath) {
  if (!path.isAbsolute(outputPath)) return { path: null, reason: "output_path_must_be_absolute" };
  const resolved = path.resolve(outputPath);
  if (isInside(REPOSITORY_ROOT, resolved)) return { path: null, reason: "output_path_inside_repository" };
  if (fs.existsSync(resolved)) return { path: null, reason: "output_path_already_exists" };
  let info;
  try {
    info = fs.statSync(path.dirname(resolved));
  } catch (_) {
    return { path: null, reason: "output_parent_unavailable" };
  }
  if (!info.isDirectory()) return { path: null, reason: "output_parent_not_directory" };
  if ((info.mode & 0o077) !== 0) return { path: null, reason: "output_parent_not_owner_only" };
  return { path: resolved, reason: null };
}

export function writeJsonExclusive(outputPath, value) {
  const descriptor = fs.openSync(
    outputPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
    0o600,
  );
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

function chromeVersion() {
  const checked = spawnSync(CHROME_PATH, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (checked.status !== 0) return null;
  const match = String(checked.stdout).trim().match(/^Google Chrome ([0-9.]+)$/);
  return match ? match[1] : null;
}

export function buildResult(startedAt, version) {
  return {
    schema_version: 1,
    verification_scope: ["V-10"],
    started_at_utc: startedAt,
    finished_at_utc: null,
    platform: {
      os: os.type(),
      os_release: os.release(),
      architecture: os.arch(),
      node: process.versions.node,
      chrome: version,
      secret_store: "macOS Keychain",
      secret_store_api: "macOS Security Framework",
    },
    method: {
      authentication: "method-A-redesigned-boundary",
      visible_browser: true,
      dedicated_empty_profile: true,
      existing_profile_referenced: false,
      browser_extension: "manually-loaded-verification-only-unpacked-extension",
      extension_installation_method: "chrome-extensions-load-unpacked",
      extension_permissions: ["cookies", "storage"],
      extension_host_permissions: ["https://atcoder.jp/*", "http://127.0.0.1/*"],
      cookie_name: COOKIE_NAME,
      remote_debugging_pipe: false,
      remote_debugging_port: false,
      cdp: false,
      webdriver: false,
      headless: false,
      stealth_or_fingerprint_override: false,
      user_agent_override: false,
      automated_login: false,
      automated_turnstile: false,
      loopback_bind_address: "127.0.0.1",
      loopback_authenticated: true,
      secret_store_plaintext_fallback: false,
      process_restart_recheck: true,
      connect_timeout_ms: CONNECT_TIMEOUT_MS,
      request_timeout_ms: REQUEST_TIMEOUT_MS,
      minimum_request_interval_ms: MIN_REQUEST_INTERVAL_MS,
      maximum_response_bytes: MAX_BODY_BYTES,
      redirect_following: false,
      automatic_retries: 0,
      interaction_timeout_ms: INTERACTION_TIMEOUT_MS,
    },
    browser_events: [],
    observations: {},
    helper_request_count: 0,
    browser_internal_request_count_known: false,
    submission_count: 0,
    v10: "not_run",
    v11: "not_evaluated",
    cleanup: {
      browser_exit_confirmed: false,
      orphan_profile_process_count: null,
      temporary_profile_removed: false,
      temporary_keychain_helper_removed: false,
      loopback_server_closed: false,
      keychain_item_removed: false,
    },
    secret_persistence: {
      password_received_by_helper: false,
      cookie_read_by_extension: false,
      non_allowlisted_cookie_read_by_extension: false,
      cookie_written_to_keychain: false,
      cookie_written_to_file: false,
      expected_identity_written_to_file: false,
      expected_identity_written_to_keychain: false,
      cookie_or_identity_in_argv: false,
      cookie_or_identity_in_environment: false,
      raw_headers_written_to_file: false,
      raw_html_written_to_file: false,
      keychain_identifier_in_result: false,
    },
  };
}

function sanitizeEvent(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("event_invalid");
  }
  if (
    value.type === "bootstrap_ready" &&
    exactKeys(value, ["type", "navigator_webdriver"]) &&
    typeof value.navigator_webdriver === "boolean"
  ) return { ...value };
  if (value.type === "compatibility_confirmed" && exactKeys(value, ["type"])) {
    return { type: value.type };
  }
  if (
    value.type === "account_checked" &&
    exactKeys(value, [
      "type",
      "identity_count",
      "identity_matches_expected",
      "navigator_webdriver",
    ]) &&
    Number.isInteger(value.identity_count) &&
    value.identity_count >= 0 &&
    value.identity_count <= 100 &&
    typeof value.identity_matches_expected === "boolean" &&
    typeof value.navigator_webdriver === "boolean"
  ) return { ...value };
  if (
    value.type === "aborted" &&
    exactKeys(value, ["type", "reason"]) &&
    REASON_PATTERN.test(value.reason || "")
  ) return { ...value };
  throw new Error("event_shape_invalid");
}

export class VerificationState {
  constructor() {
    this.stage = "await_bootstrap";
    this.terminal = null;
    this.events = [];
  }

  apply(rawEvent) {
    if (this.terminal !== null) throw new Error("event_after_terminal");
    const event = sanitizeEvent(rawEvent);
    if (event.type === "aborted") {
      this.terminal = "aborted";
      this.events.push({ ...event, observed_at_utc: utcNow() });
      return event;
    }
    if (event.type === "bootstrap_ready" && event.navigator_webdriver) {
      throw new Error("browser_automation_signal_present");
    }
    if (
      event.type === "account_checked" &&
      (event.identity_count !== 1 ||
        !event.identity_matches_expected ||
        event.navigator_webdriver)
    ) throw new Error("account_gate_not_satisfied");
    const transitions = {
      await_bootstrap: ["bootstrap_ready", "await_compatibility"],
      await_compatibility: ["compatibility_confirmed", "await_account"],
      await_account: ["account_checked", "await_capture"],
    };
    const transition = transitions[this.stage];
    if (!transition || transition[0] !== event.type) throw new Error("event_out_of_order");
    this.stage = transition[1];
    this.events.push({ ...event, observed_at_utc: utcNow() });
    return event;
  }
}

function applyEvent(result, event) {
  result.browser_events.push({ ...event });
  if (event.type === "bootstrap_ready") {
    result.observations.local_browser_signal = {
      extension_loaded: true,
      navigator_webdriver: event.navigator_webdriver,
    };
  } else if (event.type === "compatibility_confirmed") {
    result.observations.cloudflare_compatibility = {
      official_url: COMPATIBILITY_URL,
      diagnostics_passed_confirmed_by_user: true,
    };
  } else if (event.type === "account_checked") {
    result.observations.browser_account_check = {
      identity_count: event.identity_count,
      identity_matches_expected: event.identity_matches_expected,
      navigator_webdriver: event.navigator_webdriver,
    };
  } else if (event.type === "aborted") {
    result.observations.stop_reason = event.reason;
  }
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

function addKeychainSecret(helperPath, service, secret) {
  const input = Buffer.from(secret, "utf8");
  try {
    const added = spawnSync(helperPath, [
      "add",
      service,
      KEYCHAIN_ACCOUNT,
    ], {
      input,
      encoding: null,
      detached: true,
      timeout: 10_000,
      maxBuffer: MAX_CHILD_OUTPUT_BYTES,
    });
    if (added.status !== 0) throw new Error("keychain_write_failed");
  } finally {
    input.fill(0);
  }
}

function readKeychainSecret(helperPath, service) {
  const found = spawnSync(helperPath, [
    "read",
    service,
    KEYCHAIN_ACCOUNT,
  ], {
    encoding: null,
    detached: true,
    timeout: 10_000,
    maxBuffer: MAX_CHILD_OUTPUT_BYTES,
  });
  if (found.status !== 0) throw new Error("keychain_read_failed");
  const output = found.stdout;
  const value = output.toString("utf8");
  output.fill(0);
  const valueError = validateCookieValue(value);
  if (valueError !== null) throw new Error("keychain_value_invalid");
  return value;
}

function deleteKeychainSecret(helperPath, service) {
  const deleted = spawnSync(helperPath, [
    "delete",
    service,
    KEYCHAIN_ACCOUNT,
  ], {
    encoding: null,
    detached: true,
    timeout: 10_000,
    maxBuffer: MAX_CHILD_OUTPUT_BYTES,
  });
  return deleted.status === 0;
}

function keychainSecretAbsent(helperPath, service) {
  const found = spawnSync(helperPath, [
    "exists",
    service,
    KEYCHAIN_ACCOUNT,
  ], {
    encoding: null,
    detached: true,
    timeout: 10_000,
    maxBuffer: MAX_CHILD_OUTPUT_BYTES,
  });
  return found.status === 44;
}

async function runRecheckMode(service, helperPath) {
  if (
    !service.startsWith(`${KEYCHAIN_SERVICE_PREFIX}.`) ||
    !path.isAbsolute(helperPath) ||
    !fs.existsSync(helperPath) ||
    !fs.statSync(helperPath).isFile()
  ) return 64;
  const input = fs.readFileSync(0);
  if (input.length > 256) {
    input.fill(0);
    return 64;
  }
  const expectedIdentity = input.toString("utf8").replace(/\n$/, "");
  input.fill(0);
  if (!ACCOUNT_PATTERN.test(expectedIdentity)) return 64;
  let cookieValue = "";
  try {
    cookieValue = readKeychainSecret(helperPath, service);
    const projected = await projectSession(cookieValue, expectedIdentity);
    const output = {
      schema_version: 1,
      process_role: "keychain-session-recheck",
      session_loaded_from_keychain: true,
      observation: projected.observation,
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return observationPasses(projected.observation) ? 0 : 1;
  } catch (error) {
    const reason = REASON_PATTERN.test(error?.message || "")
      ? error.message
      : "recheck_failed";
    process.stdout.write(`${JSON.stringify({
      schema_version: 1,
      process_role: "keychain-session-recheck",
      session_loaded_from_keychain: false,
      error: reason,
    })}\n`);
    return 1;
  } finally {
    cookieValue = "";
  }
}

export function sanitizeRecheckOutput(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema_version !== 1 ||
    value.process_role !== "keychain-session-recheck" ||
    value.session_loaded_from_keychain !== true ||
    !exactKeys(value, [
      "schema_version",
      "process_role",
      "session_loaded_from_keychain",
      "observation",
    ]) ||
    !observationPasses(value.observation)
  ) throw new Error("recheck_output_invalid");
  return value.observation;
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
        timeout: REQUEST_TIMEOUT_MS + CONNECT_TIMEOUT_MS + 10_000,
        maxBuffer: MAX_CHILD_OUTPUT_BYTES,
        env: {},
      },
    );
    if (child.stdout.length > MAX_CHILD_OUTPUT_BYTES) {
      child.stdout.fill(0);
      throw new Error("recheck_output_oversized");
    }
    let parsed;
    try {
      parsed = JSON.parse(child.stdout.toString("utf8"));
    } finally {
      child.stdout.fill(0);
    }
    if (child.status === 0) {
      return { observation: sanitizeRecheckOutput(parsed), error: null };
    }
    if (
      child.status === 1 &&
      exactKeys(parsed, [
        "schema_version",
        "process_role",
        "session_loaded_from_keychain",
        "error",
      ]) &&
      parsed.schema_version === 1 &&
      parsed.process_role === "keychain-session-recheck" &&
      parsed.session_loaded_from_keychain === false &&
      REASON_PATTERN.test(parsed.error || "")
    ) return { observation: null, error: parsed.error };
    if (
      child.status === 1 &&
      exactKeys(parsed, [
        "schema_version",
        "process_role",
        "session_loaded_from_keychain",
        "observation",
      ]) &&
      parsed.schema_version === 1 &&
      parsed.process_role === "keychain-session-recheck" &&
      parsed.session_loaded_from_keychain === true
    ) return { observation: parsed.observation, error: "recheck_account_check_failed" };
    throw new Error("recheck_process_failed");
  } finally {
    input.fill(0);
  }
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
  const body = `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>AlgoLoom V-10</title><body style="font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:24px"><h1>AlgoLoom V-10 検証の準備</h1><p>別タブの拡張機能管理画面で次を手動実行してください。</p><ol><li>「デベロッパー モード」を有効にする。</li><li>「パッケージ化されていない拡張機能を読み込む」を押す。</li><li><code>${escapedDirectory}</code> を選ぶ。</li><li>このタブへ戻り、1回だけ再読み込みする。</li></ol><p>この専用ChromeはCDP、WebDriver、リモートデバッグを使用しません。拡張機能は明示操作後にAtCoderの<code>REVEL_SESSION</code>だけを読み取ります。</p></body>`;
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

function parseMainArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--json-output") {
    throw new Error("usage_invalid");
  }
  return { jsonOutput: argv[1] };
}

async function main(argv) {
  let args;
  try {
    args = parseMainArgs(argv);
  } catch (_) {
    console.error("使用方法: node scripts/verification/atcoder_v10_session.mjs --json-output <リポジトリ外の絶対パス>");
    return 64;
  }
  if (process.platform !== "darwin") {
    console.error("このV-10検証ヘルパーはmacOS Keychainを使うため、macOS専用です。");
    return 64;
  }
  if (
    !fs.existsSync(CHROME_PATH) ||
    !fs.existsSync(XCRUN_PATH) ||
    !fs.existsSync(KEYCHAIN_SOURCE_PATH)
  ) {
    console.error("Google ChromeまたはmacOS Security Framework用のビルド環境が見つかりません。");
    return 64;
  }
  const output = validateOutputPath(args.jsonOutput);
  if (output.reason !== null) {
    console.error("匿名化済み結果の保存先を受理できません:", output.reason);
    return 64;
  }

  const startedAt = utcNow();
  const result = buildResult(startedAt, chromeVersion());
  const state = new VerificationState();
  const token = crypto.randomBytes(32).toString("hex");
  const runId = crypto.randomBytes(16).toString("hex");
  const keychainService = `${KEYCHAIN_SERVICE_PREFIX}.${runId}.session`;
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "algoloom-v10-browser-"));
  fs.chmodSync(profileDirectory, 0o700);
  const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "algoloom-v10-runtime-"));
  fs.chmodSync(runtimeDirectory, 0o700);
  const keychainHelperPath = path.join(runtimeDirectory, "keychain-helper");
  result.observations.profile_preflight = {
    created_outside_repository: !isInside(REPOSITORY_ROOT, profileDirectory),
    owner_only: (fs.statSync(profileDirectory).mode & 0o077) === 0,
    initial_entry_count: fs.readdirSync(profileDirectory).length,
  };

  let browser = null;
  let keychainCreated = false;
  let terminalResolve;
  let activeCapture = false;
  let captureSettledResolve;
  let completed = false;
  let signalReason = null;
  const terminalPromise = new Promise((resolve) => { terminalResolve = resolve; });
  const captureSettledPromise = new Promise((resolve) => { captureSettledResolve = resolve; });

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
        const recorded = state.events.at(-1);
        applyEvent(result, recorded);
        console.log(`[${recorded.observed_at_utc}] ブラウザ観測: ${event.type}`);
        jsonResponse(response, 200, { accepted: true, stage: state.stage });
        if (state.terminal !== null) terminalResolve(state.terminal);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/capture") {
        if (state.stage !== "await_capture" || activeCapture) {
          throw new Error("capture_out_of_order");
        }
        activeCapture = true;
        let cookieValue = "";
        let expectedIdentity = "";
        try {
          const capture = sanitizeCapture(await readJsonBody(request));
          cookieValue = capture.cookieValue;
          expectedIdentity = capture.expectedIdentity;
          result.secret_persistence.cookie_read_by_extension = true;
          result.observations.cookie_capture = {
            ...capture.publicObservation,
            observed_at_utc: utcNow(),
          };

          const first = await projectSession(cookieValue, expectedIdentity);
          result.helper_request_count += 1;
          result.observations.initial_account_check = first.observation;
          if (!observationPasses(first.observation)) throw new Error("initial_account_check_failed");

          addKeychainSecret(keychainHelperPath, keychainService, cookieValue);
          keychainCreated = true;
          let keychainReadback = "";
          try {
            keychainReadback = readKeychainSecret(keychainHelperPath, keychainService);
            if (keychainReadback !== cookieValue) throw new Error("keychain_round_trip_mismatch");
          } finally {
            keychainReadback = "";
          }
          result.secret_persistence.cookie_written_to_keychain = true;
          result.observations.secret_store = {
            store: "macOS Keychain",
            write_succeeded: true,
            immediate_readback_succeeded: true,
            readback_value_matches: true,
            stored_session_source: "browser-captured-session-verified-by-initial-account-check",
            response_cookie_update_persisted: false,
            response_cookie_update_scope: "V-11-not-evaluated",
            plaintext_fallback_used: false,
            item_identifier_persisted_in_result: false,
          };

          const firstFinished = performance.now();
          const remaining = MIN_REQUEST_INTERVAL_MS - (performance.now() - firstFinished);
          if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
          const restarted = runRestartedRecheck(
            keychainHelperPath,
            keychainService,
            expectedIdentity,
          );
          result.helper_request_count += 1;
          if (restarted.observation !== null) {
            result.observations.restarted_process_account_check = restarted.observation;
          }
          if (restarted.error !== null) throw new Error(restarted.error);
          result.observations.process_restart = {
            fresh_process_completed: true,
            session_loaded_from_keychain: true,
            expected_identity_transport: "anonymous-stdin-pipe",
            cookie_or_identity_in_argv: false,
            cookie_or_identity_in_environment: false,
          };
          completed = true;
          state.terminal = "complete";
          result.browser_events.push({
            type: "session_captured_and_rechecked",
            observed_at_utc: utcNow(),
          });
          jsonResponse(response, 200, { accepted: true, stage: "complete" });
          terminalResolve("complete");
          return;
        } finally {
          cookieValue = "";
          expectedIdentity = "";
          activeCapture = false;
          captureSettledResolve();
        }
      }
      response.writeHead(404).end();
    } catch (error) {
      const reason = REASON_PATTERN.test(error?.message || "")
        ? error.message
        : "request_failed";
      result.observations.stop_reason = reason;
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
    compileKeychainHelper(keychainHelperPath);
    result.observations.keychain_helper = {
      implementation: "compiled-Swift-Security-Framework-helper",
      source_contains_secret: false,
      compiled_outside_repository: true,
      executable_owner_only: (fs.statSync(keychainHelperPath).mode & 0o077) === 0,
      executable_path_persisted_in_result: false,
    };
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

    console.log("\nAlgoLoom V-10・方式Aの認証検証");
    console.log("空の専用Google Chromeを通常表示で起動します。");
    console.log("別タブの拡張機能画面で検証専用拡張を人が手動読込してください。");
    console.log("読込対象:", EXTENSION_DIRECTORY);
    console.log("ログインとTurnstileはChrome上で人が操作します。");
    console.log("明示操作後、REVEL_SESSIONだけを一時的にmacOS Keychainへ保存します。");
    console.log("AtCoderへの提出とPOSTは行いません。操作上限は20分です。\n");

    browser = spawn(CHROME_PATH, chromeArguments, { stdio: "ignore" });
    browser.once("error", () => terminalResolve("browser_error"));
    browser.once("exit", () => {
      if (state.terminal === null && !activeCapture) terminalResolve("browser_closed");
    });
    const startupTimeout = setTimeout(() => {
      if (state.stage === "await_bootstrap") terminalResolve("extension_startup_timeout");
    }, 5 * 60 * 1_000);
    const timeout = setTimeout(() => terminalResolve("interaction_timeout"), INTERACTION_TIMEOUT_MS);
    const terminal = await terminalPromise;
    clearTimeout(startupTimeout);
    clearTimeout(timeout);
    if (activeCapture && !completed) {
      await Promise.race([
        captureSettledPromise,
        new Promise((resolve) => setTimeout(resolve, REQUEST_TIMEOUT_MS + CONNECT_TIMEOUT_MS + 15_000)),
      ]);
    }

    if (!completed) {
      const reason = result.observations.stop_reason || signalReason || terminal;
      if (state.terminal === null && !activeCapture) {
        const event = state.apply({ type: "aborted", reason });
        applyEvent(result, state.events.at(-1));
        terminalResolve(event.type);
      } else if (!result.observations.stop_reason) {
        result.observations.stop_reason = reason;
      }
      exitCode = terminal === "browser_closed" || terminal === "interaction_timeout" ? 2 : 1;
    } else {
      exitCode = 0;
    }
  } catch (error) {
    result.observations.stop_reason = REASON_PATTERN.test(error?.message || "")
      ? error.message
      : "helper_failure";
    console.error("V-10検証ヘルパーを完了できませんでした:", result.observations.stop_reason);
    exitCode = 3;
  } finally {
    if (browser !== null) result.cleanup.browser_exit_confirmed = await stopBrowser(browser);
    result.cleanup.orphan_profile_process_count = await stopProfileProcesses(profileDirectory);
    result.cleanup.loopback_server_closed = await closeServer(server);
    if (keychainCreated) {
      const deleted = deleteKeychainSecret(keychainHelperPath, keychainService);
      result.cleanup.keychain_item_removed = deleted &&
        keychainSecretAbsent(keychainHelperPath, keychainService);
    } else {
      result.cleanup.keychain_item_removed = fs.existsSync(keychainHelperPath)
        ? keychainSecretAbsent(keychainHelperPath, keychainService)
        : true;
    }
    try {
      fs.rmSync(profileDirectory, { recursive: true, force: false });
      result.cleanup.temporary_profile_removed = !fs.existsSync(profileDirectory);
    } catch (_) {
      result.cleanup.temporary_profile_removed = false;
    }
    try {
      fs.rmSync(runtimeDirectory, { recursive: true, force: false });
      result.cleanup.temporary_keychain_helper_removed = !fs.existsSync(runtimeDirectory);
    } catch (_) {
      result.cleanup.temporary_keychain_helper_removed = false;
    }
    const cleanupPassed = result.cleanup.browser_exit_confirmed &&
      result.cleanup.orphan_profile_process_count === 0 &&
      result.cleanup.temporary_profile_removed &&
      result.cleanup.temporary_keychain_helper_removed &&
      result.cleanup.loopback_server_closed &&
      result.cleanup.keychain_item_removed;
    result.v10 = completed && cleanupPassed ? "pass" : completed ? "fail" : "aborted";
    if (result.v10 !== "pass" && completed) exitCode = 3;
    result.finished_at_utc = utcNow();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }

  try {
    writeJsonExclusive(output.path, result);
  } catch (error) {
    console.error("匿名化済み結果を保存できませんでした:", error.message);
    return 3;
  }

  if (result.v10 === "pass") {
    console.log("V-10 合格: 方式Aのセッション確立、再起動後確認、後始末を完了しました。");
  } else {
    console.log(`V-10 ${result.v10}: 回避策や追加提出へ進まず停止しました。`);
  }
  console.log("Cookie、実際のアカウント名、Keychain項目識別子は結果へ保存していません。");
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--recheck") {
    process.exitCode = await runRecheckMode(
      process.argv[3] || "",
      process.argv[4] || "",
    );
  } else {
    process.exitCode = await main(process.argv.slice(2));
  }
}
