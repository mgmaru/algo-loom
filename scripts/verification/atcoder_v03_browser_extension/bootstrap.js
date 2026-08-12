"use strict";

(async () => {
  if (location.pathname !== "/bootstrap") return;
  const parameters = new URLSearchParams(location.hash.slice(1));
  const port = Number(parameters.get("port"));
  const token = parameters.get("token") || "";
  history.replaceState(null, "", "/bootstrap");

  const response = await chrome.runtime.sendMessage({
    type: "initialize",
    port,
    token,
    navigator_webdriver: navigator.webdriver === true,
  });
  if (!response?.ok) {
    document.body.textContent = "検証ヘルパーを初期化できませんでした。ブラウザを閉じてください。";
    return;
  }

  const root = document.createElement("main");
  root.style.cssText =
    "font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:24px;color:#17202a";
  root.innerHTML = `
    <h1>AlgoLoom V-03 検証</h1>
    <p>この専用ブラウザはリモートデバッグ、CDP、WebDriverを使用していません。</p>
    <p>最初にCloudflare公式互換性チェッカーを開き、人の操作で <strong>Diagnostics passed</strong> を確認してください。</p>
    <p><a id="compat-link" href="https://browser-compat.turnstile.workers.dev/" target="_blank" rel="noreferrer noopener">公式互換性チェッカーを開く</a></p>
    <button id="compat-confirm" type="button">Diagnostics passed を確認した</button>
    <p id="next" hidden><a href="https://atcoder.jp/settings" target="_blank" rel="noreferrer noopener">AtCoderの設定ページを開く</a></p>
    <p>Cloudflare検証に失敗した場合は再試行や設定変更をせず、このブラウザを閉じてください。</p>
  `;
  document.body.replaceChildren(root);

  document.getElementById("compat-confirm").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    const confirmation = await chrome.runtime.sendMessage({
      type: "event",
      event: { type: "compatibility_confirmed" },
    });
    if (!confirmation?.ok) {
      root.append("確認結果を記録できませんでした。ブラウザを閉じてください。");
      return;
    }
    document.getElementById("next").hidden = false;
  }, { once: true });
})().catch(() => {
  document.body.textContent = "検証ヘルパーでエラーが発生しました。ブラウザを閉じてください。";
});
