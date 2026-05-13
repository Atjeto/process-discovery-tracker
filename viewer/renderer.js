/*
 * Viewer renderer (CJS with nodeIntegration, single window with two
 * tabbed views per §9.1 + §9.2). Drives both surfaces from one process
 * so they share the loaded data and IPC handlers in main.js.
 */

"use strict";

const { ipcRenderer } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

/* ---- Tab switching ---------------------------------------------- */

const tabs = document.querySelectorAll(".tab");
const views = document.querySelectorAll(".view");
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.view;
    tabs.forEach((t) => t.classList.toggle("active", t === tab));
    views.forEach((v) => v.classList.toggle("active", v.id === `view-${target}`));
  });
});

/* ---- Shared state ----------------------------------------------- */

let currentSession = null;        // for session view
let aggregateSessions = [];       // for aggregate view

/* ---- Session view ----------------------------------------------- */

const $ = (sel) => document.querySelector(sel);

$("#btn-open-session").addEventListener("click", async () => {
  const folder = await ipcRenderer.invoke("viewer:openSessionFolder");
  if (!folder) return;
  await loadSessionIntoView(folder);
});

$("#btn-normalize").addEventListener("click", async () => {
  if (!currentSession) return;
  const mine = $("#cb-mine").checked;
  $("#btn-normalize").disabled = true;
  $("#normalize-log").textContent = "";
  const r = await ipcRenderer.invoke("viewer:runNormalize", {
    sessionFolder: currentSession.sessionFolder,
    mine,
  });
  $("#btn-normalize").disabled = false;
  if (!r.ok) {
    $("#normalize-log").textContent += `\nERROR: ${r.error}`;
    return;
  }
  // Reload to pick up stats.json + dfg.json
  await loadSessionIntoView(currentSession.sessionFolder);
});

ipcRenderer.on("viewer:normalizeLog", (_e, text) => {
  const pre = $("#normalize-log");
  pre.textContent += text;
  pre.scrollTop = pre.scrollHeight;
});

