/*
 * step-facts.js: what the step pane and the step panel say about one step,
 * built from the step's structured fields and its recorded interactions,
 * never by reading the pipeline's reason sentence (companion critique,
 * section 3):
 *   factLine   "Salesforce · Account lookup · 6s · ends at Search · Transaction 1 at 0:19"
 *   typedFields the fields typed in the step, (field, value) as the PDD lists them
 *   draftedNarration / isDraftedDescription  the drafting's own description,
 *              which the step pane shows as a hint, not as the description
 *   draftedName the name the drafting gives a step (the Saved names dialog's
 *              Forget gives it back)
 * Twins of normalization/step_suggest.py (_default_step_description,
 * _draft_screen, _commit_label) and pdd_export.py (_entered, position).
 *
 * Pure: no DOM, no State.
 */

"use strict";

const { screenType, valueFree } = require("./process-map-levels.js");
const { sinceStart } = require("./dom.js");

const ELLIPSIS = String.fromCharCode(0x2026);
const NOISE = new Set(["null", "(null)", "undefined", "(undefined)"]);
const MASKED = "(masked value)";

function _text(v) { return typeof v === "string" ? v.trim() : ""; }

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

/* ---- the fields typed (pdd_export._entered) -------------------------------- */

function _entered(d) {
  let value;
  if (d.kind === "value_changed" || d.kind === "text_changed") {
    if (d.value_redacted === true) value = "(not recorded: secret field)";
    else {
      value = _text(d.value);
      if (!value || NOISE.has(value.toLowerCase())) return null;
    }
  } else if (d.kind === "selection_changed" && d.control_type !== "TabItem" && d.control_type !== "Tab") {
    value = _text(d.selected_value);
    if (!value) return null;
  } else return null;
  if (value.length > 200) value = value.slice(0, 199) + ELLIPSIS;
  const field = _text(d.meaningful_name) || _text(d.name) || _text(d.automation_id) || "(unnamed field)";
  return { field, value };
}

/* [{ field, value }] of the fields typed in a step: each field once, in the
   order first typed, with the last value it got. */
function typedFields(datas) {
  const byField = new Map();
  for (const d of datas || []) {
    const e = _entered(d || {});
    if (e) byField.set(e.field, e.value);
  }
  return [...byField].map(([field, value]) => ({ field, value }));
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

function _phrase(d) {
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
    if (value === MASKED) return "entered a masked value into " + field + keys;
    if (value) return "entered \"" + value + "\" into " + field + keys;
    if (raw) return "edited " + field + keys;
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

function draftedNarration(datas) {
  const list = datas || [];
  const phrases = list.map((d) => _phrase(d || {})).filter(Boolean);
  if (!phrases.length) return list.length + " action" + (list.length === 1 ? "" : "s") + " with no recorded detail.";
  const sentences = phrases.slice(0, 6).map((p) => p.charAt(0).toUpperCase() + p.slice(1) + ".");
  const extra = phrases.length - 6;
  if (extra > 0) sentences.push("Plus " + extra + " more action" + (extra === 1 ? "" : "s") + ".");
  return sentences.join(" ");
}

/* True when `description` is the drafting's own text for these interactions
   (or its older wording for a step with nothing to narrate): the step pane
   shows it as a hint and the PDD leaves it out. */
function isDraftedDescription(description, datas) {
  const desc = _text(description);
  if (!desc || !datas) return false;
  return desc === draftedNarration(datas) || /^\d+ interactions? with no recorded detail\.$/.test(desc);
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

/* The name the drafting gives a step with a draft_key: "<screen>: <commit>",
   or the screen alone for a step that did not end at a commit. "" when its
   interactions are not in the session. */
function draftedName(step, datas) {
  if (!step || !datas || !datas.length) return "";
  const first = datas[0];
  const screen = _text(first.screen_id) || (_text(first.window_title) ? screenType(first.window_title) : "") || "(screen)";
  return step.end_reason === "commit" ? screen + ": " + commitName(datas[datas.length - 1]) : screen;
}

/* ---- where a step is in the recording ------------------------------------- */

/* "Transaction 1 at 0:19" (the PDD's pointer; the run's title, AD-29), or
   "0:19 into the recording" for a step outside every run; `runs` as
   runs-model.buildRuns returns them. */
function pointer(step, runs, originMs) {
  const at = sinceStart(step && step.time_range && step.time_range.start, originMs);
  if (!at) return "";
  const run = (runs || []).find((r) => r.caseId === (step && step.case_id));
  return run ? run.title + " at " + at : at + " into the recording";
}

/* The step's time on screen: "42s", "2:17", "1h04". */
function duration(tr) {
  return formatMs(Date.parse(tr && tr.end) - Date.parse(tr && tr.start));
}

/* A time in ms the way a step's shows: "42s", "2:17", "1h04" ("" when unknown). */
function formatMs(ms) {
  if (!isFinite(ms) || ms < 0) return "";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return secs + "s";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + ":" + String(secs % 60).padStart(2, "0");
  return Math.floor(mins / 60) + "h" + String(mins % 60).padStart(2, "0");
}

/* The step pane's one fact line: the system first, then the screen, the
   time, where a draft ends and where the step is in the recording. */
function factLine(parts) {
  const p = parts || {};
  return [p.system, p.screen, p.duration, p.ends, p.pointer].filter(Boolean).join(" · ");
}

module.exports = {
  stepDatas, typedFields, draftedNarration, isDraftedDescription, commitName, endsAt, draftedName,
  pointer, duration, formatMs, factLine,
};
