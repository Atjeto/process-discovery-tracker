/*
 * rows-freshness.js: whether the Overview's rows are as new as the steps
 * (lane CC). The rows of the PDD's sections 5 and 6 (analysis.json
 * `pdd_data`, `pdd_time`) are measured by the analysis; the analyst can
 * change the steps after it (a rename in Steps). The pipeline records the
 * signature of the steps it measured (`steps_signature`,
 * normalization/steps_signature.py); this module takes the same signature of
 * the steps on screen, and holds the rule the Overview follows as it opens
 * (overview-view.js refreshRowsIfOlder). Pinned with the pipeline by
 * shared/steps-signature-golden.json. Pure (node:crypto only).
 *
 * The signature is the SHA-256 (hex) of one JSON text: the reference
 * transaction's case id, then every step in the list's order as the fields
 * the rows read (its id, transaction, name, state, time range, order, system,
 * draft keys and recorded interactions), its sub-steps the same way. Typing
 * in the document never changes it, and neither does a step's description,
 * notes, flow or screenshots.
 */

"use strict";

const crypto = require("node:crypto");

/* The quiet line over the rows. */
const REFRESHING = "From the last analysis; refreshing";
const OLDER = "From the last analysis; the steps changed since.";

const _text = (v) => (typeof v === "string" ? v : null);
const _number = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const _texts = (v) => (Array.isArray(v) ? v.map(_text) : null);
const _object = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

function _stepRow(step) {
  const st = _object(step);
  if (!st) return null;
  const span = _object(st.time_range) || {};
  const evidence = _object(st.evidence) || {};
  return [_text(st.step_id), _text(st.case_id), _text(st.name), _text(st.state),
    _text(span.start), _text(span.end), _number(st.order), _text(st.system), _text(st.draft_key),
    _texts(st.draft_keys), _texts(evidence.interaction_event_ids),
    Array.isArray(st.sub_steps) ? st.sub_steps.map(_stepRow) : null];
}

/* The JSON text the signature is taken of (the pipeline builds the same
   text with json.dumps). */
function signatureText(annotations) {
  const anno = _object(annotations) || {};
  const pattern = _object(anno.pattern_run) || {};
  const steps = Array.isArray(anno.steps) ? anno.steps : [];
  return JSON.stringify([_text(pattern.case_id), steps.map(_stepRow)]);
}

/* The signature of the steps (and the reference transaction) of one
   annotations object. */
function stepsSignature(annotations) {
  return crypto.createHash("sha256").update(signatureText(annotations), "utf8").digest("hex");
}

/* The rows against the steps on screen: null when there are none to judge
   (no session or analysis, annotations that cannot be read, or an analysis
   from before the rows, which the project analyzes again as it opens);
   "current" when they were measured from these steps; "older" when the steps
   changed since (or the analysis recorded no signature). */
function rowsAge(sess) {
  const analysis = sess && _object(sess.analysis);
  if (!analysis || sess.annotationsError) return null;
  if (!("pdd_data" in analysis) && !("pdd_time" in analysis)) return null;
  return analysis.steps_signature === stepsSignature(sess.annotations) ? "current" : "older";
}

/* The rule, as the Overview opens: the signature to analyze for when the
   rows are older than the steps, no analysis is queued or running, the
   analyst is not typing in a text field of the Overview, and no refresh ran
   for these steps yet (`tried`: "<folder>|<signature>" of the last one that was not
   stopped); else null. */
function refreshNeed(sess, opts) {
  const o = opts || {};
  if (!sess || !sess.sessionFolder || o.busy || o.typing) return null;
  if (rowsAge(sess) !== "older") return null;
  const signature = stepsSignature(sess.annotations);
  if (o.tried === sess.sessionFolder + "|" + signature) return null;
  return signature;
}

/* The line over the rows: none while they are current (or there are none),
   REFRESHING while an analysis measures them again, OLDER otherwise. */
function freshnessLine(age, refreshing) {
  if (age !== "older") return "";
  return refreshing ? REFRESHING : OLDER;
}

module.exports = { stepsSignature, signatureText, rowsAge, refreshNeed, freshnessLine, REFRESHING, OLDER };
