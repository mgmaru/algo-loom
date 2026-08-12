#!/usr/bin/env node

/**
 * Reproduce the V-03 helper's Chrome/CDP startup path on an offline data URL,
 * or open Cloudflare's official compatibility checker without browser control.
 *
 * The default diagnostic does not use the network. The optional manual mode
 * visits only Cloudflare's official checker. Neither mode visits AtCoder,
 * enables the CDP Network domain, reads cookies, inspects storage, or persists
 * browser output.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_TIMEOUT_MS = 10_000;
const LOCAL_URL =
  "data:text/html,%3Ctitle%3EAlgoLoom%20local%20diagnostic%3C%2Ftitle%3E";
const COMPATIBILITY_URL = "https://browser-compat.turnstile.workers.dev/";

export const SIGNAL_EXPRESSION = String.raw`
(() => ({
  javascript_executed: true,
  navigator_webdriver: navigator.webdriver === true,
  cookies_enabled: navigator.cookieEnabled === true,
}))()
`;

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
    const page = targetInfos.find((item) => item.type === "page");
    if (page) return page;
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
    // The browser may already have exited.
  }
  if (await waitForExit(child, 5_000)) return true;
  child.kill("SIGTERM");
  if (await waitForExit(child, 3_000)) return true;
  child.kill("SIGKILL");
  return await waitForExit(child, 2_000);
}

export function sanitizeSignals(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("signals_invalid");
  }
  const expected = [
    "cookies_enabled",
    "javascript_executed",
    "navigator_webdriver",
  ];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    throw new Error("signals_invalid");
  }
  if (expected.some((key) => typeof value[key] !== "boolean")) {
    throw new Error("signals_invalid");
  }
  return value;
}

async function run() {
  const manualCompatibility =
    process.argv.length === 3 && process.argv[2] === "--manual-compatibility";
  if (process.argv.length !== 2 && !manualCompatibility) {
    console.error(
      "使用法: node scripts/verification/cloudflare_browser_local_diagnostic.mjs " +
        "[--manual-compatibility]",
    );
    return 64;
  }
  if (process.platform !== "darwin" || !fs.existsSync(CHROME_PATH)) {
    console.error("macOS版Google Chromeを確認できません。");
    return 64;
  }

  const profileRoot = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "algoloom-cloudflare-local-"),
  );
  fs.chmodSync(profileRoot, 0o700);
  const profilePath = path.join(profileRoot, "profile");
  fs.mkdirSync(profilePath, { mode: 0o700 });

  let child = null;
  let cdp = null;
  if (manualCompatibility) {
    let manualExitCode = 0;
    let interrupted = false;
    const onInterrupt = () => {
      interrupted = true;
      if (child !== null && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    };
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onInterrupt);
    console.log("Cloudflare公式の互換性チェッカーを、空の専用プロファイルで開きます。");
    console.log("リモートデバッグとCDP接続は使用しません。");
    console.log("結果を確認したら、この専用Chromeウィンドウを閉じてください。");
    try {
      child = spawn(
        CHROME_PATH,
        [
          `--user-data-dir=${profilePath}`,
          "--no-first-run",
          "--no-default-browser-check",
          COMPATIBILITY_URL,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      child.stderr.on("data", () => {});
      await new Promise((resolve) => child.once("exit", resolve));
      if (interrupted) manualExitCode = 130;
    } catch (_) {
      manualExitCode = 1;
    } finally {
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onInterrupt);
      if (child !== null && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await waitForExit(child, 5_000);
      }
      try {
        const prefix = path.join(
          fs.realpathSync(os.tmpdir()),
          "algoloom-cloudflare-local-",
        );
        const resolved = fs.realpathSync(profileRoot);
        if (!resolved.startsWith(prefix)) throw new Error("cleanup_path_invalid");
        fs.rmSync(resolved, { recursive: true, force: false });
        console.log("専用の一時プロファイルを削除しました。");
      } catch (_) {
        console.error("専用の一時プロファイルを削除できませんでした。");
        manualExitCode = 1;
      }
    }
    return manualExitCode;
  }
  const output = {
    scope: "offline-data-url-only",
    browser_mode: "visible-dedicated-profile",
    browser_control_channel: "remote-debugging-pipe",
    page_navigation: "cdp",
    chrome: null,
    signals: null,
    network_domain_enabled: false,
    cookie_or_storage_read: false,
    cleanup: {
      browser_exit_observed: false,
      temporary_profile_removed: false,
    },
  };

  try {
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
    output.chrome =
      typeof version.product === "string" && /^Chrome\/[0-9.]+$/.test(version.product)
        ? version.product
        : "unclassified";
    const target = await waitForPageTarget(cdp);
    const attached = await cdp.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    if (typeof attached.sessionId !== "string" || attached.sessionId.length === 0) {
      throw new Error("cdp_command_failed");
    }
    await cdp.send("Page.navigate", { url: LOCAL_URL }, attached.sessionId);
    const evaluated = await cdp.send(
      "Runtime.evaluate",
      { expression: SIGNAL_EXPRESSION, returnByValue: true },
      attached.sessionId,
    );
    if (
      evaluated.exceptionDetails ||
      evaluated.result?.type !== "object" ||
      evaluated.result?.value === undefined
    ) {
      throw new Error("signals_invalid");
    }
    output.signals = sanitizeSignals(evaluated.result.value);
    return 0;
  } catch (error) {
    output.error_class =
      error instanceof Error && /^[a-z_]+$/.test(error.message)
        ? error.message
        : "unexpected_error";
    return 1;
  } finally {
    if (child !== null && cdp !== null) {
      output.cleanup.browser_exit_observed = await closeBrowser(cdp, child);
    } else if (child !== null) {
      child.kill("SIGTERM");
      output.cleanup.browser_exit_observed = await waitForExit(child, 5_000);
    }
    try {
      const prefix = path.join(
        fs.realpathSync(os.tmpdir()),
        "algoloom-cloudflare-local-",
      );
      const resolved = fs.realpathSync(profileRoot);
      if (!resolved.startsWith(prefix)) throw new Error("cleanup_path_invalid");
      fs.rmSync(resolved, { recursive: true, force: false });
      output.cleanup.temporary_profile_removed = !fs.existsSync(resolved);
    } catch (_) {
      output.cleanup.temporary_profile_removed = false;
    }
    console.log(JSON.stringify(output, null, 2));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await run();
}
