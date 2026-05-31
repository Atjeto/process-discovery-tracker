"use strict";

/*
 * Unit tests for mergeVocabEntry (H-3: vocab save dropping seen_count).
 * Saving an App-Library vocab used to rewrite each interaction from
 * scratch, dropping the bootstrapped `seen_count` frequency ranking and
 * any other unmodeled field. The merge helper must clone the prior entry
 * and overwrite ONLY signature / name / flags. Run with `npm test`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mergeVocabEntry, mergeDiscoveredSkeleton, mergeScreens, stripDiscoveryMeta,
} = require("./views/vocab-view.js");

test("preserves seen_count and unmodeled fields from the prior entry", () => {
  const prior = {
    signature: { class_name: "Old" },
    name: "Old name",
    seen_count: 17,
    first_seen_ts: "2026-05-01T00:00:00Z",
    custom_field: { nested: true },
  };
  const out = mergeVocabEntry(prior, {
    signature: { class_name: "New", automation_id: "x" },
    name: "Customer ID",
    flags: {},
  });
  assert.equal(out.seen_count, 17, "seen_count must survive");
  assert.equal(out.first_seen_ts, "2026-05-01T00:00:00Z");
  assert.deepEqual(out.custom_field, { nested: true });
  // Editable fields are overwritten.
  assert.deepEqual(out.signature, { class_name: "New", automation_id: "x" });
  assert.equal(out.name, "Customer ID");
});

test("does not mutate the prior entry (clone, not in-place)", () => {
  const prior = { signature: { a: "1" }, name: "n", seen_count: 3 };
  const out = mergeVocabEntry(prior, { signature: { b: "2" }, name: "m", flags: {} });
  assert.deepEqual(prior.signature, { a: "1" }, "prior signature untouched");
  assert.equal(prior.name, "n", "prior name untouched");
  assert.notEqual(out, prior);
});

test("sets flags when any flag is checked", () => {
  const out = mergeVocabEntry({ seen_count: 1 }, {
    signature: { a: "1" }, name: "n", flags: { is_anchor: true },
  });
  assert.deepEqual(out.flags, { is_anchor: true });
  assert.equal(out.seen_count, 1);
});

test("removes a stale flags key when no flag is checked", () => {
  const prior = { signature: {}, name: "n", flags: { is_anchor: true }, seen_count: 5 };
  const out = mergeVocabEntry(prior, { signature: { a: "1" }, name: "n2", flags: {} });
  assert.equal("flags" in out, false, "empty flags should drop the key");
  assert.equal(out.seen_count, 5);
});

test("works for a brand-new entry with no prior (empty base)", () => {
  const out = mergeVocabEntry(undefined, {
    signature: { class_name: "Edit" }, name: "Search", flags: {},
  });
  assert.deepEqual(out, { signature: { class_name: "Edit" }, name: "Search" });
  assert.equal("seen_count" in out, false);
});

test("normalizes missing signature / name to empty", () => {
  const out = mergeVocabEntry({ seen_count: 2 }, { signature: undefined, name: undefined, flags: {} });
  assert.deepEqual(out.signature, {});
  assert.equal(out.name, "");
  assert.equal(out.seen_count, 2);
});

/* ADR-0025: merge-aware re-discovery (the inverse of "Discover from window")
   diffs a discovered skeleton INTO an existing vocab without overwriting names. */

test("mergeDiscoveredSkeleton preserves an analyst-named entry on a signature collision", () => {
  const existing = {
    id: "excel", name: "Microsoft Excel",
    scope: { process_name: "excel.exe", window_title_regex: ".* - Excel$" },
    screens: [{ id: "workbook", name: "Workbook" }],
    interactions: [
      { signature: { automation_id: "FileSave" }, name: "Save the workbook" },
    ],
  };
  const skeleton = {
    scope: { window_title_regex: ".*Book1.*" },
    screens: [{ id: "book1-excel", name: "Book1 - Excel" }],
    interactions: [
      // Same control (aid wins in the key) -> existing name must survive.
      { signature: { control_type: "Button", automation_id: "FileSave" }, name: "Save",
        identity_source: "automation_id", confidence: 0.95 },
      // A genuinely new control -> added.
      { signature: { control_type: "Button", automation_id: "Filter" }, name: "Apply / remove filter",
        identity_source: "automation_id", confidence: 0.95 },
    ],
  };
  const { vocab, added, skipped } = mergeDiscoveredSkeleton(existing, skeleton);
  assert.equal(added, 1);
  assert.equal(skipped, 1);
  const save = vocab.interactions.find((e) => e.signature.automation_id === "FileSave");
  assert.equal(save.name, "Save the workbook", "analyst name must NOT be overwritten");
  assert.ok(vocab.interactions.some((e) => e.signature.automation_id === "Filter"));
  // A populated vocab keeps its tuned scope; screens merge additively.
  assert.deepEqual(vocab.scope, existing.scope, "tuned scope is not clobbered");
  assert.equal(vocab.screens.length, 2);
});

