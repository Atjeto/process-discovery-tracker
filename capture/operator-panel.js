/*
 * Operator panel for PM-driven walkthroughs (design §13).
 *
 * Always-on-top window optimized for the analyst sitting at the SME's
 * machine during a walkthrough. Type a marker label, hit Fire (or
 * Enter) — implicitly starts the session and fires the Start marker
 * in one step.
 *
 * Renderer talks to main.js via the same IPC channels the status
 * window uses (pdt:fireStart, pdt:endSession, pdt:status, etc.) plus
 * pdt:fireSync.
 */

"use strict";

const { BrowserWindow } = require("electron");

function buildOperatorHtml(config) {
  const labels = JSON.stringify((config && config.process_labels) || []);
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>PDT Operator</title>
<style>
  :root {
    color-scheme: dark;
    --bg:       #1a1a1a;
    --bg-2:     #232323;
    --bg-3:     #2c2c2c;
    --bg-hover: #363636;
    --border:   #3a3a3a;
    --fg:       #e6e6e6;
    --fg-2:     #a8a8a8;
    --fg-3:     #6e6e6e;
    --accent:   #3a86ff;
    --danger:   #c83434;
    --rec:      #d04848;
    --warn:     #d4a040;
    --mono:     ui-monospace, "Cascadia Mono", Consolas, "Liberation Mono", monospace;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; height: 100%;
    background: var(--bg); color: var(--fg);
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    font-size: 13px;
  }
  body { padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }

  /* Header */
  header { display: flex; align-items: center; gap: 10px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--fg-3); flex: 0 0 auto; }
  .dot.on     { background: var(--rec); }
  .dot.paused { background: var(--warn); }
  .state  { flex: 1; font-size: 13px; color: var(--fg); }
  .timer  { font-family: var(--mono); font-size: 14px; color: var(--fg-2); }
  .now    { font-size: 12px; color: var(--fg-2); padding-left: 20px; min-height: 16px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill   { font-size: 10px; padding: 2px 7px; border-radius: 10px; border: 1px solid var(--border);
            color: var(--fg-2); background: var(--bg-2); }
  .pill.on    { color: var(--accent); border-color: var(--accent); }
  .pill.warn  { color: var(--warn);   border-color: var(--warn); }
  .pill.bad   { color: var(--danger); border-color: var(--danger); }
  .pill.off   { color: var(--fg-3);   border-color: var(--fg-3); }

  /* Sub-section label */
  .lbl { font-size: 11px; color: var(--fg-3); margin-bottom: 6px; }

  /* Open markers strip */
  .markers { display: flex; flex-wrap: wrap; gap: 6px; min-height: 24px; }
  .markers.empty { color: var(--fg-3); font-size: 12px; align-items: center; }
  .mk { padding: 3px 8px; background: var(--bg-3); border: 1px solid var(--border);
        border-radius: 3px; font-size: 12px; color: var(--fg); }
  .mk .d { color: var(--fg-3); margin-right: 6px; font-family: var(--mono); font-size: 11px; }

  /* Fire row */
  .fire-row { display: flex; gap: 6px; }
  .fire-row input {
    flex: 1; padding: 8px 10px; background: var(--bg-2); border: 1px solid var(--border);
    color: var(--fg); border-radius: 3px; font-family: inherit; font-size: 13px; outline: none;
  }
  .fire-row input:focus { border-color: var(--accent); }
  .fire-row input::placeholder { color: var(--fg-3); }
  .fire-row button {
    padding: 8px 16px; background: var(--accent); border: 1px solid var(--accent);
    color: #fff; border-radius: 3px; font-family: inherit; font-size: 13px; cursor: pointer;
  }
  .fire-row button:hover:not(:disabled) { filter: brightness(1.1); }
  .fire-row button:disabled { background: var(--bg-3); border-color: var(--border); color: var(--fg-3); cursor: not-allowed; }

  /* Saved labels (only rendered when config supplies them) */
  .saved { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .saved button {
    padding: 4px 10px; background: var(--bg-2); border: 1px solid var(--border);
    color: var(--fg-2); border-radius: 3px; font-family: inherit; font-size: 12px; cursor: pointer;
  }
  .saved button:hover { background: var(--bg-hover); color: var(--fg); border-color: var(--accent); }

  /* Action buttons */
  .primary {
    width: 100%; padding: 10px; background: var(--bg-3); border: 1px solid var(--border);
    color: var(--fg); border-radius: 3px; font-family: inherit; font-size: 13px; cursor: pointer;
  }
  .primary:hover:not(:disabled) { background: var(--bg-hover); }
  .primary:disabled { color: var(--fg-3); cursor: not-allowed; }

  .secondary-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .secondary-row button {
    padding: 8px 6px; background: transparent; border: 1px solid var(--border);
    color: var(--fg-2); border-radius: 3px; font-family: inherit; font-size: 12px; cursor: pointer;
  }
  .secondary-row button:hover:not(:disabled) { background: var(--bg-2); color: var(--fg); }
  .secondary-row button:disabled { color: var(--fg-3); cursor: not-allowed; }

  .end-session {
    width: 100%; padding: 10px; margin-top: 4px;
    background: transparent; border: 1px solid var(--danger);
    color: var(--danger); border-radius: 3px; font-family: inherit; font-size: 13px; cursor: pointer;
  }
  .end-session:hover:not(:disabled) { background: var(--danger); color: #fff; }
  .end-session:disabled { border-color: var(--border); color: var(--fg-3); cursor: not-allowed; }

  hr { border: none; border-top: 1px solid var(--border); margin: 4px 0; }
</style></head><body>

<header>
  <div class="dot" id="dot"></div>
  <div class="state" id="state">Idle</div>
  <span class="pill" id="rec-pill" style="display:none"></span>
  <div class="timer" id="timer">00:00:00</div>
</header>
<div class="now" id="now"></div>

<div>
  <div class="lbl">Open markers</div>
  <div class="markers empty" id="markers">none</div>
</div>

<div>
  <div class="lbl">Fire start marker</div>
  <div class="fire-row">
    <input id="custom" placeholder="Label, then Enter" autocomplete="off" />
    <button id="custom-btn">Fire</button>
  </div>
  <div class="saved" id="saved"></div>
</div>

<hr/>

<button id="btn-end-marker" class="primary" disabled>End innermost marker</button>

<div class="secondary-row">
  <button id="btn-pause" disabled>Pause</button>
  <button id="btn-screenshot" disabled>Screenshot</button>
  <button id="btn-sync" disabled>Sync</button>
</div>

<button id="btn-end-session" class="end-session" disabled>End session</button>

<script>
const { ipcRenderer } = require("electron");
const savedLabels = ${labels};

function pad(n, w) { return String(n).padStart(w || 2, "0"); }
function fmtTimer(ms) {
  if (ms == null || ms < 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderSaved() {
  const host = document.getElementById("saved");
  if (!savedLabels || !savedLabels.length) { host.innerHTML = ""; return; }
  host.innerHTML = savedLabels.map((l) =>
    '<button data-label="' + esc(l) + '">' + esc(l) + '</button>'
  ).join("");
  host.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => fireStart(b.dataset.label))
  );
}

async function fireStart(label) {
  await ipcRenderer.invoke("pdt:fireStart", label);
  tick();
}

document.getElementById("custom-btn").addEventListener("click", () => {
  const input = document.getElementById("custom");
  const v = input.value.trim();
  if (!v) return;
  fireStart(v);
  input.value = "";
});
document.getElementById("custom").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("custom-btn").click();
});
document.getElementById("btn-end-marker").addEventListener("click", async () => {
  await ipcRenderer.invoke("pdt:fireEnd");
  tick();
});
document.getElementById("btn-screenshot").addEventListener("click", () =>
  ipcRenderer.invoke("pdt:manualScreenshot"));
document.getElementById("btn-sync").addEventListener("click", async () => {
  const id = prompt("Sync marker ID for cross-machine alignment.\\nLeave blank to auto-generate.");
  await ipcRenderer.invoke("pdt:fireSync", id || null);
  tick();
});
document.getElementById("btn-pause").addEventListener("click", async () => {
  await ipcRenderer.invoke("pdt:togglePause");
  tick();
});
document.getElementById("btn-end-session").addEventListener("click", async () => {
  if (confirm("End the capture session?")) {
    await ipcRenderer.invoke("pdt:endSession");
    tick();
  }
});

async function tick() {
  const s = await ipcRenderer.invoke("pdt:status");
  const dot = document.getElementById("dot");
  const state = document.getElementById("state");
  const timer = document.getElementById("timer");
  const now = document.getElementById("now");
  const markers = document.getElementById("markers");

  const btnEndMarker  = document.getElementById("btn-end-marker");
  const btnPause      = document.getElementById("btn-pause");
  const btnShot       = document.getElementById("btn-screenshot");
  const btnSync       = document.getElementById("btn-sync");
  const btnEndSession = document.getElementById("btn-end-session");

  const recPill = document.getElementById("rec-pill");
  const rstate = s && s.recorder_state;
  if (!rstate || rstate === "disabled") {
    recPill.style.display = "none";
  } else {
    recPill.style.display = "";
    recPill.textContent = "recorder " + rstate;
    recPill.className = "pill " +
      (rstate === "on" ? "on" : rstate === "paused" ? "warn" :
       rstate === "dead" ? "bad" : "off");
  }

  if (!s || !s.tracking) {
    dot.className = "dot";
    state.textContent = "Idle";
    timer.textContent = "00:00:00";
    now.textContent = "";
    btnEndMarker.disabled = true;
    btnPause.disabled = true;
    btnShot.disabled = true;
    btnSync.disabled = true;
    btnEndSession.disabled = true;
  } else {
    if (s.paused) {
      dot.className = "dot paused";
      state.textContent = "Paused";
    } else {
      dot.className = "dot on";
      state.textContent = s.obsConnected ? "Recording" : "Tracking";
    }
    timer.textContent = fmtTimer(s.elapsedMs);
    now.textContent = (s.currentApp || "") +
      (s.currentTitle ? " — " + s.currentTitle.slice(0, 80) : "");
    btnEndMarker.disabled = !s.markerDepth;
    btnPause.disabled = false;
    btnShot.disabled = !s.screenshotsEnabled;
    btnSync.disabled = false;
    btnEndSession.disabled = false;
    btnPause.textContent = s.paused ? "Resume" : "Pause";
  }

  if (!s || !s.openMarkers || !s.openMarkers.length) {
    markers.className = "markers empty";
    markers.textContent = "none";
  } else {
    markers.className = "markers";
    markers.innerHTML = s.openMarkers.map((l, i) =>
      '<div class="mk"><span class="d">L' + i + '</span>' + esc(l) + '</div>'
    ).join("");
  }
}

renderSaved();
tick();
setInterval(tick, 1000);
</script>
</body></html>`;
}

function showOperatorPanel(config) {
  const win = new BrowserWindow({
    width: 420,
    height: 520,
    title: "PDT Operator",
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#1a1a1a",
    skipTaskbar: false,
    webPreferences: {
      /* Trusted first-party HTML loaded via a data: URL. CSP in the
         page restricts what the renderer can do. */
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(buildOperatorHtml(config))
  );
  return win;
}

module.exports = { showOperatorPanel };
