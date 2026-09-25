"use strict";

/*
 * Unit tests for sub-process-verbs.js (contract C19): Open as a sub-process
 * (sub-steps drafted from the demo's real recorded events), Group into a
 * sub-process (every transaction, with the link repairs), Dissolve (a group
 * and an opened step), and the renames. The confirm cascade and the names
 * across levels are runs-model.js's (runs-model.test.js). Run with `npm test`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const SPV = require("./sub-process-verbs.js");
const SPM = require("./sub-process-maps.js");
const RunsModel = require("./runs-model.js");
const { mapNodeLabel } = require("./process-map-levels.js");

/* The committed demo's recording, read only: sess-2026-0514-0900, the
   order-to-cash process recorded four times. */
const DEMO = path.join(__dirname, "..", "sessions", "example-aggregate", "sess-2026-0514-0900");
const EVENTS = fs.readFileSync(path.join(DEMO, "events.jsonl"), "utf8").split(/\r?\n/)
  .filter((l) => l.trim()).map((l) => JSON.parse(l));
const INTER = Object.fromEntries(EVENTS.filter((e) => e.type === "interaction").map((e) => [e.event_id, e]));
const SHOT_TIMES = Object.fromEntries(EVENTS.filter((e) => e.type === "system" && e.data && e.data.path)
  .map((e) => [e.data.path, e.timestamp]));
const at = (hms) => "2026-05-14T" + hms + "Z";

let _n = 0;
const newId = () => "new-" + (++_n);

/* A drafted step of the demo (contract C1): the interactions recorded from
   `from` to `to` in the draft key's application, and the screenshots taken
   then. */
function drafted(id, caseId, from, to, draftKey, name, extra) {
  const inSpan = (e) => e.timestamp >= at(from) && e.timestamp <= at(to);
  const app = draftKey ? draftKey.split("|")[0] : null;
  const inApp = (e) => !app || String(e.data.process_name || "").toLowerCase().replace(/\.exe$/, "") === app;
  return Object.assign({
    step_id: id, session_id: "sess-2026-0514-0900", case_id: caseId, name, description: "",
    time_range: { start: at(from), end: at(to) },
    evidence: {
      interaction_event_ids: EVENTS.filter((e) => e.type === "interaction" && inSpan(e) && inApp(e)).map((e) => e.event_id),
      screenshot_refs: EVENTS.filter((e) => e.type === "system" && e.data && e.data.path && inSpan(e)).map((e) => e.data.path),
      video_timecode_range: null, manual_notes: "",
    },
    state: "auto_suggested", draft_key: draftKey, name_source: "draft", end_reason: "commit",
    flags: { waste: false }, process_label: name,
  }, extra || {});
}

const K_SEARCH = "chrome|Salesforce - Account lookup|Button:search";
const K_SAVE = "chrome|Salesforce - Order|Button:save-order";
const K_CHECK = "sapgui|va01|MenuItem:check-document";
const K_CREATE = "sapgui|va01|Button:create-sales-order";
const K_EXCEL = "excel|Excel - Order Tracking.xlsx|Button:save-workbook";

/* ---- Open as a sub-process: drafting from the recorded events -------------- */

test("C19 drafting: one sub-step per recorded action of the demo's Save order step, named without values, described with them", () => {
  const save = drafted("save1", "run1", "09:00:29", "09:00:37", K_SAVE, "Salesforce - Order: Save order");
  const subs = SPV.draftSubSteps(save, INTER, { newId, shotTimes: SHOT_TIMES });
  assert.deepEqual(subs.map((s) => s.name), ["Enter Product code", "Enter Quantity", "Enter Unit price",
    "Enter Shipping address", "Enter Delivery method", "Click Save order"]);
  assert.deepEqual(subs.map((s) => s.action_key), [
    "chrome|Salesforce - Order|enter:product-code", "chrome|Salesforce - Order|enter:quantity",
    "chrome|Salesforce - Order|enter:unit-price", "chrome|Salesforce - Order|enter:shipping-address",
    "chrome|Salesforce - Order|enter:delivery-method", "chrome|Salesforce - Order|click:save-order"]);
  assert.deepEqual(subs.map((s) => s.description), [
    "Entered \"SKU-4471\" into Product code.", "Entered \"29\" into Quantity.", "Entered \"49.99\" into Unit price.",
    "Entered \"144 Maple Ave\" into Shipping address.", "Entered \"Express\" into Delivery method.", "Clicked Save order."]);
  // Each runs from its first event to the next action's first event; the
  // last ends at its own last event.
  assert.deepEqual(subs.map((s) => [s.time_range.start.slice(11, 19), s.time_range.end.slice(11, 19)]),
    [["09:00:29", "09:00:31"], ["09:00:31", "09:00:33"], ["09:00:33", "09:00:34"], ["09:00:34", "09:00:35"],
      ["09:00:35", "09:00:37"], ["09:00:37", "09:00:37"]]);
  for (const s of subs) {
    assert.equal(s.state, "auto_suggested");
    assert.equal(s.name_source, "action");
    assert.equal(s.case_id, "run1", "a sub-step has its parent's case_id");
    assert.equal(s.draft_key, undefined, "no draft_key: the click on the commit would repeat the parent's");
    assert.equal(s.process_label, s.name);
    assert.equal(s.evidence.interaction_event_ids.length, 1);
    assert.equal(mapNodeLabel(s), s.name, "a drafted sub-step is its own node");
    for (const v of ["SKU-4471", "29", "49.99", "Maple", "Express"]) assert.ok(!s.name.includes(v), s.name + " holds no typed value");
  }
});

