/*
 * step-panel.js: the step panel (lane V2 item 4; step-back review 4.5,
 * AD-23). One component with three doors, shown beside the content so the
 * map, the timeline or the Steps list stays visible:
 *   a click on a map box, a click on a timeline step band, a selected Steps
 *   row (and Watch in the step pane, which plays its step here). A task of
 *   the As-Is map is a map box too (asis-view.js, C18); a task no step
 *   stands for opens the panel on its name and one line saying so.
 * It names the step, its system and description, its flow in one short
 * line when set (C17: "Only when ... · Goes back to step 2 when ..."), says
 * "In N of M transactions, about Xs each", and lists one row per time the
 * step happened, under one line that says what the rows are (the owner's
 * review): "This step happened 5 times: once in transactions 1, 3 and 4,
 * twice in transaction 2. Play any of them." A row reads "Transaction 1 ·
 * 0:39 into the recording · took 8s" (the time since the recording started,
 * the PDD's clock; "Transaction 2, again" for a second time in one
 * transaction), with a play button that plays that time in the panel's
 * small video (when the project has one), then its screenshots (a click
 * opens one full size), what was said then (the transcript) and its notes,
 * each under a small lead. The video is cued to the row the panel opens on
 * (a map box's reference transaction, the band or the Steps row clicked),
 * and the row it is at is highlighted; a row's play moves both. At the
 * foot: "Open in Steps", or "Show on timeline" on the Steps level. The
 * occurrences of a step are the steps of the runs that share its map box
 * (process-map-levels.mapNodeLabel).
 *
 * Contract C19: the panel works at a level. A step inside a sub-process
 * opens it on that level: its occurrences are the steps of its node at that
 * level across every visit of the sub-process (sub-process-maps.js), and a
 * sub-process's panel has "Open sub-process" at its foot (its steps, or on
 * the Map its map).
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
const StepFlow = require("../step-flow.js");
const Video = require("./flow-view-video.js");
const AnalystUI = require("./analyst-ui.js");
const SPM = require("../sub-process-maps.js");
const AC = require("../analyst-content.js");

/* { label, path, focusId }: the map box shown, the level it is at (C19, []
   the main level) and the occurrence the foot's act and a play act on; null
   while closed. */
let _state = null;
/* The analyst closed the panel on the Steps level: row selections leave it
   closed until a door opens it again. */
let _dismissed = false;
let _stopAt = null;
let _folder = null;
/* The row the video was last cued to or played (a step id): the highlighted
   row. A render whose focus is another row cues the video to it. */
let _cuedId = null;
/* The Steps selection the panel last followed: a redraw of the Steps level
   with the same selection keeps the row in the video. */
let _followed = null;
/* Lane FX2: the analyst moved the panel's video (played it, or dragged its
   position) since it was cued to the highlighted row; a seek this module
   makes itself (`_selfSeek`) is not the analyst's. A frame of the video for
   a step without a time is taken only once the analyst chose its moment. */
let _moved = false;
let _selfSeek = false;

const $ = (id) => document.getElementById(id);

function _session() { return State.getSession(); }

function _steps() {
  const s = _session();
  return (s && s.annotations && s.annotations.steps) || [];
}

/* A step by id at any level (C19), or null. */
function _find(id) {
  const hit = SPM.findStep(_steps(), id);
  return hit ? hit.step : null;
}

/* The occurrences of a map box: the runs' visible steps with that label, in
   run order; a step outside every run joins when it is the focus. At a level
   below the main one (C19, `path`), the visible steps with that label in
   every visit of that level, in transaction order. */
