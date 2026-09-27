/*
 * step-facts.js: what the step pane and the step panel say about one step,
 * built from the step's structured fields and its recorded interactions,
 * never by reading the pipeline's reason sentence (companion critique,
 * section 3):
 *   recordedLine  the step pane's Recorded line, "6 actions on Account
 *              lookup · took 6s · ends at Search" (2.0.1)
 *   draftedNarration / isDraftedDescription  the drafting's own description,
 *              which the step pane does not show as the description
 *   occurrenceLine / occurrencesLine  the step panel's rows and the line
 *              above them ("Transaction 2, again · 2:14 into the recording ·
 *              took 9s"; "This step happened 5 times: ...")
 * Twins of normalization/step_suggest.py (_default_step_description,
 * _draft_screen, _commit_label).
 *
 * Pure: no DOM, no State.
 */

"use strict";

const { valueFree } = require("./process-map-levels.js");
const { sinceStart, formatDuration } = require("./dom.js");

const ELLIPSIS = String.fromCharCode(0x2026);
const NOISE = new Set(["null", "(null)", "undefined", "(undefined)"]);
const MASKED = "(masked value)";
/* What a secret the recorder redacted (value_redacted) reads as its value:
   "Password typed (hidden)" (pdd_export.SECRET_VALUE). */
const SECRET_VALUE = "typed (hidden)";
/* U+FFFC, the object character Chrome reads from an empty input. */
const OBJECT_CHAR = String.fromCharCode(0xfffc);

function _text(v) { return typeof v === "string" ? v.trim() : ""; }

/* True for a value made only of U+FFFC and whitespace: an empty field, not a
   typed value (recorder_noise.is_blank_value). */
function isBlankValue(v) {
  return typeof v === "string" && !v.split(OBJECT_CHAR).join("").trim();
}

/* The interaction data of a step, in its order; null when an id is not in
   the session (then nothing can be recomputed). */
function stepDatas(step, interactionsById) {
  const ids = (step && step.evidence && step.evidence.interaction_event_ids) || [];
  const out = [];
  for (const id of ids) {
    const ev = interactionsById && interactionsById[id];
    if (!ev) return null;
    out.push(ev.data || {});
  }
  return out;
}

/* ---- the drafting's narration (step_suggest._default_step_description) ---- */

function _display(v) {
  const s = _text(v);
  if (!s || NOISE.has(s.toLowerCase())) return "";
  return /^«[^»]*»$/.test(s) ? MASKED : s;
}

/* Python's `(a or b or "").strip()`: the first non-empty value, then trimmed. */
function _or(...vals) {
  const v = vals.find((x) => x);
  return v ? String(v).trim() : "";
}

/* `legacy`: the wording before lane LF-PIPE, where a redacted secret and a
   value the recorder did not record both read "cleared" (step_suggest
   _describe_interaction). */
function _phrase(d, legacy) {
  const kind = d.kind;
  const name = _or(d.meaningful_name, d.name);
  const ctl = d.control_type || "";
  const target = name || _or(d.automation_id);
  const field = target || "a control";
  if (kind === "value_changed") {
    const raw = _or(d.value);
    let value = _display(raw);
    if (value.length > 160) value = value.slice(0, 159) + ELLIPSIS;
    const count = d._coalesced_count || 0;
    const keys = count > 1 ? " (" + count + " keystrokes)" : "";
    if (!legacy && d.value_redacted === true) return "typed " + field + " (hidden)" + keys;
    if (value === MASKED) return "entered a masked value into " + field + keys;
    if (value) return "entered \"" + value + "\" into " + field + keys;
    if (raw || (!legacy && (d.value === undefined || d.value === null))) return "edited " + field + keys;
    return "cleared " + field + keys;
  }
  if (kind === "text_changed") return "edited " + field;
  if (kind === "invoked") {
    if (!name) return null;
    if (ctl === "MenuItem") return "opened " + name;
    if (ctl === "Hyperlink") return "followed " + name;
    return "clicked " + name;
  }
  if (kind === "selection_changed") {
    const sel = _or(d.selected_value);
    if (ctl === "TabItem" || ctl === "Tab") return (sel || name) ? "switched to " + (sel || name) : null;
    if (sel) return name ? "selected \"" + sel + "\" in " + name : "selected \"" + sel + "\"";
    return null;
  }
  if (kind === "toggle_changed") {
    const state = _or(d.toggle_state).toLowerCase();
    if (state === "on") return "turned " + field + " on";
    if (state === "off") return "turned " + field + " off";
    if (state === "indeterminate") return "set " + field + " to indeterminate";
    return "toggled " + field;
  }
  if (kind === "focus_changed") return null;
  if (kind) return target ? String(kind).replace(/_/g, " ") + " on " + target : null;
  return null;
}

