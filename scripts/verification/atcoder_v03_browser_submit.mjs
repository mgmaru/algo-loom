#!/usr/bin/env node

/**
 * Run one human-approved AtCoder V-03 submission in a normal visible Chrome.
 *
 * Chrome is launched without CDP, WebDriver, a remote-debugging pipe, or a
 * remote-debugging port. A least-privilege unpacked extension communicates with
 * this process over an authenticated loopback endpoint. The person using the
 * browser completes login and Turnstile, reviews the submission gate, and clicks
 * AtCoder's own submit button. Cookie, CSRF, and Turnstile token values never
 * cross the browser boundary.
 */

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TARGET_ORIGIN = "https://atcoder.jp";
const CONTEST_ID = "abc300";
const PROBLEM_ID = "abc300_a";
const PROBLEM_URL = `${TARGET_ORIGIN}/contests/${CONTEST_ID}/tasks/${PROBLEM_ID}`;
const CANONICAL_LANGUAGE_ID = "python-cpython";
const SOURCE_ALIAS = "source-B";
const SUBMISSION_ALIAS = "submission-A";
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_EVENT_BYTES = 16 * 1024;
const INTERACTION_TIMEOUT_MS = 20 * 60 * 1_000;
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const EXTENSION_DIRECTORY = path.join(
  SCRIPT_DIRECTORY,
  "atcoder_v03_browser_extension",
);
const SUBMISSION_ID_PATTERN = /^[0-9]+$/;
const REASON_PATTERN = /^[a-z0-9_]{1,80}$/;

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
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

function booleanValue(value) {
  return value === true || value === false;
}

function sanitizeLanguage(value) {
  if (
    !exactKeys(value, [
      "atcoder_language_id",
      "display_name",
      "interpreter",
      "version",
    ]) ||
    typeof value.atcoder_language_id !== "string" ||
    !/^[0-9]{1,12}$/.test(value.atcoder_language_id) ||
    typeof value.display_name !== "string" ||
    !/^Python \(CPython [0-9][0-9A-Za-z._+\-]*\)$/.test(value.display_name) ||
    value.interpreter !== "CPython" ||
    typeof value.version !== "string" ||
    !/^[0-9][0-9A-Za-z._+\-]*$/.test(value.version)
  ) {
    throw new Error("event_language_invalid");
  }
  return { ...value };
}

export function sanitizeEvent(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("event_invalid");
  }
  switch (value.type) {
    case "bootstrap_ready":
      if (!exactKeys(value, ["type", "navigator_webdriver"]) || !booleanValue(value.navigator_webdriver)) {
        throw new Error("event_bootstrap_invalid");
      }
      return { ...value };
    case "compatibility_confirmed":
    case "send_started":
      if (!exactKeys(value, ["type"])) throw new Error("event_shape_invalid");
      return { type: value.type };
    case "account_checked":
      if (
        !exactKeys(value, [
          "type",
          "identity_count",
          "identity_matches_expected",
          "navigator_webdriver",
        ]) ||
        !boundedCount(value.identity_count) ||
        !booleanValue(value.identity_matches_expected) ||
        !booleanValue(value.navigator_webdriver)
      ) {
        throw new Error("event_account_invalid");
      }
      return { ...value };
    case "form_prepared": {
      const keys = [
        "type",
        "identity_count",
        "identity_matches_expected",
        "navigator_webdriver",
        "target_form_count",
        "target_form_method_post",
        "csrf_field_count",
        "target_task_count",
        "source_field_count",
        "source_editor_count",
        "source_editor_toggle_count",
        "plain_editor_mode",
        "editor_round_trip_verified",
        "canonical_language_candidate_count",
        "resolved_language",
        "source_byte_count",
        "baseline_submission_count",
        "turnstile_widget_count",
        "turnstile_response_field_count",
        "turnstile_token_read",
      ];
      if (
        !exactKeys(value, keys) ||
        !boundedCount(value.identity_count) ||
        !booleanValue(value.identity_matches_expected) ||
        !booleanValue(value.navigator_webdriver) ||
        !boundedCount(value.target_form_count) ||
        !booleanValue(value.target_form_method_post) ||
        !boundedCount(value.csrf_field_count) ||
        !boundedCount(value.target_task_count) ||
        !boundedCount(value.source_field_count) ||
        !boundedCount(value.source_editor_count) ||
        !boundedCount(value.source_editor_toggle_count) ||
        !booleanValue(value.plain_editor_mode) ||
        !booleanValue(value.editor_round_trip_verified) ||
        !boundedCount(value.canonical_language_candidate_count) ||
        !Number.isInteger(value.source_byte_count) ||
        value.source_byte_count <= 0 ||
        value.source_byte_count > MAX_SOURCE_BYTES ||
        !boundedCount(value.baseline_submission_count) ||
        !boundedCount(value.turnstile_widget_count) ||
        !boundedCount(value.turnstile_response_field_count) ||
        !booleanValue(value.turnstile_token_read)
      ) {
        throw new Error("event_form_invalid");
      }
      return { ...value, resolved_language: sanitizeLanguage(value.resolved_language) };
    }
    case "approval_granted":
      if (
        !exactKeys(value, [
          "type",
          "source_ownership_confirmed",
          "unique_submission_confirmed",
          "turnstile_completed_by_user",
          "ai_policy_presented",
          "no_automatic_resend_confirmed",
        ]) ||
        !Object.entries(value).every(([key, item]) => key === "type" || item === true)
      ) {
        throw new Error("event_approval_invalid");
      }
      return { ...value };
    case "remote_accepted":
      if (
        !exactKeys(value, ["type", "submission_id"]) ||
        typeof value.submission_id !== "string" ||
        !SUBMISSION_ID_PATTERN.test(value.submission_id)
      ) {
        throw new Error("event_submission_id_invalid");
      }
      return { ...value };
    case "aborted":
    case "remote_status_unknown":
      if (
        !exactKeys(value, ["type", "reason"]) ||
        typeof value.reason !== "string" ||
        !REASON_PATTERN.test(value.reason)
      ) {
        throw new Error("event_reason_invalid");
      }
      return { ...value };
    default:
      throw new Error("event_type_invalid");
  }
}