test("C19 drafting: a focus change is no action, consecutive events on one field are one, and the screenshots taken in an action's span go with it", () => {
  const search = drafted("search1", "run1", "09:00:19", "09:00:25", K_SEARCH, "Salesforce - Account lookup: Search");
  const subs = SPV.draftSubSteps(search, INTER, { newId, shotTimes: SHOT_TIMES });
  assert.deepEqual(subs.map((s) => [s.name, s.evidence.interaction_event_ids.length]), [["Enter Customer ID field", 2], ["Click Search", 1]]);
  assert.equal(subs[0].description, "Entered \"CUST-10900\" into Customer ID field.");
  assert.equal(subs[0].time_range.start, at("09:00:21"), "the focus change at 0:19 is not part of it");
  // The step's screenshot was taken at 0:19, before its first action.
  assert.deepEqual(subs.flatMap((s) => s.evidence.screenshot_refs), []);
  const excel = drafted("excel1", "run1", "09:00:49", "09:00:54", K_EXCEL, "Excel - Order Tracking.xlsx: Save workbook");
  const xs = SPV.draftSubSteps(excel, INTER, { newId, shotTimes: SHOT_TIMES });
  assert.deepEqual(xs.map((s) => s.evidence.screenshot_refs), [["screenshots/shot_02.png"], [], [], [], []]);
  // A screenshot the analyst took off the step goes with no sub-step.
  excel.hidden_screenshots = ["screenshots/shot_02.png"];
  assert.deepEqual(SPV.draftSubSteps(excel, INTER, { newId, shotTimes: SHOT_TIMES }).flatMap((s) => s.evidence.screenshot_refs), []);
});

test("C19 drafting: a selection without a value, a menu item and a document's text are actions too, in the Interactions list's words", () => {
  const open = drafted("open1", "run1", "09:00:26", "09:00:28", "chrome|Salesforce - Account lookup|Button:open-customer-record", "Open");
  assert.deepEqual(SPV.draftSubSteps(open, INTER, { newId }).map((s) => [s.name, s.description]), [
    ["Change selection in Customer result row", "Changed selection in Customer result row."],
    ["Click Open customer record", "Clicked Open customer record."]]);
  const check = drafted("check1", "run1", "09:00:39", "09:00:47", K_CHECK, "va01: Check document");
  const cs = SPV.draftSubSteps(check, INTER, { newId });
  assert.deepEqual(cs.map((s) => s.name), ["Enter Order type", "Enter Sales organisation", "Enter Material number",
    "Enter Order quantity", "Open Check document", "Click Create sales order"]);
  assert.equal(cs[4].action_key, "sapgui|va01|click:check-document", "app and screen from the parent's draft_key");
  const mail = drafted("send1", "run1", "09:00:54", "09:00:59", "outlook|Outlook - Order confirmation|Button:send", "Send");
  const ms = SPV.draftSubSteps(mail, INTER, { newId });
  assert.deepEqual(ms.map((s) => s.name), ["Enter To", "Enter Subject", "Enter Message body", "Click Send"]);
  assert.equal(ms[2].description, "Entered \"Your order is confirmed.\" into Message body.");
});

test("C19 drafting: without a draft_key the app and the screen come from each action's event, without values", () => {
  const merged = drafted("m", "run1", "09:00:29", "09:00:37", undefined, "Merged");
  delete merged.draft_key;
  const subs = SPV.draftSubSteps(merged, INTER, { newId });
  assert.equal(subs[0].action_key, "chrome|Salesforce - Order|enter:product-code",
    "the window title Salesforce - Order #10900 reads Salesforce - Order: the same key in every transaction");
  const other = drafted("m2", "run2", "09:01:52", "09:01:59", undefined, "Merged");
  delete other.draft_key;
  assert.deepEqual(SPV.draftSubSteps(other, INTER, { newId }).map((s) => s.action_key), subs.map((s) => s.action_key));
  assert.equal(SPV.parentPrefix({ draft_key: "notepad|Notepad - Internal mappings.txt|(visit)" }, []), "notepad|Notepad - Internal mappings.txt");
  assert.equal(SPV.parentPrefix({ draft_key: "app|Screen | with a bar|Button:ok" }, [{ control_type: "Button", automation_id: "ok" }]),
    "app|Screen | with a bar", "the commit part is cut, never a bar in the screen");
});