function draftedNarration(datas, legacy) {
  const list = datas || [];
  const phrases = list.map((d) => _phrase(d || {}, legacy)).filter(Boolean);
  if (!phrases.length) return list.length + " action" + (list.length === 1 ? "" : "s") + " with no recorded detail.";
  const sentences = phrases.slice(0, 6).map((p) => p.charAt(0).toUpperCase() + p.slice(1) + ".");
  const extra = phrases.length - 6;
  if (extra > 0) sentences.push("Plus " + extra + " more action" + (extra === 1 ? "" : "s") + ".");
  return sentences.join(" ");
}

/* True when `description` is the drafting's own text for these interactions
   (its wording before lane LF-PIPE too, or its older wording for a step with
   nothing to narrate): the step pane shows it as a hint and the PDD leaves
   it out. */
function isDraftedDescription(description, datas) {
  const desc = _text(description);
  if (!desc || !datas) return false;
  return desc === draftedNarration(datas) || desc === draftedNarration(datas, true)
    || /^\d+ interactions? with no recorded detail\.$/.test(desc);
}

/* ---- where a draft ends, and its drafted name -------------------------------- */

/* The words of the control that committed a step (step_suggest._commit_label). */
function commitName(d) {
  return valueFree(d && d.meaningful_name) || valueFree(d && d.name) || _text(d && d.control_type) || "?";
}

/* "ends at Search", "ends at a screen change", "ends with the transaction":
   where a step that is still one draft ends (a split or a merge drops
   end_reason). */
function endsAt(step, datas) {
  const why = step && step.end_reason;
  if (why === "commit") {
    const last = datas && datas.length ? datas[datas.length - 1] : null;
    return last ? "ends at " + commitName(last) : "";
  }
  if (why === "screen_change") return "ends at a screen change";
  if (why === "run_end") return step.case_id ? "ends with the transaction" : "";
  return "";
}

/* ---- where a step is in the recording ------------------------------------- */

/* "Transaction 1 at 0:19" (the run's title, AD-29), or "0:19 into the
   recording" for a step outside every run; "" without a time. `runs` as
   runs-model.buildRuns returns them. */
function pointer(step, runs, originMs) {
  const at = sinceStart(step && step.time_range && step.time_range.start, originMs);
  if (!at) return "";
  const run = (runs || []).find((r) => r.caseId === (step && step.case_id));
  return run ? run.title + " at " + at : at + " into the recording";
}

/* The step's time on screen: "42s", "2m 17s", "1h 04m". */
function duration(tr) {
  return formatMs(Date.parse(tr && tr.end) - Date.parse(tr && tr.start));
}

/* A time in ms the way a step's shows (dom.js formatDuration, the one rule
   for durations): "under 1s", "42s", "2m 17s", "1h 04m"; "" when unknown. */
function formatMs(ms) {
  return formatDuration(ms);
}

/* The step pane's Recorded line (2.0.1, the owner's review: each fact once,
   in words): how many actions and where a draft ends. The screen, the time
   and how long are the head's line. */
function recordedLine(parts) {
  const p = parts || {};
  const n = p.actions || 0;
  return [n ? (n === 1 ? "1 action" : n + " actions") : "", p.ends].filter(Boolean).join(" · ");
}

/* The step panel's rows and the line above them (the owner's review of the
   panel). */

function _times(n) { return n === 1 ? "once" : n === 2 ? "twice" : n + " times"; }

/* "1, 3 and 4"; a stretch of three or more in a row reads "1 to 4". */
function _numberList(ns) {
  const parts = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    if (j - i >= 2) { parts.push(ns[i] + " to " + ns[j]); i = j; } else parts.push(String(ns[i]));
  }
  return parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : (parts[0] || "");
}

/* One row of the step panel, one time the step happened: "Transaction 1 ·
   0:39 into the recording · took 8s". `again`: an earlier row is in the same
   transaction ("Transaction 2, again"). A step outside every transaction
   reads "Outside the transactions", one added by hand "no time in the
   recording". `run` as runs-model.buildRuns returns it, or null. Lane FX3
   (validation pass 3, F22): `clock` names what the time is in, "recording"
   (the default), "video" in a project made from a video, or "" in a project
   with neither, where a step added by hand reads "no time". */
