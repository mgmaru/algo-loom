"use strict";

const ACCOUNT_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const IDENTITY_PATTERN = /var\s+userScreenName\s*=\s*"([A-Za-z0-9_]{1,64})"\s*;/g;

function pageIdentities() {
  const identities = new Set();
  for (const script of document.scripts) {
    for (const match of (script.textContent || "").matchAll(IDENTITY_PATTERN)) {
      identities.add(match[1]);
    }
  }
  return [...identities].sort();
}

(async () => {
  if (location.origin !== "https://atcoder.jp" || location.pathname !== "/settings") return;
  if (document.getElementById("algoloom-v10-panel")) return;

  const identities = pageIdentities();
  const panel = document.createElement("section");
  panel.id = "algoloom-v10-panel";
  panel.style.cssText =
    "position:relative;z-index:2147483647;margin:16px auto;padding:20px;max-width:760px;border:3px solid #2563eb;background:#eff6ff;color:#17202a;font:16px/1.6 system-ui,sans-serif";
  panel.innerHTML = `
    <h2 style="margin-top:0">AlgoLoom 方式A 認証確認（V-10/V-11）</h2>
    <p>この画面が期待する本人アカウントか目視確認してください。パスワードやTurnstileの値は拡張機能へ渡されません。</p>
    <label>期待するAtCoderアカウント名（画面には表示しません）<br><input id="algoloom-v10-identity" type="password" autocomplete="off" spellcheck="false"></label>
    <p><button id="algoloom-v10-check" type="button">本人アカウントを照合する</button></p>
    <p id="algoloom-v10-status">照合前です。</p>
    <button id="algoloom-v10-capture" type="button" disabled>REVEL_SESSIONだけを取り込む</button>
    <p>取り込み後、ヘルパーは読み取り専用の本人照合と秘密情報保管庫の確認を行います。提出は行いません。</p>
  `;
  document.body.prepend(panel);

  const input = document.getElementById("algoloom-v10-identity");
  const check = document.getElementById("algoloom-v10-check");
  const capture = document.getElementById("algoloom-v10-capture");
  const status = document.getElementById("algoloom-v10-status");

  check.addEventListener("click", async () => {
    check.disabled = true;
    const expected = input.value;
    input.value = "";
    const matches = identities.length === 1 &&
      ACCOUNT_PATTERN.test(expected) &&
      identities[0] === expected &&
      navigator.webdriver !== true;
    if (!matches) {
      status.textContent = "本人照合に失敗しました。取り込まずブラウザを閉じてください。";
      return;
    }
    const stored = await chrome.runtime.sendMessage({
      type: "set_expected_identity",
      value: expected,
    });
    const recorded = stored?.ok
      ? await chrome.runtime.sendMessage({
        type: "event",
        event: {
          type: "account_checked",
          identity_count: identities.length,
          identity_matches_expected: true,
          navigator_webdriver: navigator.webdriver === true,
        },
      })
      : null;
    if (!recorded?.ok) {
      status.textContent = "照合結果を記録できませんでした。取り込まずブラウザを閉じてください。";
      return;
    }
    status.textContent = "本人照合に成功しました。明示的に取り込む場合だけ下のボタンを押してください。";
    capture.disabled = false;
  }, { once: true });

  capture.addEventListener("click", async () => {
    capture.disabled = true;
    status.textContent = "Cookie限定取得、本人照合、Keychain保存、再起動後確認を実行中です。";
    const response = await chrome.runtime.sendMessage({ type: "capture_session" });
    status.textContent = response?.ok
      ? "認証セッションの観測が完了しました。この専用ブラウザを閉じてください。"
      : "認証セッションの観測を完了できませんでした。再試行せずブラウザを閉じてください。";
  }, { once: true });
})().catch(() => {
  const panel = document.getElementById("algoloom-v10-panel");
  if (panel) panel.textContent = "検証ヘルパーでエラーが発生しました。再試行せずブラウザを閉じてください。";
});
