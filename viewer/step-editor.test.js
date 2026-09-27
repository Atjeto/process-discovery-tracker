/*
 * Unit tests for step-editor.js: describeInteraction (the readable one-line
 * phrasing of an interaction), renderInteractionList and recordedHtml (the
 * step pane's Recorded part).
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describeInteraction, renderInteractionList, recordedHtml, recordedOpen, splitBlocker,
  nameFieldHtml, activityListHtml } = require("./step-editor.js");
const Library = require("./library.js");

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

test("renderInteractionList: no interactions yields a plain note (lane FX3: in the analyst's words)", () => {
  const html = renderInteractionList([], 0);
  assert.ok(html.includes("No action was recorded in this step."));
  assert.ok(!/interaction/i.test(html));
  assert.ok(!html.includes("<details"));
});

test("renderInteractionList: lists every interaction, one line each, with no legend and no colour code", () => {
  const events = [
    inter({ kind: "invoked", control_type: "Button", name: "Open" }),
    inter({ kind: "value_changed", control_type: "Edit", name: "Quantity", value: "5" }),
  ];
  const html = renderInteractionList(events, 2);
  assert.ok(html.includes("Clicked Open"));
  assert.ok(html.includes("Typed &quot;5&quot; into Quantity") || html.includes('Typed "5" into Quantity'));
  assert.equal((html.match(/class="step-interaction"/g) || []).length, 2);
  assert.ok(!/si-legend|si-value|si-action|<details/.test(html));
});

test("2.0.1: the Recorded part says what the recording holds in its summary, lists the actions and holds Merge", () => {
  const events = [inter({ kind: "invoked", control_type: "Button", name: "Save" })];
  const html = recordedHtml(events, 1, { line: "1 action on Order <new> · took 7s", actsHtml: '<button id="btn-step-merge">Merge with next</button>', open: true });
  assert.ok(html.startsWith('<details class="step-part step-recorded" id="step-recorded" open>'));
  assert.ok(html.includes('<span class="step-part-title">Recorded</span><span class="step-part-hint">1 action on Order &lt;new&gt; · took 7s</span>'));
  assert.ok(html.includes("Clicked Save") && html.includes('id="btn-step-merge"'));
  assert.ok(!recordedHtml(events, 1, { open: false }).includes(" open>"), "closed");
  assert.ok(recordedHtml([], 0, {}).includes("No action was recorded in this step."));
});

test("2.0.1: Recorded is open or closed as the analyst last left it; until then open for 15 actions or fewer", () => {
  assert.equal(recordedOpen(1, null), true);
  assert.equal(recordedOpen(15, null), true);
  assert.equal(recordedOpen(20, null), false);
  assert.equal(recordedOpen(20, "1"), true, "opened on another step, open here too");
  assert.equal(recordedOpen(1, "0"), false, "closed on another step, closed here too");
  const src = fs.readFileSync(path.join(__dirname, "step-editor.js"), "utf-8");
  assert.ok(src.includes('recHead.addEventListener("click", () => _keepRecordedOpen(!recEl.open))'), "the click on its summary is kept");
  assert.ok(src.includes('const RECORDED_KEY = "pdt.recordedOpen"'));
});

test("renderInteractionList: unresolved ids surface as a missing-count note", () => {
  const events = [inter({ kind: "invoked", control_type: "Button", name: "X" })];
  const html = renderInteractionList(events, 3);
  assert.ok(html.includes("2 recorded actions are not in this project"));
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

test("2.0.1: renderInteractionList marks where two merged steps met, and every action but the last has scissors", () => {
  const events = [inter({ kind: "invoked", name: "A" }), inter({ kind: "invoked", name: "B" }), inter({ kind: "invoked", name: "C" })];
  const html = renderInteractionList(events, 3, { splittable: true, mergedAfter: 0 });
  assert.equal((html.match(/was-boundary/g) || []).length, 1);
  assert.ok(html.includes("The two merged steps met here"));
  assert.ok(html.includes("The scissors after an action split the step there."), "the scissors say what they do");
  assert.equal((html.match(/class="si-split-btn"/g) || []).length, 2);
  assert.ok(!renderInteractionList(events, 3, { splittable: true }).includes("was-boundary"));
});

test("renderInteractionList: not splittable by default (back-compat)", () => {
  const events = [inter({ kind: "invoked", name: "A" }), inter({ kind: "invoked", name: "B" })];
  const html = renderInteractionList(events, 2);
  assert.ok(!html.includes("si-split-btn"));
});

/* ---- TASK 3: identityLine in the interaction rows ------------------- */