function occurrences(label, runs, focus, path) {
  const out = [];
  if (path && path.length) {
    for (const v of SPM.levelVisits(runs.map((r) => r.members), path)) {
      for (const st of v.visible) if (mapNodeLabel(st) === label) out.push({ step: st, run: runs[v.t], list: v.visible });
    }
  } else {
    for (const r of runs) {
      for (const st of r.visible) if (mapNodeLabel(st) === label) out.push({ step: st, run: r, list: r.visible });
    }
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
  // 2.0.1: a step that takes under a second has no "about ... each".
  const mean = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : NaN;
  const avg = mean >= 1000 ? StepFacts.formatMs(mean) : "";
  return (runCount ? "In " + inRuns + " of " + runCount + " transaction" + (runCount === 1 ? "" : "s") : "Outside the transactions") +
    (avg ? ", about " + avg + " each" : "");
}

function _interactions() {
  const m = {};
  for (const ev of ((_session() && _session().events) || [])) if (ev.type === "interaction") m[ev.event_id] = ev;
  return m;
}

/* True when a step has a start time (a step added by hand has none). */
function _hasStart(st) {
  return !!(st && st.time_range && isFinite(Date.parse(st.time_range.start)));
}

/* The lengths of the videos whose file holds none (a recorded .webm reports
   Infinity), measured off screen (_measure), in seconds by file URL; NaN
   while one is measured. */
const _measured = new Map();

/* The panel's video length in ms, NaN while unknown. */
function _lengthMs() {
  const v = $("sp-video");
  const d = v ? v.duration : NaN;
  if (Number.isFinite(d) && d > 0) return d * 1000;
  const m = v ? _measured.get(v.getAttribute("src")) : undefined;
  return Number.isFinite(m) && m > 0 ? m * 1000 : NaN;
}

/* Measure the length of the video at `src` when its file holds none: a copy
   off screen is sought past its end, which makes the browser find it, so the
   panel's own video is never moved for it. The rows are drawn again once it
   is known (the ones past the end then say so). */
function _measure(src) {
  if (!src || _measured.has(src)) return;
  _measured.set(src, NaN);
  const m = document.createElement("video");
  m.muted = true;
  m.preload = "metadata";
  let over = false;
  const done = (secs) => {
    if (over) return;
    over = true;
    m.removeAttribute("src");
    try { m.load(); } catch (_) { /* nothing loaded */ }
    if (!(Number.isFinite(secs) && secs > 0)) { _measured.delete(src); return; }
    _measured.set(src, secs);
    const v = $("sp-video"), panel = $("step-panel");
    if (_state && v && panel && !panel.hidden && v.getAttribute("src") === src) render();
  };
  m.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(m.duration)) { done(m.duration); return; }
    m.addEventListener("durationchange", () => { if (Number.isFinite(m.duration)) done(m.duration); });
    m.currentTime = 1e101;
  }, { once: true });
  m.addEventListener("error", () => done(NaN), { once: true });
  setTimeout(() => done(NaN), 20000);
  m.src = src;
}

/* Where a step's moment is in the project's video (StepFacts.videoMoment). */
function _moment(step) {
  return StepFacts.videoMoment(step, Date.parse(Video.videoStartTs()), _lengthMs());
}

/* What a moment's time is in (lane FX3, F22): the recording, else the
   video of a project made without one, else nothing (a project with
   neither has no clock). */
function _clockNoun() {
  const s = _session();
  if (!s || AC.hasRecording(s)) return "recording";
  return s.recordingAvailable ? "video" : "";
}

/* "This step has no time in the recording", or "in the video" in a project
   made from one (lane FX3, F22): the lead of the two lines below that need a
   video, so never a project with no clock. */
function _noTime() {
  return "This step has no time in the " + (_clockNoun() || "video");
}

/* One row: what it is ("Transaction 2, again · 2:14 into the recording ·
   took 9s"), its play button, then its screenshots, what was said and its
   notes, each under a small lead. `again`: an earlier row is in the same
   transaction. */
