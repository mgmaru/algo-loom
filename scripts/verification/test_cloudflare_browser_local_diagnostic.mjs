import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  SIGNAL_EXPRESSION,
  sanitizeSignals,
} from "./cloudflare_browser_local_diagnostic.mjs";

const HELPER_SOURCE = fs.readFileSync(
  new URL("./cloudflare_browser_local_diagnostic.mjs", import.meta.url),
  "utf8",
);

test("accepts only the bounded local signal shape", () => {
  assert.deepEqual(
    sanitizeSignals({
      javascript_executed: true,
      navigator_webdriver: false,
      cookies_enabled: true,
    }),
    {
      javascript_executed: true,
      navigator_webdriver: false,
      cookies_enabled: true,
    },
  );
  assert.throws(
    () =>
      sanitizeSignals({
        javascript_executed: true,
        navigator_webdriver: false,
        cookies_enabled: true,
        user_agent: "unexpected",
      }),
    /signals_invalid/,
  );
});

test("keeps the local signal path outside cookie and network protocol domains", () => {
  assert.match(HELPER_SOURCE, /data:text\/html/);
  assert.match(HELPER_SOURCE, /--remote-debugging-pipe/);
  assert.match(HELPER_SOURCE, /"Page\.navigate"/);
  assert.doesNotMatch(HELPER_SOURCE, /https:\/\/atcoder\.jp/);
  assert.match(
    HELPER_SOURCE,
    /https:\/\/browser-compat\.turnstile\.workers\.dev\//,
  );
  assert.doesNotMatch(HELPER_SOURCE, /["']Network\./);
  assert.doesNotMatch(HELPER_SOURCE, /["'](?:Network|Storage)\.getCookies/);
  assert.doesNotMatch(SIGNAL_EXPRESSION, /userAgent|plugins|languages|hardwareConcurrency/);
  assert.match(HELPER_SOURCE, /process\.once\("SIGINT"/);
  assert.match(HELPER_SOURCE, /process\.once\("SIGTERM"/);
});
