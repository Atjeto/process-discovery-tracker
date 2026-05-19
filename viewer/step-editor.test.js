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
const { describeInteraction, renderInteractionList } = require("./step-editor.js");

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