test("C19 drafting: a name the project's own sub-steps give the action wins; a step with no recorded action drafts none", () => {
  const save = drafted("save1", "run1", "09:00:29", "09:00:37", K_SAVE, "Save order");
  const projectNames = { "chrome|Salesforce - Order|enter:quantity": "Type the quantity" };
  const q = SPV.draftSubSteps(save, INTER, { newId, projectNames })[1];
  assert.deepEqual([q.name, q.name_source, q.process_label], ["Type the quantity", "remembered", "Type the quantity"]);
  const byHand = { step_id: "h", name: "Call the customer", state: "manually_authored", case_id: "run1", time_range: null,
    evidence: { interaction_event_ids: [], screenshot_refs: [] } };
  assert.deepEqual(SPV.draftSubSteps(byHand, INTER, { newId }), []);
  // What the drafting gives a sub-step, from its own events (Forget, Dissolve).
  const d = SPV.draftSubSteps(save, INTER, { newId })[0];
  assert.deepEqual(SPV.draftedAction(d, INTER), { name: "Enter Product code", description: "Entered \"SKU-4471\" into Product code." });
});

test("C19 Open as a sub-process: every visible occurrence of the node without sub_steps, in every transaction, and drafts become edited; again drafts only the new ones", () => {
  const t1 = [drafted("search1", "run1", "09:00:19", "09:00:25", K_SEARCH, "Search"), drafted("save1", "run1", "09:00:29", "09:00:37", K_SAVE, "Save order")];
  const t2 = [drafted("search2", "run2", "09:01:46", "09:01:49", K_SEARCH, "Search"), drafted("save2", "run2", "09:01:52", "09:01:59", K_SAVE, "Save order")];
  const t3 = [drafted("save3", "run3", "09:03:31", "09:03:41", K_SAVE, "Save order", { state: "hidden", _prev_state: "auto_suggested" })];
  const r = SPV.openAsSubProcess([t1, t2, t3], [], t1[1], INTER, { newId });
  assert.deepEqual(r.steps.map((s) => s.step_id), ["save1", "save2"]);
  assert.equal(r.subSteps, 12);
  assert.deepEqual([t1[1].state, t2[1].state], ["edited", "edited"]);
  assert.equal(t2[1].sub_steps[0].case_id, "run2");
  assert.equal(t3[0].sub_steps, undefined, "a hidden occurrence is left as it is");
  assert.equal(t1[0].sub_steps, undefined, "another node is left as it is");
  const t4 = [drafted("save4", "run4", "09:04:40", "09:04:47", K_SAVE, "Save order")];
  const again = SPV.openAsSubProcess([t1, t2, t3, t4], [], t1[1], INTER, { newId });
  assert.deepEqual(again.steps.map((s) => s.step_id), ["save4"]);
  assert.equal(t1[1].sub_steps.length, 6, "the ones already opened keep their sub-steps");
});

/* ---- Group into a sub-process ------------------------------------------------ */

/* Three transactions of the demo's shape: transaction 2 checks and creates
   the sales order twice, around a look at a notepad. */
function groupFixture() {
  const t1 = [
    drafted("save1", "run1", "09:00:29", "09:00:37", K_SAVE, "Save order"),
    drafted("check1", "run1", "09:00:39", "09:00:47", K_CHECK, "Check document", { links: [{ to: "create1", when: "the check passes" }] }),
    { step_id: "note1", name: "A hidden look", state: "hidden", _prev_state: "manually_authored", case_id: "run1",
      time_range: { start: at("09:00:45"), end: at("09:00:45") }, evidence: { interaction_event_ids: [], screenshot_refs: [] } },
    drafted("create1", "run1", "09:00:47", "09:00:47", K_CREATE, "Create sales order", { links: [{ to: "end", when: "the order is cancelled" }] }),
    drafted("excel1", "run1", "09:00:49", "09:00:54", K_EXCEL, "Update tracker", { links: [{ to: "check1", when: "a price is missing" }] }),
  ];
  const t2 = [
    drafted("check2a", "run2", "09:02:01", "09:02:06", K_CHECK, "Check document"),
    drafted("create2a", "run2", "09:02:08", "09:02:08", K_CREATE, "Create sales order"),
    drafted("pad2", "run2", "09:02:10", "09:02:14", "notepad|Notepad - Internal mappings.txt|(visit)", "Look up the plant code"),
    drafted("check2b", "run2", "09:02:14", "09:02:23", K_CHECK, "Check document"),
    drafted("create2b", "run2", "09:02:23", "09:02:23", K_CREATE, "Create sales order"),
  ];
  const t3 = [drafted("excel3", "run3", "09:03:54", "09:04:01", K_EXCEL, "Update tracker")];
  return { t1, t2, t3, root: t1.concat(t2, t3) };
}
const SYSTEM = (s) => (String(s.draft_key || "").startsWith("sapgui") ? "SAP" : "Other");

