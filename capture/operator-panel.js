/*
 * Operator panel for PM-driven walkthroughs (design §13).
 *
 * Opens a larger always-on-top window optimized for the PM sitting at
 * the SME's machine during a walkthrough. Big labeled buttons fire
 * markers without going through the hotkey + picker flow. Includes a
 * sync-marker button for the cross-machine alignment workflow.
 *
 * Renderer talks to main.js via the same IPC channels the status
 * window uses (pdt:fireStart, pdt:endSession, pdt:status, etc.) plus
 * the new pdt:fireSync.
 */

"use strict";

const { BrowserWindow } = require("electron");

function buildOperatorHtml(config) {
  const labels = JSON.stringify((config && config.process_labels) || []);
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>PDT - Operator Panel</title>
<style>
  :root { color-scheme: dark;
    --bg: #14131A; --bg-2: #1B1A24; --bg-3: #25232F; --bg-4: #2F2D3A;
    --fg: #EDE7D3; --fg-2: #C4BBA8; --fg-3: #8A8278;
    --accent: #8BA17A; --accent-2: #6A8CAF; --warn: #D4A24C; --bad: #C26F4A;
    --rec: #E45656; --rule: #2F2A34; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg);
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 13px; overflow: hidden; }
  body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }

  header { display: flex; align-items: center; gap: 14px;
    padding-bottom: 12px; border-bottom: 1px solid var(--rule); }
  .rec-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--fg-3); flex: 0 0 auto; }
  .rec-dot.on { background: var(--rec); box-shadow: 0 0 10px rgba(228, 86, 86, 0.6);
    animation: pulse 1.6s infinite; }
  .rec-dot.paused { background: var(--warn); }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
  .state { flex: 1; font-size: 12px; color: var(--fg-2); text-transform: uppercase;
    letter-spacing: 1.5px; font-family: "IBM Plex Mono", monospace; }
  .timer { font-family: "IBM Plex Mono", monospace; font-size: 18px; color: var(--fg); }

  h2 { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
    color: var(--fg-3); font-family: "IBM Plex Mono", monospace; margin: 4px 0 8px; font-weight: 500; }

  .label-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .label-btn { padding: 14px 12px; background: var(--bg-3); border: 1px solid var(--rule);
    color: var(--fg); border-radius: 6px; font-size: 13px; font-family: inherit;
    cursor: pointer; transition: all 0.12s; text-align: left; }
  .label-btn:hover { background: var(--bg-4); border-color: var(--accent); transform: translateY(-1px); }
  .label-btn .ico { display: inline-block; width: 18px; color: var(--accent); margin-right: 6px; }

  .markers-strip { background: var(--bg-2); border: 1px solid var(--rule); border-radius: 6px;
    padding: 10px 12px; min-height: 60px; }
  .ms-empty { color: var(--fg-3); font-size: 12px; font-style: italic; }
  .open-marker { display: inline-block; padding: 4px 10px; background: var(--bad); color: var(--bg);
    border-radius: 4px; font-size: 12px; font-weight: 500; margin: 2px 4px 2px 0; }
  .open-marker .depth { opacity: 0.7; font-size: 10px; }

  .actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .actions .span2 { grid-column: span 2; }
  .actions .span3 { grid-column: span 3; }
  .actions button { padding: 12px 8px; background: var(--bg-3); color: var(--fg);
    border: 1px solid var(--rule); border-radius: 5px; font-family: inherit;
    font-size: 12px; cursor: pointer; transition: all 0.12s; }
  .actions button:hover:not(:disabled) { background: var(--bg-4); }
  .actions button.danger { background: var(--bad); border-color: var(--bad); color: var(--bg); font-weight: 500; }
  .actions button.danger:hover:not(:disabled) { background: #D87A56; }
  .actions button.accent { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 500; }
  .actions button.accent:hover:not(:disabled) { background: #9CB28A; }
  .actions button:disabled { opacity: 0.4; cursor: not-allowed; }

  .now { background: var(--bg-2); border-left: 3px solid var(--accent-2);
    padding: 8px 12px; border-radius: 0 4px 4px 0; font-size: 11px; color: var(--fg-2); }
  .now b { color: var(--fg); }

  .custom-row { display: flex; gap: 6px; align-items: center; }
  .custom-row input { flex: 1; padding: 10px 12px; background: var(--bg-3); border: 1px solid var(--rule);
    color: var(--fg); border-radius: 5px; font-family: inherit; font-size: 13px; outline: none; }
  .custom-row input:focus { border-color: var(--accent-2); }
  .custom-row button { padding: 10px 16px; background: var(--accent); border: none; color: var(--bg);
    border-radius: 5px; font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer; }
  .custom-row button:hover { background: #9CB28A; }
</style></head><body>

<header>
  <div class="rec-dot" id="dot"></div>
  <div class="state" id="state">Idle</div>
  <div class="timer" id="timer">00:00:00</div>
</header>

<div class="now" id="now">Awaiting session start. Click any label below to start a session and fire a Start marker.</div>

<div>
  <h2>Open markers</h2>
  <div class="markers-strip" id="markers"><div class="ms-empty">No open markers</div></div>
</div>

<div>
  <h2>Start markers</h2>
  <div class="label-grid" id="labels"></div>
  <div class="custom-row" style="margin-top: 8px;">
    <input id="custom" placeholder="Custom label..." />
    <button id="custom-btn">Fire</button>
  </div>
</div>

<div>
  <h2>Session actions</h2>
  <div class="actions">
    <button id="btn-end-marker" class="span3">End innermost marker</button>
    <button id="btn-screenshot">Manual screenshot</button>
    <button id="btn-sync">Sync marker</button>
    <button id="btn-pause">Pause polling</button>
    <button id="btn-end-session" class="danger span3">End capture session</button>
  </div>
</div>

<script>
const { ipcRenderer } = require("electron");
const labels = ${labels};

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

function renderLabels() {
  const host = document.getElementById("labels");
  host.innerHTML = labels.map((l) =>
    '<button class="label-btn" data-label="' + esc(l) + '">' +
    '<span class="ico">&#9654;</span>' + esc(l) + '</button>'
  ).join("");
  host.querySelectorAll(".label-btn").forEach((b) =>
    b.addEventListener("click", () => fireStart(b.dataset.label))
  );
}

async function fireStart(label) {
  await ipcRenderer.invoke("pdt:fireStart", label);
  tick();
}

document.getElementById("custom-btn").addEventListener("click", () => {
  const v = document.getElementById("custom").value.trim();
  if (!v) return;
  fireStart(v);
  document.getElementById("custom").value = "";
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
  const id = prompt("Sync marker ID (shared across machines for cross-machine alignment).\\nLeave blank for an auto-generated value.");
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
  if (!s || !s.tracking) {
    dot.className = "rec-dot";
    state.textContent = "Idle";
    timer.textContent = "00:00:00";
    now.innerHTML = "Awaiting session start. Click any label below to start a session and fire a Start marker.";
    document.getElementById("btn-end-marker").disabled = true;
    document.getElementById("btn-screenshot").disabled = true;
    document.getElementById("btn-sync").disabled = true;
    document.getElementById("btn-pause").disabled = true;
    document.getElementById("btn-end-session").disabled = true;
  } else {
    if (s.paused) { dot.className = "rec-dot paused"; state.textContent = "Paused"; }
    else { dot.className = "rec-dot on"; state.textContent = s.obsConnected ? "Recording" : "Tracking"; }
    timer.textContent = fmtTimer(s.elapsedMs);
    now.innerHTML = "<b>" + esc(s.currentApp || "-") + "</b>" +
      (s.currentTitle ? " &middot; " + esc(s.currentTitle.slice(0, 80)) : "");
    document.getElementById("btn-end-marker").disabled = !s.markerDepth;
    document.getElementById("btn-screenshot").disabled = !s.screenshotsEnabled;
    document.getElementById("btn-sync").disabled = false;
    document.getElementById("btn-pause").disabled = false;
    document.getElementById("btn-end-session").disabled = false;
    document.getElementById("btn-pause").textContent = s.paused ? "Resume polling" : "Pause polling";
  }
  const m = document.getElementById("markers");
  if (!s || !s.openMarkers || !s.openMarkers.length) {
    m.innerHTML = '<div class="ms-empty">No open markers</div>';
  } else {
    m.innerHTML = s.openMarkers.map((l, i) =>
      '<div class="open-marker">' + esc(l) + ' <span class="depth">L' + i + '</span></div>'
    ).join("");
  }
}

renderLabels();
tick();
setInterval(tick, 1000);
</script>
</body></html>`;
}

function showOperatorPanel(config) {
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    title: "PDT - Operator Panel",
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#14131A",
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
