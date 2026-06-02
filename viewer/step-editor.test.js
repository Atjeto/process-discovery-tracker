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
const { describeInteraction, renderInteractionList, siKindClass } = require("./step-editor.js");

/* ---- ADR-0027 regression guard ------------------------------------- */
// renderBackboneDetail's "apply to all" curate form once re-introduced the
// retired per-step flags (conditional / exception_path / automation_candidate)
// and wrote them onto every aligned instance. waste is the only per-step flag
// now. renderBackboneDetail needs a DOM, so we scan the source (the curate form
// only EVER references these control ids) to pin the invariant DOM-free.
test("ADR-0027: the backbone curate form exposes only the waste flag", () => {
  const src = fs.readFileSync(path.join(__dirname, "step-editor.js"), "utf-8");
  for (const id of ["bb-flag-conditional", "bb-flag-exception", "bb-flag-auto"]) {
    assert.ok(!src.includes(id),
      `retired per-step flag control ${id} must not return to the backbone form`);
  }
  assert.ok(src.includes("bb-flag-waste"), "the waste flag control must remain");
});

function inter(data) {
  return {
    event_id: "e1", type: "interaction",
    timestamp: "2026-05-18T09:00:05Z", data,
  };
}

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
