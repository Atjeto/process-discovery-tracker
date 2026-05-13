/*
 * Viewer renderer -- session + aggregate surfaces glued together.
 *
 * Depends on globals exposed by sibling scripts loaded earlier in
 * index.html:
 *   window.PdtCharts (charts.js)
 *   window.PdtDfg    (dfg-viewer.js, cytoscape)
 *   window.PdtBpmn   (bpmn-viewer.js, bpmn-js)
 */

"use strict";

const { ipcRenderer } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let currentSession = null;
let aggregateSessions = [];

/* ============ Toast =============================================== */

let toastTimer = null;
function toast(text, kind) {
  const el = $("#toast");
  el.textContent = text;
  el.className = "toast show" + (kind ? " " + kind : "");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

/* ============ Recent sessions (localStorage) ====================== */

const RECENT_KEY = "pdt.recentSessions";
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
  catch (_) { return []; }
}
function pushRecent(sessionFolder, label) {
  let list = getRecent().filter((r) => r.folder !== sessionFolder);
  list.unshift({ folder: sessionFolder, label, ts: Date.now() });
  list = list.slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  renderRecent();
}
function renderRecent() {
  const host = $("#recent-list-session");
  if (!host) return;
  const list = getRecent();
  if (!list.length) {
    host.innerHTML = '<li style="cursor:default;background:transparent;border:none;color:var(--fg-4)">No recent sessions yet.</li>';
    return;
  }
  host.innerHTML = list.map((r) =>
    '<li data-folder="' + escapeHtml(r.folder) + '">' +
      '<span class="label">' + escapeHtml(r.label || path.basename(r.folder)) + '</span>' +
      '<span class="when">' + relTime(r.ts) + '</span>' +
    '</li>'
  ).join("");
  host.querySelectorAll("li[data-folder]").forEach((li) => {
    li.addEventListener("click", () => loadSessionIntoView(li.dataset.folder));
  });
}
function relTime(ms) {
  const dMs = Date.now() - ms;
  const m = Math.round(dMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

/* ============ Tabs ================================================ */

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.view));
});
function activateTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  // Trigger lazy re-fit of any active viz
  if (name === "aggregate") {
    setTimeout(() => {
      if (window.PdtBpmn) window.PdtBpmn.fit();
      if (window.PdtDfg) window.PdtDfg.fit();
    }, 100);
  }
}

/* ============ Annotation sub-tabs ================================= */

$$(".anno-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".anno-tab").forEach((t) => t.classList.toggle("active", t === tab));
    $$(".anno-panel").forEach((p) =>
      p.style.display = p.dataset.panel === tab.dataset.anno ? "" : "none"
    );
  });
});

/* ============ Map sub-tabs ======================================== */

$$(".panel-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".panel-tab").forEach((t) => t.classList.toggle("active", t === tab));
    const which = tab.dataset.map;
    $("#bpmn-host").style.display = which === "bpmn" ? "" : "none";
    $("#dfg-host").style.display = which === "dfg" ? "" : "none";
    setTimeout(() => {
      if (which === "bpmn" && window.PdtBpmn) window.PdtBpmn.fit();
      if (which === "dfg" && window.PdtDfg) window.PdtDfg.fit();
    }, 50);
  });
});

/* ============ Session view: open + normalize ====================== */

async function openSessionFlow() {
  const folder = await ipcRenderer.invoke("viewer:openSessionFolder");
  if (!folder) return;
  await loadSessionIntoView(folder);
}

$("#btn-open-session-hero").addEventListener("click", openSessionFlow);
$("#btn-open-session").addEventListener("click", openSessionFlow);

$("#btn-normalize").addEventListener("click", async () => {
  if (!currentSession) return;
  const mine = $("#cb-mine").checked;
  $("#btn-normalize").disabled = true;
  $("#log-host").style.display = "";
  $("#normalize-log").textContent = "";
  const r = await ipcRenderer.invoke("viewer:runNormalize", {
    sessionFolder: currentSession.sessionFolder,
    mine,
  });
  $("#btn-normalize").disabled = false;
  if (!r.ok) {
    $("#normalize-log").textContent += "\nERROR: " + r.error;
    toast("Normalization failed: " + r.error, "error");
    return;
  }
  toast("Normalization complete", "success");
  await loadSessionIntoView(currentSession.sessionFolder);
});