test("C19 Group: the ticked steps, with a hidden one between them, move into a new group, and every stretch of the same steps is grouped in every transaction", () => {
  const { t1, t2, t3, root } = groupFixture();
  const check = SPV.groupCheck([t1, t2, t3], [], ["check1", "create1"]);
  assert.deepEqual([check.groups, check.transactions], [3, 2], "what the name prompt says before anything moves");
  const r = SPV.groupInto(root, [t1, t2, t3], [], ["check1", "create1"], { name: "Create the sales order", newId, systemOf: SYSTEM });
  assert.equal(r.error, undefined);
  assert.equal(r.ticked, r.groups[0], "the ticked steps' group");
  assert.equal(r.groups.length, 3, "one in transaction 1, two in transaction 2");
  assert.equal(r.transactions, 2);
  const g = r.groups[0];
  assert.deepEqual(g.sub_steps.map((s) => s.step_id), ["check1", "note1", "create1"], "the hidden step between them goes in too");
  assert.equal(g.group, true);
  assert.equal(g.state, "manually_authored");
  assert.equal(g.case_id, "run1");
  assert.deepEqual(g.time_range, { start: at("09:00:39"), end: at("09:00:47") });
  assert.equal(g.description, "");
  assert.equal(g.system, "SAP", "the members' one system");
  assert.equal(g.draft_key, undefined);
  assert.equal(g.draft_keys, undefined);
  assert.equal(mapNodeLabel(g), "Create the sales order");
  assert.deepEqual(g.evidence.interaction_event_ids,
    t1[1].evidence.interaction_event_ids.concat(t1[3].evidence.interaction_event_ids));
  // The main level now holds the groups where the steps were.
  assert.deepEqual(root.map((s) => s.step_id).filter((id) => !id.startsWith("new-")), ["save1", "excel1", "pad2", "excel3"]);
  assert.deepEqual(r.groups.map((x) => x.sub_steps.map((s) => s.step_id)),
    [["check1", "note1", "create1"], ["check2a", "create2a"], ["check2b", "create2b"]]);
  assert.equal(r.groups[1].system, "SAP");
  assert.ok(r.groups[1].sub_steps.every((s) => s.state === "auto_suggested" && s.draft_key), "the members move unchanged");
  // The maps: the group is a sub-process node in both transactions.
  const maps = SPM.mapTree([root.filter((s) => s.case_id === "run1"), root.filter((s) => s.case_id === "run2")]);
  assert.deepEqual(maps.map((m) => [m.path, m.number]), [[[], null], [["Create the sales order"], "2"]]);
});

test("C19 Group: the links (from outside to a member: the group; a member's link out of it or to End: the group's; among members: stays)", () => {
  const { t1, t2, t3, root } = groupFixture();
  const r = SPV.groupInto(root, [t1, t2, t3], [], ["check1", "create1"], { name: "Create the sales order", newId });
  const g = r.groups[0];
  // Lane FX2: each moved link remembers the member it went to or came from,
  // so Dissolve gives it back there.
  assert.deepEqual(t1[4].links, [{ to: g.step_id, when: "a price is missing", pointed_to: "check1" }], "a loop back into the group points at the group");
  assert.deepEqual(g.links, [{ to: "end", when: "the order is cancelled", lifted_from: ["create1"] }], "a member's link to End moves to the group");
  assert.deepEqual(t1[1].links, [{ to: "create1", when: "the check passes" }], "a link among members stays");
  assert.equal(t1[3].links, undefined);
});

test("C19 Group: refused unless two or more consecutive visible steps of one transaction are ticked", () => {
  const cases = [
    [["check1", "excel1"], "gap"],
    [["check1", "check2a"], "places"],
    [["check1"], "few"],
    [["check1", "note1"], "hidden"],
    [["nope"], "none"],
  ];
  for (const [ids, err] of cases) {
    const { t1, t2, t3, root } = groupFixture();
    const before = JSON.stringify(root);
    assert.equal(SPV.groupInto(root, [t1, t2, t3], [], ids, { name: "G", newId }).error, err, ids.join());
    assert.equal(JSON.stringify(root), before, "nothing changes");
  }
});

test("C19 Group at a level below the main one groups inside every visit of it", () => {
  const save1 = drafted("save1", "run1", "09:00:29", "09:00:37", K_SAVE, "Save order");
  const save2 = drafted("save2", "run2", "09:01:52", "09:01:59", K_SAVE, "Save order");
  const root = [save1, save2];
  SPV.openAsSubProcess([[save1], [save2]], [], save1, INTER, { newId });
  const [p, q] = [save1.sub_steps[0].step_id, save1.sub_steps[1].step_id];
  const r = SPV.groupInto(root, [[save1], [save2]], ["Save order"], [p, q], { name: "Enter the product", newId });
  assert.equal(r.groups.length, 2);
  assert.deepEqual(save2.sub_steps.map((s) => s.name), ["Enter the product", "Enter Unit price", "Enter Shipping address", "Enter Delivery method", "Click Save order"]);
  assert.equal(save2.sub_steps[0].case_id, "run2");
  assert.deepEqual(SPM.findStep(root, r.groups[1].sub_steps[0].step_id).path, ["Save order", "Enter the product"]);
});

