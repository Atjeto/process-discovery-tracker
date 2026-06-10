"use strict";

/*
 * Unit tests for the Copy-for-LLM export + import (lab-phase §C3).
 *
 * The egress contract under test: the built document carries ONLY the
 * derived stream — no screenshot refs, no event/step id lists, no raw
 * typed values (tokens instead, in the evidence AND inside the claim
 * sentence), and window/step labels pass the shared value-free strip.
 * The import half: parse → match → apply ONLY approved rows. Run with
 * `npm test`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildLlmExport, exportText, scrubFinding, vocabSkeleton, stepGroups,
  vocabRowKey, parseSuggestions, matchSuggestions, applySuggestionsToVocab,
  maskLabel,
} = require("./llm-export.js");

/* ---- fixtures ---------------------------------------------------------- */

const REKEY_FINDING = {
  id: "rekey_transfer-abc123",
  detector: "rekey_transfer",
  claim: '2 distinct values were typed into 2+ different apps -- e.g. "ACC-2231" was entered in chrome.exe, excel.exe (4 typings).',
  evidence: {
    rekey_count: 2,
    values: [
      { value: "ACC-2231", apps: ["chrome.exe", "excel.exe"], entry_count: 4, fields: ["Account number"] },
      { value: "Jane Doe", apps: ["chrome.exe", "outlook.exe"], entry_count: 2, fields: [] },
    ],
    event_ids: ["e1", "e2", "e3"],
  },
  tier: 1,
  confidence_note: "Matched by exact value equality on the derived stream.",
};

const SINK_FINDING = {
  id: "screen_time_sink-def456",
  detector: "screen_time_sink",
  claim: "Excel accounts for 41% of measured foreground time (1h 02m of 2h 31m).",
  evidence: {
    app: "Excel", foreground_ms: 3720000, share: 0.41, active_ms: 9060000,
    top_apps: [{ app: "Excel", ms: 3720000, share: 0.41 }],
    screenshot_refs: ["screenshots/shot-0042.png"],
    step_ids: ["s1", "s2"],
  },
  tier: 1,
  confidence_note: "Foreground-window time summed from focus events.",
};

const VOCAB = {
  id: "orders", name: "Orders", version: 1,
  scope: { process_name: "orders.exe" },
  screens: [{ id: "order", name: "New Order ORD-10042", window_title_regex: ".*Order.*" }],
  interactions: [
    { signature: { control_type: "Edit", automation_id: "order-id" },
      name: "Order ID", verb: "enter", carries_value: true, screen: "order", seen_count: 3 },
    { signature: { control_type: "Button", automation_id: "save-order" },
      name: "Save order", verb: "submit", completion: true },
    { signature: { control_type: "Button", name: "Search" }, name: "" },
  ],
};

const STEPS = [
  { state: "auto_suggested", name: "Orders: Search — ORD-10042",
    process_label: "Orders: Search",
    time_range: { start: "2026-06-01T09:00:00Z", end: "2026-06-01T09:00:30Z" },
    grain_keys: { app: "orders" } },
  { state: "edited", name: "Orders: Search — ORD-10055",
    process_label: "Orders: Search",
    time_range: { start: "2026-06-01T09:05:00Z", end: "2026-06-01T09:05:20Z" },
    grain_keys: { app: "orders" } },
  { state: "hidden", name: "Noise", process_label: "Noise",
    time_range: { start: "2026-06-01T09:06:00Z", end: "2026-06-01T09:07:00Z" } },
];

function buildFull() {
  return buildLlmExport({
    vocabs: [VOCAB],
    session: {
      analysis: {
        case_quality: { mode: "markers", case_count: 3, coverage: 0.94, tier2_unlocked: true },
        facts: { active_ms: 9060000, idle_ms: 60000, top_apps: [{ app: "Excel", ms: 1, share: 0.4 }], rekey_count: 2 },
        findings: [REKEY_FINDING, SINK_FINDING],
      },
      annotations: { steps: STEPS },
    },
    posture: "reviewable",
    surface: "overview",
  });
}