test("mergeDiscoveredSkeleton adopts the discovered scope into an empty vocab", () => {
  const empty = { id: "sf", name: "Salesforce", scope: {}, interactions: [] };
  const skeleton = {
    scope: { window_title_regex: ".*Salesforce.*" },
    screens: [{ id: "acme-salesforce", name: "Acme - Salesforce" }],
    interactions: [
      { signature: { control_type: "Edit", name: "Account Name" }, name: "Account Name",
        identity_source: "name", confidence: 0.7, volatile_aids: ["input-378", "input-411"] },
    ],
  };
  const { vocab, added } = mergeDiscoveredSkeleton(empty, skeleton);
  assert.equal(added, 1);
  assert.equal(vocab.scope.window_title_regex, ".*Salesforce.*");
  assert.equal(vocab.screens.length, 1);
});

test("mergeScreens is additive and de-duplicates by id", () => {
  const out = mergeScreens(
    [{ id: "a", name: "A" }],
    [{ id: "a", name: "A again" }, { id: "b", name: "B" }],
  );
  assert.deepEqual(out.map((s) => s.id), ["a", "b"]);
  assert.equal(out[0].name, "A", "existing screen kept on id collision");
});

test("stripDiscoveryMeta drops provenance + context fields but keeps signature/name/seen_count", () => {
  const v = {
    id: "x", interactions: [
      { signature: { class_name: "x-btn" }, name: "N", seen_count: 3,
        identity_source: "class_name", confidence: 0.4, volatile_aids: ["q"], _hint: "h",
        role: "button", framework: "chromium", region: "top-left",
        ancestry: ["Window", "Pane"], _members: [{ role: "button", region: "top-left" }] },
    ],
  };
  const clean = stripDiscoveryMeta(v);
  const e = clean.interactions[0];
  // The signature (incl. class_name) and the analyst-facing fields survive.
  assert.deepEqual(e.signature, { class_name: "x-btn" });
  assert.equal(e.name, "N");
  assert.equal(e.seen_count, 3);
  for (const k of ["identity_source", "confidence", "volatile_aids", "_hint",
    "role", "framework", "region", "ancestry", "_members"]) {
    assert.equal(k in e, false, `${k} should be stripped`);
  }
  // The original is untouched (clone, not in-place).
  assert.equal(v.interactions[0].confidence, 0.4);
});

test("mergeDiscoveredSkeleton dedups a class_name-only signature on re-discovery (cn key)", () => {
  // Before the cn-branch fix, vocabSignatureKey returned null for a class_name-
  // only signature, so each re-discovery re-added it as a duplicate. It must now
  // dedup against the existing entry exactly as Python's _snapshot_sig_key does.
  const existing = {
    id: "spotify", name: "Spotify", scope: {},
    interactions: [{ signature: { class_name: "x-btn" }, name: "Play" }],
  };
  const skeleton = {
    scope: {}, screens: [],
    interactions: [
      { signature: { class_name: "x-btn" }, name: "", identity_source: "class_name", confidence: 0.4 },
    ],
  };
  const { vocab, added, skipped } = mergeDiscoveredSkeleton(existing, skeleton);
  assert.equal(added, 0, "same class_name-only signature must dedup, not duplicate");
  assert.equal(skipped, 1);
  assert.equal(vocab.interactions.length, 1, "no duplicate row added");
  assert.equal(vocab.interactions[0].name, "Play", "the analyst-named entry is kept");
});
