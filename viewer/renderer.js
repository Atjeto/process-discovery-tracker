/*
 * Viewer renderer -- session + aggregate surfaces glued together.
 *
 * Depends on globals exposed by sibling scripts loaded earlier in
 * index.html:
 *   window.PdtCharts (charts.js)
 *   PdtDfg    (dfg-viewer.js, cytoscape)
 *   PdtBpmn   (bpmn-viewer.js, bpmn-js)
 */

"use strict";

const { ipcRenderer } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const TimelineCore = require("./timeline/timeline-core.js");
const State = require("./state.js");
const PdtCharts = require("./charts.js");
const PdtReport = require("./report-md.js");
const PdtPalette = require("./command-palette.js");
const PdtDfg = require("./dfg-viewer.js");
const PdtBpmn = require("./bpmn-viewer.js");
const PdtSteps = require("./step-editor.js");
require("./layout-controls.js"); // side-effect import: self-wires resize handles + video modes

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ============ Annotations undo stack
   ================================================================
   Step / phase / marker edits all flow through saveAnnotations(). We
   snapshot the previous annotations.json blob BEFORE each save, so
   Ctrl+Z can revert one operation at a time. The stack is in-memory
   (not persisted across viewer restart), capped at 50 entries, and
   reset when a different session is opened. Redo (Ctrl+Shift+Z)
   walks back forward through entries the user just undid.

   Operations that route through here: rename step/phase/marker,
   add/delete step or phase, split/merge, group-into-phase, drag-
   reorder steps in a phase, insert synthetic marker, adjust marker
   timestamp, attach external video. */
/* The undo/redo stacks live in the state module; the orchestration
   (IPC save + re-render) stays here. */
function resetUndoStack() { State.resetUndo(); }
function canUndo() {
  const s = State.getSession();
  return !!s && State.canUndo(s.sessionFolder);
}
function canRedo() {
  const s = State.getSession();
  return !!s && State.canRedo(s.sessionFolder);
}
function emptyAnnotationsShape() {
  return { steps: [], phases: [], annotations: [], notes: [], marker_edits: [], drift_markers: [] };
}
function snapshotAnnotations(a) {
  // Never push null/undefined onto the stack -- a later undo/redo
  // would write null into annotations.json. Clone defensively.
  if (!a) return emptyAnnotationsShape();
  try { return JSON.parse(JSON.stringify(a)); }
  catch (_) { return emptyAnnotationsShape(); }
}
async function saveAnnotationsWithUndo(annotations, label) {
  const session = State.getSession();
  if (!session || !session.sessionFolder) return null;
  const sf = session.sessionFolder;
  // Snapshot the PREVIOUS state before we replace it.
  State.recordEdit({
    label: label || "edit",
    annotations: snapshotAnnotations(session.annotations),
    sessionFolder: sf,
  });
  return await ipcRenderer.invoke("viewer:saveAnnotations", {
    sessionFolder: sf,
    annotations,
  });
}
/* Undo / redo revert one edit by writing the saved annotations blob
   back to disk and refreshing the affected views IN PLACE. The old
   implementation reloaded the whole session -- a viewer:loadSession
   round-trip plus a repaint of every surface -- just to revert one
   edit (issue S6). */
async function performUndo() {
  const session = State.getSession();
  if (!session) return;
  const popped = State.popUndo(session.sessionFolder);
  if (!popped) { toast("Nothing to undo"); return; }
  // Push the CURRENT state onto the redo stack before reverting.
  State.pushRedo({
    label: popped.label,
    annotations: snapshotAnnotations(session.annotations),
    sessionFolder: popped.sessionFolder,
  });
  await ipcRenderer.invoke("viewer:saveAnnotations", {
    sessionFolder: popped.sessionFolder,
    annotations: popped.annotations,
  });
  applyRevertedAnnotations(popped.annotations);
  toast("Undone: " + popped.label);
}
async function performRedo() {
  const session = State.getSession();
  if (!session) return;
  const popped = State.popRedo(session.sessionFolder);
  if (!popped) { toast("Nothing to redo"); return; }
  // Push current state to undo so the user can flip back.
  State.pushUndo({
    label: popped.label,
    annotations: snapshotAnnotations(session.annotations),
    sessionFolder: popped.sessionFolder,
  });
  await ipcRenderer.invoke("viewer:saveAnnotations", {
    sessionFolder: popped.sessionFolder,
    annotations: popped.annotations,
  });
  applyRevertedAnnotations(popped.annotations);
  toast("Redone: " + popped.label);
}
/* Swap a reverted annotations blob into the loaded session and refresh
   every annotation-derived surface -- the in-place alternative to a
   full session reload. */
function applyRevertedAnnotations(annotations) {
  State.getSession().annotations = ensureAnnoShape(annotations);
  State.batch(() => {
    State.emit("steps");
    State.emit("phases");
    State.emit("timeline");
    State.emit("markers");
  });
  renderAnnotations();
  renderSessionPills();
}

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
const EXAMPLE_HIDDEN_KEY = "pdt.exampleSessionsHidden";

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
  catch (_) { return []; }
}
function setRecent(list) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}
function getHiddenExamples() {
  try { return new Set(JSON.parse(localStorage.getItem(EXAMPLE_HIDDEN_KEY)) || []); }
  catch (_) { return new Set(); }
}
function setHiddenExamples(set) {
  localStorage.setItem(EXAMPLE_HIDDEN_KEY, JSON.stringify(Array.from(set)));
}
function pushRecent(sessionFolder, label) {
  let list = getRecent().filter((r) => r.folder !== sessionFolder);
  list.unshift({ folder: sessionFolder, label, ts: Date.now() });
  list = list.slice(0, 8);
  setRecent(list);
  renderRecent();
}
function removeRecent(folder) {
  /* Examples aren't stored in localStorage -- they're rendered live
     from disk. To "remove" one we mark it hidden so future renders
     skip it. Real recents get pulled from RECENT_KEY as before. */
  const examples = listBundledExamples();
  if (examples.some((e) => e.folder === folder)) {
    const hidden = getHiddenExamples();
    hidden.add(folder);
    setHiddenExamples(hidden);
  } else {
    setRecent(getRecent().filter((r) => r.folder !== folder));
  }
  renderRecent();
}
function clearAllRecent() {
  /* Wipes both the real recents AND the hidden-examples set, so
     anything that was bundled comes back on the next render. */
  setRecent([]);
  localStorage.removeItem(EXAMPLE_HIDDEN_KEY);
  renderRecent();
}

/* Resolve where the bundled example sessions live. In dev the path is
   ../sessions/example-aggregate relative to the renderer's __dirname;
   in a packaged release electron-packager's --extra-resource puts
   them under process.resourcesPath/example-aggregate/. */
function bundledExamplesDir() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "example-aggregate") : null,
    path.resolve(__dirname, "..", "sessions", "example-aggregate"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
  }
  return null;
}

/* Live-read the example-sessions list every render. Cheap (5 sessions,
   one readdir), and avoids the localStorage-staleness problems of the
   earlier seed-on-first-launch approach -- examples just always
   appear unless the user × them. */
function listBundledExamples() {
  const root = bundledExamplesDir();
  if (!root) return [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (_) {
    return [];
  }
  return entries.map((d) => ({
    folder: path.join(root, d.name),
    label: "example - " + d.name,
    example: true,
  }));
}

/* Auto-clean grace period (P1.8). Once a recents entry is detected
   missing, we stamp `firstMissingAt`. After STALE_RECENT_DAYS in that
   missing state, the entry is silently dropped on the next render --
   long enough that a one-off network hiccup or unplugged drive doesn't
   prune real recents, but short enough that long-deleted folders don't
   accumulate forever. */
const STALE_RECENT_DAYS = 30;

function renderRecent() {
  const host = $("#recent-list-session");
  if (!host) return;
  const clearBtn = $("#recent-clear-all");
  let recents = getRecent();
  const hidden = getHiddenExamples();
  const examples = listBundledExamples().filter((e) => !hidden.has(e.folder));

  // Auto-clean stale missing entries (P1.8): stamp firstMissingAt on
  // first miss, drop entries that have been missing > STALE_RECENT_DAYS.
  const now = Date.now();
  const staleMs = STALE_RECENT_DAYS * 24 * 60 * 60 * 1000;
  let recentsMutated = false;
  const survivors = [];
  for (const r of recents) {
    let missing = false;
    try { missing = !fs.existsSync(r.folder); } catch (_) { missing = true; }
    if (!missing) {
      // Folder is back -- clear any prior firstMissingAt stamp.
      if (r.firstMissingAt) { delete r.firstMissingAt; recentsMutated = true; }
      survivors.push(r);
      continue;
    }
    if (!r.firstMissingAt) {
      r.firstMissingAt = now;
      recentsMutated = true;
      survivors.push(r);
    } else if (now - r.firstMissingAt > staleMs) {
      // Stale. Drop it silently.
      recentsMutated = true;
      continue;
    } else {
      survivors.push(r);
    }
  }
  if (recentsMutated) {
    recents = survivors;
    setRecent(recents);
  }

  const combined = recents.concat(examples);

  if (!combined.length) {
    host.innerHTML = '<li style="cursor:default;background:transparent;border:none;color:var(--fg-4)">No recent sessions yet.</li>';
    if (clearBtn) clearBtn.style.display = "none";
    return;
  }
  if (clearBtn) clearBtn.style.display = "";

  // Compute live missing-state for the visible list (recents + examples).
  let missingCount = 0;
  const rowData = combined.map((r) => {
    let missing = false;
    try { missing = !fs.existsSync(r.folder); } catch (_) { missing = true; }
    if (missing) missingCount++;
    return { r, missing };
  });

  host.innerHTML = rowData.map(({ r, missing }) => {
    const label = escapeHtml(r.label || path.basename(r.folder));
    const exampleTag = r.example ? '<span class="recent-tag">example</span>' : "";
    const missingTag = missing ? '<span class="recent-missing-tag">missing</span>' : "";
    const cls = missing ? "missing" : "";
    return '<li data-folder="' + escapeHtml(r.folder) + '" class="' + cls + '" title="' + escapeHtml(r.folder) + '">' +
      '<span class="label">' + label + exampleTag + missingTag + '</span>' +
      '<span class="when">' + (r.example || !r.ts ? "" : relTime(r.ts)) + '</span>' +
      '<button class="recent-remove" type="button" title="' + (r.example ? "Hide this example" : "Remove from recents") + '">×</button>' +
    '</li>';
  }).join("");

  // P1.6: batch "Remove N missing" link, alongside Clear all, when ≥2 missing.
  if (clearBtn && missingCount >= 2) {
    let bulk = document.getElementById("recent-bulk-missing");
    if (!bulk) {
      bulk = document.createElement("button");
      bulk.id = "recent-bulk-missing";
      bulk.className = "recent-clear-btn";
      bulk.type = "button";
      bulk.style.marginRight = "6px";
      clearBtn.parentNode.insertBefore(bulk, clearBtn);
      bulk.addEventListener("click", () => {
        const live = getRecent().filter((rr) => {
          try { return fs.existsSync(rr.folder); } catch (_) { return false; }
        });
        setRecent(live);
        renderRecent();
      });
    }
    bulk.textContent = "Remove " + missingCount + " missing";
    bulk.style.display = "";
  } else {
    const bulk = document.getElementById("recent-bulk-missing");
    if (bulk) bulk.style.display = "none";
  }

  host.querySelectorAll("li[data-folder]").forEach((li) => {
    li.addEventListener("click", (e) => {
      if (e.target.closest(".recent-remove")) return;
      loadSessionIntoView(li.dataset.folder);
    });
  });
  host.querySelectorAll(".recent-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeRecent(btn.closest("li").dataset.folder);
    });
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

/* Clear-all button lives outside the <ul> so it doesn't get nuked on
   every renderRecent(). Wire once at boot. */
(function wireRecentClearAll() {
  const btn = document.getElementById("recent-clear-all");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!getRecent().length) return;
    const ok = await confirmModal({
      title: "Clear recents?",
      message: "Remove all entries from Recents?",
      detail: "Bundled example sessions reappear automatically. Real recents are removed from localStorage; the underlying session folders aren't touched.",
      okLabel: "Clear",
      danger: true,
    });
    if (ok) clearAllRecent();
  });
})();

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
      if (PdtBpmn) PdtBpmn.fit();
      if (PdtDfg) PdtDfg.fit();
    }, 100);
    // AM.1: refresh the version compare list when the analyst lands
    // on the aggregate view (and a template is loaded).
    if (typeof refreshTemplateVersions === "function") refreshTemplateVersions().catch(() => {});
  }
  if (name === "vocabularies") {
    reloadVocabList();
  }
  // P2.4: shortcuts overlay only shows on Session view.
  if (typeof renderShortcutsOverlay === "function") renderShortcutsOverlay();
}

/* ============ Session view-mode switcher (Flow / Steps / Phases) ===
   The view-mode bar at the top of the loaded session swaps between
   three top-level layouts:
     #session-layout-flow    - video + timeline + annotations
     #session-layout-steps   - full-width step editor with timeline band
     #session-layout-phases  - full-width phase editor with timeline band
   This is a much bigger change than the original "toggle which timeline
   strip is visible" approach because users couldn't find the cramped
   editor inside the narrow annotations panel. */

$$(".view-mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".view-mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
    applyLevel(btn.dataset.level);
  });
});

const VIEW_MODE_HELP = {
  flow:   "Flow view: video, raw event timeline, and side panel for notes / screenshots / markers.",
  steps:  "Steps view: rename, split, merge, or flag the logical actions captured in this session.",
  phases: "Phases view: group steps into milestones, or review the phases an auto-match produced.",
};

/* P2.3: viewport state transfer on mode switch. Each mode owns its own
   scroll container (the Flow timeline, the Steps mini-timeline, the
   Phases mini-timeline). When the analyst flips views we snapshot the
   outgoing mode's zoom + scroll fraction and apply them to the
   incoming mode -- "stayed at the same zoom + position" feel without
   forcing the three modes to share a single DOM scroll container. */
/* P2.3 viewport transfer: each mode owns its own scroll container and
   zoom variable. MODE_VIEWPORT pairs the three so snapshot/apply is one
   code path instead of three copy-pasted `if (mode === ...)` arms.
   (Zoom still reads/writes the renderer-local vars; they move into the
   state module in a later step.) */
const MODE_VIEWPORT = {
  flow: {
    scrollSel: "#timeline-scroll",
    getZoom: State.getZoomFactor, setZoom: State.setZoomFactor,
    render: renderTimeline,
  },
  steps: {
    scrollSel: "#session-layout-steps .mini-timeline-scroll",
    getZoom: State.getStepZoom, setZoom: State.setStepZoom,
    render: renderStepsLevel,
  },
  phases: {
    scrollSel: "#session-layout-phases .mini-timeline-scroll",
    getZoom: State.getPhaseZoom, setZoom: State.setPhaseZoom,
    render: renderPhasesLevel,
  },
};
function _viewportSnapshotForMode(mode) {
  const m = MODE_VIEWPORT[mode];
  if (!m) return { zoom: 1, scrollFrac: 0 };
  let scrollFrac = 0;
  const el = document.querySelector(m.scrollSel);
  if (el && el.scrollWidth > el.clientWidth) {
    scrollFrac = el.scrollLeft / (el.scrollWidth - el.clientWidth);
  }
  return { zoom: Math.max(1, m.getZoom() || 1), scrollFrac: Math.max(0, Math.min(1, scrollFrac || 0)) };
}
function _viewportApplyToMode(mode, snap) {
  // Set the mode's zoom BEFORE re-rendering (the render reads it), then
  // restore scrollLeft after a frame so the host has expanded.
  const m = MODE_VIEWPORT[mode];
  if (!m) return;
  m.setZoom(snap.zoom);
  m.render();
  requestAnimationFrame(() => {
    const el = document.querySelector(m.scrollSel);
    if (el) el.scrollLeft = snap.scrollFrac * Math.max(0, el.scrollWidth - el.clientWidth);
  });
}

const LEVEL_RENDERERS = { flow: renderTimeline, steps: renderStepsLevel, phases: renderPhasesLevel };

/* Wire the state change-notification bus: an annotation edit emits the
   topics it touched (see persistAnnotations / performUndo / performRedo)
   and the matching view re-renders itself -- no full-session reload. */
State.subscribe("steps",    renderStepsLevel);
State.subscribe("phases",   renderPhasesLevel);
State.subscribe("timeline", renderTimeline);
State.subscribe("markers",  renderMarkersList);

/* Re-render whichever session sub-view is on screen. The single
   dispatch point for "the active level's data changed" -- it replaces
   an `if (currentLevel === ...)` triplet that was copied verbatim
   across the case-scope and command-palette handlers (issue S5). */
function rerenderActiveLevel() {
  const fn = LEVEL_RENDERERS[State.getLevel()];
  if (fn) fn();
}

function applyLevel(name) {
  // P2.3: capture the outgoing mode's viewport BEFORE we hide its
  // panel -- once display:none is set, scrollWidth / clientWidth both
  // return 0 and we'd lose the snapshot. Skip the very first call
  // (the level wasn't yet displayed).
  const prev = State.getLevel();
  const incomingSnap = (prev && prev !== name)
    ? _viewportSnapshotForMode(prev)
    : null;
  // Now safe to swap visibility.
  State.setLevel(name);
  const layouts = ["flow", "steps", "phases"];
  for (const l of layouts) {
    const el = document.getElementById("session-layout-" + l);
    if (el) el.style.display = l === name ? "" : "none";
  }
  const help = document.getElementById("view-mode-help");
  if (help) help.textContent = VIEW_MODE_HELP[name] || "";
  if (incomingSnap) {
    _viewportApplyToMode(name, incomingSnap);
  } else {
    rerenderActiveLevel();
  }
  // P2.4: refresh the shortcuts overlay for the new view.
  renderShortcutsOverlay();
}

/* P2.4: small persistent corner widget listing 3-4 most-used
   shortcuts for the active view. Dismissable; state persisted to
   localStorage so the analyst doesn't have to dismiss every launch. */
const SHORTCUTS_OVERLAY_KEY = "pdt.shortcutsOverlayHidden";
const VIEW_SHORTCUTS = {
  flow: [
    ["Space", "Play / pause video"],
    ["← →",  "Scrub 5s"],
    ["+ −",  "Zoom timeline"],
    ["Shift-drag", "Select range"],
  ],
  steps: [
    ["J / K", "Prev / next step"],
    ["S",     "Split step at playhead"],
    ["M",     "Merge selected"],
    ["Ctrl+Z", "Undo"],
  ],
  phases: [
    ["Drag",  "Reorder steps in phase"],
    ["G",     "Group selected steps into a phase"],
    ["Ctrl+Z", "Undo"],
    ["?",     "Open help"],
  ],
};
function renderShortcutsOverlay() {
  const ov = document.getElementById("shortcuts-overlay");
  if (!ov) return;
  const hidden = localStorage.getItem(SHORTCUTS_OVERLAY_KEY) === "1";
  // Only show on the Session view, when a session is loaded, and not dismissed.
  const onSession = document.querySelector(".tab.active") &&
                    document.querySelector(".tab.active").dataset.view === "session";
  if (hidden || !onSession || !State.getSession()) {
    ov.style.display = "none";
    return;
  }
  const lvl = State.getLevel();
  const items = VIEW_SHORTCUTS[lvl] || [];
  if (!items.length) { ov.style.display = "none"; return; }
  ov.style.display = "";
  document.getElementById("shortcuts-overlay-title").textContent =
    lvl.charAt(0).toUpperCase() + lvl.slice(1) + " shortcuts";
  document.getElementById("shortcuts-overlay-list").innerHTML =
    items.map(([k, d]) =>
      '<li><span class="key">' + escapeHtml(k) + '</span><span>' + escapeHtml(d) + '</span></li>'
    ).join("");
}
(function wireShortcutsOverlay() {
  const closeBtn = document.getElementById("shortcuts-overlay-close");
  if (closeBtn) closeBtn.addEventListener("click", () => {
    localStorage.setItem(SHORTCUTS_OVERLAY_KEY, "1");
    renderShortcutsOverlay();
  });
})();

function activateAnnoTab(name) {
  $$(".anno-tab").forEach((t) => t.classList.toggle("active", t.dataset.anno === name));
  $$(".anno-panel").forEach((p) =>
    p.style.display = p.dataset.panel === name ? "" : "none"
  );
}

/* ============ Steps view rendering ================================ */

function getSpan() {
  const evs = (State.getSession() && State.getSession().events) || [];
  if (!evs.length) return null;
  return {
    startMs: new Date(evs[0].timestamp).getTime(),
    endMs:   new Date(evs[evs.length - 1].timestamp).getTime(),
  };
}

function decorateDrift(steps) {
  const drifts = (State.getSession().annotations && State.getSession().annotations.drift_markers) || [];
  const byStep = {};
  for (const d of drifts) {
    byStep[d.step_id] = d;
  }
  return (steps || []).map(s => byStep[s.step_id] ? { ...s, drift: byStep[s.step_id] } : s);
}

/* Build the canonical list of cases for the loaded session. Pairs
   step.case_id ranges (the data-side source of truth) with marker
   labels (the user-recognizable name) so the dropdown shows e.g.
   "Order #12345" instead of "c001". */
function deriveCases(session) {
  if (!session) return [];
  const steps = (session.annotations && session.annotations.steps) || [];
  const markers = (session.events || []).filter(e => e.type === "marker");

  const byCase = new Map();
  for (const s of steps) {
    if (!s.case_id || !s.time_range) continue;
    const startMs = new Date(s.time_range.start).getTime();
    const endMs = new Date(s.time_range.end).getTime();
    if (!byCase.has(s.case_id)) {
      byCase.set(s.case_id, { id: s.case_id, label: s.case_id, startMs, endMs });
    } else {
      const c = byCase.get(s.case_id);
      c.startMs = Math.min(c.startMs, startMs);
      c.endMs = Math.max(c.endMs, endMs);
    }
  }

  // Best-effort marker-label enrichment: match a case whose range
  // begins within 5s of a start-marker, adopt the marker's label.
  const stack = [];
  for (const ev of markers) {
    const t = new Date(ev.timestamp).getTime();
    if (ev.data.marker_type === "start") {
      stack.push({ label: ev.data.label, startMs: t });
    } else if (ev.data.marker_type === "end" && stack.length) {
      const opened = stack.pop();
      if (!opened.label) continue;
      for (const c of byCase.values()) {
        if (Math.abs(c.startMs - opened.startMs) < 5000) {
          c.label = opened.label;
        }
      }
    }
  }

  return Array.from(byCase.values()).sort((a, b) => a.startMs - b.startMs);
}

function currentScopeRange() {
  if (!State.getCaseScope() || !State.getSession()) return null;
  const cases = deriveCases(State.getSession());
  return cases.find(c => c.id === State.getCaseScope()) || null;
}

function populateCaseScope() {
  const sel = document.getElementById("case-scope-select");
  if (!sel) return;
  const cases = State.getSession() ? deriveCases(State.getSession()) : [];
  // P2.8: dedup duplicate labels with a [H:MM:SS] timecode suffix so
  // analysts can tell "Send email" #2 from "Send email" #5 etc.
  const labelCounts = {};
  for (const c of cases) {
    const k = c.label || c.id;
    labelCounts[k] = (labelCounts[k] || 0) + 1;
  }
  function timecode(ms) {
    if (!ms) return "";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(ss).padStart(2, "0");
  }
  const opts = ['<option value="">All cases</option>']
    .concat(cases.map(c => {
      const baseLabel = c.label && c.label !== c.id ? c.label : c.id;
      const needsSuffix = labelCounts[baseLabel] > 1;
      const offsetMs = c.startMs && State.getSession().events.length
        ? c.startMs - new Date(State.getSession().events[0].timestamp).getTime()
        : 0;
      const label = needsSuffix
        ? `${baseLabel} [${timecode(offsetMs)}]`
        : baseLabel;
      return `<option value="${c.id}"${c.id === State.getCaseScope() ? " selected" : ""}>${escapeHtml(label)}</option>`;
    }));
  // Cases are derived from analyzed steps. An unanalyzed session has
  // none -- spell that out rather than showing a lone "All cases".
  if (!cases.length) {
    opts.push('<option value="" disabled>(no cases yet — click Analyze session first)</option>');
  }
  sel.innerHTML = opts.join("");
  // Wrapper picks up the visual cue that scoping is active.
  const wrap = sel.closest(".case-scope");
  if (wrap) wrap.classList.toggle("scoped", !!State.getCaseScope());
}

/* P2.8: scope-to-marker-at-playhead. Finds the innermost case whose
   range contains the current video time and selects it as the scope.
   Falls back to a toast if there's no video / no marker at playhead. */
function scopeToMarkerAtPlayhead() {
  if (!State.getSession()) return;
  const video = document.getElementById("video");
  const startTs = videoStartTs();
  if (!video || !startTs) {
    toast("No video to anchor to playhead.", "error");
    return;
  }
  const playheadMs = new Date(startTs).getTime() + video.currentTime * 1000;
  const cases = deriveCases(State.getSession());
  // Innermost case: smallest range containing playheadMs.
  let best = null;
  let bestSize = Infinity;
  for (const c of cases) {
    if (playheadMs < c.startMs || playheadMs > c.endMs) continue;
    const size = c.endMs - c.startMs;
    if (size < bestSize) { best = c; bestSize = size; }
  }
  if (!best) { toast("No case at the current playhead.", ""); return; }
  State.setCaseScope(best.id);
  populateCaseScope();
  rerenderActiveLevel();
  toast("Scoped to: " + (best.label || best.id), "success");
}

(function wireCaseScope() {
  const sel = document.getElementById("case-scope-select");
  if (!sel) return;
  sel.addEventListener("change", () => {
    State.setCaseScope(sel.value || "");
    const wrap = sel.closest(".case-scope");
    if (wrap) wrap.classList.toggle("scoped", !!State.getCaseScope());
    // Re-render whatever's currently on screen
    rerenderActiveLevel();
  });
  const btn = document.getElementById("btn-scope-to-playhead");
  if (btn) btn.addEventListener("click", scopeToMarkerAtPlayhead);
})();

/* Command palette provider: union of cases / steps / markers /
   commands, scored by case-insensitive substring match. Capped per
   bucket so a single huge session doesn't drown out the commands. */
