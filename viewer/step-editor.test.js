/*
 * Unit tests for step-editor.js -- describeInteraction (the readable
 * one-line phrasing of an interaction) and renderInteractionList (the
 * collapsible interaction list markup in the step detail pane).
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describeInteraction, renderInteractionList, siKindClass, draftWhy } = require("./step-editor.js");

/* ---- ADR-0027 regression guard ------------------------------------- */
// The aligned reading's "apply to all" curate form (removed with the aligned
// reading, BA helper L7a) once re-introduced the retired per-step flags
// (conditional / exception_path / automation_candidate) and wrote them onto
// every aligned instance. waste is the only per-step flag. The step forms need
// a DOM, so we scan the source for every retired control id (the step detail's
// old flag-conditional / flag-exception / flag-auto, and the curate form's
// bb-flag-* forms, which contain them) to pin the invariant DOM-free.
test("ADR-0027: no step form exposes a retired per-step flag; the waste flag stays", () => {
  const src = fs.readFileSync(path.join(__dirname, "step-editor.js"), "utf-8");
  for (const id of ["flag-conditional", "flag-exception", "flag-auto"]) {
    assert.ok(!src.includes(id),
      `retired per-step flag control ${id} must not return to a step form`);
  }
  assert.ok(src.includes('id="flag-waste"'), "the waste flag control must remain");
});

function inter(data) {
  return {
    event_id: "e1", type: "interaction",
    timestamp: "2026-05-18T09:00:05Z", data,
  };
}

/* ---- R1 Steps chrome diet: the per-row move buttons are retired --------- */
// renderStepList needs a DOM, so pin the invariant DOM-free by scanning the
// source: the flat list must not emit the ↑ / ↓ reorder buttons (reorder moved
// to the right-click context menu + Alt+Arrow). Guards against regression.
test("R1: renderStepList no longer emits per-row move-up/down buttons", () => {
  const src = fs.readFileSync(path.join(__dirname, "step-editor.js"), "utf-8");
  for (const cls of ["step-move-up", "step-move-down", "step-reorder"]) {
    assert.ok(!src.includes(cls),
      `retired per-row reorder control ${cls} must not return to the step list`);
  }
});

test("R1: the truncated step name's title carries the full name + rename hint", () => {
  const src = fs.readFileSync(path.join(__dirname, "step-editor.js"), "utf-8");
  // The old instruction-only title is gone; the new title composes the full
  // name with the rename hint (so a truncated label is readable on hover).
  assert.ok(!/title="Double-click to rename"/.test(src),
    "the step-name title must no longer be the bare rename instruction");
  assert.ok(src.includes('"double-click to rename"'),
    "the rename hint should ride after the full name in the title");
});

/* ---- describeInteraction ------------------------------------------- */

test("describeInteraction: a typed value names the value and field", () => {
  const line = describeInteraction(inter({
    kind: "value_changed", control_type: "Edit",
    name: "Serial Number", value: "SN12345",
  }));
  assert.equal(line, 'Typed "SN12345" into Serial Number');
});

test("describeInteraction: a coalesced typing burst reports keystrokes", () => {
  const line = describeInteraction(inter({
    kind: "value_changed", name: "Notes", value: "done", _coalesced_count: 12,
  }));
  assert.ok(line.includes('Typed "done" into Notes'));
  assert.ok(line.includes("12 keystrokes"));
});

test("describeInteraction: a coalesced count of 1 is not shown", () => {
  const line = describeInteraction(inter({
    kind: "value_changed", name: "Field", value: "x", _coalesced_count: 1,
  }));
  assert.equal(line, 'Typed "x" into Field');
});

test("describeInteraction: an empty value reads as Cleared", () => {
  const line = describeInteraction(inter({
    kind: "value_changed", name: "Search", value: "",
  }));
  assert.equal(line, "Cleared Search");
});

test("describeInteraction: a field with no name falls back to automation_id", () => {
  const line = describeInteraction(inter({
    kind: "value_changed", automation_id: "txtsr", value: "X",
  }));
  assert.equal(line, 'Typed "X" into txtsr');
});

test("describeInteraction: an invoked button reads as Clicked", () => {
  assert.equal(
    describeInteraction(inter({
      kind: "invoked", control_type: "Button", name: "Search",
    })),
    "Clicked Search");
});

test("describeInteraction: a menu item is Opened, a hyperlink is Followed", () => {
  assert.equal(
    describeInteraction(inter({
      kind: "invoked", control_type: "MenuItem", name: "File",
    })),
    "Opened File");
  assert.equal(
    describeInteraction(inter({
      kind: "invoked", control_type: "Hyperlink", name: "Details",
    })),
    "Followed Details");
});

