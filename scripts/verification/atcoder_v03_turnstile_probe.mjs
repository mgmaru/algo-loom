#!/usr/bin/env node

/**
 * Observe the runtime state of the Turnstile widget on one AtCoder submit page.
 *
 * This helper intentionally does not read cookies, response token values, raw
 * HTML, network headers, source code, or POST bodies. Login runs without page
 * injection. After login is confirmed, the helper installs a browser-side blocker
 * before navigating to the target submission form.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TARGET_ORIGIN = "https://atcoder.jp";
const LOGIN_URL = `${TARGET_ORIGIN}/login`;
const TARGET_PATH = "/contests/abc300/submit";
const TARGET_PROBLEM = "abc300_a";
const TARGET_URL = `${TARGET_ORIGIN}${TARGET_PATH}?taskScreenName=${TARGET_PROBLEM}`;
const LOGIN_CONFIRMATION_PHRASE = "LOGIN COMPLETE";
const OBSERVATION_CONFIRMATION_PHRASE = "OBSERVE abc300_a";
const CDP_TIMEOUT_MS = 10_000;
const INTERACTION_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_COUNT = 100;

export const SUBMISSION_BLOCKER_SOURCE = String.raw`
(() => {
  "use strict";
  const targetOrigin = "https://atcoder.jp";
  const targetPath = "/contests/abc300/submit";
  const isTargetForm = (form) => {
    if (!(form instanceof HTMLFormElement)) return false;
    try {
      const action = new URL(form.getAttribute("action") || "", location.href);
      return action.origin === targetOrigin && action.pathname === targetPath;
    } catch (_) {
      return false;
    }
  };

  const state = { blockedSubmitEvents: 0, blockedDirectSubmits: 0 };
  Object.defineProperty(globalThis, "__algoloomV03Probe", {
    value: state,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  document.addEventListener("submit", (event) => {
    if (!isTargetForm(event.target)) return;
    state.blockedSubmitEvents += 1;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  const originalSubmit = HTMLFormElement.prototype.submit;
  Object.defineProperty(HTMLFormElement.prototype, "submit", {
    configurable: true,
    writable: true,
    value: function algoloomBlockedSubmit(...args) {
      if (isTargetForm(this)) {
        state.blockedDirectSubmits += 1;
        return undefined;
      }
      return Reflect.apply(originalSubmit, this, args);
    },
  });
})();
`;

const SNAPSHOT_EXPRESSION = String.raw`
(() => {
  "use strict";
  const targetOrigin = "https://atcoder.jp";
  const targetPath = "/contests/abc300/submit";
  const targetProblem = "abc300_a";
  const classifyUrl = () => {
    if (location.origin !== targetOrigin) return "other_origin";
    if (location.pathname === "/login") return "atcoder_login";
    if (location.pathname !== targetPath) return "other_atcoder_path";
    const values = new URLSearchParams(location.search).getAll("taskScreenName");
    return values.length === 1 && values[0] === targetProblem
      ? "target_submit"
      : "other_submit_query";
  };
  const isTargetForm = (form) => {
    try {
      const action = new URL(form.getAttribute("action") || "", location.href);
      return action.origin === targetOrigin && action.pathname === targetPath;
    } catch (_) {
      return false;
    }
  };
  const forms = Array.from(document.forms).filter(isTargetForm);
  const form = forms.length === 1 ? forms[0] : null;
  const responseFields = form
    ? Array.from(form.querySelectorAll('[name="cf-turnstile-response"]'))
    : [];
  const allResponseFields = Array.from(
    document.querySelectorAll('[name="cf-turnstile-response"]')
  );
  const widgets = form
    ? Array.from(form.querySelectorAll(".cf-turnstile, [data-sitekey]"))
    : [];
  const taskSelects = form
    ? Array.from(form.querySelectorAll('select[name="data.TaskScreenName"]'))
    : [];
  const languageSelects = form
    ? Array.from(form.querySelectorAll('select[name="data.LanguageId"]'))
    : [];
  const sourceFields = form
    ? Array.from(form.querySelectorAll('[name="sourceCode"]'))
    : [];
  const blocker = globalThis.__algoloomV03Probe;
  const identityPresent =
    typeof globalThis.userScreenName === "string" &&
    /^[A-Za-z0-9_]{1,64}$/.test(globalThis.userScreenName);

  return {
    url_class: classifyUrl(),
    target_form_count: forms.length,
    target_form_method_post:
      form !== null && String(form.method).toLowerCase() === "post",
    csrf_field_count: form
      ? form.querySelectorAll('input[name="csrf_token"]').length
      : 0,
    task_select_count: taskSelects.length,
    target_task_selected:
      taskSelects.length === 1 && taskSelects[0].value === targetProblem,
    language_select_count: languageSelects.length,
    source_code_field_count: sourceFields.length,
    source_code_nonempty_count: sourceFields.filter(
      (field) => typeof field.value === "string" && field.value.length > 0
    ).length,
    turnstile_widget_count: widgets.length,
    turnstile_response_field_count: responseFields.length,
    document_turnstile_response_field_count: allResponseFields.length,
    turnstile_response_nonempty_count: responseFields.filter(
      (field) => typeof field.value === "string" && field.value.trim().length > 0
    ).length,
    account_identity_present: identityPresent,
    submission_blocker_present:
      blocker !== null && typeof blocker === "object",
    blocked_submit_event_count:
      blocker && Number.isInteger(blocker.blockedSubmitEvents)
        ? blocker.blockedSubmitEvents
        : 0,
    blocked_direct_submit_count:
      blocker && Number.isInteger(blocker.blockedDirectSubmits)
        ? blocker.blockedDirectSubmits
        : 0,
    token_value_returned: false,
  };
})()
`;

const LOGIN_SNAPSHOT_EXPRESSION = String.raw`
(() => {
  "use strict";
  return {
    atcoder_origin: location.origin === "https://atcoder.jp",
    login_page: location.pathname === "/login",
    account_identity_present:
      typeof globalThis.userScreenName === "string" &&
      /^[A-Za-z0-9_]{1,64}$/.test(globalThis.userScreenName),
  };
})()
`;

const COUNT_KEYS = [
  "target_form_count",
  "csrf_field_count",
  "task_select_count",
  "language_select_count",
  "source_code_field_count",
  "source_code_nonempty_count",
  "turnstile_widget_count",
  "turnstile_response_field_count",
  "document_turnstile_response_field_count",
  "turnstile_response_nonempty_count",
  "blocked_submit_event_count",
  "blocked_direct_submit_count",
];

const BOOLEAN_KEYS = [
  "target_form_method_post",
  "target_task_selected",
  "account_identity_present",
  "submission_blocker_present",
  "token_value_returned",
];

const URL_CLASSES = new Set([
  "target_submit",
  "atcoder_login",
  "other_atcoder_path",
  "other_submit_query",
  "other_origin",
]);

export function repositoryRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateOutputPath(value, root = repositoryRoot()) {
  if (!path.isAbsolute(value)) {
    return { path: null, reason: "output_path_must_be_absolute" };
  }
  const parentInput = path.dirname(value);
  if (!fs.existsSync(parentInput) || !fs.statSync(parentInput).isDirectory()) {
    return { path: null, reason: "output_parent_missing" };
  }
  const parent = fs.realpathSync(parentInput);
  const resolved = path.join(parent, path.basename(value));
  const resolvedRoot = fs.realpathSync(root);
  if (isWithin(resolvedRoot, resolved)) {
    return { path: null, reason: "output_path_inside_repository" };
  }
  if ((fs.statSync(parent).mode & 0o077) !== 0) {
    return { path: null, reason: "output_parent_not_owner_only" };
  }
  if (typeof process.getuid === "function" && fs.statSync(parent).uid !== process.getuid()) {
    return { path: null, reason: "output_parent_not_owned_by_user" };
  }
  if (fs.existsSync(resolved)) {
    return { path: null, reason: "output_path_already_exists" };
  }
  return { path: resolved, reason: null };
}

export function sanitizeSnapshot(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("snapshot_not_object");
  }
  const allowedKeys = new Set(["url_class", ...COUNT_KEYS, ...BOOLEAN_KEYS]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("snapshot_unexpected_key");
  }
  if (!URL_CLASSES.has(value.url_class)) {
    throw new Error("snapshot_url_class_invalid");
  }
  const result = { url_class: value.url_class };
  for (const key of COUNT_KEYS) {
    const item = value[key];
    if (!Number.isInteger(item) || item < 0 || item > MAX_COUNT) {
      throw new Error(`snapshot_count_invalid:${key}`);
    }
    result[key] = item;
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof value[key] !== "boolean") {
      throw new Error(`snapshot_boolean_invalid:${key}`);
    }
    result[key] = value[key];
  }
  if (result.token_value_returned !== false) {
    throw new Error("snapshot_token_boundary_violated");
  }
  return result;
}

export function classifySnapshot(snapshot) {
  if (snapshot.url_class !== "target_submit") return "target_page_not_ready";
  const structureReady =
    snapshot.target_form_count === 1 &&
    snapshot.target_form_method_post === true &&
    snapshot.csrf_field_count === 1 &&
    snapshot.task_select_count === 1 &&
    snapshot.target_task_selected === true &&
    snapshot.language_select_count === 1 &&
    snapshot.source_code_field_count === 1 &&
    snapshot.source_code_nonempty_count === 0 &&
    snapshot.account_identity_present === true &&
    snapshot.submission_blocker_present === true;
  if (!structureReady) return "submit_page_structure_not_ready";
  if (snapshot.turnstile_widget_count !== 1) {
    return "turnstile_widget_not_unique";
  }
  if (
    snapshot.turnstile_response_field_count !== 1 ||
    snapshot.document_turnstile_response_field_count !== 1
  ) {
    return "turnstile_response_field_not_unique";
  }
  if (snapshot.turnstile_response_nonempty_count === 1) {
    return "turnstile_response_present";
  }
  return "turnstile_response_empty";
}

export function buildResult(startedAt) {
  return {
    schema_version: 1,
    verification_scope: ["V-03-turnstile-runtime-probe"],
    started_at_utc: startedAt,
    finished_at_utc: null,
    platform: {
      os: process.platform,
      architecture: process.arch,
      node: process.versions.node,
      kernel_release: os.release(),
      chrome: null,
    },
    target: {
      contest_id: "abc300",
      problem_id: TARGET_PROBLEM,
      page_class: "contest_submit",
    },
    method: {
      browser_mode: "visible-dedicated-profile",
      browser_control_channel: "remote-debugging-pipe",
      existing_profile_referenced: false,
      username_password_automation: false,
      turnstile_automation: false,
      cookie_extraction: false,
      network_domain_enabled: false,
      raw_html_read: false,
      screenshot_captured: false,
      page_script_injected_during_login: false,
      submission_blocker_installed_before_navigation: false,
      login_navigation_count: 0,
      target_navigation_count: 0,
      automatic_retries: 0,
      submission_post_limit: 0,
    },
    user_confirmation: {
      own_account_visually_confirmed: false,
      turnstile_completed_manually_or_noninteractively_in_visible_browser: false,
    },
    observation: null,
    classification: "not_run",
    v03: "not_run",
    submission_count: 0,
    token_value_persisted: false,
    cookie_value_persisted: false,
    raw_browser_protocol_persisted: false,
    browser_request_count: null,
    browser_request_count_reason:
      "network_observation_disabled_to_avoid_receiving_headers_or_post_data",
    cleanup: {
      browser_exit_observed: false,
      temporary_profile_removed: false,
      server_session_revoked: false,
    },
    error_class: null,
  };
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

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--json-output") {
    throw new Error("usage");
  }
  return { jsonOutput: argv[1] };
}

class CdpPipe {
  constructor(child) {
    this.writer = child.stdio[3];
    this.reader = child.stdio[4];
    this.nextId = 1;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.closed = false;
    this.reader.on("data", (chunk) => this.onData(chunk));
    this.reader.on("error", () => this.close(new Error("cdp_read_error")));
    this.writer.on("error", () => this.close(new Error("cdp_write_error")));
    child.once("exit", () => this.close(new Error("browser_exited")));
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const delimiter = this.buffer.indexOf(0);
      if (delimiter < 0) return;
      const payload = this.buffer.subarray(0, delimiter);
      this.buffer = this.buffer.subarray(delimiter + 1);
      if (payload.length === 0) continue;
      let message;
      try {
        message = JSON.parse(payload.toString("utf8"));
      } catch (_) {
        this.close(new Error("cdp_message_invalid"));
        return;
      }
      if (!Number.isInteger(message.id)) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error("cdp_command_failed"));
      else pending.resolve(message.result ?? {});
    }
  }

  send(method, params = {}, sessionId = undefined) {
    if (this.closed) return Promise.reject(new Error("cdp_closed"));
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId !== undefined) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("cdp_timeout"));
      }, CDP_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.writer.write(`${JSON.stringify(message)}\0`, "utf8", (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("cdp_write_error"));
      });
    });
  }

  close(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function waitForPageTarget(cdp) {
  const deadline = Date.now() + CDP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { targetInfos = [] } = await cdp.send("Target.getTargets");
    const pages = targetInfos.filter((item) => item.type === "page");
    const blank = pages.find((item) => item.url === "about:blank");
    if (blank) return blank;
    if (pages.length > 0) return pages[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("page_target_missing");
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

async function closeBrowser(cdp, child) {
  try {
    await cdp.send("Browser.close");
  } catch (_) {
    // The browser may already have been closed by the user.
  }
  if (await waitForExit(child, 5_000)) return true;
  child.kill("SIGTERM");
  if (await waitForExit(child, 3_000)) return true;
  child.kill("SIGKILL");
  return await waitForExit(child, 2_000);
}

function removeTemporaryProfile(profileRoot) {
  const expectedPrefix = path.join(fs.realpathSync(os.tmpdir()), "algoloom-v03-turnstile-");
  const resolved = fs.realpathSync(profileRoot);
  if (!resolved.startsWith(expectedPrefix)) {
    throw new Error("temporary_profile_path_unexpected");
  }
  fs.rmSync(resolved, { recursive: true, force: false });
  return !fs.existsSync(resolved);
}

function classifyError(error) {
  const allowed = new Set([
    "browser_exited",
    "cdp_closed",
    "cdp_command_failed",
    "cdp_message_invalid",
    "cdp_read_error",
    "cdp_timeout",
    "cdp_write_error",
    "interaction_timeout",
    "login_snapshot_invalid",
    "login_state_not_confirmed",
    "page_target_missing",
    "runtime_snapshot_missing",
    "snapshot_not_object",
    "snapshot_unexpected_key",
    "snapshot_url_class_invalid",
    "snapshot_token_boundary_violated",
    "temporary_profile_path_unexpected",
  ]);
  const message = error instanceof Error ? error.message : "unexpected_error";
  if (allowed.has(message)) return message;
  if (message.startsWith("snapshot_count_invalid:")) {
    return "snapshot_count_invalid";
  }
  if (message.startsWith("snapshot_boolean_invalid:")) {
    return "snapshot_boolean_invalid";
  }
  return "unexpected_error";
}

async function readConfirmation(rl, promptText, interactionDeadline) {
  const controller = new AbortController();
  let interrupted = false;
  const onInterrupt = () => {
    interrupted = true;
    controller.abort();
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);
  const remainingMs = Math.max(0, interactionDeadline - Date.now());
  const timer = setTimeout(() => controller.abort(), remainingMs);
  try {
    return await rl.question(promptText, { signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      if (interrupted) return "";
      throw new Error("interaction_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
  }
}

export function sanitizeLoginSnapshot(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("login_snapshot_invalid");
  }
  const keys = Object.keys(value).sort();
  const expected = [
    "account_identity_present",
    "atcoder_origin",
    "login_page",
  ].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error("login_snapshot_invalid");
  }
  if (keys.some((key) => typeof value[key] !== "boolean")) {
    throw new Error("login_snapshot_invalid");
  }
  return value;
}

async function run(argv) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("対話ターミナルではないため実行できません。");
    return 64;
  }
  let args;
  try {
    args = parseArgs(argv);
  } catch (_) {
    console.error(
      "使用法: node scripts/verification/atcoder_v03_turnstile_probe.mjs " +
        "--json-output /absolute/owner-only/path/result.json",
    );
    return 64;
  }
  if (process.platform !== "darwin" || !fs.existsSync(CHROME_PATH)) {
    console.error("この検証版が固定したmacOS版Google Chromeを確認できません。");
    return 64;
  }
  const outputValidation = validateOutputPath(args.jsonOutput);
  if (outputValidation.path === null) {
    console.error(`出力先を受理できません: ${outputValidation.reason}`);
    return 64;
  }

  const result = buildResult(new Date().toISOString());
  const profileRoot = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "algoloom-v03-turnstile-"),
  );
  fs.chmodSync(profileRoot, 0o700);
  const profilePath = path.join(profileRoot, "profile");
  fs.mkdirSync(profilePath, { mode: 0o700 });

  let child = null;
  let cdp = null;
  let rl = null;
  let exitCode = 1;
  try {
    console.log("\nAlgoLoom V-03 Turnstile実行時観測（提出なし）");
    console.log("空の専用Chromeプロファイルを可視状態で開きます。");
    console.log("ユーザー名、パスワード、TurnstileはChrome内で本人が操作してください。");
    console.log("ソースコードは入力せず、提出ボタンは押さないでください。");
    console.log("Cookie、Turnstileトークン値、HTML、ヘッダー、画面は取得しません。\n");

    child = spawn(
      CHROME_PATH,
      [
        `--user-data-dir=${profilePath}`,
        "--remote-debugging-pipe",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
    );
    child.stderr.on("data", () => {});
    cdp = new CdpPipe(child);
    const version = await cdp.send("Browser.getVersion");
    result.platform.chrome =
      typeof version.product === "string" && /^Chrome\/[0-9.]+$/.test(version.product)
        ? version.product
        : "unclassified";

    const target = await waitForPageTarget(cdp);
    const attached = await cdp.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    const sessionId = attached.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("cdp_command_failed");
    }
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const interactionDeadline = Date.now() + INTERACTION_TIMEOUT_MS;
    await cdp.send("Page.navigate", { url: LOGIN_URL }, sessionId);
    result.method.login_navigation_count = 1;
    console.log("Chromeを開きました。まずChrome内だけで次を行ってください。");
    console.log("1. 本人のAtCoderアカウントで通常どおりログインする。");
    console.log("2. Cloudflare検証がある場合は本人が手動で完了する。");
    console.log("3. ログイン後の画面で本人アカウントであることを確認する。\n");
    const loginConfirmation = await readConfirmation(
      rl,
      `ログインできた場合だけ ${LOGIN_CONFIRMATION_PHRASE} と入力: `,
      interactionDeadline,
    );
    if (loginConfirmation.trim() !== LOGIN_CONFIRMATION_PHRASE) {
      result.classification = "user_cancelled";
      result.v03 = "not_run";
      exitCode = 2;
    } else {
      const loginEvaluated = await cdp.send(
        "Runtime.evaluate",
        {
          expression: LOGIN_SNAPSHOT_EXPRESSION,
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId,
      );
      if (
        loginEvaluated.exceptionDetails ||
        loginEvaluated.result?.type !== "object" ||
        loginEvaluated.result?.value === undefined
      ) {
        throw new Error("login_snapshot_invalid");
      }
      const loginSnapshot = sanitizeLoginSnapshot(loginEvaluated.result.value);
      if (
        loginSnapshot.atcoder_origin !== true ||
        loginSnapshot.login_page !== false ||
        loginSnapshot.account_identity_present !== true
      ) {
        throw new Error("login_state_not_confirmed");
      }
      result.user_confirmation.own_account_visually_confirmed = true;

      await cdp.send(
        "Page.addScriptToEvaluateOnNewDocument",
        { source: SUBMISSION_BLOCKER_SOURCE },
        sessionId,
      );
      result.method.submission_blocker_installed_before_navigation = true;
      await cdp.send("Page.navigate", { url: TARGET_URL }, sessionId);
      result.method.target_navigation_count = 1;
      console.log("\n提出防止ガードを設定してabc300_aの提出ページを開きました。");
      console.log("1. Turnstileが表示された場合は手動で完了する。表示されない場合は待つ。");
      console.log("2. ソースコードを入力せず、提出ボタンを押さない。\n");
      const observationConfirmation = await readConfirmation(
        rl,
        `Turnstile状態を確認後、${OBSERVATION_CONFIRMATION_PHRASE} と入力: `,
        interactionDeadline,
      );
      if (observationConfirmation.trim() !== OBSERVATION_CONFIRMATION_PHRASE) {
        result.classification = "user_cancelled";
        result.v03 = "not_run";
        exitCode = 2;
      } else {
        result.user_confirmation.turnstile_completed_manually_or_noninteractively_in_visible_browser =
          true;
        const evaluated = await cdp.send(
          "Runtime.evaluate",
          {
            expression: SNAPSHOT_EXPRESSION,
            returnByValue: true,
            awaitPromise: true,
          },
          sessionId,
        );
        if (
          evaluated.exceptionDetails ||
          evaluated.result?.type !== "object" ||
          evaluated.result?.value === undefined
        ) {
          throw new Error("runtime_snapshot_missing");
        }
        const snapshot = sanitizeSnapshot(evaluated.result.value);
        result.observation = snapshot;
        result.classification = classifySnapshot(snapshot);
        result.v03 = "not_run";
        console.log(`\n匿名化した観測分類: ${result.classification}`);
        console.log("提出POSTは行っていません。Turnstileトークン値も取得していません。");
        exitCode = result.classification === "turnstile_response_present" ? 0 : 1;
      }
    }
  } catch (error) {
    result.error_class = classifyError(error);
    result.classification = "probe_error";
    result.v03 = "not_run";
    exitCode = 1;
  } finally {
    if (rl !== null) rl.close();
    if (child !== null && cdp !== null) {
      result.cleanup.browser_exit_observed = await closeBrowser(cdp, child);
    } else if (child !== null) {
      child.kill("SIGTERM");
      result.cleanup.browser_exit_observed = await waitForExit(child, 5_000);
    }
    try {
      result.cleanup.temporary_profile_removed = removeTemporaryProfile(profileRoot);
    } catch (_) {
      result.cleanup.temporary_profile_removed = false;
      if (result.error_class === null) result.error_class = "cleanup_failed";
      exitCode = 1;
    }
    result.finished_at_utc = new Date().toISOString();
    writeJsonExclusive(outputValidation.path, result);
    console.log("匿名化済み結果を指定先へ保存しました。");
    console.log("専用Chromeと一時プロファイルを後始末しました。");
    console.log("ローカル削除はAtCoder側のセッション失効を意味しません。");
  }
  return exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await run(process.argv.slice(2));
}