function commandPaletteProvider(rawQuery) {
  const q = (rawQuery || "").toLowerCase().trim();
  const out = [];

  function pushIfMatch(label, hint, type, run, score) {
    if (q && !label.toLowerCase().includes(q) && !(hint || "").toLowerCase().includes(q)) return;
    out.push({ label, hint, type, run, _score: score });
  }

  // 1) Cases -- prominent navigation primitive
  if (State.getSession()) {
    const cases = deriveCases(State.getSession());
    for (const c of cases) {
      const dur = c.endMs - c.startMs;
      const durStr = dur < 60000 ? `${Math.round(dur / 1000)}s`
                    : dur < 3600000 ? `${Math.round(dur / 60000)}m`
                    : `${(dur / 3600000).toFixed(1)}h`;
      pushIfMatch(c.label, durStr, "case", () => {
        State.setCaseScope(c.id);
        populateCaseScope();
        rerenderActiveLevel();
      }, 5);
    }
  }

  // 2) Steps -- the long-tail surface that needs find-by-name most
  if (State.getSession()) {
    const allSteps = (State.getSession().annotations && State.getSession().annotations.steps) || [];
    let n = 0;
    for (const s of allSteps) {
      if (n >= 80) break;
      const time = s.time_range && s.time_range.start ? s.time_range.start.slice(11, 19) : "";
      if (q && !(s.name || "").toLowerCase().includes(q)) continue;
      out.push({
        type: "step",
        label: s.name || s.step_id,
        hint: `${s.state || ""}${time ? " · " + time : ""}`,
        run: () => {
          State.setSelectedStepId(s.step_id);
          applyLevel("steps");
          // Activate the steps view-mode button so the UI catches up
          const btn = document.querySelector('.view-mode-btn[data-level="steps"]');
          if (btn && !btn.classList.contains("active")) btn.click();
        },
        _score: 3,
      });
      n++;
    }
  }

  // 3) Markers -- case boundaries by label
  if (State.getSession()) {
    const markers = (State.getSession().events || []).filter(e => e.type === "marker" && e.data.marker_type === "start");
    let n = 0;
    for (const m of markers) {
      if (n >= 40) break;
      const lbl = (m.data && m.data.label) || "(unlabeled)";
      if (q && !lbl.toLowerCase().includes(q)) continue;
      const time = m.timestamp ? m.timestamp.slice(11, 19) : "";
      out.push({
        type: "marker",
        label: lbl,
        hint: time,
        run: () => {
          const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
          if (flowBtn) flowBtn.click();
          seekToTimestamp(m.timestamp);
        },
        _score: 2,
      });
      n++;
    }
  }

  // 4) Top-level commands -- always available
  const commands = [
    { label: "Analyze session", hint: "Re-run normalize", run: () => $("#btn-normalize") && $("#btn-normalize").click() },
    { label: "Match Process Template…", hint: "", run: () => $("#btn-match-template") && $("#btn-match-template").click() },
    { label: "Open another session…", hint: "", run: () => $("#btn-open-session") && $("#btn-open-session").click() },
    { label: "Switch to Aggregate", hint: "Tab 2", run: () => activateTab("aggregate") },
    { label: "Switch to Session", hint: "Tab 1", run: () => activateTab("session") },
    { label: "Switch to Process Template", hint: "Tab 3", run: () => activateTab("canonical") },
    { label: "Switch to Vocabularies", hint: "Tab 4", run: () => activateTab("vocabularies") },
    { label: "Clear case scope", hint: "Show all cases", run: () => {
        State.setCaseScope("");
        populateCaseScope();
        rerenderActiveLevel();
      } },
    { label: "Open help", hint: "?", run: () => $("#btn-help") && $("#btn-help").click() },
  ];
  for (const cmd of commands) {
    pushIfMatch(cmd.label, cmd.hint, "command", cmd.run, 1);
  }

  // Sort by score (cases first, then steps/markers, commands last on ties)
  out.sort((a, b) => (b._score || 0) - (a._score || 0));
  return out.slice(0, 50);
}

if (PdtPalette) {
  PdtPalette.setProvider(commandPaletteProvider);
}

function uniqueCaseIds(steps) {
  const seen = new Map();
  for (const s of (steps || [])) {
    if (s.case_id && !seen.has(s.case_id)) seen.set(s.case_id, s.case_id);
  }
  return Array.from(seen.values());
}

function syncCaseDropdown(selectEl, cases, currentValue) {
  if (!selectEl) return;
  const want = ['<option value="">All cases</option>']
    .concat(cases.map(c => `<option value="${c}"${c === currentValue ? " selected" : ""}>${c}</option>`))
    .join("");
  if (selectEl.innerHTML !== want) selectEl.innerHTML = want;
}

function stepMatchesFilter(s, f, scopeCaseId) {
  if (scopeCaseId && s.case_id !== scopeCaseId) return false;
  if (f.text && !(s.name || "").toLowerCase().includes(f.text.toLowerCase())) return false;
  if (f.states && f.states.size > 0) {
    if (!f.states.has(s.state)) return false;
  } else {
    // No explicit state filter: hidden steps stay out of the list by
    // default (they're suppressed noise). The "hidden" chip reveals them.
    if (s.state === "hidden") return false;
  }
  return true;
}

function renderStepsLevel() {
  if (!State.getSession() || !PdtSteps) return;
  const allSteps = decorateDrift((State.getSession().annotations && State.getSession().annotations.steps) || []);
  const f = State.getListFilters().step;
  const filtered = allSteps.filter(s => stepMatchesFilter(s, f, State.getCaseScope()));
  const filteredIds = new Set(filtered.map(s => s.step_id));

  const meta = $("#step-filter-meta");
  if (meta) meta.textContent = filtered.length === allSteps.length
    ? `${allSteps.length} steps`
    : `${filtered.length} of ${allSteps.length}`;
  // Reflect active state chips
  for (const chip of document.querySelectorAll("#step-filter-states .chip")) {
    chip.classList.toggle("active", f.states.has(chip.dataset.state));
  }

  $("#steps-badge").textContent = String(allSteps.length);
  if ($("#steps-pane-count")) $("#steps-pane-count").textContent = String(allSteps.length);
  PdtSteps.renderStepList($("#step-list"), filtered, State.getSelectedStepId(),
    (sid) => { State.setSelectedStepId(sid); renderStepsLevel(); },
    (sid) => {
      if (State.getMultiSelectedStepIds().has(sid)) State.getMultiSelectedStepIds().delete(sid);
      else State.getMultiSelectedStepIds().add(sid);
      const grpBtn = $("#btn-group-into-phase");
      if (grpBtn) grpBtn.disabled = State.getMultiSelectedStepIds().size < 2;
      const delBtn = $("#btn-delete-selected-steps");
      if (delBtn) delBtn.disabled = State.getMultiSelectedStepIds().size < 2;
      // Re-render so the user sees the multi-selected state -- otherwise
      // Ctrl+click feels broken because nothing visibly changes.
      renderStepsLevel();
    },
    inlineRenameStep,
    State.getMultiSelectedStepIds(),
  );
  const selected = allSteps.find(s => s.step_id === State.getSelectedStepId()) || null;
  PdtSteps.renderStepDetail($("#step-detail"), selected, {
    onSave: saveStep,
    onDelete: deleteStep,
    onSplit: splitStep,
    onMerge: mergeStepWithNext,
    onJumpToFlow: jumpToStepInFlow,
    onToggleHide: toggleStepHidden,
  });
  const span = getSpan();
  if (span) {
    // Mini-timeline keeps the full set as context; non-matching blocks
    // are dimmed via the dimmedIds option so the filter still localises.
    const dimmedIds = new Set();
    for (const s of allSteps) if (!filteredIds.has(s.step_id)) dimmedIds.add(s.step_id);
    PdtSteps.renderStepTimeline($("#timeline-steps"), allSteps,
      State.getSession().events.filter(e => e.type === "interaction"), span, {
        zoom: State.getStepZoom(),
        selectedId: State.getSelectedStepId(),
        dimmedIds,
        onSelect: (sid) => { State.setSelectedStepId(sid); renderStepsLevel(); },
      });
    const range = $("#steps-timeline-range");
    if (range) {
      const fmt = (ms) => new Date(ms).toLocaleTimeString();
      range.textContent = `${fmt(span.startMs)} → ${fmt(span.endMs)} · ${formatDuration(span.endMs - span.startMs)}`;
    }
  }
}

/* Wire the step filter inputs once on load. The actual filter state
   sits in State.getListFilters(); renderStepsLevel reads it every re-render. */
(function wireStepFilter() {
  const txt = document.getElementById("step-filter-text");
  if (txt) {
    let t;
    txt.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        State.getListFilters().step.text = txt.value.trim();
        renderStepsLevel();
      }, 120);
    });
  }
  const stateGrp = document.getElementById("step-filter-states");
  if (stateGrp) {
    stateGrp.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const st = chip.dataset.state;
      const set = State.getListFilters().step.states;
      if (set.has(st)) set.delete(st); else set.add(st);
      renderStepsLevel();
    });
  }
})();

function bindMiniTimelineZoom(prefix, getZoom, setZoom, rerender) {
  const buttons = [
    ["zoom-in",    () => setZoom(Math.min(20, getZoom() * 1.5))],
    ["zoom-out",   () => setZoom(Math.max(1, getZoom() / 1.5))],
    ["zoom-reset", () => setZoom(1)],
  ];
  for (const [suffix, fn] of buttons) {
    const btn = document.getElementById(`btn-${prefix}-${suffix}`);
    if (btn) btn.addEventListener("click", () => { fn(); rerender(); });
  }
}
bindMiniTimelineZoom("steps",
  State.getStepZoom, State.setStepZoom,
  () => renderStepsLevel());
bindMiniTimelineZoom("phases",
  State.getPhaseZoom, State.setPhaseZoom,
  () => renderPhasesLevel());

async function inlineRenameStep(stepId, newName, advance) {
  // Special command: "open-next:<id>" means just re-render and trigger
  // the next row's rename without modifying any data.
  if (typeof advance === "string" && advance.startsWith("open-next:")) {
    const nextId = advance.slice("open-next:".length);
    State.setSelectedStepId(nextId);
    renderStepsLevel();
    setTimeout(() => beginRenameOnSelected(), 30);
    return;
  }
  if (!State.getSession() || !stepId || !newName) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = anno.steps.find(s => s.step_id === stepId);
  if (!step) return;
  step.name = newName;
  step.state = step.state === "manually_authored" ? "manually_authored" : "edited";
  await persistAnnotations(anno, 'rename step');
  if (advance === "next") {
    const idx = anno.steps.findIndex(s => s.step_id === stepId);
    const nextStep = anno.steps[idx + 1];
    if (nextStep) {
      State.setSelectedStepId(nextStep.step_id);
      renderStepsLevel();
      setTimeout(() => beginRenameOnSelected(), 30);
    }
  }
}

function beginRenameOnSelected() {
  if (!State.getSelectedStepId()) return;
  const row = document.querySelector(`.step-row[data-step-id="${State.getSelectedStepId()}"] .step-name`);
  if (row) {
    const evt = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    row.dispatchEvent(evt);
  }
}

async function saveStep(updatedStep) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idx = anno.steps.findIndex(s => s.step_id === updatedStep.step_id);
  if (idx >= 0) anno.steps[idx] = updatedStep;
  else anno.steps.push(updatedStep);
  await persistAnnotations(anno, 'save step');
  toast("Step saved", "success");
}

async function deleteStep(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = anno.steps.find(s => s.step_id === stepId);
  const ok = await confirmModal({
    title: "Delete step?",
    message: step ? `Delete step "${step.name || "(unnamed)"}"?` : "Delete this step?",
    detail: "Ctrl+Z will restore it.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  anno.steps = anno.steps.filter(s => s.step_id !== stepId);
  if (State.getSelectedStepId() === stepId) State.setSelectedStepId(null);
  await persistAnnotations(anno, 'delete step');
  toast("Step deleted", "success");
}

/* Toggle a step's "hidden" state. Hidden steps drop out of the list
   (unless the hidden filter chip is on) and survive re-analyze via
   _merge_steps. The pre-hide state is stashed on `_prev_state` so
   unhiding restores it. */
async function toggleStepHidden(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = anno.steps.find(s => s.step_id === stepId);
  if (!step) return;
  if (step.state === "hidden") {
    step.state = step._prev_state || "auto_suggested";
    delete step._prev_state;
    await persistAnnotations(anno, "unhide step");
    toast("Step restored", "success");
  } else {
    step._prev_state = step.state;
    step.state = "hidden";
    if (State.getSelectedStepId() === stepId) State.setSelectedStepId(null);
    await persistAnnotations(anno, "hide step");
    toast("Step hidden — reveal via the hidden filter chip", "success");
  }
}

async function splitStep(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idx = anno.steps.findIndex(s => s.step_id === stepId);
  if (idx < 0) return;
  const s = anno.steps[idx];
  const ids = s.evidence.interaction_event_ids || [];
  if (ids.length < 2) { toast("Need ≥2 interactions to split", "error"); return; }
  const mid = Math.floor(ids.length / 2);
  const firstIds = ids.slice(0, mid);
  const secondIds = ids.slice(mid);
  const interMap = Object.fromEntries(State.getSession().events.filter(e => e.type === "interaction").map(e => [e.event_id, e]));
  const firstEvents = firstIds.map(id => interMap[id]).filter(Boolean);
  const secondEvents = secondIds.map(id => interMap[id]).filter(Boolean);
  if (!firstEvents.length || !secondEvents.length) { toast("Could not split step", "error"); return; }
  const second = { ...s, step_id: cryptoRandomId(),
    name: s.name + " (split 2)",
    time_range: { start: secondEvents[0].timestamp, end: secondEvents[secondEvents.length - 1].timestamp },
    evidence: { ...s.evidence, interaction_event_ids: secondIds },
    state: "edited" };
  const first = { ...s, name: s.name + " (split 1)",
    time_range: { start: firstEvents[0].timestamp, end: firstEvents[firstEvents.length - 1].timestamp },
    evidence: { ...s.evidence, interaction_event_ids: firstIds },
    state: "edited" };
  anno.steps.splice(idx, 1, first, second);
  await persistAnnotations(anno, 'split step');
  toast("Step split", "success");
}

async function mergeStepWithNext(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const sorted = anno.steps.slice().sort((a, b) =>
    (a.time_range && a.time_range.start || "").localeCompare(b.time_range && b.time_range.start || ""));
  const idx = sorted.findIndex(s => s.step_id === stepId);
  if (idx < 0 || idx === sorted.length - 1) { toast("No next step to merge with", "error"); return; }
  const cur = sorted[idx];
  const next = sorted[idx + 1];
  const merged = {
    ...cur,
    name: cur.name + " + " + next.name,
    time_range: { start: cur.time_range.start, end: next.time_range.end },
    evidence: {
      ...cur.evidence,
      interaction_event_ids: [...(cur.evidence.interaction_event_ids || []), ...(next.evidence.interaction_event_ids || [])],
      screenshot_refs: [...(cur.evidence.screenshot_refs || []), ...(next.evidence.screenshot_refs || [])],
    },
    state: "edited",
  };
  anno.steps = anno.steps.filter(s => s.step_id !== cur.step_id && s.step_id !== next.step_id);
  anno.steps.push(merged);
  State.setSelectedStepId(merged.step_id);
  await persistAnnotations(anno, 'merge steps');
  toast("Steps merged", "success");
}

async function addManualStep() {
  if (!State.getSession()) return;
  const name = await promptModal({ title: "Add manual step", message: "Name this step", placeholder: "e.g., Search customer in CRM", okLabel: "Add step" });
  if (!name) return;
  const video = $("#video");
  const tsNow = videoTimeToSessionTs(video.currentTime) || new Date().toISOString();
  // Default duration so manual steps render with a non-zero width
  // in the mini-timeline; the analyst can edit the time range later.
  const endTs = new Date(new Date(tsNow).getTime() + 5000).toISOString();
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = {
    step_id: cryptoRandomId(),
    session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
    case_id: null,
    name,
    description: "",
    time_range: { start: tsNow, end: endTs },
    evidence: { interaction_event_ids: [], screenshot_refs: [], video_timecode_range: null, manual_notes: "" },
    state: "manually_authored",
    canonical_step_id: null,
    flags: { conditional: false, condition_text: null, exception_path: false, waste: false, automation_candidate: false },
    phase_id: null,
  };
  anno.steps.push(step);
  State.setSelectedStepId(step.step_id);
  await persistAnnotations(anno, 'add step');
  toast("Manual step added", "success");
}

if ($("#btn-add-manual-step")) {
  $("#btn-add-manual-step").addEventListener("click", addManualStep);
}

/* ============ Phases view rendering =============================== */

function phaseMatchesFilter(p, steps, f, scopeCaseId) {
  if (f.text && !(p.name || "").toLowerCase().includes(f.text.toLowerCase())) return false;
  if (scopeCaseId) {
    const contained = (p.step_ids || []).map(sid => steps.find(s => s.step_id === sid)).filter(Boolean);
    if (!contained.some(s => s.case_id === scopeCaseId)) return false;
  }
  return true;
}

function renderPhasesLevel() {
  if (!State.getSession() || !window.PdtPhases) return;
  const phases = (State.getSession().annotations && State.getSession().annotations.phases) || [];
  const steps = (State.getSession().annotations && State.getSession().annotations.steps) || [];
  const f = State.getListFilters().phase;
  const filtered = phases.filter(p => phaseMatchesFilter(p, steps, f, State.getCaseScope()));
  const filteredIds = new Set(filtered.map(p => p.phase_id));

  const meta = $("#phase-filter-meta");
  if (meta) meta.textContent = filtered.length === phases.length
    ? `${phases.length} phases`
    : `${filtered.length} of ${phases.length}`;

  $("#phases-badge").textContent = String(phases.length);
  if ($("#phases-pane-count")) $("#phases-pane-count").textContent = String(phases.length);
  window.PdtPhases.renderPhaseList($("#phase-list"), filtered, State.getSelectedPhaseId(),
    (pid) => { State.setSelectedPhaseId(pid); renderPhasesLevel(); });
  const selected = phases.find(p => p.phase_id === State.getSelectedPhaseId()) || null;
  window.PdtPhases.renderPhaseDetail($("#phase-detail"), selected, steps, {
    onSave: savePhase,
    onDelete: deletePhase,
    onRemoveStep: removeStepFromPhase,
    onReorderSteps: reorderStepsInPhase,
  });
  const span = getSpan();
  if (span) {
    const dimmedIds = new Set();
    for (const p of phases) if (!filteredIds.has(p.phase_id)) dimmedIds.add(p.phase_id);
    window.PdtPhases.renderPhaseTimeline($("#timeline-phases"), phases, steps, span, {
      zoom: State.getPhaseZoom(),
      selectedId: State.getSelectedPhaseId(),
      dimmedIds,
      onSelect: (pid) => { State.setSelectedPhaseId(pid); renderPhasesLevel(); },
    });
    const range = $("#phases-timeline-range");
    if (range) {
      const fmt = (ms) => new Date(ms).toLocaleTimeString();
      range.textContent = `${fmt(span.startMs)} → ${fmt(span.endMs)} · ${formatDuration(span.endMs - span.startMs)}`;
    }
  }
}

(function wireMarkerFilter() {
  const txt = document.getElementById("marker-filter-text");
  if (txt) {
    let t;
    txt.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        State.getListFilters().marker.text = txt.value.trim();
        if (State.getSession()) renderMarkersList();
      }, 120);
    });
  }
})();

(function wirePhaseFilter() {
  const txt = document.getElementById("phase-filter-text");
  if (txt) {
    let t;
    txt.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        State.getListFilters().phase.text = txt.value.trim();
        renderPhasesLevel();
      }, 120);
    });
  }
})();

async function savePhase(updatedPhase) {
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idx = anno.phases.findIndex(p => p.phase_id === updatedPhase.phase_id);
  if (idx >= 0) anno.phases[idx] = updatedPhase;
  else anno.phases.push(updatedPhase);
  await persistAnnotations(anno, 'save phase');
  toast("Phase saved", "success");
}