/* ---- Dissolve ---------------------------------------------------------------- */

test("C19 Dissolve a group: its sub-steps come back in its place, in every transaction, with the links, the condition and the content moved", () => {
  const { t1, t2, t3, root } = groupFixture();
  const anno = { steps: root };
  const r = SPV.groupInto(root, [t1, t2, t3], [], ["check1", "create1"], { name: "Create the sales order", newId });
  const g = r.groups[0];
  g.only_when = "a new customer";
  g.links = (g.links || []).concat([{ to: "save1", when: "the stock is short" }]);
  anno.analyst_notes = [{ id: "n1", text: "Ask the SAP team", step_id: g.step_id }];
  anno.attachments = [{ id: "a1", file: "form.pdf", label: "Form", step_id: g.step_id }];
  // Inside the group, a sub-step's link to End (it ended the group).
  t1[1].links.push({ to: "end", when: "the document is blocked" });
  const txs = [root.filter((s) => s.case_id === "run1"), root.filter((s) => s.case_id === "run2"), root.filter((s) => s.case_id === "run3")];
  const loss = SPV.dissolveLoss(txs, [], "Create the sales order", INTER);
  assert.deepEqual([loss.occurrences, loss.groups, loss.opened, loss.descriptions, loss.flow], [3, 3, 0, 0, 0], "a group loses nothing");
  const d = SPV.dissolve(anno, txs, [], "Create the sales order");
  assert.deepEqual(d, { groups: 3, opened: 0 });
  assert.ok(!SPM.allSteps(root).some((s) => s.group), "no group is left");
  assert.deepEqual(root.filter((s) => s.case_id === "run1").map((s) => s.step_id).sort(),
    ["check1", "create1", "excel1", "note1", "save1"]);
  assert.deepEqual(t1[4].links, [{ to: "check1", when: "a price is missing" }], "a link to the group points at its first sub-step");
  assert.deepEqual(t1[1].links, [{ to: "create1", when: "the check passes" }, { to: "excel1", when: "the document is blocked" }],
    "a sub-step's link to End points at the step that followed the group");
  assert.deepEqual(t1[3].links, [{ to: "end", when: "the order is cancelled" }, { to: "save1", when: "the stock is short" }],
    "the group's own links go to its last sub-step");
  assert.equal(t1[1].only_when, "a new customer", "its condition goes to its first sub-step");
  assert.equal(anno.analyst_notes[0].step_id, "check1");
  assert.equal(anno.attachments[0].step_id, "check1");
});

test("C19 Dissolve an opened step: it drops its sub-steps, what the analyst added to them moves to it, and the loss counts only what the analyst wrote", () => {
  const save1 = drafted("save1", "run1", "09:00:29", "09:00:37", K_SAVE, "Save order");
  const save2 = drafted("save2", "run2", "09:01:52", "09:01:59", K_SAVE, "Save order");
  const root = [save1, save2];
  SPV.openAsSubProcess([[save1], [save2]], [], save1, INTER, { newId });
  const s0 = save1.sub_steps[0], s1 = save1.sub_steps[1];
  s1.description = "Type the quantity from the customer's email.";
  s1.state = "edited";
  s0.links = [{ to: s1.step_id, when: "" }];
  s1.only_when = "the customer asks for more";
  const anno = { steps: root, analyst_notes: [{ id: "n1", text: "Check the unit", step_id: s1.step_id }],
    analyst_screenshots: [{ id: "sh1", file: "sh1.png", step_id: s0.step_id }] };
  const loss = SPV.dissolveLoss([[save1], [save2]], [], "Save order", INTER);
  assert.deepEqual(loss, { occurrences: 2, groups: 0, opened: 2, subSteps: 12, descriptions: 1, flow: 2 },
    "the drafted descriptions are not counted, the one written is; one condition and one link");
  const d = SPV.dissolve(anno, [[save1], [save2]], [], "Save order");
  assert.deepEqual(d, { groups: 0, opened: 2 });
  assert.equal(save1.sub_steps, undefined);
  assert.equal(save2.sub_steps, undefined);
  assert.equal(anno.analyst_notes[0].step_id, "save1");
  assert.equal(anno.analyst_screenshots[0].step_id, "save1");
  assert.equal(save1.state, "edited", "it keeps everything it had");
});

