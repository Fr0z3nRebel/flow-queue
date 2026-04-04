# Flow Queue (Chrome Extension)

<p align="center">
   <img
      src="https://lh3.googleusercontent.com/W07_CF8UeBRPXaKpC6hnKrOplyWjke4olUgvUZwFJBZmfc95IidXHHi8b9TNqbb5xGtf26rAdqYw9EmBz8fFceNAWWQ=s800-w800-h500"
      alt="Flow Queue screenshot"
      width="520"
   />
</p>

Flow Queue is a Manifest V3 Chrome extension that queues prompts for Google Flow and submits them one by one with a randomized wait between each prompt.

## Install From Chrome Web Store

Use this if you want to install and use Flow Queue immediately:

- https://chromewebstore.google.com/detail/flow-queue/mfihommbmhfbpinlkfmjocnphklcojnb

## What It Does

- Adds a Chrome side panel UI for prompt batching
- Runs prompts in order (one prompt per line)
- Waits a random time between prompts (`Min wait` to `Max wait`)
- Persists prompts and timing values in `chrome.storage.local`
- Lets you stop an active run

## Requirements

- Google Chrome 114+
- Access to Google Flow at `https://labs.google/fx/tools/flow/project/...`

## Install In Chrome (Unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select this project folder (the folder containing `manifest.json`).
5. Confirm the extension **Flow Queue** appears in your extensions list.

## How To Use

1. Open a Google Flow project page in Chrome:
   - `https://labs.google/fx/tools/flow/project/...`
2. Click the Flow Queue extension icon in the toolbar.
   - This opens the side panel.
3. In **Prompt queue**, paste prompts with one prompt per line.
4. Set **Min wait** and **Max wait** (seconds).
5. Click **Check page** to verify the content script is connected.
6. Click **Run queue**.
7. Click **Stop** any time to stop after the current step.

## Notes

- If the extension says content script is not available, refresh the Flow tab and try **Check page** again.
- This extension is scoped to `https://labs.google/fx/*` and is designed for the Flow project UI.
- Google Flow UI changes may require selector updates in `selectors.js`.

## Project Structure

- `manifest.json`: Extension configuration and permissions
- `background/service-worker.js`: Side panel behavior on action click
- `content.js`: Prompt injection, submit logic, queue loop
- `selectors.js`: Default selector fallbacks
- `sidepanel/`: Side panel UI (`html`, `css`, `js`)

## Privacy

Flow Queue runs locally in your browser. It does not require a backend service for queue execution.

## Disclaimer

Flow Queue is independent and is not affiliated with, endorsed by, or sponsored by Google. Google Flow and related marks belong to Google LLC.