function _rowHtml(o, again, origin, placed, hasVideo, focusId) {
  const st = o.step;
  // C16: the screenshots the step shows (recorded less the hidden ones, then
  // the ones added) and its notes (its own and those at a moment inside it).
  const shots = AnalystUI.shotsOf(st);
  const notes = AnalystUI.notesOf(st);
  // 2.0.1: the step before it in its transaction bounds its window, as in
  // the step pane, so a sentence shows under one step only.
  const said = placed && placed.synced ? TM.sentencesForStep(placed.sentences, st, o.list) : [];
  const focus = st.step_id === focusId;
  // Lane FX2: a moment the video does not cover says so, and has no play.
  const m = hasVideo ? _moment(st) : null;
  const waste = !!(st.flags && st.flags.waste);
  return '<li class="sp-occ' + (focus ? " focus" : "") + '" data-step-id="' + escapeAttr(st.step_id) + '"' +
      (focus ? ' aria-current="true"' : "") + ">" +
    '<div class="sp-occ-head">' +
      (m && m.kind === "covered" ? '<button type="button" class="sp-play" title="Play this occurrence in the video above" aria-label="' +
        escapeAttr("Play " + StepFacts.occurrenceLine(st, o.run, again, origin, _clockNoun())) + '">▶</button>' : "") +
      '<span class="sp-at">' + escapeHtml(StepFacts.occurrenceLine(st, o.run, again, origin, _clockNoun())) + "</span>" +
      (waste ? '<span class="step-tag-waste sp-waste-tag" title="Flagged as waste: this step should not be needed">Waste</span>' : "") +
    "</div>" +
    (m && m.kind === "outside" ? '<p class="sp-nocover">' + escapeHtml(StepFacts.NOT_COVERED) + "</p>" : "") +
    (shots.length ? '<div class="sp-sec"><div class="sp-lead">Screenshots</div><div class="sp-shots">' + shots.map((sh) =>
      '<button type="button" class="sp-shot" data-ref="' + escapeAttr(sh.rel) + '" title="' +
        escapeAttr((sh.time ? sh.time + ": " : "") + "open it full size") + '"><img src="' + escapeAttr(sh.url) +
        '" alt="' + escapeAttr("Screenshot" + (sh.time ? " at " + sh.time : "")) + '"></button>').join("") + "</div></div>" : "") +
    (said.length ? '<div class="sp-sec"><div class="sp-lead">Said:</div><ol class="sp-said">' +
      said.map((x) => '<li class="tr-row">' + TM.sentenceRowHtml(x, origin) + "</li>").join("") + "</ol></div>" : "") +
    (notes.length ? '<div class="sp-sec"><div class="sp-lead">Notes</div><ul class="sp-notes" title="Notes stay in the app: the PDD does not print them.">' +
      notes.map((n) => '<li class="sp-note">' + (n.at ? '<span class="sp-note-at">' + escapeHtml(sinceStart(n.at, origin)) + "</span> " : "") +
      escapeHtml(n.text) + "</li>").join("") + "</ul></div>" : "") +
    "</li>";
}

/* A task of the As-Is map that no step stands for (C18): its name and one
   line, no video and no occurrences. */
function _renderMissing() {
  $("sp-name").textContent = _state.missing || "(unnamed task)";
  $("sp-about").innerHTML = '<p class="sp-missing">No step of the transactions has this name.</p>';
  const video = $("sp-video");
  if (video) {
    if (!video.paused) video.pause();
    video.removeAttribute("src");
    video.hidden = true;
  }
  _cuedId = null;
  $("sp-body").innerHTML = "";
}

/* Draw the panel for the current state. The video moves only when the
   highlighted row is not the one it was cued to (an open on another row). */
