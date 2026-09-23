"use strict";
/*
 * Unit tests for vocab-match.js — the R2 match workbench engine.
 * Mirrors app_vocab.py matching semantics (advisory). Fixtures are hand-built,
 * never a real capture (CLAUDE.md: company captures stay local).
 */

const test = require("node:test");
const assert = require("node:assert");

const VM = require("./vocab-match.js");

function interaction(data) {
  return { type: "interaction", event_id: "e" + Math.random().toString(36).slice(2), data };
}

// A vocab scoped to Salesforce windows with three entries:
//  - one keyed on automation_id (strong)
//  - one keyed on control_type + name (fallback identity)
//  - one that will match NOTHING in the fixture session (a dead rule)
const VOCAB = {
  id: "sf-test",
  name: "SF Test",
  scope: { window_title_regex: ".*Salesforce.*" },
  screens: [
    { id: "account-new", name: "New Account", window_title_regex: ".*New Account.*Salesforce.*" },
  ],
  interactions: [
    { signature: { automation_id: "customer-id-field", control_type: "Edit" }, name: "Customer ID" },
    { signature: { control_type: "Button", name: "Search" }, name: "Search customers" },
    { signature: { control_type: "Button", name: "Delete everything" }, name: "Nuke (never observed)" },
  ],
};

// A session touching Salesforce (in scope) + a Notepad window (out of scope).
function session() {
  return [
    // Match by automation_id (strong) — seen 3×
    interaction({ process_name: "chrome.exe", window_title: "Salesforce - Account lookup", control_type: "Edit", automation_id: "customer-id-field", name: "Customer ID field" }),
    interaction({ process_name: "chrome.exe", window_title: "Salesforce - Account lookup", control_type: "Edit", automation_id: "customer-id-field", name: "Customer ID field" }),
    interaction({ process_name: "chrome.exe", window_title: "Salesforce - Account lookup", control_type: "Edit", automation_id: "customer-id-field", name: "Customer ID field" }),
    // Match by control_type + name (fallback) — seen 2×
    interaction({ process_name: "chrome.exe", window_title: "Salesforce - Account lookup", control_type: "Button", name: "Search" }),
    interaction({ process_name: "chrome.exe", window_title: "Salesforce - Account lookup", control_type: "Button", name: "Search" }),
    // In scope but NO vocab entry → UNNAMED — seen 1×
    interaction({ process_name: "chrome.exe", window_title: "Salesforce - Order #10900", control_type: "Edit", name: "Product code" }),
    // Out of scope (window regex miss) → ignored entirely
    interaction({ process_name: "notepad.exe", window_title: "Untitled - Notepad", control_type: "Edit", name: "Text editor" }),
    // A non-interaction event → ignored
    { type: "activity", data: { process_name: "chrome.exe" } },
  ];
}

test("scopeMatches: window_title_regex hit / miss", () => {
  assert.equal(VM.scopeMatches(VOCAB, { window_title: "Salesforce - Account lookup" }), true);
  assert.equal(VM.scopeMatches(VOCAB, { window_title: "Untitled - Notepad" }), false);
});

test("scopeMatches: process_name is case-insensitive (mirror of app_vocab)", () => {
  const v = { scope: { process_name: "EXCEL.EXE" } };
  assert.equal(VM.scopeMatches(v, { process_name: "excel.exe" }), true);
  assert.equal(VM.scopeMatches(v, { process_name: "chrome.exe" }), false);
});

test("scopeMatches: empty scope matches everything", () => {
  assert.equal(VM.scopeMatches({ scope: {} }, { window_title: "anything" }), true);
});

test("signatureMatch: automation_id match, with specificity", () => {
  const r = VM.signatureMatch(
    { automation_id: "customer-id-field", control_type: "Edit" },
    { automation_id: "customer-id-field", control_type: "Edit", name: "Customer ID field" }
  );
  assert.equal(r.ok, true);
  assert.equal(r.specificity, 2); // aid + control_type
});

test("signatureMatch: a single wrong field fails the whole signature", () => {
  const r = VM.signatureMatch(
    { automation_id: "customer-id-field", control_type: "Button" },
    { automation_id: "customer-id-field", control_type: "Edit" }
  );
  assert.equal(r.ok, false);
});

test("signatureMatch: empty signature never matches", () => {
  assert.equal(VM.signatureMatch({}, { name: "x" }).ok, false);
});

test("signatureMatch: window_title_regex on a signature adds specificity", () => {
  const r = VM.signatureMatch(
    { control_type: "Button", name: "Save", window_title_regex: ".*New Account.*" },
    { control_type: "Button", name: "Save", window_title: "New Account | Salesforce" }
  );
  assert.equal(r.ok, true);
  assert.equal(r.specificity, 3);
});

test("bestEntry: most-specific wins (aid+ct over a name-only rule)", () => {
  const v = {
    interactions: [
      { signature: { name: "Customer ID field" }, name: "loose" },
      { signature: { automation_id: "customer-id-field", control_type: "Edit" }, name: "tight" },
    ],
  };
  const be = VM.bestEntry(v, { automation_id: "customer-id-field", control_type: "Edit", name: "Customer ID field" });
  assert.equal(be.entry.name, "tight");
  assert.equal(be.index, 1);
});