test("lane FX2: Group then Dissolve gives each link back to the member that carried it, and each link to a member back to that member", () => {
  // Validation pass 2, F5: Check carries a Go to step 3 (a loop back), Create
  // follows it; grouped, the link moves to the group; dissolved, it went to
  // the last sub-step (Create) and the loop left after Create.
  const mk = (id, min, extra) => Object.assign({ step_id: id, name: id, process_label: id, state: "edited", case_id: "r",
    time_range: { start: at("09:00:" + min), end: at("09:00:" + min) } }, extra || {});
  const root = [mk("search", "10"), mk("open", "12"), mk("enter", "14"),
    mk("check", "16", { links: [{ to: "enter", when: "the check finds an error" }] }), mk("create", "18"),
    mk("log", "20", { links: [{ to: "create", when: "the order is incomplete" }] })];
  const txs = [root.slice()];
  const r = SPV.groupInto(root, txs, [], ["check", "create"], { name: "Create the order in SAP", newId });
  const g = r.groups[0];
  assert.deepEqual(g.links, [{ to: "enter", when: "the check finds an error", lifted_from: ["check"] }]);
  assert.deepEqual(root.find((s) => s.step_id === "log").links,
    [{ to: g.step_id, when: "the order is incomplete", pointed_to: "create" }]);
  const d = SPV.dissolve({ steps: root }, [root.slice()], [], "Create the order in SAP");
  assert.deepEqual(d, { groups: 1, opened: 0 });
  const by = (id) => root.find((s) => s.step_id === id);
  assert.deepEqual(by("check").links, [{ to: "enter", when: "the check finds an error" }], "the loop leaves after Check again");
  assert.equal(by("create").links, undefined, "Create carries no link");
  assert.deepEqual(by("log").links, [{ to: "create", when: "the order is incomplete" }], "the link into the group goes back to Create, not the first sub-step");
  assert.deepEqual(root.map((s) => s.step_id), ["search", "open", "enter", "check", "create", "log"]);
});

test("lane FX2: two members with the same link are both given it back; a link the group got of its own goes to its last sub-step", () => {
  const mk = (id, min, extra) => Object.assign({ step_id: id, name: id, process_label: id, state: "edited", case_id: "r",
    time_range: { start: at("09:01:" + min), end: at("09:01:" + min) } }, extra || {});
  const same = { to: "end", when: "the customer cancels" };
  const root = [mk("a", "10"), mk("b", "12", { links: [Object.assign({}, same)] }), mk("c", "14", { links: [Object.assign({}, same)] }), mk("d", "16")];
  const r = SPV.groupInto(root, [root.slice()], [], ["b", "c"], { name: "BC", newId });
  const g = r.groups[0];
  assert.deepEqual(g.links, [{ to: "end", when: "the customer cancels", lifted_from: ["b", "c"] }], "kept once on the group");
  g.links.push({ to: "a", when: "a retry is needed" });
  SPV.dissolve({ steps: root }, [root.slice()], [], "BC");
  const by = (id) => root.find((s) => s.step_id === id);
  assert.deepEqual(by("b").links, [{ to: "end", when: "the customer cancels" }]);
  assert.deepEqual(by("c").links, [{ to: "end", when: "the customer cancels" }, { to: "a", when: "a retry is needed" }]);
});

test("lane FX2: Group's prompt says what it will do before it is done: the groups, where they are, and a group of another size", () => {
  const mk = (id, name, c, sec) => ({ step_id: id, name, process_label: name, state: "edited", case_id: c,
    time_range: { start: at("09:02:" + sec), end: at("09:02:" + sec) } });
  const say = (txs, ids) => SPV.groupPromptText(SPV.groupCheck(txs, [], ids), ids.length);
  const lone = [mk("a1", "Check", "r1", "10"), mk("b1", "Create", "r1", "12"), mk("c1", "Log", "r1", "14")];
  assert.equal(say([lone], ["a1", "b1"]), "Groups these 2 steps (1 group).");
  const other = (n, sec) => [mk("a" + n, "Check", "r" + n, sec), mk("b" + n, "Create", "r" + n, String(Number(sec) + 2))];
  assert.equal(say([lone, other(2, "20"), other(3, "30")], ["a1", "b1"]),
    "Groups these 2 steps and the same steps in 2 other transactions (3 groups).");
  const { t1, t2, t3 } = groupFixture();
  assert.equal(say([t1, t2, t3], ["check1", "create1"]),
    "Groups these 2 steps and the same steps in 2 other places, in 1 transaction (3 groups).", "the demo's shape: twice in transaction 2");
  const twice = lone.concat([mk("a4", "Check", "r1", "16"), mk("b4", "Create", "r1", "18")]);
  assert.equal(say([twice], ["a1", "b1"]),
    "Groups these 2 steps and the same steps in 1 other place of this transaction (2 groups).");
  const longer = [mk("a5", "Check", "r2", "40"), mk("a6", "Check", "r2", "41"), mk("b5", "Create", "r2", "42")];
  assert.equal(say([lone, longer], ["a1", "b1"]),
    "Groups these 2 steps and the same steps in 1 other transaction (2 groups). " +
    "In transaction 2 a group takes three steps, the same steps one after the other there.");
  // It is said from the check alone: what groupInto then does matches it.
  const check = SPV.groupCheck([lone, longer], [], ["a1", "b1"]);
  const r = SPV.groupInto(lone.concat(longer), [lone.slice(), longer.slice()], [], ["a1", "b1"], { name: "G", newId });
  assert.equal(r.groups.length, check.groups);
  assert.deepEqual(r.groups.map((g) => g.sub_steps.length), [2, 3]);
});

