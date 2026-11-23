"use strict";

/* step-exceptions.js (contract C27): the exceptions of a step, the rules the
   step editor's Exceptions section saves and reads by; the pipeline's
   step_context.py reads the same key the same way
   (test_step_exceptions.py). */

const test = require("node:test");
const assert = require("node:assert/strict");
const X = require("./step-exceptions.js");

test("the editor's words are C27's", () => {
  assert.equal(X.WORDS.heading, "Exceptions");
  assert.deepEqual([X.WORDS.when, X.WORDS.then], ["When", "What is done"]);
  assert.equal(X.WORDS.add, "Add exception");
  assert.equal(X.WORDS.addTitle, "Adds what happens when something goes wrong at this step, and what is done.");
  assert.equal(X.WORDS.remove, "Remove");
  assert.equal(X.WORDS.removeTitle, "Removes this exception.");
  assert.equal(X.WORDS.emptyWhen, "The exception was removed: it had nothing under When.");
});

test("add: an entry with a when is kept at the end, cleaned to one line; one without a when is not", () => {
  const st = { state: "manually_authored" };
  assert.equal(X.addEntry(st, { when: "  The customer number\n is not found ", then: " Search by name " }), true);
  assert.deepEqual(st.exceptions, [{ when: "The customer number is not found", then: "Search by name" }]);
  assert.equal(X.addEntry(st, { when: "The credit check fails", then: "" }), true);
  assert.deepEqual(st.exceptions[1], { when: "The credit check fails" }, "an empty then is left out");
  assert.equal(X.addEntry(st, { when: "   ", then: "Call the customer" }), false, "no when, nothing kept");
  assert.equal(X.addEntry(st, { then: "Call the customer" }), false);
  assert.equal(st.exceptions.length, 2);
  assert.equal(X.addEntry(null, { when: "x" }), false);
  assert.equal(st.state, "manually_authored", "a step the analyst added stays added");
});

test("clean: an entry without a when is not kept, and anything but a mapping is left out", () => {
  assert.equal(X.cleanEntry({ when: "", then: "x" }), null);
  assert.equal(X.cleanEntry({ when: " \n\t ", then: "x" }), null);
  assert.equal(X.cleanEntry(null), null);
  assert.equal(X.cleanEntry("The stock is empty"), null);
  assert.deepEqual(X.entriesOf({ exceptions: [{ when: "A" }, { when: "" }, "B", null, { when: "C", then: "D" }] }),
    [{ when: "A" }, { when: "C", then: "D" }]);
  assert.deepEqual(X.entriesOf({ exceptions: "x" }), []);
  assert.deepEqual(X.entriesOf(null), []);
});

test("change: one field of one entry; the same text is no change; an emptied when takes the entry out", () => {
  const st = { state: "confirmed", exceptions: [{ when: "The stock is empty" }, { when: "The price is missing", then: "Ask" }] };
  assert.equal(X.setField(st, 0, "then", "Order from the supplier"), "changed");
  assert.deepEqual(st.exceptions[0], { when: "The stock is empty", then: "Order from the supplier" });
  assert.equal(st.state, "edited");
  assert.equal(X.setField(st, 0, "then", " Order from the supplier "), "", "the same text once cleaned");
  assert.equal(X.setField(st, 1, "then", ""), "changed");
  assert.deepEqual(st.exceptions[1], { when: "The price is missing" }, "an emptied then takes its key away");
  assert.equal(X.setField(st, 5, "when", "x"), "", "no such entry");
  assert.equal(X.setField(st, 0, "colour", "x"), "", "no such field");
  assert.equal(X.setField(st, 0, "when", "  "), "removed");
  assert.deepEqual(st.exceptions, [{ when: "The price is missing" }]);
  assert.equal(X.setField(st, 0, "when", ""), "removed");
  assert.equal("exceptions" in st, false, "the last entry gone takes the key away");
});

test("remove: the entry goes, the others keep their order; the last takes the key away", () => {
  const st = { exceptions: [{ when: "A" }, { when: "B" }, { when: "C" }] };
  assert.equal(X.removeEntry(st, 1), true);
  assert.deepEqual(st.exceptions.map((e) => e.when), ["A", "C"]);
  assert.equal(X.removeEntry(st, 9), false);
  assert.equal(X.removeEntry(st, 0), true);
  assert.equal(X.removeEntry(st, 0), true);
  assert.equal("exceptions" in st, false);
});

test("limits: a when at most 120 characters, a then at most 200", () => {
  const st = {};
  X.addEntry(st, { when: "w".repeat(300), then: "t".repeat(300) });
  assert.equal(X.WHEN_MAX, 120);
  assert.equal(X.THEN_MAX, 200);
  assert.equal(st.exceptions[0].when.length, 120);
  assert.equal(st.exceptions[0].then.length, 200);
});

test("a draft that gets, changes or loses an entry becomes edited; a hidden step stays hidden", () => {
  const a = { state: "auto_suggested" };
  X.addEntry(a, { when: "The stock is empty" });
  assert.equal(a.state, "edited");
  const b = { state: "auto_suggested", exceptions: [{ when: "X" }] };
  X.removeEntry(b, 0);
  assert.equal(b.state, "edited");
  const c = { state: "auto_suggested", exceptions: [{ when: "X" }] };
  X.setField(c, 0, "then", "Y");
  assert.equal(c.state, "edited");
  const h = { state: "hidden" };
  X.addEntry(h, { when: "X" });
  assert.equal(h.state, "hidden");
});

test("split: the entries stay with the first half; the second has none", () => {
  const first = { exceptions: [{ when: "The stock is empty" }] };
  const second = { exceptions: [{ when: "The stock is empty" }] };
  X.splitExceptions(first, second);
  assert.deepEqual(first.exceptions, [{ when: "The stock is empty" }]);
  assert.equal("exceptions" in second, false);
  const bare = { exceptions: [{ when: "" }] };
  X.splitExceptions(bare, {});
  assert.equal("exceptions" in bare, false, "a list of nothing kept is taken away");
});

test("merge: every step's entries once each, the first step's first", () => {
  const target = {};
  X.putJoined(target, [{ exceptions: [{ when: "A" }, { when: "B", then: "b" }] }, { exceptions: [{ when: "B", then: "b" }, { when: "C" }] }]);
  assert.deepEqual(target.exceptions, [{ when: "A" }, { when: "B", then: "b" }, { when: "C" }]);
  const none = { exceptions: [{ when: "old" }] };
  X.putJoined(none, [{}, {}]);
  assert.equal("exceptions" in none, false);
});

test("a sub-step carries it the same way, and anyEntries looks at every level but a hidden step", () => {
  const parent = { state: "edited", sub_steps: [{ state: "auto_suggested" }, { state: "edited" }] };
  assert.equal(X.anyEntries([parent]), false);
  X.addEntry(parent.sub_steps[0], { when: "The unit price is missing" });
  assert.equal(parent.sub_steps[0].state, "edited");
  assert.equal(X.anyEntries([parent]), true);
  assert.equal(X.anyEntries([{ state: "hidden", exceptions: [{ when: "X" }] }]), false);
  assert.equal(X.anyEntries([{ state: "edited", exceptions: [{ when: " " }] }]), false);
  assert.equal(X.anyEntries(null), false);
});