function render() {
  const panel = $("step-panel");
  const s = _session();
  if (!panel || !s || !_state) return;
  if (_state.missing != null) { _renderMissing(); return; }
  const runs = RunsModel.buildRuns(s.stats, _steps()).runs;
  const focus = _find(_state.focusId);
  const path = _state.path || [];
  const occ = occurrences(_state.label, runs, focus, path);
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
  // C17: the step's condition and links, in one short line when set (the
  // condition set on any step of this box: it holds in every transaction).
  // C19: a link reads against the steps of the lead's own visit.
  const txs = runs.map((r) => r.members);
  const leadPlace = path.length ? SPM.placeOf(txs, path, lead.step_id) : null;
  const leadRun = runs.find((r) => r.caseId === lead.case_id);
  const flowList = path.length ? (leadPlace ? leadPlace.visible : []) : (leadRun ? leadRun.visible : []);
  const flow = StepFlow.panelLine(flowList, lead, occ.map((o) => StepFlow.onlyWhen(o.step)),
    new Map(SPM.allSteps((s.annotations && s.annotations.steps) || []).map((x) => [x.step_id, x.name])));
  const isSub = SPM.isSubProcessNode(txs, path, _state.label);
  // Lane FX2 (validation pass 2, F21): the waste flag shows here too, as in
  // Steps and the PDD.
  const wasted = occ.filter((o) => o.step.flags && o.step.flags.waste).length;
  $("sp-name").textContent = lead.name || "(unnamed step)";
  $("sp-about").innerHTML =
    ((where.system || where.screen) ? '<p class="sp-system">' + escapeHtml([where.system, where.screen].filter(Boolean).join(" · ")) + "</p>" : "") +
    (wasted ? '<p class="sp-waste" id="sp-waste"><span class="step-tag-waste" title="Flagged as waste: this step should not be needed">Waste</span> ' +
      escapeHtml(wasted === occ.length ? "Flagged as waste" : "Flagged as waste in " + wasted + " of " + occ.length) + "</p>" : "") +
    (desc ? '<p class="sp-desc">' + escapeHtml(desc) + "</p>" : "") +
    (flow ? '<p class="sp-flow" id="sp-flow" title="' + escapeAttr(flow) + '">' + escapeHtml(flow) + "</p>" : "") +
    '<p class="sp-count">' + escapeHtml(countLine(occ, runs.length)) + "</p>";
  const video = $("sp-video");
  const src = hasVideo ? "file:///" + String(s.recordingPath).replace(/\\/g, "/") : "";
  // Lane FX2 (validation pass 2, F7; pass 3, F14): the video shows only a
  // moment of the highlighted row: its start when the video covers it, else
  // it is hidden with one line saying the video does not cover it; a step
  // without a time shows the video's start with one line, and a frame of it
  // is taken only once the analyst goes to the step's moment.
  const focusStep = (occ.find((o) => o.step.step_id === _state.focusId) || occ[0]).step;
  const fm = hasVideo ? _moment(focusStep) : null;
  if (video) {
    if (!src) { video.removeAttribute("src"); video.hidden = true; }
    else {
      // Another video starts at 0: the row is cued again.
      if (video.getAttribute("src") !== src) { video.setAttribute("src", src); _cuedId = null; }
      video.hidden = !!fm && fm.kind === "outside";
    }
  }
  const note = $("sp-video-note");
  if (note) {
    const text = !fm ? "" : fm.kind === "outside" ? StepFacts.NOT_COVERED + "."
      : fm.kind === "untimed" ? _noTime() + UNTIMED_NOTE : "";
    note.textContent = text;
    note.hidden = !text;
  }
  const onSteps = State.getLevel() === "steps";
  const placed = TM.forSession(s);
  const inRun = new Set();
  const rows = occ.map((o) => {
    const again = !!o.run && inRun.has(o.run.caseId);
    if (o.run) inRun.add(o.run.caseId);
    return _rowHtml(o, again, origin, placed, hasVideo, _state.focusId);
  });
  const kinds = hasVideo ? occ.map((o) => _moment(o.step).kind) : [];
  const playable = kinds.filter((k) => k === "covered").length;
  const uncovered = kinds.filter((k) => k === "outside").length;
  $("sp-body").innerHTML =
    '<p class="sp-explain" id="sp-explain">' + escapeHtml(StepFacts.occurrencesLine(occ, runs.length, playable, uncovered)) + "</p>" +
    '<ol class="sp-occs">' + rows.join("") + "</ol>" +
    '<div class="sp-foot">' + (onSteps
      ? '<button type="button" id="btn-sp-timeline" title="Open the Timeline at the start of this occurrence"' +
        (lead.time_range && lead.time_range.start ? "" : " disabled") + '>Show on timeline</button>'
      : '<button type="button" id="btn-sp-steps" title="Open this occurrence in Steps, in its transaction">Open in Steps</button>') +
      (isSub ? '<button type="button" id="btn-sp-open-sub" title="' + (State.getLevel() === "map"
        ? "Show the map of this sub-process" : "Show the steps of this sub-process") + '">▸ Open sub-process</button>' : "") +
    "</div>";
  // The panel opened on this row (or its row is gone): the video goes to it.
  if (_state.focusId !== _cuedId) _cue(_state.focusId);
}