async function deletePhase(phaseId) {
  const anno = ensureAnnoShape(State.getSession().annotations);
  const phase = anno.phases.find(p => p.phase_id === phaseId);
  const ok = await confirmModal({
    title: "Delete phase?",
    message: phase ? `Delete phase "${phase.name || "(unnamed)"}"?` : "Delete this phase?",
    detail: "Member steps stay; only the grouping is removed. Ctrl+Z will restore it.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  anno.phases = anno.phases.filter(p => p.phase_id !== phaseId);
  // Detach phase_id from contained steps
  for (const s of anno.steps) if (s.phase_id === phaseId) s.phase_id = null;
  if (State.getSelectedPhaseId() === phaseId) State.setSelectedPhaseId(null);
  await persistAnnotations(anno, 'delete phase');
  toast("Phase deleted", "success");
}

async function removeStepFromPhase(phaseId, stepId) {
  const anno = ensureAnnoShape(State.getSession().annotations);
  const phase = anno.phases.find(p => p.phase_id === phaseId);
  if (!phase) return;
  phase.step_ids = (phase.step_ids || []).filter(id => id !== stepId);
  phase.state = phase.state === "manually_authored" ? "manually_authored" : "edited";
  const s = anno.steps.find(x => x.step_id === stepId);
  if (s) s.phase_id = null;
  await persistAnnotations(anno, 'remove step from phase');
}

/* P2.6: drag-reorder a step within a phase. drag === source step,
   target === drop-target step, before === insert above (vs below). */
async function reorderStepsInPhase(phaseId, dragStepId, targetStepId, before) {
  if (!State.getSession() || !dragStepId || !targetStepId || dragStepId === targetStepId) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const phase = anno.phases.find(p => p.phase_id === phaseId);
  if (!phase || !Array.isArray(phase.step_ids)) return;
  const ids = phase.step_ids.slice();
  const fromIdx = ids.indexOf(dragStepId);
  if (fromIdx === -1) return;
  ids.splice(fromIdx, 1);
  let toIdx = ids.indexOf(targetStepId);
  if (toIdx === -1) return;
  if (!before) toIdx += 1;
  ids.splice(toIdx, 0, dragStepId);
  phase.step_ids = ids;
  phase.state = phase.state === "manually_authored" ? "manually_authored" : "edited";
  await persistAnnotations(anno, "reorder steps in phase");
}

async function addManualPhase() {
  if (!State.getSession()) return;
  const name = await promptModal({ title: "Add phase", message: "Name this phase", placeholder: "e.g., Validate customer", okLabel: "Add phase" });
  if (!name) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const phase = {
    phase_id: cryptoRandomId(),
    session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
    case_id: null,
    name,
    description: "",
    step_ids: [],
    state: "manually_authored",
    canonical_phase_id: null,
  };
  anno.phases.push(phase);
  State.setSelectedPhaseId(phase.phase_id);
  await persistAnnotations(anno, 'add phase');
  toast("Manual phase added", "success");
}

async function groupIntoPhase() {
  if (!State.getSession()) return;
  const ids = Array.from(State.getMultiSelectedStepIds());
  if (ids.length < 2) return;
  const name = await promptModal({ title: "Add phase", message: "Name this phase", placeholder: "e.g., Validate customer", okLabel: "Add phase" });
  if (!name) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const phase = {
    phase_id: cryptoRandomId(),
    session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
    case_id: null,
    name,
    description: "",
    step_ids: ids,
    state: "manually_authored",
    canonical_phase_id: null,
  };
  anno.phases.push(phase);
  for (const sid of ids) {
    const s = anno.steps.find(x => x.step_id === sid);
    if (s) s.phase_id = phase.phase_id;
  }
  State.getMultiSelectedStepIds().clear();
  State.setSelectedPhaseId(phase.phase_id);
  await persistAnnotations(anno, 'group steps into phase');
  $("#btn-group-into-phase").disabled = true;
  activateAnnoTab("phases");
  toast("Steps grouped into phase", "success");
}

if ($("#btn-add-manual-phase"))   $("#btn-add-manual-phase").addEventListener("click", addManualPhase);
if ($("#btn-group-into-phase"))   $("#btn-group-into-phase").addEventListener("click", groupIntoPhase);

/* Bulk-delete the Ctrl+click multi-selection. One confirm for the
   whole set; Ctrl+Z restores. */
async function deleteSelectedSteps() {
  if (!State.getSession()) return;
  const ids = Array.from(State.getMultiSelectedStepIds());
  if (ids.length < 2) return;
  const ok = await confirmModal({
    title: "Delete " + ids.length + " steps?",
    message: "Delete the " + ids.length + " selected steps?",
    detail: "Ctrl+Z restores them all.",
    okLabel: "Delete " + ids.length,
    danger: true,
  });
  if (!ok) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idSet = new Set(ids);
  anno.steps = anno.steps.filter(s => !idSet.has(s.step_id));
  if (idSet.has(State.getSelectedStepId())) State.setSelectedStepId(null);
  State.getMultiSelectedStepIds().clear();
  await persistAnnotations(anno, "delete " + ids.length + " steps");
  const grpBtn = $("#btn-group-into-phase");
  if (grpBtn) grpBtn.disabled = true;
  const delBtn = $("#btn-delete-selected-steps");
  if (delBtn) delBtn.disabled = true;
  toast(ids.length + " steps deleted", "success");
}
if ($("#btn-delete-selected-steps")) {
  $("#btn-delete-selected-steps").addEventListener("click", deleteSelectedSteps);
}

/* ===== Ignored apps (step-noise denylist) =====
   Apps the analyst checks here are written to annotations.json under
   step_filters.ignored_processes; step_suggest.py drops their
   interactions before step suggestion. Saving re-analyzes the session
   so the step list refreshes immediately. */
function distinctSessionApps() {
  // Distinct process_name across the session's interaction events,
  // with an interaction count so the analyst can spot the noisy ones.
  const counts = new Map();
  for (const ev of (State.getSession() && State.getSession().events) || []) {
    if (ev.type !== "interaction") continue;
    const proc = (ev.data && ev.data.process_name) || "(unknown)";
    counts.set(proc, (counts.get(proc) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([proc, n]) => ({ proc, count: n }))
    .sort((a, b) => b.count - a.count);
}

function openIgnoredAppsDialog() {
  if (!State.getSession()) { toast("Open a session first.", ""); return; }
  const apps = distinctSessionApps();
  if (!apps.length) {
    toast("No interaction data in this session — nothing to filter.", "");
    return;
  }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const current = new Set((anno.step_filters.ignored_processes || []).map(s => String(s).toLowerCase()));

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal" role="dialog" style="max-width:460px">' +
      '<header class="modal-header"><h2>Ignored apps</h2>' +
        '<button class="icon-btn modal-close" id="ia-close" title="Close">✕</button></header>' +
      '<div style="padding:14px 18px">' +
        '<p class="meta" style="margin-top:0">Apps you tick here are left out of step suggestions — useful for OBS, the tracker itself, or anything that isn\'t part of the process you\'re mapping. Saving re-analyzes the session.</p>' +
        '<div id="ia-list" style="max-height:320px;overflow:auto;margin:10px 0"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">' +
          '<button id="ia-cancel">Cancel</button>' +
          '<button id="ia-save" class="primary">Save &amp; re-analyze</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(backdrop);

  const list = backdrop.querySelector("#ia-list");
  list.innerHTML = apps.map((a, i) => {
    const checked = current.has(a.proc.toLowerCase()) ? " checked" : "";
    return '<label class="cb" style="display:flex;gap:8px;padding:5px 4px;align-items:center">' +
      '<input type="checkbox" data-proc="' + escapeHtml(a.proc) + '"' + checked + ' />' +
      '<span style="flex:1">' + escapeHtml(a.proc) + '</span>' +
      '<span class="meta">' + a.count + ' interactions</span>' +
      '</label>';
  }).join("");

  function close() { backdrop.remove(); }
  backdrop.querySelector("#ia-close").addEventListener("click", close);
  backdrop.querySelector("#ia-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector("#ia-save").addEventListener("click", async () => {
    const picked = Array.from(list.querySelectorAll("input[type=checkbox]"))
      .filter(cb => cb.checked)
      .map(cb => cb.dataset.proc);
    anno.step_filters.ignored_processes = picked;
    // Settings change -- write directly (not via the undo stack).
    await ipcRenderer.invoke("viewer:saveAnnotations", {
      sessionFolder: State.getSession().sessionFolder,
      annotations: anno,
    });
    close();
    toast(picked.length
      ? "Ignoring " + picked.length + " app(s) — re-analyzing..."
      : "No apps ignored — re-analyzing...", "success");
    // Re-analyze so the step list reflects the new denylist.
    const normBtn = $("#btn-normalize");
    if (normBtn) normBtn.click();
  });
}
if ($("#btn-ignored-apps")) {
  $("#btn-ignored-apps").addEventListener("click", openIgnoredAppsDialog);
}

/* AM.2: heuristic phase-grouping suggestions. Walks the step list and
   produces candidate groupings using two rules:
     1. Consecutive steps from the same app (apps are stable for a
        contiguous slice of work).
     2. Consecutive steps with no gap > GAP_S seconds (close-in-time
        steps usually belong to the same milestone).
   The analyst sees the list and accepts/rejects individually.
   Steps already assigned to a phase are skipped. */
async function suggestPhaseGroupings() {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const steps = (anno.steps || []).filter((s) => !s.phase_id);
  if (steps.length < 2) {
    toast("Need at least 2 ungrouped steps to suggest groupings.", "");
    return;
  }
  // Sort by start time so consecutive-by-app reasoning is meaningful.
  steps.sort((a, b) => {
    const at = a.time_range && a.time_range.start ? new Date(a.time_range.start).getTime() : 0;
    const bt = b.time_range && b.time_range.start ? new Date(b.time_range.start).getTime() : 0;
    return at - bt;
  });
  const GAP_MS = 30 * 1000;
  const groups = [];
  let cur = [steps[0]];
  // Steps don't carry an `app` field directly -- derive the dominant app
  // for each step by looking at its evidence interactions and picking the
  // most-frequent process_name. Activity events don't appear in the
  // evidence list, so fall back to scanning activity events whose
  // timestamp falls within the step's time_range.
  const eventById = new Map();
  for (const ev of (State.getSession().events || [])) {
    if (ev.event_id) eventById.set(ev.event_id, ev);
  }
  const stepAppCache = new Map();
  function appOf(s) {
    if (stepAppCache.has(s.step_id)) return stepAppCache.get(s.step_id);
    const counts = new Map();
    const evIds = (s.evidence && s.evidence.interaction_event_ids) || [];
    for (const id of evIds) {
      const ev = eventById.get(id);
      const app = ev && ev.data && ev.data.process_name;
      if (app) counts.set(app, (counts.get(app) || 0) + 1);
    }
    if (!counts.size && s.time_range) {
      // Fallback: scan activity events overlapping the step.
      const start = new Date(s.time_range.start).getTime();
      const end = new Date(s.time_range.end).getTime();
      for (const ev of (State.getSession().events || [])) {
        if (ev.type !== "activity") continue;
        const t = new Date(ev.timestamp).getTime();
        if (t < start || t > end) continue;
        const app = ev.data && ev.data.app;
        if (app) counts.set(app, (counts.get(app) || 0) + 1);
      }
    }
    let best = "", bestN = 0;
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
    const v = best.toLowerCase();
    stepAppCache.set(s.step_id, v);
    return v;
  }
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1], s = steps[i];
    const sameApp = appOf(prev) && appOf(prev) === appOf(s);
    const prevEnd = prev.time_range && prev.time_range.end ? new Date(prev.time_range.end).getTime() : 0;
    const curStart = s.time_range && s.time_range.start ? new Date(s.time_range.start).getTime() : 0;
    const closeInTime = prevEnd && curStart && (curStart - prevEnd) <= GAP_MS;
    if (sameApp || closeInTime) cur.push(s);
    else { if (cur.length >= 2) groups.push(cur); cur = [s]; }
  }
  if (cur.length >= 2) groups.push(cur);

  if (!groups.length) {
    toast("No grouping suggestions found — steps are too varied or sparse.", "");
    return;
  }
  // Build a preview detail string for the confirm modal.
  const lines = groups.slice(0, 8).map((g, i) => {
    const apps = [...new Set(g.map(appOf).filter(Boolean))].join(", ") || "mixed apps";
    return `  ${i + 1}. ${g.length} steps (${apps})`;
  });
  const moreNote = groups.length > 8 ? `\n  …and ${groups.length - 8} more` : "";
  const ok = await confirmModal({
    title: "Apply " + groups.length + " phase grouping" + (groups.length === 1 ? "" : "s") + "?",
    message: `Found ${groups.length} candidate phase${groups.length === 1 ? "" : "s"} from ${steps.length} ungrouped steps.`,
    detail: "Each group bundles consecutive steps that either run in the same app or have no idle gap > 30 seconds between them. Phases are named after the dominant app; rename anytime.\n\n" +
            lines.join("\n") + moreNote,
    okLabel: "Apply all",
  });
  if (!ok) return;
  for (const g of groups) {
    const apps = [...new Set(g.map(appOf).filter(Boolean))];
    const name = apps.length === 1
      ? apps[0].replace(/\.exe$/i, "").replace(/^./, (c) => c.toUpperCase()) + " work"
      : "Mixed-app phase";
    const phase = {
      phase_id: cryptoRandomId(),
      session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
      case_id: null,
      name,
      description: "Auto-suggested by phase grouping heuristics.",
      step_ids: g.map((s) => s.step_id),
      state: "auto_suggested",
      canonical_phase_id: null,
    };
    anno.phases.push(phase);
    for (const s of g) {
      const original = anno.steps.find((x) => x.step_id === s.step_id);
      if (original) original.phase_id = phase.phase_id;
    }
  }
  await persistAnnotations(anno, "auto-group steps into phases");
  toast("Applied " + groups.length + " phase grouping" + (groups.length === 1 ? "" : "s"), "success");
}
if ($("#btn-suggest-phases")) $("#btn-suggest-phases").addEventListener("click", suggestPhaseGroupings);

/* ============ AM.1 — Process Template version compare ============= */

async function refreshTemplateVersions() {
  const panel = document.getElementById("template-compare-panel");
  if (!panel) return;
  if (!State.getCanonicalState().path) {
    panel.style.display = "none";
    return;
  }
  const list = await ipcRenderer.invoke("viewer:listTemplateVersions", State.getCanonicalState().path);
  if (!list || !list.length) { panel.style.display = "none"; return; }
  panel.style.display = "";
  const aSel = document.getElementById("tpl-cmp-a");
  const bSel = document.getElementById("tpl-cmp-b");
  const opts = list.map((v) =>
    `<option value="${escapeHtml(v.path)}">${escapeHtml(v.label || v.timestamp)}</option>`
  ).join("");
  aSel.innerHTML = opts;
  bSel.innerHTML = opts;
  // Default: A = newest snapshot before current, B = current.
  if (list.length >= 2) {
    aSel.value = list[1].path;
    bSel.value = list[0].path;
  }
}

async function compareTemplateVersions() {
  const aPath = document.getElementById("tpl-cmp-a").value;
  const bPath = document.getElementById("tpl-cmp-b").value;
  const out = document.getElementById("tpl-cmp-output");
  if (!aPath || !bPath || aPath === bPath) {
    out.innerHTML = '<span style="color:var(--fg-3)">Pick two different versions to compare.</span>';
    return;
  }
  const yaml = require("js-yaml");
  async function read(p) {
    const r = await ipcRenderer.invoke("viewer:readTemplateFile", p);
    if (!r || !r.ok) return null;
    try { return yaml.load(r.content) || {}; }
    catch (_) { return null; }
  }
  const [a, b] = await Promise.all([read(aPath), read(bPath)]);
  if (!a || !b) {
    out.innerHTML = '<span class="delta-down">Couldn\'t parse one of the templates.</span>';
    return;
  }
  const aProc = a.canonical_process || a;
  const bProc = b.canonical_process || b;
  const aSteps = new Map((aProc.steps || []).map((s) => [s.step_id, s]));
  const bSteps = new Map((bProc.steps || []).map((s) => [s.step_id, s]));
  const aPhases = new Map((aProc.phases || []).map((p) => [p.phase_id, p]));
  const bPhases = new Map((bProc.phases || []).map((p) => [p.phase_id, p]));
  const addedSteps = [];
  const removedSteps = [];
  const renamedSteps = [];
  for (const [id, s] of bSteps) {
    if (!aSteps.has(id)) addedSteps.push(s.name || id);
    else if (aSteps.get(id).name !== s.name) {
      renamedSteps.push(`${aSteps.get(id).name || id} → ${s.name}`);
    }
  }
  for (const [id, s] of aSteps) {
    if (!bSteps.has(id)) removedSteps.push(s.name || id);
  }
  const addedPhases = [];
  const removedPhases = [];
  for (const [id, p] of bPhases) if (!aPhases.has(id)) addedPhases.push(p.name || id);
  for (const [id, p] of aPhases) if (!bPhases.has(id)) removedPhases.push(p.name || id);
  const aVer = aProc.version != null ? "v" + aProc.version : "(no version)";
  const bVer = bProc.version != null ? "v" + bProc.version : "(no version)";
  function row(label, items, cls) {
    if (!items.length) return "";
    return '<div><strong>' + escapeHtml(label) + ' (' + items.length + '):</strong> ' +
           '<span class="' + cls + '">' + escapeHtml(items.join(", ")) + '</span></div>';
  }
  const nochange = !addedSteps.length && !removedSteps.length && !renamedSteps.length &&
                   !addedPhases.length && !removedPhases.length;
  out.innerHTML =
    '<div><strong>Comparing</strong> ' + escapeHtml(aVer) + ' → ' + escapeHtml(bVer) + '</div>' +
    (nochange
      ? '<div style="color:var(--fg-3);margin-top:4px">No structural differences.</div>'
      : row("Steps added", addedSteps, "delta-up") +
        row("Steps removed", removedSteps, "delta-down") +
        row("Steps renamed", renamedSteps, "") +
        row("Phases added", addedPhases, "delta-up") +
        row("Phases removed", removedPhases, "delta-down"));
}

(function wireTemplateCompare() {
  const aSel = document.getElementById("tpl-cmp-a");
  const bSel = document.getElementById("tpl-cmp-b");
  const refresh = document.getElementById("tpl-cmp-refresh");
  if (aSel) aSel.addEventListener("change", compareTemplateVersions);
  if (bSel) bSel.addEventListener("change", compareTemplateVersions);
  if (refresh) refresh.addEventListener("click", refreshTemplateVersions);
})();

/* ============ Annotation shape helper ============================ */

function ensureAnnoShape(anno) {
  const a = anno || {};
  a.version = 1;
  a.steps = a.steps || [];
  a.phases = a.phases || [];
  a.annotations = a.annotations || [];
  a.notes = a.notes || [];
  a.marker_edits = a.marker_edits || [];
  a.drift_markers = a.drift_markers || [];
  a.step_filters = a.step_filters || { ignored_processes: [], ignored_window_titles: [] };
  if (!Array.isArray(a.step_filters.ignored_processes)) a.step_filters.ignored_processes = [];
  if (State.getSession()) a.session_id = (State.getSession().manifest && State.getSession().manifest.session_id) || a.session_id || "";
  State.getSession().annotations = a;
  return a;
}

/* ============ Save App Vocabulary from this session ================ */

async function buildVocabFromSession(suggestedName) {
  if (!State.getSession()) return;
  const vocabName = suggestedName || await promptModal({
    title: "Save to App Library",
    message: "App vocabulary name",
    detail: "e.g., \"Salesforce\". Used as the file name under normalization/app_vocabularies/.",
    placeholder: "Salesforce",
    okLabel: "Save",
  });
  if (!vocabName) return;
  const vocabId = vocabName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const r = await ipcRenderer.invoke("viewer:bootstrapAppVocab", {
    sessionFolder: State.getSession().sessionFolder,
    vocabId, vocabName,
  });
  if (!r || !r.ok) {
    toast("App Library entry build failed: " + ((r && r.error) || "unknown"), "error");
    return;
  }
  const out = await ipcRenderer.invoke("viewer:saveAppVocab", {
    defaultName: vocabId + ".yaml",
    content: r.yaml,
    /* Default to the shipped vocab dir so the analyst doesn't have to
       hunt for it. Falls back to the user's Documents folder if the
       shipped dir isn't writable (e.g., installed under Program Files). */
    preferAppVocabDir: true,
  });
  if (out) {
    await ipcRenderer.invoke("viewer:revealFile", out);
    toast("App Library starter saved — name each interaction in plain English, then re-analyze any session to apply.", "success");
  }
}

const btnSaveVocab = $("#btn-save-vocab");
if (btnSaveVocab) {
  btnSaveVocab.addEventListener("click", async () => {
    btnSaveVocab.disabled = true;
    await buildVocabFromSession();
    btnSaveVocab.disabled = false;
  });
}

const btnPrepBootstrap = $("#btn-prep-bootstrap");
if (btnPrepBootstrap) {
  btnPrepBootstrap.addEventListener("click", async () => {
    if (!State.getSession()) return;
    const m = State.getSession().manifest || {};
    const friendly = (m.prep_app || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    btnPrepBootstrap.disabled = true;
    await buildVocabFromSession(friendly || null);
    btnPrepBootstrap.disabled = false;
  });
}

/* ============ Aggregate level switcher ============================ */

$$("#agg-level-switcher .agg-level-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$("#agg-level-switcher .agg-level-btn").forEach((b) => b.classList.toggle("active", b === btn));
    State.setAggregateLevel(btn.dataset.level);
    renderAggregate();
  });
});

/* ============ Canonical view IPC ================================== */


if ($("#btn-open-canonical")) {
  $("#btn-open-canonical").addEventListener("click", async () => {
    const r = await ipcRenderer.invoke("viewer:openCanonicalFile");
    if (!r) return;
    State.getCanonicalState().path = r.path;
    State.getCanonicalState().content = r.content;
    $("#canonical-yaml").value = r.content;
    $("#canonical-meta").textContent = "Loaded " + r.path;
    $("#btn-save-canonical").disabled = false;
    renderCanonicalStepList();
  });
}
if ($("#btn-save-canonical")) {
  $("#btn-save-canonical").addEventListener("click", async () => {
    if (!State.getCanonicalState().path) return;
    const content = $("#canonical-yaml").value;
    await ipcRenderer.invoke("viewer:saveCanonicalFile", { path: State.getCanonicalState().path, content });
    State.getCanonicalState().content = content;
    toast("Process Template saved", "success");
    renderCanonicalStepList();
    // AM.1: refresh the version compare list on the next aggregate
    // render so the new snapshot shows up.
    refreshTemplateVersions().catch(() => {});
  });
}
if ($("#btn-load-exemplar")) {
  $("#btn-load-exemplar").addEventListener("click", async () => {
    const folder = await ipcRenderer.invoke("viewer:openSessionFolder");
    if (!folder) return;
    State.getCanonicalState().exemplarFolder = folder;
    if (State.getCanonicalState().path) {
      const r = await ipcRenderer.invoke("viewer:testCanonicalMatch", {
        canonicalPath: State.getCanonicalState().path, sessionFolder: folder,
      });
      if (r && r.ok) {
        $("#exemplar-match-rate").textContent =
          "Match rate: " + Math.round((r.match_rate || 0) * 100) + "% (" + r.matched + "/" + r.total + ")";
      }
    }
    $("#btn-promote-from-exemplar").disabled = false;
  });
}

/* Render the Process Template steps as an editable form rather than
   just a derived count. Edits to name + description round-trip through
   js-yaml so the underlying match rules and other fields the analyst
   doesn't see stay intact. */
function renderCanonicalStepList() {
  const host = $("#canonical-step-list");
  if (!host) return;
  if (!State.getCanonicalState().path) {
    host.innerHTML = `
      <div class="empty-pane">
        <p>No template loaded. Click <strong>Open Process Template...</strong> above.</p>
        <p class="meta">A sample template ships with the tool at <code>normalization/canonical/sample-customer-onboarding-v3.yaml</code> - open it to see how one looks.</p>
      </div>`;
    return;
  }
  const yaml = require("js-yaml");
  let parsed = null;
  try { parsed = yaml.load(State.getCanonicalState().content || "") || {}; }
  catch (e) {
    host.innerHTML = '<p class="hint" style="color:var(--bad)">Couldn\'t parse the template: ' +
      escapeHtml(e.message) + '</p>';
    return;
  }
  const proc = parsed.canonical_process || (parsed.canonical_process = {});
  if (!Array.isArray(proc.steps)) proc.steps = [];
  State.getCanonicalState().parsed = parsed;

  const meta = '<div class="canonical-meta-form">' +
    '<label>Template name <input type="text" id="ctpl-name" value="' + escapeHtml(proc.name || "") + '" /></label>' +
    '<label>Version <input type="number" min="1" id="ctpl-version" value="' + (proc.version || 1) + '" /></label>' +
    '</div>';
  const rows = proc.steps.map((s, i) =>
    '<div class="ctpl-step" data-idx="' + i + '">' +
      '<div class="ctpl-step-head">' +
        '<input type="text" class="ctpl-step-name" value="' + escapeHtml(s.name || "") + '" placeholder="Step name (e.g. Search customer)" />' +
        '<button type="button" class="ctpl-step-up"   title="Move up">↑</button>' +
        '<button type="button" class="ctpl-step-down" title="Move down">↓</button>' +
        '<button type="button" class="ctpl-step-del danger" title="Delete">×</button>' +
      '</div>' +
      '<textarea class="ctpl-step-desc" placeholder="Optional plain-English description of what the step does">' +
        escapeHtml(s.description || "") + '</textarea>' +
      (Array.isArray(s.match) && s.match.length
        ? '<div class="ctpl-step-rules">' + s.match.length + ' match rule(s) — edit via Advanced</div>'
        : '<div class="ctpl-step-rules" style="color:var(--bad)">No match rules — won\'t auto-match. Add via Advanced.</div>') +
    '</div>'
  ).join("");
  host.innerHTML = meta + rows +
    '<div class="ctpl-actions"><button type="button" id="ctpl-add-step" class="link-btn">+ Add step</button></div>';

  function commit() {
    proc.name = document.getElementById("ctpl-name").value.trim();
    const v = parseInt(document.getElementById("ctpl-version").value, 10);
    if (Number.isFinite(v) && v >= 1) proc.version = v;
    host.querySelectorAll(".ctpl-step").forEach((row) => {
      const idx = parseInt(row.dataset.idx, 10);
      if (!proc.steps[idx]) return;
      proc.steps[idx].name = row.querySelector(".ctpl-step-name").value.trim();
      proc.steps[idx].description = row.querySelector(".ctpl-step-desc").value.trim();
    });
    State.getCanonicalState().content = yaml.dump(parsed, { lineWidth: 120, noRefs: true, sortKeys: false });
    const ta = document.getElementById("canonical-yaml");
    if (ta) ta.value = State.getCanonicalState().content;
    const saveBtn = document.getElementById("btn-save-canonical");
    if (saveBtn && saveBtn.dataset) saveBtn.dataset.dirty = "1";
  }

  host.querySelectorAll(".ctpl-step-name, .ctpl-step-desc").forEach((el) => {
    el.addEventListener("input", commit);
  });
  document.getElementById("ctpl-name").addEventListener("input", commit);
  document.getElementById("ctpl-version").addEventListener("input", commit);
  // Direct edits in the Advanced YAML textarea must update
  // State.getCanonicalState().content AND re-render the form so the two views
  // stay in sync. Re-parse on input; bail silently on parse error
  // (the analyst is mid-typing and the YAML is temporarily broken).
  const ta = document.getElementById("canonical-yaml");
  if (ta && !ta._pdtSyncWired) {
    ta._pdtSyncWired = true;
    let _taSyncTimer = null;
    ta.addEventListener("input", () => {
      State.getCanonicalState().content = ta.value;
      clearTimeout(_taSyncTimer);
      _taSyncTimer = setTimeout(() => {
        try {
          const reparsed = yaml.load(ta.value);
          if (reparsed) renderCanonicalStepList();
        } catch (_) { /* leave form stale until valid */ }
      }, 350);
    });
  }
  host.querySelectorAll(".ctpl-step-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.closest(".ctpl-step").dataset.idx, 10);
      const ok = await confirmModal({
        title: "Delete step?",
        message: "Remove step \"" + (proc.steps[idx].name || "(unnamed)") + "\" from the template?",
        detail: "Match rules attached to this step will also be removed.",
        okLabel: "Delete", danger: true,
      });
      if (!ok) return;
      const removedId = proc.steps[idx].step_id;
      proc.steps.splice(idx, 1);
      // Clean up dangling references in any phase's step_ids so we
      // don't leave a phase pointing at a missing step. If a phase
      // ends up empty, leave it (the analyst can delete it) rather
      // than auto-removing -- removal is a separate decision.
      if (Array.isArray(proc.phases)) {
        for (const ph of proc.phases) {
          if (Array.isArray(ph.step_ids)) {
            ph.step_ids = ph.step_ids.filter((id) => id !== removedId);
          }
        }
      }
      commit();
      renderCanonicalStepList();
    });
  });
  function moveStep(idx, delta) {
    const j = idx + delta;
    if (j < 0 || j >= proc.steps.length) return;
    const tmp = proc.steps[idx];
    proc.steps[idx] = proc.steps[j];
    proc.steps[j] = tmp;
    commit();
    renderCanonicalStepList();
  }
  host.querySelectorAll(".ctpl-step-up").forEach((btn) =>
    btn.addEventListener("click", () => moveStep(parseInt(btn.closest(".ctpl-step").dataset.idx, 10), -1)));
  host.querySelectorAll(".ctpl-step-down").forEach((btn) =>
    btn.addEventListener("click", () => moveStep(parseInt(btn.closest(".ctpl-step").dataset.idx, 10), 1)));
  document.getElementById("ctpl-add-step").addEventListener("click", () => {
    proc.steps.push({
      step_id: cryptoRandomId(),
      name: "New step",
      description: "",
      match: [],
    });
    commit();
    renderCanonicalStepList();
  });
}

// Render the empty state immediately so the Template tab isn't blank.
if (typeof window !== "undefined") {
  setTimeout(() => renderCanonicalStepList(), 0);
}

/* ============ Step / phase / PDD exports ========================= */

async function exportArtifact(kind) {
  if (!State.getSession() && !State.getAggregateSessions().length) return;
  const filtered = State.getAggregateSessions().length ? filteredAggregateSessions() : [State.getSession()];
  if (!filtered.length) return;
  const target = filtered[0];
  // Run normalize with the corresponding --*-out flag against a temp path
  const os = require("os");
  let ext = "bpmn";
  if (kind === "pdd") ext = "docx";
  else if (kind === "step-csv") ext = "csv";
  const tmpPath = path.join(os.tmpdir(), "pdt-export-" + Date.now() + "." + ext);
  const opts = { sessionFolder: target.sessionFolder, mine: false };
  if (kind === "step-bpmn")  opts.stepBpmnOut  = tmpPath;
  if (kind === "phase-bpmn") opts.phaseBpmnOut = tmpPath;
  if (kind === "pdd")        opts.pddOut       = tmpPath;
  if (kind === "step-csv")   opts.stepCsvOut   = tmpPath;
  const r = await ipcRenderer.invoke("viewer:runNormalizeExtended", opts);
  if (!r || !r.ok) { toast("Export failed: " + ((r && r.error) || "unknown"), "error"); return; }
  const suggested = "process." + kind + "." + ext;
  const out = await ipcRenderer.invoke("viewer:exportFile", { sourcePath: tmpPath, suggestedName: suggested });
  if (out) {
    await ipcRenderer.invoke("viewer:revealFile", out);
    toast("Exported: " + path.basename(out), "success");
  }
  try { fs.unlinkSync(tmpPath); } catch (_) {}
}

if ($("#btn-export-bpmn-step"))  $("#btn-export-bpmn-step").addEventListener("click", () => exportArtifact("step-bpmn"));
if ($("#btn-export-bpmn-phase")) $("#btn-export-bpmn-phase").addEventListener("click", () => exportArtifact("phase-bpmn"));
if ($("#btn-export-pdd"))        $("#btn-export-pdd").addEventListener("click", () => exportArtifact("pdd"));
if ($("#btn-export-step-csv"))   $("#btn-export-step-csv").addEventListener("click", () => exportArtifact("step-csv"));


/* ============ Re-normalize to canonical =========================== */

if ($("#btn-renormalize-canonical")) {
  $("#btn-renormalize-canonical").addEventListener("click", async () => {
    const r = await ipcRenderer.invoke("viewer:openCanonicalFile");
    if (!r) return;
    if (!State.getAggregateSessions().length) { toast("Load sessions first", "error"); return; }
    let driftCount = 0;
    for (const s of State.getAggregateSessions()) {
      const result = await ipcRenderer.invoke("viewer:runNormalizeExtended", {
        sessionFolder: s.sessionFolder, mine: true, canonical: r.path,
      });
      if (result && result.ok && result.drift_count) driftCount += result.drift_count;
    }
    const folders = State.getAggregateSessions().map((s) => s.sessionFolder);
    State.setAggregateSessions(await ipcRenderer.invoke("viewer:loadMultipleSessions", folders));
    State.setAggregateSessions(State.getAggregateSessions().filter((s) => !s.error));
    renderAggregate();
    toast(`Re-normalized; ${driftCount} drift marker(s)`, driftCount ? "warn" : "success");
  });
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

function setMapZoomVisible(visible) {
  const wrap = document.getElementById("map-zoom");
  if (wrap) wrap.style.display = visible ? "" : "none";
}
function setMapZoomPct(z) {
  const el = document.getElementById("map-zoom-pct");
  if (el) el.textContent = Math.round((z || 1) * 100) + "%";
}

$$(".panel-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".panel-tab").forEach((t) => t.classList.toggle("active", t === tab));
    const which = tab.dataset.map;
    $("#bpmn-host").style.display = which === "bpmn" ? "" : "none";
    $("#dfg-host").style.display = which === "dfg" ? "" : "none";
    setMapZoomVisible(which === "dfg");
    setTimeout(() => {
      if (which === "bpmn" && PdtBpmn) PdtBpmn.fit();
      if (which === "dfg" && PdtDfg) {
        PdtDfg.fit();
        setMapZoomPct(PdtDfg.getZoom());
      }
    }, 50);
  });
});

const btnDfgZoomIn = document.getElementById("btn-dfg-zoom-in");
const btnDfgZoomOut = document.getElementById("btn-dfg-zoom-out");
const btnDfgZoomFit = document.getElementById("btn-dfg-zoom-fit");
if (btnDfgZoomIn) btnDfgZoomIn.addEventListener("click", () => {
  if (PdtDfg) { PdtDfg.zoomIn(); setMapZoomPct(PdtDfg.getZoom()); }
});
if (btnDfgZoomOut) btnDfgZoomOut.addEventListener("click", () => {
  if (PdtDfg) { PdtDfg.zoomOut(); setMapZoomPct(PdtDfg.getZoom()); }
});
if (btnDfgZoomFit) btnDfgZoomFit.addEventListener("click", () => {
  if (PdtDfg) { PdtDfg.fit(); setMapZoomPct(PdtDfg.getZoom()); }
});

/* ============ Session view: open + normalize ====================== */

async function openSessionFlow() {
  const folder = await ipcRenderer.invoke("viewer:openSessionFolder");
  if (!folder) return;
  await loadSessionIntoView(folder);
}

$("#btn-open-session-hero").addEventListener("click", openSessionFlow);
$("#btn-open-session").addEventListener("click", openSessionFlow);

/* Wire normalize button so the analysis-in-progress UI is visible:
   log host expands (already open by default in the HTML), Cancel
   button shows while running. Cancellation flows through
   viewer:cancelNormalize which kills the python child. */
function setAnalysisRunning(running) {
  $("#btn-normalize").disabled = running;
  const cancelBtn = $("#btn-cancel-normalize");
  if (cancelBtn) cancelBtn.style.display = running ? "" : "none";
  const logHost = $("#log-host");
  if (logHost) {
    if (running) {
      logHost.style.display = "";
      logHost.open = true;
    }
  }
}

const btnCancelNormalize = $("#btn-cancel-normalize");
if (btnCancelNormalize) {
  btnCancelNormalize.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await ipcRenderer.invoke("viewer:cancelNormalize");
    toast("Cancelling analysis...");
  });
}

