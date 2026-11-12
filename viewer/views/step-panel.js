/*
 * step-panel.js: the step panel (lane V2 item 4; step-back review 4.5,
 * AD-23). One component with three doors, shown beside the content so the
 * map, the timeline or the Steps list stays visible:
 *   a click on a map box, a click on a timeline step band, a selected Steps
 *   row (and Play in the step editor, which plays its step here). A task of
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
 * foot: "Open in Steps" (plan D2: on the Map; on Steps the panel has no
 * foot). The occurrences of a step are the steps of the runs that share its
 * map box (process-map-levels.mapNodeLabel).
 *
 * Contract C19: the panel works at a level. A step inside a sub-process
 * opens it on that level: its occurrences are the steps of its node at that
 * level across every visit of the sub-process (sub-process-maps.js), and a
 * sub-process's panel on the Map has "Open sub-process" at its foot (its
 * map).
 *
 * Lane PANE (plan section 11): the panel no longer opens on the Timeline (the
 * timeline door and a step marked there open the step in the pane beside the
 * video, views/timeline-pane.js); its doors are the Map's and Steps'.
 *
 * Plan D2 (the owner, 2026-11-12: Steps at 1366 px): on Steps the panel
 * keeps only what the editor beside it lacks, the step's video and its rows
 * (each its transaction, its moment, its play); the name, the system, the
 * description, the flow, the screenshots, what was said and the notes are
 * the editor's (`partsOn`). From 1440 px of window width up (CSS pixels, so
 * the app's zoom counts: `standsBeside`) it stands beside the editor and
 * follows the selection; below, it opens only on Play (the editor's line of
 * facts, the step menu) and takes the place of the step list while open, so
 * the editor keeps its width; Escape or its close gives the list back and
 * the focus to Play.
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
const MarkerEdits = require("../marker-edits.js");
const TE = require("../time-edits.js");
const RO = require("../read-only.js");
const StepEditor = require("../step-editor.js");

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
/* Lane E-1: the step whose name, system and description the head shows as
   fields (null while it reads as text), and whether they are being drawn
   (a field taken off the page then saves nothing). */
let _headStepId = null;
let _rendering = false;
/* Plan D2: the panel was opened on Steps by Play (or for a frame of the
   video), not by the selection: below STANDS_FROM_PX it stays open, in the
   place of the step list, until it is closed. */
let _asked = false;

/* The ids of the head's fields (the editor's own are step-name, step-system
   and step-desc, on the page beside it). */
const HEAD_IDS = { name: "sp-name-input", list: "sp-activity-list", note: "sp-lib-note", system: "sp-system",
  systemList: "sp-system-list", desc: "sp-desc" };

/* Lane E-1: whether the name of a step just marked on the Timeline takes the
   focus: only while the video is paused (the analyst stopped to write), never
   while it plays (the next S is the next step, Space still pauses), and never
   in a project open read only. Pure. */
function nameTakesFocus(o) {
  const x = o || {};
  return !x.playing && !x.readOnly;
}

/* Whether the head shows fields: on the Map, in a project that can change
   (on Steps the editor beside it is where the step is written, lane E-1
   1b; lane PANE: the panel no longer opens on the Timeline). Pure. */
function headEditable(level, readOnly) {
  return !readOnly && level === "map";
}

/* Lane PANE (plan section 11): whether the panel opens on `level`: on the
   Map and on Steps. On the Timeline a step opens in the pane beside the
   video (views/timeline-pane.js), so the timeline keeps its width; on the
   Overview it is closed. Pure. */
function opensOn(level) {
  return level === "map" || level === "steps";
}

/* Plan D2: the window width (CSS pixels) from which the panel stands beside
   the Steps editor as a third column. */
const STANDS_FROM_PX = 1440;

/* Plan D2: whether, at a window `width` in CSS pixels (window.innerWidth,
   which the app's zoom divides), the panel stands beside the Steps editor
   and follows the selection; below, it opens only on Play, in the place of
   the step list. Pure. */
