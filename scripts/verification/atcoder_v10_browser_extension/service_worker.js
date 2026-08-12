"use strict";

const LOOPBACK_KEY = "v10Loopback";
const EXPECTED_IDENTITY_KEY = "v10ExpectedIdentity";
const ACCOUNT_TAB_KEY = "v10AccountTab";
const ACCOUNT_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const SERVER_ERROR_PATTERN = /^[a-z0-9_]{1,80}$/;

function validLoopback(value) {
  return value !== null &&
    typeof value === "object" &&
    Number.isInteger(value.port) &&
    value.port >= 1024 &&
    value.port <= 65535 &&
    typeof value.token === "string" &&
    /^[0-9a-f]{64}$/.test(value.token);
}

async function getLoopback() {
  const stored = await chrome.storage.session.get(LOOPBACK_KEY);
  const value = stored[LOOPBACK_KEY];
  if (!validLoopback(value)) throw new Error("loopback_not_initialized");
  return value;
}

async function loopbackFetch(path, options = {}) {
  const loopback = await getLoopback();
  const response = await fetch(`http://127.0.0.1:${loopback.port}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${loopback.token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let reason = `loopback_http_${response.status}`;
    if (response.status === 409) {
      try {
        const body = await response.json();
        if (SERVER_ERROR_PATTERN.test(body?.error || "")) reason = body.error;
      } catch (_) {
        // Keep the bounded status-only fallback.
      }
    }
    throw new Error(reason);
  }
  return await response.json();
}

function settingsSender(sender) {
  try {
    const value = new URL(sender.url || "about:blank");
    return value.origin === "https://atcoder.jp" &&
      value.pathname === "/settings" &&
      Number.isInteger(sender.tab?.id);
  } catch (_) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message === null || typeof message !== "object") throw new Error("message_invalid");

    if (message.type === "initialize") {
      const senderUrl = new URL(sender.url || "about:blank");
      if (
        senderUrl.protocol !== "http:" ||
        senderUrl.hostname !== "127.0.0.1" ||
        senderUrl.pathname !== "/bootstrap"
      ) throw new Error("initializer_origin_invalid");
      const loopback = { port: message.port, token: message.token };
      if (!validLoopback(loopback) || Number(senderUrl.port) !== loopback.port) {
        throw new Error("initializer_value_invalid");
      }
      await chrome.storage.session.clear();
      await chrome.storage.session.set({ [LOOPBACK_KEY]: loopback });
      return await loopbackFetch("/event", {
        method: "POST",
        body: JSON.stringify({
          type: "bootstrap_ready",
          navigator_webdriver: message.navigator_webdriver === true,
        }),
      });
    }

    if (message.type === "event") {
      return await loopbackFetch("/event", {
        method: "POST",
        body: JSON.stringify(message.event),
      });
    }

    if (message.type === "set_expected_identity") {
      if (!settingsSender(sender) || !ACCOUNT_PATTERN.test(message.value || "")) {
        throw new Error("expected_identity_invalid");
      }
      await chrome.storage.session.set({
        [EXPECTED_IDENTITY_KEY]: message.value,
        [ACCOUNT_TAB_KEY]: sender.tab.id,
      });
      return { ok: true };
    }

    if (message.type === "capture_session") {
      if (!settingsSender(sender)) throw new Error("capture_sender_invalid");
      const stored = await chrome.storage.session.get([
        EXPECTED_IDENTITY_KEY,
        ACCOUNT_TAB_KEY,
      ]);
      const expectedIdentity = stored[EXPECTED_IDENTITY_KEY];
      if (
        !ACCOUNT_PATTERN.test(expectedIdentity || "") ||
        stored[ACCOUNT_TAB_KEY] !== sender.tab.id
      ) throw new Error("account_gate_missing");

      const candidates = await chrome.cookies.getAll({
        url: "https://atcoder.jp/",
        name: "REVEL_SESSION",
        path: "/",
        secure: true,
      });
      const allowed = candidates.filter((cookie) =>
        cookie.name === "REVEL_SESSION" &&
        new Set(["atcoder.jp", ".atcoder.jp"]).has(cookie.domain) &&
        cookie.path === "/" &&
        cookie.secure === true &&
        cookie.partitionKey === undefined
      );
      if (candidates.length !== 1 || allowed.length !== 1) {
        throw new Error("cookie_scope_not_unique");
      }
      const cookie = allowed[0];
      const response = await loopbackFetch("/capture", {
        method: "POST",
        body: JSON.stringify({
          candidate_count: candidates.length,
          cookie_name: cookie.name,
          cookie_domain: cookie.domain,
          cookie_path: cookie.path,
          cookie_secure: cookie.secure,
          cookie_http_only: cookie.httpOnly,
          cookie_host_only: cookie.hostOnly,
          cookie_session: cookie.session,
          cookie_partitioned: cookie.partitionKey !== undefined,
          cookie_value: cookie.value,
          expected_identity: expectedIdentity,
        }),
      });
      await chrome.storage.session.remove([EXPECTED_IDENTITY_KEY, ACCOUNT_TAB_KEY]);
      return response;
    }

    throw new Error("message_type_invalid");
  })()
    .then((value) => sendResponse({ ok: true, value }))
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error && SERVER_ERROR_PATTERN.test(error.message)
        ? error.message
        : "extension_failure",
    }));
  return true;
});