$("#btn-normalize").addEventListener("click", async () => {
  if (!State.getSession()) return;
  const mine = $("#cb-mine").checked;
  setAnalysisRunning(true);
  $("#normalize-log").textContent = "";
  // If a Process Template was previously matched, re-use its path automatically.
  const remembered = (State.getSession().annotations &&
    State.getSession().annotations.matched_against &&
    State.getSession().annotations.matched_against.template_path) || null;
  const r = await ipcRenderer.invoke("viewer:runNormalizeExtended", {
    sessionFolder: State.getSession().sessionFolder,
    mine,
    canonical: remembered,
  });
  setAnalysisRunning(false);
  if (r.cancelled) {
    $("#normalize-log").textContent += "\n[cancelled by user]";
    toast("Analysis cancelled");
    return;
  }
  if (!r.ok) {
    $("#normalize-log").textContent += "\nERROR: " + r.error;
    toast("Analysis failed: " + r.error, "error");
    return;
  }
  toast(remembered ? "Re-analyzed with template" : "Analysis complete", "success");
  await loadSessionIntoView(State.getSession().sessionFolder);
});

const btnMatchTemplate = $("#btn-match-template");
if (btnMatchTemplate) {
  btnMatchTemplate.addEventListener("click", async () => {
    if (!State.getSession()) return;
    const r = await ipcRenderer.invoke("viewer:openCanonicalFile");
    if (!r) return;
    btnMatchTemplate.disabled = true;
    $("#btn-normalize").disabled = true;
    $("#log-host").style.display = "";
    $("#normalize-log").textContent = "";
    const mine = $("#cb-mine").checked;
    const result = await ipcRenderer.invoke("viewer:runNormalizeExtended", {
      sessionFolder: State.getSession().sessionFolder,
      mine,
      canonical: r.path,
    });
    btnMatchTemplate.disabled = false;
    $("#btn-normalize").disabled = false;
    if (!result || !result.ok) {
      toast("Template match failed: " + ((result && result.error) || "unknown"), "error");
      return;
    }
    // Persist template path into annotations.json so future re-analyses remember it.
    try {
      const a = State.getSession().annotations || {};
      a.matched_against = a.matched_against || {};
      a.matched_against.template_path = r.path;
      await ipcRenderer.invoke("viewer:saveAnnotations", {
        sessionFolder: State.getSession().sessionFolder,
        annotations: a,
      });
    } catch (_) {}
    toast("Matched against Process Template", "success");
    await loadSessionIntoView(State.getSession().sessionFolder);
  });
}

ipcRenderer.on("viewer:normalizeLog", (_e, text) => {
  const pre = $("#normalize-log");
  pre.textContent += text;
  pre.scrollTop = pre.scrollHeight;
});

async function loadSessionIntoView(folder) {
  const prevFolder = State.getSession() ? State.getSession().sessionFolder : null;
  try {
    State.setSession(await ipcRenderer.invoke("viewer:loadSession", folder));
  } catch (e) {
    toast("Failed to load: " + (e.message || e), "error");
    return;
  }
  // Reset undo when switching to a different session. Undo/redo
  // stack entries are pinned to a sessionFolder so they'd be unusable
  // anyway, but cleaning here avoids unbounded memory growth across
  // many session switches.
  if (prevFolder !== folder) resetUndoStack();
  $("#session-empty").style.display = "none";
  $("#session-loaded").style.display = "";
  $("#btn-normalize").disabled = false;
  const label =
    (State.getSession().manifest && State.getSession().manifest.engagement_id) ||
    path.basename(folder);
  pushRecent(folder, label + " · " + path.basename(folder));

  renderSessionPills();
  // Wire video. Toggle the no-video card explicitly since the
  // sibling-selector CSS only fires when [src] is present.
  const video = $("#video");
  const noVid = $("#no-video");
  const overlay = $("#video-overlay");
  if (State.getSession().recordingAvailable && State.getSession().recordingPath) {
    video.src = "file:///" + State.getSession().recordingPath.replace(/\\/g, "/");
    video.style.display = "";
    noVid.style.display = "none";
    overlay.style.display = "";
  } else {
    video.removeAttribute("src");
    video.load();
    video.style.display = "none";
    noVid.style.display = "";
    overlay.style.display = "none";
  }
  video.addEventListener("timeupdate", positionPlayhead);
  video.addEventListener("loadedmetadata", () =>
    setVideoOverlay(`${formatDuration(video.duration * 1000)} loaded`));
  setVideoOverlay(State.getSession().recordingAvailable ? "loading…" : "no video");

  renderTimeline();
  renderEventTable();
  renderAnnotations();
  renderScreenshots();
  renderMarkersList();
  renderTimelineSummary();
  // Phase B+ surfaces
  State.setSelectedStepId(null);
  State.setSelectedPhaseId(null);
  State.setMultiSelectedStepIds(new Set());
  if ($("#btn-group-into-phase")) $("#btn-group-into-phase").disabled = true;
  renderStepsLevel();
  renderPhasesLevel();
  updateProcessMapStatus();
  // Refresh case-scope dropdown -- clear scope if the new session no
  // longer contains the previously-selected case.
  populateCaseScope();
  const cases = deriveCases(State.getSession()).map(c => c.id);
  if (State.getCaseScope() && !cases.includes(State.getCaseScope())) {
    State.setCaseScope("");
    populateCaseScope();
  }
  // P1.10: restore persisted timeline zoom + scroll for this session.
  _wireTimelineScrollPersist();
  restoreTimelineForCurrent();
  // P1.1: clear any range selection from the previous session.
  if (prevFolder !== folder) clearSelectionRange();
  installRangeSelection();
  // P2.4: shortcuts overlay updates with session state.
  renderShortcutsOverlay();
}

/* Count BPMN flow nodes (task/event/gateway). Ignore namespace prefix. */
function countBpmnNodes(xml) {
  const nodeRe = /<(?:[\w-]+:)?(task|userTask|serviceTask|manualTask|scriptTask|sendTask|receiveTask|businessRuleTask|callActivity|subProcess|startEvent|endEvent|intermediateThrowEvent|intermediateCatchEvent|exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|complexGateway)\b/g;
  return (xml.match(nodeRe) || []).length;
}

/* Surface the per-session BPMN output produced by `normalize.py --mine`.
   Reads process_map.bpmn from the loaded session folder, counts flow
   nodes, and exposes Open / Reveal affordances in the actions bar.
   Also detects per-case BPMNs under process_maps/ and exposes them
   via a dropdown so multi-case sessions are first-class. */
function updateProcessMapStatus() {
  const wrap = document.getElementById("process-map-status");
  if (!wrap) return;
  if (!State.getSession() || !State.getSession().sessionFolder) {
    wrap.style.display = "none";
    return;
  }
  const bpmnPath = path.join(State.getSession().sessionFolder, "process_map.bpmn");
  let xml = "";
  try {
    if (!fs.existsSync(bpmnPath)) {
      wrap.style.display = "none";
      return;
    }
    xml = fs.readFileSync(bpmnPath, "utf8");
  } catch (_) {
    wrap.style.display = "none";
    return;
  }
  const nodeCount = countBpmnNodes(xml);
  const detail = document.getElementById("process-map-detail");
  if (detail) detail.textContent = nodeCount + (nodeCount === 1 ? " node" : " nodes");
  wrap.style.display = "";
  wrap.dataset.bpmnPath = bpmnPath;

  // Per-case BPMNs (if normalize.py --mine wrote any)
  const perCaseDir = path.join(State.getSession().sessionFolder, "process_maps");
  const sel = document.getElementById("process-map-case-select");
  if (!sel) return;
  let perCaseFiles = [];
  try {
    if (fs.existsSync(perCaseDir)) {
      perCaseFiles = fs.readdirSync(perCaseDir)
        .filter(f => f.toLowerCase().endsWith(".bpmn"))
        .sort();
    }
  } catch (_) {}
  if (!perCaseFiles.length) {
    sel.style.display = "none";
    return;
  }
  sel.style.display = "";
  const opts = ['<option value="">Aggregate (all cases)</option>']
    .concat(perCaseFiles.map(f => `<option value="${f}">${f.replace(/\.bpmn$/i, "")}</option>`));
  sel.innerHTML = opts.join("");
  sel.onchange = () => {
    const v = sel.value;
    wrap.dataset.bpmnPath = v
      ? path.join(perCaseDir, v)
      : bpmnPath;
    try {
      const x = fs.readFileSync(wrap.dataset.bpmnPath, "utf8");
      const n = countBpmnNodes(x);
      if (detail) detail.textContent = n + (n === 1 ? " node" : " nodes");
    } catch (_) {}
  };
}

(function wireProcessMapButtons() {
  const open = document.getElementById("btn-open-bpmn");
  const reveal = document.getElementById("btn-reveal-bpmn");
  function currentBpmnPath() {
    const wrap = document.getElementById("process-map-status");
    return wrap && wrap.dataset.bpmnPath;
  }
  if (open) open.addEventListener("click", async () => {
    const p = currentBpmnPath();
    if (!p) return;
    const err = await ipcRenderer.invoke("viewer:openExternal", p);
    if (err) toast("Could not open: " + err, "error");
  });
  if (reveal) reveal.addEventListener("click", () => {
    const p = currentBpmnPath();
    if (p) ipcRenderer.invoke("viewer:revealFile", p);
  });
})();

function renderSessionPills() {
  const m = State.getSession().manifest || {};
  const pills = [];
  pills.push({ label: "events", val: State.getSession().events.length, cls: "ok" });
  pills.push({ label: "status", val: m.status || "?",
    cls: m.status === "recovered" ? "warn" : (m.status === "closed" ? "ok" : "") });
  if (m.obs && m.obs.recording_path) pills.push({ label: "video", val: "OBS linked", cls: "ok" });
  else pills.push({ label: "video", val: "no recording" });
  if (State.getSession().stats) {
    pills.push({ label: "analyzed", val: "✓", cls: "ok" });
    const meta = State.getSession().stats.meta || {};
    if (meta.taxonomy_version) {
      pills.push({ label: "taxonomy", val: meta.taxonomy_version });
    }
    if (meta.canonical_process_id) {
      pills.push({ label: "template", val: meta.canonical_process_id, cls: "ok" });
    }
    const vocabs = meta.app_vocabularies || [];
    if (vocabs.length) {
      const hits = meta.app_vocabulary_matches || 0;
      pills.push({
        label: vocabs.length === 1 ? "vocab" : "vocabs",
        val: `${vocabs.map(v => v.id).join(", ")} · ${hits} hits`,
        cls: hits > 0 ? "ok" : "",
      });
    }
  } else {
    pills.push({ label: "analyzed", val: "no", cls: "warn" });
  }
  const editCount = ((State.getSession().annotations || {}).marker_edits || []).length;
  if (editCount > 0) pills.push({ label: "edits", val: editCount, cls: "warn" });
  $("#session-pills").innerHTML = pills.map((p) =>
    '<div class="pill' + (p.cls ? " " + p.cls : "") + '"><span class="dot"></span>' +
    '<span class="lbl">' + escapeHtml(p.label) + '</span>' + escapeHtml(String(p.val)) + '</div>'
  ).join("");

  // Show onboarding card until the session is analyzed.
  const onboarding = $("#onboarding-card");
  if (onboarding) {
    onboarding.style.display = State.getSession().stats ? "none" : "";
  }

  /* Prep-session CTA: when the manifest tags this as an app-vocab prep
     capture, replace the generic onboarding with a one-button path to
     bootstrap the vocabulary. The button below the toolbar is dedicated
     to this so the analyst doesn't have to hunt for it. */
  const prepCta = $("#prep-session-cta");
  const isPrep = m.purpose === "app_prep" && m.prep_app;
  if (prepCta) {
    if (isPrep) {
      prepCta.style.display = "";
      const appName = m.prep_app
        .replace(/-/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
      $("#prep-app-name").textContent = appName;
      $("#prep-app-id").textContent = m.prep_app;
      if (onboarding) onboarding.style.display = "none"; // CTA replaces generic onboarding
    } else {
      prepCta.style.display = "none";
    }
  }

  // Update the Match button label to reflect a remembered template.
  const btnMatch = $("#btn-match-template");
  if (btnMatch) {
    const tmpl = (State.getSession().annotations &&
      State.getSession().annotations.matched_against &&
      State.getSession().annotations.matched_against.template_path);
    if (tmpl) {
      btnMatch.textContent = "Change Process Template...";
      btnMatch.title = "Currently matched against: " + tmpl;
    } else {
      btnMatch.textContent = "Match Process Template...";
      btnMatch.title = "Pick a Process Template YAML and match this session against it.";
    }
  }
}

function setVideoOverlay(text) {
  let o = $("#video-overlay");
  o.textContent = text;
}

/* ============ Timeline ============================================ */

/* Muted per-app color palette. Known apps get fixed assignments so the
   same color is stable across sessions; unknown apps get a deterministic
   slot via a small hash so they stay stable too. All tones desaturated
   to keep the timeline instrument-like (no decorative color). */
const APP_COLOR_MAP = {
  "chrome.exe":   "#5C7080",
  "msedge.exe":   "#5C7080",
  "firefox.exe":  "#5C7080",
  "SAPGUI.exe":   "#807060",
  "saplogon.exe": "#807060",
  "EXCEL.EXE":    "#607868",
  "OUTLOOK.EXE":  "#705C78",
  "winword.exe":  "#6A6878",
  "powerpnt.exe": "#8C6A5C",
  "Teams.exe":    "#5C6A88",
};
const APP_PALETTE = [
  "#5C7080", "#807060", "#607868", "#705C78",
  "#685E58", "#5E6878", "#586E70", "#787058",
];
function _hashAppIdx(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % APP_PALETTE.length;
}
function appColor(app) {
  if (!app) return "#505050";
  if (APP_COLOR_MAP[app]) return APP_COLOR_MAP[app];
  return APP_PALETTE[_hashAppIdx(app.toLowerCase())];
}

/* Friendly display name for known executables; falls back to the raw
   process name so unmapped apps remain identifiable in the legend. */
const APP_LABELS = {
  "chrome.exe": "Chrome", "msedge.exe": "Edge", "firefox.exe": "Firefox",
  "SAPGUI.exe": "SAP", "saplogon.exe": "SAP",
  "EXCEL.EXE": "Excel", "OUTLOOK.EXE": "Outlook",
  "winword.exe": "Word", "powerpnt.exe": "PowerPoint", "Teams.exe": "Teams",
};
function appLabel(app) { return APP_LABELS[app] || (app || "unknown").replace(/\.exe$/i, ""); }

function renderLegend(observedApps) {
  const host = document.getElementById("legend-apps");
  if (!host) return;
  host.innerHTML = "";
  const apps = Array.from(observedApps || []).sort();
  for (const app of apps) {
    const span = document.createElement("span");
    span.className = "legend-app";
    const sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = appColor(app);
    span.appendChild(sw);
    span.appendChild(document.createTextNode(appLabel(app)));
    host.appendChild(span);
  }
}

/* P1.10: persistent timeline zoom + scroll per session. Keyed by
   sessionFolder so each session reopens to where the analyst left it.
   Uses a small in-memory throttle for scroll writes since scroll fires
   continuously during drag. */
const TL_STATE_KEY = "pdt.timelineState";
function _readTimelineState() {
  try { return JSON.parse(localStorage.getItem(TL_STATE_KEY)) || {}; }
  catch (_) { return {}; }
}
function _writeTimelineState(map) {
  try { localStorage.setItem(TL_STATE_KEY, JSON.stringify(map)); }
  catch (_) {}
}
function persistTimelineForCurrent() {
  if (!State.getSession() || !State.getSession().sessionFolder) return;
  const map = _readTimelineState();
  const scroll = document.getElementById("timeline-scroll");
  map[State.getSession().sessionFolder] = {
    zoomFactor: State.getZoomFactor(),
    scrollLeft: scroll ? scroll.scrollLeft : 0,
    ts: Date.now(),
  };
  _writeTimelineState(map);
}
function restoreTimelineForCurrent() {
  if (!State.getSession() || !State.getSession().sessionFolder) return;
  const map = _readTimelineState();
  const saved = map[State.getSession().sessionFolder];
  if (!saved) return;
  if (typeof saved.zoomFactor === "number" && saved.zoomFactor >= 1) {
    State.setZoomFactor(saved.zoomFactor);
    renderTimeline();
  }
  // Wait one frame so the host has expanded to the new width before scrolling.
  requestAnimationFrame(() => {
    const scroll = document.getElementById("timeline-scroll");
    if (scroll && typeof saved.scrollLeft === "number") scroll.scrollLeft = saved.scrollLeft;
  });
}
let _tlScrollPersistTimer = null;
function _wireTimelineScrollPersist() {
  const scroll = document.getElementById("timeline-scroll");
  if (!scroll || scroll._pdtPersistWired) return;
  scroll._pdtPersistWired = true;
  scroll.addEventListener("scroll", () => {
    syncMinimapViewport();
    if (_tlScrollPersistTimer) return;
    _tlScrollPersistTimer = setTimeout(() => {
      _tlScrollPersistTimer = null;
      persistTimelineForCurrent();
    }, 250);
  });
}
$("#btn-zoom-in").addEventListener("click", () => { State.setZoomFactor(State.getZoomFactor() * 1.5); renderTimeline(); persistTimelineForCurrent(); });
$("#btn-zoom-out").addEventListener("click", () => { State.setZoomFactor(Math.max(1, State.getZoomFactor() / 1.5)); renderTimeline(); persistTimelineForCurrent(); });
$("#btn-zoom-reset").addEventListener("click", () => { State.setZoomFactor(1); renderTimeline(); persistTimelineForCurrent(); });

/* P1.1: range selection on the timeline. Drag across the activity
   lane to select a time range; a stats card pops up summarizing what
   happened (duration, event count, top apps, contained markers). The
   range survives view-mode switches but clears on session change.
   Esc / click outside clears. */
function clearSelectionRange() {
  State.setSelectionRange(null);
  const ov = document.getElementById("tl-selection-overlay");
  if (ov) ov.remove();
  const card = document.getElementById("tl-selection-stats");
  if (card) card.remove();
}
function installRangeSelection() {
  const host = document.getElementById("timeline");
  if (!host || host._pdtSelWired) return;
  host._pdtSelWired = true;
  let startX = null, startMs = null, overlay = null;
  function spanInfo() {
    if (!State.getSession() || !State.getSession().events.length) return null;
    const first = new Date(State.getSession().events[0].timestamp).getTime();
    const last  = new Date(State.getSession().events[State.getSession().events.length - 1].timestamp).getTime();
    return { first, last, span: Math.max(1, last - first) };
  }
  function pxToMs(clientX) {
    const info = spanInfo();
    if (!info) return null;
    const rect = host.getBoundingClientRect();
    const frac = (clientX + host.scrollLeft - rect.left) / Math.max(1, rect.width);
    return info.first + frac * info.span;
  }
  host.addEventListener("mousedown", (e) => {
    // Only pure-background drag starts a selection — clicks on bands /
    // markers / dots / labels stay normal click-to-seek.
    if (e.target !== host) return;
    if (e.button !== 0) return;
    if (!e.shiftKey) return;  // require Shift so plain click-to-seek is unaffected
    e.preventDefault();
    startX = e.clientX;
    startMs = pxToMs(e.clientX);
    if (startMs == null) return;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "tl-selection-overlay";
      overlay.id = "tl-selection-overlay";
      host.appendChild(overlay);
    }
    const info = spanInfo();
    const x = ((startMs - info.first) / info.span) * 100;
    overlay.style.left = x + "%";
    overlay.style.width = "0%";
  });
  document.addEventListener("mousemove", (e) => {
    if (startX == null || !overlay) return;
    const info = spanInfo();
    if (!info) return;
    const curMs = pxToMs(e.clientX);
    if (curMs == null) return;
    const lo = Math.min(startMs, curMs);
    const hi = Math.max(startMs, curMs);
    overlay.style.left  = (((lo - info.first) / info.span) * 100) + "%";
    overlay.style.width = (((hi - lo) / info.span) * 100) + "%";
  });
  document.addEventListener("mouseup", () => {
    if (startX == null) return;
    if (!overlay) { startX = null; return; }
    const info = spanInfo();
    if (!info) { startX = null; return; }
    // Read the overlay's geometry to derive the final range.
    const leftPct  = parseFloat(overlay.style.left)  || 0;
    const widthPct = parseFloat(overlay.style.width) || 0;
    if (widthPct < 0.1) {
      // Tiny drag — treat as cancel.
      clearSelectionRange();
      startX = null;
      return;
    }
    const startSel = info.first + (leftPct / 100) * info.span;
    const endSel   = startSel + (widthPct / 100) * info.span;
    State.setSelectionRange({ startMs: startSel, endMs: endSel });
    renderSelectionStats();
    startX = null;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && State.getSelectionRange()) clearSelectionRange();
  });
}
function renderSelectionStats() {
  if (!State.getSelectionRange() || !State.getSession()) return;
  let card = document.getElementById("tl-selection-stats");
  if (!card) {
    card = document.createElement("div");
    card.className = "selection-stats";
    card.id = "tl-selection-stats";
    // Place above the legend so it doesn't crowd the timeline.
    const legend = document.getElementById("timeline-legend");
    if (legend && legend.parentNode) legend.parentNode.insertBefore(card, legend);
  }
  const evs = State.getSession().events;
  const inRange = evs.filter((ev) => {
    const t = new Date(ev.timestamp).getTime();
    return t >= State.getSelectionRange().startMs && t <= State.getSelectionRange().endMs;
  });
  const appCounts = {};
  let markerCount = 0, screenshotCount = 0;
  for (const ev of inRange) {
    if (ev.type === "activity") {
      const app = ev.data.app || "unknown";
      appCounts[app] = (appCounts[app] || 0) + 1;
    } else if (ev.type === "marker") markerCount++;
    else if (ev.type === "system" &&
             (ev.data.kind === "screenshot" || ev.data.kind === "screenshot_manual")) {
      screenshotCount++;
    }
  }
  const topApps = Object.entries(appCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([app, n]) => appLabel(app) + " (" + n + ")")
    .join(", ");
  const dur = State.getSelectionRange().endMs - State.getSelectionRange().startMs;
  card.innerHTML =
    '<h4>Selection</h4>' +
    '<div class="row"><span>Duration</span><span>' + escapeHtml(formatDuration(dur)) + '</span></div>' +
    '<div class="row"><span>Events</span><span>' + inRange.length + '</span></div>' +
    '<div class="row"><span>Markers</span><span>' + markerCount + '</span></div>' +
    '<div class="row"><span>Screenshots</span><span>' + screenshotCount + '</span></div>' +
    (topApps ? '<div class="row"><span>Top apps</span><span>' + escapeHtml(topApps) + '</span></div>' : '') +
    '<span class="clear-link" id="tl-selection-clear">× Clear selection</span>';
  document.getElementById("tl-selection-clear").addEventListener("click", clearSelectionRange);
}

/* P1.3: minimap overview above the timeline. A 30px strip showing the
   whole session compressed; the highlighted rectangle marks the
   currently-visible region in the scroll container. Click anywhere to
   jump; drag the rectangle to scroll. */
function renderMinimap() {
  const mm = document.getElementById("timeline-minimap");
  const scroll = document.getElementById("timeline-scroll");
  if (!mm || !scroll || !State.getSession() || !State.getSession().events) return;
  const evs = State.getSession().events;
  if (!evs.length) { mm.style.display = "none"; return; }
  mm.style.display = "";
  const first = new Date(evs[0].timestamp).getTime();
  const last  = new Date(evs[evs.length - 1].timestamp).getTime();
  const span  = Math.max(1, last - first);
  // Build / reset content.
  mm.innerHTML = "";
  // Activity bands (compressed). Skip very short ones for clarity.
  for (const ev of evs) {
    if (ev.type !== "activity") continue;
    const dur = ev.data.duration_ms || 0;
    if (dur < span * 0.0005) continue;
    const t = new Date(ev.timestamp).getTime();
    const x = ((t - first) / span) * 100;
    const w = Math.max(0.1, (dur / span) * 100);
    const b = document.createElement("div");
    b.className = "tl-mm-band";
    b.style.left = x + "%";
    b.style.width = w + "%";
    b.style.background = appColor(ev.data.app);
    mm.appendChild(b);
  }
  // Viewport rectangle.
  const vp = document.createElement("div");
  vp.className = "tl-mm-viewport";
  vp.id = "tl-mm-viewport";
  mm.appendChild(vp);
  syncMinimapViewport();
}
function syncMinimapViewport() {
  const mm = document.getElementById("timeline-minimap");
  const scroll = document.getElementById("timeline-scroll");
  const vp = document.getElementById("tl-mm-viewport");
  if (!mm || !scroll || !vp) return;
  const inner = scroll.scrollWidth || 1;
  const outer = scroll.clientWidth || 1;
  const visibleFrac = Math.min(1, outer / inner);
  const startFrac   = scroll.scrollLeft / inner;
  vp.style.left  = (startFrac * 100) + "%";
  vp.style.width = (visibleFrac * 100) + "%";
}
(function wireMinimap() {
  const mm = document.getElementById("timeline-minimap");
  if (!mm || mm._pdtWired) return;
  mm._pdtWired = true;
  mm.addEventListener("click", (e) => {
    // Click outside the viewport rect → jump there.
    if (e.target.id === "tl-mm-viewport") return;
    const scroll = document.getElementById("timeline-scroll");
    if (!scroll) return;
    const rect = mm.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / Math.max(1, rect.width);
    const inner = scroll.scrollWidth || 1;
    const outer = scroll.clientWidth || 1;
    scroll.scrollLeft = Math.max(0, frac * inner - outer / 2);
    syncMinimapViewport();
    persistTimelineForCurrent();
  });
  // Drag the viewport.
  let dragging = null;
  mm.addEventListener("mousedown", (e) => {
    if (e.target.id !== "tl-mm-viewport") return;
    e.preventDefault();
    const vp = e.target;
    vp.classList.add("dragging");
    const scroll = document.getElementById("timeline-scroll");
    const rect = mm.getBoundingClientRect();
    dragging = { startX: e.clientX, startScrollLeft: scroll.scrollLeft, mmW: rect.width, scroll };
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dxPx = e.clientX - dragging.startX;
    const inner = dragging.scroll.scrollWidth || 1;
    const dxScroll = (dxPx / Math.max(1, dragging.mmW)) * inner;
    dragging.scroll.scrollLeft = Math.max(0, dragging.startScrollLeft + dxScroll);
    syncMinimapViewport();
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    const vp = document.getElementById("tl-mm-viewport");
    if (vp) vp.classList.remove("dragging");
    dragging = null;
    persistTimelineForCurrent();
  });
})();

/* P1.2: hover thumbnail for timeline screenshot dots. Single shared
   element — created lazily, repositioned on each show. */
let _screenshotThumbEl = null;
function showScreenshotThumb(dot, imgPath) {
  if (!_screenshotThumbEl) {
    _screenshotThumbEl = document.createElement("img");
    _screenshotThumbEl.className = "tl-screenshot-thumb";
    document.body.appendChild(_screenshotThumbEl);
  }
  _screenshotThumbEl.src = "file:///" + imgPath.replace(/\\/g, "/");
  const rect = dot.getBoundingClientRect();
  // Place above the dot, biased to keep within viewport.
  const thumbW = 220, thumbH = 140;
  let left = rect.left + rect.width / 2 - thumbW / 2;
  if (left < 8) left = 8;
  if (left + thumbW > window.innerWidth - 8) left = window.innerWidth - thumbW - 8;
  let top = rect.top - thumbH - 8;
  if (top < 8) top = rect.bottom + 8;
  _screenshotThumbEl.style.left = left + "px";
  _screenshotThumbEl.style.top  = top  + "px";
  _screenshotThumbEl.style.display = "block";
}
function hideScreenshotThumb() {
  if (_screenshotThumbEl) _screenshotThumbEl.style.display = "none";
}

