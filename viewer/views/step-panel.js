/*
 * step-panel.js: the step panel (lane V2 item 4; step-back review 4.5,
 * AD-23). One component with three doors, shown beside the content so the
 * map, the timeline or the Steps list stays visible:
 *   a click on a map box, a click on a timeline step band, a selected Steps
 *   row (and Watch in the step pane, which plays its step here).
 * It names the step, its system and description, says "In N of M
 * transactions, about Xs each", and lists one row per occurrence:
 * "Transaction 1 at 0:39" (the
 * time since the recording started, the PDD's pointer) with a play button
 * that plays that occurrence in the panel's small video (when the recording
 * has one), its screenshots (a click opens one full size) and what was said
 * then (the transcript). At the foot: "Open in Steps", or "Show on timeline"
 * on the Steps level. The occurrences of a step are the steps of the runs
 * that share its map box (process-map-levels.mapNodeLabel).
 *
 * The panel is closed on the Overview and when a recording opens; its close
 * button is the inverse of every door (on Steps it then stays closed while
 * rows are selected, until a door opens it again).
 */

"use strict";

const State = require("../state.js");
const { escapeHtml, escapeAttr, toast, recordingStartMs, sinceStart } = require("../dom.js");
const RunsModel = require("../runs-model.js");
const { mapNodeLabel } = require("../process-map-levels.js");
const SystemNames = require("../system-names.js");
const StepFacts = require("../step-facts.js");
const TM = require("../transcript-model.js");
const Video = require("./flow-view-video.js");
const AnalystUI = require("./analyst-ui.js");

/* { label, focusId }: the map box shown and the occurrence the foot's act
   and a play act on; null while closed. */
let _state = null;
/* The analyst closed the panel on the Steps level: row selections leave it
   closed until a door opens it again. */
let _dismissed = false;
let _stopAt = null;
let _folder = null;

const $ = (id) => document.getElementById(id);

function _session() { return State.getSession(); }

function _steps() {
  const s = _session();
  return (s && s.annotations && s.annotations.steps) || [];
}

/* The occurrences of a map box: the runs' visible steps with that label, in
   run order; a step outside every run joins when it is the focus. */
function occurrences(label, runs, focus) {
  const out = [];
  for (const r of runs) {
    for (const st of r.visible) if (mapNodeLabel(st) === label) out.push({ step: st, run: r });
  }
  if (focus && !out.some((o) => o.step.step_id === focus.step_id)) out.push({ step: focus, run: null });
  return out;
}

/* "In 4 of 4 transactions, about 8s each" (a run is a transaction to the
   reader, AD-29). */
function countLine(occ, runCount) {
  const inRuns = new Set(occ.filter((o) => o.run).map((o) => o.run.caseId)).size;
  const ms = occ.map((o) => Date.parse(o.step.time_range && o.step.time_range.end) - Date.parse(o.step.time_range && o.step.time_range.start))
    .filter((x) => isFinite(x) && x >= 0);
  const avg = ms.length ? StepFacts.formatMs(ms.reduce((a, b) => a + b, 0) / ms.length) : "";
  return (runCount ? "In " + inRuns + " of " + runCount + " transaction" + (runCount === 1 ? "" : "s") : "Outside the transactions") +
    (avg ? ", about " + avg + " each" : "");
}

function _interactions() {
  const m = {};
  for (const ev of ((_session() && _session().events) || [])) if (ev.type === "interaction") m[ev.event_id] = ev;
  return m;
}