function standsBeside(width) {
  return Number(width) >= STANDS_FROM_PX;
}

/* What the panel shows on `level`, by part. On the Map: the step's name,
   system and description (fields there, lane E-1), the waste flag, its flow
   line, the count, the video, the rows with their screenshots, what was
   said and the notes, and the foot's acts. Plan D2: on Steps only what the
   editor beside it lacks: the video and the rows (each its transaction, its
   moment, its play). Pure. */
const PARTS = ["name", "system", "description", "waste", "flow", "count", "video", "occurrences",
  "screenshots", "said", "notes", "foot"];
function partsOn(level) {
  return level === "steps" ? ["video", "occurrences"] : PARTS.slice();
}

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
   reader, AD-29). An open occurrence (`open`, a Set of step ids) has no
   length to count. */
function countLine(occ, runCount, open) {
  const inRuns = new Set(occ.filter((o) => o.run).map((o) => o.run.caseId)).size;
  const ms = occ.filter((o) => !(open && open.has(o.step.step_id)))
    .map((o) => Date.parse(o.step.time_range && o.step.time_range.end) - Date.parse(o.step.time_range && o.step.time_range.start))
    .filter((x) => isFinite(x) && x >= 0);
  // 2.0.1: a step that takes under a second has no "about ... each".
  const mean = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : NaN;
  const avg = mean >= 1000 ? StepFacts.formatMs(mean) : "";
  return (runCount ? "In " + inRuns + " of " + runCount + " transaction" + (runCount === 1 ? "" : "s") : "Outside the transactions") +
    (avg ? ", about " + avg + " each" : "");
}

/* The occurrences open (time-edits.js isOpen; the owner, after 2.0.3: "you
   always add steps sequentially"): a step of the analyst's being marked,
   nothing after it yet, at the main level (`path` []). A Set of step ids. */