function renderTimelineSummary() {
  const evs = State.getSession().events;
  if (!evs.length) { $("#timeline-summary").textContent = ""; return; }
  const first = new Date(evs[0].timestamp);
  const last = new Date(evs[evs.length - 1].timestamp);
  $("#timeline-summary").textContent =
    first.toLocaleTimeString() + " → " + last.toLocaleTimeString() +
    " · " + formatDuration(last - first);
}

/* Pop a tiny context menu at (x, y) offering to queue a synthetic
   marker insert into annotations.json.marker_edits at timestamp `ts`.
   The edit only takes effect on the next normalization run. */
function showMarkerInsertMenu(x, y, ts) {
  /* Tear down any prior menu */
  const prior = document.getElementById("tl-ctx-menu");
  if (prior) prior.remove();

  const menu = document.createElement("div");
  menu.id = "tl-ctx-menu";
  menu.style.cssText =
    "position:fixed;z-index:1000;background:var(--bg-3);color:var(--fg);" +
    "border:1px solid var(--rule);padding:4px 0;border-radius:var(--radius-sm);" +
    "box-shadow:var(--shadow);font:13px var(--font-ui);" +
    "min-width:200px;cursor:default;user-select:none;";
  menu.style.left = x + "px";
  menu.style.top = y + "px";

  function addItem(label, handler) {
    const item = document.createElement("div");
    item.textContent = label;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => item.style.background = "var(--accent)");
    item.addEventListener("mouseleave", () => item.style.background = "");
    item.addEventListener("click", async () => {
      menu.remove();
      await handler();
    });
    menu.appendChild(item);
  }

  addItem("Insert Start marker here…", () => queueSyntheticMarker(ts, "start"));
  addItem("Insert End marker here",    () => queueSyntheticMarker(ts, "end"));

  document.body.appendChild(menu);
  /* Dismiss on outside click / escape */
  const dismiss = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    menu.remove();
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", dismiss, true);
  };
  /* Defer to avoid immediately catching the right-click's own mousedown */
  setTimeout(() => {
    document.addEventListener("mousedown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
  }, 0);
}

async function queueSyntheticMarker(ts, markerType) {
  if (!State.getSession()) return;
  let label = null;
  if (markerType === "start") {
    label = await promptModal({
      title: "Insert Start marker",
      message: "Label for the new Start marker",
      detail: "Queued in annotations.json; re-run Analyze to apply.",
      placeholder: "e.g. Send email",
      okLabel: "Insert",
    });
    if (label === null) return;     // cancelled
    label = (label || "").trim();
    if (!label) label = null;
  }
  const a = State.getSession().annotations || {};
  if (!Array.isArray(a.marker_edits)) a.marker_edits = [];
  a.marker_edits.push({
    id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
    op: "insert",
    marker_type: markerType,
    label,
    timestamp: ts,
    ts: new Date().toISOString(),
  });
  try {
    await saveAnnotationsWithUndo(a, `insert ${markerType} marker`);
    toast(
      `${markerType === "start" ? "Start" : "End"} marker queued — re-run normalization to apply`,
      "success",
    );
  } catch (err) {
    toast("Failed to save annotation: " + (err && err.message), "error");
  }
}

/* P2.D: timeline lane visibility. Defaults keep the core lanes on and
   the denser additions (density / window-titles / per-step / notes)
   off so the timeline isn't overwhelming out of the box. Persisted
   per-installation since it's a workflow preference, not session data. */
const LANE_KEY = "pdt.timelineLanes";
const LANE_DEFAULTS = {
  idle: true, markers: true, screenshots: true, cases: true,
  density: false, titles: false, steps: false, notes: false,
};
function getLaneToggles() {
  try {
    const saved = JSON.parse(localStorage.getItem(LANE_KEY)) || {};
    return Object.assign({}, LANE_DEFAULTS, saved);
  } catch (_) { return Object.assign({}, LANE_DEFAULTS); }
}
function setLaneToggle(key, on) {
  const cur = getLaneToggles();
  cur[key] = !!on;
  try { localStorage.setItem(LANE_KEY, JSON.stringify(cur)); } catch (_) {}
}
(function wireLanesMenu() {
  const btn = document.getElementById("btn-lanes");
  const popup = document.getElementById("lanes-popup");
  if (!btn || !popup) return;
  // Reflect persisted state into the checkboxes.
  const toggles = getLaneToggles();
  popup.querySelectorAll("input[data-lane]").forEach((cb) => {
    cb.checked = !!toggles[cb.dataset.lane];
    cb.addEventListener("change", () => {
      setLaneToggle(cb.dataset.lane, cb.checked);
      if (State.getSession()) renderTimeline();
    });
  });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    popup.style.display = popup.style.display === "none" ? "" : "none";
  });
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== btn) popup.style.display = "none";
  });
})();

function renderTimeline() {
  const host = $("#timeline");
  host.innerHTML = "";
  const evs = State.getSession().events;
  if (!evs.length) {
    const mm = document.getElementById("timeline-minimap");
    if (mm) mm.style.display = "none";
    return;
  }
  const lanes = getLaneToggles();
  const first = new Date(evs[0].timestamp).getTime();
  const last = new Date(evs[evs.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);

  host.style.width = (100 * State.getZoomFactor()) + "%";

  /* Lane stack (top to bottom):
       ticks       (24px) -- HH:MM:SS labels at sensible intervals
       activity    (60px) -- per-app coloured bands
       density     (12px) -- event-count histogram, ~120 buckets
       cases       (var)  -- one row per concurrent case
       playhead overlays all lanes. */
  const ticksTop = 4;
  const ticksH = 20;
  const activityTop = ticksTop + ticksH + 4;
  const activityH = 60;
  const densityTop = activityTop + activityH + 2;
  const densityH = lanes.density ? 12 : 0;
  const caseRowH = 22;

  // P2.12: window-title runs lane. Group consecutive activity events
  // by (app, title) and emit one band per run.
  const _titleRuns = [];
  {
    let runStart = null, runEndDur = 0, runApp = null, runTitle = null;
    function flushRun(endMs) {
      if (runStart != null && endMs > runStart) {
        _titleRuns.push({ startMs: runStart, endMs, app: runApp, title: runTitle });
      }
      runStart = null; runApp = null; runTitle = null; runEndDur = 0;
    }
    for (const ev of evs) {
      if (ev.type !== "activity") continue;
      const t = new Date(ev.timestamp).getTime();
      const dur = ev.data.duration_ms || 0;
      const app = ev.data.app || "";
      const title = ev.data.title || "";
      if (runStart == null) {
        runStart = t; runApp = app; runTitle = title; runEndDur = dur;
      } else if (app === runApp && title === runTitle) {
        runEndDur = (t + dur) - runStart;
      } else {
        flushRun(runStart + runEndDur);
        runStart = t; runApp = app; runTitle = title; runEndDur = dur;
      }
    }
    if (runStart != null) flushRun(runStart + runEndDur);
  }
  const titlesLaneH = (lanes.titles && _titleRuns.length) ? 14 : 0;

  // P1.4 + P1.9: optional per-step + annotation lanes between density
  // and cases. Compute their heights upfront so casesTop accounts for
  // them — otherwise the cases overlap with the new lanes.
  const _stepsForLane = (State.getSession().annotations && State.getSession().annotations.steps) || [];
  const _notesForLane = (State.getSession().annotations && State.getSession().annotations.notes) || [];
  const stepsLaneH = (lanes.steps && _stepsForLane.length) ? 16 : 0;
  const notesLaneH = (lanes.notes && _notesForLane.length) ? 18 : 0;
  const titlesLaneTop = densityTop + densityH + 4;
  const stepsLaneTop = titlesLaneTop + titlesLaneH + (titlesLaneH ? 4 : 0);
  const notesLaneTop = stepsLaneTop + stepsLaneH + (stepsLaneH ? 4 : 0);

  // Count concurrent open markers at any point so we know how many
  // case lanes to draw. Each lane gets its own row beneath the
  // histogram; dangling cases share lanes with closed cases that
  // started earlier.
  const caseLanes = layoutCaseLanes(evs, first, last);
  const casesTop = notesLaneTop + notesLaneH + (notesLaneH ? 4 : 6);
  const casesH = lanes.cases
    ? Math.max(caseRowH, caseLanes.lanesNeeded * caseRowH)
    : 0;
  // height comes from --timeline-height (drag-resizable); set as min-height so content never clips
  host.style.minHeight = Math.max(120, casesTop + casesH + 14) + "px";

  // ===== Time-axis ticks =====
  // Tick positions, intervals, and labels come from the shared timeline
  // core -- the same logic the Steps and Phases timelines use. The
  // `.tl-flow-tick` class keeps the Flow ticks (tall vertical lines)
  // distinct from the mini-timelines' short `.tl-tick` axis ticks.
  for (const tk of TimelineCore.chooseTicks(first, last, 12)) {
    const x = tk.xPct;
    const tick = document.createElement("div");
    tick.className = "tl-flow-tick";
    tick.style.left = x + "%";
    tick.style.top = ticksTop + "px";
    tick.style.height = (ticksH + activityH + 2) + "px";
    host.appendChild(tick);
    const lbl = document.createElement("div");
    lbl.className = "tl-flow-tick-label";
    lbl.style.left = "calc(" + x + "% + 3px)";
    lbl.style.top = ticksTop + "px";
    lbl.textContent = tk.label;
    host.appendChild(lbl);
  }

  // Activity bands -- coloured per app, with inline title + duration
  // labels so analysts can read the timeline without hovering. Out-of
  // -scope bands (case scope active and this band's midpoint outside
  // the case range) are dimmed via .out-of-scope so context survives.
  const observedApps = new Set();
  const scopeRange = currentScopeRange();
  for (const ev of evs) {
    if (ev.type !== "activity") continue;
    const t = new Date(ev.timestamp).getTime();
    const dur = ev.data.duration_ms || 0;
    const x = ((t - first) / span) * 100;
    const w = Math.max(0.15, (dur / span) * 100);
    const inScope = !scopeRange ||
      (t + dur / 2 >= scopeRange.startMs && t + dur / 2 <= scopeRange.endMs);
    const band = document.createElement("div");
    band.className = "tl-band tl-activity" + (inScope ? "" : " out-of-scope");
    band.style.left = x + "%";
    band.style.width = w + "%";
    band.style.top = activityTop + "px";
    band.style.height = activityH + "px";
    band.style.background = appColor(ev.data.app) + "AA";
    band.dataset.app = ev.data.app || "";
    if (ev.data.app) observedApps.add(ev.data.app);
    band.title = (ev.data.app || "") + " - " + (ev.data.title || "") +
      "\n" + new Date(t).toLocaleTimeString() + " (" + formatDuration(dur) + ")";

    // Label: app name (top line, bold-ish) + window title (second line, dim).
    // Duration pinned to bottom-right. CSS hides children that don't fit.
    const lbl = document.createElement("div");
    lbl.className = "tl-activity-label";
    const appName = document.createElement("span");
    appName.className = "tl-act-app";
    appName.textContent = appLabel(ev.data.app);
    const titleEl = document.createElement("span");
    titleEl.className = "tl-act-title";
    titleEl.textContent = ev.data.title || "";
    const durEl = document.createElement("span");
    durEl.className = "tl-act-dur";
    durEl.textContent = formatDuration(dur);
    lbl.appendChild(appName);
    lbl.appendChild(titleEl);
    lbl.appendChild(durEl);
    band.appendChild(lbl);

    band.addEventListener("click", (e) => { e.stopPropagation(); seekToTimestamp(ev.timestamp); });
    band.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMarkerInsertMenu(e.clientX, e.clientY, ev.timestamp);
    });
    host.appendChild(band);
  }
  renderLegend(observedApps);

  // Idle bands
  let idleStart = null;
  for (const ev of (lanes.idle ? evs : [])) {
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
  for (const ev of (lanes.markers ? evs : [])) {
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
    if (ev.data.marker_type === "start") {
      const label = effectiveLabel(ev);
      if (label) {
        const lbl = document.createElement("div");
        lbl.className = "tl-marker-label";
        lbl.style.left = "calc(" + x + "% + 4px)";
        lbl.style.top = (activityTop + 2) + "px";
        lbl.textContent = label;
        host.appendChild(lbl);
      }
    }
  }

  // Screenshot dots (on band bottom edge). P1.2: hover pops a thumbnail.
  for (const ev of (lanes.screenshots ? evs : [])) {
    if (ev.type !== "system") continue;
    if (ev.data.kind !== "screenshot" && ev.data.kind !== "screenshot_manual") continue;
    const t = new Date(ev.timestamp).getTime();
    const x = ((t - first) / span) * 100;
    const dot = document.createElement("div");
    dot.className = "tl-screenshot";
    dot.style.left = "calc(" + x + "% - 3px)";
    dot.style.top = (activityTop + activityH - 4) + "px";
    dot.title = ev.data.kind + " - " + new Date(t).toLocaleTimeString() +
      "\n" + (ev.data.path || "");
    dot.addEventListener("click", (e) => { e.stopPropagation(); openScreenshot(ev.data.path); });
    if (ev.data.path) {
      dot.addEventListener("mouseenter", () => showScreenshotThumb(dot, ev.data.path));
      dot.addEventListener("mouseleave", () => hideScreenshotThumb());
    }
    host.appendChild(dot);
  }

  // ===== Density histogram lane =====
  // Bucket events into ~120 bins across the span. Background events
  // (idle_start/end, paused/resumed, recorder_*) are excluded so the
  // histogram reflects user activity, not session bookkeeping.
  const N_BUCKETS = 120;
  const bucketDur = span / N_BUCKETS;
  const buckets = new Array(N_BUCKETS).fill(0);
  for (const ev of evs) {
    if (!isUserActivityEvent(ev)) continue;
    const idx = Math.min(N_BUCKETS - 1, Math.floor((new Date(ev.timestamp).getTime() - first) / bucketDur));
    if (idx >= 0) buckets[idx] += 1;
  }
  const maxBucket = buckets.reduce((m, v) => v > m ? v : m, 0) || 1;
  // Render the density lane only when enabled (densityH is 0 otherwise).
  if (densityH) {
    for (let i = 0; i < N_BUCKETS; i++) {
      if (!buckets[i]) continue;
      const x = (i / N_BUCKETS) * 100;
      const w = (1 / N_BUCKETS) * 100;
      const h = Math.max(2, Math.round(densityH * (buckets[i] / maxBucket)));
      const bar = document.createElement("div");
      bar.className = "tl-density-bar";
      bar.style.left = x + "%";
      bar.style.width = w + "%";
      bar.style.top = (densityTop + densityH - h) + "px";
      bar.style.height = h + "px";
      bar.title = `${buckets[i]} events @ ` +
        new Date(first + i * bucketDur).toLocaleTimeString();
      host.appendChild(bar);
    }
    // Density baseline (faint background strip so the lane reads even
    // when sparse).
    const densityBaseline = document.createElement("div");
    densityBaseline.className = "tl-density-base";
    densityBaseline.style.top = densityTop + "px";
    densityBaseline.style.height = densityH + "px";
    host.appendChild(densityBaseline);
  }

  // ===== Window-title runs lane (P2.12) =====
  // One band per consecutive (app, title) run. Label only renders when
  // the band is wide enough to fit ~6 chars; otherwise the band is a
  // pure colour stripe so the rhythm of title changes is still visible.
  if (titlesLaneH) {
    // host.style.width was set to (100 * zoomFactor) + "%" earlier, so
    // host.clientWidth ALREADY reflects the zoomed width. Don't multiply
    // by zoomFactor again -- the band's pixel width is just (w / 100) *
    // hostW.
    const hostW = host.clientWidth || 800;
    const minLabelPx = 50;
    for (const r of _titleRuns) {
      const x = ((r.startMs - first) / span) * 100;
      const w = Math.max(0.05, ((r.endMs - r.startMs) / span) * 100);
      const band = document.createElement("div");
      band.className = "tl-title-band";
      band.style.left = x + "%";
      band.style.width = w + "%";
      band.style.top = titlesLaneTop + "px";
      band.title = (r.app || "") + " — " + (r.title || "(untitled)");
      const renderedPx = (w / 100) * hostW;
      if (renderedPx >= minLabelPx) {
        band.textContent = r.title || (r.app || "").replace(/\.exe$/i, "");
      }
      host.appendChild(band);
    }
  }

  // ===== Per-step lane (P1.4) =====
  // Renders a single row of step bands beneath density when steps exist.
  // Click to select the step + jump to Steps view.
  // (stepsLaneTop / stepsLaneH computed earlier so casesTop accounts for them.)
  for (const s of (lanes.steps ? _stepsForLane : [])) {
    if (!s.time_range || !s.time_range.start || !s.time_range.end) continue;
    const sStart = new Date(s.time_range.start).getTime();
    const sEnd   = new Date(s.time_range.end).getTime();
    if (!isFinite(sStart) || !isFinite(sEnd) || sEnd <= sStart) continue;
    const x = ((sStart - first) / span) * 100;
    const w = Math.max(0.2, ((sEnd - sStart) / span) * 100);
    const band = document.createElement("div");
    band.className = "tl-step-band";
    band.style.left = x + "%";
    band.style.width = w + "%";
    band.style.top = stepsLaneTop + "px";
    band.textContent = s.name || s.step_id || "";
    band.title = (s.name || s.step_id) + " — " + formatDuration(sEnd - sStart);
    band.addEventListener("click", (e) => {
      e.stopPropagation();
      State.setSelectedStepId(s.step_id);
      const stepsBtn = document.querySelector('.view-mode-btn[data-level="steps"]');
      if (stepsBtn) stepsBtn.click();
    });
    host.appendChild(band);
  }

  // ===== Annotation lane (P1.9) =====
  // Numbered note dots beneath the steps lane (or beneath density if no
  // steps). Click to open the note in the side panel + switch to Notes
  // tab.
  // (notesLaneTop / notesLaneH computed earlier so casesTop accounts for them.)
  (lanes.notes ? _notesForLane : []).forEach((n, idx) => {
    if (!n.timestamp) return;
    const ms = new Date(n.timestamp).getTime();
    if (!isFinite(ms)) return;
    const x = ((ms - first) / span) * 100;
    const dot = document.createElement("div");
    dot.className = "tl-note-dot";
    dot.style.left = "calc(" + x + "% - 7px)";
    dot.style.top = notesLaneTop + "px";
    dot.textContent = String(idx + 1);
    dot.dataset.noteIdx = String(idx);
    dot.title = (n.text || "(empty note)").slice(0, 80);
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      activateAnnoTab("notes");
      const noteRow = document.querySelector(`[data-note-idx="${idx}"]`);
      if (noteRow) noteRow.scrollIntoView({ behavior: "smooth", block: "center" });
      seekToTimestamp(n.timestamp);
    });
    host.appendChild(dot);
  });

  // ===== Case lanes =====
  // layoutCaseLanes() (below) walks the marker stream and assigns
  // each case to a non-overlapping lane via a sweep-line algo:
  //   - Each case knows its [start, end) and a parent_id.
  //   - A new case picks the first lane whose previous occupant ended
  //     before this case starts. Nested cases land BELOW their parent.
  //   - Dangling cases (start with no end) extend to `last` with a
  //     dashed right edge so they're visually distinct from closed.
  // The case scope dropdown can target any of these directly.
  for (const c of (lanes.cases ? caseLanes.cases : [])) {
    const x = ((c.startMs - first) / span) * 100;
    const w = Math.max(0.15, ((c.endMs - c.startMs) / span) * 100);
    const top = casesTop + c.lane * caseRowH;
    const band = document.createElement("div");
    band.className = "tl-case-band" + (c.dangling ? " dangling" : "");
    band.style.left = x + "%";
    band.style.width = w + "%";
    band.style.top = top + "px";
    band.style.height = (caseRowH - 4) + "px";
    band.title = (c.dangling ? "unclosed: " : "case: ") +
      (c.label || "(unlabeled)") +
      (c.dangling ? "" : "\n" + formatDuration(c.endMs - c.startMs));
    // Click anywhere on a case band -- closed OR dangling -- seeks
    // the video to the case start. Right-click opens the scope/jump
    // menu below.
    band.addEventListener("click", (e) => {
      e.stopPropagation();
      seekToTimestamp(new Date(c.startMs).toISOString());
    });
    band.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Scope-to-case option (in addition to the marker insert menu
      // available on activity bands).
      showCaseContextMenu(e.clientX, e.clientY, c);
    });
    host.appendChild(band);
    const lbl = document.createElement("div");
    lbl.className = "tl-case-label";
    lbl.style.left = "calc(" + x + "% + 4px)";
    lbl.style.top = (top + 3) + "px";
    lbl.textContent = c.label || "(unlabeled)";
    host.appendChild(lbl);
  }

  // Playhead
  const ph = document.createElement("div");
  ph.className = "tl-playhead";
  ph.id = "tl-playhead";
  ph.style.left = "0%";
  ph.style.display = "none";
  host.appendChild(ph);

  // Click->seek on background. P2.9: snap to nearest event when one
  // is within ~250ms / span × pixel-tolerance of the click; else seek
  // to the literal point. Avoids the "click empty space, jump 30 ms
  // before the activity I meant" feel.
  host.addEventListener("click", (e) => {
    if (e.target !== host) return;
    const rect = host.getBoundingClientRect();
    const frac = (e.clientX + host.scrollLeft - rect.left) / rect.width;
    const target = first + frac * span;
    // pixel tolerance scales with zoom: at 1x ~10px tolerance, at higher
    // zoom the same px is fewer ms, so snapping stays "near the cursor"
    // visually rather than "near in wall-clock".
    const pxTol = 10;
    const msTol = Math.max(50, Math.min(500, (pxTol / Math.max(1, host.clientWidth || rect.width)) * span));
    let nearestT = null, nearestDelta = Infinity;
    for (const ev of evs) {
      const t = new Date(ev.timestamp).getTime();
      const d = Math.abs(t - target);
      if (d < nearestDelta) { nearestDelta = d; nearestT = t; }
      if (d > msTol && nearestT != null) break; // events are time-sorted
    }
    const seekT = (nearestT != null && nearestDelta <= msTol) ? nearestT : target;
    seekToTimestamp(new Date(seekT).toISOString());
  });

  // P1.3: refresh minimap to mirror the new timeline content + viewport.
  renderMinimap();
}

function positionPlayhead() {
  const video = $("#video");
  const ph = $("#tl-playhead");
  if (!ph || !State.getSession() || !State.getSession().events.length) return;
  const first = new Date(State.getSession().events[0].timestamp).getTime();
  const last = new Date(State.getSession().events[State.getSession().events.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);
  const obsStartTs = videoStartTs();
  if (!obsStartTs) { ph.style.display = "none"; return; }
  const playT = new Date(obsStartTs).getTime() + video.currentTime * 1000;
  const x = ((playT - first) / span) * 100;
  ph.style.left = x + "%";
  ph.style.display = "";
  setVideoOverlay(formatPlayback(video.currentTime, video.duration));
}

/* ============ Timeline helpers (lane layout, ticks, density)
   ================================================================ */

/* Walk markers, build closed/dangling cases, and assign each to a
   non-overlapping lane. Returns { cases: [...], lanesNeeded }.
   Each case: { startMs, endMs, label, dangling, lane, parent_id, id }. */
function layoutCaseLanes(evs, first, last) {
  const opening = [];   // stack of currently-open cases by depth
  const closed = [];
  let nextId = 0;
  for (const ev of evs) {
    if (ev.type !== "marker") continue;
    const t = new Date(ev.timestamp).getTime();
    if (ev.data.marker_type === "start") {
      opening.push({
        id: nextId++,
        startMs: t,
        label: ev.data.label,
        parent_id: opening.length ? opening[opening.length - 1].id : null,
      });
    } else if (ev.data.marker_type === "end" && opening.length) {
      const c = opening.pop();
      c.endMs = t;
      c.dangling = false;
      closed.push(c);
    }
  }
  // Dangling cases: extend to session end.
  for (const c of opening) {
    c.endMs = last;
    c.dangling = true;
    closed.push(c);
  }
  // Lane assignment is delegated to the shared timeline core. Cases stay
  // sorted by start so the returned array order is unchanged; maxLanes is
  // set high enough that cases are never capped (unlike step/phase lanes).
  closed.sort((a, b) => a.startMs - b.startMs);
  const packed = TimelineCore.packLanes(
    closed.map((c) => ({ id: String(c.id), startMs: c.startMs, endMs: c.endMs })),
    { maxLanes: Math.max(1, closed.length), spanMs: Math.max(1, last - first) }
  );
  for (const c of closed) c.lane = packed.laneOf.get(String(c.id)) || 0;
  return { cases: closed, lanesNeeded: packed.laneCount };
}


/* The density histogram counts only events that represent user
   activity, not session bookkeeping (pause/resume, idle starts,
   recorder lifecycle, etc.). */
function isUserActivityEvent(ev) {
  if (ev.type === "activity" || ev.type === "interaction" || ev.type === "marker") return true;
  if (ev.type === "system") {
    const k = ev.data && ev.data.kind;
    if (k === "screenshot" || k === "screenshot_manual") return true;
  }
  return false;
}

/* Right-click on a case band: offer scope + jump actions. Uses the
   same context-menu construction pattern as showMarkerInsertMenu. */
function showCaseContextMenu(x, y, c) {
  const prior = document.getElementById("tl-ctx-menu");
  if (prior) prior.remove();
  const menu = document.createElement("div");
  menu.id = "tl-ctx-menu";
  menu.style.cssText =
    "position:fixed;z-index:1000;background:var(--bg-3);color:var(--fg);" +
    "border:1px solid var(--rule);padding:4px 0;border-radius:var(--radius-sm);" +
    "box-shadow:var(--shadow);font:13px var(--font-ui);" +
    "min-width:240px;cursor:default;user-select:none;";
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  function addItem(label, handler) {
    const item = document.createElement("div");
    item.textContent = label;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => item.style.background = "var(--accent)");
    item.addEventListener("mouseleave", () => item.style.background = "");
    item.addEventListener("click", () => { menu.remove(); handler(); });
    menu.appendChild(item);
  }
  addItem("Scope view to this case", () => {
    /* Find the case by start timestamp -- the case scope dropdown
       keys cases by case_id derived from normalization, but visually
       we map by startMs which is stable. */
    const cases = State.getSession() ? deriveCases(State.getSession()) : [];
    const match = cases.find(x => Math.abs(x.startMs - c.startMs) < 5);
    if (match) {
      State.setCaseScope(match.id);
      const sel = $("#case-scope-select");
      if (sel) { sel.value = match.id; sel.dispatchEvent(new Event("change")); }
      else { renderTimeline(); }
      toast(`Scoped to: ${match.label || match.id}`);
    } else {
      toast("Case not found in normalized output -- run Analyze first", "error");
    }
  });
  addItem("Jump to start", () => seekToTimestamp(new Date(c.startMs).toISOString()));
  if (!c.dangling) {
    addItem("Jump to end", () => seekToTimestamp(new Date(c.endMs).toISOString()));
  }
  document.body.appendChild(menu);
  function dismiss(e) {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener("click", dismiss, true);
      document.removeEventListener("keydown", onKey, true);
    }
  }
  function onKey(e) {
    if (e.key === "Escape") {
      menu.remove();
      document.removeEventListener("click", dismiss, true);
      document.removeEventListener("keydown", onKey, true);
    }
  }
  document.addEventListener("click", dismiss, true);
  document.addEventListener("keydown", onKey, true);
}