export class VerificationState {
  constructor(expectedSourceByteCount = null) {
    this.stage = "await_bootstrap";
    this.events = [];
    this.terminal = null;
    this.expectedSourceByteCount = expectedSourceByteCount;
  }

  apply(rawEvent) {
    if (this.terminal !== null) throw new Error("event_after_terminal");
    const event = sanitizeEvent(rawEvent);
    if (event.type === "aborted") {
      if (this.stage === "await_accepted") throw new Error("event_out_of_order");
      this.terminal = "aborted";
      this.events.push({ ...event, observed_at_utc: utcNow() });
      return event;
    }
    if (event.type === "remote_status_unknown") {
      if (!new Set(["await_send", "await_accepted"]).has(this.stage)) {
        throw new Error("event_out_of_order");
      }
      this.terminal = "remote_status_unknown";
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
    ) {
      throw new Error("account_gate_not_satisfied");
    }
    if (
      event.type === "form_prepared" &&
      (event.identity_count !== 1 ||
        !event.identity_matches_expected ||
        event.navigator_webdriver ||
        event.target_form_count !== 1 ||
        !event.target_form_method_post ||
        event.csrf_field_count !== 1 ||
        event.target_task_count !== 1 ||
        event.source_field_count !== 1 ||
        event.source_editor_count !== 1 ||
        event.source_editor_toggle_count !== 1 ||
        !event.plain_editor_mode ||
        !event.editor_round_trip_verified ||
        event.canonical_language_candidate_count !== 1 ||
        (this.expectedSourceByteCount !== null &&
          event.source_byte_count !== this.expectedSourceByteCount) ||
        event.turnstile_widget_count !== 1 ||
        event.turnstile_response_field_count !== 1 ||
        event.turnstile_token_read)
    ) {
      throw new Error("submission_gate_not_satisfied");
    }
    const transitions = {
      await_bootstrap: ["bootstrap_ready", "await_compat"],
      await_compat: ["compatibility_confirmed", "await_account"],
      await_account: ["account_checked", "await_form"],
      await_form: ["form_prepared", "await_approval"],
      await_approval: ["approval_granted", "await_send"],
      await_send: ["send_started", "await_accepted"],
      await_accepted: ["remote_accepted", "complete"],
    };
    const transition = transitions[this.stage];
    if (!transition || event.type !== transition[0]) throw new Error("event_out_of_order");
    this.stage = transition[1];
    if (this.stage === "complete") this.terminal = "complete";
    this.events.push({ ...event, observed_at_utc: utcNow() });
    return event;
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function validateSourcePath(sourcePath) {
  if (!path.isAbsolute(sourcePath)) return { path: null, reason: "source_path_must_be_absolute" };
  let resolved;
  let info;
  try {
    resolved = fs.realpathSync(sourcePath);
    info = fs.statSync(resolved);
  } catch (_) {
    return { path: null, reason: "source_path_unavailable" };
  }
  if (isInside(REPOSITORY_ROOT, resolved)) return { path: null, reason: "source_path_inside_repository" };
  if (!info.isFile()) return { path: null, reason: "source_path_not_regular_file" };
  if ((info.mode & 0o077) !== 0) return { path: null, reason: "source_file_not_owner_only" };
  let parentInfo;
  try {
    parentInfo = fs.statSync(path.dirname(resolved));
  } catch (_) {
    return { path: null, reason: "source_parent_unavailable" };
  }
  if ((parentInfo.mode & 0o077) !== 0) return { path: null, reason: "source_parent_not_owner_only" };
  return { path: resolved, reason: null };
}

export function validateOutputPath(outputPath) {
  if (!path.isAbsolute(outputPath)) return { path: null, reason: "output_path_must_be_absolute" };
  const resolved = path.resolve(outputPath);
  if (isInside(REPOSITORY_ROOT, resolved)) return { path: null, reason: "output_path_inside_repository" };
  if (fs.existsSync(resolved)) return { path: null, reason: "output_path_already_exists" };
  let parentInfo;
  try {
    parentInfo = fs.statSync(path.dirname(resolved));
  } catch (_) {
    return { path: null, reason: "output_parent_unavailable" };
  }
  if (!parentInfo.isDirectory()) return { path: null, reason: "output_parent_not_directory" };
  if ((parentInfo.mode & 0o077) !== 0) return { path: null, reason: "output_parent_not_owner_only" };
  return { path: resolved, reason: null };
}

export function writeJsonExclusive(outputPath, value) {
  const descriptor = fs.openSync(outputPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

export function buildChromeArguments(profileDirectory, bootstrapUrl) {
  return [
    ...CHROME_ARGUMENT_PREFIXES,
    `--user-data-dir=${profileDirectory}`,
    bootstrapUrl,
    "chrome://extensions/",
  ];
}

export function parseArgs(argv) {
  const result = { integrated_v04: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--integrated-v04") {
      if (result.integrated_v04) throw new Error("duplicate_argument:--integrated-v04");
      result.integrated_v04 = true;
      continue;
    }
    if (!new Set(["--source", "--json-output", "--state-output"]).has(argument)) {
      throw new Error(`unknown_argument:${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing_value:${argument}`);
    result[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  for (const name of ["source", "json_output", "state_output"]) {
    if (!result[name]) throw new Error(`missing_argument:${name}`);
  }
  return result;
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

export function buildResult(startedAt, sourceByteCount, version, integratedV04 = false) {
  return {
    schema_version: 1,
    verification_scope: ["V-03"],
    started_at_utc: startedAt,
    finished_at_utc: null,
    platform: {
      os: os.type(),
      os_release: os.release(),
      architecture: os.arch(),
      node: process.versions.node,
      chrome: version,
    },
    target: {
      contest_id: CONTEST_ID,
      problem_id: PROBLEM_ID,
      problem_url: PROBLEM_URL,
      canonical_language_id: CANONICAL_LANGUAGE_ID,
    },
    source: {
      alias: SOURCE_ALIAS,
      byte_count: sourceByteCount,
      hash_persisted: false,
      content_persisted: false,
    },
    method: {
      visible_browser: true,
      dedicated_empty_profile: true,
      browser_extension: "manually-loaded-verification-only-unpacked-extension",
      extension_installation_method: "chrome-extensions-load-unpacked",
      remote_debugging_pipe: false,
      remote_debugging_port: false,
      cdp: false,
      webdriver: false,
      headless: false,
      stealth_or_fingerprint_override: false,
      automated_login: false,
      automated_turnstile: false,
      programmatic_submit_click: false,
      cookie_api_permission: false,
      debugger_api_permission: false,
      webrequest_api_permission: false,
      loopback_bind_address: "127.0.0.1",
      loopback_authenticated: true,
      interaction_timeout_ms: INTERACTION_TIMEOUT_MS,
      automatic_retries: 0,
      submission_limit: 1,
      submission_limit_scope: integratedV04
        ? "updated-plan-authorized-v03-v04-integrated-run"
        : "original-v03-verification-run",
      followed_immediately_by_v04: integratedV04,
    },
    observations: {},
    browser_events: [],
    helper_observed_requests: {
      cloudflare_compatibility_page_navigation: 0,
      atcoder_settings_page_navigation: 0,
      atcoder_submit_page_navigation: 0,
      submission_list_baseline_get: 0,
      submission_form_submit_event: 0,
      submission_result_page_navigation: 0,
    },
    browser_internal_request_count_known: false,
    approval: {
      approved: false,
      source_ownership_confirmed: false,
      unique_submission_confirmed: false,
      turnstile_completed_by_user: false,
      ai_policy_presented: false,
      no_automatic_resend_confirmed: false,
    },
    remote_state: "PREPARED",
    submission_post_attempts: 0,
    submission_count: 0,
    submission_id_obtained: false,
    submission_alias: null,
    v03: "not_run",
    temporary_state_written: false,
    cleanup: {
      browser_exit_confirmed: false,
      temporary_profile_removed: false,
      loopback_server_closed: false,
    },
    secret_persistence: {
      cookie_read_by_helper: false,
      cookie_written_to_file: false,
      csrf_token_read_by_helper: false,
      csrf_token_written_to_file: false,
      turnstile_token_read_by_helper: false,
      turnstile_token_written_to_file: false,
      expected_identity_written_to_file: false,
      actual_identity_returned_to_helper: false,
      raw_headers_written_to_file: false,
      raw_html_written_to_file: false,
      source_written_by_helper: false,
      source_hash_written_to_file: false,
      actual_submission_id_in_anonymized_result: false,
    },
  };
}

function publicEvent(event) {
  if (event.type === "remote_accepted") {
    return {
      type: event.type,
      submission_id_present: true,
      observed_at_utc: event.observed_at_utc,
    };
  }
  return { ...event };
}

function applyEventToResult(result, event) {
  result.browser_events.push(publicEvent(event));
  switch (event.type) {
    case "bootstrap_ready":
      result.observations.local_browser_signal = {
        extension_loaded: true,
        navigator_webdriver: event.navigator_webdriver,
      };
      break;
    case "compatibility_confirmed":
      result.helper_observed_requests.cloudflare_compatibility_page_navigation = 1;
      result.observations.cloudflare_compatibility = {
        diagnostics_passed_confirmed_by_user: true,
      };
      break;
    case "account_checked":
      result.helper_observed_requests.atcoder_settings_page_navigation = 1;
      result.observations.account_check = {
        identity_count: event.identity_count,
        identity_matches_expected: event.identity_matches_expected,
        navigator_webdriver: event.navigator_webdriver,
      };
      break;
    case "form_prepared":
      result.helper_observed_requests.atcoder_submit_page_navigation = 1;
      result.helper_observed_requests.submission_list_baseline_get = 1;
      result.observations.submit_form = { ...event };
      delete result.observations.submit_form.type;
      break;
    case "approval_granted":
      result.approval = {
        approved: true,
        approved_at_utc: event.observed_at_utc,
        source_ownership_confirmed: true,
        unique_submission_confirmed: true,
        turnstile_completed_by_user: true,
        ai_policy_presented: true,
        no_automatic_resend_confirmed: true,
      };
      break;
    case "send_started":
      result.remote_state = "SEND_STARTED";
      result.submission_post_attempts = 1;
      result.helper_observed_requests.submission_form_submit_event = 1;
      break;
    case "remote_accepted":
      result.remote_state = "REMOTE_ACCEPTED";
      result.submission_count = 1;
      result.submission_id_obtained = true;
      result.submission_alias = SUBMISSION_ALIAS;
      result.v03 = "pass";
      result.helper_observed_requests.submission_result_page_navigation = 1;
      break;
    case "aborted":
      result.v03 = "aborted";
      result.observations.stop_reason = event.reason;
      break;
    case "remote_status_unknown":
      result.remote_state = "REMOTE_STATUS_UNKNOWN";
      result.v03 = "unknown";
      result.observations.stop_reason = event.reason;
      break;
    default:
      break;
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
    if (total > MAX_EVENT_BYTES) throw new Error("event_body_oversized");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
  const escapedExtensionDirectory = EXTENSION_DIRECTORY
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const body = `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>AlgoLoom V-03</title><body style="font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:24px"><h1>AlgoLoom V-03 検証の準備</h1><p>別タブの拡張機能管理画面で次を手動実行してください。</p><ol><li>「デベロッパー モード」を有効にする。</li><li>「パッケージ化されていない拡張機能を読み込む」を押す。</li><li><code>${escapedExtensionDirectory}</code> を選ぶ。</li><li>このタブへ戻り、1回だけ再読み込みする。</li></ol><p>Chrome公式の手動読込手順を使います。CDP、WebDriver、リモートデバッグは使用しません。</p></body>`;
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

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error("引数を受理できません:", error.message);
    return 64;
  }

  if (!fs.existsSync(CHROME_PATH) || !fs.statSync(CHROME_PATH).isFile()) {
    console.error("Google Chromeの実行ファイルが見つかりません。");
    return 64;
  }
  const sourceValidation = validateSourcePath(args.source);
  const jsonValidation = validateOutputPath(args.json_output);
  const stateValidation = validateOutputPath(args.state_output);
  if (sourceValidation.reason || jsonValidation.reason || stateValidation.reason) {
    console.error(
      "入出力パスを受理できません:",
      sourceValidation.reason || jsonValidation.reason || stateValidation.reason,
    );
    return 64;
  }
  if (jsonValidation.path === stateValidation.path) {
    console.error("匿名化済み結果と一時状態は別のパスにしてください。");
    return 64;
  }

  let sourceBuffer = fs.readFileSync(sourceValidation.path);
  if (sourceBuffer.length === 0 || sourceBuffer.length > MAX_SOURCE_BYTES) {
    console.error("ソースコードの大きさを受理できません。");
    return 64;
  }
  const source = sourceBuffer.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(sourceBuffer)) {
    console.error("ソースコードはUTF-8である必要があります。");
    return 64;
  }
  const sourceSha256 = crypto.createHash("sha256").update(sourceBuffer).digest("hex");
  const startedAt = utcNow();
  const result = buildResult(
    startedAt,
    sourceBuffer.length,
    chromeVersion(),
    args.integrated_v04,
  );
  const stateMachine = new VerificationState(sourceBuffer.length);
  const token = crypto.randomBytes(32).toString("hex");
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "algoloom-v03-browser-"));
  fs.chmodSync(profileDirectory, 0o700);
  let acceptedSubmissionId = null;
  let browser = null;
  let terminalResolve;
  const terminalPromise = new Promise((resolve) => {
    terminalResolve = resolve;
  });

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
      if (request.method === "GET" && requestUrl.pathname === "/config") {
        if (!new Set(["await_form", "await_approval"]).has(stateMachine.stage)) {
          throw new Error("config_out_of_order");
        }
        jsonResponse(response, 200, {
          source,
          source_byte_count: sourceBuffer.length,
          source_sha256: sourceSha256,
          source_alias: SOURCE_ALIAS,
          canonical_language_id: CANONICAL_LANGUAGE_ID,
          problem_id: PROBLEM_ID,
          helper_stage: stateMachine.stage,
          verification_mode: args.integrated_v04 ? "v04_integrated" : "v03_original",
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/event") {
        const event = stateMachine.apply(await readJsonBody(request));
        const recorded = stateMachine.events.at(-1);
        applyEventToResult(result, recorded);
        console.log(`[${recorded.observed_at_utc}] ブラウザ観測: ${event.type}`);
        if (event.type === "remote_accepted") acceptedSubmissionId = event.submission_id;
        jsonResponse(response, 200, { accepted: true, stage: stateMachine.stage });
        if (stateMachine.terminal !== null) terminalResolve(stateMachine.terminal);
        return;
      }
      response.writeHead(404).end();
    } catch (error) {
      jsonResponse(response, 409, {
        accepted: false,
        error: error instanceof Error ? error.message : "request_failed",
      });
    }
  });

  let signalReason = null;
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
    if (chromeArguments.some((argument) => /remote-debugging|headless|AutomationControlled/i.test(argument))) {
      throw new Error("forbidden_browser_argument");
    }

    console.log(
      args.integrated_v04
        ? "\nAlgoLoom V-03→V-04統合検証・通常ブラウザによる1回限りの提出"
        : "\nAlgoLoom V-03・通常ブラウザによる1回限りの提出検証",
    );
    console.log("別タブの拡張機能管理画面で、検証専用拡張を手動読込してください。");
    console.log("読込対象:", EXTENSION_DIRECTORY);
    console.log("その後、専用ChromeでCloudflare互換性確認、AtCoderログイン、アカウント照合、提出承認を行ってください。");
    console.log("ログインとTurnstile、AtCoder本体の提出ボタンは人が操作します。");
    if (args.integrated_v04) {
      console.log("この提出は、更新済み検証計画で許可された統合実行の1件として扱います。");
      console.log("提出ID取得後は親スクリプトがV-04を自動開始します。ターミナルを閉じないでください。");
    }
    console.log("応答が不明でも再提出しません。操作上限は20分です。\n");

    browser = spawn(CHROME_PATH, chromeArguments, {
      stdio: "ignore",
    });
    browser.once("error", () => terminalResolve("browser_error"));
    browser.once("exit", () => {
      if (stateMachine.terminal === null) terminalResolve("browser_closed");
    });

    const startupTimeout = setTimeout(() => {
      if (stateMachine.stage === "await_bootstrap") {
        terminalResolve("extension_startup_timeout");
      }
    }, 5 * 60 * 1_000);
    const timeout = setTimeout(() => terminalResolve("timeout"), INTERACTION_TIMEOUT_MS);
    const terminal = await terminalPromise;
    clearTimeout(startupTimeout);
    clearTimeout(timeout);

    if (stateMachine.terminal === null) {
      const reason = signalReason || (terminal === "timeout" ? "interaction_timeout" : terminal);
      const event = stateMachine.apply({
        type: stateMachine.stage === "await_accepted"
          ? "remote_status_unknown"
          : "aborted",
        reason,
      });
      applyEventToResult(result, stateMachine.events.at(-1));
      terminalResolve(event.type);
    }

    if (stateMachine.terminal === "complete" && acceptedSubmissionId !== null) {
      const temporaryState = {
        schema_version: 1,
        purpose: "temporary-state-for-V-04-and-V-06",
        submission_alias: SUBMISSION_ALIAS,
        contest_id: CONTEST_ID,
        problem_id: PROBLEM_ID,
        submission_id: acceptedSubmissionId,
        recorded_at_utc: utcNow(),
      };
      writeJsonExclusive(stateValidation.path, temporaryState);
      result.temporary_state_written = true;
      exitCode = 0;
    } else if (stateMachine.terminal === "aborted") {
      exitCode = 2;
    }
  } catch (error) {
    if (stateMachine.terminal === null) {
      const reason = REASON_PATTERN.test(error.message || "") ? error.message : "helper_failure";
      stateMachine.apply({
        type: stateMachine.stage === "await_accepted"
          ? "remote_status_unknown"
          : "aborted",
        reason,
      });
      applyEventToResult(result, stateMachine.events.at(-1));
    }
    console.error("検証ヘルパーを完了できませんでした:", error.message);
    exitCode = 3;
  } finally {
    sourceBuffer.fill(0);
    sourceBuffer = Buffer.alloc(0);
    if (browser !== null) result.cleanup.browser_exit_confirmed = await stopBrowser(browser);
    result.cleanup.loopback_server_closed = await closeServer(server);
    try {
      fs.rmSync(profileDirectory, { recursive: true, force: false });
      result.cleanup.temporary_profile_removed = !fs.existsSync(profileDirectory);
    } catch (_) {
      result.cleanup.temporary_profile_removed = false;
      exitCode = 3;
    }
    result.finished_at_utc = utcNow();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }

  try {
    writeJsonExclusive(jsonValidation.path, result);
  } catch (error) {
    console.error("匿名化済み結果を保存できませんでした:", error.message);
    console.error("提出操作は再実行しないでください。");
    return 3;
  }

  if (result.v03 === "pass") {
    console.log("V-03 合格: AtCoderが提出を受理し、submission-AのIDを取得しました。");
    console.log("実際の提出IDはV-04/V-06用の一時状態へだけ保存しました。");
  } else {
    console.log(`V-03 ${result.v03}: 提出を再実行せず停止しました。`);
  }
  console.log("匿名化済み結果を保存し、専用ブラウザと一時プロファイルを後始末しました。");
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
