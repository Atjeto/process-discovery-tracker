"use strict";
// Lane E1, Paste notes... (notes-paste.js): one test per reading rule, the
// line under the box, and the document after the paste. The real dialog,
// its twenty steps and its one Ctrl+Z are in e2e/start-smoke.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const NP = require("./notes-paste.js");
const { DOC_FIELDS } = require("./views/overview-view.js");

const parse = (text) => NP.parseNotes(text, DOC_FIELDS);
const names = (text) => parse(text).steps.map((s) => s.name);

test("an empty line is dropped, and so is a line of marks alone", () => {
  assert.deepEqual(names("Open SAP\n\n   \r\nFind the order\r\n-\n[ ]\n"), ["Open SAP", "Find the order"]);
});

test("a leading list mark is dropped: -, *, a bullet, 1. 1) a) (1), [ ] [x]", () => {
  const lines = ["- Dash", "* Star", "\u2022 Bullet", "\uf0b7 Word bullet", "1. Number dot", "12) Number paren", "a) Letter",
    "(1) Paren number", "[ ] Box", "[x] Ticked", "- [ ] Both", "1.5 kg is weighed"];
  assert.deepEqual(names(lines.join("\n")), ["Dash", "Star", "Bullet", "Word bullet", "Number dot", "Number paren", "Letter",
    "Paren number", "Box", "Ticked", "Both", "1.5 kg is weighed"]);
});

test("a leading Step 3: or Step 3. counter is dropped", () => {
  assert.deepEqual(parse("Step 3: Open SAP\nstep 4. Find the order: by its number\n2. Step 5: Save").steps, [
    { name: "Open SAP", description: "" }, { name: "Find the order", description: "by its number" },
    { name: "Save", description: "" }]);
  assert.deepEqual(names("Step 6:"), ["Step 6"], "a counter alone names the step");
});

test("a step's name is the text before the first colon followed by a space or the line's end; the rest its description", () => {
  assert.deepEqual(parse("Check the credit: in SAP: FD32\nApprove:\nhttps://intranet/x is opened").steps, [
    { name: "Check the credit", description: "in SAP: FD32" },
    { name: "Approve", description: "" },
    { name: "https://intranet/x is opened", description: "" }]);
});

test("a colon between two digits is not the name's colon", () => {
  assert.deepEqual(parse("Call the customer at 10:30\nAt 9:15: book the slot").steps, [
    { name: "Call the customer at 10:30", description: "" }, { name: "At 9:15", description: "book the slot" }]);
});

test("a line whose name part would be empty is a step named by the whole line", () => {
  assert.deepEqual(parse(": the customer calls").steps, [{ name: ": the customer calls", description: "" }]);
});

test("a line that starts with a document field's name and a colon goes to that field, case blind, with the short forms", () => {
  const r = parse("Trigger: an order email\nRESULT: the order is in SAP\nvolume: 40 a day\nRules: credit over 10k\n" +
    "Contacts: Ana\nImprovement: a bot\nKey contacts: Ben\nTriggered by mail\nNotes: ask about returns");
  assert.deepEqual(r.fields, [
    { key: "trigger", label: "Trigger", text: "an order email" },
    { key: "result", label: "Result", text: "the order is in SAP" },
    { key: "effort", label: "Volume and effort", text: "40 a day" },
    { key: "business_rules", label: "Business rules", text: "credit over 10k" },
    { key: "contacts", label: "Key contacts", text: "Ana\nBen" },
    { key: "improvement", label: "Improvement and automation scope", text: "a bot" },
    { key: "notes", label: "Notes", text: "ask about returns" }]);
  assert.deepEqual(r.steps.map((s) => s.name), ["Triggered by mail"], "a word that only begins with a field's name is a step");
  // Every short form names a field DOC_FIELDS has.
  for (const label of Object.values(NP.SHORT_FORMS)) assert.ok(DOC_FIELDS.some((f) => f.label === label), label);
});

test("a line indented deeper than the step or field above it joins that one's text on a new line", () => {
  const r = parse("Open the order: in VA02\n  - check the price\n\tand the date\nTrigger:\n    a mail from the customer\nSave the order\n  Save");
  assert.deepEqual(r.steps, [
    { name: "Open the order", description: "in VA02\ncheck the price\nand the date" },
    { name: "Save the order", description: "Save" }]);
  assert.deepEqual(r.fields, [{ key: "trigger", label: "Trigger", text: "a mail from the customer" }]);
  assert.deepEqual(names("  Indented first\nSecond"), ["Indented first", "Second"], "a first line indented is a step");
});

test("two lines for one field join on a new line; a field that holds text keeps it, the paste after it", () => {
  const r = parse("Trigger: a mail\nOpen SAP\nTrigger: or a call");
  assert.deepEqual(r.fields, [{ key: "trigger", label: "Trigger", text: "a mail\nor a call" }]);
  const doc = NP.mergeDocument({ trigger: "Written before ", result: "", future_key: 3 }, r.fields, DOC_FIELDS);
  assert.equal(doc.trigger, "Written before\na mail\nor a call");
  assert.equal(doc.result, "");
  assert.equal(doc.future_key, 3, "a key a later contract adds is kept");
  for (const f of DOC_FIELDS) assert.equal(typeof doc[f.key], "string");
  assert.equal(NP.mergeDocument(null, r.fields, DOC_FIELDS).trigger, "a mail\nor a call");
});

test("the line under the box says what the paste will make", () => {
  assert.equal(NP.summary(parse("")), "Nothing to add yet");
  assert.equal(NP.summary(parse("Open SAP")), "1 step");
  assert.equal(NP.summary(parse(Array.from({ length: 12 }, (_, i) => "Step " + (i + 1) + ": do " + i).join("\n"))), "12 steps");
  assert.equal(NP.summary(parse("Trigger: x")), "1 document field: Trigger");
  assert.equal(NP.summary(parse("a\nb\nTrigger: x\nResult: y\nVolume: z\nExceptions: w")),
    "2 steps and 4 document fields: Trigger, Result, Volume and effort, Exceptions");
});

test("twenty lines typed in Notepad are twenty steps", () => {
  const text = Array.from({ length: 20 }, (_, i) => (i % 2 ? "- " : (i + 1) + ". ") + "Do part " + (i + 1) + (i % 3 ? ": detail " + i : "")).join("\r\n");
  const r = parse(text);
  assert.equal(r.steps.length, 20);
  assert.equal(r.steps[0].name, "Do part 1");
  assert.equal(r.steps[1].description, "detail 1");
});
