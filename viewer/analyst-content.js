/*
 * analyst-content.js: what the analyst adds to a step and to a session
 * (contract C16), the pure half: where a step without a time goes in its run,
 * the screenshots a step shows, the notes a step or a moment shows, and the
 * systems the System field offers. No DOM, no State: views/analyst-ui.js and
 * views/steps-view.js use it; the unit tests drive it.
 */

"use strict";

const { fileName, SHOTS_DIR } = require("./analyst-files.js");

function hasTime(step) {
  return Number.isFinite(Date.parse(step && step.time_range && step.time_range.start));
}

/* A step the analyst changes is theirs: a draft becomes edited, one they
   added stays added, and a hidden one stays hidden (Unhide then brings it
   back edited). The rule every Steps verb follows. */
function markEdited(step) {
  if (!step) return;
  if (step.state === "hidden") {
    if (step._prev_state !== "manually_authored") step._prev_state = "edited";
  } else if (step.state !== "manually_authored") {
    step.state = "edited";
  }
}

/* The state of the steps a Split, a Merge or + Step makes of `sources` (lane
   FX2, validation pass 3, F5): steps the analyst added stay added (they keep
   Delete, and the step map a manual task when they have no system), any
   other is the analyst's edit. */
function derivedState(sources) {
  const list = (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
  return list.length && list.every((s) => s.state === "manually_authored") ? "manually_authored" : "edited";
}

/* The one words for a project's implicit run (lane FX2, validation pass 3,
   F9): a project without start markers is one transaction, said the same
   way on the Checklist, the project line and the Timeline (and, by the
   pipeline, in the Observations and the PDD). */
const IMPLICIT_TRANSACTION = "One transaction (not marked)";

/* Whether the project holds a recording (C16): a capture app's recording
   does; a project made in the viewer from a video or from nothing
   (manifest.source "video" or "blank", with no events) does not, and says
   nothing is "recorded" (lane FX3, validation pass 3, F22). */
function hasRecording(sess) {
  const m = (sess && sess.manifest) || {};
  return ((sess && sess.events) || []).length > 0 || !["video", "blank"].includes(m.source);
}

/* The case_id of the session's implicit run (C16: a video or blank session
   with no run marked), or null. */
function implicitRunId(stats) {
  const row = ((stats && stats.case_stats) || []).find((c) => c && c.implicit === true && typeof c.case_id === "string");
  return row ? row.case_id : null;
}

/* ---- Steps without a time (C16: they follow the timed steps, by order) ---- */

function _untimed(members) { return (members || []).filter((s) => s && !hasTime(s)); }
function _renumber(list) { list.forEach((s, i) => { s.order = i + 1; }); }

/* Put `step` (no time) into its run: right after `after` when `after` has no
   time either, else first among the steps without a time (they come after
   every timed step); at the end without `after`. The run's steps without a
   time are numbered again from 1 (order, unique within the run). `members`
   is the run's steps in list order. */
function placeUntimed(members, step, after) {
  const list = _untimed(members).filter((s) => s !== step);
  let i = list.length;
  if (after) {
    const k = list.indexOf(after);
    i = k >= 0 ? k + 1 : hasTime(after) ? 0 : list.length;
  }
  list.splice(i, 0, step);
  _renumber(list);
}

/* Move a step without a time one place up (-1) or down (+1) past the next
   step without a time the list shows (`shown(step)`: hidden steps can be
   passed over). Renumbers the run's steps without a time. False when it
   cannot move. */
function moveUntimed(members, step, delta, shown) {
  if (!step || hasTime(step)) return false;
  const all = _untimed(members);
  const see = all.filter((s) => s === step || !shown || shown(s));
  const i = see.indexOf(step), j = i + delta;
  if (i < 0 || j < 0 || j >= see.length) return false;
  const other = see[j];
  all.splice(all.indexOf(step), 1);
  const k = all.indexOf(other);
  all.splice(delta < 0 ? k : k + 1, 0, step);
  _renumber(all);
  return true;
}

/* ---- Screenshots ----------------------------------------------------------- */

/* The screenshots a step shows, in the PDD's order: its recorder screenshots
   less the ones taken off it (hidden_screenshots), then the analyst
   screenshots whose step_id is the step. Each { kind, ref, rel, at }: `ref`
   is what pdd_screenshot names (the recorder path, or the analyst entry's
   id) and `rel` the session-relative file. */
function stepShots(step, analystShots) {
  const out = [];
  if (!step) return out;
  const hidden = new Set(Array.isArray(step.hidden_screenshots) ? step.hidden_screenshots : []);
  for (const r of (step.evidence && step.evidence.screenshot_refs) || []) {
    if (typeof r === "string" && r && !hidden.has(r)) out.push({ kind: "recorder", ref: r, rel: r, at: null });
  }
  for (const a of analystShots || []) {
    const f = a && fileName(a.file);
    if (f && a.id && a.step_id === step.step_id && !hidden.has(a.id)) {
      out.push({ kind: "analyst", ref: a.id, rel: SHOTS_DIR + "/" + f, at: a.at || null });
    }
  }
  return out;
}

/* Every screenshot with a moment, for the Timeline (lane FX2, validation
   pass 2, F11 and pass 3, F8): the recording's (its screenshot events,
   `kind` "recorded", or "manual" for the SME's screenshot key) and the ones
   the analyst added with a moment (a frame of the video: analyst_screenshots
   with an `at`, `kind` "added"), in time order (a tie keeps the recording's
   first). Each { ts, rel, kind, stepId }: `rel` the session-relative file,
   `stepId` the step an added one is on (null for a recorded one). */
function timelineShots(events, analystShots) {
  const out = [];
  for (const ev of events || []) {
    const d = ev && ev.type === "system" && ev.data;
    if (!d || (d.kind !== "screenshot" && d.kind !== "screenshot_manual") || typeof d.path !== "string" || !d.path) continue;
    if (!Number.isFinite(Date.parse(ev.timestamp))) continue;
    out.push({ ts: ev.timestamp, rel: d.path, kind: d.kind === "screenshot_manual" ? "manual" : "recorded", stepId: null });
  }
  for (const a of analystShots || []) {
    const f = a && fileName(a.file);
    if (!f || !a.id || !Number.isFinite(Date.parse(a.at))) continue;
    out.push({ ts: a.at, rel: SHOTS_DIR + "/" + f, kind: "added", stepId: typeof a.step_id === "string" ? a.step_id : null });
  }
  return out.map((x, i) => ({ x, i }))
    .sort((p, q) => (Date.parse(p.x.ts) - Date.parse(q.x.ts)) || (p.i - q.i))
    .map((p) => p.x);
}

/* How many recorder screenshots were taken off the step. */
function hiddenShotCount(step) {
  const refs = new Set((step && step.evidence && step.evidence.screenshot_refs) || []);
  return (Array.isArray(step && step.hidden_screenshots) ? step.hidden_screenshots : []).filter((h) => refs.has(h)).length;
}

/* ---- Notes ----------------------------------------------------------------- */

function _inside(ms, a, b) { return Number.isFinite(ms) && Number.isFinite(a) && Number.isFinite(b) && ms >= a && ms <= b; }

/* The notes a step shows: the ones pinned to it and the ones pinned to a
   moment inside its time, in the order they were added. */
function notesForStep(notes, step) {
  if (!step) return [];
  const a = Date.parse(step.time_range && step.time_range.start), b = Date.parse(step.time_range && step.time_range.end);
  return (notes || []).filter((n) => n && typeof n.text === "string" &&
    (n.step_id ? n.step_id === step.step_id : _inside(Date.parse(n.at), a, b)));
}

/* The notes pinned to a moment (the Timeline's Notes lane). */
function momentNotes(notes) {
  return (notes || []).filter((n) => n && !n.step_id && typeof n.text === "string" && Number.isFinite(Date.parse(n.at)));
}

/* ---- Systems ---------------------------------------------------------------- */

/* The systems the System field offers: the session's own (in the order
   given), then the shared list's, each once whatever its case. */
function systemChoices(own, shared) {
  const out = [], seen = new Set();
  for (const s of [...(own || []), ...(shared || [])]) {
    const t = typeof s === "string" ? s.trim() : "";
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out;
}

module.exports = {
  hasTime, markEdited, derivedState, hasRecording, implicitRunId, IMPLICIT_TRANSACTION, placeUntimed, moveUntimed,
  stepShots, hiddenShotCount, timelineShots, notesForStep, momentNotes, systemChoices,
};