test("describeInteraction: a dropdown selection names the value and field", () => {
  const line = describeInteraction(inter({
    kind: "selection_changed", control_type: "ComboBox",
    name: "Status", selected_value: "Resolved",
  }));
  assert.equal(line, 'Selected "Resolved" in Status');
});

test("describeInteraction: a tab switch reads as Switched to", () => {
  const line = describeInteraction(inter({
    kind: "selection_changed", control_type: "TabItem",
    name: "Details", selected_value: "Details",
  }));
  assert.equal(line, "Switched to Details");
});

test("describeInteraction: a toggle reads as Turned on / Turned off", () => {
  assert.equal(
    describeInteraction(inter({
      kind: "toggle_changed", control_type: "CheckBox",
      name: "Remember me", toggle_state: "on",
    })),
    "Turned Remember me on");
  assert.equal(
    describeInteraction(inter({
      kind: "toggle_changed", name: "Airplane mode", toggle_state: "off",
    })),
    "Turned Airplane mode off");
});

test("describeInteraction: an indeterminate toggle is spelled out", () => {
  assert.equal(
    describeInteraction(inter({
      kind: "toggle_changed", name: "Select all", toggle_state: "indeterminate",
    })),
    "Set Select all to indeterminate");
});

test("describeInteraction: a text_changed notification reads as Edited", () => {
  assert.equal(
    describeInteraction(inter({ kind: "text_changed", name: "Comments" })),
    "Edited Comments");
});

test("describeInteraction: an unknown kind degrades to a humanized fallback", () => {
  const line = describeInteraction(inter({
    kind: "range_value_changed", name: "Volume",
  }));
  assert.ok(line.includes("range value changed"));
  assert.ok(line.includes("Volume"));
});

/* ---- renderInteractionList ----------------------------------------- */

test("renderInteractionList: no interactions yields a plain note", () => {
  const html = renderInteractionList([], 0);
  assert.ok(html.includes("No interactions"));
  assert.ok(!html.includes("<details"));
});

test("renderInteractionList: lists every interaction with the claimed count", () => {
  const events = [
    inter({ kind: "invoked", control_type: "Button", name: "Open" }),
    inter({ kind: "invoked", control_type: "Button", name: "Save" }),
  ];
  const html = renderInteractionList(events, 2);
  assert.ok(html.includes("Interactions (2)"));
  assert.ok(html.includes("Clicked Open"));
  assert.ok(html.includes("Clicked Save"));
});

test("renderInteractionList: a small step's list is open by default", () => {
  const events = [inter({ kind: "invoked", control_type: "Button", name: "X" })];
  const html = renderInteractionList(events, 1);
  assert.ok(/<details[^>]*\bopen\b/.test(html));
});

test("renderInteractionList: a big step's list is collapsed by default", () => {
  const events = Array.from({ length: 20 }, () =>
    inter({ kind: "invoked", control_type: "Button", name: "X" }));
  const html = renderInteractionList(events, 20);
  assert.ok(html.includes("<details"));
  assert.ok(!/<details[^>]*\bopen\b/.test(html));
});

test("renderInteractionList: unresolved ids surface as a missing-count note", () => {
  const events = [inter({ kind: "invoked", control_type: "Button", name: "X" })];
  const html = renderInteractionList(events, 3);
  assert.ok(html.includes("2 interaction(s) not found"));
});

/* ---- A1: interaction kind colour-coding ---------------------------- */

test("siKindClass: buckets each interaction kind", () => {
  assert.equal(siKindClass(inter({ kind: "value_changed" })), "si-value");
  assert.equal(siKindClass(inter({ kind: "text_changed" })), "si-value");
  assert.equal(siKindClass(inter({ kind: "invoked" })), "si-action");
  assert.equal(siKindClass(inter({ kind: "selection_changed" })), "si-select");
  assert.equal(siKindClass(inter({ kind: "toggle_changed" })), "si-toggle");
  assert.equal(siKindClass(inter({ kind: "focus_changed" })), "si-other");
  assert.equal(siKindClass(inter({})), "si-other");
});

test("renderInteractionList: rows carry the kind class", () => {
  const events = [
    inter({ kind: "value_changed", name: "Serial", value: "X" }),
    inter({ kind: "invoked", control_type: "Button", name: "Search" }),
  ];
  const html = renderInteractionList(events, 2);
  assert.ok(html.includes("step-interaction si-value"));
  assert.ok(html.includes("step-interaction si-action"));
});

/* ---- A2: split-point affordance ------------------------------------ */