/* The line under the panel's video for a step without a time (lane FX2),
   after _noTime(). */
const UNTIMED_NOTE = ": play the video to its moment, then Add screenshot takes that frame.";

/* The panel's video at a row's start, paused: the panel opens with its video
   at the row it highlights, not where the video last stopped. Before the
   video has loaded, the time set is where it starts once it has. Lane FX2:
   a step without a time is cued to the video's start (never the frame the
   previous row left), and a moment the video does not cover is not cued (the
   video is hidden then). */
function _cue(stepId) {
  _cuedId = stepId;
  _moved = false;
  const video = $("sp-video");
  const step = _find(stepId);
  if (!video || video.hidden || !video.getAttribute("src") || !step) return;
  _stopAt = null;
  if (!video.paused) video.pause();
  const m = _moment(step);
  const at = m.kind === "covered" ? m.at : m.kind === "untimed" ? 0 : NaN;
  if (isFinite(at) && at >= 0 && Math.abs((video.currentTime || 0) - at) > 0.001) {
    _selfSeek = true;
    video.currentTime = at;
  }
}

/* Lane FX2: where "A frame of the video" takes the frame for step `stepId`
   (views/analyst-ui.js), so it never saves another step's frame:
     { video }  the panel's video, when the panel shows this step and its
                video is at the step's moment (cued there, or moved by the
                analyst, which is the only way for a step without a time);
     { at }     the step's start, in seconds into the video, when the panel
                does not show it there (the frame is read from a copy of the
                video, off screen);
     { why }    no frame can be taken, and why.
   `src` is the video's file URL. */
function frameSource(stepId) {
  const s = _session();
  const step = _find(stepId);
  if (!s || !step || !s.recordingAvailable || !s.recordingPath) return { why: "There is no video to take a frame from." };
  const src = "file:///" + String(s.recordingPath).replace(/\\/g, "/");
  const m = _moment(step);
  if (m.kind === "outside") return { why: StepFacts.NOT_COVERED + ": no frame of it can be taken." };
  if (m.kind === "unplaced") return { why: "The video cannot be lined up with the project, so no frame of this step can be taken." };
  const panel = $("step-panel");
  const video = $("sp-video");
  const shown = !!(panel && !panel.hidden && _state && _state.focusId === stepId && video && !video.hidden &&
    video.getAttribute("src") === src);
  if (shown && (m.kind === "covered" || _moved)) return { video, src };
  if (m.kind === "covered") return { at: m.at, src };
  return { why: _noTime() + ": play the step panel's video to its moment first, then add the frame." };
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
  if (folder !== _folder) { _folder = folder; _state = null; _dismissed = false; _cuedId = null; _followed = null; _show(false); }
}

/* Open the panel on a step's map box, at the step's level (C19), with that
   step as its focus. */
function openForStep(step, fromSteps) {
  _reset();
  if (!step || !_session() || State.getLevel() === "overview") return;
  if (!fromSteps) _dismissed = false;
  const hit = SPM.findStep(_steps(), step.step_id);
  _state = { label: mapNodeLabel(step), path: hit ? hit.path : [], focusId: step.step_id };
  _show(true);
  render();
}

/* A map box: its focus is the reference run's occurrence, else the first.
   `path` is the level of the map it is on (C19; the main map by default). */
