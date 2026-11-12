"use strict";

/* step-information.js (contract C26): the information a step uses or enters,
   the rules the step editor's Information section saves and reads by; the
   pipeline's step_context.py reads the same key the same way
   (test_step_information.py). */

const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("./step-information.js");

test("the editor's words are C26's and the brief's", () => {
  assert.equal(I.WORDS.heading, "Information");
  assert.equal(I.WORDS.recorded, "Recorded");
  assert.deepEqual([I.WORDS.name, I.WORDS.example, I.WORDS.goesTo], ["Information", "Example", "Where it goes"]);
  assert.equal(I.WORDS.add, "Add information");
  assert.equal(I.WORDS.addTitle, "Adds a line for something this step uses or enters.");
  assert.equal(I.WORDS.remove, "Remove");
  assert.equal(I.WORDS.removeTitle, "Takes this line out. Ctrl+Z brings it back.");
  assert.equal(I.WORDS.emptyName, "A line needs a name, so it was taken out. Ctrl+Z brings it back.");
});

test("add: a line with a name is kept at the end, cleaned to one line; one without a name is not", () => {
  const st = { state: "manually_authored" };
  assert.equal(I.addEntry(st, { name: "  Customer\n number ", example: " 10482 ", goes_to: "" }), true);
  assert.deepEqual(st.information, [{ name: "Customer number", example: "10482" }]);
  assert.equal(I.addEntry(st, { name: "Order lines", goes_to: "SAP, Create sales order: Items" }), true);
  assert.deepEqual(st.information.map((e) => e.name), ["Customer number", "Order lines"]);
  assert.equal(I.addEntry(st, { name: "   ", example: "x" }), false, "no name, nothing kept");
  assert.equal(st.information.length, 2);
  assert.equal(I.addEntry(null, { name: "x" }), false);
  assert.equal(st.state, "manually_authored", "a step the analyst added stays added");
});

test("change: one field of one line; the same text is no change; an emptied name takes the line out", () => {
  const st = { state: "confirmed", information: [{ name: "Customer number" }, { name: "Order lines", example: "2" }] };
  assert.equal(I.setField(st, 0, "example", "10482"), "changed");
  assert.deepEqual(st.information[0], { name: "Customer number", example: "10482" });
  assert.equal(st.state, "edited");
  assert.equal(I.setField(st, 0, "example", " 10482 "), "", "the same text once cleaned");
  assert.equal(I.setField(st, 1, "example", ""), "changed");
  assert.deepEqual(st.information[1], { name: "Order lines" }, "an emptied example takes its key away");
  assert.equal(I.setField(st, 5, "name", "x"), "", "no such line");
  assert.equal(I.setField(st, 0, "colour", "x"), "", "no such field");
  assert.equal(I.setField(st, 0, "name", "  "), "removed");
  assert.deepEqual(st.information, [{ name: "Order lines" }]);
  assert.equal(I.setField(st, 0, "name", ""), "removed");
  assert.equal("information" in st, false, "the last line gone takes the key away");
});

test("remove: the line goes, the others keep their order; the last takes the key away", () => {
  const st = { information: [{ name: "A" }, { name: "B" }, { name: "C" }] };
  assert.equal(I.removeEntry(st, 1), true);
  assert.deepEqual(st.information.map((e) => e.name), ["A", "C"]);
  assert.equal(I.removeEntry(st, 9), false);
  assert.equal(I.removeEntry(st, 0), true);
  assert.equal(I.removeEntry(st, 0), true);
  assert.equal("information" in st, false);
});

test("limits: a name at most 80 characters, an example and where it goes at most 120", () => {
  const st = {};
  I.addEntry(st, { name: "n".repeat(200), example: "e".repeat(200), goes_to: "g".repeat(200) });
  assert.equal(st.information[0].name.length, I.NAME_MAX);
  assert.equal(I.NAME_MAX, 80);
  assert.equal(st.information[0].example.length, I.TEXT_MAX);
  assert.equal(st.information[0].goes_to.length, I.TEXT_MAX);
  assert.equal(I.TEXT_MAX, 120);
});

test("a draft that gets, changes or loses a line becomes edited; a hidden step stays hidden", () => {
  const a = { state: "auto_suggested" };
  I.addEntry(a, { name: "Customer number" });
  assert.equal(a.state, "edited");
  const b = { state: "auto_suggested", information: [{ name: "X" }] };
  I.removeEntry(b, 0);
  assert.equal(b.state, "edited");
  const c = { state: "auto_suggested", information: [{ name: "X" }] };
  I.setField(c, 0, "goes_to", "SAP");
  assert.equal(c.state, "edited");
  const h = { state: "hidden" };
  I.addEntry(h, { name: "X" });
  assert.equal(h.state, "hidden");
});

