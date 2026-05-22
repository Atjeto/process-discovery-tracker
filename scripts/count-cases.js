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
const MIN_GAP_MS = 10000;          // same defaults as the ATM template
const CLOSE_ON_PAUSE_MS = 300000;
if (!file) { console.error("usage: node scripts/count-cases.js <events.jsonl> [field] [equals]"); process.exit(1); }

const raw = [];
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  const s = line.trim(); if (!s) continue;
  try { raw.push(JSON.parse(s)); } catch { /* skip */ }
}
const interactions = raw.filter((e) => e.type === "interaction");

// How many interactions match the anchor field? (e.g. the serial field)
const anchorHits = interactions.filter((e) => String((e.data || {})[field] ?? "") === equals);

// Same-label-within-min-gap dedup, mirroring detect_cases_from_anchors.
const labelField = "value";
let cases = [];
let open = null;
for (const ev of interactions) {
  const d = ev.data || {};
  const ts = new Date(ev.timestamp).getTime();
  if (String(d[field] ?? "") === equals) {
    const label = String(d[labelField] ?? "");
    if (open) {
      if (label === open.label && (ts - open.lastTs) <= MIN_GAP_MS) { open.lastTs = ts; continue; }
      open.endTs = open.lastTs; cases.push(open);
    }
    open = { label, startTs: ts, endTs: ts, lastTs: ts };
  } else if (open) {
    open.lastTs = ts;
  }
}
if (open) { open.endTs = open.lastTs; cases.push(open); }

// close_on_pause_ms split (a long internal pause splits a case).
const split = [];
for (const c of cases) {
  const evs = interactions.filter((e) => {
    const t = new Date(e.timestamp).getTime();
    return t >= c.startTs && t <= c.endTs;
  });
  if (evs.length < 2) { split.push(c); continue; }
  let seg = [evs[0]];
  const segs = [seg];
  for (let i = 1; i < evs.length; i++) {
    const gap = new Date(evs[i].timestamp) - new Date(evs[i - 1].timestamp);
    if (gap > CLOSE_ON_PAUSE_MS) { seg = [evs[i]]; segs.push(seg); }
    else seg.push(evs[i]);
  }
  if (segs.length === 1) split.push(c);
  else for (const sg of segs) split.push({ label: c.label, startTs: new Date(sg[0].timestamp).getTime(), endTs: new Date(sg[sg.length - 1].timestamp).getTime() });
}
cases = split;

const iso = (ms) => new Date(ms).toISOString();
console.log(`anchor: ${field} == ${equals}`);
console.log(`raw events: ${raw.length}  interactions: ${interactions.length}  anchor-field hits: ${anchorHits.length}`);
console.log(`CASES DETECTED: ${cases.length}`);
const distinctLabels = new Set(cases.map((c) => c.label)).size;
console.log(`distinct case keys: ${distinctLabels}`);
cases.forEach((c, i) => console.log(`  case ${i + 1}: ${iso(c.startTs)} -> ${iso(c.endTs)}`));