function _rowHtml(o, origin, placed, hasVideo, focusId) {
  const st = o.step;
  const where = StepFacts.pointer(st, o.run ? [o.run] : [], origin) || "(no time)";
  // C16: the screenshots the step shows (recorded less the hidden ones, then
  // the ones added) and its notes (its own and those at a moment inside it).
  const shots = AnalystUI.shotsOf(st);
  const notes = AnalystUI.notesOf(st);
  const said = placed && placed.synced ? TM.sentencesForStep(placed.sentences, st) : [];
  return '<li class="sp-occ' + (st.step_id === focusId ? " focus" : "") + '" data-step-id="' + escapeAttr(st.step_id) + '">' +
    '<div class="sp-occ-head">' +
      (hasVideo ? '<button type="button" class="sp-play" title="Play this occurrence in the video above">▶</button>' : "") +
      '<span class="sp-at">' + escapeHtml(where) + "</span>" +
      '<span class="sp-dur">' + escapeHtml(StepFacts.duration(st.time_range)) + "</span>" +
    "</div>" +
    (shots.length ? '<div class="sp-shots">' + shots.map((sh) =>
      '<button type="button" class="sp-shot" data-ref="' + escapeAttr(sh.rel) + '" title="' +
        escapeAttr((sh.time ? sh.time + ": " : "") + "open it full size") + '"><img src="' + escapeAttr(sh.url) +
        '" alt="' + escapeAttr("Screenshot" + (sh.time ? " at " + sh.time : "")) + '"></button>').join("") + "</div>" : "") +
    (said.length ? '<ol class="sp-said">' + said.map((x) => '<li class="tr-row">' + TM.sentenceRowHtml(x, origin) + "</li>").join("") + "</ol>" : "") +
    (notes.length ? '<ul class="sp-notes" title="Notes stay in the app: the PDD does not print them.">' + notes.map((n) =>
      '<li class="sp-note">' + (n.at ? '<span class="sp-note-at">' + escapeHtml(sinceStart(n.at, origin)) + "</span> " : "") +
      escapeHtml(n.text) + "</li>").join("") + "</ul>" : "") +
    "</li>";
}

/* Draw the panel for the current state (the video element stays as it is). */
function render() {
  const panel = $("step-panel");
  const s = _session();
  if (!panel || !s || !_state) return;
  const runs = RunsModel.buildRuns(s.stats, _steps()).runs;
  const focus = _steps().find((st) => st.step_id === _state.focusId) || null;
  const occ = occurrences(_state.label, runs, focus);
  if (!occ.length) { close(); return; }
  if (!occ.some((o) => o.step.step_id === _state.focusId)) _state.focusId = occ[0].step.step_id;
  const lead = (occ.find((o) => o.step.step_id === _state.focusId) || occ[0]).step;
  const origin = recordingStartMs(s);
  const names = (s.stats && s.stats.meta && s.stats.meta.app_names) || {};
  const inter = _interactions();
  const where = SystemNames.whereOfStep(lead, inter, names);
  const datas = StepFacts.stepDatas(lead, inter);
  const desc = StepFacts.isDraftedDescription(lead.description, datas) ? "" : String(lead.description || "").trim();
  const hasVideo = !!(s.recordingAvailable && s.recordingPath);
  $("sp-name").textContent = lead.name || "(unnamed step)";
  $("sp-about").innerHTML =
    ((where.system || where.screen) ? '<p class="sp-system">' + escapeHtml([where.system, where.screen].filter(Boolean).join(" · ")) + "</p>" : "") +
    (desc ? '<p class="sp-desc">' + escapeHtml(desc) + "</p>" : "") +
    '<p class="sp-count">' + escapeHtml(countLine(occ, runs.length)) + "</p>";
  const video = $("sp-video");
  const src = hasVideo ? "file:///" + String(s.recordingPath).replace(/\\/g, "/") : "";
  if (video) {
    if (!src) { video.removeAttribute("src"); video.hidden = true; }
    else {
      if (video.getAttribute("src") !== src) video.setAttribute("src", src);
      video.hidden = false;
    }
  }
  const onSteps = State.getLevel() === "steps";
  $("sp-body").innerHTML = '<ol class="sp-occs">' + occ.map((o) => _rowHtml(o, origin, TM.forSession(s), hasVideo, _state.focusId)).join("") + "</ol>" +
    '<div class="sp-foot">' + (onSteps
      ? '<button type="button" id="btn-sp-timeline" title="Open the Timeline at the start of this occurrence"' +
        (lead.time_range && lead.time_range.start ? "" : " disabled") + '>Show on timeline</button>'
      : '<button type="button" id="btn-sp-steps" title="Open this occurrence in Steps, in its transaction">Open in Steps</button>') + "</div>";
}

function _show(open) {
  const panel = $("step-panel");
  if (!panel || panel.hidden === !open) return;
  panel.hidden = !open;
  if (!open) {
    const v = $("sp-video");
    if (v && !v.paused) v.pause();
  }
  // The map beside it changed size.
  try { require("../dfg-viewer.js").resize(); } catch (_) { /* no map drawn */ }
}

