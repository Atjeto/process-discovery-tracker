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
  nameFieldHtml, activityListHtml, wireNameField } = require("./step-editor.js");
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

test("2.0.1: a row names the control it acted on under the action; its window is only in the title (the screen is the head's)", () => {
  const events = [inter({
    kind: "invoked", control_type: "Button", name: "Search",
    window_title: "Customer lookup · CRM",
  })];
  const html = renderInteractionList(events, 1);
  assert.ok(html.includes("Clicked Search"));
  assert.ok(html.includes('<span class="si-control">Button · &quot;Search&quot;</span>'));
  assert.ok(/<li class="step-interaction" data-idx="0" title="Button · [^"]*Search[^"]*Customer lookup/.test(html));
  const two = renderInteractionList([events[0], events[0]], 2, { splittable: true });
  assert.ok(two.includes('aria-label="Split the step after this action"'), "the scissors have a name");
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
  // Lane E-1: the name field's wiring is wireNameField, shared with the step
  // panel (there Enter leaves the field, which saves it); its behaviour is
  // pinned below with a fake field.
  assert.ok(src.includes("if (o.leave) nameEl.blur(); else commitName();"), "Enter commits the name");
  // Lane PANE: looked up in the host it draws into (the Steps pane or the
  // Timeline's pane), never in the whole page.
  assert.ok(src.includes('wireNameField(host.querySelector("#step-name"), step, callbacks'), "the editor wires its name with it");
  assert.ok(src.includes('descEl.addEventListener("blur", commitDesc)'));
  assert.ok(src.includes('host.querySelector("#flag-waste").addEventListener("change"'));
  assert.ok(!/document\.getElementById\("(step-name|step-desc|flag-waste|step-recorded|btn-step-jump|btn-step-watch)"\)/.test(src),
    "lane PANE: no part of the editor is looked up in the whole page");
  assert.ok(!src.includes("step-remembered"), "no remembered tag on a row: the run says it in one line");
});

test("2.0.1: the step editor in the order of the work: the head (with Play and Show on timeline), what you write (with what was said), the screenshots, what it is made of, what is attached; only the scissors change the step's shape", () => {
  const src = fs.readFileSync(path.join(__dirname, "step-editor.js"), "utf-8");
  const at = (s) => src.indexOf(s);
  const order = ['<div class="step-head">', "${nameFieldHtml(step, callbacks.picker)}", 'step-state"', '<span class="step-code" id="step-code"',
    'id="step-facts"', "${callbacks.systemHtml", 'id="btn-step-watch"', 'id="btn-step-jump"',
    '<div class="step-write" id="step-doc">', '<textarea id="step-desc"', "${saidDuringStepHtml(", "${flowSectionHtml(", 'id="flag-waste"',
    "${callbacks.shotsHtml", '<div class="step-made">', "${recordedHtml(", '<div class="step-attached">'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(at(order[i - 1]) >= 0 && at(order[i - 1]) < at(order[i]), "in order: " + order[i]);
  }
  for (const gone of ["btn-step-hide", "btn-step-merge", "btn-step-delete", "btn-step-make-sub", "step-look-slot",
    "stepFieldsHtml", "descriptionHint", "In the PDD<"]) {
    assert.ok(!src.includes(gone), "not in the editor: " + gone);
  }
});

test("2.0.1: the name is the editor's title, labelled for a screen reader; the library code is beside it, not in the field", () => {
  const html = nameFieldHtml({ name: "Save the order" }, null);
  assert.ok(html.includes('<label class="sr-only" for="step-name">Name</label>'));
  assert.ok(html.includes('id="step-name" class="step-title-input" value="Save the order"'));
  assert.ok(!html.includes("step-code"));
});

/* Lane FX3 (validation pass 3, F16): Split says why it cannot act, in the
   analyst's words (never "Need 2 interactions"). */
test("lane FX3: Split needs two recorded actions; below that it says why in plain words", () => {
  const ids = (n) => ({ evidence: { interaction_event_ids: Array.from({ length: n }, (_, i) => "e" + i) } });
  assert.equal(splitBlocker(ids(2)), "");
  assert.equal(splitBlocker(ids(7)), "");
  assert.equal(splitBlocker(ids(1)), "Only one action (a click, a field typed) was recorded in this step, so it cannot be split.");
  const none = "No action was recorded in this step, so it cannot be split: add a step beside it.";
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
  assert.ok(html.includes('value="Salesforce - Order: Save order"'), "the name field keeps the step's name");
  assert.ok(html.includes('role="combobox"') && html.includes('aria-controls="step-activity-list"'));
  assert.ok(html.includes('<ul class="step-activity-list" id="step-activity-list" role="listbox" aria-label="Activities of Salesforce" hidden></ul>'));
  assert.ok(!html.includes("step-lib-note"), "no quiet line when there are activities");
  assert.ok(/title="The name of this step: pick an activity of Salesforce from the library, or type any name./.test(html));
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

/* ---- Lane E-1: the step panel's name field ------------------------------ */
test("lane E-1: the name field can carry the step panel's own ids, never the editor's", () => {
  const picker = Library.pickerFor(LIB, "Salesforce", {});
  const html = nameFieldHtml({ name: "Step 3" }, picker, { input: "sp-name-input", list: "sp-activity-list", note: "sp-lib-note" });
  assert.ok(html.includes('<label class="sr-only" for="sp-name-input">Name</label>'));
  assert.ok(html.includes('id="sp-name-input" class="step-title-input" value="Step 3"'));
  assert.ok(html.includes('aria-controls="sp-activity-list"') && html.includes('id="sp-activity-list"'));
  assert.ok(!/id="step-name"|id="step-activity-list"/.test(html));
  const note = nameFieldHtml({ name: "x" }, Library.pickerFor(LIB, "SAP", {}), { input: "sp-name-input", note: "sp-lib-note" });
  assert.ok(note.includes('id="sp-lib-note"') && !note.includes('id="step-lib-note"'));
  assert.equal(nameFieldHtml({ name: "x" }, null), nameFieldHtml({ name: "x" }, null, {}), "the editor's field is as it was");
});

/* A text field enough for wireNameField: its listeners, blur and value. */
function fakeField(value) {
  const on = {};
  const el = {
    value, isConnected: true, readOnly: false, blurred: 0,
    addEventListener(type, fn) { (on[type] = on[type] || []).push(fn); },
    setAttribute() {}, removeAttribute() {},
    blur() { el.blurred += 1; (on.blur || []).forEach((fn) => fn({})); },
    key(k) { const e = { key: k, prevented: false, preventDefault() { e.prevented = true; } }; (on.keydown || []).forEach((fn) => fn(e)); return e; },
  };
  return el;
}

test("lane E-1: in the step panel Enter saves the name and leaves the field; Escape puts back what it showed and leaves it", () => {
  const saved = [];
  const cb = { onRename: (id, v) => saved.push([id, v]) };
  const el = fakeField("Step 3");
  wireNameField(el, { step_id: "s3", name: "Step 3" }, cb, { leave: true });
  el.value = "  Check the order  ";
  const enter = el.key("Enter");
  assert.ok(enter.prevented);
  assert.equal(el.blurred, 1, "Enter leaves the field");
  assert.deepEqual(saved, [["s3", "Check the order"]], "saved once, trimmed, on leaving");
  const el2 = fakeField("Step 4");
  wireNameField(el2, { step_id: "s4", name: "Step 4" }, cb, { leave: true });
  el2.value = "Half typed";
  el2.key("Escape");
  assert.equal(el2.value, "Step 4", "Escape puts the name back");
  assert.equal(el2.blurred, 1, "Escape leaves the field");
  assert.equal(saved.length, 1, "Escape saves nothing");
});

test("lane E-1: the editor's name field is as it was: Enter saves and keeps the field, an empty name puts the name back", () => {
  const saved = [];
  const el = fakeField("Save order");
  wireNameField(el, { step_id: "s1", name: "Save order" }, { onRename: (id, v) => saved.push([id, v]) });
  el.value = "Save the order";
  el.key("Enter");
  assert.equal(el.blurred, 0, "the editor keeps the field");
  assert.deepEqual(saved, [["s1", "Save the order"]]);
  el.value = "   ";
  el.blur();
  assert.equal(el.value, "Save order", "an empty name is put back");
  assert.equal(saved.length, 1);
  const rendering = fakeField("A");
  wireNameField(rendering, { step_id: "s2", name: "A" }, { onRename: (id, v) => saved.push([id, v]) }, { isRendering: () => true });
  rendering.value = "B";
  rendering.blur();
  assert.equal(saved.length, 1, "a blur while the field is drawn again saves nothing");
});
