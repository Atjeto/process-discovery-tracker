"use strict";
/*
 * step-facts.js: the step pane's Recorded line from the step's structured
 * fields, the drafting's own description (never shown as the description)
 * and where a draft ends. The narration and the
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

test("lane LF-PIPE: an empty web field is no value; a secret reads typed (hidden)", () => {
  const OBJ = String.fromCharCode(0xfffc);
  assert.equal(SF.SECRET_VALUE, "typed (hidden)");
  assert.equal(SF.isBlankValue(OBJ + " "), true);
  assert.equal(SF.isBlankValue("a" + OBJ), false);
  assert.equal(SF.isBlankValue(undefined), false, "a value the recorder did not record is not an empty one");
});

test("lane LF-PIPE: a secret narrates Typed Password (hidden), a value not recorded Edited, never Cleared; the older wording still reads as drafted", () => {
  const secret = [{ kind: "value_changed", name: "User name", value: "test.supplier" },
    { kind: "value_changed", name: "Password", value_redacted: true }];
  assert.equal(SF.draftedNarration(secret), "Entered \"test.supplier\" into User name. Typed Password (hidden).");
  const unrecorded = [{ kind: "value_changed", name: "Password" }];
  assert.equal(SF.draftedNarration(unrecorded), "Edited Password.");
  assert.equal(SF.draftedNarration([{ kind: "value_changed", name: "Comment", value: "" }]), "Cleared Comment.");
  // A description drafted before the lane ("Cleared Password") is still the drafting's.
  assert.equal(SF.isDraftedDescription("Entered \"test.supplier\" into User name. Cleared Password.", secret), true);
  assert.equal(SF.isDraftedDescription("Cleared Password.", unrecorded), true);
  assert.equal(SF.isDraftedDescription("Typed the password.", unrecorded), false);
});

test("where a draft ends comes from end_reason and its interactions", () => {
  const datas = [{ window_title: "Salesforce" + SEP + "Order #10900" }, { meaningful_name: "Save order", name: "btn" }];
  assert.equal(SF.endsAt({ end_reason: "commit" }, datas), "ends at Save order");
  assert.equal(SF.endsAt({ end_reason: "screen_change" }, datas), "ends at a screen change");
  assert.equal(SF.endsAt({ end_reason: "run_end", case_id: "c1" }, datas), "ends with the transaction");
  assert.equal(SF.endsAt({ end_reason: "run_end", case_id: null }, datas), "");
  assert.equal(SF.endsAt({ state: "edited" }, datas), "", "a split or merged step is no longer one draft");
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

test("2.0.1: the Recorded line says how many actions and where a draft ends; the pointer says where the step is", () => {
  const origin = Date.parse("2026-05-14T09:00:00Z");
  const step = { case_id: "c1", time_range: { start: "2026-05-14T09:00:19Z", end: "2026-05-14T09:00:25Z" } };
  assert.equal(SF.duration(step.time_range), "6s");
  assert.equal(SF.recordedLine({ actions: 6, ends: "ends at Search" }), "6 actions · ends at Search");
  assert.equal(SF.recordedLine({ actions: 1 }), "1 action");
  assert.equal(SF.recordedLine({}), "", "a step added by hand");
  const runs = [{ caseId: "c1", title: "Transaction 1" }];
  assert.equal(SF.pointer(step, runs, origin), "Transaction 1 at 0:19");
  assert.equal(SF.pointer(Object.assign({}, step, { case_id: null }), runs, origin), "0:19 into the recording");
  assert.equal(SF.pointer({ time_range: null }, runs, origin), "");
});

/* The step panel's rows and the line above them (the owner's review: "It
   shows different timelines for each transaction ... I have no idea what
   they represent"). */

test("a row of the step panel reads what it is: the transaction (again for a second time in it), the time since the recording started, how long it took", () => {
  const origin = Date.parse("2026-05-14T09:00:00Z");
  const t = (s) => new Date(origin + s * 1000).toISOString();
  const run = (n) => ({ caseId: "c" + n, ordinal: n, title: "Transaction " + n });
  const step = (a, b) => ({ time_range: { start: t(a), end: b == null ? null : t(b) } });
  assert.equal(SF.occurrenceLine(step(39, 47), run(1), false, origin), "Transaction 1 · 0:39 into the recording · took 8s");
  assert.equal(SF.occurrenceLine(step(134, 143), run(2), true, origin), "Transaction 2, again · 2:14 into the recording · took 9s");
  assert.equal(SF.occurrenceLine(step(19, 25), null, false, origin), "Outside the transactions · 0:19 into the recording · took 6s");
  assert.equal(SF.occurrenceLine(step(65, null), run(1), false, origin), "Transaction 1 · 1:05 into the recording", "an open step has no length");
  assert.equal(SF.occurrenceLine(step(65, 600), run(1), false, origin, "video", true), "Transaction 1 · 1:05 into the video · open",
    "the step being marked, nothing after it yet: open, not 8m 55s");
  assert.equal(SF.occurrenceLine({ time_range: null }, run(3), false, origin), "Transaction 3 · no time in the recording", "a step added by hand");
  // Lane FX3 (validation pass 3, F22): a project made from a video reads its
  // video's time; one with neither a recording nor a video, no time.
  assert.equal(SF.occurrenceLine(step(39, 47), run(1), false, origin, "video"), "Transaction 1 · 0:39 into the video · took 8s");
  assert.equal(SF.occurrenceLine({ time_range: null }, run(1), false, origin, "video"), "Transaction 1 · no time in the video");
  assert.equal(SF.occurrenceLine({ time_range: null }, run(1), false, origin, ""), "Transaction 1 · no time");
});