/* ---- the egress contract ------------------------------------------------ */

test("raw typed values never appear — tokenized in evidence AND claim", () => {
  const text = JSON.stringify(buildFull());
  assert.ok(!text.includes("ACC-2231"), "raw value leaked: ACC-2231");
  assert.ok(!text.includes("Jane Doe"), "raw value leaked: Jane Doe");
  const doc = buildFull();
  const rekey = doc.pdt_copy_for_llm.session.findings.find((f) => f.detector === "rekey_transfer");
  assert.equal(rekey.evidence.values[0].value_token, "value-1");
  assert.equal(rekey.evidence.values[1].value_token, "value-2");
  assert.ok(rekey.claim.includes('"value-1"'), "claim should carry the token");
  // The vocab-named fields survive (they are analyst-authored, value-free).
  assert.deepEqual(rekey.evidence.values[0].fields, ["Account number"]);
});

test("screenshot refs and id lists are stripped from every finding", () => {
  const text = JSON.stringify(buildFull());
  assert.ok(!text.includes("screenshot_refs"), "screenshot refs leaked");
  assert.ok(!text.includes("shot-0042"), "screenshot path leaked");
  const sink = buildFull().pdt_copy_for_llm.session.findings.find((f) => f.detector === "screen_time_sink");
  assert.equal(sink.evidence.screenshot_refs, undefined);
  assert.equal(sink.evidence.step_ids, undefined);
  assert.equal(sink.evidence.event_ids, undefined);
  assert.equal(sink.evidence.share, 0.41);
});

test("no raw-event shapes ride along (events/value keys absent)", () => {
  const doc = buildFull();
  const text = JSON.stringify(doc);
  assert.ok(!text.includes('"events"'), "an events block leaked");
  assert.ok(!/"value":/.test(text), 'a raw "value" key leaked (tokens only)');
});

test("window titles and step labels pass the value-free strip", () => {
  const doc = buildFull();
  const skel = doc.pdt_copy_for_llm.vocabularies[0];
  assert.ok(!skel.screens[0].name.includes("ORD-10042"),
    "screen name kept an embedded record id: " + skel.screens[0].name);
  const groups = doc.pdt_copy_for_llm.session.step_groups;
  assert.equal(groups.length, 1, "hidden steps excluded; same-label steps grouped");
  assert.equal(groups[0].instances, 2);
  assert.ok(!JSON.stringify(groups).includes("ORD-100"), "step group label kept a record id");
});

test("vocab skeleton rows carry row_key + semantics", () => {
  const skel = vocabSkeleton(VOCAB);
  assert.equal(skel.rows[0].row_key, "aid|order-id");
  assert.equal(skel.rows[0].verb, "enter");
  assert.equal(skel.rows[0].carries_value, true);
  assert.equal(skel.rows[1].completion, true);
  assert.equal(skel.rows[2].row_key, "ctn|Button|Search");
});

test("the export is one human-readable JSON with the response contract", () => {
  const text = exportText({ vocabs: [VOCAB], posture: "reviewable", surface: "app-library" });
  const doc = JSON.parse(text);
  assert.ok(doc.pdt_copy_for_llm.how_to_respond.response_shape.suggestions);
  assert.equal(doc.pdt_copy_for_llm.data_posture, "reviewable");
  assert.ok(text.split("\n").length > 10, "pretty-printed for line-by-line review");
});

/* ---- import: parse → match → apply (suggest-don't-mutate) -------------- */

test("parseSuggestions accepts the wrapper and the bare map, drops junk", () => {
  const wrapped = parseSuggestions(JSON.stringify({
    suggestions: {
      "aid|order-id": { name: "Order ID", object: "order record", means: "names the order", extra: "DROPPED" },
      "aid|bogus": "not an object",
    },
  }));
  assert.equal(wrapped.error, null);
  assert.deepEqual(Object.keys(wrapped.suggestions), ["aid|order-id"]);
  assert.equal(wrapped.suggestions["aid|order-id"].extra, undefined);
  const bare = parseSuggestions('{"aid|x": {"name": "X"}}');
  assert.equal(bare.error, null);
  assert.equal(bare.suggestions["aid|x"].name, "X");
  assert.ok(parseSuggestions("not json").error);
  assert.ok(parseSuggestions("[1,2]").error);
  assert.ok(parseSuggestions('{"a": {"unknown_field": "x"}}').error);
});