function openForNode(label, path) {
  _reset();
  const s = _session();
  if (!s || label == null) return;
  const runs = RunsModel.buildRuns(s.stats, _steps()).runs;
  const occ = occurrences(String(label), runs, null, path || []);
  if (!occ.length) return;
  const ref = RunsModel.patternRun(s.annotations || {}, runs).run;
  const lead = (ref && occ.find((o) => o.run && o.run.caseId === ref.caseId)) || occ[0];
  _dismissed = false;
  openForStep(lead.step);
}

/* A task of the As-Is map that no step of the transactions stands for (a
   task added or renamed in the map, or a step renamed or hidden since the
   copy was made): the panel names the task and says so in one line. */
function openForMissing(name) {
  _reset();
  if (!_session() || State.getLevel() === "overview") return;
  _dismissed = false;
  _state = { label: null, focusId: null, missing: String(name == null ? "" : name).trim() };
  _show(true);
  render();
}

/* The Steps level's selection: the panel follows it unless it was closed. A
   redraw of the Steps level with the same selection draws the panel again
   and keeps its row (a row played here stays the one in the video). */
function followSteps(step) {
  _reset();
  if (!step || _dismissed) return;
  const panel = $("step-panel");
  const hit = SPM.findStep(_steps(), step.step_id);
  if (panel && !panel.hidden && _state && _followed === step.step_id && _state.label === mapNodeLabel(step) &&
      SPM.samePath(_state.path, hit ? hit.path : [])) {
    render();
    return;
  }
  _followed = step.step_id;
  openForStep(step, true);
}

/* Play one occurrence in the panel's video, from its start to its end; its
   row becomes the highlighted one. */
function play(stepId) {
  const s = _session();
  const step = _find(stepId);
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
  // Lane FX2: past the video's end nothing of the step is in it.
  if (_moment(step).kind === "outside") { toast(StepFacts.NOT_COVERED + ".", "error"); return; }
  _cuedId = stepId;
  if (_state) { _state.focusId = stepId; render(); }
  const main = document.getElementById("video");
  if (main && !main.paused) main.pause();
  _stopAt = isFinite(to) && to > from ? to : null;
  const go = () => { _selfSeek = true; video.currentTime = from; video.play().catch(() => {}); };
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
  _cuedId = null;
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
    const step = _state && _find(_state.focusId);
    if (!step) return;
    if (t.closest("#btn-sp-open-sub")) {
      // C19: the sub-process's level, in Steps (the Timeline's steps lane
      // follows it there too).
      const SV = require("./steps-view.js");   // lazy: it requires this module
      const to = (_state.path || []).concat([_state.label]);
      if (State.getLevel() === "flow") {
        State.setMapPath(to);
        State.emit("timeline");
        return;
      }
      // On the Map, its map (the Map level follows the "mapPath" topic).
      if (State.getLevel() === "map") {
        State.setMapPath(to);
        State.emit("mapPath");
        return;
      }
      const btn = document.querySelector('.view-mode-btn[data-level="steps"]');
      if (State.getLevel() !== "steps" && btn) btn.click();
      SV.goToLevel(to, { openAt: step.step_id });
      return;
    }
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
    // Lane FX2: the analyst's own moves of the video (a play, a drag of its
    // position) are told from the ones this module makes.
    video.addEventListener("play", () => { _moved = true; });
    video.addEventListener("seeked", () => { if (_selfSeek) _selfSeek = false; else _moved = true; });
    // Once the video's length is known the rows say which moments it covers:
    // they are drawn again (where the video is stays as it is). A video whose
    // file holds no length (a recorded .webm reports Infinity) is measured
    // off screen.
    video.addEventListener("loadedmetadata", () => {
      if (!isFinite(video.duration)) _measure(video.getAttribute("src"));
    });
    video.addEventListener("durationchange", () => {
      if (isFinite(video.duration) && video.duration > 0 && _state && !panel.hidden) render();
    });
  }
})();

module.exports = { openForStep, openForNode, openForMissing, followSteps, watch, play, close, onLevel, refresh, occurrences, countLine, frameSource };
