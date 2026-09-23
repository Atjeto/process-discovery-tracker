/*
 * inspect-events.js -- STRUCTURE-ONLY inspector for a captured events.jsonl.
 *
 * Purpose: answer the ADR-0009 AG-Grid fact-find (what UIA fields does the
 * recorder populate for a Chrome/Edge-hosted grid, and does cell-to-cell
 * navigation emit events) WITHOUT exposing any captured content.
 *
 * It deliberately NEVER prints `value` (user-typed text) or `window_title`
 * (can carry customer names). It prints only structural UIA fields --
 * control_type, framework_id, class_name, coverage_hint -- which are
 * app/developer-defined, not runtime data. `automation_id` is reported as a
 * presence count only (how many interactions carry one), never its value:
 * a web page's element ids can embed record ids (RP-27). The output is safe
 * to paste into a chat / ticket.
 *
 * Run on a machine with Node (e.g. the dev box):
 *   node scripts/inspect-events.js <path-to-events.jsonl> [titleFilterSubstring]
 *
 * The optional title filter (e.g. "TAMBA") restricts the report to events
 * whose window_title contains it -- matched internally, never printed --
 * so you can isolate one web app without leaking its titles.
 */
"use strict";

const fs = require("node:fs");

const file = process.argv[2];
const titleFilter = (process.argv[3] || "").toLowerCase();
if (!file) {
  console.error("usage: node scripts/inspect-events.js <events.jsonl> [titleFilter]");
  process.exit(1);
}

const interactions = [];
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  const s = line.trim();
  if (!s) continue;
  let ev;
  try { ev = JSON.parse(s); } catch { continue; }
  if (ev.type !== "interaction") continue;
  const d = ev.data || {};
  if (titleFilter && !String(d.window_title || "").toLowerCase().includes(titleFilter)) continue;
  interactions.push(ev);
}

function tally(arr, key) {
  const m = {};
  for (const v of arr) { const k = v[key]; if (k) m[k] = (m[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 25));
}

const byProc = {};
for (const ev of interactions) {
  const d = ev.data || {};
  const p = d.process_name || "(none)";
  const b = byProc[p] || (byProc[p] = { count: 0, datas: [] });
  b.count++; b.datas.push(d);
}

const report = {};
for (const [proc, b] of Object.entries(byProc)) {
  // §11e per-element confidence: mean over the events that carry it (older
  // captures predate the field, so average only where present).
  const withConf = b.datas.filter((d) => typeof d.confidence === "number");
  const meanConfidence = withConf.length
    ? Math.round(100 * withConf.reduce((s, d) => s + d.confidence, 0) / withConf.length) / 100
    : null;
  report[proc] = {
    interactions: b.count,
    kinds: tally(b.datas, "kind"),
    control_types: tally(b.datas, "control_type"),
    framework_ids: tally(b.datas, "framework_id"),
    frameworks: tally(b.datas, "framework"),            // §11e normalized UI-toolkit detection
    class_names: tally(b.datas, "class_name"),          // the AG-Grid discriminator candidate
    with_automation_id: b.datas.filter((d) => d.automation_id).length, // presence count, never the ids (RP-27)
    coverage_hint: tally(b.datas, "coverage_hint"),
    identity_sources: tally(b.datas, "identity_source"), // §11e identity-ladder rung
    mean_confidence: meanConfidence,                     // §11e mean capture confidence [0,1]
    value_sources: tally(b.datas, "value_source"),       // §11e recovered-value source (label only, not the value)
    pct_with_automation_id: Math.round(100 * b.datas.filter((d) => d.automation_id).length / b.count),
    pct_with_name: Math.round(100 * b.datas.filter((d) => d.name).length / b.count),
    pct_with_value: Math.round(100 * b.datas.filter((d) => d.value != null).length / b.count),
  };
}

console.log("=== STRUCTURE SUMMARY (no values, no titles) ===");
console.log(JSON.stringify(report, null, 2));

// Sequence sample for the busiest process -- shows whether moving between
// fields/cells emits distinct events and what (if anything) discriminates them.
const busiest = Object.entries(byProc).sort((a, b) => b[1].count - a[1].count)[0];
if (busiest) {
  console.log("\n=== SEQUENCE SAMPLE for " + busiest[0] + " (first 50, structural only) ===");
  console.log("kind | control_type | automation_id? | class_name | framework_id | framework | identity_source | conf | name? | value?");
  for (const d of busiest[1].datas.slice(0, 50)) {
    console.log([
      d.kind || "-",
      d.control_type || "-",
      d.automation_id ? "Y" : "-",
      d.class_name || "-",
      d.framework_id || "-",
      d.framework || "-",
      d.identity_source || "-",
      typeof d.confidence === "number" ? d.confidence.toFixed(2) : "-",
      d.name ? "Y" : "-",
      d.value != null ? "Y" : "-",
    ].join(" | "));
  }
}