ipcRenderer.on("viewer:normalizeLog", (_e, text) => {
  const pre = $("#normalize-log");
  pre.textContent += text;
  pre.scrollTop = pre.scrollHeight;
});

async function loadSessionIntoView(folder) {
  try {
    currentSession = await ipcRenderer.invoke("viewer:loadSession", folder);
  } catch (e) {
    toast("Failed to load: " + (e.message || e), "error");
    return;
  }
  $("#session-empty").style.display = "none";
  $("#session-loaded").style.display = "";
  $("#btn-normalize").disabled = false;
  const label =
    (currentSession.manifest && currentSession.manifest.engagement_id) ||
    path.basename(folder);
  pushRecent(folder, label + " · " + path.basename(folder));

  renderSessionPills();
  // Wire video
  const video = $("#video");
  if (currentSession.recordingAvailable && currentSession.recordingPath) {
    video.src = "file:///" + currentSession.recordingPath.replace(/\\/g, "/");
  } else {
    video.removeAttribute("src");
    video.load();
  }
  video.addEventListener("timeupdate", positionPlayhead);
  video.addEventListener("loadedmetadata", () =>
    setVideoOverlay(`${formatDuration(video.duration * 1000)} loaded`));
  setVideoOverlay(currentSession.recordingAvailable ? "loading…" : "no video");

  renderTimeline();
  renderEventTable();
  renderAnnotations();
  renderScreenshots();
  renderMarkersList();
  renderTimelineSummary();
}

function renderSessionPills() {
  const m = currentSession.manifest || {};
  const pills = [];
  pills.push({ label: "events", val: currentSession.events.length, cls: "ok" });
  pills.push({ label: "status", val: m.status || "?",
    cls: m.status === "recovered" ? "warn" : (m.status === "closed" ? "ok" : "") });
  if (m.obs && m.obs.recording_path) pills.push({ label: "OBS", val: "linked", cls: "ok" });
  else pills.push({ label: "OBS", val: "none" });
  if (currentSession.stats) pills.push({ label: "normalized", val: "✓", cls: "ok" });
  $("#session-pills").innerHTML = pills.map((p) =>
    '<div class="pill' + (p.cls ? " " + p.cls : "") + '"><span class="dot"></span>' +
    '<span class="lbl">' + escapeHtml(p.label) + '</span>' + escapeHtml(String(p.val)) + '</div>'
  ).join("");
}

function setVideoOverlay(text) {
  let o = $("#video-overlay");
  o.textContent = text;
}

/* ============ Timeline ============================================ */

let zoomFactor = 1;

$("#btn-zoom-in").addEventListener("click", () => { zoomFactor *= 1.5; renderTimeline(); });
$("#btn-zoom-out").addEventListener("click", () => { zoomFactor = Math.max(1, zoomFactor / 1.5); renderTimeline(); });
$("#btn-zoom-reset").addEventListener("click", () => { zoomFactor = 1; renderTimeline(); });

function renderTimelineSummary() {
  const evs = currentSession.events;
  if (!evs.length) { $("#timeline-summary").textContent = ""; return; }
  const first = new Date(evs[0].timestamp);
  const last = new Date(evs[evs.length - 1].timestamp);
  $("#timeline-summary").textContent =
    first.toLocaleTimeString() + " → " + last.toLocaleTimeString() +
    " · " + formatDuration(last - first);
}

