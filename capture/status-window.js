/*
 * Legacy status window for the capture tracker.
 *
 * DEPRECATED -- everything this window shows is now also in
 * operator-panel.js (rebranded as "Live session window") with the
 * additional affordances of inline marker firing, sync-ID input,
 * and end-session confirm. The tray surfaces both for backward
 * compatibility, but new work should land in operator-panel.js.
 * This file remains as a safe fallback in case the merged window
 * has a regression an operator can't work around -- once we've
 * shipped a v0.3 release that proves the merged window in the
 * field, this file can be removed.
 *
 * Polls main process via IPC every 1 second for current state.
 */

"use strict";

const { BrowserWindow } = require("electron");

function buildStatusHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>PDT Status</title>
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
    font-size: 12px; overflow: hidden;
  }
  body { padding: 14px; display: flex; flex-direction: column; gap: 12px; }

  /* Section label */
  .lbl { font-size: 11px; color: var(--fg-3); margin-bottom: 6px; }

  /* Header */
  header { display: flex; align-items: center; gap: 10px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--fg-3); flex: 0 0 auto; }
  .dot.on     { background: var(--rec); }
  .dot.paused { background: var(--warn); }
  .state { flex: 1; font-size: 13px; color: var(--fg); }
  .timer { font-family: var(--mono); font-size: 14px; color: var(--fg-2); }

  /* Currently tracking */
  .now-app { font-size: 13px; color: var(--fg); word-break: break-word; }
  .now-title { font-size: 11px; color: var(--fg-3); margin-top: 3px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .tag { font-size: 10px; padding: 2px 8px; border-radius: 3px;
    background: var(--bg-3); color: var(--fg-2); border: 1px solid var(--border); }
  .tag.on   { color: var(--accent); border-color: var(--accent); }
  .tag.warn { color: var(--warn);   border-color: var(--warn); }
  .tag.bad  { color: var(--danger); border-color: var(--danger); }
  .tag.off  { color: var(--fg-3);   border-color: var(--fg-3); }

  /* Markers stack */
  .markers { display: flex; flex-direction: column; gap: 3px; max-height: 90px; overflow: auto; }
  .markers .empty { color: var(--fg-3); font-size: 11px; }
  .mk { padding: 4px 8px; background: var(--bg-2); border-left: 2px solid var(--accent);
    border-radius: 0 3px 3px 0; font-size: 12px; }

  /* Counters */
  .counters { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .counter { text-align: center; padding: 6px 4px; background: var(--bg-2);
    border: 1px solid var(--border); border-radius: 3px; }
  .counter .v { font-family: var(--mono); font-size: 16px; color: var(--fg); }
  .counter .k { font-size: 10px; color: var(--fg-3); margin-top: 2px; }

  /* Recent events feed */
  .feed { max-height: 130px; overflow: auto; font-family: var(--mono); font-size: 10px;
    background: var(--bg-2); border: 1px solid var(--border); border-radius: 3px; padding: 4px 6px; }
  .feed .ev { padding: 2px 0; color: var(--fg-2); display: flex; gap: 8px; }
  .feed .ts { color: var(--fg-3); flex: 0 0 auto; }
  .feed .activity { color: var(--fg-2); }
  .feed .marker { color: var(--accent); }
  .feed .system { color: var(--fg-3); }
  .feed .interaction { color: var(--fg-2); }

  /* Actions */
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px; }
  .actions .full { grid-column: 1 / -1; }
  .actions button {
    padding: 8px 6px; font-family: inherit; font-size: 12px; cursor: pointer;
    background: var(--bg-3); color: var(--fg); border: 1px solid var(--border); border-radius: 3px;
  }
  .actions button:hover:not(:disabled) { background: var(--bg-hover); }
  .actions button:disabled { color: var(--fg-3); cursor: not-allowed; }
  .actions button.start {
    background: var(--accent); border-color: var(--accent); color: #fff;
  }
  .actions button.start:hover:not(:disabled) { filter: brightness(1.1); }
  .actions button.end {
    background: transparent; border-color: var(--danger); color: var(--danger);
  }
  .actions button.end:hover:not(:disabled) { background: var(--danger); color: #fff; }

  hr { border: none; border-top: 1px solid var(--border); margin: 2px 0; }
</style></head><body>

<header>
  <div class="dot" id="dot"></div>
  <div class="state" id="state">Idle</div>
  <div class="timer" id="timer">00:00:00</div>
</header>

<div>
  <div class="lbl">Currently tracking</div>
  <div class="now-app" id="now-app">—</div>
  <div class="now-title" id="now-title"></div>
  <div class="tags" id="tags"></div>
</div>

<div>
  <div class="lbl">Open markers</div>
  <div class="markers" id="markers"><div class="empty">none</div></div>
</div>

<div>
  <div class="lbl">Counters</div>
  <div class="counters">
    <div class="counter"><div class="v" id="c-events">0</div><div class="k">events</div></div>
    <div class="counter"><div class="v" id="c-markers">0</div><div class="k">markers</div></div>
    <div class="counter"><div class="v" id="c-shots">0</div><div class="k">shots</div></div>
    <div class="counter"><div class="v" id="c-interactions">0</div><div class="k">interactions</div></div>
  </div>
</div>

<div>
  <div class="lbl">Recent events</div>
  <div class="feed" id="feed"></div>
</div>

<div class="actions">
  <button class="full start" id="btn-start">Start capture session</button>
  <button id="btn-pause">Pause</button>
  <button id="btn-shot">Screenshot</button>
  <button class="full end" id="btn-end">End session</button>
</div>

<script>
const { ipcRenderer } = require("electron");

function pad(n, w) { return String(n).padStart(w || 2, "0"); }
function fmtTimer(ms) {
  if (ms == null || ms < 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60);
}
function fmtTs(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}
function short(s, n) { if (!s) return ""; return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

async function tick() {
  const s = await ipcRenderer.invoke("pdt:status");
  if (!s) {
    document.getElementById("state").textContent = "Idle";
    document.getElementById("dot").className = "dot";
    document.getElementById("timer").textContent = "00:00:00";
    return;
  }

  const dot = document.getElementById("dot");
  const stateLbl = document.getElementById("state");
  if (s.paused) {
    dot.className = "dot paused";
    stateLbl.textContent = "Paused";
  } else if (s.tracking) {
    dot.className = "dot on";
    stateLbl.textContent = s.obsConnected ? "Recording" : "Tracking";
  } else {
    dot.className = "dot";
    stateLbl.textContent = "Idle";
  }
  document.getElementById("timer").textContent = fmtTimer(s.elapsedMs);

  document.getElementById("now-app").textContent = s.currentApp || "—";
  document.getElementById("now-title").textContent = short(s.currentTitle || "", 56);

  const tags = document.getElementById("tags");
  tags.innerHTML = "";
  if (s.obsConnected) tags.innerHTML += '<span class="tag on">OBS</span>';
  else                tags.innerHTML += '<span class="tag">no OBS</span>';
  if (s.idle)         tags.innerHTML += '<span class="tag warn">idle</span>';
  if (s.recovered)    tags.innerHTML += '<span class="tag bad">recovered</span>';
  const rstate = s.recorder_state;
  if (rstate === "on")        tags.innerHTML += '<span class="tag on">recorder</span>';
  else if (rstate === "paused") tags.innerHTML += '<span class="tag warn">recorder paused</span>';
  else if (rstate === "dead") tags.innerHTML += '<span class="tag bad">recorder dead</span>';
  else if (rstate === "off")  tags.innerHTML += '<span class="tag off">recorder off</span>';
  // "disabled" -> no badge

  const m = document.getElementById("markers");
  if (!s.openMarkers || !s.openMarkers.length) {
    m.innerHTML = '<div class="empty">none</div>';
  } else {
    m.innerHTML = s.openMarkers.map((label, i) =>
      '<div class="mk" style="margin-left:' + (i * 14) + 'px">' +
      escapeHtml(label) + '</div>'
    ).join("");
  }

  document.getElementById("c-events").textContent       = s.eventCount       || 0;
  document.getElementById("c-markers").textContent      = s.markerCount      || 0;
  document.getElementById("c-shots").textContent        = s.screenshotCount  || 0;
  document.getElementById("c-interactions").textContent = s.interactionCount || 0;

  const feed = document.getElementById("feed");
  const recent = (s.recentEvents || []).slice(-8).reverse();
  feed.innerHTML = recent.map(ev => {
    const cls = ev.type;
    let label = "";
    if (ev.type === "activity")     label = short(ev.data.app || "", 28);
    else if (ev.type === "marker")  label = (ev.data.marker_type || "?") + ": " + short(ev.data.label || "", 22);
    else if (ev.type === "system")  label = ev.data.kind || "";
    else if (ev.type === "interaction") {
      const kind = ev.data.kind || "?";
      const name = ev.data.name || ev.data.automation_id || ev.data.control_type || "";
      label = kind + ": " + short(name, 22);
    }
    return '<div class="ev"><span class="ts">' + fmtTs(ev.timestamp) + '</span>' +
           '<span class="' + cls + '">' + escapeHtml(label) + '</span></div>';
  }).join("");

  const startBtn = document.getElementById("btn-start");
  const pauseBtn = document.getElementById("btn-pause");
  const shotBtn  = document.getElementById("btn-shot");
  const endBtn   = document.getElementById("btn-end");
  if (s.tracking) {
    startBtn.style.display = "none";
    pauseBtn.style.display = "";
    shotBtn.style.display  = "";
    endBtn.style.display   = "";
  } else {
    startBtn.style.display = "";
    pauseBtn.style.display = "none";
    shotBtn.style.display  = "none";
    endBtn.style.display   = "none";
  }
  pauseBtn.textContent = s.paused ? "Resume" : "Pause";
  shotBtn.disabled = !s.screenshotsEnabled;
}

document.getElementById("btn-start").addEventListener("click", async () => {
  await ipcRenderer.invoke("pdt:startSession");
  tick();
});
document.getElementById("btn-pause").addEventListener("click", () =>
  ipcRenderer.invoke("pdt:togglePause").then(tick));
document.getElementById("btn-shot").addEventListener("click", () =>
  ipcRenderer.invoke("pdt:manualScreenshot"));
document.getElementById("btn-end").addEventListener("click", async () => {
  if (confirm("End the capture session?")) {
    await ipcRenderer.invoke("pdt:endSession");
    tick();
  }
});

tick();
setInterval(tick, 1000);
</script>
</body></html>`;
}

function showStatusWindow(opts) {
  const win = new BrowserWindow({
    width: 340,
    height: 720,
    title: "PDT Status",
    resizable: false,
    minimizable: true,
    maximizable: false,
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
    "data:text/html;charset=utf-8," + encodeURIComponent(buildStatusHtml())
  );
  if (opts && opts.parent) win.setParentWindow(opts.parent);
  return win;
}

module.exports = { showStatusWindow };