test("C19 Dissolve: untimed sub-steps take the group's place among the untimed steps", () => {
  const mk = (id, order) => ({ step_id: id, name: id, process_label: id, state: "manually_authored", case_id: "r", time_range: null, order });
  const root = [mk("a", 1), mk("b", 2), mk("c", 3), mk("d", 4)];
  const r = SPV.groupInto(root, [root.slice()], [], ["b", "c"], { name: "BC", newId });
  assert.equal(r.groups[0].order, 2);
  assert.equal(r.groups[0].time_range, null);
  const txs = [root.slice()];
  SPV.dissolve({ steps: root }, txs, [], "BC");
  assert.deepEqual(SPM.inOrder(root).map((s) => [s.step_id, s.order]), [["a", 1], ["b", 2], ["c", 3], ["d", 5]]);
});

/* ---- Renames ---------------------------------------------------------------- */

test("C19 rename: a sub-process renamed renames every occurrence of its node at its level, whatever its state", () => {
  const { t1, t2, t3, root } = groupFixture();
  const r = SPV.groupInto(root, [t1, t2, t3], [], ["check1", "create1"], { name: "Create the sales order", newId });
  const [g1, g2, g3] = r.groups;
  g2.state = "hidden";
  g2._prev_state = "manually_authored";
  const txs = [root.filter((s) => s.case_id === "run1"), root.filter((s) => s.case_id === "run2"), root.filter((s) => s.case_id === "run3")];
  g1.name = "Enter the order in SAP";
  const n = SPV.renameNode(txs, [], "Create the sales order", "Enter the order in SAP", g1);
  assert.equal(n, 2);
  assert.deepEqual([g2.name, g3.name], ["Enter the order in SAP", "Enter the order in SAP"]);
  assert.deepEqual([g2.state, g3.state], ["hidden", "manually_authored"]);
  assert.equal(mapNodeLabel(g3), "Enter the order in SAP");
});

test("C19 rename: a drafted sub-step's name reaches the drafted sub-steps with its action_key; a draft's reaches its key's drafts at every level", () => {
  const save1 = drafted("save1", "run1", "09:00:29", "09:00:37", K_SAVE, "Save order");
  const save2 = drafted("save2", "run2", "09:01:52", "09:01:59", K_SAVE, "Save order");
  const save3 = drafted("save3", "run3", "09:03:31", "09:03:41", K_SAVE, "Save order");
  const root = [save1, save2, save3];
  SPV.openAsSubProcess([[save1], [save2], [save3]], [], save1, INTER, { newId });
  const [q1, q2, q3] = [save1, save2, save3].map((s) => s.sub_steps[1]);
  q3.state = "edited";
  q1.name = "Type the quantity";
  q1.state = "edited";
  assert.equal(RunsModel.propagateActionName(root, q1, "Type the quantity"), 1);
  assert.deepEqual([q2.name, q2.state, q2.name_source], ["Type the quantity", "auto_suggested", "remembered"]);
  assert.equal(q3.name, "Enter Quantity", "an edited sub-step keeps its name");
  // A group keeps drafts inside it; a rename of a draft of that key reaches them.
  const { t1, t2, t3, root: r2 } = groupFixture();
  SPV.groupInto(r2, [t1, t2, t3], [], ["check1", "create1"], { name: "G", newId });
  const top = drafted("check9", "run9", "09:04:49", "09:04:58", K_CHECK, "Check document");
  r2.push(top);
  top.name = "Check the order";
  assert.equal(RunsModel.propagateName(r2, top, "Check the order"), 3);
  assert.equal(t2[3].name, "Check the order");
});

test("C19 drafting: the rules for the kinds the demo does not record (toggles, tabs, secret, masked and empty values, unnamed controls)", () => {
  const P = "app|Screen";
  const a = (d) => SPV.actionOf(d, P);
  assert.deepEqual(a({ kind: "toggle_changed", name: "Express shipping", automation_id: "express", toggle_state: "on" }),
    { key: P + "|click:express", name: "Toggle Express shipping", description: "Turned Express shipping on." });
  assert.deepEqual(a({ kind: "selection_changed", control_type: "TabItem", name: "Details", selected_value: "Details" }),
    { key: P + "|click:Details", name: "Switch to Details", description: "Switched to Details." });
  assert.deepEqual(a({ kind: "value_changed", name: "Password", automation_id: "pw", value_redacted: true }),
    { key: P + "|enter:pw", name: "Enter Password", description: "Entered a secret value into Password." });
  assert.equal(a({ kind: "value_changed", name: "Card", value: "«masked»" }).description, "Entered a masked value into Card.");
  assert.equal(a({ kind: "value_changed", name: "Notes", value: "  " }), null, "an empty value is no action");
  assert.equal(a({ kind: "value_changed", name: "Notes", value: "null" }), null);
  assert.equal(a({ kind: "focus_changed", name: "Notes" }), null, "a focus change is no action");
  assert.equal(a({ kind: "invoked", control_type: "Button" }), null, "a control with no name is no action");
  // A link named by a record value: the name keeps no value, the description does.
  assert.deepEqual(a({ kind: "invoked", control_type: "Hyperlink", name: "INC0010010" }),
    { key: P + "|click:?", name: "Follow a link", description: "Followed INC0010010." });
  // Without a prefix, the event's application and screen, without values.
  assert.equal(SPV.actionOf({ kind: "invoked", control_type: "Button", name: "Save", process_name: "EXCEL.EXE", window_title: "Order #10900" }).key,
    "excel|Order|click:Save");
});