function _openIds(occ, path) {
  const s = _session();
  const sp = Video.timelineSpan();
  if (!s || !sp || (path && path.length)) return new Set();
  const moments = TE.markerMoments(MarkerEdits.currentMarkerEvents(MarkerEdits.sessionMarkerView(s)));
  return new Set(occ.filter((o) => AC.stepTimeMovable(o.step) && TE.isOpen({ startMs: Date.parse(o.step.time_range.start),
    endMs: Date.parse(o.step.time_range.end) }, sp.endMs, moments)).map((o) => o.step.step_id));
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

/* C23 (2.0.6): the video of the chain the panel shows for `step`: the one
   showing its start, else (a step without a time, or one no video shows)
   the one in the Timeline's player, else the first one found. */
function _clipOf(step) {
  const start = Date.parse(step && step.time_range && step.time_range.start);
  const hit = Number.isFinite(start) ? Video.clipAtMs(start) : null;
  if (hit && hit.clip.file) return hit.clip;
  const cur = Video.currentClip();
  return cur && cur.file ? cur : (Video.chainOf().find((c) => c.file) || null);
}

/* Where a step's moment is in its video (StepFacts.videoMoment, `at` and
   `to` in that video's file): a moment no video of the chain shows is
   outside; without a video placed on the clock, unplaced. */
function _moment(step) {
  const start = Date.parse(step && step.time_range && step.time_range.start);
  if (!Number.isFinite(start)) return { kind: "untimed" };
  const hit = Video.clipAtMs(start);
  if (hit && hit.clip.file) {
    const len = hit.span.endMs != null ? hit.span.endMs - hit.span.fileStartMs : _lengthMs();
    return StepFacts.videoMoment(step, hit.span.fileStartMs, len);
  }
  const placed = Video.chainOf().some((c) => c.file && Video.clipSpan(c));
  return placed ? { kind: "outside", at: NaN } : { kind: "unplaced" };
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
   transaction. `offer` (lane E-1): "Use the video at 0:11", the one link of
   the highlighted row while it shows no screenshot and a video covers it.
   `parts` (partsOn): plan D2, on Steps a row is its line and its play. */
function _rowHtml(o, again, origin, placed, hasVideo, focusId, open, offer, parts) {
  const st = o.step;
  const has = (p) => !parts || parts.includes(p);
  // C16: the screenshots the step shows (recorded less the hidden ones, then
  // the ones added) and its notes (its own and those at a moment inside it).
  const shots = has("screenshots") ? AnalystUI.shotsOf(st) : [];
  const notes = has("notes") ? AnalystUI.notesOf(st) : [];
  // 2.0.1: the step before it in its transaction bounds its window, as in
  // the step pane, so a sentence shows under one step only.
  // Lane E: what was said in a stretch put aside is not listed.
  const said = has("said") && placed && placed.synced
    ? require("../left-out.js").saidOutside(TM.sentencesForStep(placed.sentences, st, o.list), (_session() || {}).annotations) : [];
  const focus = st.step_id === focusId;
  // Lane FX2: a moment the video does not cover says so, and has no play.
  const m = hasVideo ? _moment(st) : null;
  const waste = has("waste") && !!(st.flags && st.flags.waste);
  return '<li class="sp-occ' + (focus ? " focus" : "") + '" data-step-id="' + escapeAttr(st.step_id) + '"' +
      (focus ? ' aria-current="true"' : "") + ">" +
    '<div class="sp-occ-head">' +
      (m && m.kind === "covered" ? '<button type="button" class="sp-play" title="Play this occurrence in the video above" aria-label="' +
        escapeAttr("Play " + StepFacts.occurrenceLine(st, o.run, again, origin, _clockNoun(), open)) + '">▶</button>' : "") +
      '<span class="sp-at">' + escapeHtml(StepFacts.occurrenceLine(st, o.run, again, origin, _clockNoun(), open)) + "</span>" +
      (waste ? '<span class="step-tag-waste sp-waste-tag" title="Flagged as waste: this step should not be needed">Waste</span>' : "") +
    "</div>" +
    (m && m.kind === "outside" ? '<p class="sp-nocover">' + escapeHtml(StepFacts.NOT_COVERED) + "</p>" : "") +
    (shots.length ? '<div class="sp-sec"><div class="sp-lead">Screenshots</div><div class="sp-shots">' + shots.map((sh) =>
      '<button type="button" class="sp-shot" data-ref="' + escapeAttr(sh.rel) + '" title="' +
        escapeAttr((sh.time ? sh.time + ": " : "") + "open it full size") + '"><img src="' + escapeAttr(sh.url) +
        '" alt="' + escapeAttr("Screenshot" + (sh.time ? " at " + sh.time : "")) + '"></button>').join("") + "</div></div>" : "") +
    (offer && has("screenshots") && !shots.length ? '<div class="sp-sec">' + AnalystUI.useVideoButtonHtml(offer) + "</div>" : "") +
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
  _drawHead(null, false, null);
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

/* Lane E-1: the head of the panel for `lead` (the step it highlights). With
   `editable` its name (with the library's picker), its system and its
   description are fields, drawn as the editor draws them and saved by the
   editor's own handlers (steps-view.js panelFieldCallbacks): the name on
   Enter or when it is left (Enter and Escape leave it, Escape putting back
   what it showed), the system on Enter or when it is left, the description
   when it is left (Enter is a new line there). The heading keeps the name
   for a screen reader. While one of them has the focus the panel drawn again
   leaves them as they are, so what is typed stays. Else the head is text. */
function _drawHead(lead, editable, where) {
  const nameEl = $("sp-name"), edit = $("sp-name-edit"), fields = $("sp-fields");
  if (nameEl) {
    nameEl.textContent = lead ? (lead.name || "(unnamed step)") : "";
    nameEl.classList.toggle("sr-only", !!(lead && editable));
  }
  if (!edit || !fields) return;
  if (!lead || !editable) {
    _rendering = true;
    try { edit.innerHTML = ""; fields.innerHTML = ""; } finally { _rendering = false; }
    edit.hidden = true;
    fields.hidden = true;
    _headStepId = null;
    return;
  }
  const active = document.activeElement;
  if (_headStepId === lead.step_id && active && (edit.contains(active) || fields.contains(active))) return;
  const cb = require("./steps-view.js").panelFieldCallbacks(lead);   // lazy: it requires this module
  const desc = String(cb.description || "");
  _rendering = true;
  try {
    edit.innerHTML = StepEditor.nameFieldHtml(lead, cb.picker, { input: HEAD_IDS.name, list: HEAD_IDS.list, note: HEAD_IDS.note });
    fields.innerHTML = '<p class="sp-system">' +
        AnalystUI.systemFieldHtml(lead, cb.derived, { input: HEAD_IDS.system, list: HEAD_IDS.systemList }) +
        (where && where.screen ? '<span class="sp-screen">' + escapeHtml(where.screen) + "</span>" : "") + "</p>" +
      '<label class="sp-field">Description <textarea id="' + HEAD_IDS.desc + '" placeholder="' + escapeAttr(StepEditor.DESC_HINT) +
        '" title="The text the PDD prints under this step. Saved when you leave the field">' + escapeHtml(desc) + "</textarea></label>";
  } finally { _rendering = false; }
  edit.hidden = false;
  fields.hidden = false;
  _headStepId = lead.step_id;
  const drawing = () => _rendering;
  StepEditor.wireNameField($(HEAD_IDS.name), lead, cb, { listId: HEAD_IDS.list, isRendering: drawing, leave: true });
  AnalystUI.wireSystemField($(HEAD_IDS.system), lead, drawing);
  const descEl = $(HEAD_IDS.desc);
  let shownDesc = desc.trim();
  descEl.addEventListener("blur", () => {
    if (_rendering || !descEl.isConnected) return;
    const v = descEl.value.trim();
    if (v === shownDesc) return;
    shownDesc = v;
    cb.onDescription(lead.step_id, v);
  });
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
  // Lane E-1: a step renamed here keeps the panel on it (its box is the new
  // name's).
  if (focus && mapNodeLabel(focus) !== _state.label) _state.label = mapNodeLabel(focus);
  const path = _state.path || [];
  const occ = occurrences(_state.label, runs, focus, path);
  if (!occ.length) { close(); return; }
  const open = _openIds(occ, path);
  if (!occ.some((o) => o.step.step_id === _state.focusId)) _state.focusId = occ[0].step.step_id;
  const lead = (occ.find((o) => o.step.step_id === _state.focusId) || occ[0]).step;
  const origin = recordingStartMs(s);
  const names = (s.stats && s.stats.meta && s.stats.meta.app_names) || {};
  const inter = _interactions();
  const where = SystemNames.whereOfStep(lead, inter, names);
  const datas = StepFacts.stepDatas(lead, inter);
  const desc = StepFacts.isDraftedDescription(lead.description, datas) ? "" : String(lead.description || "").trim();
  const hasVideo = Video.chainOf(s).some((c) => c.file);
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
  // Lane E-1: on the Map the name, the system and the description are
  // fields (_drawHead); read only, text. Plan D2: on Steps the editor beside
  // the panel has them, the waste flag, the flow and the count, so the panel
  // leaves them out (its heading kept for a screen reader).
  const parts = partsOn(State.getLevel());
  const has = (p) => parts.includes(p);
  const editable = headEditable(State.getLevel(), RO.isReadOnly(s));
  _drawHead(lead, editable, where);
  const nameEl = $("sp-name");
  if (nameEl && !has("name")) nameEl.classList.add("sr-only");
  const aboutHtml =
    (has("system") && !editable && (where.system || where.screen) ? '<p class="sp-system">' + escapeHtml([where.system, where.screen].filter(Boolean).join(" · ")) + "</p>" : "") +
    (has("waste") && wasted ? '<p class="sp-waste" id="sp-waste"><span class="step-tag-waste" title="Flagged as waste: this step should not be needed">Waste</span> ' +
      escapeHtml(wasted === occ.length ? "Flagged as waste" : "Flagged as waste in " + wasted + " of " + occ.length) + "</p>" : "") +
    (has("description") && !editable && desc ? '<p class="sp-desc">' + escapeHtml(desc) + "</p>" : "") +
    (has("flow") && flow ? '<p class="sp-flow" id="sp-flow" title="' + escapeAttr(flow) + '">' + escapeHtml(flow) + "</p>" : "") +
    (has("count") ? '<p class="sp-count">' + escapeHtml(countLine(occ, runs.length, open)) + "</p>" : "");
  const about = $("sp-about");
  about.innerHTML = aboutHtml;
  about.hidden = !aboutHtml;
  const video = $("sp-video");
  // Lane FX2 (validation pass 2, F7; pass 3, F14): the video shows only a
  // moment of the highlighted row: its start when the video covers it, else
  // it is hidden with one line saying the video does not cover it; a step
  // without a time shows the video's start with one line, and a frame of it
  // is taken only once the analyst goes to the step's moment.
  const focusStep = (occ.find((o) => o.step.step_id === _state.focusId) || occ[0]).step;
  const fm = hasVideo ? _moment(focusStep) : null;
  // C23: the video that shows the highlighted row's moment.
  const focusClip = hasVideo ? _clipOf(focusStep) : null;
  const src = focusClip ? Video.fileUrl(focusClip.file) : "";
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
  const placed = TM.forSession(s);
  const inRun = new Set();
  const rows = occ.map((o) => {
    const again = !!o.run && inRun.has(o.run.caseId);
    if (o.run) inRun.add(o.run.caseId);
    return _rowHtml(o, again, origin, placed, hasVideo, _state.focusId, open.has(o.step.step_id),
      editable && o.step.step_id === _state.focusId ? AnalystUI.useVideoOffer(o.step) : "", parts);
  });
  const kinds = hasVideo ? occ.map((o) => _moment(o.step).kind) : [];
  const playable = kinds.filter((k) => k === "covered").length;
  const uncovered = kinds.filter((k) => k === "outside").length;
  // Plan D2: on Steps the foot's acts are the editor's (Show on timeline on
  // its line of facts, Open sub-process in the toolbar), so it has none.
  $("sp-body").innerHTML =
    '<p class="sp-explain" id="sp-explain">' + escapeHtml(StepFacts.occurrencesLine(occ, runs.length, playable, uncovered)) + "</p>" +
    '<ol class="sp-occs">' + rows.join("") + "</ol>" +
    (has("foot") ? '<div class="sp-foot">' +
      '<button type="button" id="btn-sp-steps" title="Open this occurrence in Steps, in its transaction">Open in Steps</button>' +
      (isSub ? '<button type="button" id="btn-sp-open-sub" title="Show the map of this sub-process">▸ Open sub-process</button>' : "") +
    "</div>" : "");
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
  const clip = _clipOf(step);
  const at = m.kind === "covered" ? m.at : m.kind === "untimed" ? (clip ? clip.in_ms / 1000 : 0) : NaN;
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
  const clip = s && step ? _clipOf(step) : null;
  if (!s || !step || !clip) return { why: "There is no video to take a frame from." };
  const src = Video.fileUrl(clip.file);
  // C23: where that video's file starts on the clock (the frame's moment).
  const sp = Video.clipSpan(clip);
  const baseMs = sp ? sp.fileStartMs : NaN;
  const m = _moment(step);
  if (m.kind === "outside") return { why: StepFacts.NOT_COVERED + ": no frame of it can be taken." };
  if (m.kind === "unplaced") return { why: "The video cannot be lined up with the project, so no frame of this step can be taken." };
  const panel = $("step-panel");
  const video = $("sp-video");
  const shown = !!(panel && !panel.hidden && _state && _state.focusId === stepId && video && !video.hidden &&
    video.getAttribute("src") === src);
  if (shown && (m.kind === "covered" || _moved)) return { video, src, baseMs };
  // Lane PANE: on the Timeline the step is beside the Timeline's own video;
  // a step without a time takes the frame it shows now (the analyst played
  // it to the step's moment).
  if (State.getLevel() === "flow" && m.kind === "untimed") {
    const main = document.getElementById("video");
    const cur = Video.currentClip();
    if (main && cur && cur.file && main.getAttribute("src")) {
      const sp2 = Video.clipSpan(cur);
      return { video: main, src: Video.fileUrl(cur.file), baseMs: sp2 ? sp2.fileStartMs : NaN };
    }
  }
  if (m.kind === "covered") return { at: m.at, src, baseMs };
  // Plan D2: on Steps the panel may be closed (below 1440 px it opens only on
  // Play, which a step without a time has not): it opens on the step, at the
  // video's start, so its video can be played to the step's moment.
  if (State.getLevel() === "steps" && !shown) _openAsked(step);
  return { why: _noTime() + (State.getLevel() === "flow"
    ? ": play the video to its moment first, then add the frame."
    : ": play the step panel's video to its moment first, then add the frame.") };
}

function _show(open) {
  const panel = $("step-panel");
  if (!panel) return;
  _place();
  if (panel.hidden === !open) return;
  panel.hidden = !open;
  if (!open) {
    const v = $("sp-video");
    if (v && !v.paused) v.pause();
  }
  _place();
  // The map beside it changed size.
  try { require("../dfg-viewer.js").resize(); } catch (_) { /* no map drawn */ }
}

/* Where the panel's element lives while the page runs: beside the content,
   the last child of <main> (set when the page is wired). */
let _home = null;

/* Whether the panel, when open, takes the place of the step list (plan D2):
   on Steps, below STANDS_FROM_PX. */
function _inListNow() {
  return State.getLevel() === "steps" && !standsBeside(window.innerWidth);
}

/* Plan D2: put the panel where it shows. Open on Steps below 1440 px it is
   the first part of the Steps level's split, in the column of the step list
   (which it hides, with the divider, styles.css .sp-in-list); else it is
   beside the content as ever. A media element moved within one task keeps
   playing. */
function _place() {
  const panel = $("step-panel");
  const split = document.querySelector("#session-layout-steps .editor-split");
  if (!panel || !split || !_home) return;
  const inList = !panel.hidden && _inListNow();
  // A move takes the focus off an element moved: it is given back.
  const had = panel.contains(document.activeElement) ? document.activeElement : null;
  if (inList && panel.parentElement !== split) split.insertBefore(panel, split.firstChild);
  else if (!inList && panel.parentElement !== _home) _home.appendChild(panel);
  split.classList.toggle("sp-in-list", inList);
  if (had && !panel.hidden && document.activeElement !== had) had.focus({ preventScroll: true });
}

/* Whether the panel stands in the place of the step list now. */
function inList() {
  const panel = $("step-panel");
  return !!(panel && !panel.hidden && panel.parentElement && panel.parentElement.classList.contains("sp-in-list"));
}

/* Plan D2: the focus goes into the panel opened on demand: its video when it
   shows one (Space plays and pauses it there), else its close. */
function _focusIn() {
  const v = $("sp-video"), x = $("btn-sp-close");
  const target = v && !v.hidden && v.getAttribute("src") ? v : x;
  if (target) target.focus({ preventScroll: true });
}

/* Plan D2: the panel opened on Steps by the analyst (Play, a frame of the
   video): it stays open below 1440 px, in the list's place, and takes the
   focus there. */
function _openAsked(step) {
  _dismissed = false;
  _asked = true;
  openForStep(step);
  if (inList()) _focusIn();
}

/* The close (its button, or Escape in the list's place): on Steps it stays
   closed while rows are selected; closed in the list's place, the list
   comes back and the focus goes back to the editor's Play. */
function _closeByHand() {
  const back = inList();
  if (State.getLevel() === "steps") _dismissed = true;
  close();
  if (back) {
    const play = document.querySelector("#step-detail #btn-step-watch");
    if (play) play.focus({ preventScroll: true });
  }
}

function _reset() {
  const s = _session();
  const folder = s ? s.sessionFolder : null;
  if (folder !== _folder) {
    _folder = folder; _state = null; _dismissed = false; _cuedId = null; _followed = null; _headStepId = null; _asked = false;
    _show(false);
  }
}

/* Open the panel on a step's map box, at the step's level (C19), with that
   step as its focus. */
function openForStep(step, fromSteps) {
  _reset();
  if (!step || !_session() || !opensOn(State.getLevel())) return;
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
  if (!_session() || !opensOn(State.getLevel())) return;
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
  // Plan D2: below 1440 px the selection opens nothing (the editor keeps the
  // width); a panel opened by Play follows it while it is open.
  if (!standsBeside(window.innerWidth) && !(panel && !panel.hidden && _asked)) return;
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
  const clip = s && step ? _clipOf(step) : null;
  if (!s || !step || !video || !clip) {
    toast("No video is linked to this project.", "error");
    return;
  }
  const m = _moment(step);
  if (m.kind === "unplaced") { toast("Cannot line the video up with the project: it has no start time.", "error"); return; }
  if (m.kind === "untimed") { toast("This step starts before the video does.", "error"); return; }
  // Lane FX2: past the video's end nothing of the step is in it.
  if (m.kind === "outside") { toast(StepFacts.NOT_COVERED + ".", "error"); return; }
  // C23: from the step's start in the video showing it, to its end or that
  // video's end, whichever comes first.
  const from = m.at;
  const sp = Video.clipSpan(clip);
  const out = sp && sp.endMs != null ? (sp.endMs - sp.fileStartMs) / 1000 : Infinity;
  const to = Math.min(m.to != null ? m.to : NaN, out);
  const src = Video.fileUrl(clip.file);
  if (video.getAttribute("src") !== src) { video.setAttribute("src", src); video.hidden = false; }
  _cuedId = stepId;
  if (_state) { _state.focusId = stepId; render(); }
  const main = document.getElementById("video");
  if (main && !main.paused) main.pause();
  _stopAt = isFinite(to) && to > from ? to : null;
  const go = () => { _selfSeek = true; video.currentTime = from; video.play().catch(() => {}); };
  if (video.readyState >= 1) go(); else video.addEventListener("loadedmetadata", go, { once: true });
}

/* Play on the editor's line of facts (and the step menu's Play): the panel
   opens on the step and plays it. Plan D2: below 1440 px it opens in the
   place of the step list, and the focus goes into it. */
function watch(step) {
  if (!step) return;
  _openAsked(step);
  play(step.step_id);
  if (inList()) _focusIn();
}

function close() {
  _state = null;
  _cuedId = null;
  _asked = false;
  _show(false);
}

/* The level changed: closed where it does not open (the Overview, and
   lane PANE the Timeline), else the foot follows. Plan D2: on Steps below
   1440 px a panel the selection or the Map opened closes (only Play opens
   it there); one Play opened stays, in the list's place, and on the Map it
   stands beside the map again. */
function onLevel(name) {
  if (!opensOn(name)) { close(); return; }
  const panel = $("step-panel");
  if (name === "steps" && panel && !panel.hidden && !_asked && !standsBeside(window.innerWidth)) { close(); return; }
  _place();
  if (_state) render();
}

/* Plan D2: the window crossed STANDS_FROM_PX (a resize, or the app's zoom).
   On Steps, going narrower closes a panel the selection opened (one Play
   opened moves into the list's place); going wider, the panel stands beside
   the editor again, following the selected step unless it was closed. */
let _wide = null;
function _onWidth() {
  const wide = standsBeside(window.innerWidth);
  if (wide === _wide) return;
  _wide = wide;
  const panel = $("step-panel");
  if (!panel || State.getLevel() !== "steps") { _place(); return; }
  if (!wide && !panel.hidden && !_asked) { close(); return; }
  if (wide && panel.hidden && !_dismissed) {
    const id = State.getSelectedStepId();
    const step = id ? _find(id) : null;
    if (step) { followSteps(step); return; }
  }
  _place();
}

/* The steps changed (an edit, an undo, an analysis): draw again. */
function refresh() {
  _reset();
  if (_state) render();
}

(function wire() {
  const panel = $("step-panel");
  if (!panel) return;
  // Lane E-1: a press anywhere outside the panel leaves a field of its head
  // (saving it), even where the press keeps the focus from moving (a side
  // dragged on the Timeline), so the page's keys (S, Space, Ctrl+Z) answer
  // again and never type into the name.
  document.addEventListener("mousedown", (e) => {
    const a = document.activeElement;
    if (!a || !panel.contains(a) || panel.contains(e.target)) return;
    if (a.id === HEAD_IDS.name || a.id === HEAD_IDS.system || a.id === HEAD_IDS.desc) a.blur();
  }, true);
  panel.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest("#btn-sp-close")) { _closeByHand(); return; }
    const playBtn = t.closest(".sp-play");
    if (playBtn) { play(playBtn.closest(".sp-occ").dataset.stepId); return; }
    const shot = t.closest(".sp-shot");
    if (shot) { require("./flow-view-screenshots.js").openScreenshot(shot.dataset.ref); return; }
    // Lane E-1: "Use the video at 0:11" on the highlighted row.
    const useVideo = t.closest(".step-use-video");
    if (useVideo && _state && _state.focusId) { AnalystUI.useVideoAt(_state.focusId); return; }
    const step = _state && _find(_state.focusId);
    if (!step) return;
    if (t.closest("#btn-sp-open-sub")) {
      // C19: the sub-process's map (the Map level follows the "mapPath"
      // topic). Plan D2: the foot shows on the Map only.
      State.setMapPath((_state.path || []).concat([_state.label]));
      State.emit("mapPath");
      return;
    }
    if (t.closest("#btn-sp-steps")) {
      State.consumePendingStepJump();
      State.setSelectedStepId(step.step_id);
      State.setPendingStepReveal();
      const btn = document.querySelector('.view-mode-btn[data-level="steps"]');
      if (btn) btn.click();
    }
  });
  // Plan D2: in the place of the step list, Escape closes the panel and
  // gives the list back, the focus going back to the editor's Play.
  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || !inList()) return;
    e.preventDefault();
    e.stopPropagation();
    _closeByHand();
  });
  _home = panel.parentElement;
  _wide = standsBeside(window.innerWidth);
  window.addEventListener("resize", _onWidth);
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

module.exports = { openForStep, openForNode, openForMissing, followSteps, watch, play, close, onLevel, refresh, occurrences, countLine, frameSource,
  // Lane E-1: the head edits the step (lane PANE: a step marked on the
  // Timeline opens in the pane, by the same nameTakesFocus); where it opens.
  nameTakesFocus, headEditable, HEAD_IDS, opensOn,
  // Plan D2: what it shows on a level, and when it stands beside the Steps
  // editor or takes the place of the step list.
  partsOn, standsBeside, STANDS_FROM_PX, inList };
