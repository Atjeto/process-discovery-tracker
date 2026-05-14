/*
 * Live status window for the capture tracker.
 *
 * Optional surface (toggled from the tray). Polls main process via
 * IPC every 1 second for current state, renders a compact dashboard:
 *   - Recording indicator + session timer
 *   - Current app/title (live)
 *   - Open marker stack with nesting visualization
 *   - Event counters, idle indicator
 *   - Recent events feed
 *   - Quick action buttons (Pause/Resume, Manual screenshot, End session)
 *
 * Built as a data: URL with nodeIntegration so we don't ship a
 * separate HTML file. Matches the trusted-first-party pattern used
 * by the label picker.
 */

"use strict";

const { BrowserWindow } = require("electron");

function buildStatusHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>PDT - Status</title>
<style>
  :root { color-scheme: dark;
    --bg: #14131A; --bg-2: #1B1A24; --bg-3: #25232F;
    --fg: #EDE7D3; --fg-2: #C4BBA8; --fg-3: #8A8278;
    --accent: #8BA17A; --accent-2: #6A8CAF; --warn: #D4A24C; --bad: #C26F4A;
    --rec: #E45656; --rule: #2F2A34; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg);
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 12px; overflow: hidden; }
  body { padding: 14px; display: flex; flex-direction: column; gap: 12px; }

  .card { background: var(--bg-2); border: 1px solid var(--rule); border-radius: 6px; padding: 10px 12px; }
  .card h2 { font-size: 9px; margin: 0 0 6px; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--fg-3); font-weight: 500; font-family: "IBM Plex Mono", monospace; }

  .header { display: flex; align-items: center; gap: 10px; }
  .rec-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--fg-3); flex: 0 0 auto;
    transition: background 0.2s; }
  .rec-dot.on { background: var(--rec); box-shadow: 0 0 8px rgba(228, 86, 86, 0.6); animation: pulse 1.6s infinite; }
  .rec-dot.paused { background: var(--warn); }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
  .header .label { flex: 1; font-size: 11px; color: var(--fg-2); letter-spacing: 0.5px; text-transform: uppercase; }
  .header .timer { font-family: "IBM Plex Mono", "Consolas", monospace; font-size: 14px; color: var(--fg); }

  .now-app { font-size: 13px; color: var(--fg); margin-top: 2px; word-break: break-word; }
  .now-title { font-size: 11px; color: var(--fg-3); margin-top: 4px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .markers { display: flex; flex-direction: column; gap: 4px; max-height: 90px; overflow: auto; }
  .marker { padding: 4px 8px; background: var(--bg-3); border-left: 3px solid var(--bad);
    border-radius: 3px; font-size: 12px; }
  .markers .empty { color: var(--fg-3); font-size: 11px; font-style: italic; padding: 4px 0; }

  .counters { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .counter { text-align: center; padding: 6px 4px; background: var(--bg-3); border-radius: 4px; }
  .counter .v { font-family: "IBM Plex Mono", monospace; font-size: 16px; color: var(--accent); }
  .counter .k { font-size: 9px; color: var(--fg-3); text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }

  .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .tag { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: var(--bg-3); color: var(--fg-3); }
  .tag.on { background: var(--accent); color: var(--bg); }
  .tag.warn { background: var(--warn); color: var(--bg); }
  .tag.bad { background: var(--bad); color: var(--bg); }

  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .actions button { padding: 8px 6px; font-family: inherit; font-size: 11px; cursor: pointer;
    background: var(--bg-3); color: var(--fg); border: 1px solid var(--rule); border-radius: 4px;
    transition: all 0.12s; }
  .actions button:hover { background: #2F2D3A; border-color: var(--accent); }
  .actions button.primary { background: var(--bad); border-color: var(--bad); color: #fff; }
  .actions button.primary:hover { background: #D87A56; }
  .actions button.full { grid-column: 1 / -1; }

  .feed { max-height: 110px; overflow: auto; font-family: "IBM Plex Mono", monospace; font-size: 10px; }
  .feed .ev { padding: 2px 4px; color: var(--fg-2); border-bottom: 1px solid var(--rule); display: flex; gap: 6px; }
  .feed .ts { color: var(--fg-3); flex: 0 0 auto; }
  .feed .activity { color: var(--fg-2); }
  .feed .marker { color: var(--bad); font-weight: 600; }
  .feed .system { color: var(--accent-2); }
</style></head><body>

<div class="card header">
  <div class="rec-dot" id="dot"></div>
  <div class="label" id="state">Idle</div>
  <div class="timer" id="timer">00:00:00</div>
</div>

<div class="card">
  <h2>Currently tracking</h2>
  <div class="now-app" id="now-app">--</div>
  <div class="now-title" id="now-title"></div>
  <div class="tags" id="tags"></div>
</div>

<div class="card">
  <h2>Open markers</h2>
  <div class="markers" id="markers"><div class="empty">No open markers</div></div>
</div>

<div class="card">
  <h2>Session counters</h2>
  <div class="counters">
    <div class="counter"><div class="v" id="c-events">0</div><div class="k">events</div></div>
    <div class="counter"><div class="v" id="c-markers">0</div><div class="k">markers</div></div>
    <div class="counter"><div class="v" id="c-shots">0</div><div class="k">shots</div></div>
  </div>
</div>

<div class="card">
  <h2>Recent events</h2>
  <div class="feed" id="feed"></div>
</div>

<div class="actions">
  <button class="full primary" id="btn-start">▶ Start capture session</button>
  <button id="btn-pause">Pause</button>
  <button id="btn-shot">📷 Screenshot</button>
  <button class="full primary" id="btn-end">End session</button>
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

async function tick() {
  const s = await ipcRenderer.invoke("pdt:status");
  if (!s) {
    document.getElementById("state").textContent = "Idle - no session";
    document.getElementById("dot").className = "rec-dot";
    document.getElementById("timer").textContent = "00:00:00";
    return;
  }
  // State + dot
  const dot = document.getElementById("dot");
  const stateLbl = document.getElementById("state");
  if (s.paused) {
    dot.className = "rec-dot paused";
    stateLbl.textContent = "Paused";
  } else if (s.tracking) {
    dot.className = "rec-dot on";
    stateLbl.textContent = s.obsConnected ? "Recording" : "Tracking";
  } else {
    dot.className = "rec-dot";
    stateLbl.textContent = "Idle";
  }
  document.getElementById("timer").textContent = fmtTimer(s.elapsedMs);
  // Now-app
  document.getElementById("now-app").textContent = s.currentApp || "-";
  document.getElementById("now-title").textContent = short(s.currentTitle || "", 56);
  // Tags
  const tags = document.getElementById("tags");
  tags.innerHTML = "";
  if (s.obsConnected) tags.innerHTML += '<span class="tag on">OBS</span>';
  else tags.innerHTML += '<span class="tag">no OBS</span>';
  if (s.idle) tags.innerHTML += '<span class="tag warn">idle</span>';
  if (s.recovered) tags.innerHTML += '<span class="tag bad">recovered</span>';
  // Markers
  const m = document.getElementById("markers");
  if (!s.openMarkers || !s.openMarkers.length) {
    m.innerHTML = '<div class="empty">No open markers</div>';
  } else {
    m.innerHTML = s.openMarkers.map((label, i) =>
      '<div class="marker" style="margin-left:' + (i * 14) + 'px">' +
      (i > 0 ? '↳ ' : '') + escapeHtml(label) + '</div>'
    ).join("");
  }
  // Counters
  document.getElementById("c-events").textContent = s.eventCount || 0;
  document.getElementById("c-markers").textContent = s.markerCount || 0;
  document.getElementById("c-shots").textContent = s.screenshotCount || 0;
  // Feed (last 8)
  const feed = document.getElementById("feed");
  const recent = (s.recentEvents || []).slice(-8).reverse();
  feed.innerHTML = recent.map(ev => {
    const cls = ev.type;
    let label = "";
    if (ev.type === "activity") label = short(ev.data.app || "", 28);
    else if (ev.type === "marker") label = (ev.data.marker_type || "?") + ": " + short(ev.data.label || "", 22);
    else if (ev.type === "system") label = ev.data.kind || "";
    return '<div class="ev"><span class="ts">' + fmtTs(ev.timestamp) + '</span>' +
           '<span class="' + cls + '">' + escapeHtml(label) + '</span></div>';
  }).join("");
  // Button states. Start is visible only when idle; pause/shot/end only when tracking.
  const startBtn = document.getElementById("btn-start");
  const pauseBtn = document.getElementById("btn-pause");
  const shotBtn = document.getElementById("btn-shot");
  const endBtn = document.getElementById("btn-end");
  if (s.tracking) {
    startBtn.style.display = "none";
    pauseBtn.style.display = "";
    shotBtn.style.display = "";
    endBtn.style.display = "";
  } else {
    startBtn.style.display = "";
    pauseBtn.style.display = "none";
    shotBtn.style.display = "none";
    endBtn.style.display = "none";
  }
  pauseBtn.textContent = s.paused ? "Resume" : "Pause";
  shotBtn.disabled = !s.screenshotsEnabled;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

document.getElementById("btn-start").addEventListener("click", async () => {
  await ipcRenderer.invoke("pdt:startSession");
  tick();
});
document.getElementById("btn-pause").addEventListener("click", () => ipcRenderer.invoke("pdt:togglePause").then(tick));
document.getElementById("btn-shot").addEventListener("click", () => ipcRenderer.invoke("pdt:manualScreenshot"));
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
    title: "PDT - Status",
    resizable: false,
    minimizable: true,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: "#14131A",
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });
  win.removeMenu();
  win.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(buildStatusHtml())
  );
  if (opts && opts.parent) win.setParentWindow(opts.parent);
  return win;
}

module.exports = { showStatusWindow };