test("buildWorkbench: MATCHED by automation_id and by name fallback", () => {
  const wb = VM.buildWorkbench(session(), VOCAB);
  const names = wb.matched.map((m) => m.vocabName).sort();
  assert.deepEqual(names, ["Customer ID", "Search customers"]);
  // ordered by occurrence — Customer ID (3) before Search (2)
  assert.equal(wb.matched[0].vocabName, "Customer ID");
  assert.equal(wb.matched[0].count, 3);
  assert.equal(wb.matched[0].identity.kind, "automation_id");
  const search = wb.matched.find((m) => m.vocabName === "Search customers");
  assert.equal(search.count, 2);
  assert.equal(search.identity.kind, "name");
});

test("buildWorkbench: UNNAMED holds the in-scope, un-named control (worklist)", () => {
  const wb = VM.buildWorkbench(session(), VOCAB);
  assert.equal(wb.unnamed.length, 1);
  const u = wb.unnamed[0];
  assert.equal(u.identity.value, "Product code");
  assert.equal(u.count, 1);
  // It carries a derived add-signature for the Name… flow.
  assert.deepEqual(u.addSignature, { control_type: "Edit", name: "Product code" });
});

test("buildWorkbench: out-of-scope interactions are excluded entirely", () => {
  const wb = VM.buildWorkbench(session(), VOCAB);
  const allTitles = wb.matched.concat(wb.unnamed).map((r) => r.window);
  assert.ok(!allTitles.some((t) => /Notepad/.test(t)));
  // 5 in-scope interactions matched (3 + 2), 1 in-scope unnamed = 6 in scope.
  assert.equal(wb.inScopeInteractions, 6);
});

test("buildWorkbench: DEAD RULES lists the never-matching entry", () => {
  const wb = VM.buildWorkbench(session(), VOCAB);
  assert.equal(wb.deadRules.length, 1);
  assert.equal(wb.deadRules[0].name, "Nuke (never observed)");
  assert.equal(wb.deadRules[0].entryIndex, 2);
});

test("buildWorkbench: coverage counts distinct controls + interaction share", () => {
  const wb = VM.buildWorkbench(session(), VOCAB);
  // 2 named controls of 3 distinct in-scope controls = 67%
  assert.equal(wb.coverage.namedControls, 2);
  assert.equal(wb.coverage.totalControls, 3);
  assert.equal(wb.coverage.pctControls, 67);
  // 5 named interactions of 6 in-scope = 83%
  assert.equal(wb.coverage.matchedInteractions, 5);
  assert.equal(wb.coverage.totalInteractions, 6);
  assert.equal(wb.coverage.pctInteractions, 83);
});

test("buildWorkbench: empty vocab → everything in scope is UNNAMED, no dead rules", () => {
  const wb = VM.buildWorkbench(session(), { scope: { window_title_regex: ".*Salesforce.*" }, interactions: [] });
  assert.equal(wb.matched.length, 0);
  assert.equal(wb.deadRules.length, 0);
  assert.ok(wb.unnamed.length >= 3);
});

test("buildScreens: splits observed windows into matched vs unnamed", () => {
  const wb = VM.buildWorkbench(session(), VOCAB);
  // "Salesforce - Order #10900" matches no screens entry → unnamed.
  // The screens entry regex ".*New Account.*Salesforce.*" matches none of the
  // demo windows → all observed titles are unnamed here.
  const titles = wb.screens.unnamed.map((s) => s.title).sort();
  assert.ok(titles.includes("Salesforce - Account lookup"));
  assert.ok(titles.includes("Salesforce - Order #10900"));
  assert.equal(wb.screens.matched.length, 0);
});

test("buildScreens: a screen regex that hits moves the title to matched", () => {
  const v = Object.assign({}, VOCAB, {
    screens: [{ id: "lookup", name: "Account lookup", window_title_regex: ".*Account lookup.*" }],
  });
  const wb = VM.buildWorkbench(session(), v);
  const m = wb.screens.matched.find((s) => /Account lookup/.test(s.title));
  assert.ok(m);
  assert.equal(m.screenId, "lookup");
});

test("suggestScreenRegex: multiple variants → volatile middle token becomes wildcard", () => {
  const s = VM.suggestScreenRegex([
    "Salesforce - Order #10900",
    "Salesforce - Order #10901",
    "Salesforce - Order #10902",
  ]);
  assert.equal(s.single, false);
  // Prefix "Salesforce - Order #1090" is shared; the last digit varies.
  assert.ok(s.regex.startsWith(".*"));
  assert.ok(s.regex.includes("Salesforce"));
  // The suggested regex must actually match all the observed variants.
  const re = new RegExp(s.regex);
  assert.ok(re.test("Salesforce - Order #10900"));
  assert.ok(re.test("Salesforce - Order #10902"));
});

