"use strict";

const LOOPBACK_KEY = "v03Loopback";
const EXPECTED_IDENTITY_KEY = "v03ExpectedIdentity";
const BASELINE_IDS_KEY = "v03BaselineIds";
const SUBMIT_TAB_KEY = "v03SubmitTab";
const ACCOUNT_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const SUBMISSION_ID_PATTERN = /^[0-9]+$/;
const SERVER_ERROR_PATTERN = /^[a-z0-9_]{1,80}$/;

function validLoopback(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isInteger(value.port) &&
    value.port >= 1024 &&
    value.port <= 65535 &&
    typeof value.token === "string" &&
    /^[0-9a-f]{64}$/.test(value.token)
  );
}

function validSubmissionIds(value) {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((item) => typeof item === "string" && SUBMISSION_ID_PATTERN.test(item)) &&
    new Set(value).size === value.length
  );
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
        // Keep the bounded status-only fallback when the response is malformed.
      }
    }
    throw new Error(reason);
  }
  return response;
}

async function postEvent(event) {
  const response = await loopbackFetch("/event", {
    method: "POST",
    body: JSON.stringify(event),
  });
  return await response.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message === null || typeof message !== "object") {
      throw new Error("message_invalid");
    }

    if (message.type === "initialize") {
      const senderUrl = new URL(sender.url || "about:blank");
      if (
        senderUrl.protocol !== "http:" ||
        senderUrl.hostname !== "127.0.0.1" ||
        senderUrl.pathname !== "/bootstrap"
      ) {
        throw new Error("initializer_origin_invalid");
      }
      const loopback = { port: message.port, token: message.token };
      if (!validLoopback(loopback) || Number(senderUrl.port) !== loopback.port) {
        throw new Error("initializer_value_invalid");
      }
      await chrome.storage.session.clear();
      await chrome.storage.session.set({ [LOOPBACK_KEY]: loopback });
      return await postEvent({
        type: "bootstrap_ready",
        navigator_webdriver: message.navigator_webdriver === true,
      });
    }

    if (message.type === "event") {
      return await postEvent(message.event);
    }

    if (message.type === "get_config") {
      const response = await loopbackFetch("/config", { method: "GET" });
      return await response.json();
    }

    if (message.type === "claim_submit_page") {
      const senderUrl = new URL(sender.url || "about:blank");
      const taskValues = senderUrl.searchParams.getAll("taskScreenName");
      if (
        senderUrl.origin !== "https://atcoder.jp" ||
        senderUrl.pathname !== "/contests/abc300/submit" ||
        taskValues.length !== 1 ||
        taskValues[0] !== "abc300_a" ||
        !Number.isInteger(sender.tab?.id)
      ) {
        throw new Error("submit_page_sender_invalid");
      }
      const stored = await chrome.storage.session.get(SUBMIT_TAB_KEY);
      const activeTab = stored[SUBMIT_TAB_KEY];
      if (activeTab === undefined) {
        await chrome.storage.session.set({ [SUBMIT_TAB_KEY]: sender.tab.id });
        return { claimed: true };
      }
      return { claimed: activeTab === sender.tab.id };
    }

    if (message.type === "set_expected_identity") {
      if (!ACCOUNT_PATTERN.test(message.value || "")) {
        throw new Error("expected_identity_invalid");
      }
      await chrome.storage.session.set({
        [EXPECTED_IDENTITY_KEY]: message.value,
      });
      return { ok: true };
    }

    if (message.type === "get_expected_identity") {
      const stored = await chrome.storage.session.get(EXPECTED_IDENTITY_KEY);
      const value = stored[EXPECTED_IDENTITY_KEY];
      if (!ACCOUNT_PATTERN.test(value || "")) {
        throw new Error("expected_identity_missing");
      }
      return { value };
    }

    if (message.type === "set_baseline_ids") {
      if (!validSubmissionIds(message.value)) {
        throw new Error("baseline_ids_invalid");
      }
      await chrome.storage.session.set({ [BASELINE_IDS_KEY]: message.value });
      return { ok: true };
    }

    if (message.type === "get_baseline_ids") {
      const stored = await chrome.storage.session.get(BASELINE_IDS_KEY);
      const value = stored[BASELINE_IDS_KEY];
      if (!validSubmissionIds(value)) {
        throw new Error("baseline_ids_missing");
      }
      return { value };
    }

    if (message.type === "clear_sensitive_state") {
      await chrome.storage.session.remove([
        EXPECTED_IDENTITY_KEY,
        BASELINE_IDS_KEY,
        SUBMIT_TAB_KEY,
      ]);
      return { ok: true };
    }

    throw new Error("message_type_invalid");
  })()
    .then((value) => sendResponse({ ok: true, value }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      }),
    );
  return true;
});