function occurrenceLine(step, run, again, originMs, clock) {
  const tr = step && step.time_range;
  const at = sinceStart(tr && tr.start, originMs);
  const took = duration(tr);
  const noun = clock === undefined || clock === null ? "recording" : String(clock);
  return [
    run ? run.title + (again ? ", again" : "") : "Outside the transactions",
    at ? at + (noun ? " into the " + noun : "") : noun ? "no time in the " + noun : "no time",
    took ? "took " + took : "",
  ].filter(Boolean).join(" · ");
}

/* Where a step's moment is in the project's video (lane FX2, validation
   pass 2, F7): { kind: "covered", at, to } (seconds into the video, `to`
   null without an end), { kind: "outside", at } (the video does not cover
   its start: before the video starts, or at or after its end once its
   length is known), { kind: "untimed" } (a step without a time) or
   { kind: "unplaced" } (the video cannot be lined up with the project).
   `videoStartMs`: the video's 0:00 on the project's clock; `lengthMs`: the
   video's length, NaN while unknown (a start at or after 0 then counts as
   covered). Pure. */
function videoMoment(step, videoStartMs, lengthMs) {
  const tr = step && step.time_range;
  const start = Date.parse(tr && tr.start);
  if (!Number.isFinite(start)) return { kind: "untimed" };
  if (!Number.isFinite(videoStartMs)) return { kind: "unplaced" };
  const at = (start - videoStartMs) / 1000;
  if (at < 0 || (Number.isFinite(lengthMs) && lengthMs > 0 && at * 1000 >= lengthMs)) return { kind: "outside", at };
  const end = Date.parse(tr && tr.end);
  return { kind: "covered", at, to: Number.isFinite(end) ? (end - videoStartMs) / 1000 : null };
}

/* The line a row of the step panel shows when the video does not cover its
   moment (it then has no play button). */
const NOT_COVERED = "The video does not cover this moment";

/* The line above the step panel's rows, built from the rows: how many times
   the step happened, in which transactions, and what a row's play does.
     rows      [{ run }] in the panel's order (run with its ordinal, or null
               for a step outside every transaction)
     runCount  how many transactions the project has
     playable  how many of the rows have a play button
     uncovered how many rows have a time the video does not cover (lane FX2)
   "This step happened 5 times: once in transactions 1, 3 and 4, twice in
   transaction 2. Play any of them." */
function occurrencesLine(rows, runCount, playable, uncovered) {
  const list = rows || [];
  const total = list.length;
  if (!total) return "";
  const perRun = new Map();
  let outside = 0;
  for (const r of list) {
    const n = r && r.run ? r.run.ordinal : NaN;
    if (Number.isFinite(n)) perRun.set(n, (perRun.get(n) || 0) + 1); else outside++;
  }
  const ordinals = [...perRun.keys()].sort((a, b) => a - b);
  let where;
  if (!ordinals.length) where = ", outside the transactions";
  else if (!outside && ordinals.length === 1) where = " in transaction " + ordinals[0];
  else {
    const counts = [...new Set(ordinals.map((o) => perRun.get(o)))].sort((a, b) => a - b);
    if (!outside && counts.length === 1 && ordinals.length === runCount) where = ": " + _times(counts[0]) + " in each transaction";
    else {
      const groups = counts.map((k) => {
        const ns = ordinals.filter((o) => perRun.get(o) === k);
        return _times(k) + " in transaction" + (ns.length === 1 ? " " : "s ") + _numberList(ns);
      });
      if (outside) groups.push(_times(outside) + " outside the transactions");
      where = ": " + groups.join(", ");
    }
  }
  const can = Math.max(0, Math.min(total, playable || 0));
  const play = !can ? "" : can === total ? (total === 1 ? " Play it." : " Play any of them.")
    : uncovered > 0 ? (can === 1 ? " Play the one the video covers." : " Play the ones the video covers.")
      : can === 1 ? " Play the one with a time." : " Play the ones with a time.";
  return "This step happened " + _times(total) + where + "." + play;
}

module.exports = {
  stepDatas, draftedNarration, isDraftedDescription, commitName, endsAt,
  pointer, duration, formatMs, recordedLine, occurrenceLine, occurrencesLine, videoMoment, NOT_COVERED,
  SECRET_VALUE, isBlankValue,
};
