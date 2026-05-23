/*
 * count-cases.js -- count anchor-detected cases for a session WITHOUT the
 * Python analytics stack (no pandas/pm4py needed). Reimplements just the
 * anchor-detection core (case_assignment.detect_cases_from_anchors) in Node,
 * which is already on this box.
 *
 * Governance-safe: prints COUNTS and timestamps only -- never the case labels
 * (serial numbers) or any captured values/titles.
 *
 * Usage:
 *   node scripts/count-cases.js <events.jsonl> [anchorField] [anchorEquals]
 * Defaults match the ATM template: automation_id == "txtsr".
 */
"use strict";
const fs = require("node:fs");

const file = process.argv[2];
const field = process.argv[3] || "automation_id";
const equals = process.argv[4] || "txtsr";
const MIN_CASE_INTERACTIONS = 2;   // degenerate-case guard (ATM template defaults)
const MIN_CASE_DURATION_MS = 1000;
if (!file) { console.error("usage: node scripts/count-cases.js <events.jsonl> [field] [equals]"); process.exit(1); }

const raw = [];
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  const s = line.trim(); if (!s) continue;
  try { raw.push(JSON.parse(s)); } catch { /* skip */ }
}
const interactions = raw.filter((e) => e.type === "interaction");

// How many interactions match the anchor field? (e.g. the serial field)
const anchorHits = interactions.filter((e) => String((e.data || {})[field] ?? "") === equals);

// Active-case stamping (NEXT-SESSION §2, option C), mirroring
// detect_cases_from_anchors: a case is STABLE PER LABEL (re-searching the same
// serial resumes its case rather than opening a new one), the most-recent
// anchor is the active case, and a degenerate-case guard drops slivers (an
// accidental anchor fire below either threshold).
const labelField = "value";
const byLabel = new Map();   // label -> { label, startTs, endTs, count }
const order = [];
let activeLabel = null;
for (const ev of interactions) {
  const d = ev.data || {};
  const ts = new Date(ev.timestamp).getTime();
  if (String(d[field] ?? "") === equals) {
    const label = String(d[labelField] ?? "");
    // Mirror case_assignment: an empty serial box does not name a case -- ignore
    // the fire and keep the current active case.
    if (label) {
      if (!byLabel.has(label)) { byLabel.set(label, { label, startTs: ts, endTs: ts, count: 0 }); order.push(label); }
      activeLabel = label;
    }
  }
  if (activeLabel) {
    const c = byLabel.get(activeLabel);
    c.endTs = ts;
    c.count += 1;
  }
}
let cases = order.map((l) => byLabel.get(l)).filter((c) =>
  c.count >= MIN_CASE_INTERACTIONS && (c.endTs - c.startTs) >= MIN_CASE_DURATION_MS);

// Governance-safe label diagnostics (counts/cardinality only -- never values):
// how many DISTINCT anchor labels existed before the degenerate guard, and how
// many anchor hits carried an empty/missing label-value (which would collapse
// every distinct case into one).
const anchorEmpty = anchorHits.filter((e) => String((e.data || {})[labelField] ?? "") === "").length;

const iso = (ms) => new Date(ms).toISOString();
console.log(`anchor: ${field} == ${equals}  (case key = data.${labelField})`);
console.log(`raw events: ${raw.length}  interactions: ${interactions.length}  anchor-field hits: ${anchorHits.length}`);
console.log(`anchor hits with empty/missing ${labelField}: ${anchorEmpty} / ${anchorHits.length}`);
console.log(`distinct anchor labels (pre-guard): ${order.length}`);
console.log(`CASES DETECTED: ${cases.length}`);
const distinctLabels = new Set(cases.map((c) => c.label)).size;
console.log(`distinct case keys (post-guard): ${distinctLabels}`);
cases.forEach((c, i) => console.log(`  case ${i + 1}: ${iso(c.startTs)} -> ${iso(c.endTs)}`));