$("#btn-save-note").addEventListener("click", async () => {
  if (!currentSession) return;
  const note = $("#anno-note").value.trim();
  if (!note) return;
  const video = $("#video");
  const videoTs = videoTimeToSessionTs(video.currentTime);
  const anno = currentSession.annotations || { notes: [] };
  anno.notes = anno.notes || [];
  anno.notes.push({
    id: cryptoRandomId(),
    type: "note",
    timestamp: videoTs || new Date().toISOString(),
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
});

async function loadSessionIntoView(folder) {
  try {
    currentSession = await ipcRenderer.invoke("viewer:loadSession", folder);
  } catch (e) {
    alert("Failed to load session: " + e.message);
    return;
  }
  $("#btn-normalize").disabled = false;
  $("#session-meta").textContent =
    `${path.basename(folder)} -- ${currentSession.events.length} events, ` +
    `status: ${currentSession.manifest.status || "?"}`;
  $("#event-count").textContent = String(currentSession.events.length);

  // Wire video element
  const video = $("#video");
  if (currentSession.recordingAvailable && currentSession.recordingPath) {
    video.src = "file:///" + currentSession.recordingPath.replace(/\\/g, "/");
    video.style.display = "";
    $("#no-video").style.display = "none";
  } else {
    video.removeAttribute("src");
    video.load();
    video.style.display = "none";
    $("#no-video").style.display = "";
  }

  renderTimeline();
  renderEventTable();
  renderAnnotations();
  renderTimelineSummary();

  // Hook click->seek
  video.addEventListener("timeupdate", positionPlayhead);
}

function renderTimelineSummary() {
  const evs = currentSession.events;
  const firstTs = evs.length ? new Date(evs[0].timestamp) : null;
  const lastTs = evs.length ? new Date(evs[evs.length - 1].timestamp) : null;
  if (!firstTs || !lastTs) {
    $("#timeline-summary").textContent = "";
    return;
  }
  const durMs = lastTs - firstTs;
  $("#timeline-summary").textContent =
    `${firstTs.toLocaleTimeString()} -> ${lastTs.toLocaleTimeString()} ` +
    `(${formatDuration(durMs)})`;
}

function renderTimeline() {
  const host = $("#timeline");
  host.innerHTML = "";
  const evs = currentSession.events;
  if (!evs.length) return;
  const first = new Date(evs[0].timestamp).getTime();
  const last = new Date(evs[evs.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);

  /* Two-band layout: activity row on top, case row beneath. */
  const activityTop = 4;
  const activityH = 60;
  const caseTop = activityH + 18;
  const caseH = 24;
  host.style.minHeight = `${caseTop + caseH + 20}px`;

  // Activity bands
  for (const ev of evs) {
    if (ev.type !== "activity") continue;
    const t = new Date(ev.timestamp).getTime();
    const dur = ev.data.duration_ms || 0;
    const x = ((t - first) / span) * 100;
    const w = Math.max(0.2, (dur / span) * 100);
    const band = document.createElement("div");
    band.className = "tl-band tl-activity";
    band.style.left = `${x}%`;
    band.style.width = `${w}%`;
    band.style.top = `${activityTop}px`;
    band.style.height = `${activityH}px`;
    band.title =
      `${ev.data.app || ""} -- ${ev.data.title || ""}\n` +
      `${ev.timestamp} (${formatDuration(dur)})`;
    band.addEventListener("click", () => seekToTimestamp(ev.timestamp));
    host.appendChild(band);
  }

  // Idle bands derived from idle_start/idle_end system events
  let idleStartTs = null;
  for (const ev of evs) {
    if (ev.type !== "system") continue;
    if (ev.data.kind === "idle_start") idleStartTs = new Date(ev.timestamp).getTime();
    else if (ev.data.kind === "idle_end" && idleStartTs) {
      const endT = new Date(ev.timestamp).getTime();
      const x = ((idleStartTs - first) / span) * 100;
      const w = Math.max(0.2, ((endT - idleStartTs) / span) * 100);
      const band = document.createElement("div");
      band.className = "tl-band tl-idle";
      band.style.left = `${x}%`;
      band.style.width = `${w}%`;
      band.style.top = `${activityTop}px`;
      band.style.height = `${activityH}px`;
      band.title = `idle ${formatDuration(endT - idleStartTs)}`;
      host.appendChild(band);
      idleStartTs = null;
    }
  }

  // Screenshot markers
  for (const ev of evs) {
    if (ev.type !== "system") continue;
    if (ev.data.kind !== "screenshot" && ev.data.kind !== "screenshot_manual") continue;
    const t = new Date(ev.timestamp).getTime();
    const x = ((t - first) / span) * 100;
    const dot = document.createElement("div");
    dot.className = "tl-screenshot";
    dot.style.left = `calc(${x}% - 3px)`;
    dot.style.top = `${activityTop + activityH - 6}px`;
    dot.title = `screenshot (${ev.data.kind})\n${ev.timestamp}\n${ev.data.path || ""}`;
    dot.addEventListener("click", () => seekToTimestamp(ev.timestamp));
    host.appendChild(dot);
  }

  // Marker bars + labels (rendered after activities so they sit on top)
  for (const ev of evs) {
    if (ev.type !== "marker") continue;
    const t = new Date(ev.timestamp).getTime();
    const x = ((t - first) / span) * 100;
    const bar = document.createElement("div");
    bar.className = "tl-marker";
    bar.style.left = `${x}%`;
    bar.style.height = `${activityH}px`;
    bar.style.top = `${activityTop}px`;
    bar.title = `${ev.data.marker_type}: ${ev.data.label || ""}${ev.data.reason ? " ("+ev.data.reason+")" : ""}`;
    host.appendChild(bar);
    if (ev.data.marker_type === "start" && ev.data.label) {
      const lbl = document.createElement("div");
      lbl.className = "tl-marker-label";
      lbl.style.left = `calc(${x}% + 3px)`;
      lbl.textContent = ev.data.label;
      host.appendChild(lbl);
    }
  }

  // Case overlays: each open marker bracket draws a horizontal band
  // in the case row, color-coded so nested cases are visible.
  const caseRow = document.createElement("div");
  caseRow.className = "tl-row tl-case-row";
  caseRow.style.top = `${caseTop}px`;
  caseRow.style.height = `${caseH}px`;
  host.appendChild(caseRow);
  const stack = [];
  for (const ev of evs) {
    if (ev.type !== "marker") continue;
    const t = new Date(ev.timestamp).getTime();
    if (ev.data.marker_type === "start") {
      stack.push({ startMs: t, label: ev.data.label, depth: stack.length });
    } else if (ev.data.marker_type === "end" && stack.length) {
      const opened = stack.pop();
      const x = ((opened.startMs - first) / span) * 100;
      const w = Math.max(0.2, ((t - opened.startMs) / span) * 100);
      const band = document.createElement("div");
      band.className = "tl-band";
      band.style.left = `${x}%`;
      band.style.width = `${w}%`;
      band.style.top = `${caseTop + opened.depth * 4}px`;
      band.style.height = `${caseH - opened.depth * 4}px`;
      band.style.background = `rgba(106, 140, 175, ${0.35 - opened.depth * 0.05})`;
      band.style.borderTop = "1px solid var(--accent-2)";
      band.title = `case: ${opened.label || "(unlabeled)"} (${formatDuration(t - opened.startMs)})`;
      host.appendChild(band);
      const lbl = document.createElement("div");
      lbl.className = "tl-case-label";
      lbl.style.left = `calc(${x}% + 4px)`;
      lbl.style.top = `${caseTop + opened.depth * 4 + 2}px`;
      lbl.textContent = opened.label || "(unlabeled)";
      host.appendChild(lbl);
    }
  }
  // Open markers left dangling at end (e.g. crash-recovered sessions)
  for (const o of stack) {
    const x = ((o.startMs - first) / span) * 100;
    const w = ((last - o.startMs) / span) * 100;
    const band = document.createElement("div");
    band.className = "tl-band";
    band.style.left = `${x}%`;
    band.style.width = `${w}%`;
    band.style.top = `${caseTop + o.depth * 4}px`;
    band.style.height = `${caseH - o.depth * 4}px`;
    band.style.background = "rgba(212, 162, 76, 0.25)";
    band.style.borderTop = "1px dashed var(--warn)";
    band.title = `unclosed: ${o.label || "(unlabeled)"}`;
    host.appendChild(band);
  }

  // Playhead element
  const ph = document.createElement("div");
  ph.className = "tl-playhead";
  ph.id = "tl-playhead";
  ph.style.left = "0%";
  ph.style.display = "none";
  host.appendChild(ph);

  // Click->seek
  host.addEventListener("click", (e) => {
    const rect = host.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const targetMs = first + frac * span;
    seekToTimestamp(new Date(targetMs).toISOString());
  });
}

function positionPlayhead() {
  const video = $("#video");
  const ph = $("#tl-playhead");
  if (!ph || !currentSession || !currentSession.events.length) return;
  const first = new Date(currentSession.events[0].timestamp).getTime();
  const last = new Date(currentSession.events[currentSession.events.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);
  const obsOffsetMs = (currentSession.manifest.obs && currentSession.manifest.obs.offset_ms) || 0;
  const obsStartTs = currentSession.manifest.obs && currentSession.manifest.obs.recording_start_ts;
  if (!obsStartTs) { ph.style.display = "none"; return; }
  const playT = new Date(obsStartTs).getTime() + video.currentTime * 1000;
  const x = ((playT - first) / span) * 100;
  ph.style.left = `${x}%`;
  ph.style.display = "";
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

function renderEventTable() {
  const tbody = $("#event-table tbody");
  tbody.innerHTML = "";
  for (const ev of currentSession.events) {
    const tr = document.createElement("tr");
    tr.className = `t-${ev.type}`;
    const td = (text) => { const c = document.createElement("td"); c.textContent = text; return c; };
    tr.appendChild(td(new Date(ev.timestamp).toLocaleTimeString() + "." +
      String(new Date(ev.timestamp).getMilliseconds()).padStart(3, "0")));
    tr.appendChild(td(ev.type));
    if (ev.type === "activity") {
      tr.appendChild(td(ev.data.activity_label || ev.data.app || ""));
      tr.appendChild(td(ev.data.title || ""));
      tr.appendChild(td(formatDuration(ev.data.duration_ms)));
      tr.appendChild(td((ev.data.case_ids || []).join(" / ") || ""));
    } else if (ev.type === "marker") {
      tr.appendChild(td(`${ev.data.marker_type}: ${ev.data.label || ""}`));
      tr.appendChild(td(ev.data.reason ? `reason: ${ev.data.reason}` : ""));
      tr.appendChild(td(""));
      tr.appendChild(td(ev.data.case_id || ""));
    } else {
      tr.appendChild(td(ev.data.kind || ""));
      tr.appendChild(td(JSON.stringify(ev.data).slice(0, 120)));
      tr.appendChild(td(""));
      tr.appendChild(td(""));
    }
    tr.addEventListener("click", () => seekToTimestamp(ev.timestamp));
    tbody.appendChild(tr);
  }
}

function renderAnnotations() {
  const host = $("#annotations-list");
  host.innerHTML = "";
  const notes = (currentSession.annotations && currentSession.annotations.notes) || [];
  if (!notes.length) {
    host.innerHTML = '<p class="hint">No annotations yet.</p>';
    return;
  }
  for (const n of notes) {
    const row = document.createElement("div");
    row.className = "anno-row";
    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = n.timestamp.slice(11, 19);
    const text = document.createElement("span");
    text.textContent = n.text;
    row.appendChild(ts);
    row.appendChild(text);
    row.addEventListener("click", () => seekToTimestamp(n.timestamp));
    host.appendChild(row);
  }
}

/* ---- Aggregate view --------------------------------------------- */

$("#btn-open-multi").addEventListener("click", async () => {
  const folders = await ipcRenderer.invoke("viewer:openMultipleSessions");
  if (!folders || !folders.length) return;
  const sessions = await ipcRenderer.invoke("viewer:loadMultipleSessions", folders);
  aggregateSessions = sessions.filter((s) => !s.error);
  $("#aggregate-meta").textContent = `${aggregateSessions.length} session(s) loaded`;
  $("#btn-normalize-all").disabled = !aggregateSessions.length;
  renderAggregate();
});

$("#btn-normalize-all").addEventListener("click", async () => {
  if (!aggregateSessions.length) return;
  $("#btn-normalize-all").disabled = true;
  for (const s of aggregateSessions) {
    await ipcRenderer.invoke("viewer:runNormalize", {
      sessionFolder: s.sessionFolder,
      mine: true,
    });
  }
  // Reload all
  const folders = aggregateSessions.map((s) => s.sessionFolder);
  aggregateSessions = await ipcRenderer.invoke("viewer:loadMultipleSessions", folders);
  aggregateSessions = aggregateSessions.filter((s) => !s.error);
  renderAggregate();
  $("#btn-normalize-all").disabled = false;
});

function renderAggregate() {
  const allStats = aggregateSessions.map((s) => s.stats).filter(Boolean);
  if (!allStats.length) {
    $("#aggregate-meta").textContent += " -- run normalization first";
    return;
  }

  // Activity stats: merge by activity_label, sum frequency, weighted average for median/p90
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
  const actRows = [...actMap.values()].sort((a, b) => b.total_duration_ms - a.total_duration_ms);
  fillTable("#activity-stats", actRows.map((r) => [
    r.activity_label, r.frequency,
    (r.total_duration_ms / 1000).toFixed(1),
    (avg(r.median_samples) / 1000).toFixed(1),
    (avg(r.p90_samples) / 1000).toFixed(1),
  ]));

  // Case stats: flat list across all sessions
  const caseRows = [];
  for (const st of allStats) {
    for (const r of (st.case_stats || [])) {
      caseRows.push([
        r.case_id.slice(0, 8), r.label || "",
        r.wall_clock_ms != null ? (r.wall_clock_ms / 1000).toFixed(1) : "",
        (r.active_ms / 1000).toFixed(1),
        r.end_reason || "",
      ]);
    }
  }
  fillTable("#case-stats", caseRows);

  // Variants
  const varRows = [];
  for (const st of allStats) {
    for (const v of (st.trace_variants || [])) {
      varRows.push([v.frequency, v.length, v.variant.join(" -> ")]);
    }
  }
  varRows.sort((a, b) => b[0] - a[0]);
  fillTable("#variants", varRows.slice(0, 100));

  // Outliers
  const outRows = [];
  for (const st of allStats) {
    for (const r of (st.app_outliers || [])) outRows.push([r.app, r.case_count, r.case_pct + "%"]);
  }
  fillTable("#outliers", outRows);

  // Rework
  const reworkRows = [];
  for (const st of allStats) {
    for (const r of (st.rework_loops || [])) reworkRows.push([r.activity_label, r.rework_count]);
  }
  fillTable("#rework", reworkRows);

  // DFG: merge edges across all sessions
  const edgeMap = new Map();
  for (const s of aggregateSessions) {
    const dfg = s.dfg;
    if (!dfg) continue;
    for (const e of (dfg.edges || [])) {
      const key = e.source + "\x00" + e.target;
      edgeMap.set(key, (edgeMap.get(key) || 0) + e.frequency);
    }
  }
  const dfgHost = $("#dfg-host");
  dfgHost.innerHTML = "";
  if (!edgeMap.size) {
    dfgHost.innerHTML = '<p class="hint">No DFG data. Tick "Also mine BPMN + DFG" before normalizing.</p>';
  } else {
    const edges = [...edgeMap.entries()].map(([k, freq]) => {
      const [source, target] = k.split("\x00");
      return { source, target, freq };
    }).sort((a, b) => b.freq - a.freq);
    for (const e of edges.slice(0, 80)) {
      const row = document.createElement("div");
      row.className = "dfg-edge";
      row.innerHTML = `<span class="dfg-node">${escapeHtml(e.source)}</span>` +
        `<span class="arrow">-&gt;</span>` +
        `<span class="dfg-node">${escapeHtml(e.target)}</span>` +
        `<span class="freq">${e.freq}</span>`;
      dfgHost.appendChild(row);
    }
  }

  // Export buttons: enable if a BPMN exists in at least one session
  const firstWithBpmn = aggregateSessions.find((s) =>
    fs.existsSync(`${s.sessionFolder}/process_map.bpmn`));
  $("#btn-export-bpmn").disabled = !firstWithBpmn;
  $("#btn-export-xes").disabled = !aggregateSessions.length;
  $("#btn-export-stats").disabled = !allStats.length;
}

$("#btn-export-bpmn").addEventListener("click", async () => {
  const s = aggregateSessions.find((x) => fs.existsSync(`${x.sessionFolder}/process_map.bpmn`));
  if (!s) return;
  const src = `${s.sessionFolder}/process_map.bpmn`;
  const out = await ipcRenderer.invoke("viewer:exportFile", {
    sourcePath: src,
    suggestedName: "process_map.bpmn",
  });
  if (out) await ipcRenderer.invoke("viewer:revealFile", out);
});
$("#btn-export-xes").addEventListener("click", async () => {
  const s = aggregateSessions.find((x) => fs.existsSync(`${x.sessionFolder}/events.xes`));
  if (!s) return;
  const out = await ipcRenderer.invoke("viewer:exportFile", {
    sourcePath: `${s.sessionFolder}/events.xes`,
    suggestedName: "events.xes",
  });
  if (out) await ipcRenderer.invoke("viewer:revealFile", out);
});
$("#btn-export-stats").addEventListener("click", async () => {
  const s = aggregateSessions.find((x) => fs.existsSync(`${x.sessionFolder}/stats.json`));
  if (!s) return;
  const out = await ipcRenderer.invoke("viewer:exportFile", {
    sourcePath: `${s.sessionFolder}/stats.json`,
    suggestedName: "stats.json",
  });
  if (out) await ipcRenderer.invoke("viewer:revealFile", out);
});

/* ---- Utilities --------------------------------------------------- */

function formatDuration(ms) {
  if (ms == null) return "";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

function fillTable(sel, rows) {
  const tbody = document.querySelector(`${sel} tbody`);
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

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cryptoRandomId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2);
}
