"use strict";
/*
 * step-facts.js: the step pane's fact line from the step's structured fields,
 * the fields typed, the drafting's own description (a hint in the pane), the
 * drafted name and the pointer "Run 1 at 0:19". The narration and the
 * drafted name below were printed by normalization/step_suggest.py on the
 * same interactions, so the pane and the PDD agree on which descriptions are
 * the drafting's.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const SF = require("./step-facts.js");
const { clock, sinceStart, parseClock, recordingStartMs } = require("./dom.js");

const SEP = " " + String.fromCharCode(45) + " ";
const ELLIPSIS = String.fromCharCode(0x2026);

test("the drafting's narration, as step_suggest writes it", () => {
  const mixed = [
    { kind: "value_changed", name: "Customer", value: "ACME Ltd", _coalesced_count: 7 },
    { kind: "focus_changed", name: "Search" },
    { kind: "invoked", name: "Search", control_type: "Button" },
    { kind: "invoked", name: "File", control_type: "MenuItem" },
    { kind: "invoked", name: "Open record", control_type: "Hyperlink" },
    { kind: "invoked", name: "", control_type: "Button" },
  ];
  assert.equal(SF.draftedNarration(mixed),
    "Entered \"ACME Ltd\" into Customer (7 keystrokes). Clicked Search. Opened File. Followed Open record.");
  const more = [
    { kind: "selection_changed", name: "Plant", selected_value: "1000" },
    { kind: "selection_changed", control_type: "TabItem", selected_value: "Items" },
    { kind: "toggle_changed", name: "Urgent", toggle_state: "On" },
    { kind: "value_changed", automation_id: "qty", value: "null" },
    { kind: "value_changed", name: "Password", value: String.fromCharCode(0xab) + "password#3f9a1c0e" + String.fromCharCode(0xbb) },
    { kind: "text_changed", name: "Notes" },
    { kind: "value_changed", name: "Comment", value: "" },
    { kind: "drag_dropped", automation_id: "row-3" },
  ];
  assert.equal(SF.draftedNarration(more), "Selected \"1000\" in Plant. Switched to Items. Turned Urgent on. Edited qty. " +
    "Entered a masked value into Password. Edited Notes. Plus 2 more actions.");
  assert.equal(SF.draftedNarration([{ kind: "focus_changed" }, { kind: "invoked", control_type: "Pane" }]),
    "2 actions with no recorded detail.");
  assert.equal(SF.draftedNarration([{ kind: "value_changed", name: "Body", value: "x".repeat(170) }]),
    "Entered \"" + "x".repeat(159) + ELLIPSIS + "\" into Body.");
});

test("a description is the drafting's when it equals the narration (or the older no-detail wording); a missing interaction means it cannot be told", () => {
  const datas = [{ kind: "invoked", name: "Search", control_type: "Button" }];
  assert.equal(SF.isDraftedDescription(" Clicked Search. ", datas), true);
  assert.equal(SF.isDraftedDescription("Clicked Search when the customer calls.", datas), false);
  assert.equal(SF.isDraftedDescription("3 interactions with no recorded detail.", datas), true);
  assert.equal(SF.isDraftedDescription("Clicked Search.", null), false);
  assert.equal(SF.stepDatas({ evidence: { interaction_event_ids: ["a", "gone"] } }, { a: { data: {} } }), null);
});

test("the fields typed: each field once, first-typed order, its last value; secret fields and selections as the PDD lists them", () => {
  const f = SF.typedFields([
    { kind: "value_changed", name: "Quantity", value: "2" },
    { kind: "value_changed", meaningful_name: "Customer", name: "txtCust", value: "ACME" },
    { kind: "value_changed", name: "Quantity", value: "29" },
    { kind: "value_changed", name: "Password", value_redacted: true },
    { kind: "selection_changed", name: "Plant", selected_value: "1000" },
    { kind: "selection_changed", control_type: "TabItem", selected_value: "Items" },
    { kind: "value_changed", name: "Note", value: "undefined" },
    { kind: "invoked", name: "Save" },
  ]);
  assert.deepEqual(f, [
    { field: "Quantity", value: "29" }, { field: "Customer", value: "ACME" },
    { field: "Password", value: "(not recorded: secret field)" }, { field: "Plant", value: "1000" },
  ]);
});

test("where a draft ends and its drafted name come from end_reason and its interactions", () => {
  const datas = [{ window_title: "Salesforce" + SEP + "Order #10900" }, { meaningful_name: "Save order", name: "btn" }];
  assert.equal(SF.endsAt({ end_reason: "commit" }, datas), "ends at Save order");
  assert.equal(SF.endsAt({ end_reason: "screen_change" }, datas), "ends at a screen change");
  assert.equal(SF.endsAt({ end_reason: "run_end", case_id: "c1" }, datas), "ends with the run");
  assert.equal(SF.endsAt({ end_reason: "run_end", case_id: null }, datas), "");
  assert.equal(SF.endsAt({ state: "edited" }, datas), "", "a split or merged step is no longer one draft");
  assert.equal(SF.draftedName({ end_reason: "commit" }, datas), "Salesforce" + SEP + "Order: Save order");
  assert.equal(SF.draftedName({ end_reason: "screen_change" }, [{ screen_id: "va01", window_title: "SAP" }]), "va01");
  assert.equal(SF.draftedName({ end_reason: "run_end" }, [{}]), "(screen)");
  assert.equal(SF.commitName({ name: "INC0010010", control_type: "Hyperlink" }), "Hyperlink", "a name that is only a record value");
  assert.equal(SF.commitName({}), "?");
});

test("one clock: the time since the recording started, as the PDD prints it", () => {
  assert.equal(clock(19000), "0:19");
  assert.equal(clock(12 * 60000 + 5000), "12:05");
  assert.equal(clock(3723000), "1:02:03");
  assert.equal(clock(-30000), "-0:30");
  assert.equal(clock(-400), "0:00");
  assert.equal(clock(NaN), "");
  const origin = Date.parse("2026-05-14T09:00:00Z");
  assert.equal(sinceStart("2026-05-14T09:00:39.900Z", origin), "0:39");
  assert.equal(sinceStart("not a time", origin), "");
  assert.equal(recordingStartMs({ manifest: { started_at: "2026-05-14T09:00:00Z" }, events: [] }), origin);
  assert.equal(recordingStartMs({ manifest: {}, events: [{ timestamp: "2026-05-14T09:00:02Z" }] }), origin + 2000);
  assert.equal(parseClock(" 1:05 "), 65000);
  assert.equal(parseClock("1:02:03"), 3723000);
  for (const bad of ["", "1:5", "1:60", "11:02pm", "1:61:00"]) assert.equal(parseClock(bad), null, JSON.stringify(bad));
});

test("the pointer and the fact line: the system first, then the screen, the time, where it ends and where it is", () => {
  const origin = Date.parse("2026-05-14T09:00:00Z");
  const runs = [{ caseId: "c1", title: "Run 1" }];
  const step = { case_id: "c1", time_range: { start: "2026-05-14T09:00:19Z", end: "2026-05-14T09:00:25Z" } };
  assert.equal(SF.pointer(step, runs, origin), "Run 1 at 0:19");
  assert.equal(SF.pointer(Object.assign({}, step, { case_id: null }), runs, origin), "0:19 into the recording");
  assert.equal(SF.duration(step.time_range), "6s");
  assert.equal(SF.factLine({ system: "Salesforce", screen: "Account lookup", duration: "6s", ends: "ends at Search",
    pointer: "Run 1 at 0:19" }), "Salesforce · Account lookup · 6s · ends at Search · Run 1 at 0:19");
  assert.equal(SF.factLine({ system: "", screen: "", duration: "6s" }), "6s");
});