/* The "video start timestamp" -- i.e. the wall clock at video t=0.
   Priority: external-video offset (Teams recording etc.), else OBS's
   recording_start_ts. Returns ISO string or null. */
function videoStartTs() {
  if (!State.getSession()) return null;
  // External video override: session started_at + offsetMs = wall-clock when video t=0.
  if (State.getSession().externalVideoOffsetMs != null && State.getSession().manifest && State.getSession().manifest.started_at) {
    const ms = new Date(State.getSession().manifest.started_at).getTime()
             + Number(State.getSession().externalVideoOffsetMs);
    return new Date(ms).toISOString();
  }
  return (State.getSession().manifest.obs && State.getSession().manifest.obs.recording_start_ts) || null;
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
  if (!State.getSession()) return;
  const video = $("#video");
  const obsStartTs = videoStartTs();
  if (!obsStartTs || !video.src) return;
  const offsetS = (new Date(ts).getTime() - new Date(obsStartTs).getTime()) / 1000;
  if (offsetS < 0) return;
  video.currentTime = offsetS;
  video.play().catch(() => {});
}

/* Steps/Phases detail panel -> Flow view. Switches the active level
   and seeks the video to the start of the step (if a recording is
   linked) or scrolls the Flow timeline playhead there. */
function jumpToStepInFlow(step) {
  if (!step || !step.time_range || !step.time_range.start) return;
  // Switch view-mode bar back to Flow
  const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
  if (flowBtn) flowBtn.click();
  // Seek if we have a recording, else just nudge the playhead to land at the right column
  seekToTimestamp(step.time_range.start);
}

function videoTimeToSessionTs(seconds) {
  const obsStartTs = videoStartTs();
  if (!obsStartTs) return null;
  return new Date(new Date(obsStartTs).getTime() + seconds * 1000).toISOString();
}

/* ============ Event table ========================================= */

function renderEventTable() {
  const filter = ($("#event-filter").value || "").toLowerCase();
  const showAct = $("#cb-show-activity").checked;
  const showMark = $("#cb-show-marker").checked;
  const showSys = $("#cb-show-system").checked;
  const showInter = $("#cb-show-interaction") ? $("#cb-show-interaction").checked : true;
  const tbody = $("#event-table tbody");
  tbody.innerHTML = "";
  let count = 0;
  for (const ev of State.getSession().events) {
    if (ev.type === "activity" && !showAct) continue;
    if (ev.type === "marker" && !showMark) continue;
    if (ev.type === "system" && !showSys) continue;
    if (ev.type === "interaction" && !showInter) continue;
    const lbl = ev.type === "activity"
      ? (ev.data.activity_label || ev.data.app || "")
      : ev.type === "marker"
        ? (ev.data.marker_type + ": " + (ev.data.label || ""))
      : ev.type === "interaction"
        ? ((ev.data.kind || "") + ": " + (ev.data.name || ev.data.automation_id || ev.data.control_type || ""))
        : (ev.data.kind || "");
    const detail = ev.type === "activity"
      ? (ev.data.title || "")
      : ev.type === "marker"
        ? (ev.data.reason ? "reason: " + ev.data.reason : "")
      : ev.type === "interaction"
        ? ((ev.data.window_title || "") + (ev.data.process_name ? " · " + ev.data.process_name : ""))
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
if ($("#cb-show-interaction")) $("#cb-show-interaction").addEventListener("change", () => renderEventTable());

/* ============ Annotations / screenshots / markers ================= */

function renderAnnotations() {
  const host = $("#annotations-list");
  host.innerHTML = "";
  const notes = (State.getSession().annotations && State.getSession().annotations.notes) || [];
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
  if (!State.getSession()) return;
  const note = $("#anno-note").value.trim();
  if (!note) return;
  const video = $("#video");
  const videoTs = videoTimeToSessionTs(video.currentTime) || new Date().toISOString();
  const anno = State.getSession().annotations || { notes: [] };
  anno.notes = anno.notes || [];
  anno.notes.push({
    id: cryptoRandomId(),
    type: "note",
    timestamp: videoTs,
    video_offset_s: video.currentTime || 0,
    text: note,
  });
  await saveAnnotationsWithUndo(anno, "add note");
  State.getSession().annotations = anno;
  $("#anno-note").value = "";
  renderAnnotations();
  toast("Note saved", "success");
});

function renderScreenshots() {
  const host = $("#screenshots-grid");
  host.innerHTML = "";
  const shots = (State.getSession().events || []).filter((e) =>
    e.type === "system" &&
    (e.data.kind === "screenshot" || e.data.kind === "screenshot_manual"));
  // Stash for the gallery (P2.7).
  _allScreenshots = shots;
  if (!shots.length) {
    host.innerHTML = '<p class="hint">No screenshots captured in this session.</p>';
    return;
  }
  for (const s of shots) {
    const card = document.createElement("div");
    card.className = "thumb";
    const fullPath = path.join(State.getSession().sessionFolder, s.data.path);
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

/* P2.7: full-pane screenshot gallery. Step through every screenshot
   with arrow keys, Esc closes, Space toggles auto-advance (~1.2s),
   filter by trigger reason. Built lazily on first open; keeps a
   single overlay element in the DOM after first build. */
let _allScreenshots = [];
let _galleryState = null;  // { idx, filterReason, playing, playTimer }
function _galleryFilter(reason) {
  // Capture only distinguishes manual screenshots from auto ones today
  // (no reason field on the auto path -- they all come through as
  // kind="screenshot"). Filter accordingly; richer per-trigger
  // distinctions would need a capture-side change to pass `reason`.
  if (!reason || reason === "all") return _allScreenshots.slice();
  return _allScreenshots.filter((s) => {
    const k = s.data.kind || "";
    if (reason === "manual") return k === "screenshot_manual";
    if (reason === "auto")   return k !== "screenshot_manual";
    return true;
  });
}
function openScreenshotGallery() {
  if (!_allScreenshots.length) { toast("No screenshots in this session.", ""); return; }
  let overlay = document.getElementById("screenshot-gallery");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "screenshot-gallery";
    overlay.className = "screenshot-gallery";
    overlay.innerHTML =
      '<div class="screenshot-gallery-header">' +
        '<span class="title">Screenshot gallery</span>' +
        '<select id="gallery-filter">' +
          '<option value="all">All screenshots</option>' +
          '<option value="manual">Manual only</option>' +
          '<option value="auto">Auto only</option>' +
        '</select>' +
        '<button id="gallery-play" type="button" class="link-btn">Play (Space)</button>' +
        '<button id="gallery-close" type="button" class="link-btn">Close (Esc)</button>' +
      '</div>' +
      '<div class="screenshot-gallery-body"><img id="gallery-img" alt="screenshot" /></div>' +
      '<div class="screenshot-gallery-footer">' +
        '<span class="pos" id="gallery-pos">—</span>' +
        '<span class="ts" id="gallery-ts">—</span>' +
        '<span class="reason" id="gallery-reason">—</span>' +
        '<span class="flex-spacer" style="flex:1"></span>' +
        '<span style="color:var(--fg-3);font-size:10px">← / → step · Space play · Esc close · click image to seek video</span>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById("gallery-close").addEventListener("click", closeScreenshotGallery);
    document.getElementById("gallery-play").addEventListener("click", _galleryTogglePlay);
    document.getElementById("gallery-filter").addEventListener("change", (e) => {
      _galleryState.filterReason = e.target.value;
      _galleryState.idx = 0;
      _galleryRenderFrame();
    });
    document.getElementById("gallery-img").addEventListener("click", () => {
      const list = _galleryFilter(_galleryState.filterReason);
      const s = list[_galleryState.idx];
      if (s) seekToTimestamp(s.timestamp);
    });
  }
  _galleryState = { idx: 0, filterReason: "all", playing: false, playTimer: null };
  document.getElementById("gallery-filter").value = "all";
  _galleryRenderFrame();
  document.addEventListener("keydown", _galleryKey);
}
function closeScreenshotGallery() {
  const overlay = document.getElementById("screenshot-gallery");
  if (overlay) overlay.style.display = "none";
  if (_galleryState && _galleryState.playTimer) clearTimeout(_galleryState.playTimer);
  document.removeEventListener("keydown", _galleryKey);
  _galleryState = null;
}
function _galleryRenderFrame() {
  const overlay = document.getElementById("screenshot-gallery");
  overlay.style.display = "flex";
  const list = _galleryFilter(_galleryState.filterReason);
  if (!list.length) {
    document.getElementById("gallery-img").style.display = "none";
    document.getElementById("gallery-pos").textContent = "0 / 0";
    document.getElementById("gallery-ts").textContent = "";
    document.getElementById("gallery-reason").textContent = "(no matching screenshots)";
    return;
  }
  const s = list[_galleryState.idx];
  const fullPath = path.join(State.getSession().sessionFolder, s.data.path);
  const img = document.getElementById("gallery-img");
  img.style.display = "";
  img.src = "file:///" + fullPath.replace(/\\/g, "/");
  document.getElementById("gallery-pos").textContent = `${_galleryState.idx + 1} / ${list.length}`;
  document.getElementById("gallery-ts").textContent = s.timestamp;
  document.getElementById("gallery-reason").textContent =
    s.data.kind === "screenshot_manual" ? "manual" : (s.data.reason || "automatic");
}
function _galleryStep(delta) {
  if (!_galleryState) return;
  const list = _galleryFilter(_galleryState.filterReason);
  if (!list.length) return;
  _galleryState.idx = (_galleryState.idx + delta + list.length) % list.length;
  _galleryRenderFrame();
}
function _galleryTogglePlay() {
  if (!_galleryState) return;
  _galleryState.playing = !_galleryState.playing;
  const btn = document.getElementById("gallery-play");
  if (btn) btn.textContent = _galleryState.playing ? "Pause (Space)" : "Play (Space)";
  if (_galleryState.playing) _galleryAdvance();
  else if (_galleryState.playTimer) { clearTimeout(_galleryState.playTimer); _galleryState.playTimer = null; }
}
function _galleryAdvance() {
  if (!_galleryState || !_galleryState.playing) return;
  _galleryState.playTimer = setTimeout(() => {
    _galleryStep(1);
    _galleryAdvance();
  }, 1200);
}
function _galleryKey(e) {
  if (!_galleryState) return;
  if (e.key === "Escape") { e.preventDefault(); closeScreenshotGallery(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); _galleryStep(1); }
  else if (e.key === "ArrowLeft")  { e.preventDefault(); _galleryStep(-1); }
  else if (e.key === " ")          { e.preventDefault(); _galleryTogglePlay(); }
}
(function wireScreenshotGallery() {
  const btn = document.getElementById("btn-open-gallery");
  if (btn) btn.addEventListener("click", openScreenshotGallery);
})();

function openScreenshot(relPath) {
  if (!relPath || !State.getSession()) return;
  const full = path.join(State.getSession().sessionFolder, relPath);
  if (fs.existsSync(full)) ipcRenderer.invoke("viewer:openExternal", full);
}

function getMarkerEdit(eventId) {
  /* Returns the latest pending edit (e.g. rename) for a given marker
     event_id, or null. Edits live in annotations.json under marker_edits. */
  const edits = (State.getSession().annotations && State.getSession().annotations.marker_edits) || [];
  let latest = null;
  for (const e of edits) {
    if (e.event_id === eventId) latest = e; // last write wins
  }
  return latest;
}

function effectiveLabel(markerEvent) {
  const edit = getMarkerEdit(markerEvent.event_id);
  if (edit && edit.field === "label") return edit.value;
  return markerEvent.data.label;
}

function isDeletedMarker(eventId) {
  const edits = (State.getSession().annotations && State.getSession().annotations.marker_edits) || [];
  return edits.some((e) => e.event_id === eventId && e.op === "delete");
}

function effectiveTimestamp(markerEvent) {
  const edits = (State.getSession().annotations && State.getSession().annotations.marker_edits) || [];
  let latest = null;
  for (const e of edits) {
    if (e.event_id === markerEvent.event_id && e.field === "timestamp") latest = e.value;
  }
  return latest || markerEvent.timestamp;
}

function renderMarkersList() {
  const host = $("#markers-list");
  host.innerHTML = "";
  const allMarkers = (State.getSession().events || []).filter((e) => e.type === "marker");
  if (!allMarkers.length) {
    host.innerHTML = '<p class="hint">No markers fired in this session.</p>';
    return;
  }
  const f = State.getListFilters().marker;
  const query = (f.text || "").toLowerCase();
  const markers = query
    ? allMarkers.filter(m => (effectiveLabel(m) || "").toLowerCase().includes(query)
        || (m.data.reason || "").toLowerCase().includes(query))
    : allMarkers;
  const meta = $("#marker-filter-meta");
  if (meta) meta.textContent = markers.length === allMarkers.length
    ? `${allMarkers.length} markers`
    : `${markers.length} of ${allMarkers.length}`;
  if (!markers.length) {
    host.innerHTML = '<p class="hint">No markers match the filter.</p>';
    return;
  }
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Double-click a Start to rename. Use the row buttons to adjust the timestamp or delete. Edits save to annotations.json; re-run normalization to apply downstream.";
  host.appendChild(hint);
  let depth = 0;
  for (const m of markers) {
    const row = document.createElement("div");
    const deleted = isDeletedMarker(m.event_id);
    row.className = "marker-row " + m.data.marker_type + (deleted ? " deleted" : "");
    if (m.data.marker_type === "end") depth = Math.max(0, depth - 1);
    const lbl = effectiveLabel(m) || "(unlabeled)";
    const editedNote = (getMarkerEdit(m.event_id) || effectiveTimestamp(m) !== m.timestamp)
      ? ' <span class="meta">· edited</span>' : '';
    const deletedNote = deleted ? ' <span class="meta bad">· deleted</span>' : '';
    row.innerHTML =
      '<span class="ts">' + escapeHtml(effectiveTimestamp(m).slice(11, 19)) + '</span>' +
      '<span class="dir">' + (m.data.marker_type === "start" ? "▶" : "■") + '</span>' +
      '<span class="lbl">' + escapeHtml(lbl) +
        (m.data.reason ? ' <span class="meta">(' + escapeHtml(m.data.reason) + ')</span>' : '') +
        editedNote + deletedNote +
      '</span>' +
      '<span class="depth">L' + depth + '</span>' +
      '<span class="marker-actions">' +
        '<button class="icon-btn xs" data-act="adjust" title="Adjust to current video time">◷</button>' +
        '<button class="icon-btn xs" data-act="delete" title="Delete marker (from normalization)">✕</button>' +
      '</span>';
    if (m.data.marker_type === "start") depth += 1;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".marker-actions")) return;
      seekToTimestamp(effectiveTimestamp(m));
    });
    if (m.data.marker_type === "start") {
      row.addEventListener("dblclick", async (e) => {
        if (e.target.closest(".marker-actions")) return;
        const current = effectiveLabel(m) || "";
        const next = await promptModal({ title: "Rename marker", message: "New label", defaultValue: current, okLabel: "Rename" });
        if (next == null || next.trim() === "" || next === current) return;
        await renameMarker(m, next.trim());
      });
    }
    row.querySelector('[data-act="adjust"]').addEventListener("click", () =>
      adjustMarkerToVideoTime(m));
    row.querySelector('[data-act="delete"]').addEventListener("click", () =>
      deleteMarker(m));
    host.appendChild(row);
  }
}

const DEFAULT_EDIT_TOPICS = ["steps", "phases", "timeline"];

async function persistAnnotations(anno, undoLabel, topics) {
  /* Step / phase / marker edits route through here: persist via the
     undo helper (so Ctrl+Z reverts) then emit the change topics so the
     affected views re-render themselves -- no full-session reload.
     `topics` defaults to the safe superset; marker edits pass a
     narrower set. */
  await saveAnnotationsWithUndo(anno, undoLabel || "marker edit");
  State.getSession().annotations = anno;
  State.batch(() => {
    for (const t of (topics || DEFAULT_EDIT_TOPICS)) State.emit(t);
  });
}

async function adjustMarkerToVideoTime(markerEvent) {
  if (!State.getSession()) return;
  const video = $("#video");
  const obsStartTs = videoStartTs();
  let newTs;
  if (obsStartTs && video && video.src) {
    newTs = new Date(new Date(obsStartTs).getTime() + (video.currentTime || 0) * 1000).toISOString();
  } else {
    const input = await promptModal({ title: "Adjust marker timestamp", message: "New ISO 8601 timestamp", detail: "e.g., 2026-05-14T09:23:11.482Z", defaultValue: effectiveTimestamp(markerEvent), okLabel: "Save" });
    if (!input) return;
    newTs = input.trim();
  }
  const anno = State.getSession().annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  anno.marker_edits.push({
    id: cryptoRandomId(),
    event_id: markerEvent.event_id,
    field: "timestamp",
    value: newTs,
    previous: markerEvent.timestamp,
    ts: new Date().toISOString(),
  });
  await persistAnnotations(anno, 'adjust marker timestamp', ["markers", "timeline"]);
  toast("Marker timestamp adjusted", "success");
}

async function deleteMarker(markerEvent) {
  if (!State.getSession()) return;
  const ok = await confirmModal({
    title: "Delete marker?",
    message: `Delete this ${markerEvent.data.marker_type} marker from normalization output?`,
    detail: "Raw events.jsonl is not touched; the delete is recorded in annotations.json. Ctrl+Z will restore it.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  const anno = State.getSession().annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  anno.marker_edits.push({
    id: cryptoRandomId(),
    event_id: markerEvent.event_id,
    op: "delete",
    ts: new Date().toISOString(),
  });
  await persistAnnotations(anno, 'delete marker', ["markers", "timeline"]);
  toast("Marker marked for deletion (re-run normalization)", "success");
}

async function renameMarker(markerEvent, newLabel) {
  if (!State.getSession()) return;
  const anno = State.getSession().annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  anno.marker_edits.push({
    id: cryptoRandomId(),
    event_id: markerEvent.event_id,
    field: "label",
    value: newLabel,
    previous: markerEvent.data.label,
    ts: new Date().toISOString(),
  });
  await ipcRenderer.invoke("viewer:saveAnnotations", {
    sessionFolder: State.getSession().sessionFolder,
    annotations: anno,
  });
  State.getSession().annotations = anno;
  renderMarkersList();
  renderTimeline(); // marker labels on the timeline pick up the edit
  toast("Marker renamed (re-run normalization to apply downstream)", "success");
}

/* ============ Aggregate view ====================================== */

async function openMultiFlow() {
  const folders = await ipcRenderer.invoke("viewer:openMultipleSessions");
  if (!folders || !folders.length) return;
  const sessions = await ipcRenderer.invoke("viewer:loadMultipleSessions", folders);
  State.setAggregateSessions(sessions.filter((s) => !s.error));
  $("#aggregate-empty").style.display = State.getAggregateSessions().length ? "none" : "";
  $("#aggregate-loaded").style.display = State.getAggregateSessions().length ? "" : "none";
  $("#btn-normalize-all").disabled = !State.getAggregateSessions().length;
  renderAggregate();
  if (State.getAggregateSessions().length) {
    toast(`Loaded ${State.getAggregateSessions().length} session(s)`, "success");
  }
}

$("#btn-open-multi-hero").addEventListener("click", openMultiFlow);
$("#btn-open-multi").addEventListener("click", openMultiFlow);

/* Aggregate "Analyze all" supports the same cancel flow as the
   single-session Analyze. Each per-session normalize registers the
   kill handle via onProc on the backend; clicking the inline Cancel
   button kills the in-flight child AND breaks the for loop so we
   don't continue to the next session. */
let _aggregateNormalizeCancelled = false;
const _btnNormalizeAllCancel = $("#btn-normalize-all-cancel");
if (_btnNormalizeAllCancel) {
  _btnNormalizeAllCancel.addEventListener("click", async () => {
    _aggregateNormalizeCancelled = true;
    await ipcRenderer.invoke("viewer:cancelNormalize");
    toast("Cancelling after current session...");
  });
}
$("#btn-normalize-all").addEventListener("click", async () => {
  if (!State.getAggregateSessions().length) return;
  _aggregateNormalizeCancelled = false;
  const btn = $("#btn-normalize-all");
  const originalLabel = btn.textContent;
  btn.disabled = true;
  const cancelBtn = $("#btn-normalize-all-cancel");
  if (cancelBtn) cancelBtn.style.display = "";
  let cancelled = false;
  let done = 0;
  const total = State.getAggregateSessions().length;
  for (const s of State.getAggregateSessions()) {
    if (_aggregateNormalizeCancelled) { cancelled = true; break; }
    // P2.11: per-iteration progress label so a long aggregate analyze
    // doesn't look frozen.
    btn.textContent = `Analyzing ${done + 1} / ${total}...`;
    const r = await ipcRenderer.invoke("viewer:runNormalize", {
      sessionFolder: s.sessionFolder,
      mine: true,
    });
    done++;
    if (r && r.cancelled) { cancelled = true; break; }
  }
  if (cancelBtn) cancelBtn.style.display = "none";
  btn.textContent = originalLabel;
  if (cancelled) {
    toast(`Cancelled after ${done} of ${total} session${total === 1 ? "" : "s"}.`);
    btn.disabled = false;
    return;
  }
  const folders = State.getAggregateSessions().map((s) => s.sessionFolder);
  State.setAggregateSessions(await ipcRenderer.invoke("viewer:loadMultipleSessions", folders));
  State.setAggregateSessions(State.getAggregateSessions().filter((s) => !s.error));
  renderAggregate();
  btn.disabled = false;
  toast("All sessions normalized + mined", "success");
});

$("#agg-filter").addEventListener("input", (e) => {
  State.setAggregateFilter((e.target.value || "").toLowerCase().trim());
  renderAggregate();
});
$("#agg-from").addEventListener("change", (e) => {
  State.setAggregateFromDate(e.target.value || "");
  renderAggregate();
});
$("#agg-to").addEventListener("change", (e) => {
  State.setAggregateToDate(e.target.value || "");
  renderAggregate();
});

function matchesFilter(text) {
  if (!State.getAggregateFilter()) return true;
  return String(text || "").toLowerCase().includes(State.getAggregateFilter());
}

function sessionInDateRange(s) {
  /* Use manifest.started_at against [from, to] inclusive when set.
     A session with no started_at is conservatively included. */
  if (!State.getAggregateFromDate() && !State.getAggregateToDate()) return true;
  const startedAt = (s.manifest || {}).started_at;
  if (!startedAt) return true;
  const day = startedAt.slice(0, 10); // YYYY-MM-DD
  if (State.getAggregateFromDate() && day < State.getAggregateFromDate()) return false;
  if (State.getAggregateToDate() && day > State.getAggregateToDate()) return false;
  return true;
}

function filteredAggregateSessions() {
  return State.getAggregateSessions().filter(sessionInDateRange);
}