function renderTimeline() {
  const host = $("#timeline");
  host.innerHTML = "";
  const evs = currentSession.events;
  if (!evs.length) return;
  const first = new Date(evs[0].timestamp).getTime();
  const last = new Date(evs[evs.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);

  host.style.width = (100 * zoomFactor) + "%";
  const activityTop = 6;
  const activityH = 70;
  const caseTop = activityH + 24;
  const caseH = 26;
  host.style.height = Math.max(220, caseTop + caseH + 30) + "px";

  // Activity bands
  for (const ev of evs) {
    if (ev.type !== "activity") continue;
    const t = new Date(ev.timestamp).getTime();
    const dur = ev.data.duration_ms || 0;
    const x = ((t - first) / span) * 100;
    const w = Math.max(0.15, (dur / span) * 100);
    const band = document.createElement("div");
    band.className = "tl-band tl-activity";
    band.style.left = x + "%";
    band.style.width = w + "%";
    band.style.top = activityTop + "px";
    band.style.height = activityH + "px";
    band.title = (ev.data.app || "") + " — " + (ev.data.title || "") +
      "\n" + new Date(t).toLocaleTimeString() + " (" + formatDuration(dur) + ")";
    band.addEventListener("click", (e) => { e.stopPropagation(); seekToTimestamp(ev.timestamp); });
    host.appendChild(band);
  }

  // Idle bands
  let idleStart = null;
  for (const ev of evs) {
    if (ev.type !== "system") continue;
    if (ev.data.kind === "idle_start") idleStart = new Date(ev.timestamp).getTime();
    else if (ev.data.kind === "idle_end" && idleStart) {
      const endT = new Date(ev.timestamp).getTime();
      const x = ((idleStart - first) / span) * 100;
      const w = Math.max(0.15, ((endT - idleStart) / span) * 100);
      const band = document.createElement("div");
      band.className = "tl-band tl-idle";
      band.style.left = x + "%";
      band.style.width = w + "%";
      band.style.top = activityTop + "px";
      band.style.height = activityH + "px";
      band.title = "idle " + formatDuration(endT - idleStart);
      host.appendChild(band);
      idleStart = null;
    }
  }

  // Marker bars (rendered above bands)
  for (const ev of evs) {
    if (ev.type !== "marker") continue;
    const t = new Date(ev.timestamp).getTime();
    const x = ((t - first) / span) * 100;
    const bar = document.createElement("div");
    bar.className = "tl-marker";
    bar.style.left = x + "%";
    bar.style.height = activityH + "px";
    bar.style.top = activityTop + "px";
    bar.title = ev.data.marker_type + ": " + (ev.data.label || "") +
      (ev.data.reason ? " (" + ev.data.reason + ")" : "");
    host.appendChild(bar);
    if (ev.data.marker_type === "start" && ev.data.label) {
      const lbl = document.createElement("div");
      lbl.className = "tl-marker-label";
      lbl.style.left = "calc(" + x + "% + 4px)";
      lbl.style.top = (activityTop + 2) + "px";
      lbl.textContent = ev.data.label;
      host.appendChild(lbl);
    }
  }

  // Screenshot dots (on band bottom edge)
  for (const ev of evs) {
    if (ev.type !== "system") continue;
    if (ev.data.kind !== "screenshot" && ev.data.kind !== "screenshot_manual") continue;
    const t = new Date(ev.timestamp).getTime();
    const x = ((t - first) / span) * 100;
    const dot = document.createElement("div");
    dot.className = "tl-screenshot";
    dot.style.left = "calc(" + x + "% - 3px)";
    dot.style.top = (activityTop + activityH - 4) + "px";
    dot.title = ev.data.kind + " — " + new Date(t).toLocaleTimeString() +
      "\n" + (ev.data.path || "");
    dot.addEventListener("click", (e) => { e.stopPropagation(); openScreenshot(ev.data.path); });
    host.appendChild(dot);
  }

  // Case bands (with nesting)
  const stack = [];
  for (const ev of evs) {
    if (ev.type !== "marker") continue;
    const t = new Date(ev.timestamp).getTime();
    if (ev.data.marker_type === "start") {
      stack.push({ startMs: t, label: ev.data.label, depth: stack.length });
    } else if (ev.data.marker_type === "end" && stack.length) {
      const opened = stack.pop();
      const x = ((opened.startMs - first) / span) * 100;
      const w = Math.max(0.15, ((t - opened.startMs) / span) * 100);
      const band = document.createElement("div");
      band.className = "tl-case-band";
      band.style.left = x + "%";
      band.style.width = w + "%";
      band.style.top = (caseTop + opened.depth * 3) + "px";
      band.style.height = (caseH - opened.depth * 6) + "px";
      band.title = "case: " + (opened.label || "(unlabeled)") +
        "\n" + formatDuration(t - opened.startMs);
      band.addEventListener("click", (e) => {
        e.stopPropagation();
        seekToTimestamp(new Date(opened.startMs).toISOString());
      });
      host.appendChild(band);
      const lbl = document.createElement("div");
      lbl.className = "tl-case-label";
      lbl.style.left = "calc(" + x + "% + 4px)";
      lbl.style.top = (caseTop + opened.depth * 3 + 4) + "px";
      lbl.textContent = opened.label || "(unlabeled)";
      host.appendChild(lbl);
    }
  }
  for (const o of stack) {
    const x = ((o.startMs - first) / span) * 100;
    const w = ((last - o.startMs) / span) * 100;
    const band = document.createElement("div");
    band.className = "tl-case-band dangling";
    band.style.left = x + "%";
    band.style.width = w + "%";
    band.style.top = (caseTop + o.depth * 3) + "px";
    band.style.height = (caseH - o.depth * 6) + "px";
    band.title = "unclosed: " + (o.label || "(unlabeled)");
    host.appendChild(band);
  }

  // Playhead
  const ph = document.createElement("div");
  ph.className = "tl-playhead";
  ph.id = "tl-playhead";
  ph.style.left = "0%";
  ph.style.display = "none";
  host.appendChild(ph);

  // Click->seek on background
  host.addEventListener("click", (e) => {
    if (e.target !== host) return;
    const rect = host.getBoundingClientRect();
    const frac = (e.clientX + host.scrollLeft - rect.left) / rect.width;
    const target = first + frac * span;
    seekToTimestamp(new Date(target).toISOString());
  });
}

function positionPlayhead() {
  const video = $("#video");
  const ph = $("#tl-playhead");
  if (!ph || !currentSession || !currentSession.events.length) return;
  const first = new Date(currentSession.events[0].timestamp).getTime();
  const last = new Date(currentSession.events[currentSession.events.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);
  const obsStartTs = currentSession.manifest.obs && currentSession.manifest.obs.recording_start_ts;
  if (!obsStartTs) { ph.style.display = "none"; return; }
  const playT = new Date(obsStartTs).getTime() + video.currentTime * 1000;
  const x = ((playT - first) / span) * 100;
  ph.style.left = x + "%";
  ph.style.display = "";
  setVideoOverlay(formatPlayback(video.currentTime, video.duration));
}

function formatPlayback(curS, durS) {
  const fmt = (s) => {
    s = Math.max(0, s);
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  };
  return fmt(curS) + " / " + (isFinite(durS) ? fmt(durS) : "??:??");
}

function seekToTimestamp(ts) {
  if (!currentSession) return;
  const video = $("#video");
  const obsStartTs = currentSession.manifest.obs && currentSession.manifest.obs.recording_start_ts;
  if (!obsStartTs || !video.src) return;
  const offsetS = (new Date(ts).getTime() - new Date(obsStartTs).getTime()) / 1000;
  if (offsetS < 0) return;
  video.currentTime = offsetS;
  video.play().catch(() => {});
}

function videoTimeToSessionTs(seconds) {
  if (!currentSession) return null;
  const obsStartTs = currentSession.manifest.obs && currentSession.manifest.obs.recording_start_ts;
  if (!obsStartTs) return null;
  return new Date(new Date(obsStartTs).getTime() + seconds * 1000).toISOString();
}

/* ============ Event table ========================================= */

function renderEventTable() {
  const filter = ($("#event-filter").value || "").toLowerCase();
  const showAct = $("#cb-show-activity").checked;
  const showMark = $("#cb-show-marker").checked;
  const showSys = $("#cb-show-system").checked;
  const tbody = $("#event-table tbody");
  tbody.innerHTML = "";
  let count = 0;
  for (const ev of currentSession.events) {
    if (ev.type === "activity" && !showAct) continue;
    if (ev.type === "marker" && !showMark) continue;
    if (ev.type === "system" && !showSys) continue;
    const lbl = ev.type === "activity"
      ? (ev.data.activity_label || ev.data.app || "")
      : ev.type === "marker"
        ? (ev.data.marker_type + ": " + (ev.data.label || ""))
        : (ev.data.kind || "");
    const detail = ev.type === "activity"
      ? (ev.data.title || "")
      : ev.type === "marker"
        ? (ev.data.reason ? "reason: " + ev.data.reason : "")
        : JSON.stringify(ev.data).slice(0, 120);
    if (filter && !lbl.toLowerCase().includes(filter) && !detail.toLowerCase().includes(filter)) continue;
    const tr = document.createElement("tr");
    tr.className = "t-" + ev.type;
    const td = (cls, text) => {
      const c = document.createElement("td");
      if (cls) c.className = cls;
      c.textContent = text || "";
      return c;
    };
    const t = new Date(ev.timestamp);
    tr.appendChild(td("t-time",
      String(t.getHours()).padStart(2, "0") + ":" +
      String(t.getMinutes()).padStart(2, "0") + ":" +
      String(t.getSeconds()).padStart(2, "0") + "." +
      String(t.getMilliseconds()).padStart(3, "0")));
    tr.appendChild(td("t-type", ev.type));
    tr.appendChild(td("", lbl));
    tr.appendChild(td("", detail));
    tr.appendChild(td("", ev.type === "activity" ? formatDuration(ev.data.duration_ms) : ""));
    tr.addEventListener("click", () => seekToTimestamp(ev.timestamp));
    tbody.appendChild(tr);
    count += 1;
  }
  $("#event-count").textContent = String(count);
}

$("#event-filter").addEventListener("input", () => renderEventTable());
$("#cb-show-activity").addEventListener("change", () => renderEventTable());
$("#cb-show-marker").addEventListener("change", () => renderEventTable());
$("#cb-show-system").addEventListener("change", () => renderEventTable());

/* ============ Annotations / screenshots / markers ================= */

function renderAnnotations() {
  const host = $("#annotations-list");
  host.innerHTML = "";
  const notes = (currentSession.annotations && currentSession.annotations.notes) || [];
  if (!notes.length) {
    host.innerHTML = '<p class="hint">No annotations yet. Anchor a note to the current playback time below.</p>';
    return;
  }
  for (const n of notes.slice().reverse()) {
    const row = document.createElement("div");
    row.className = "anno-row";
    row.innerHTML = '<span class="ts">' + escapeHtml(n.timestamp.slice(11, 19)) + '</span>' +
                    '<span class="text">' + escapeHtml(n.text) + '</span>';
    row.addEventListener("click", () => seekToTimestamp(n.timestamp));
    host.appendChild(row);
  }
}

$("#btn-save-note").addEventListener("click", async () => {
  if (!currentSession) return;
  const note = $("#anno-note").value.trim();
  if (!note) return;
  const video = $("#video");
  const videoTs = videoTimeToSessionTs(video.currentTime) || new Date().toISOString();
  const anno = currentSession.annotations || { notes: [] };
  anno.notes = anno.notes || [];
  anno.notes.push({
    id: cryptoRandomId(),
    type: "note",
    timestamp: videoTs,
    video_offset_s: video.currentTime || 0,
    text: note,
  });
  await ipcRenderer.invoke("viewer:saveAnnotations", {
    sessionFolder: currentSession.sessionFolder,
    annotations: anno,
  });
  currentSession.annotations = anno;
  $("#anno-note").value = "";
  renderAnnotations();
  toast("Note saved", "success");
});

function renderScreenshots() {
  const host = $("#screenshots-grid");
  host.innerHTML = "";
  const shots = (currentSession.events || []).filter((e) =>
    e.type === "system" &&
    (e.data.kind === "screenshot" || e.data.kind === "screenshot_manual"));
  if (!shots.length) {
    host.innerHTML = '<p class="hint">No screenshots captured in this session.</p>';
    return;
  }
  for (const s of shots) {
    const card = document.createElement("div");
    card.className = "thumb";
    const fullPath = path.join(currentSession.sessionFolder, s.data.path);
    if (fs.existsSync(fullPath)) {
      const img = document.createElement("img");
      img.src = "file:///" + fullPath.replace(/\\/g, "/");
      card.appendChild(img);
    }
    const stamp = document.createElement("div");
    stamp.className = "stamp";
    stamp.textContent = s.timestamp.slice(11, 19);
    card.appendChild(stamp);
    if (s.data.kind === "screenshot_manual") {
      const b = document.createElement("div");
      b.className = "badge";
      b.textContent = "manual";
      card.appendChild(b);
    }
    card.title = s.timestamp + "\n" + s.data.path;
    card.addEventListener("click", () => seekToTimestamp(s.timestamp));
    host.appendChild(card);
  }
}

function openScreenshot(relPath) {
  if (!relPath || !currentSession) return;
  const full = path.join(currentSession.sessionFolder, relPath);
  if (fs.existsSync(full)) ipcRenderer.invoke("viewer:openExternal", full);
}

function renderMarkersList() {
  const host = $("#markers-list");
  host.innerHTML = "";
  const markers = (currentSession.events || []).filter((e) => e.type === "marker");
  if (!markers.length) {
    host.innerHTML = '<p class="hint">No markers fired in this session.</p>';
    return;
  }
  let depth = 0;
  for (const m of markers) {
    const row = document.createElement("div");
    row.className = "marker-row " + m.data.marker_type;
    if (m.data.marker_type === "end") depth = Math.max(0, depth - 1);
    row.innerHTML =
      '<span class="ts">' + escapeHtml(m.timestamp.slice(11, 19)) + '</span>' +
      '<span class="dir">' + (m.data.marker_type === "start" ? "▶" : "■") + '</span>' +
      '<span class="lbl">' + escapeHtml(m.data.label || "(unlabeled)") +
        (m.data.reason ? ' <span class="meta">(' + escapeHtml(m.data.reason) + ')</span>' : '') +
      '</span>' +
      '<span class="depth">L' + (m.data.marker_type === "start" ? depth : depth) + '</span>';
    if (m.data.marker_type === "start") depth += 1;
    row.addEventListener("click", () => seekToTimestamp(m.timestamp));
    host.appendChild(row);
  }
}

/* ============ Aggregate view ====================================== */

async function openMultiFlow() {
  const folders = await ipcRenderer.invoke("viewer:openMultipleSessions");
  if (!folders || !folders.length) return;
  const sessions = await ipcRenderer.invoke("viewer:loadMultipleSessions", folders);
  aggregateSessions = sessions.filter((s) => !s.error);
  $("#aggregate-empty").style.display = aggregateSessions.length ? "none" : "";
  $("#aggregate-loaded").style.display = aggregateSessions.length ? "" : "none";
  $("#btn-normalize-all").disabled = !aggregateSessions.length;
  renderAggregate();
  if (aggregateSessions.length) {
    toast(`Loaded ${aggregateSessions.length} session(s)`, "success");
  }
}

$("#btn-open-multi-hero").addEventListener("click", openMultiFlow);
$("#btn-open-multi").addEventListener("click", openMultiFlow);

$("#btn-normalize-all").addEventListener("click", async () => {
  if (!aggregateSessions.length) return;
  $("#btn-normalize-all").disabled = true;
  for (const s of aggregateSessions) {
    await ipcRenderer.invoke("viewer:runNormalize", {
      sessionFolder: s.sessionFolder,
      mine: true,
    });
  }
  const folders = aggregateSessions.map((s) => s.sessionFolder);
  aggregateSessions = await ipcRenderer.invoke("viewer:loadMultipleSessions", folders);
  aggregateSessions = aggregateSessions.filter((s) => !s.error);
  renderAggregate();
  $("#btn-normalize-all").disabled = false;
  toast("All sessions normalized + mined", "success");
});

function renderAggregate() {
  // Pills
  const numNormalized = aggregateSessions.filter((s) => !!s.stats).length;
  $("#aggregate-pills").innerHTML =
    '<div class="pill ok"><span class="dot"></span><span class="lbl">sessions</span>' + aggregateSessions.length + '</div>' +
    '<div class="pill' + (numNormalized === aggregateSessions.length ? ' ok' : '') + '">' +
      '<span class="dot"></span><span class="lbl">normalized</span>' + numNormalized + ' / ' + aggregateSessions.length + '</div>';

  const allStats = aggregateSessions.map((s) => s.stats).filter(Boolean);
  if (!allStats.length) {
    $("#map-empty").style.display = "";
    $("#activity-chart").innerHTML = '<div class="chart-empty">no data</div>';
    $("#case-chart").innerHTML = '<div class="chart-empty">no data</div>';
    return;
  }
  $("#map-empty").style.display = "none";

  // Merge activity stats
  const actMap = new Map();
  for (const st of allStats) {
    for (const r of (st.activity_stats || [])) {
      const e = actMap.get(r.activity_label) || {
        activity_label: r.activity_label, frequency: 0, total_duration_ms: 0,
        median_samples: [], p90_samples: [],
      };
      e.frequency += r.frequency;
      e.total_duration_ms += r.total_duration_ms;
      e.median_samples.push(r.median_ms);
      e.p90_samples.push(r.p90_ms);
      actMap.set(r.activity_label, e);
    }
  }
  const actRows = [...actMap.values()].sort((a, b) => b.frequency - a.frequency);
  window.PdtCharts.renderBarChart($("#activity-chart"),
    actRows.map((r) => ({
      label: r.activity_label,
      value: r.frequency,
      valueLabel: r.frequency + " · " + window.PdtCharts.fmtDurationS(r.total_duration_ms / 1000),
    })),
    { unit: "" });

  // Case durations: bar chart, active duration with wall-clock overlay
  const caseRows = [];
  for (const st of allStats) {
    for (const r of (st.case_stats || [])) {
      if (r.parent_case_id) continue; // top-level only
      caseRows.push({
        label: (r.label || r.case_id.slice(0, 8)),
        value: (r.active_ms || 0) / 1000,
        secondary: (r.wall_clock_ms || 0) / 1000,
        valueLabel: window.PdtCharts.fmtDurationS((r.active_ms || 0) / 1000),
        meta: r,
      });
    }
  }
  caseRows.sort((a, b) => b.value - a.value);
  window.PdtCharts.renderBarChart($("#case-chart"), caseRows, {
    color: "var(--accent-2)",
    secondaryColor: "var(--warn)",
  });

  // Variants table
  const varRows = [];
  for (const st of allStats) {
    for (const v of (st.trace_variants || [])) varRows.push([v.frequency, v.length, v.variant.join(" → ")]);
  }
  varRows.sort((a, b) => b[0] - a[0]);
  fillTable("#variants", varRows.slice(0, 80));

  // Outliers + rework
  const outRows = [];
  for (const st of allStats) {
    for (const r of (st.app_outliers || [])) outRows.push([r.app, r.case_count, r.case_pct + "%"]);
  }
  fillTable("#outliers", outRows);
  const reworkRows = [];
  for (const st of allStats) {
    for (const r of (st.rework_loops || [])) reworkRows.push([r.activity_label, r.rework_count]);
  }
  fillTable("#rework", reworkRows);

  // BPMN + DFG render from the first available session
  const sessionWithBpmn = aggregateSessions.find((s) =>
    fs.existsSync(path.join(s.sessionFolder, "process_map.bpmn")));
  if (sessionWithBpmn && window.PdtBpmn) {
    window.PdtBpmn.render($("#bpmn-host"),
      path.join(sessionWithBpmn.sessionFolder, "process_map.bpmn"));
  }
  // Merge DFG edges across sessions
  const edgeMap = new Map();
  const starts = new Map();
  const ends = new Map();
  for (const s of aggregateSessions) {
    if (!s.dfg) continue;
    for (const e of (s.dfg.edges || [])) {
      const k = e.source + "\x00" + e.target;
      edgeMap.set(k, (edgeMap.get(k) || 0) + (e.frequency || 1));
    }
    for (const [k, v] of Object.entries(s.dfg.start_activities || {})) {
      starts.set(k, (starts.get(k) || 0) + v);
    }
    for (const [k, v] of Object.entries(s.dfg.end_activities || {})) {
      ends.set(k, (ends.get(k) || 0) + v);
    }
  }
  if (edgeMap.size && window.PdtDfg) {
    const dfg = {
      edges: [...edgeMap.entries()].map(([k, freq]) => {
        const [source, target] = k.split("\x00");
        return { source, target, frequency: freq };
      }),
      start_activities: Object.fromEntries(starts),
      end_activities: Object.fromEntries(ends),
    };
    window.PdtDfg.render($("#dfg-host"), dfg);
  }

  // Export buttons
  const firstWithBpmn = aggregateSessions.find((s) =>
    fs.existsSync(path.join(s.sessionFolder, "process_map.bpmn")));
  $("#btn-export-bpmn").disabled = !firstWithBpmn;
  $("#btn-export-xes").disabled = !aggregateSessions.find((s) =>
    fs.existsSync(path.join(s.sessionFolder, "events.xes")));
  $("#btn-export-stats").disabled = !allStats.length;
}

/* ============ Exports ============================================= */

$("#btn-export-bpmn").addEventListener("click", () => exportFirst("process_map.bpmn"));
$("#btn-export-xes").addEventListener("click", () => exportFirst("events.xes"));
$("#btn-export-stats").addEventListener("click", () => exportFirst("stats.json"));

async function exportFirst(filename) {
  const s = aggregateSessions.find((x) =>
    fs.existsSync(path.join(x.sessionFolder, filename)));
  if (!s) return;
  const src = path.join(s.sessionFolder, filename);
  const out = await ipcRenderer.invoke("viewer:exportFile", {
    sourcePath: src,
    suggestedName: filename,
  });
  if (out) {
    await ipcRenderer.invoke("viewer:revealFile", out);
    toast("Exported: " + path.basename(out), "success");
  }
}

/* ============ Keyboard shortcuts ================================== */

document.addEventListener("keydown", (e) => {
  // Don't intercept while typing in inputs
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;

  if (e.key === "1") activateTab("session");
  else if (e.key === "2") activateTab("aggregate");
  else if (e.key === " ") {
    const video = $("#video");
    if (video && video.src) {
      if (video.paused) video.play(); else video.pause();
      e.preventDefault();
    }
  } else if (e.key === "ArrowLeft") {
    const video = $("#video");
    if (video && video.src) {
      video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 10 : 5));
      e.preventDefault();
    }
  } else if (e.key === "ArrowRight") {
    const video = $("#video");
    if (video && video.src) {
      video.currentTime = Math.min(video.duration || 0, video.currentTime + (e.shiftKey ? 10 : 5));
      e.preventDefault();
    }
  } else if (e.key === "+" || e.key === "=") {
    if ($("#view-session").classList.contains("active")) {
      zoomFactor *= 1.5; renderTimeline();
    }
  } else if (e.key === "-" || e.key === "_") {
    if ($("#view-session").classList.contains("active")) {
      zoomFactor = Math.max(1, zoomFactor / 1.5); renderTimeline();
    }
  } else if (e.key === "0") {
    if ($("#view-session").classList.contains("active")) {
      zoomFactor = 1; renderTimeline();
    }
  }
});

/* ============ Utilities =========================================== */

function formatDuration(ms) {
  if (ms == null) return "";
  const s = ms / 1000;
  if (s < 1) return Math.round(ms) + "ms";
  if (s < 60) return s.toFixed(1) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m" + Math.round(s % 60) + "s";
  return Math.floor(s / 3600) + "h" + Math.floor((s % 3600) / 60) + "m";
}

function fillTable(sel, rows) {
  const tbody = document.querySelector(sel + " tbody");
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (let i = 0; i < row.length; i++) {
      const td = document.createElement("td");
      if (typeof row[i] === "number" || /^[0-9.]+%?$/.test(String(row[i]))) td.className = "num";
      td.textContent = row[i] != null ? String(row[i]) : "";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cryptoRandomId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2);
}

/* ============ Boot ================================================ */

renderRecent();
$("#topbar-meta").textContent = "v0.1 · " + new Date().toLocaleDateString();
