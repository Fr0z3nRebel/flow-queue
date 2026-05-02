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

  function base64ToFile(dataUrl, filename = "reference.png") {
    const arr = dataUrl.split(",");
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  }

  async function pasteImageIntoEditor(el, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    const ev = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clipboardData: dt
    });
    if (!ev.clipboardData) {
      try {
        Object.defineProperty(ev, "clipboardData", {
          value: dt,
          enumerable: true,
          configurable: true,
        });
      } catch {
        /* ignore */
      }
    }
    el.dispatchEvent(ev);
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
  async function clickPlusButton() {
    const selectors = globalThis.FLOW_BATCH_DEFAULT_SELECTORS.uploadButton || [];
    let btn = firstMatch(selectors.filter(s => !s.includes(':contains')));
    
    if (!btn || !isVisible(btn)) {
      btn = Array.from(document.querySelectorAll('button')).find(b => {
         return isVisible(b) && (b.textContent || '').includes('add_2');
      });
    }

    if (!btn || !isVisible(btn)) {
      for (const b of document.querySelectorAll('button')) {
        if (!isVisible(b)) continue;
        const text = b.textContent.trim().toLowerCase();
        if (text === 'add' || text === 'add_circle' || text === 'add_photo_alternate') {
          btn = b;
          break;
        }
      }
    }
    if (btn) {
      log("Found '+' button, clicking it.");
      btn.click();
      return true;
    }
    return false;
  }

  async function clickExistingReference() {
    const matches = Array.from(document.querySelectorAll('div, span, p')).filter(el => {
      return isVisible(el) && el.textContent.trim() === 'reference.png';
    });
    
    if (matches.length > 0) {
      const target = matches[matches.length - 1];
      const clickable = target.closest('button, [role="menuitem"], li, [role="button"]') || target;
      clickable.click();
      return true;
    }
    return false;
  }

  async function injectTextIntoFlowPrompt(el, text, charDelayMs, refImageFile = null, isFirstPrompt = false) {
    if (!text && !refImageFile) return false;

    await focusEditorLikeUser(el);
    await clearEditorContent(el);
    await focusEditorLikeUser(el);

    if (refImageFile) {
      let attachedFromMenu = false;
      
      if (!isFirstPrompt) {
        log("Attempting to attach from existing assets...");
        if (await clickPlusButton()) {
        let found = false;
        for (let i = 0; i < 10; i++) {
          await sleep(500);
          if (await clickExistingReference()) {
            found = true;
            break;
          }
        }
        
        if (found) {
          log("Attached existing reference.png from menu!");
          attachedFromMenu = true;
          await sleep(1500); // Wait for pill to render in prompt
        } else {
          log("Not found in menu. Closing menu and falling back to paste...");
          await focusEditorLikeUser(el); // clicks editor to close menu
          await sleep(500);
        }
      }
      }

      if (!attachedFromMenu) {
        const selectors = globalThis.FLOW_BATCH_DEFAULT_SELECTORS;
        const htmlBefore = el.innerHTML;
        const imgsBefore = document.querySelectorAll('img').length;
        
        await pasteImageIntoEditor(el, refImageFile);
        log("Waiting for image to appear in DOM...");
        
        let changed = false;
        for(let i=0; i<60; i++) {
          if (el.innerHTML !== htmlBefore || document.querySelectorAll('img').length > imgsBefore) {
            changed = true;
            break;
          }
          await sleep(500);
        }

        if (changed) {
          log("Image detected in DOM, waiting for upload to settle...");
          for(let i=0; i<60; i++) {
             let visibleSpinner = false;
             for (const s of document.querySelectorAll('[role="progressbar"]')) {
               if (isVisible(s)) visibleSpinner = true;
             }
             const submitBtn = firstMatch(selectors.submitButton || []) || findCreateButtonByArrowIcon();
             const isSubmitDisabled = submitBtn && (submitBtn.disabled || submitBtn.getAttribute('aria-disabled') === 'true');
             
             if (!visibleSpinner && !isSubmitDisabled && submitBtn) {
                log("Upload appears complete (Submit button enabled).");
                break;
             }
             if (!visibleSpinner && i > 16) { 
                log("No spinner found after 8s, assuming upload complete.");
                break;
             }
             await sleep(500);
          }
          await sleep(2500); // Final safety buffer
        } else {
          log("Warning: Image paste not detected in DOM after 30s.");
        }
      } // End if (!attachedFromMenu)
      
      await focusEditorLikeUser(el);
    }

    if (!text) return true;

    // 1. Try synthetic paste
    dispatchSyntheticPaste(el, text);
    await sleep(200);
    if (editorSeemsToContain(el, text)) {
      log("Filled prompt via synthetic paste.");
      return true;
    }

    // 2. Try beforeinput
    log("Text not found, trying beforeinput...");
    const before = new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, composed: true,
      inputType: "insertText", data: text,
    });
    el.dispatchEvent(before);
    el.dispatchEvent(new InputEvent("input", {
      bubbles: true, composed: true,
      inputType: "insertText", data: text,
    }));
    await sleep(200);
    if (editorSeemsToContain(el, text)) {
      log("Filled prompt via insertText beforeinput.");
      return true;
    }

    // 3. Try execCommand insertText
    log("Trying execCommand insertText per character...");
    for (let j = 0; j < text.length; j++) {
      try { document.execCommand("insertText", false, text[j]); } catch {}
      if (charDelayMs > 0) await sleep(charDelayMs);
    }
    await sleep(200);
    if (editorSeemsToContain(el, text)) {
      log("Filled prompt via execCommand insertText.");
      return true;
    }

    // 4. Try InputEvents
    log("Trying per-character InputEvent insertText...");
    await typeInsertTextEvents(el, text, charDelayMs);
    await sleep(200);
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
    const refImageBase64 = payload.refImage;
    let refImageFile = null;
    if (refImageBase64) {
      refImageFile = base64ToFile(refImageBase64);
      log(`Converted reference image (size: ${refImageFile.size} bytes)`);
    }

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

      const isFirstPrompt = i === 0;
      const ok = await injectTextIntoFlowPrompt(input, text, charDelayMs, refImageFile, isFirstPrompt);
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