function renderAggregate() {
  // Pills - count filtered + total
  const filtered = filteredAggregateSessions();
  const numNormalized = filtered.filter((s) => !!s.stats).length;
  const rangeNote = (State.getAggregateFromDate() || State.getAggregateToDate())
    ? ` (filtered from ${State.getAggregateSessions().length})` : "";
  $("#aggregate-pills").innerHTML =
    '<div class="pill ok"><span class="dot"></span><span class="lbl">sessions</span>' +
      filtered.length + escapeHtml(rangeNote) + '</div>' +
    '<div class="pill' + (numNormalized === filtered.length && filtered.length ? ' ok' : '') + '">' +
      '<span class="dot"></span><span class="lbl">normalized</span>' +
      numNormalized + ' / ' + filtered.length + '</div>';

  const allStats = filtered.map((s) => s.stats).filter(Boolean);
  if (!allStats.length) {
    $("#map-empty").style.display = "";
    $("#activity-chart").innerHTML = '<div class="chart-empty">no data</div>';
    $("#case-chart").innerHTML = '<div class="chart-empty">no data</div>';
    return;
  }
  $("#map-empty").style.display = "none";

  // P1.7: compute the wall-clock span across loaded sessions so we can
  // bucket sparkline data into 10 equal slices for each chart row.
  const sessionTimes = filtered
    .map((s) => (s.manifest && s.manifest.started_at) ? new Date(s.manifest.started_at).getTime() : null)
    .filter((t) => t != null && isFinite(t));
  const sparkSpan = sessionTimes.length
    ? { startMs: Math.min(...sessionTimes), endMs: Math.max(...sessionTimes) }
    : null;
  const SPARK_BUCKETS = 10;
  function bucketIdx(ms) {
    if (!sparkSpan || !isFinite(ms)) return -1;
    const sp = Math.max(1, sparkSpan.endMs - sparkSpan.startMs);
    return Math.min(SPARK_BUCKETS - 1, Math.max(0, Math.floor(((ms - sparkSpan.startMs) / sp) * SPARK_BUCKETS)));
  }

  // Merge activity stats
  const actMap = new Map();
  for (const st of allStats) {
    for (const r of (st.activity_stats || [])) {
      const e = actMap.get(r.activity_label) || {
        activity_label: r.activity_label, frequency: 0, total_duration_ms: 0,
        median_samples: [], p90_samples: [], sparkline: new Array(SPARK_BUCKETS).fill(0),
      };
      e.frequency += r.frequency;
      e.total_duration_ms += r.total_duration_ms;
      e.median_samples.push(r.median_ms);
      e.p90_samples.push(r.p90_ms);
      // Bucket this session's contribution by its started_at.
      const sessTs = ((st.meta || {}).session_started_at) ||
                     (filtered.find((s) => s.stats === st) && filtered.find((s) => s.stats === st).manifest && filtered.find((s) => s.stats === st).manifest.started_at);
      if (sessTs) {
        const idx = bucketIdx(new Date(sessTs).getTime());
        if (idx >= 0) e.sparkline[idx] += r.frequency;
      }
      actMap.set(r.activity_label, e);
    }
  }
  const actRows = [...actMap.values()]
    .filter((r) => matchesFilter(r.activity_label))
    .sort((a, b) => b.frequency - a.frequency);
  PdtCharts.renderBarChart($("#activity-chart"),
    actRows.map((r) => ({
      label: r.activity_label,
      value: r.frequency,
      valueLabel: r.frequency + " · " + PdtCharts.fmtDurationS(r.total_duration_ms / 1000),
      sparkline: sparkSpan ? r.sparkline : null,
    })),
    { unit: "" });

  // Case durations: bar chart, active duration with wall-clock overlay
  const caseRows = [];
  for (const st of allStats) {
    for (const r of (st.case_stats || [])) {
      if (r.parent_case_id) continue; // top-level only
      if (!matchesFilter(r.label || r.case_id)) continue;
      // Per-case sparkline: a single bin (the bucket containing this
      // case's start_time). Aggregated across the row gives a "when did
      // these cases happen" feel without needing per-event scan.
      let caseSpark = null;
      if (sparkSpan && r.start_time) {
        caseSpark = new Array(SPARK_BUCKETS).fill(0);
        const idx = bucketIdx(new Date(r.start_time).getTime());
        if (idx >= 0) caseSpark[idx] = 1;
      }
      caseRows.push({
        label: (r.label || r.case_id.slice(0, 8)),
        value: (r.active_ms || 0) / 1000,
        secondary: (r.wall_clock_ms || 0) / 1000,
        valueLabel: PdtCharts.fmtDurationS((r.active_ms || 0) / 1000),
        sparkline: caseSpark,
        meta: r,
      });
    }
  }
  caseRows.sort((a, b) => b.value - a.value);
  PdtCharts.renderBarChart($("#case-chart"), caseRows, {
    color: "var(--accent-2)",
    secondaryColor: "var(--warn)",
  });

  // Variants table -- with P2.2 frequency-heat bar inline. Each variant
  // row gets a visual bar showing how dominant it is relative to the
  // most-common variant; activities that appear at the same position
  // across MULTIPLE variants get a faint divergence highlight so the
  // analyst can spot where paths split.
  const varAgg = new Map();   // variantStr -> { freq, length, sessions }
  for (const st of allStats) {
    const sessId = ((st.meta || {}).session_id) || "?";
    for (const v of (st.trace_variants || [])) {
      const variantStr = v.variant.join(" → ");
      if (!matchesFilter(variantStr)) continue;
      const e = varAgg.get(variantStr) || { freq: 0, length: v.length, sessions: new Set() };
      e.freq += v.frequency;
      e.sessions.add(sessId);
      varAgg.set(variantStr, e);
    }
  }
  const varRows = Array.from(varAgg.entries())
    .map(([s, e]) => ({ variant: s, freq: e.freq, length: e.length, sessions: e.sessions.size }))
    .sort((a, b) => b.freq - a.freq);
  // Compute per-position activity sets across all variants for the
  // divergence highlight: position i is "divergent" if multiple
  // activities ever appear at position i across the loaded variants.
  const positionActivities = [];
  for (const r of varRows) {
    const acts = r.variant.split(" → ");
    acts.forEach((a, i) => {
      while (positionActivities.length <= i) positionActivities.push(new Set());
      positionActivities[i].add(a);
    });
  }
  function highlightDivergence(variant) {
    return variant.split(" → ").map((a, i) => {
      const div = positionActivities[i] && positionActivities[i].size > 1;
      return div ? '<span class="variant-div">' + escapeHtml(a) + '</span>'
                 : escapeHtml(a);
    }).join(' <span class="variant-arrow">→</span> ');
  }
  const variantHost = document.querySelector("#variants tbody") || $("#variants");
  if (variantHost) {
    if (!varRows.length) {
      // Clear stale rows from a previous render where variants existed.
      variantHost.innerHTML = '<tr><td colspan="3" style="color:var(--fg-3);font-style:italic;padding:8px">No variants — analyze sessions to populate.</td></tr>';
    } else {
      const maxFreq = varRows[0].freq;
      variantHost.innerHTML = varRows.slice(0, 80).map((r) => {
        const heatPct = Math.round((r.freq / maxFreq) * 100);
        return '<tr>' +
          '<td><div class="variant-heat" style="width:' + heatPct + '%"></div>' +
            '<span class="variant-freq">' + r.freq + '</span></td>' +
          '<td>' + r.length + '</td>' +
          '<td><span class="variant-sessions" title="' + r.sessions + ' session(s) follow this path">' +
            r.sessions + '×</span> ' + highlightDivergence(r.variant) +
          '</td>' +
          '</tr>';
      }).join("");
    }
  }

  // Variant data for the DFG variant-overlay (Phase E). Each variant is
  // an ordered activity list; the DFG renderer uses these to highlight
  // the paths through a hovered node.
  const variantsForDfg = varRows.slice(0, 80).map((r) => ({
    variant: r.variant.split(" → "),
    frequency: r.freq,
  }));

  // Outliers + rework
  const outRows = [];
  for (const st of allStats) {
    for (const r of (st.app_outliers || [])) {
      if (!matchesFilter(r.app)) continue;
      outRows.push([r.app, r.case_count, r.case_pct + "%"]);
    }
  }
  fillTable("#outliers", outRows);
  const reworkRows = [];
  for (const st of allStats) {
    for (const r of (st.rework_loops || [])) {
      if (!matchesFilter(r.activity_label)) continue;
      reworkRows.push([r.activity_label, r.rework_count]);
    }
  }
  fillTable("#rework", reworkRows);

  // BPMN + DFG render from the first available session
  const sessionWithBpmn = filtered.find((s) =>
    fs.existsSync(path.join(s.sessionFolder, "process_map.bpmn")));
  if (sessionWithBpmn && PdtBpmn) {
    PdtBpmn.render($("#bpmn-host"),
      path.join(sessionWithBpmn.sessionFolder, "process_map.bpmn"),
      { onNodeClick: (activityLabel) => drillToActivity(activityLabel) });
  }
  // Merge DFG edges across the filtered sessions
  const edgeMap = new Map();
  const starts = new Map();
  const ends = new Map();
  for (const s of filtered) {
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
  if (edgeMap.size && PdtDfg) {
    const dfg = {
      edges: [...edgeMap.entries()].map(([k, freq]) => {
        const [source, target] = k.split("\x00");
        return { source, target, frequency: freq };
      }),
      start_activities: Object.fromEntries(starts),
      end_activities: Object.fromEntries(ends),
    };
    PdtDfg.render($("#dfg-host"), dfg, {
      onNodeClick: (activityLabel, ev) => drillToActivity(activityLabel, ev),
      onZoomChange: (z) => setMapZoomPct(z),
      // Phase E: variant overlay. Hovering a node highlights the
      // session paths (variants) that pass through that activity.
      variants: variantsForDfg,
    });
    // Show zoom controls if the DFG tab is currently active
    const dfgTabActive = document.querySelector('.panel-tab.active')?.dataset.map === "dfg";
    setMapZoomVisible(dfgTabActive);
  }

  // Export buttons
  const firstWithBpmn = filtered.find((s) =>
    fs.existsSync(path.join(s.sessionFolder, "process_map.bpmn")));
  $("#btn-export-bpmn").disabled = !firstWithBpmn;
  $("#btn-export-xes").disabled = !filtered.find((s) =>
    fs.existsSync(path.join(s.sessionFolder, "events.xes")));
  $("#btn-export-stats").disabled = !allStats.length;
  $("#btn-export-md").disabled = !filtered.length;
  /* Taxonomy promotion is enabled when any normalized session has
     Unclassified activity labels in its stats. */
  $("#btn-export-promotions").disabled = !allStats.some((st) =>
    (st.activity_stats || []).some((r) => /^Unclassified/.test(r.activity_label || "")));

  // Phase E export buttons: enabled when at least one session has step data.
  const haveSteps = filtered.some((s) =>
    (s.annotations && (s.annotations.steps || []).length));
  if ($("#btn-export-bpmn-step"))  $("#btn-export-bpmn-step").disabled  = !haveSteps;
  if ($("#btn-export-bpmn-phase")) $("#btn-export-bpmn-phase").disabled = !haveSteps;
  if ($("#btn-export-pdd"))        $("#btn-export-pdd").disabled        = !haveSteps;
  if ($("#btn-export-step-csv"))   $("#btn-export-step-csv").disabled   = !haveSteps;

  // Version-spread banner
  const versions = new Set();
  for (const s of filtered) {
    const v = ((s.stats || {}).meta || {}).canonical_version;
    if (v != null) versions.add(v);
  }
  const banner = $("#agg-version-spread");
  if (banner) {
    if (versions.size > 1) {
      const latest = Math.max(...[...versions].filter(v => typeof v === "number"));
      banner.style.display = "";
      banner.innerHTML =
        `Loaded sessions span ${versions.size} canonical versions ` +
        `(${[...versions].join(", ")}). Statistics may be inconsistent. ` +
        `<button id="btn-renormalize-to-latest">Re-normalize all to v${latest}</button>`;
      const reBtn = $("#btn-renormalize-to-latest");
      if (reBtn) reBtn.addEventListener("click", () => $("#btn-renormalize-canonical").click());
    } else {
      banner.style.display = "none";
      banner.innerHTML = "";
    }
  }

  // Drift panel
  const driftPanel = $("#drift-panel");
  if (driftPanel) {
    const totalDrift = filtered.reduce((acc, s) =>
      acc + (((s.annotations || {}).drift_markers || []).length), 0);
    if (totalDrift > 0) {
      driftPanel.style.display = "";
      const rateRows = filtered.map((s) => ({
        folder: s.sessionFolder.split(/[\\/]/).pop(),
        match_rate: ((s.stats || {}).meta || {}).match_rate || 0,
        drift: ((s.annotations || {}).drift_markers || []).length,
      }));
      $("#drift-content").innerHTML = `
        <table class="stats-table">
          <thead><tr><th>session</th><th>match rate</th><th>drift markers</th></tr></thead>
          <tbody>
            ${rateRows.map(r => `<tr><td>${escapeHtml(r.folder)}</td>
              <td class="num">${Math.round((r.match_rate || 0) * 100)}%</td>
              <td class="num">${r.drift}</td></tr>`).join("")}
          </tbody>
        </table>`;
    } else {
      driftPanel.style.display = "none";
    }
  }
}

/* ============ Drill-down from aggregate to session ================ */

async function drillToActivity(activityLabel, fromEvent) {
  if (!activityLabel) return;
  // P1.5: collect every matching activity event across all loaded
  // sessions, not just the first session that mentions the label.
  // Single-result auto-picks; multi-result opens a picker so the
  // analyst can choose the moment they actually meant.
  const matches = [];
  for (const sess of State.getAggregateSessions()) {
    const stats = sess.stats;
    if (!stats) continue;
    const hit = (stats.activity_stats || []).find((r) => r.activity_label === activityLabel);
    if (!hit) continue;
    const ev = findFirstActivityByLabel(sess, activityLabel);
    if (!ev) continue;
    matches.push({
      sessionFolder: sess.sessionFolder,
      sessionName: sess.sessionFolder.split(/[\\/]/).pop(),
      timestamp: ev.timestamp,
      app: ev.data.app || "",
      title: ev.data.title || "",
    });
  }
  if (!matches.length) {
    toast("No loaded session contains " + activityLabel, "error");
    return;
  }
  if (matches.length === 1) {
    await _drillTo(matches[0], activityLabel);
    return;
  }
  showDfgDrillPicker(matches, activityLabel, fromEvent);
}

async function _drillTo(match, activityLabel) {
  activateTab("session");
  await loadSessionIntoView(match.sessionFolder);
  if (match.timestamp) {
    seekToTimestamp(match.timestamp);
    toast("Drilled to " + activityLabel + " in " + match.sessionName, "success");
  }
}

function showDfgDrillPicker(matches, activityLabel, fromEvent) {
  // Tear down any prior picker.
  const prior = document.getElementById("dfg-drill-picker");
  if (prior) prior.remove();

  const picker = document.createElement("div");
  picker.id = "dfg-drill-picker";
  picker.className = "dfg-drill-popup";
  // Position near the click if we have one, else center on viewer.
  let x = window.innerWidth / 2 - 200;
  let y = window.innerHeight / 2 - 100;
  if (fromEvent && typeof fromEvent.clientX === "number") {
    x = Math.min(fromEvent.clientX, window.innerWidth - 460);
    y = Math.min(fromEvent.clientY, window.innerHeight - 320);
  }
  picker.style.left = Math.max(8, x) + "px";
  picker.style.top  = Math.max(8, y) + "px";
  picker.innerHTML =
    matches.map((m, i) =>
      '<div class="row' + (i === 0 ? " sel" : "") + '" data-idx="' + i + '">' +
      '<span class="ts">' + new Date(m.timestamp).toLocaleString() + '</span>' +
      '<span class="name"><strong>' + escapeHtml(m.sessionName) + '</strong>' +
      (m.title ? ' — ' + escapeHtml(m.title) : '') + '</span>' +
      '</div>'
    ).join("");
  document.body.appendChild(picker);

  let selIdx = 0;
  function setSel(i) {
    selIdx = Math.max(0, Math.min(matches.length - 1, i));
    picker.querySelectorAll(".row").forEach((r, ri) => r.classList.toggle("sel", ri === selIdx));
  }
  function pick(i) {
    cleanup();
    _drillTo(matches[i], activityLabel);
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); cleanup(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel(selIdx + 1); }
    else if (e.key === "ArrowUp")   { e.preventDefault(); setSel(selIdx - 1); }
    else if (e.key === "Enter")     { e.preventDefault(); pick(selIdx); }
  }
  function onMouse(e) {
    if (!picker.contains(e.target)) cleanup();
  }
  function cleanup() {
    picker.remove();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onMouse, true);
  }
  picker.querySelectorAll(".row").forEach((r) => {
    r.addEventListener("click", () => pick(parseInt(r.dataset.idx, 10)));
    r.addEventListener("mouseenter", () => setSel(parseInt(r.dataset.idx, 10)));
  });
  document.addEventListener("keydown", onKey, true);
  setTimeout(() => document.addEventListener("mousedown", onMouse, true), 0);
}

function findFirstActivityByLabel(session, activityLabel) {
  /* Heuristic match: the label format from sample-taxonomy.yaml is
     usually "<Group> -- <App>" or similar. Pull the trailing token
     after "--" and match against event app strings. Best-effort. */
  if (!session || !session.events) return null;
  const tail = (activityLabel.split("--").pop() || "").trim().toLowerCase();
  for (const ev of session.events) {
    if (ev.type !== "activity") continue;
    const app = (ev.data.app || "").toLowerCase();
    const title = (ev.data.title || "").toLowerCase();
    if (tail && (app.includes(tail) || title.includes(tail))) return ev;
  }
  // Fallback: just the first activity event
  return session.events.find((e) => e.type === "activity") || null;
}

/* ============ Exports ============================================= */

$("#btn-export-bpmn").addEventListener("click", () => exportFirst("process_map.bpmn"));
$("#btn-export-xes").addEventListener("click", () => exportFirst("events.xes"));
$("#btn-export-stats").addEventListener("click", () => exportFirst("stats.json"));

/* Phase F: export the active process-map (BPMN diagram or Flow
   diagram) as an SVG -- the format Figma / Lucidchart / browsers all
   import. Picks the renderer for whichever map tab is showing. */
if ($("#btn-export-map-svg")) {
  $("#btn-export-map-svg").addEventListener("click", async () => {
    const activeTab = document.querySelector(".panel-tab.active[data-map]");
    const which = activeTab ? activeTab.dataset.map : "bpmn";
    let svg = null;
    if (which === "dfg" && PdtDfg && PdtDfg.exportSvg) {
      svg = PdtDfg.exportSvg();
    } else if (PdtBpmn && PdtBpmn.exportSvg) {
      svg = await PdtBpmn.exportSvg();
    }
    if (!svg) {
      toast("No process map to export — analyze sessions first.", "error");
      return;
    }
    const r = await ipcRenderer.invoke("viewer:saveSvgFile", {
      content: svg,
      suggestedName: (which === "dfg" ? "flow-diagram" : "process-diagram") + ".svg",
    });
    if (r && r.ok) toast("Process map exported to " + r.path, "success");
    else if (r && r.error) toast("Export failed: " + r.error, "error");
  });
}

$("#btn-export-md").addEventListener("click", async () => {
  if (!PdtReport) return;
  const filtered = filteredAggregateSessions();
  if (!filtered.length) return;
  /* Re-merge activity stats and cases across the filtered set so the
     report matches what the panels show. */
  const actMap = new Map();
  for (const s of filtered) {
    for (const r of ((s.stats || {}).activity_stats || [])) {
      const e = actMap.get(r.activity_label) || { activity_label: r.activity_label, frequency: 0, total_duration_ms: 0 };
      e.frequency += r.frequency;
      e.total_duration_ms += r.total_duration_ms;
      actMap.set(r.activity_label, e);
    }
  }
  const mergedActivity = [...actMap.values()].sort((a, b) => b.frequency - a.frequency);
  const mergedCases = [];
  for (const s of filtered) {
    for (const r of ((s.stats || {}).case_stats || [])) {
      if (!r.parent_case_id) mergedCases.push(r);
    }
  }
  mergedCases.sort((a, b) => (b.active_ms || 0) - (a.active_ms || 0));
  const edgeMap = new Map();
  for (const s of filtered) {
    for (const e of ((s.dfg || {}).edges || [])) {
      const k = e.source + "\x00" + e.target;
      edgeMap.set(k, (edgeMap.get(k) || 0) + (e.frequency || 1));
    }
  }
  const dfg = { edges: [...edgeMap.entries()].map(([k, freq]) => {
    const [source, target] = k.split("\x00");
    return { source, target, frequency: freq };
  })};
  const md = PdtReport.buildAggregateReport(filtered, mergedActivity, mergedCases, dfg);
  await saveMarkdownReport(md, "aggregate-report.md");
});

$("#btn-session-md").addEventListener("click", async () => {
  if (!State.getSession() || !PdtReport) return;
  const md = PdtReport.buildSessionReport(State.getSession());
  const name = "session-" + (State.getSession().sessionFolder.split(/[\\/]/).slice(-1)[0] || "report") + ".md";
  await saveMarkdownReport(md, name);
});

async function saveMarkdownReport(md, suggestedName) {
  /* Write into a temp file, then ask main.js to copy it via the
     export-file dialog so the user picks the destination. */
  const tmpDir = require("os").tmpdir();
  const tmpPath = path.join(tmpDir, "pdt-" + Date.now() + "-" + suggestedName);
  fs.writeFileSync(tmpPath, md, "utf-8");
  const out = await ipcRenderer.invoke("viewer:exportFile", {
    sourcePath: tmpPath,
    suggestedName,
  });
  if (out) {
    await ipcRenderer.invoke("viewer:revealFile", out);
    toast("Markdown report saved: " + path.basename(out), "success");
  }
  try { fs.unlinkSync(tmpPath); } catch (_) {}
}

$("#btn-export-promotions").addEventListener("click", async () => {
  /* Taxonomy promotion (§13). Walk normalized sessions for events
     classified as "Unclassified - <app>". Emit a YAML stub with one
     rule per unique app, ready for the analyst to refine and append
     to the central taxonomy. */
  const filtered = filteredAggregateSessions();
  const apps = new Map(); // app -> { firstTitle, count }
  for (const sess of filtered) {
    for (const ev of (sess.events || [])) {
      if (ev.type !== "activity") continue;
      const label = ev.data.activity_label || "";
      if (!/^Unclassified/.test(label)) continue;
      const app = ev.data.app || "unknown";
      const entry = apps.get(app) || { firstTitle: ev.data.title || "", count: 0 };
      entry.count += 1;
      apps.set(app, entry);
    }
  }
  /* Also include unclassified activity_stats entries (which may be the
     only signal if events aren't loaded for older sessions). */
  for (const sess of filtered) {
    for (const r of (((sess.stats || {}).activity_stats) || [])) {
      if (!/^Unclassified/.test(r.activity_label || "")) continue;
      const app = (r.activity_label.split("-").pop() || "").trim();
      if (!apps.has(app)) apps.set(app, { firstTitle: "", count: r.frequency || 0 });
    }
  }
  if (!apps.size) {
    toast("No Unclassified activities found in the loaded sessions", "");
    return;
  }
  const sorted = [...apps.entries()].sort((a, b) => b[1].count - a[1].count);
  const lines = [
    "# Taxonomy promotion candidates",
    "# Generated by Process Discovery Viewer on " + new Date().toISOString(),
    "# Each `label` below is prefixed with [REVIEW] — replace the bracketed prefix",
    "# with the final activity name before appending to the central taxonomy YAML.",
    "# Refine `title_regex` for stricter matching and add `extract` rules where useful.",
    "",
    "rules:",
  ];
  for (const [app, info] of sorted) {
    lines.push("  - match:");
    lines.push("      app: \"" + app.replace(/"/g, "\\\"") + "\"");
    lines.push("      title_regex: \".*\"");
    lines.push("    label: \"[REVIEW] " + app.replace(/"/g, "\\\"") + "\"  # " + info.count + " unclassified events" +
      (info.firstTitle ? "; sample title: " + JSON.stringify(info.firstTitle.slice(0, 60)) : ""));
  }
  const yaml = lines.join("\n") + "\n";
  const tmpDir = require("os").tmpdir();
  const tmpPath = path.join(tmpDir, "pdt-" + Date.now() + "-taxonomy-promotions.yaml");
  fs.writeFileSync(tmpPath, yaml, "utf-8");
  const out = await ipcRenderer.invoke("viewer:exportFile", {
    sourcePath: tmpPath,
    suggestedName: "taxonomy-promotions.yaml",
  });
  if (out) {
    await ipcRenderer.invoke("viewer:revealFile", out);
    toast(`Promoted ${sorted.length} app(s) as taxonomy candidates`, "success");
  }
  try { fs.unlinkSync(tmpPath); } catch (_) {}
});