test("the line above the rows is built from them: how many times, in which transactions, and what a row's play does", () => {
  const run = (n) => ({ caseId: "c" + n, ordinal: n, title: "Transaction " + n });
  const rows = (...ns) => ns.map((n) => ({ run: n ? run(n) : null }));
  const L = SF.occurrencesLine;
  assert.equal(L(rows(1, 2, 2, 3, 4), 4, 5),
    "This step happened 5 times: once in transactions 1, 3 and 4, twice in transaction 2. Play any of them.");
  assert.equal(L(rows(1, 2, 3, 4), 4, 4), "This step happened 4 times: once in each transaction. Play any of them.");
  assert.equal(L(rows(1, 1, 2, 2), 2, 4), "This step happened 4 times: twice in each transaction. Play any of them.");
  assert.equal(L(rows(1, 3), 4, 2), "This step happened twice: once in transactions 1 and 3. Play any of them.");
  assert.equal(L(rows(2), 4, 1), "This step happened once in transaction 2. Play it.");
  assert.equal(L(rows(1), 1, 1), "This step happened once in transaction 1. Play it.");
  assert.equal(L(rows(2, 2, 2), 4, 3), "This step happened 3 times in transaction 2. Play any of them.");
  assert.equal(L(rows(1, 2, 3, 4, 5, 6, 8, 9, 9), 10, 9),
    "This step happened 9 times: once in transactions 1 to 6 and 8, twice in transaction 9. Play any of them.", "a stretch of three or more reads a to b");
  assert.equal(L(rows(0), 0, 1), "This step happened once, outside the transactions. Play it.");
  assert.equal(L(rows(1, 0), 1, 2), "This step happened twice: once in transaction 1, once outside the transactions. Play any of them.");
  // No video: nothing to play. A row with no time (a step added by hand) has no play button.
  assert.equal(L(rows(1, 2), 2, 0), "This step happened twice: once in each transaction.");
  assert.equal(L(rows(1, 2, 3), 3, 2), "This step happened 3 times: once in each transaction. Play the ones with a time.");
  assert.equal(L(rows(1, 2), 2, 1), "This step happened twice: once in each transaction. Play the one with a time.");
  assert.equal(L([], 4, 0), "");
});

test("lane FX2: where a step's moment is in the video: covered, outside (before its start, or past its end once its length is known), without a time, or not placed", () => {
  const T0 = Date.parse("2026-05-14T09:00:15Z");   // the video's 0:00 on the project's clock
  const at = (sec) => new Date(Date.parse("2026-05-14T09:00:00Z") + sec * 1000).toISOString();
  const step = (a, b) => ({ time_range: { start: at(a), end: b == null ? null : at(b) } });
  const LEN = 32000;   // a 32 s video: it covers 0:15 to 0:47 of the recording
  assert.deepEqual(SF.videoMoment(step(20, 25), T0, LEN), { kind: "covered", at: 5, to: 10 });
  assert.deepEqual(SF.videoMoment(step(49, 53), T0, LEN), { kind: "outside", at: 34 }, "after the video's end");
  assert.deepEqual(SF.videoMoment(step(47, 48), T0, LEN), { kind: "outside", at: 32 }, "the end itself is past the last frame");
  assert.deepEqual(SF.videoMoment(step(10, 20), T0, LEN), { kind: "outside", at: -5 }, "before the video starts");
  assert.deepEqual(SF.videoMoment(step(49, null), T0, NaN), { kind: "covered", at: 34, to: null }, "a length not known yet: after the start counts");
  assert.deepEqual(SF.videoMoment({ time_range: null }, T0, LEN), { kind: "untimed" });
  assert.deepEqual(SF.videoMoment(step(20, 25), NaN, LEN), { kind: "unplaced" });
  assert.equal(SF.NOT_COVERED, "The video does not cover this moment");
});

test("lane FX2: the line above the rows says which rows play when the video does not cover the others", () => {
  const run = (n) => ({ caseId: "c" + n, ordinal: n, title: "Transaction " + n });
  const rows = (...ns) => ns.map((n) => ({ run: run(n) }));
  const L = SF.occurrencesLine;
  assert.equal(L(rows(1, 2, 3, 4), 4, 3, 1), "This step happened 4 times: once in each transaction. Play the ones the video covers.");
  assert.equal(L(rows(1, 2), 2, 1, 1), "This step happened twice: once in each transaction. Play the one the video covers.");
  assert.equal(L(rows(1, 2), 2, 0, 2), "This step happened twice: once in each transaction.", "none covered: nothing to play");
  assert.equal(L(rows(1, 2, 3), 3, 2, 0), "This step happened 3 times: once in each transaction. Play the ones with a time.");
});

test("2.0.1: a duration reads one way everywhere, the PDD's: under 1s (never 0s), 42s, 2m 17s, 1h 04m; never m:ss, which is a moment", () => {
  assert.equal(SF.formatMs(0), "under 1s");
  assert.equal(SF.formatMs(999), "under 1s");
  assert.equal(SF.formatMs(1000), "1s");
  assert.equal(SF.formatMs(28900), "29s");
  assert.equal(SF.formatMs(137000), "2m 17s");
  assert.equal(SF.formatMs(180000), "3m");
  assert.equal(SF.formatMs(3840000), "1h 04m");
  assert.equal(SF.formatMs(-1), "");
  assert.equal(SF.formatMs(NaN), "");
});
