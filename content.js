(function () {
  const LOG_PREFIX = "[Flow Queue]";

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function randomIntInclusive(min, max) {
    const a = Math.ceil(min);
    const b = Math.floor(max);
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  }

  /** Plain text roughly visible in a Slate contenteditable (drops ZWSP / FEFF). */
  function editorPlainText(el) {
    return (el.innerText || "")
      .replace(/[\u200b\ufeff]/g, "")
      .replace(/\n+/g, " ")
      .trim();
  }

  function editorSeemsToContain(el, text) {
    const t = text.trim();
    if (!t) return false;
    const raw = editorPlainText(el);
    if (raw.includes(t)) return true;
    const head = t.slice(0, Math.min(48, t.length));
    return raw.includes(head);
  }

  /**
   * Prefer the editable with Flow's main placeholder; else the lowest visible Slate box (prompt bar).
   */
  function findFlowPromptEditor() {
    const candidates = [];
    for (const el of document.querySelectorAll(
      '[data-slate-editor="true"][contenteditable="true"]'
    )) {
      if (!isVisible(el)) continue;
      candidates.push(el);
    }
    if (!candidates.length) return null;

    const withPlaceholder = candidates.filter((el) => {
      const ph = el.querySelector("[data-slate-placeholder]");
      if (!ph) return false;
      const label = (ph.textContent || "").toLowerCase();
      return (
        label.includes("what do you want") ||
        label.includes("create") ||
        label.includes("generate")
      );
    });
    const pool = withPlaceholder.length ? withPlaceholder : candidates;
    return pool.sort(
      (a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom
    )[0];
  }

  function firstMatch(selectors) {
    for (const sel of selectors || []) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch {
        /* invalid selector */
      }
    }
    return null;
  }

  /**
   * Focus like a user: scroll, then click inside the box so React/Slate activates the field.
   */
  async function focusEditorLikeUser(el) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(40);
    const r = el.getBoundingClientRect();
    const cx = Math.min(Math.max(r.left + r.width / 2, r.left + 8), r.right - 8);
    const cy = Math.min(Math.max(r.top + r.height / 2, r.top + 8), r.bottom - 8);
    const common = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
      button: 0,
      buttons: 1,
    };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerId: 1, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mousedown", common));
    el.dispatchEvent(new PointerEvent("pointerup", { ...common, pointerId: 1, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mouseup", common));
    el.dispatchEvent(new MouseEvent("click", common));
    el.focus();
    await sleep(50);
  }

  async function selectAllInEditor(el) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    await sleep(30);
  }

  async function clearEditorContent(el) {
    await selectAllInEditor(el);
    try {
      document.execCommand("delete", false, null);
    } catch {
      el.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "deleteContentBackward",
        })
      );
    }
    await sleep(40);
  }

  function dispatchSyntheticPaste(el, text) {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const ev = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    try {
      Object.defineProperty(ev, "clipboardData", {
        value: dt,
        enumerable: true,
        configurable: true,
      });
    } catch {
      /* ignore */
    }
    return el.dispatchEvent(ev);
  }

  async function typeInsertTextEvents(el, text, charDelayMs) {
    el.focus();
    const endSel = window.getSelection();
    const endRange = document.createRange();
    endRange.selectNodeContents(el);
    endRange.collapse(false);
    endSel.removeAllRanges();
    endSel.addRange(endRange);
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      el.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: "insertText",
          data: char,
        })
      );
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertText",
          data: char,
        })
      );
      if (charDelayMs > 0) await sleep(charDelayMs);
    }
  }

  /**
   * Slate/React ignores raw DOM writes — drive the same path as typing/pasting.
   */
  async function injectTextIntoFlowPrompt(el, text, charDelayMs) {
    if (!text) return false;

    await focusEditorLikeUser(el);
    await clearEditorContent(el);
    await focusEditorLikeUser(el);

    dispatchSyntheticPaste(el, text);
    await sleep(120);
    if (editorSeemsToContain(el, text)) {
      log("Filled prompt via synthetic paste.");
      return true;
    }

    const before = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: "insertText",
      data: text,
    });
    el.dispatchEvent(before);
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: text,
      })
    );
    await sleep(80);
    if (editorSeemsToContain(el, text)) {
      log("Filled prompt via insertText beforeinput.");
      return true;
    }

    await clearEditorContent(el);
    await focusEditorLikeUser(el);
    log("Trying execCommand insertText per character (native beforeinput path)…");
    for (let j = 0; j < text.length; j++) {
      try {
        document.execCommand("insertText", false, text[j]);
      } catch {
        /* continue with InputEvent path below */
      }
      if (charDelayMs > 0) await sleep(charDelayMs);
    }
    await sleep(80);
    if (editorSeemsToContain(el, text)) {
      log("Filled prompt via execCommand insertText.");
      return true;
    }

    await clearEditorContent(el);
    await focusEditorLikeUser(el);
    log("Trying per-character InputEvent insertText (last resort)…");
    await typeInsertTextEvents(el, text, charDelayMs);
    await sleep(80);
    if (editorSeemsToContain(el, text)) {
      log("Filled prompt via synthetic InputEvents.");
      return true;
    }

    log("Prompt verification failed; editor text:", editorPlainText(el).slice(0, 120));
    return false;
  }

  function findCreateButtonByArrowIcon() {
    const candidates = [];
    for (const btn of document.querySelectorAll("button")) {
      if (!isVisible(btn)) continue;
      const icon = btn.querySelector("i.google-symbols");
      if (icon && icon.textContent?.trim() === "arrow_forward") {
        candidates.push(btn);
      }
    }
    if (!candidates.length) return null;
    return candidates.sort(
      (a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom
    )[0];
  }

  function submitViaEnter(el) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(
        new KeyboardEvent(type, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        })
      );
    }
  }

  async function dismissOptionalOverlays(selectorsConfig) {
    const list = selectorsConfig.dismissOverlays || [];
    for (let i = 0; i < 3; i++) {
      const btn = firstMatch(list);
      if (btn && isVisible(btn)) {
        btn.click();
        await sleep(400);
      } else break;
    }
  }

  let runToken = 0;

  async function runQueue(payload) {
    const token = ++runToken;
    let prompts = (payload.prompts || []).map((p) => String(p).trim()).filter(Boolean);
    const waitMinMs = Math.max(0, payload.waitMinMs ?? 10_000);
    const waitMaxMs = Math.max(waitMinMs, payload.waitMaxMs ?? 30_000);
    const preferEnter = payload.preferEnter === true;
    const charDelayMs = Math.max(0, payload.charDelayMs ?? 50);
    /** Only bundled defaults — never merge message-supplied selectors (reduces attack surface). */
    const selectors = globalThis.FLOW_BATCH_DEFAULT_SELECTORS;

    for (let i = 0; i < prompts.length; i++) {
      if (token !== runToken) {
        log("Stopped by user.");
        return { stopped: true, completed: i };
      }

      const text = prompts[i];

      await dismissOptionalOverlays(selectors);

      let input = findFlowPromptEditor();
      if (!input) {
        input = firstMatch(selectors.promptInput || []);
      }
      if (!input || !isVisible(input)) {
        const msg =
          "Could not find prompt field. Open a Flow project tab (…/flow/project/…) and try again.";
        log(msg);
        return { error: msg, completed: i, failedPromptIndex: i };
      }

      const ok = await injectTextIntoFlowPrompt(input, text, charDelayMs);
      if (!ok) {
        return {
          error:
            "Could not set prompt text in a way Flow accepts. Try entering one prompt manually once, then retry the queue.",
          completed: i,
          failedPromptIndex: i,
        };
      }

      await sleep(200);

      let submitted = false;
      if (!preferEnter) {
        let submit =
          firstMatch(selectors.submitButton || []) || findCreateButtonByArrowIcon();
        if (submit && isVisible(submit)) {
          submit.click();
          submitted = true;
          log(`Clicked Create (prompt ${i + 1}/${prompts.length})`);
        }
      }
      if (!submitted) {
        submitViaEnter(input);
        log(`Sent Enter to submit (prompt ${i + 1}/${prompts.length})`);
      }

      if (i < prompts.length - 1) {
        const pause = randomIntInclusive(waitMinMs, waitMaxMs);
        log(`Waiting ${Math.round(pause / 1000)}s before next prompt…`);
        await sleep(pause);
      }
    }

    return { done: true, completed: prompts.length };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) {
      return;
    }
    if (message?.type === "FLOW_BATCH_PING") {
      sendResponse({ ok: true, href: location.href });
      return;
    }
    if (message?.type === "FLOW_BATCH_RUN") {
      runQueue(message)
        .then((result) => sendResponse(result))
        .catch((e) => sendResponse({ error: String(e?.message || e) }));
      return true;
    }
    if (message?.type === "FLOW_BATCH_STOP") {
      runToken++;
      sendResponse({ ok: true });
    }
  });

  log("Content script ready on", location.href);
})();