test("a sub-step carries it the same way, and anyEntries looks at every level but a hidden step", () => {
  const parent = { state: "edited", sub_steps: [{ state: "auto_suggested" }, { state: "edited" }] };
  assert.equal(I.anyEntries([parent]), false);
  I.addEntry(parent.sub_steps[0], { name: "Unit price", example: "12.50" });
  assert.equal(parent.sub_steps[0].state, "edited");
  assert.deepEqual(I.entriesOf(parent.sub_steps[0]), [{ name: "Unit price", example: "12.50" }]);
  assert.equal(I.anyEntries([parent]), true);
  parent.sub_steps[0].state = "hidden";
  assert.equal(I.anyEntries([parent]), false, "a hidden sub-step's lines are not printed");
  assert.equal(I.anyEntries([{ state: "hidden", information: [{ name: "X" }] }]), false);
});

test("an older or hand-edited key reads cleaned: entries without a name and junk are left out", () => {
  const st = { information: [{ name: "A" }, null, "text", { example: "no name" }, { name: " B ", goes_to: 7 }] };
  assert.deepEqual(I.entriesOf(st), [{ name: "A" }, { name: "B" }]);
  assert.deepEqual(I.entriesOf({ information: "x" }), []);
  assert.equal(I.hasEntries({}), false);
});

test("a merge joins the lines once each, a split keeps them on the first half", () => {
  const a = { information: [{ name: "A" }, { name: "B" }] };
  const b = { information: [{ name: "B" }, { name: "C", example: "1" }] };
  assert.deepEqual(I.joined([a, b]).map((e) => e.name), ["A", "B", "C"]);
  const merged = {};
  I.putJoined(merged, [a, b]);
  assert.equal(merged.information.length, 3);
  const none = { information: [{ name: "x" }] };
  I.putJoined(none, [{}, {}]);
  assert.equal("information" in none, false);
  const first = { information: [{ name: "A" }] }, second = { information: [{ name: "A" }] };
  I.splitInformation(first, second);
  assert.deepEqual(first.information, [{ name: "A" }]);
  assert.equal("information" in second, false);
});

test("the Steps verbs use them: both splits keep the lines on the first half, a merge joins every member's", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "views", "steps-view.js"), "utf-8");
  assert.equal(src.split("StepInfo.splitInformation(first, second);").length - 1, 2, "Split and + Step inside a step");
  assert.equal(src.split("StepInfo.putJoined(merged, toMerge);").length - 1, 1, "mergeStepObjects");
});

test("the recorded rows are read from the step's actions: a field once, its first value, where it went", () => {
  const datas = [
    { kind: "invoked", name: "New order", control_type: "Button" },
    { kind: "value_changed", name: "Customer number", value: "10482", process_name: "saplogon", window_title: "Create Sales Order" },
    { kind: "value_changed", name: "Customer number", value: "10483" },
    { kind: "value_changed", meaningful_name: "Password", name: "pw", value_redacted: true },
    { kind: "selection_changed", name: "Country", selected_value: "Croatia", control_type: "ComboBox" },
    { kind: "selection_changed", name: "Croatia", selected_value: "Croatia", control_type: "ListItem" },
    { kind: "selection_changed", name: "Tabs", selected_value: "Items", control_type: "TabItem" },
    { kind: "value_changed", name: "Empty", value: "￼ " },
    { kind: "value_changed", name: "Noise", value: "null" },
    { kind: "value_changed", automation_id: "txtQty", value: "3" },
    { kind: "value_changed", value: "7" },
  ];
  const rows = I.recordedRows(datas, (d) => (d.process_name ? "SAP, Create sales order" : "SAP"));
  assert.deepEqual(rows, [
    { name: "Customer number", example: "10482", goes_to: "SAP, Create sales order" },
    { name: "Password", example: "typed (hidden)", goes_to: "SAP" },
    { name: "Country", example: "Croatia", goes_to: "SAP" },
    { name: "txtQty", example: "3", goes_to: "SAP" },
    { name: "(unnamed field)", example: "7", goes_to: "SAP" },
  ]);
  assert.deepEqual(I.recordedRows(null), []);
  assert.deepEqual(I.recordedRows([{ kind: "value_changed", name: "A", value: "1" }]), [{ name: "A", example: "1", goes_to: "" }]);
});