test("matchSuggestions joins by row_key and reports unmatched", () => {
  const m = matchSuggestions(VOCAB, {
    "aid|order-id": { object: "order record" },
    "ctn|Button|Search": { name: "Search orders" },
    "aid|nope": { name: "Ghost" },
  });
  assert.equal(m.rows.length, 2);
  assert.deepEqual(m.unmatched, ["aid|nope"]);
  // A suggestion equal to the current value is not a change row.
  const same = matchSuggestions(VOCAB, { "aid|order-id": { name: "Order ID" } });
  assert.equal(same.rows.length, 0);
});

test("applySuggestionsToVocab touches ONLY approved rows", () => {
  const vocab = JSON.parse(JSON.stringify(VOCAB));
  const m = matchSuggestions(vocab, {
    "aid|order-id": { object: "order record" },
    "ctn|Button|Search": { name: "Search orders" },
  });
  const applied = applySuggestionsToVocab(vocab, m.rows, ["ctn|Button|Search"]);
  assert.equal(applied, 1);
  assert.equal(vocab.interactions[2].name, "Search orders");
  assert.equal(vocab.interactions[0].object, undefined, "unapproved row mutated");
  // Nothing approved → nothing applied.
  const vocab2 = JSON.parse(JSON.stringify(VOCAB));
  const m2 = matchSuggestions(vocab2, { "aid|order-id": { object: "x" } });
  assert.equal(applySuggestionsToVocab(vocab2, m2.rows, []), 0);
  assert.deepEqual(vocab2, VOCAB);
});

test("maskLabel strips embedded record tokens", () => {
  assert.ok(!maskLabel("Create INC0010010 | Incident | ServiceNow").includes("INC0010010"));
  assert.equal(maskLabel(""), "");
});

test("claim sentences are NOT run through the title scrubber (numbers survive)", () => {
  // Regression: the value-free screen strip is a TITLE scrubber; over prose
  // it ate digit runs ("(168.4/h)" -> "(.4/h)") and truncated at quoted
  // labels. Claims must keep their measured numbers verbatim.
  const tokens = new Map();
  const frag = scrubFinding({
    id: "fragmentation-x", detector: "fragmentation",
    claim: "Focus moved between apps 16 times (168.4/h); the mean unbroken stretch in one app was 11s, the longest 20s.",
    evidence: { app_switches: 16 }, tier: 1, confidence_note: "",
  }, tokens);
  assert.ok(frag.claim.includes("(168.4/h)"), frag.claim);
  const rep = scrubFinding({
    id: "repetition-x", detector: "repetition",
    claim: 'The segment "chrome — Salesforce: Search … (+3 more)" was performed 4 times, totalling 1m 07s (mean 16s per instance).',
    evidence: { instance_count: 4 }, tier: 2, confidence_note: "",
  }, tokens);
  assert.ok(rep.claim.endsWith("(mean 16s per instance)."), rep.claim);
});

test("evidence timestamps survive verbatim (the digit-run rule must not eat years)", () => {
  const f = scrubFinding({
    id: "backtracking-x", detector: "backtracking", claim: "c",
    evidence: { first_occurrence_ts: "2026-06-01T09:00:00Z", count: 2 },
    tier: 1, confidence_note: "",
  }, new Map());
  assert.equal(f.evidence.first_occurrence_ts, "2026-06-01T09:00:00Z");
});

test("vocabRowKey mirrors the canonical-author signature key", () => {
  assert.equal(vocabRowKey({ signature: { automation_id: "a", control_type: "Edit" } }), "aid|a");
  assert.equal(vocabRowKey({ signature: { class_name: "x-btn" } }), "cn|x-btn");
  assert.equal(vocabRowKey({ signature: {} }), null);
});
