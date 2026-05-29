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
const { mergeVocabEntry } = require("./views/vocab-view.js");

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
