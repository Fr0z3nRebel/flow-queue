/**
 * Flow project page: Slate prompt + Create (arrow_forward). Class hashes change; prefer role/data attrs and icon discovery in content.js.
 */
globalThis.FLOW_BATCH_DEFAULT_SELECTORS = {
  promptInput: [
    'div[role="textbox"][data-slate-editor="true"][contenteditable="true"]',
    'div[contenteditable="true"][data-slate-editor="true"]',
    'div[contenteditable="true"][aria-multiline="true"][role="textbox"]',
    '[data-testid*="prompt" i]',
    'textarea',
  ],

  submitButton: [
    'button[aria-label="Create"]',
    'button[aria-label*="Create" i]',
    'button[type="submit"]',
  ],

  dismissOverlays: ['button[aria-label="Close"]', 'button[aria-label="Dismiss"]'],
};