test("lane FX2: Open as a sub-process names a sub-step from the project's own sub-steps of its action, else with its drafted name", () => {
  const save1 = drafted("save1", "run1", "09:00:29", "09:00:37", K_SAVE, "Save order");
  const save2 = drafted("save2", "run2", "09:01:52", "09:01:59", K_SAVE, "Save order");
  const save3 = drafted("save3", "run3", "09:03:31", "09:03:41", K_SAVE, "Save order");
  const root = [save1, save2];
  SPV.openAsSubProcess([[save1], [save2]], [], save1, INTER, { newId });
  // The analyst renamed transaction 1's Quantity (edited) and accepted
  // transaction 2's Product code (confirmed).
  save1.sub_steps[1].name = "Type the quantity";
  save1.sub_steps[1].state = "edited";
  save2.sub_steps[0].state = "confirmed";
  save2.sub_steps[0].name = "Enter the product code";
  save2.sub_steps[2].state = "hidden";
  save2.sub_steps[2].name = "A hidden name";
  const names = SPV.projectActionNames(root, "run1");
  assert.deepEqual(names, {
    "chrome|Salesforce - Order|enter:quantity": "Type the quantity",
    "chrome|Salesforce - Order|enter:product-code": "Enter the product code",
  }, "typed names, then accepted ones; a draft or a hidden sub-step names nothing");
  const subs = SPV.draftSubSteps(save3, INTER, { newId, projectNames: names });
  const plain = SPV.draftSubSteps(save3, INTER, { newId });
  assert.deepEqual(subs.slice(0, 3).map((s) => [s.name, s.name_source]), [
    ["Enter the product code", "remembered"], ["Type the quantity", "remembered"], [plain[2].name, "action"]]);
  assert.equal(subs[3].name_source, "action");
  // A typed name wins over an accepted one, and the reference transaction's
  // over another's.
  save2.sub_steps[1].name = "Quantity typed in transaction 2";
  save2.sub_steps[1].state = "edited";
  assert.equal(SPV.projectActionNames(root, "run2")["chrome|Salesforce - Order|enter:quantity"], "Quantity typed in transaction 2");
  assert.equal(SPV.projectActionNames(root, "run1")["chrome|Salesforce - Order|enter:quantity"], "Type the quantity");
});

test("lane FX2: + Step at a moment inside a sub-process goes to its steps, at any depth: a sub-step with a time is split there, else a new sub-step starts there", () => {
  const mk = (id, a, b, extra) => Object.assign({ step_id: id, name: id, state: "manually_authored", case_id: "r",
    time_range: a == null ? null : { start: at("09:00:" + a), end: at("09:00:" + b) } }, extra || {});
  const inner = mk("inner", "20", "30", { sub_steps: [mk("deep1", "20", "24"), mk("deep2", "26", "30")] });
  const sub = mk("sub", "16", "32", { sub_steps: [mk("u1", null, null, { order: 1 }), inner] });
  const root = [mk("first", "05", "16"), sub, mk("last", "32", "40")];
  const ms = (s) => Date.parse(at("09:00:" + s));
  let p = SPV.momentPlace(root, ms("10"));
  assert.deepEqual([p.kind, p.list === root, p.index, p.parent], ["split", true, 0, null], "a main-level step is split as before");
  p = SPV.momentPlace(root, ms("18"));
  assert.deepEqual([p.kind, p.list === sub.sub_steps, p.parent && p.parent.step_id], ["open", true, "sub"],
    "inside the sub-process, between its steps with a time: a new sub-step there (never the sub-process split)");
  p = SPV.momentPlace(root, ms("22"));
  assert.deepEqual([p.kind, p.list[p.index].step_id, p.parent.step_id], ["split", "deep1", "inner"], "two levels down");
  p = SPV.momentPlace(root, ms("25"));
  assert.deepEqual([p.kind, p.parent.step_id], ["open", "inner"]);
  p = SPV.momentPlace(root, ms("45"));
  assert.deepEqual([p.kind, p.list === root, p.parent], ["open", true, null], "after every step: the main level");
  assert.equal(SPV.momentPlace(null, ms("10")).kind, "open");
});