test("suggestScreenRegex: prefix + suffix around an embedded id (middle wildcard)", () => {
  // Variants that differ across the WHOLE id (not just the last digit) so the
  // shared frame is the surrounding chrome and the id becomes the wildcard.
  const s = VM.suggestScreenRegex([
    "Create INC0010010 | Incident | ServiceNow",
    "Create INC0029999 | Incident | ServiceNow",
  ]);
  const re = new RegExp(s.regex);
  // Matches both observed variants…
  assert.ok(re.test("Create INC0010010 | Incident | ServiceNow"));
  assert.ok(re.test("Create INC0029999 | Incident | ServiceNow"));
  // …and a fresh id sharing the same frame (the wildcard spans the whole id).
  assert.ok(re.test("Create INC0088888 | Incident | ServiceNow"));
  // The stable suffix (" | Incident | ServiceNow") is preserved literally.
  assert.ok(/Incident/.test(s.regex));
  assert.equal(s.single, false);
});

test("suggestScreenRegex: single variant → escaped literally, flagged single", () => {
  const s = VM.suggestScreenRegex(["Salesforce - Account lookup"]);
  assert.equal(s.single, true);
  const re = new RegExp(s.regex);
  assert.ok(re.test("Salesforce - Account lookup"));
});

/* R1 App Library pass: snapshot triage — candidates, not entries; interactive
   control types lead, the rest defers behind a cap, nothing preselected. */
function candidate(control_type, extra) {
  return { signature: Object.assign({ control_type }, extra || {}), seenCount: (extra && extra.seenCount) || 1 };
}

test("triageSnapshotCandidates: keeps interactive types, defers non-interactive", () => {
  const controls = [
    candidate("Button", { name: "Save" }),
    candidate("Edit", { automation_id: "customer_id" }),
    candidate("Text", { name: "some label" }),      // non-interactive → deferred
    candidate("Pane", {}),                           // non-interactive → deferred
    candidate("ComboBox", { name: "Country" }),
  ];
  const t = VM.triageSnapshotCandidates(controls, 40);
  assert.equal(t.rawTotal, 5);
  assert.equal(t.keptTotal, 3);                      // Button + Edit + ComboBox
  assert.equal(t.shown.length, 3);
  assert.equal(t.deferred.length, 2);                // Text + Pane
  // Every deferred entry is non-interactive.
  assert.ok(t.deferred.every((c) => !VM.INTERACTIVE_CONTROL_TYPES.has(c.signature.control_type)));
});

test("triageSnapshotCandidates: ranks stable-identity controls ahead of weak ones", () => {
  const controls = [
    candidate("Button", { class_name: "x-btn" }),           // weak (class only)
    candidate("Button", { name: "Save" }),                  // stable (name)
    candidate("Edit", { automation_id: "input-378" }),      // volatile id → weak
    candidate("Edit", { automation_id: "customer_id" }),    // stable id
  ];
  const t = VM.triageSnapshotCandidates(controls, 40);
  // The two stable-identity controls come first (order among them by seenCount).
  const firstTwoStable = t.shown.slice(0, 2).every((c) =>
    c.signature.name === "Save" || c.signature.automation_id === "customer_id");
  assert.ok(firstTwoStable, "stable-identity controls should lead: " +
    JSON.stringify(t.shown.map((c) => c.signature)));
});

test("triageSnapshotCandidates: hard-caps the default render, overflow → deferred", () => {
  const controls = [];
  for (let i = 0; i < 50; i++) controls.push(candidate("Button", { name: "B" + i, seenCount: 50 - i }));
  const t = VM.triageSnapshotCandidates(controls, 40);
  assert.equal(t.keptTotal, 50);
  assert.equal(t.shown.length, 40);                  // capped
  assert.equal(t.deferred.length, 10);               // overflow interactive
});

test("triageSnapshotCandidates: overflow puts interactive-past-cap before non-interactive", () => {
  const controls = [];
  for (let i = 0; i < 42; i++) controls.push(candidate("Button", { name: "B" + i, seenCount: 100 - i }));
  controls.push(candidate("Text", { name: "label" }));
  const t = VM.triageSnapshotCandidates(controls, 40);
  assert.equal(t.shown.length, 40);
  // 2 interactive overflow + 1 non-interactive = 3 deferred; the 2 interactive lead.
  assert.equal(t.deferred.length, 3);
  assert.ok(VM.INTERACTIVE_CONTROL_TYPES.has(t.deferred[0].signature.control_type));
  assert.equal(t.deferred[2].signature.control_type, "Text");
});

test("triageSnapshotCandidates: empty input → empty result", () => {
  const t = VM.triageSnapshotCandidates([], 40);
  assert.deepEqual(t, { shown: [], deferred: [], keptTotal: 0, rawTotal: 0 });
});

test("minimalSignature: prefers automation_id, falls back to control_type+name", () => {
  assert.deepEqual(
    VM.minimalSignature({ automation_id: "aid1", control_type: "Edit", name: "x" }),
    { automation_id: "aid1", control_type: "Edit" }
  );
  assert.deepEqual(
    VM.minimalSignature({ control_type: "Button", name: "Save" }),
    { control_type: "Button", name: "Save" }
  );
  assert.equal(VM.minimalSignature({ control_type: "Button" }), null);
});