function _reset() {
  const s = _session();
  const folder = s ? s.sessionFolder : null;
  if (folder !== _folder) { _folder = folder; _state = null; _dismissed = false; _show(false); }
}

/* Open the panel on a step's map box, with that step as its focus. */
function openForStep(step, fromSteps) {
  _reset();
  if (!step || !_session() || State.getLevel() === "overview") return;
  if (!fromSteps) _dismissed = false;
  _state = { label: mapNodeLabel(step), focusId: step.step_id };
  _show(true);
  render();
}

/* A map box: its focus is the reference run's occurrence, else the first. */
function openForNode(label) {
  _reset();
  const s = _session();
  if (!s || label == null) return;
  const runs = RunsModel.buildRuns(s.stats, _steps()).runs;
  const occ = occurrences(String(label), runs, null);
  if (!occ.length) return;
  const ref = RunsModel.patternRun(s.annotations || {}, runs).run;
  const lead = (ref && occ.find((o) => o.run && o.run.caseId === ref.caseId)) || occ[0];
  _dismissed = false;
  openForStep(lead.step);
}

/* The Steps level's selection: the panel follows it unless it was closed. */
function followSteps(step) {
  _reset();
  if (!step || _dismissed) return;
  openForStep(step, true);
}

/* Play one occurrence in the panel's video, from its start to its end. */
function play(stepId) {
  const s = _session();
  const step = _steps().find((st) => st.step_id === stepId);
  const video = $("sp-video");
  if (!s || !step || !video || !s.recordingAvailable || !s.recordingPath) {
    toast("No video is linked to this project.", "error");
    return;
  }
  const startTs = Video.videoStartTs();
  if (!startTs) { toast("Cannot line the video up with the project: it has no start time.", "error"); return; }
  const base = Date.parse(startTs);
  const from = (Date.parse(step.time_range && step.time_range.start) - base) / 1000;
  const to = (Date.parse(step.time_range && step.time_range.end) - base) / 1000;
  if (!isFinite(from) || from < 0) { toast("This step starts before the video does.", "error"); return; }
  if (_state) { _state.focusId = stepId; render(); }
  const main = document.getElementById("video");
  if (main && !main.paused) main.pause();
  _stopAt = isFinite(to) && to > from ? to : null;
  const go = () => { video.currentTime = from; video.play().catch(() => {}); };
  if (video.readyState >= 1) go(); else video.addEventListener("loadedmetadata", go, { once: true });
}

/* Watch in the step pane: the panel opens on the step and plays it. */
function watch(step) {
  if (!step) return;
  _dismissed = false;
  openForStep(step);
  play(step.step_id);
}

function close() {
  _state = null;
  _show(false);
}

/* The level changed: closed on the Overview, else the foot follows. */
function onLevel(name) {
  if (name === "overview") { close(); return; }
  if (_state) render();
}

/* The steps changed (an edit, an undo, an analysis): draw again. */
function refresh() {
  _reset();
  if (_state) render();
}

(function wire() {
  const panel = $("step-panel");
  if (!panel) return;
  panel.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest("#btn-sp-close")) {
      if (State.getLevel() === "steps") _dismissed = true;
      close();
      return;
    }
    const playBtn = t.closest(".sp-play");
    if (playBtn) { play(playBtn.closest(".sp-occ").dataset.stepId); return; }
    const shot = t.closest(".sp-shot");
    if (shot) { require("./flow-view-screenshots.js").openScreenshot(shot.dataset.ref); return; }
    const step = _state && _steps().find((st) => st.step_id === _state.focusId);
    if (!step) return;
    if (t.closest("#btn-sp-steps")) {
      State.consumePendingStepJump();
      State.setSelectedStepId(step.step_id);
      State.setPendingStepReveal();
      const btn = document.querySelector('.view-mode-btn[data-level="steps"]');
      if (btn) btn.click();
    } else if (t.closest("#btn-sp-timeline")) {
      Video.jumpToStepInFlow(step);
    }
  });
  const video = $("sp-video");
  if (video) {
    video.addEventListener("timeupdate", () => {
      if (_stopAt != null && video.currentTime >= _stopAt) { video.pause(); _stopAt = null; }
    });
  }
})();

module.exports = { openForStep, openForNode, followSteps, watch, play, close, onLevel, refresh, occurrences, countLine };