async function exportFirst(filename) {
  const s = State.getAggregateSessions().find((x) =>
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
  // Esc closes the help modal regardless of focus, since the modal
  // captures itself rather than the input fields beneath it.
  if (e.key === "Escape" && $("#help-modal").style.display !== "none") {
    closeHelp();
    e.preventDefault();
    return;
  }
  // Don't intercept other shortcuts while typing in inputs
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;

  // Undo / redo apply to any view as long as a session is loaded.
  // Ctrl+Z = undo, Ctrl+Shift+Z (or Ctrl+Y) = redo.
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      performUndo();
      return;
    }
    if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      performRedo();
      return;
    }
  }

  if (e.key === "?" || (e.shiftKey && e.key === "/")) {
    openHelp();
    e.preventDefault();
    return;
  }
  if (e.key === "1") activateTab("session");
  else if (e.key === "2") activateTab("aggregate");
  else if (e.key === "3") activateTab("canonical");
  else if (e.key === "4") activateTab("vocabularies");
  // Step editor shortcuts (only when on session view and steps panel)
  else if (State.getLevel() === "steps" && State.getSession()) {
    const steps = (State.getSession().annotations && State.getSession().annotations.steps) || [];
    if (e.key === "j" || e.key === "ArrowDown") {
      const idx = steps.findIndex(s => s.step_id === State.getSelectedStepId());
      if (idx < steps.length - 1) { State.setSelectedStepId(steps[Math.max(0, idx + 1)].step_id); renderStepsLevel(); e.preventDefault(); }
    } else if (e.key === "k" || e.key === "ArrowUp") {
      const idx = steps.findIndex(s => s.step_id === State.getSelectedStepId());
      if (idx > 0) { State.setSelectedStepId(steps[idx - 1].step_id); renderStepsLevel(); e.preventDefault(); }
    } else if (e.key === "n") {
      addManualStep(); e.preventDefault();
    } else if (e.key === "s") {
      if (State.getSelectedStepId()) { splitStep(State.getSelectedStepId()); e.preventDefault(); }
    } else if (e.key === "m") {
      if (State.getSelectedStepId()) { mergeStepWithNext(State.getSelectedStepId()); e.preventDefault(); }
    }
  }
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
      State.setZoomFactor(State.getZoomFactor() * 1.5); renderTimeline();
    }
  } else if (e.key === "-" || e.key === "_") {
    if ($("#view-session").classList.contains("active")) {
      State.setZoomFactor(Math.max(1, State.getZoomFactor() / 1.5)); renderTimeline();
    }
  } else if (e.key === "0") {
    if ($("#view-session").classList.contains("active")) {
      State.setZoomFactor(1); renderTimeline();
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

/* ============ Help modal ========================================== */

function openHelp(section) {
  $("#help-modal").style.display = "";
  if (section) selectHelpSection(section);
}
function closeHelp() { $("#help-modal").style.display = "none"; }
function selectHelpSection(name) {
  $$(".help-nav-item").forEach((b) => b.classList.toggle("active", b.dataset.section === name));
  $$(".help-section").forEach((s) => s.classList.toggle("active", s.dataset.section === name));
}
$("#btn-help").addEventListener("click", () => openHelp());
/* Inline "What is a step?" / "What is a phase?" links in the toolbar
   open the help modal at the right section. */
document.addEventListener("click", (e) => {
  const t = e.target.closest && e.target.closest(".link-help");
  if (!t) return;
  e.preventDefault();
  openHelp(t.dataset.helpSection || "stepsphases");
});
$("#btn-help-close").addEventListener("click", closeHelp);
$$(".help-nav-item").forEach((b) =>
  b.addEventListener("click", () => selectHelpSection(b.dataset.section))
);
$("#help-modal").addEventListener("click", (e) => {
  if (e.target.id === "help-modal") closeHelp();
});

/* ============ Boot ================================================ */

renderRecent();
$("#topbar-meta").textContent = "v0.2 · " + new Date().toLocaleDateString();

/* If launched with --session=<path>, the main process pushes the path
   via this channel. Open it without any further user click. */
ipcRenderer.on("viewer:openInitialSession", (_e, folder) => {
  if (folder) loadSessionIntoView(folder);
});

/* ============ Vocabularies tab (form editor, no YAML) ============= */


async function reloadVocabList() {
  const r = await ipcRenderer.invoke("viewer:listAppVocabs");
  State.getVocabState().list = (r && r.vocabs) || [];
  const meta = $("#vocab-list-meta");
  if (meta) {
    if (State.getVocabState().list.length) {
      meta.textContent = State.getVocabState().list.length + " vocab(s) across " + ((r.dirs || []).length) + " folder(s)";
    } else {
      meta.textContent = "no vocabularies yet";
    }
  }
  renderVocabList();
  if (State.getVocabState().selectedPath && !State.getVocabState().list.some(v => v.path === State.getVocabState().selectedPath)) {
    State.getVocabState().selectedPath = null;
    State.getVocabState().current = null;
    renderVocabEditor();
  } else if (State.getVocabState().selectedPath) {
    await selectVocab(State.getVocabState().selectedPath);
  } else {
    renderVocabEditor();
  }
}

function renderVocabList() {
  const host = $("#vocab-list");
  if (!host) return;
  if (!State.getVocabState().list.length) {
    host.innerHTML =
      '<div class="empty-pane">' +
      '<p><strong>No vocabularies yet.</strong></p>' +
      '<p>Two ways to start:</p>' +
      '<ol>' +
      '<li>Click <strong>+ New vocabulary</strong> above to start an empty one.</li>' +
      '<li>Capture a prep session from the tracker tray (<em>Start app vocabulary prep session...</em>), then bootstrap from it.</li>' +
      '</ol>' +
      '</div>';
    return;
  }
  host.innerHTML = "";
  for (const v of State.getVocabState().list) {
    const row = document.createElement("div");
    row.className = "vocab-row" + (v.path === State.getVocabState().selectedPath ? " selected" : "");
    row.innerHTML =
      '<div class="vocab-row-head">' +
      '<span class="vocab-row-name">' + escapeHtml(v.name || v.id) + '</span>' +
      '<span class="vocab-row-count">' + v.interaction_count + '</span>' +
      '</div>' +
      '<div class="vocab-row-meta">' + escapeHtml(v.id) + ' · v' + v.version + ' · ' + escapeHtml(v.file) + '</div>';
    row.addEventListener("click", () => selectVocab(v.path));
    host.appendChild(row);
  }
}

async function selectVocab(p) {
  if (State.getVocabState().dirty) {
    const ok = await confirmModal({
      title: "Unsaved changes",
      message: "Discard unsaved changes to this vocabulary?",
      okLabel: "Discard",
      danger: true,
    });
    if (!ok) return;
  }
  State.getVocabState().selectedPath = p;
  State.getVocabState().dirty = false;
  const v = await ipcRenderer.invoke("viewer:readVocab", p);
  if (!v) {
    State.getVocabState().current = null;
    toast("Could not read vocab file", "error");
  } else if (v._error) {
    State.getVocabState().current = null;
    toast("Vocab YAML parse error: " + v._error, "error");
  } else {
    State.getVocabState().current = v;
  }
  renderVocabList();
  renderVocabEditor();
  const btn = $("#btn-vocab-open-yaml");
  if (btn) btn.disabled = !p;
}

function renderVocabEditor() {
  const host = $("#vocab-editor");
  if (!host) return;
  const v = State.getVocabState().current;
  if (!v) {
    host.innerHTML =
      '<div class="empty-pane">' +
      '<p>Pick a vocabulary on the left to edit it, or click <strong>+ New vocabulary</strong> above to create one.</p>' +
      '<p class="meta">The editor renders the YAML as a form. The underlying file is rewritten on save; you can also edit the YAML directly with <em>Open YAML in editor</em>.</p>' +
      '</div>';
    return;
  }
  const interactions = v.interactions || [];
  const scope = v.scope || {};
  host.innerHTML =
    '<div class="vocab-head">' +
    '<label>Display name<input type="text" id="vocab-name" value="' + escapeAttr(v.name || "") + '" placeholder="e.g., Salesforce"></label>' +
    '<label>Internal id<input type="text" id="vocab-id" value="' + escapeAttr(v.id || "") + '" placeholder="salesforce"></label>' +
    '<label>Version<input type="number" id="vocab-version" value="' + escapeAttr(v.version || 1) + '" min="1" step="1"></label>' +
    '</div>' +
    '<div class="vocab-head">' +
    '<label>Scope: process name (.exe)<input type="text" id="vocab-scope-proc" value="' + escapeAttr(scope.process_name || "") + '" placeholder="chrome.exe"></label>' +
    '<label>Scope: window title regex (optional)<input type="text" id="vocab-scope-title" value="' + escapeAttr(scope.window_title_regex || "") + '" placeholder=".*Salesforce.*"></label>' +
    '</div>' +
    '<div class="vocab-toolbar">' +
    '<strong>Interactions (' + interactions.length + ')</strong>' +
    '<span class="flex-spacer"></span>' +
    '<button id="btn-vocab-add-interaction">+ Add interaction</button>' +
    '<button id="btn-vocab-save" class="primary">Save vocabulary</button>' +
    '</div>' +
    '<div id="vocab-interactions"></div>';
  renderVocabInteractions();
  $("#vocab-name").addEventListener("input", markDirty);
  $("#vocab-id").addEventListener("input", markDirty);
  $("#vocab-version").addEventListener("input", markDirty);
  $("#vocab-scope-proc").addEventListener("input", markDirty);
  $("#vocab-scope-title").addEventListener("input", markDirty);
  $("#btn-vocab-add-interaction").addEventListener("click", addInteraction);
  $("#btn-vocab-save").addEventListener("click", saveVocab);
}

function renderVocabInteractions() {
  const host = $("#vocab-interactions");
  if (!host) return;
  const interactions = (State.getVocabState().current && State.getVocabState().current.interactions) || [];
  if (!interactions.length) {
    host.innerHTML = '<p class="hint">No interactions yet. Click + Add interaction, or bootstrap from a prep session in the tracker tray.</p>';
    return;
  }
  host.innerHTML = "";
  for (let i = 0; i < interactions.length; i++) {
    const ent = interactions[i];
    const sig = ent.signature || {};
    const flags = ent.flags || {};
    const sigParts = [sig.control_type, sig.automation_id, sig.name].filter(Boolean);
    const sigSummary = sigParts.length ? sigParts.join(" · ") : "(unset signature)";
    const row = document.createElement("div");
    row.className = "vocab-int";
    row.dataset.idx = String(i);
    row.innerHTML =
      '<div class="vocab-int-head">' +
      '<span class="vocab-int-num">' + (i + 1) + '</span>' +
      '<div class="vocab-int-sig">' + escapeHtml(sigSummary) + '</div>' +
      '<button class="icon-btn vocab-int-remove" title="Remove">✕</button>' +
      '</div>' +
      '<div class="vocab-int-body">' +
      '<label>Meaningful name<input type="text" data-field="name" value="' + escapeAttr(ent.name || "") + '" placeholder="e.g., Search customer record"></label>' +
      '<div class="vocab-int-sig-fields">' +
      '<label>control_type<input type="text" data-sig="control_type" value="' + escapeAttr(sig.control_type || "") + '"></label>' +
      '<label>automation_id<input type="text" data-sig="automation_id" value="' + escapeAttr(sig.automation_id || "") + '"></label>' +
      '<label>name (raw)<input type="text" data-sig="name" value="' + escapeAttr(sig.name || "") + '"></label>' +
      '<label>window_title_regex<input type="text" data-sig="window_title_regex" value="' + escapeAttr(sig.window_title_regex || "") + '"></label>' +
      '</div>' +
      '</div>';
    row.querySelector(".vocab-int-remove").addEventListener("click", () => removeInteraction(i));
    row.querySelectorAll("[data-field], [data-sig], [data-flag]").forEach(el => {
      el.addEventListener("input", collectAndMark);
      el.addEventListener("change", collectAndMark);
    });
    host.appendChild(row);
  }
}

function collectAndMark() {
  const v = State.getVocabState().current;
  if (!v) return;
  v.name = $("#vocab-name").value.trim();
  v.id = $("#vocab-id").value.trim();
  v.version = parseInt($("#vocab-version").value, 10) || 1;
  v.scope = v.scope || {};
  const proc = $("#vocab-scope-proc").value.trim();
  const titleR = $("#vocab-scope-title").value.trim();
  if (proc) v.scope.process_name = proc; else delete v.scope.process_name;
  if (titleR) v.scope.window_title_regex = titleR; else delete v.scope.window_title_regex;
  const rows = document.querySelectorAll("#vocab-interactions .vocab-int");
  v.interactions = [];
  rows.forEach(row => {
    const sig = {};
    row.querySelectorAll("[data-sig]").forEach(el => {
      const k = el.dataset.sig;
      const val = el.value.trim();
      if (val) sig[k] = val;
    });
    const ent = {
      signature: sig,
      name: row.querySelector('[data-field="name"]').value.trim() || "",
    };
    const flags = {};
    row.querySelectorAll("[data-flag]").forEach(el => {
      if (el.checked) flags[el.dataset.flag] = true;
    });
    if (Object.keys(flags).length) ent.flags = flags;
    v.interactions.push(ent);
  });
  markDirty();
}

function markDirty() {
  State.getVocabState().dirty = true;
  const btn = $("#btn-vocab-save");
  if (btn) btn.textContent = "Save vocabulary*";
}

function addInteraction() {
  const v = State.getVocabState().current;
  if (!v) return;
  v.interactions = v.interactions || [];
  v.interactions.push({ signature: { control_type: "Button", name: "" }, name: "" });
  renderVocabInteractions();
  markDirty();
}

function removeInteraction(idx) {
  const v = State.getVocabState().current;
  if (!v) return;
  v.interactions.splice(idx, 1);
  renderVocabInteractions();
  markDirty();
}

async function saveVocab() {
  if (!State.getVocabState().selectedPath || !State.getVocabState().current) return;
  collectAndMark();
  const r = await ipcRenderer.invoke("viewer:writeVocab", {
    path: State.getVocabState().selectedPath,
    vocab: State.getVocabState().current,
  });
  if (!r || !r.ok) {
    toast("Save failed: " + ((r && r.error) || "unknown"), "error");
    return;
  }
  State.getVocabState().dirty = false;
  const btn = $("#btn-vocab-save");
  if (btn) btn.textContent = "Save vocabulary";
  toast("App Library entry saved — re-analyze any session to apply", "success");
  reloadVocabList();
}

if ($("#btn-vocab-new")) {
  $("#btn-vocab-new").addEventListener("click", async () => {
    const name = await promptModal({ title: "New App Library entry", message: "Which app is this entry for?", placeholder: "e.g., Salesforce", okLabel: "Create" });
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const p = await ipcRenderer.invoke("viewer:newVocabFile", { suggestedId: id });
    if (!p) return;
    await reloadVocabList();
    await selectVocab(p);
    toast("New App Library entry created — fill in interactions in plain English and save", "success");
  });
}
if ($("#btn-vocab-reload")) {
  $("#btn-vocab-reload").addEventListener("click", reloadVocabList);
}
if ($("#btn-vocab-open-yaml")) {
  $("#btn-vocab-open-yaml").addEventListener("click", () => {
    if (State.getVocabState().selectedPath) ipcRenderer.invoke("viewer:openVocabFile", State.getVocabState().selectedPath);
  });
}

/* ============ Attach external video (Teams recording, etc.) ======= */

function parseHmsToMs(s) {
  if (typeof s !== "string") return null;
  s = s.trim();
  const sign = s.startsWith("-") ? -1 : 1;
  if (s.startsWith("-") || s.startsWith("+")) s = s.slice(1);
  const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const ms = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000
           + (m[4] ? Number(m[4].padEnd(3, "0").slice(0, 3)) : 0);
  return sign * ms;
}

async function attachExternalVideo() {
  if (!State.getSession()) return;
  const r = await ipcRenderer.invoke("viewer:attachExternalVideo", {
    sessionFolder: State.getSession().sessionFolder,
  });
  if (!r) return;
  const m = State.getSession().manifest || {};
  const started_at = m.started_at;
  if (!started_at) {
    toast("Session manifest has no started_at; can't compute video offset", "error");
    return;
  }
  const ans = await promptModal({
    title: "Align video to session",
    message: "When did the recording start, relative to the session?",
    detail: "Session started at " + started_at + ". Format HH:MM:SS, signed (-00:00:05 means recording started 5 sec before the session).",
    placeholder: "00:00:00",
    defaultValue: "00:00:00",
    okLabel: "Attach"
  });
  if (ans == null) return;
  const offsetMs = parseHmsToMs(ans);
  if (offsetMs === null) {
    toast("Couldn't parse offset; try 00:00:05 or -00:01:30", "error");
    return;
  }
  const saved = await ipcRenderer.invoke("viewer:saveExternalVideoSync", {
    sessionFolder: State.getSession().sessionFolder,
    videoPath: r.path,
    offsetMs,
  });
  if (!saved || !saved.ok) {
    toast("Video attach failed: " + ((saved && saved.error) || "unknown"), "error");
    return;
  }
  toast("Video attached - reloading session", "success");
  await loadSessionIntoView(State.getSession().sessionFolder);
}

if ($("#btn-attach-video")) {
  $("#btn-attach-video").addEventListener("click", attachExternalVideo);
}

/* ============ promptModal: a working replacement for window.prompt
   ================================================================
   Electron's renderer ships without a working prompt() implementation;
   calling it silently returns undefined, which is why "Add manual step"
   and "Group into phase" felt broken. This is a real inline modal that
   resolves to the typed string (or null on cancel/escape). */

function promptModal(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop modal-prompt";
    const okLabel = opts.okLabel || "OK";
    const cancelLabel = opts.cancelLabel || "Cancel";
    backdrop.innerHTML =
      '<div class="modal modal-sm">' +
      '<header class="modal-header"><h2>' + escapeHtml(opts.title || "Input") + '</h2>' +
      '<button class="icon-btn modal-close" title="Cancel (Esc)">✕</button></header>' +
      '<div class="modal-body">' +
      (opts.message ? '<p class="modal-msg">' + escapeHtml(opts.message) + '</p>' : '') +
      (opts.detail ? '<p class="modal-detail">' + escapeHtml(opts.detail) + '</p>' : '') +
      '<input type="text" class="modal-input" ' +
      ' placeholder="' + escapeAttr(opts.placeholder || "") + '" ' +
      ' value="' + escapeAttr(opts.defaultValue || "") + '">' +
      '</div>' +
      '<footer class="modal-footer">' +
      '<button class="modal-cancel">' + escapeHtml(cancelLabel) + '</button>' +
      '<button class="primary modal-ok">' + escapeHtml(okLabel) + '</button>' +
      '</footer>' +
      '</div>';
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector(".modal-input");
    const okBtn = backdrop.querySelector(".modal-ok");
    const cancelBtn = backdrop.querySelector(".modal-cancel");
    const closeBtn = backdrop.querySelector(".modal-close");
    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      resolve(value);
    }
    okBtn.addEventListener("click", () => done(input.value));
    cancelBtn.addEventListener("click", () => done(null));
    closeBtn.addEventListener("click", () => done(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) done(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(input.value); }
      else if (e.key === "Escape") { e.preventDefault(); done(null); }
    });
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

/* ============ confirmModal: themed replacement for window.confirm
   ================================================================
   Browser-native confirm() dialogs look unstyled and out of place
   against the app theme, and corp users find them indistinguishable
   from a phishing popup. confirmModal() takes the same structural
   opts as promptModal and resolves to true/false. Supports custom
   button labels + a `danger` flag that styles the primary action
   for destructive operations (red instead of accent). */

function confirmModal(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop modal-confirm";
    const okLabel = opts.okLabel || "OK";
    const cancelLabel = opts.cancelLabel || "Cancel";
    const okClass = opts.danger ? "danger" : "primary";
    backdrop.innerHTML =
      '<div class="modal modal-sm">' +
      '<header class="modal-header"><h2>' + escapeHtml(opts.title || "Confirm") + '</h2>' +
      '<button class="icon-btn modal-close" title="Cancel (Esc)">✕</button></header>' +
      '<div class="modal-body">' +
      (opts.message ? '<p class="modal-msg">' + escapeHtml(opts.message) + '</p>' : '') +
      (opts.detail ? '<p class="modal-detail">' + escapeHtml(opts.detail) + '</p>' : '') +
      '</div>' +
      '<footer class="modal-footer">' +
      '<button class="modal-cancel">' + escapeHtml(cancelLabel) + '</button>' +
      '<button class="' + okClass + ' modal-ok">' + escapeHtml(okLabel) + '</button>' +
      '</footer>' +
      '</div>';
    document.body.appendChild(backdrop);
    const okBtn = backdrop.querySelector(".modal-ok");
    const cancelBtn = backdrop.querySelector(".modal-cancel");
    const closeBtn = backdrop.querySelector(".modal-close");
    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    }
    function onKey(e) {
      if (e.key === "Enter") { e.preventDefault(); done(true); }
      else if (e.key === "Escape") { e.preventDefault(); done(false); }
    }
    okBtn.addEventListener("click", () => done(true));
    cancelBtn.addEventListener("click", () => done(false));
    closeBtn.addEventListener("click", () => done(false));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) done(false);
    });
    document.addEventListener("keydown", onKey);
    // Focus the default action so Enter/Space confirms.
    setTimeout(() => { (opts.danger ? cancelBtn : okBtn).focus(); }, 0);
  });
}

/* ============ Project / engagement wiring (P2.1) ==================
   A project bundles aggregate sessions, the current focus session, the
   active process template, view mode, case scope, and (forward-
   compatible) vocabularies into a single re-loadable file. The data
   layer lives in viewer/project.js; this block snapshots / restores
   the live state and wires the topbar UI. */

const PdtProject = require("./project.js");

const projectCollectors = {
  currentSessionFolder: () => State.getSession() && State.getSession().sessionFolder,
  aggregateSessions:    () => (State.getAggregateSessions() || []).map((s) => s && s.sessionFolder).filter(Boolean),
  templatePath:         () => State.getCanonicalState() && State.getCanonicalState().path,
  vocabularies:         () => [],   // captured by path on a future project-format bump
  currentTab:           () => {
    const t = document.querySelector(".tab.active");
    return t ? t.dataset.view : "session";
  },
  viewMode:             () => State.getLevel(),
  currentCaseScope:     () => State.getCaseScope() || null,
  timeline: () => {
    const scroll = document.getElementById("timeline-scroll");
    return {
      zoomFactor: State.getZoomFactor(),
      scrollLeft: scroll ? scroll.scrollLeft : 0,
    };
  },
};

function updateProjectMenuLabel() {
  const lbl = document.getElementById("project-menu-label");
  const btn = document.getElementById("btn-project-menu");
  const saveItem = document.getElementById("btn-project-save");
  const closeItem = document.getElementById("btn-project-close");
  const proj = PdtProject.activeProject();
  if (proj && proj.path) {
    if (lbl) lbl.textContent = proj.name || path.basename(proj.path, ".pdt-project.json");
    if (btn) btn.classList.add("has-project");
    if (saveItem) saveItem.style.display = "";
    if (closeItem) closeItem.style.display = "";
  } else {
    if (lbl) lbl.textContent = "No project";
    if (btn) btn.classList.remove("has-project");
    if (saveItem) saveItem.style.display = "none";
    if (closeItem) closeItem.style.display = "none";
  }
}

document.addEventListener("pdt:projectChanged", updateProjectMenuLabel);

function toggleProjectMenu(force) {
  const popup = document.getElementById("project-menu-popup");
  if (!popup) return;
  const open = force === undefined ? popup.style.display === "none" : !!force;
  popup.style.display = open ? "" : "none";
}

(function wireProjectMenu() {
  const btn = document.getElementById("btn-project-menu");
  const popup = document.getElementById("project-menu-popup");
  if (!btn || !popup) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleProjectMenu();
  });
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== btn) toggleProjectMenu(false);
  });
})();

/* ===== Recent dropdown (top-bar) =====
   Recent sessions + projects were only reachable from the Session
   empty-state, which disappears once a session loads. This top-bar
   menu makes them reachable any time. */
function renderRecentMenu() {
  const host = document.getElementById("recent-menu-content");
  if (!host) return;
  let html = "";
  // Recent projects.
  const projects = (typeof PdtProject !== "undefined") ? PdtProject.getRecentProjects() : [];
  if (projects.length) {
    html += '<div class="recent-menu-heading">Recent projects</div>';
    html += projects.map((p) => {
      let missing = false;
      try { missing = !fs.existsSync(p.path); } catch (_) { missing = true; }
      return '<button class="recent-menu-item' + (missing ? " missing" : "") + '" ' +
        'data-kind="project" data-path="' + escapeHtml(p.path) + '">' +
        '<span class="ri-label">' + escapeHtml(p.name || path.basename(p.path)) + '</span>' +
        '<span class="ri-tag">' + (missing ? "missing" : "project") + '</span>' +
        '</button>';
    }).join("");
  }
  // Recent sessions + bundled examples.
  const recents = getRecent();
  const hidden = getHiddenExamples();
  const examples = listBundledExamples().filter((e) => !hidden.has(e.folder));
  const sessions = recents.concat(examples);
  if (sessions.length) {
    html += '<div class="recent-menu-heading">Recent sessions</div>';
    html += sessions.map((r) => {
      let missing = false;
      try { missing = !fs.existsSync(r.folder); } catch (_) { missing = true; }
      const label = r.label || path.basename(r.folder);
      return '<button class="recent-menu-item' + (missing ? " missing" : "") + '" ' +
        'data-kind="session" data-folder="' + escapeHtml(r.folder) + '">' +
        '<span class="ri-label">' + escapeHtml(label) + '</span>' +
        '<span class="ri-tag">' + (missing ? "missing" : (r.example ? "example" : "session")) + '</span>' +
        '</button>';
    }).join("");
  }
  if (!html) {
    html = '<div class="recent-menu-empty">No recent sessions or projects yet.</div>';
  }
  host.innerHTML = html;
  host.querySelectorAll(".recent-menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      toggleRecentMenu(false);
      if (item.dataset.kind === "project") {
        projectOpenByPath(item.dataset.path);
      } else {
        activateTab("session");
        loadSessionIntoView(item.dataset.folder);
      }
    });
  });
}
function toggleRecentMenu(force) {
  const popup = document.getElementById("recent-menu-popup");
  if (!popup) return;
  const open = force === undefined ? popup.style.display === "none" : !!force;
  if (open) renderRecentMenu();
  popup.style.display = open ? "" : "none";
}
(function wireRecentMenu() {
  const btn = document.getElementById("btn-recent-menu");
  const popup = document.getElementById("recent-menu-popup");
  if (!btn || !popup) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleRecentMenu();
  });
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== btn) toggleRecentMenu(false);
  });
})();

async function projectSaveAs() {
  toggleProjectMenu(false);
  const name = await promptModal({
    title: "Save project as",
    message: "Project name",
    detail: "Saves the current aggregate session set, focus session, template, view mode, and case scope into a single .pdt-project.json file you can re-open later.",
    placeholder: "e.g. ENG-2026-001 onboarding review",
    initial: (PdtProject.activeProject() && PdtProject.activeProject().name) || "Untitled project",
  });
  if (!name) return;
  const project = PdtProject.captureFromCollectors(projectCollectors, { name });
  const r = await ipcRenderer.invoke("viewer:saveProjectAs", { project, suggestedName: name.replace(/[^A-Za-z0-9._-]+/g, "-") });
  if (!r) return;
  if (!r.ok) { toast("Save failed: " + (r.error || "unknown"), "error"); return; }
  PdtProject.setActiveProject({ path: r.path, name, ...project });
  PdtProject.pushRecentProject(r.path, name);
  renderRecentProjects();
  toast("Project saved", "success");
}

async function projectSave() {
  toggleProjectMenu(false);
  const active = PdtProject.activeProject();
  if (!active || !active.path) return projectSaveAs();
  const project = PdtProject.captureFromCollectors(projectCollectors, { name: active.name });
  const r = await ipcRenderer.invoke("viewer:saveProject", { project, path: active.path });
  if (!r || !r.ok) { toast("Save failed: " + ((r && r.error) || "unknown"), "error"); return; }
  PdtProject.setActiveProject({ path: r.path, name: active.name, ...project });
  PdtProject.pushRecentProject(r.path, active.name);
  renderRecentProjects();
  toast("Project saved", "success");
}

async function projectOpen() {
  toggleProjectMenu(false);
  const r = await ipcRenderer.invoke("viewer:openProject");
  if (!r) return;
  if (!r.ok) { toast("Couldn't open project: " + (r.error || "unknown"), "error"); return; }
  await applyProject(r.path, r.project);
}

async function projectOpenByPath(filePath) {
  const r = await ipcRenderer.invoke("viewer:loadProjectFile", filePath);
  if (!r) return;
  if (!r.ok) { toast("Couldn't open project: " + (r.error || "unknown"), "error"); return; }
  await applyProject(r.path, r.project);
}

async function applyProject(filePath, raw) {
  const v = PdtProject.validateProject(raw);
  if (!v.ok) { toast("Project file invalid: " + v.error, "error"); return; }
  const project = v.project;
  PdtProject.setActiveProject({ path: filePath, ...project });
  PdtProject.pushRecentProject(filePath, project.name);
  renderRecentProjects();

  // Aggregate sessions
  if (project.aggregateSessions && project.aggregateSessions.length) {
    try {
      const sessions = await ipcRenderer.invoke("viewer:loadMultipleSessions", project.aggregateSessions);
      State.setAggregateSessions((sessions || []).filter((s) => s && !s.error));
      const aggEmpty = $("#aggregate-empty");
      const aggLoaded = $("#aggregate-loaded");
      if (aggEmpty) aggEmpty.style.display = State.getAggregateSessions().length ? "none" : "";
      if (aggLoaded) aggLoaded.style.display = State.getAggregateSessions().length ? "" : "none";
      const btnNorm = $("#btn-normalize-all");
      if (btnNorm) btnNorm.disabled = !State.getAggregateSessions().length;
      if (typeof renderAggregate === "function" && State.getAggregateSessions().length) renderAggregate();
    } catch (e) {
      toast("Failed to load aggregate sessions: " + (e.message || e), "error");
    }
  }

  // Focus session
  if (project.currentSessionFolder) {
    try { await loadSessionIntoView(project.currentSessionFolder); }
    catch (e) { toast("Couldn't load focus session: " + (e.message || e), "error"); }
  }

  // Process template
  if (project.templatePath) {
    try {
      if (fs.existsSync(project.templatePath)) {
        State.getCanonicalState().path = project.templatePath;
        State.getCanonicalState().content = fs.readFileSync(project.templatePath, "utf-8");
        const yamlEl = document.getElementById("canonical-yaml");
        if (yamlEl) yamlEl.value = State.getCanonicalState().content;
        const metaEl = document.getElementById("canonical-meta");
        if (metaEl) metaEl.textContent = "Loaded " + project.templatePath;
        const saveBtn = document.getElementById("btn-save-canonical");
        if (saveBtn) saveBtn.disabled = false;
        if (typeof renderCanonicalStepList === "function") renderCanonicalStepList();
      }
    } catch (_) { /* template missing or unreadable; project still usable */ }
  }

  // View mode (Flow / Steps / Phases)
  if (project.viewMode && project.viewMode !== State.getLevel()) {
    const vmBtn = document.querySelector('.view-mode-btn[data-level="' + project.viewMode + '"]');
    if (vmBtn) vmBtn.click();
  }

  // Case scope
  if (project.currentCaseScope) {
    State.setCaseScope(project.currentCaseScope);
    const sel = document.getElementById("case-scope-select");
    if (sel) {
      sel.value = State.getCaseScope();
      sel.dispatchEvent(new Event("change"));
    }
  }

  // Tab last so any tab-specific re-render (e.g. aggregate fit) runs.
  if (project.currentTab) activateTab(project.currentTab);

  toast("Project loaded: " + (project.name || path.basename(filePath)), "success");
}

function projectClose() {
  toggleProjectMenu(false);
  PdtProject.setActiveProject(null);
  toast("Project closed (sessions stay loaded)");
}

(function wireProjectMenuItems() {
  const open = document.getElementById("btn-project-open");
  const saveAs = document.getElementById("btn-project-save-as");
  const save = document.getElementById("btn-project-save");
  const close = document.getElementById("btn-project-close");
  if (open)   open.addEventListener("click", projectOpen);
  if (saveAs) saveAs.addEventListener("click", projectSaveAs);
  if (save)   save.addEventListener("click", projectSave);
  if (close)  close.addEventListener("click", projectClose);
})();

function renderRecentProjects() {
  const block = document.getElementById("recent-projects-block");
  const list = document.getElementById("recent-list-projects");
  if (!block || !list) return;
  const recents = PdtProject.getRecentProjects();
  if (!recents.length) { block.style.display = "none"; return; }
  block.style.display = "";
  list.innerHTML = recents.map((r) => {
    let missing = false;
    try { missing = !fs.existsSync(r.path); } catch (_) { missing = true; }
    const name = escapeHtml(r.name || path.basename(r.path, ".pdt-project.json"));
    const missingTag = missing ? '<span class="recent-missing-tag">missing</span>' : "";
    const cls = missing ? "missing" : "";
    return '<li data-project-path="' + escapeHtml(r.path) + '" class="' + cls + '" title="' + escapeHtml(r.path) + '">' +
      '<span class="label">' + name + missingTag + '</span>' +
      '<span class="when">' + (r.ts ? relTime(r.ts) : "") + '</span>' +
      '<button class="recent-remove" type="button" title="Remove from Recent projects">×</button>' +
    '</li>';
  }).join("");
  list.querySelectorAll("li[data-project-path]").forEach((li) => {
    li.addEventListener("click", (e) => {
      if (e.target.closest(".recent-remove")) return;
      projectOpenByPath(li.dataset.projectPath);
    });
  });
  list.querySelectorAll(".recent-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      PdtProject.removeRecentProject(btn.closest("li").dataset.projectPath);
      renderRecentProjects();
    });
  });
}

(function wireRecentProjectsClear() {
  const btn = document.getElementById("recent-projects-clear");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!PdtProject.getRecentProjects().length) return;
    const ok = await confirmModal({
      title: "Clear Recent projects?",
      message: "Remove all entries from Recent projects?",
      detail: "Project files on disk are not touched; only the localStorage list is cleared.",
      okLabel: "Clear",
      danger: true,
    });
    if (ok) {
      PdtProject.clearRecentProjects();
      renderRecentProjects();
    }
  });
})();

// Initial render
updateProjectMenuLabel();
renderRecentProjects();
