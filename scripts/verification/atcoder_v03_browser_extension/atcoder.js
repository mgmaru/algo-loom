"use strict";

(() => {
  const TARGET_ORIGIN = "https://atcoder.jp";
  const CONTEST_ID = "abc300";
  const PROBLEM_ID = "abc300_a";
  const SUBMIT_PATH = `/contests/${CONTEST_ID}/submit`;
  const SUBMISSIONS_PATH = `/contests/${CONTEST_ID}/submissions/me`;
  const PROBLEM_PATH = `/contests/${CONTEST_ID}/tasks/${PROBLEM_ID}`;
  const LANGUAGE_FIELD_NAME = "data.LanguageId";
  const CPYTHON_PATTERN = /^Python\s+\(CPython\s+([0-9][0-9A-Za-z._+\-]*)\)$/;
  const SUBMISSION_PATH_PATTERN = new RegExp(
    `^/contests/${CONTEST_ID}/submissions/([0-9]+)$`,
  );
  const ACCOUNT_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
  const IDENTITY_PATTERN = /var\s+userScreenName\s*=\s*"([A-Za-z0-9_]{1,64})"\s*;/g;
  const SOURCE_GUARD = globalThis.AlgoLoomV03SourceGuard;
  if (
    !SOURCE_GUARD ||
    typeof SOURCE_GUARD.isAceEditorMode !== "function" ||
    typeof SOURCE_GUARD.isPlainEditorMode !== "function" ||
    typeof SOURCE_GUARD.serializedSourceMatches !== "function"
  ) {
    throw new Error("source_guard_unavailable");
  }

  async function request(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "helper_message_failed");
    return response.value;
  }

  function createPanel(title) {
    const host = document.createElement("div");
    host.id = "algoloom-v03-verification-host";
    host.style.cssText =
      "position:fixed;z-index:2147483647;top:16px;right:16px;width:min(460px,calc(100vw - 32px))";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      section { box-sizing:border-box;background:#fff;color:#17202a;border:2px solid #2563eb;
        border-radius:10px;padding:18px;font:14px/1.55 system-ui,sans-serif;
        box-shadow:0 8px 28px rgba(0,0,0,.25);max-height:calc(100vh - 32px);overflow:auto; }
      h2 { margin:0 0 10px;font-size:18px; } p { margin:8px 0; }
      label { display:block;margin:10px 0; } input[type=text] { box-sizing:border-box;width:100%;padding:7px; }
      button { padding:8px 12px;margin-top:8px;cursor:pointer; } button:disabled { cursor:not-allowed; }
      .error { color:#b91c1c;font-weight:700; } .ok { color:#166534;font-weight:700; }
      code { overflow-wrap:anywhere; } ul { padding-left:20px; }
    `;
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = title;
    section.append(heading);
    shadow.append(style, section);
    document.documentElement.append(host);
    return section;
  }

  function addText(panel, text, className = "") {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    if (className) paragraph.className = className;
    panel.append(paragraph);
    return paragraph;
  }

  async function waitForPlainEditor(
    panel,
    sourceField,
    editorElement,
    editorToggle,
  ) {
    if (SOURCE_GUARD.isPlainEditorMode(
      sourceField,
      editorElement,
      editorToggle,
    )) return;
    addText(
      panel,
      "AtCoder本体の「エディタ切替」ボタンを人が押し、プレーンテキスト欄を表示してください。表示後、この確認ボタンを押してください。拡張はエディタ切替を自動操作しません。",
    );
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "プレーンテキスト欄の表示を確認する";
    panel.append(button);
    await new Promise((resolve) => {
      button.addEventListener("click", () => {
        if (!SOURCE_GUARD.isPlainEditorMode(
          sourceField,
          editorElement,
          editorToggle,
        )) {
          addText(panel, "プレーンテキスト欄をまだ確認できません。AtCoder本体のエディタを切り替えてください。", "error");
          return;
        }
        button.disabled = true;
        resolve();
      });
    });
  }

  async function verifyEditorRoundTrip(
    panel,
    sourceField,
    editorElement,
    editorToggle,
    sourceMatches,
  ) {
    addText(
      panel,
      "ソースをプレーンテキスト欄へ設定しました。AtCoder本体の「エディタ切替」を人が押してAce表示へ戻し、次の確認ボタンを押してください。",
    );
    const aceButton = document.createElement("button");
    aceButton.type = "button";
    aceButton.textContent = "Ace表示を確認する";
    panel.append(aceButton);
    await new Promise((resolve) => {
      aceButton.addEventListener("click", () => {
        if (!SOURCE_GUARD.isAceEditorMode(
          sourceField,
          editorElement,
          editorToggle,
        )) {
          addText(panel, "Ace表示をまだ確認できません。AtCoder本体のエディタを切り替えてください。", "error");
          return;
        }
        aceButton.disabled = true;
        resolve();
      });
    });

    addText(
      panel,
      "Aceにソースが表示されたことを目視し、AtCoder本体の「エディタ切替」をもう一度押してプレーンテキスト欄へ戻してから、同期確認ボタンを押してください。",
    );
    const plainButton = document.createElement("button");
    plainButton.type = "button";
    plainButton.textContent = "エディタ往復後のソース同期を確認する";
    panel.append(plainButton);
    await new Promise((resolve, reject) => {
      plainButton.addEventListener("click", () => {
        if (!SOURCE_GUARD.isPlainEditorMode(
          sourceField,
          editorElement,
          editorToggle,
        )) {
          addText(panel, "プレーンテキスト欄へまだ戻っていません。AtCoder本体のエディタを切り替えてください。", "error");
          return;
        }
        plainButton.disabled = true;
        if (!sourceMatches()) {
          reject(new Error("source_editor_round_trip_mismatch"));
          return;
        }
        resolve();
      });
    });
  }

  function extractIdentities() {
    const identities = new Set();
    for (const script of document.scripts) {
      const text = script.textContent || "";
      for (const match of text.matchAll(IDENTITY_PATTERN)) identities.add(match[1]);
    }
    return [...identities].sort();
  }

  function classifyForm(form) {
    try {
      const action = new URL(form.getAttribute("action") || "", location.href);
      return (
        action.origin === TARGET_ORIGIN &&
        action.pathname === SUBMIT_PATH &&
        action.search === "" &&
        action.hash === ""
      );
    } catch (_) {
      return false;
    }
  }

  function parseSubmissionIds(documentValue) {
    const ids = [];
    for (const row of documentValue.querySelectorAll("tr")) {
      const hasTargetProblem = [...row.querySelectorAll("a[href]")].some((anchor) => {
        try {
          return new URL(anchor.href, TARGET_ORIGIN).pathname === PROBLEM_PATH;
        } catch (_) {
          return false;
        }
      });
      if (!hasTargetProblem) continue;
      for (const anchor of row.querySelectorAll("a[href]")) {
        let match = null;
        try {
          match = new URL(anchor.href, TARGET_ORIGIN).pathname.match(
            SUBMISSION_PATH_PATTERN,
          );
        } catch (_) {
          continue;
        }
        if (match && !ids.includes(match[1])) ids.push(match[1]);
      }
    }
    if (ids.length > 100) throw new Error("submission_list_unbounded");
    return ids;
  }

  async function fetchBaseline(languageId) {
    const parameters = new URLSearchParams({
      "f.Task": PROBLEM_ID,
      "f.Language": languageId,
      orderBy: "created",
      desc: "true",
    });
    const response = await fetch(`${SUBMISSIONS_PATH}?${parameters}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) throw new Error("baseline_http_status");
    const contentType = (response.headers.get("Content-Type") || "").split(";", 1)[0];
    if (contentType !== "text/html") throw new Error("baseline_content_type");
    const body = await response.text();
    if (new TextEncoder().encode(body).length > 2 * 1024 * 1024) {
      throw new Error("baseline_body_oversized");
    }
    return parseSubmissionIds(new DOMParser().parseFromString(body, "text/html"));
  }

  function inspectAndPrepareForm() {
    const forms = [...document.forms].filter(classifyForm);
    if (forms.length !== 1) throw new Error("target_form_not_unique");
    const form = forms[0];
    if (String(form.method).toLowerCase() !== "post") {
      throw new Error("target_form_method_changed");
    }

    const csrfFields = form.querySelectorAll('input[name="csrf_token"]');
    const taskSelects = form.querySelectorAll(
      'select#select-task[name="data.TaskScreenName"]',
    );
    const sourceWrappers = document.querySelectorAll("#sourceCode");
    const wrappers = form.querySelectorAll(
      '#select-lang[data-name="data.LanguageId"]',
    );
    if (csrfFields.length !== 1) throw new Error("csrf_field_not_unique");
    if (taskSelects.length !== 1) throw new Error("task_select_not_unique");
    if (sourceWrappers.length !== 1) throw new Error("source_wrapper_not_unique");
    if (wrappers.length !== 1) throw new Error("language_wrapper_not_unique");
    const sourceFields = document.querySelectorAll(
      'textarea#plain-textarea[name="sourceCode"]',
    );
    const editorElements = document.querySelectorAll("#editor");
    const editorToggles = document.querySelectorAll(".btn-toggle-editor");
    if (sourceFields.length !== 1) throw new Error("source_field_not_unique");
    if (editorElements.length !== 1) throw new Error("source_editor_not_unique");
    if (editorToggles.length !== 1) throw new Error("source_editor_toggle_not_unique");
    if (
      !form.contains(sourceWrappers[0]) ||
      !form.contains(sourceFields[0]) ||
      !form.contains(editorElements[0]) ||
      !form.contains(editorToggles[0])
    ) {
      throw new Error("source_editor_structure_changed");
    }

    const targetOptions = [...taskSelects[0].options].filter(
      (option) => option.value === PROBLEM_ID,
    );
    if (targetOptions.length !== 1) throw new Error("target_task_not_unique");
    taskSelects[0].value = PROBLEM_ID;
    taskSelects[0].dispatchEvent(new Event("change", { bubbles: true }));

    const containers = wrappers[0].querySelectorAll(`#select-lang-${PROBLEM_ID}`);
    if (containers.length !== 1) throw new Error("language_container_not_unique");
    const languageSelects = [...containers[0].children].filter(
      (element) => element.tagName === "SELECT",
    );
    if (languageSelects.length !== 1) throw new Error("language_select_not_unique");
    const languageSelect = languageSelects[0];
    if (!["", LANGUAGE_FIELD_NAME].includes(languageSelect.getAttribute("name") || "")) {
      throw new Error("language_select_name_changed");
    }
    languageSelect.name = LANGUAGE_FIELD_NAME;

    const candidates = [...languageSelect.options]
      .map((option) => {
        const displayName = (option.textContent || "").replace(/\s+/g, " ").trim();
        const match = displayName.match(CPYTHON_PATTERN);
        return match && option.value
          ? {
              atcoder_language_id: option.value,
              display_name: displayName,
              interpreter: "CPython",
              version: match[1],
            }
          : null;
      })
      .filter(Boolean);
    if (candidates.length !== 1) throw new Error("cpython_candidate_not_unique");
    languageSelect.value = candidates[0].atcoder_language_id;
    languageSelect.dispatchEvent(new Event("change", { bubbles: true }));

    if (
      taskSelects[0].value !== PROBLEM_ID ||
      languageSelect.value !== candidates[0].atcoder_language_id
    ) {
      throw new Error("prepared_value_mismatch");
    }

    const sourceField = sourceFields[0];
    const editorElement = editorElements[0];
    const editorToggle = editorToggles[0];

    const submitControls = [...form.querySelectorAll(
      'button[type="submit"], input[type="submit"]',
    )];
    if (submitControls.length === 0 || submitControls.length > 4) {
      throw new Error("submit_control_count_changed");
    }
    let approved = false;
    form.addEventListener("submit", (event) => {
      if (approved) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    return {
      form,
      language: candidates[0],
      taskSelect: taskSelects[0],
      languageSelect,
      sourceField,
      editorElement,
      editorToggle,
      submitControls,
      approve() {
        approved = true;
      },
      isApproved() {
        return approved;
      },
      turnstile_widget_count: form.querySelectorAll(
        ".cf-turnstile, [data-sitekey]",
      ).length,
      turnstile_response_field_count: form.querySelectorAll(
        '[name="cf-turnstile-response"]',
      ).length,
    };
  }

  async function runSettings() {
    const panel = createPanel("V-03 アカウント確認");
    addText(panel, "この欄へ入力したアカウント名はAtCoderやローカルヘルパーへ送らず、この拡張の一時メモリだけで照合します。");
    const label = document.createElement("label");
    label.textContent = "期待する本人のAtCoderアカウント名";
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    label.append(input);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "このアカウントで照合する";
    panel.append(label, button);

    button.addEventListener("click", async () => {
      button.disabled = true;
      const expected = input.value;
      input.value = "";
      if (!ACCOUNT_PATTERN.test(expected)) {
        addText(panel, "アカウント名の形式を受理できません。ブラウザを閉じてください。", "error");
        return;
      }
      const identities = extractIdentities();
      const matches = identities.length === 1 && identities[0] === expected;
      if (!matches || navigator.webdriver === true) {
        await request({
          type: "event",
          event: {
            type: "aborted",
            reason: navigator.webdriver === true
              ? "navigator_webdriver_true"
              : identities.length === 1
                ? "account_identity_mismatch"
                : "account_identity_not_unique",
          },
        });
        addText(panel, "本人アカウントを一意に確認できないため停止しました。ブラウザを閉じてください。", "error");
        return;
      }
      await request({ type: "set_expected_identity", value: expected });
      await request({
        type: "event",
        event: {
          type: "account_checked",
          identity_count: identities.length,
          identity_matches_expected: true,
          navigator_webdriver: false,
        },
      });
      addText(panel, "アカウント識別情報を1件取得し、期待値との一致を確認しました。", "ok");
      const link = document.createElement("a");
      link.href = `${TARGET_ORIGIN}${SUBMIT_PATH}?taskScreenName=${PROBLEM_ID}`;
      link.rel = "noreferrer";
      link.textContent = `${PROBLEM_ID} の提出ページを開く`;
      panel.append(link);
    }, { once: true });
  }

  async function runSubmit() {
    const panel = createPanel("V-03 提出準備");
    addText(panel, "フォームを検査しています。Turnstileは自分で操作し、検証欄の値を拡張へ渡さないでください。");
    try {
      if (navigator.webdriver === true) throw new Error("navigator_webdriver_true");
      const claim = await request({ type: "claim_submit_page" });
      if (!claim?.claimed) {
        panel.replaceChildren(panel.querySelector("h2"));
        addText(panel, "別タブで提出準備が進行中です。このタブでは操作せず閉じてください。", "error");
        return;
      }
      const expectedResponse = await request({ type: "get_expected_identity" });
      const identities = extractIdentities();
      if (identities.length !== 1 || identities[0] !== expectedResponse.value) {
        throw new Error("account_identity_recheck_failed");
      }
      const config = await request({ type: "get_config" });
      const prepared = inspectAndPrepareForm();
      await waitForPlainEditor(
        panel,
        prepared.sourceField,
        prepared.editorElement,
        prepared.editorToggle,
      );
      const expectedSource = config.source;
      prepared.sourceField.value = expectedSource;
      prepared.sourceField.dispatchEvent(new Event("input", { bubbles: true }));
      prepared.sourceField.dispatchEvent(new Event("change", { bubbles: true }));
      const sourceMatches = () => SOURCE_GUARD.serializedSourceMatches({
        form: prepared.form,
        sourceField: prepared.sourceField,
        editorElement: prepared.editorElement,
        editorToggle: prepared.editorToggle,
        expectedSource,
        expectedByteCount: config.source_byte_count,
      });
      await verifyEditorRoundTrip(
        panel,
        prepared.sourceField,
        prepared.editorElement,
        prepared.editorToggle,
        sourceMatches,
      );
      const preparationFailure = () => {
        if (
          prepared.taskSelect.value !== PROBLEM_ID ||
          prepared.languageSelect.value !== prepared.language.atcoder_language_id
        ) {
          return "target_not_synchronized";
        }
        if (!sourceMatches()) return "source_not_synchronized";
        return null;
      };
      const initialFailure = preparationFailure();
      if (initialFailure !== null) throw new Error(initialFailure);
      config.source = "";
      let baselineIds;
      if (config.helper_stage === "await_form") {
        baselineIds = await fetchBaseline(prepared.language.atcoder_language_id);
        await request({ type: "set_baseline_ids", value: baselineIds });

        await request({
          type: "event",
          event: {
            type: "form_prepared",
            identity_count: 1,
            identity_matches_expected: true,
            navigator_webdriver: false,
            target_form_count: 1,
            target_form_method_post: true,
            csrf_field_count: 1,
            target_task_count: 1,
            source_field_count: 1,
            source_editor_count: 1,
            source_editor_toggle_count: 1,
            plain_editor_mode: true,
            editor_round_trip_verified: true,
            canonical_language_candidate_count: 1,
            resolved_language: prepared.language,
            source_byte_count: config.source_byte_count,
            baseline_submission_count: baselineIds.length,
            turnstile_widget_count: prepared.turnstile_widget_count,
            turnstile_response_field_count: prepared.turnstile_response_field_count,
            turnstile_token_read: false,
          },
        });
      } else if (config.helper_stage === "await_approval") {
        baselineIds = (await request({ type: "get_baseline_ids" })).value;
      } else {
        throw new Error("helper_stage_invalid");
      }

      panel.replaceChildren(panel.querySelector("h2"));
      const list = document.createElement("ul");
      for (const text of [
        `問題: ${PROBLEM_ID}`,
        "アカウント: 取得した識別情報1件が期待値と一致",
        `正規言語ID: ${config.canonical_language_id}`,
        `AtCoder言語ID: ${prepared.language.atcoder_language_id}`,
        `表示名: ${prepared.language.display_name}`,
        `処理系・バージョン: ${prepared.language.interpreter} ${prepared.language.version}`,
        `ソースコード: source-B、${config.source_byte_count}バイト`,
        `SHA-256（画面確認専用）: ${config.source_sha256}`,
        "提出上限: 検証全体で1件。応答不明でも再提出しない",
      ]) {
        const item = document.createElement("li");
        item.textContent = text;
        list.append(item);
      }
      panel.append(list);
      if (config.helper_stage === "await_approval") {
        addText(panel, "同一タブの再読み込みを検出し、記録済みの提出前状態から安全に復帰しました。", "ok");
      }
      const terms = document.createElement("a");
      terms.href = "https://atcoder.jp/tos?lang=ja";
      terms.target = "_blank";
      terms.rel = "noreferrer noopener";
      terms.textContent = "AtCoder利用規約";
      const ai = document.createElement("a");
      ai.href = "https://info.atcoder.jp/overview/about/ai-training-opt-out";
      ai.target = "_blank";
      ai.rel = "noreferrer noopener";
      ai.textContent = "AI学習・販売の拒否設定案内";
      panel.append(terms, document.createTextNode(" / "), ai);

      const ownership = document.createElement("label");
      const ownershipCheck = document.createElement("input");
      ownershipCheck.type = "checkbox";
      ownership.append(ownershipCheck, " source-Bは自分が作成し、提出してよい");
      const unique = document.createElement("label");
      const uniqueCheck = document.createElement("input");
      uniqueCheck.type = "checkbox";
      unique.append(uniqueCheck, " これを検証全体で唯一の提出とし、再提出しない");
      const turnstile = document.createElement("label");
      const turnstileCheck = document.createElement("input");
      turnstileCheck.type = "checkbox";
      turnstile.append(turnstileCheck, " Turnstileを人の操作で完了した");
      const approval = document.createElement("input");
      approval.type = "text";
      approval.autocomplete = "off";
      approval.placeholder = `SUBMIT ${PROBLEM_ID}`;
      const approveButton = document.createElement("button");
      approveButton.type = "button";
      approveButton.textContent = "提出を承認する";
      panel.append(ownership, unique, turnstile, approval, approveButton);

      let sendStarted = false;
      prepared.form.addEventListener("submit", (event) => {
        if (!prepared.isApproved() || sendStarted) return;
        const failure = preparationFailure();
        if (failure !== null) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void request({
            type: "event",
            event: { type: "aborted", reason: failure },
          });
          addText(panel, "送信直前の問題・言語・プレーンテキスト欄・送信対象ソースを再確認できないため遮断しました。再提出せず停止してください。", "error");
          return;
        }
        sendStarted = true;
        void request({ type: "event", event: { type: "send_started" } });
      });

      approveButton.addEventListener("click", async () => {
        approveButton.disabled = true;
        const exactPhrase = approval.value === `SUBMIT ${PROBLEM_ID}`;
        approval.value = "";
        if (!ownershipCheck.checked || !uniqueCheck.checked || !turnstileCheck.checked || !exactPhrase) {
          addText(panel, "確認項目または承認句が不足しています。提出は有効化しません。", "error");
          return;
        }
        const failure = preparationFailure();
        if (failure !== null) {
          await request({
            type: "event",
            event: { type: "aborted", reason: failure },
          });
          addText(panel, "問題・言語・プレーンテキスト欄・送信対象ソースを再確認できないため停止しました。再提出しないでください。", "error");
          return;
        }
        await request({
          type: "event",
          event: {
            type: "approval_granted",
            source_ownership_confirmed: true,
            unique_submission_confirmed: true,
            turnstile_completed_by_user: true,
            ai_policy_presented: true,
            no_automatic_resend_confirmed: true,
          },
        });
        prepared.approve();
        addText(panel, "承認を記録しました。AtCoderページ本体の提出ボタンを1回だけ押してください。拡張はボタンを自動操作しません。承認前の操作は送信イベントで遮断されています。", "ok");
      }, { once: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "submit_preparation_failed";
      try {
        await request({ type: "event", event: { type: "aborted", reason } });
      } catch (_) {
        // The local helper may already have stopped.
      }
      addText(panel, "提出準備を安全に完了できないため停止しました。ブラウザを閉じてください。", "error");
    }
  }

  async function runSubmissionResult() {
    const panel = createPanel("V-03 提出結果");
    try {
      const baseline = (await request({ type: "get_baseline_ids" })).value;
      let currentIds;
      const directMatch = location.pathname.match(SUBMISSION_PATH_PATTERN);
      if (directMatch) {
        currentIds = [directMatch[1]];
      } else if (location.pathname === SUBMISSIONS_PATH) {
        currentIds = parseSubmissionIds(document);
      } else {
        throw new Error("submission_result_path_unexpected");
      }
      const baselineSet = new Set(baseline);
      const candidates = currentIds.filter((value) => !baselineSet.has(value));
      if (new Set(candidates).size !== 1) {
        throw new Error("submission_id_not_unique");
      }
      await request({
        type: "event",
        event: { type: "remote_accepted", submission_id: candidates[0] },
      });
      await request({ type: "clear_sensitive_state" });
      addText(panel, "AtCoderが発行した提出IDを一意に取得しました。V-03は合格です。", "ok");
      addText(panel, "ブラウザはローカルヘルパーが後始末します。再提出しないでください。");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "submission_result_failed";
      try {
        await request({ type: "event", event: { type: "remote_status_unknown", reason } });
      } catch (_) {
        // The local helper may already have stopped.
      }
      addText(panel, "提出IDを一意に取得できません。状態不明として停止し、再提出しないでください。", "error");
    }
  }

  async function main() {
    if (location.origin !== TARGET_ORIGIN) return;
    if (location.pathname === "/settings") return await runSettings();
    if (location.pathname === SUBMIT_PATH) {
      const values = new URLSearchParams(location.search).getAll("taskScreenName");
      if (values.length === 1 && values[0] === PROBLEM_ID) return await runSubmit();
      return;
    }
    if (
      location.pathname === SUBMISSIONS_PATH ||
      SUBMISSION_PATH_PATTERN.test(location.pathname)
    ) {
      return await runSubmissionResult();
    }
  }

  void main();
})();
