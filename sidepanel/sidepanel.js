/** Fixed typing fallback delay for Slate (ms between synthetic keystrokes). */
const CHAR_DELAY_MS = 50;

const promptsEl = document.getElementById("prompts");
const waitMinEl = document.getElementById("waitMin");
const waitMaxEl = document.getElementById("waitMax");
const statusEl = document.getElementById("status");
const pingBtn = document.getElementById("ping");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
const helpDialog = document.getElementById("helpDialog");
const helpOpen = document.getElementById("helpOpen");
const helpClose = document.getElementById("helpClose");

const refImageEl = document.getElementById("refImage");
const refImagePreviewContainer = document.getElementById("refImagePreviewContainer");
const refImagePreview = document.getElementById("refImagePreview");
const clearRefImageBtn = document.getElementById("clearRefImage");
const dropZone = document.getElementById("dropZone");

let currentRefImageBase64 = null;

function updateRefImagePreview(dataUrl) {
  if (dataUrl) {
    currentRefImageBase64 = dataUrl;
    refImagePreview.src = dataUrl;
    refImagePreviewContainer.style.display = "block";
    if (dropZone) dropZone.style.display = "none";
  } else {
    currentRefImageBase64 = null;
    refImagePreview.src = "";
    refImagePreviewContainer.style.display = "none";
    if (dropZone) dropZone.style.display = "block";
    if (refImageEl) refImageEl.value = "";
  }
}

function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    updateRefImagePreview(ev.target.result);
    persist();
  };
  reader.readAsDataURL(file);
}

if (refImageEl) {
  refImageEl.addEventListener("change", (e) => {
    handleFile(e.target.files[0]);
  });
}

if (dropZone) {
  ["dragenter", "dragover", "dragleave", "drop"].forEach((name) => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  ["dragenter", "dragover"].forEach((name) => {
    dropZone.addEventListener(name, () => dropZone.classList.add("dragover"));
  });

  ["dragleave", "drop"].forEach((name) => {
    dropZone.addEventListener(name, () => dropZone.classList.remove("dragover"));
  });

  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    handleFile(file);
  });
}

if (clearRefImageBtn) {
  clearRefImageBtn.addEventListener("click", () => {
    updateRefImagePreview(null);
    persist();
  });
}

function setStatus(text) {
  statusEl.textContent = text;
}

if (helpOpen && helpDialog?.showModal) {
  helpOpen.addEventListener("click", () => {
    helpDialog.showModal();
  });
}
if (helpClose && helpDialog?.close) {
  helpClose.addEventListener("click", () => {
    helpDialog.close();
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToFlowTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("No active tab.");
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    setStatus(
      "Content script not on this page. Open a Flow project URL and refresh."
    );
    return null;
  }
}

pingBtn.addEventListener("click", async () => {
  setStatus("Checking…");
  const res = await sendToFlowTab({ type: "FLOW_BATCH_PING" });
  if (res?.ok) setStatus(`Connected: ${res.href}`);
});

runBtn.addEventListener("click", async () => {
  const lines = promptsEl.value.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) {
    setStatus("Add at least one prompt line.");
    return;
  }
  let waitMinMs = Math.round(Number(waitMinEl.value) * 1000) || 0;
  let waitMaxMs = Math.round(Number(waitMaxEl.value) * 1000) || 0;
  if (waitMaxMs < waitMinMs) {
    [waitMinMs, waitMaxMs] = [waitMaxMs, waitMinMs];
  }
  setStatus(`Running ${lines.length} prompt(s), ${waitMinEl.value}–${waitMaxEl.value}s apart…`);
  runBtn.disabled = true;
  const res = await sendToFlowTab({
    type: "FLOW_BATCH_RUN",
    prompts: lines,
    waitMinMs,
    waitMaxMs,
    charDelayMs: CHAR_DELAY_MS,
    refImage: currentRefImageBase64,
  });
  runBtn.disabled = false;
  if (!res) return;
  if (res.error) setStatus(`Error: ${res.error}`);
  else if (res.stopped) setStatus(`Stopped after ${res.completed} prompt(s).`);
  else if (res.done) setStatus(`Finished ${res.completed} prompt(s).`);
  else setStatus(JSON.stringify(res));
});

stopBtn.addEventListener("click", async () => {
  await sendToFlowTab({ type: "FLOW_BATCH_STOP" });
  setStatus("Stop requested.");
});

chrome.storage.local.get(
  ["flowBatchPrompts", "flowBatchWaitMin", "flowBatchWaitMax", "flowBatchAfter", "flowBatchRefImage"],
  (r) => {
    if (r.flowBatchPrompts) promptsEl.value = r.flowBatchPrompts;
    if (r.flowBatchWaitMin != null) waitMinEl.value = String(r.flowBatchWaitMin);
    else if (r.flowBatchAfter != null) waitMinEl.value = String(r.flowBatchAfter);
    if (r.flowBatchWaitMax != null) waitMaxEl.value = String(r.flowBatchWaitMax);
    if (r.flowBatchRefImage) updateRefImagePreview(r.flowBatchRefImage);
  }
);

function persist() {
  chrome.storage.local.set({
    flowBatchPrompts: promptsEl.value,
    flowBatchWaitMin: waitMinEl.value,
    flowBatchWaitMax: waitMaxEl.value,
    flowBatchRefImage: currentRefImageBase64,
  });
}
promptsEl.addEventListener("change", persist);
waitMinEl.addEventListener("change", persist);
waitMaxEl.addEventListener("change", persist);