test("renderInteractionList: splittable renders scissors for all but the last row", () => {
  const events = [
    inter({ kind: "invoked", name: "A" }),
    inter({ kind: "invoked", name: "B" }),
    inter({ kind: "invoked", name: "C" }),
  ];
  const html = renderInteractionList(events, 3, { splittable: true });
  // two scissors buttons (after row 0 and row 1, never after the last)
  const count = (html.match(/si-split-btn/g) || []).length;
  assert.equal(count, 2);
  assert.ok(html.includes('data-after="0"'));
  assert.ok(html.includes('data-after="1"'));
  assert.ok(!html.includes('data-after="2"'));
});

test("renderInteractionList: a chosen boundary marks the row and its scissors active", () => {
  const events = [inter({ kind: "invoked", name: "A" }), inter({ kind: "invoked", name: "B" })];
  const html = renderInteractionList(events, 2, { splittable: true, splitAfterIndex: 0 });
  assert.ok(html.includes("split-boundary"));
  assert.ok(html.includes("si-split-btn active"));
});

test("renderInteractionList: not splittable by default (back-compat)", () => {
  const events = [inter({ kind: "invoked", name: "A" }), inter({ kind: "invoked", name: "B" })];
  const html = renderInteractionList(events, 2);
  assert.ok(!html.includes("si-split-btn"));
});

/* ---- TASK 3: identityLine in the interaction rows ------------------- */

test("renderInteractionList: each row carries a composed identity line", () => {
  const events = [inter({
    kind: "invoked", control_type: "Button", name: "Search",
    window_title: "Customer lookup — CRM",
  })];
  const html = renderInteractionList(events, 1);
  // The verb sentence is still there (what happened) ...
  assert.ok(html.includes("Clicked Search"));
  // ... plus the composed identity line (control type · "identity" · window).
  assert.ok(html.includes("si-identity"));
  assert.ok(html.includes("Button"));
  assert.ok(html.includes("Customer lookup"));
});

test("renderInteractionList: a volatile automation_id renders the marker + tooltip", () => {
  // No name, a render-counter-looking id -> identityLine flags it volatile.
  const events = [inter({
    kind: "invoked", control_type: "Button", automation_id: "btn-4821",
  })];
  const html = renderInteractionList(events, 1);
  assert.ok(html.includes("si-marker-volatile"), "volatile marker class must render");
  assert.ok(/auto-generated/.test(html), "the marker's tooltip note must render");
});

test("renderInteractionList: a class-name-only control renders the weak marker", () => {
  const events = [inter({
    kind: "invoked", control_type: "Pane", class_name: "TfrmMain",
  })];
  const html = renderInteractionList(events, 1);
  assert.ok(html.includes("si-marker-weak"), "weak-identity marker class must render");
});

test("renderInteractionList: a strong named control renders no marker", () => {
  const events = [inter({
    kind: "invoked", control_type: "Button", name: "Save",
  })];
  const html = renderInteractionList(events, 1);
  assert.ok(html.includes("si-identity"));
  assert.ok(!html.includes("si-marker-"), "a stable named control needs no marker");
});

/* ---- draftWhy: the draft's why in the step's fact line -------------- */
// P1.7 keeps the draft reason visible, short, in the fact line: from the
// pipeline's C1 reason (step_suggest._draft_reason), only while the step is
// still that draft (end_reason present).
test("draftWhy shortens each of the pipeline's draft reasons", () => {
  const why = (reason, end) => draftWhy({ suggestion_reason: reason, end_reason: end });
  assert.equal(why('Drafted from 4 interactions on Salesforce - Account lookup; ended at the commit "Search".', "commit"),
    "4 interactions on Salesforce - Account lookup, ended at Search");
  assert.equal(why("Drafted from 1 interaction on Notepad - notes.txt; ended because the next interaction was on another screen.", "screen_change"),
    "1 interaction on Notepad - notes.txt, ended where the screen changed");
  assert.equal(why("Drafted from 3 interactions on SAP; ended at the end of the run.", "run_end"),
    "3 interactions on SAP, ended with the run");
  assert.equal(why("Drafted from 2 interactions on Excel; ended at the last interaction outside a run.", "run_end"),
    "2 interactions on Excel, outside the runs");
  assert.equal(why("Drafted from 2 interactions on (screen); ended at the end of the run.", "run_end"),
    "2 interactions, ended with the run");
});

test("draftWhy says nothing once the step is no longer the draft, and shows other wording as written", () => {
  // A split or a merge drops end_reason (runs-model.dropDraftIdentity).
  assert.equal(draftWhy({ suggestion_reason: 'Drafted from 4 interactions on SAP; ended at the commit "Save".' }), "");
  assert.equal(draftWhy({ end_reason: "commit" }), "");
  assert.equal(draftWhy(null), "");
  assert.equal(draftWhy({ suggestion_reason: "Grouped by hand.", end_reason: "commit" }), "Grouped by hand.");
});