test("2.0.1: a row names its control and window in its title, not in a second line", () => {
  const events = [inter({
    kind: "invoked", control_type: "Button", name: "Search",
    window_title: "Customer lookup · CRM",
  })];
  const html = renderInteractionList(events, 1);
  assert.ok(html.includes("Clicked Search"));
  assert.ok(!html.includes("si-identity"), "no identity line under the action");
  assert.ok(/<li class="step-interaction" data-idx="0" title="Button · [^"]*Search[^"]*Customer lookup/.test(html));
});

test("renderInteractionList: the identity carries no marker, whatever the control's identity (a project is recorded once)", () => {
  for (const data of [
    { kind: "invoked", control_type: "Button", automation_id: "btn-4821" },   // a counter-like id
    { kind: "invoked", control_type: "Pane", class_name: "TfrmMain" },       // a class name only
    { kind: "invoked", control_type: "Button", name: "Save" },               // a named control
    { kind: "invoked" },                                                      // nothing to name it by
  ]) {
    const html = renderInteractionList([inter(data)], 1);
    assert.ok(!html.includes("si-marker"), "no marker glyph");
    assert.ok(!/change between recordings|auto-generated|Weak identity/.test(html), "no marker note");
  }
  const html = renderInteractionList([inter({ kind: "invoked", control_type: "Button", automation_id: "btn-4821" })], 1);
  assert.ok(html.includes("Button · &quot;btn-4821&quot;"), "the identity reads as it is");
});

/* ---- the step pane: no Save button ------------------------------------ */
// The draft's why is the Recorded line's (step-facts.js endsAt, pinned in
// step-facts.test.js). The pane saves as the analyst goes: the name
// on Enter or when the field is left, the description when it is left, Waste
// on its click (steps-view.js makes each one undoable edit). The forms need a
// DOM, so the wiring is pinned by scanning the source.
test("the step pane has no Save button: the name saves on Enter and blur, the description on blur, Waste on change", () => {
  const src = fs.readFileSync(path.join(__dirname, "step-editor.js"), "utf-8");
  assert.ok(!src.includes("btn-step-save"), "no Save button");
  assert.ok(src.includes('nameEl.addEventListener("blur", commitName)'));
  assert.ok(src.includes('if (e.key === "Enter") { e.preventDefault(); commitName(); }'), "Enter commits the name");
  assert.ok(src.includes('descEl.addEventListener("blur", commitDesc)'));
  assert.ok(src.includes('getElementById("flag-waste").addEventListener("change"'));
  assert.ok(!src.includes("step-remembered"), "no remembered tag on a row: the run says it in one line");
});

test("2.0.1: the step pane in parts: the name and its acts, In the PDD, then Screenshots, Notes, Attachments and Recorded; no fields typed, no fact line", () => {
  const src = fs.readFileSync(path.join(__dirname, "step-editor.js"), "utf-8");
  const at = (s) => src.indexOf(s);
  assert.ok(at("${nameFieldHtml(step, callbacks.picker, callbacks.code)}") < at('<div class="actions step-acts">'));
  assert.ok(at('<div class="actions step-acts">') < at('<div class="step-part step-doc" id="step-doc">'));
  assert.ok(at('<span class="step-part-title">In the PDD</span>') < at("${callbacks.systemHtml") &&
    at("${callbacks.systemHtml") < at('<textarea id="step-desc"') && at('<textarea id="step-desc"') < at("${flowSectionHtml(") &&
    at("${flowSectionHtml(") < at('id="flag-waste"') && at('id="flag-waste"') < at("${callbacks.extrasHtml") &&
    at("${callbacks.extrasHtml") < at("${recordedHtml("));
  assert.ok(!/stepFieldsHtml|Fields typed|step-fact|descriptionHint/.test(src));
});

test("C21: a step named from the library shows the activity's code beside its name", () => {
  const html = nameFieldHtml({ name: "Save the order" }, null, "SO-01");
  assert.ok(html.includes('<label>Name<span class="step-code" id="step-code" title="The code of the library activity this step is named from">SO-01</span><input'));
  assert.ok(!nameFieldHtml({ name: "x" }, null, "").includes("step-code"));
});

/* Lane FX3 (validation pass 3, F16): Split says why it cannot act, in the
   analyst's words (never "Need 2 interactions"). */
test("lane FX3: Split needs two recorded actions; below that it says why in plain words", () => {
  const ids = (n) => ({ evidence: { interaction_event_ids: Array.from({ length: n }, (_, i) => "e" + i) } });
  assert.equal(splitBlocker(ids(2)), "");
  assert.equal(splitBlocker(ids(7)), "");
  assert.equal(splitBlocker(ids(1)), "Only one action (a click, a field typed) was recorded in this step, so it cannot be split.");
  const none = "No action (a click, a field typed) was recorded in this step, so it cannot be split. + Add step adds a step beside it.";
  assert.equal(splitBlocker(ids(0)), none);
  assert.equal(splitBlocker({ state: "manually_authored", evidence: null }), none, "a step added by hand");
  assert.equal(splitBlocker(null), none);
  for (const n of [0, 1]) assert.ok(!/interaction|≥/.test(splitBlocker(ids(n))));
});

/* ---- C21: the name field's picker --------------------------------------- */
const LIB = { format: 1, version: "1", applications: [
  { name: "Salesforce", activities: [
    { id: "a1", name: "Save the order", code: "SO-01", description: "Saves <the> order.", screens: [] },
    { id: "a2", name: "Find the customer", screens: [] }] },
  { name: "SAP", activities: [] }] };

test("C21: the name field offers the activities of the step's system as a list under it, and any name can still be typed", () => {
  const picker = Library.pickerFor(LIB, "Salesforce", { library_activity: "a2" });
  const html = nameFieldHtml({ name: "Salesforce - Order: Save order" }, picker);
  assert.ok(html.includes('id="step-name" value="Salesforce - Order: Save order"'), "the name field keeps the step's name");
  assert.ok(html.includes('role="combobox"') && html.includes('aria-controls="step-activity-list"'));
  assert.ok(html.includes('<ul class="step-activity-list" id="step-activity-list" role="listbox" aria-label="Activities of Salesforce" hidden></ul>'));
  assert.ok(!html.includes("step-lib-note"), "no quiet line when there are activities");
  assert.ok(/title="Pick an activity of Salesforce from the library, or type any name./.test(html));
  assert.ok(!html.includes(" list="), "no datalist on the step pane's name: the picker is the list");
});

test("C21: with no activity for the step's system (or no system yet) the field says so in one quiet line and no list is drawn", () => {
  const none = nameFieldHtml({ name: "Create order" }, Library.pickerFor(LIB, "SAP", {}));
  assert.ok(none.includes('<span class="step-lib-note" id="step-lib-note">The library has no activities for SAP.</span>'));
  assert.ok(!none.includes("step-activity-list") && !none.includes("combobox"));
  const byHand = nameFieldHtml({ name: "Call the customer" }, Library.pickerFor(LIB, "", {}));
  assert.ok(byHand.includes("Set the system first: the library lists activities by system."));
  assert.ok(nameFieldHtml({ name: "x" }, null).includes('id="step-name"'), "without a picker, a plain name field");
});

test("C21: the picker's rows show the name, the code and the description, the step's activity marked, the row the keys are on lit", () => {
  const acts = Library.pickerFor(LIB, "Salesforce", {}).activities;
  const html = activityListHtml(acts, "a2", 0);
  assert.ok(html.includes('<li class="step-activity active" role="option" id="step-activity-0" data-i="0" aria-selected="true" title="Saves &lt;the&gt; order.">'));
  assert.ok(html.includes('<span class="step-activity-code">SO-01</span>') && html.includes('<span class="step-activity-desc">Saves &lt;the&gt; order.</span>'));
  assert.ok(html.includes('<li class="step-activity current" role="option" id="step-activity-1" data-i="1" aria-selected="false">'));
  assert.equal(activityListHtml([], null, -1), "");
});
