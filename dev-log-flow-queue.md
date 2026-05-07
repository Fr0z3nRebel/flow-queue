# Fix log: Flow Queue — batch prompts without losing your mind on Google Flow

**VIBE CODING • BUILD IN PUBLIC** · [DEVS PLS FIX](https://devsplsfix.com)

The internet complains. I build the fix — this time for anyone who lives in [Google Flow](https://labs.google/fx) and has *fifty image ideas* and *one thumb*.

---

## The complaint

Google’s Flow UI is slick, but “type prompt → wait → type prompt → wait” does not scale when you are iterating on a mood board, a client pack, or a late-night idea dump. Copy-paste helps for a handful of lines; it does not help when you want **spacing** between runs so you are not hammering the app like a bot.

I wanted: **one line per prompt**, **run in order**, **random pause between each** so it feels human-adjacent, and a dead-simple surface that lives next to the tab I am already staring at.

So we shipped **Flow Queue** — a Manifest V3 Chrome extension scoped to `labs.google/fx/*` that drives the in-page prompt box and Create flow from a **side panel**.

---

## What we built (v0.2.1)

- **Side panel UI** — textarea queue, min/max wait in seconds, **Check page**, **Run queue**, **Stop**. Prompts and timing persist in `chrome.storage.local` so you can close the panel and come back.
- **Content script** — finds Flow’s Slate `contenteditable`, fills it, submits, waits a random interval in your range, repeats.
- **Background** — tiny service worker: wires the toolbar icon to open the side panel (`openPanelOnActionClick`).

Name on the tin: *Flow Queue*. Description in the manifest: queue prompts and automate image generation on Google Flow.

---

## The part where Slate makes you earn it

If you have ever tried to “just set `innerText`” on a React-controlled editor, you already know the punchline: **nothing happens**. Flow’s prompt field is Slate. The DOM is a suggestion; the framework is the law.

We brute-forced politeness instead of fragility:

1. **Focus like a user** — scroll into view, synthetic pointer/mouse down/up/click, then `focus()`. If the editor never truly activates, nothing downstream works.
2. **Clear & fill** — select-all, delete, then **synthetic `paste`** with a real-enough `ClipboardEvent` + `DataTransfer` so Slate’s handlers see something they respect.
3. **Verify** — compare plain text (strip zero-width junk) so we know the prompt actually landed before we hit Create.
4. **Fallthrough ladder** — if paste fails: batched `beforeinput`/`input`, then `execCommand('insertText')` per character, then per-character `InputEvent` insertText as last resort. Logs in the console are prefixed `[Flow Queue]` so you can see which path won.

Submit tries `aria-label` / config selectors first, then hunts for the visible **Create** button with Google’s `arrow_forward` icon; you can also lean on **Enter** if that matches how you work.

Overlays that steal focus get a few **Dismiss/Close** clicks (configurable selectors) before each step so a stray dialog does not kill the run.

---

## Leveling Up: Reference Images (v0.3.x)

Vibe coding is about momentum. The first version was great for text, but Google Flow's real power is **steering** with a reference image. We added that in **v0.3.0**.

The challenge: You don't want to upload the same 5MB image fifty times. That's a waste of bandwidth and a 10-second delay per prompt.

1. **Persistent Cache** — We added `unlimitedStorage` so you can drop a reference image into the side panel once. We store it as a Base64 string that persists even if you restart Chrome.
2. **The "One-and-Done" Trick** — For **Prompt #1**, we paste the image file directly into Slate to trigger the initial upload.
3. **Menu Re-selection** — For **Prompts #2 through N**, we don't upload again. Instead, we click Flow’s **(+)** menu, wait for the asset library to populate, and click `reference.png` (our auto-named upload). It’s an instant, server-side attachment that cuts runtimes in half.

In **v0.3.1**, we polished the hell out of the UI. We ditched the ugly system file input for a custom **drag-and-drop zone** and a responsive **16:9 preview wrapper** that centers everything from square mood boards to tall portrait shots without cropping.

---

## Bypassing isTrusted: the MAIN world injection (v0.4.0)

Google shipped an update that broke the Create button. The text injection still worked — Slate accepted our synthetic paste and `beforeinput` events — but `submit.click()` stopped doing anything.

### What changed on their side

1. **No more `aria-label="Create"`** on the submit button. The label moved to a visually-hidden `<span>` using CSS `clip: rect(0,0,0,0)`. All our CSS selectors missed.
2. **`isTrusted` gating on the submission path.** The `onClick` handler now extracts `event.nativeEvent.isTrusted` and passes it as an argument to an internal `onSubmit(isTrusted)` function. A guard condition `(!isLoading || isTrustedArg)` silently short-circuits when the argument is falsy — which it always is for synthetic events dispatched via `dispatchEvent()` (they get `isTrusted: false`, and that's read-only on real `Event` objects).

### How we found it

Blind guessing at selectors and event dispatch strategies was going nowhere. We wrote a **diagnostic script** (`debug-submit-button.js`) that:

1. Finds the button via icon/label heuristics
2. Walks the **React fiber tree** from the button element up through 20 ancestors
3. Dumps every `onClick`, `onSubmit`, `onChange` handler at each depth — including argument count and **deobfuscated source preview**
4. Reads **Slate's `editor.children`** to confirm text injection actually landed in the editor model (not just the DOM)
5. Dumps the **`promptBoxStore`** state (Zustand-style store)

The fiber diagnostic immediately revealed the guard: `onSubmit` at depth 5 takes one boolean argument and skips execution when it's falsy.

### The fix (3 pieces)

1. **Button discovery** — Added `findCreateButtonByHiddenLabel()` (scans `<span>` children) and `findSubmitButton()` (consolidates 4 discovery strategies with logging).

2. **MAIN world injection** — Content scripts live in Chrome's "isolated world" and can only see the DOM, not React's internal objects (`__reactFiber$`, `__reactProps$`). We inject a self-contained function into the page's MAIN world via `chrome.scripting.executeScript({ world: "MAIN" })`, which:
   - Finds the button by a temporary `data-fq-click-target` marker attribute
   - Walks the React fiber tree to find the `onSubmit` handler
   - Calls `onSubmit(true)` — passing `true` as the isTrusted flag
   - Returns the result to the content script via the background service worker

3. **`onSubmit(true)`** — The single-character fix. The obfuscated guard at depth 5 is `(!_0x14e035 || _0x22665d)` — "not loading OR argument is truthy." Passing `true` satisfies this gate the same way a real `event.nativeEvent.isTrusted` would.

### Architecture after v0.4.0

```
Content Script (isolated world)          Background (service worker)           Page (MAIN world)
──────────────────────────────           ──────────────────────────           ─────────────────
1. Find button, set marker attr
2. sendMessage(REACT_FIBER_CLICK)  ───►  3. chrome.scripting.executeScript  ───►  4. querySelector by marker
                                            world: "MAIN"                         5. Walk __reactFiber$
                                                                                  6. onSubmit(true)
                                         7. Return InjectionResult  ◄────────────  
   ◄─────────────────────────────────    8. sendResponse(result)
9. Remove marker, log result
```

No `debugger` permission (no "debugging this browser" banner), no CSP violations, no `isTrusted` worries. The `scripting` permission is the only addition to the manifest.

---

## Maintenance expectations

This extension automates a **third-party UI**. Things that can break:

| Breakage type | Likelihood | How we'd know | Typical fix |
|---|---|---|---|
| **CSS class / selector changes** | High (every deploy) | Already handled — we discover by icon + hidden label, not by class | No action needed |
| **`aria-label` / `data-*` attribute changes** | Medium | `findSubmitButton()` logs which strategy won | Add/update selectors in `selectors.js` |
| **React fiber prop renames** (`onSubmit` → `onGenerate`, etc.) | Low | `reactFiberSubmit` returns `onClick/onSubmit not found` | Update prop name in `service-worker.js` |
| **`onSubmit` argument semantics change** | Low | Submit reports success but nothing happens (like this time) | Re-run `debug-submit-button.js`, inspect handler source |
| **Slate editor restructure** (different `contenteditable` layout) | Low-Medium | Text injection fails, logs show which fallback path won | Update `findFlowPromptEditor()` heuristics |
| **React version change** (fiber key prefix changes) | Very Low | `no React fiber on element` in logs | Update prefix check in `reactFiberSubmit` |
| **CSP policy tightening** | Already handled | `chrome.scripting.executeScript` bypasses page CSP by design | No action needed |

**Bottom line:** Expect to revisit **selectors and heuristics every few months** when Google updates the Flow UI. The `debug-submit-button.js` diagnostic makes these fixes fast — run it, read the fiber tree, adjust. Major architectural changes (like this `isTrusted` enforcement) are rarer, maybe once or twice a year.

---

## Operator notes

- **Tab** must be a signed-in Flow **project** URL (`labs.google/fx/tools/flow/project/…`). If the content script is not injected, **Check page** tells you to open Flow and refresh.
- **Min/max wait** picks a **random** delay each gap — good for rate-ish spacing without a fixed metronome.
- **Stop** bumps an internal token so the loop exits cleanly after the current step’s logic observes it.

This is automation on a third-party UI. When Google ships an A/B DOM tweak, we may need to nudge `selectors.js` or the editor discovery heuristics. That is life next to someone else’s bundle hash.

---

## Why this fits DEVS PLS FIX

Tiny surface. Single host permission. No server, no keys — just **storage**, **scripting**, **activeTab**, **sidePanel**, and the honesty that we are **driving Slate the way Slate wants to be driven**, not the way copy-paste snippets from 2014 promise.

If you live in Flow and your backlog is a `.txt` file of prompts, this is the **Micro SaaS-shaped wrench** for that one workflow.

---

## Tags

`chrome-extension` · `manifest-v3` · `google-flow` · `labs-google` · `automation` · `slate` · `build-in-public`

---

*John Adams · AI Orchestration Engineer · [devsplsfix.com](https://devsplsfix.com)*
