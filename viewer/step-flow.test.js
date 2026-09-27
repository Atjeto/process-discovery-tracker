"use strict";

/*
 * Unit tests for step-flow.js: the step flow set on steps (contract C17),
 * the pure half. Run with `npm test` (node:test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("./step-flow.js");

const mk = (id, name, extra) => Object.assign({ step_id: id, name, state: "manually_authored" }, extra || {});
const LIST = [
  mk("s1", "Receive the order email"),
  mk("s2", "Check the customer"),
  mk("s3", "Enter the sales order in SAP"),
  mk("s4", "Send the confirmation"),
  mk("s5", "File the order"),
];

test("the Flow line's default, and a step with a condition or a link is not default", () => {
  assert.equal(F.DEFAULT_LINE, "Then: the next step");
  assert.ok(F.isDefault(mk("a", "A")));
  assert.ok(F.isDefault(mk("a", "A", { only_when: "   ", links: [] })), "blank text and an empty list are nothing set");
  assert.ok(!F.isDefault(mk("a", "A", { only_when: "a new customer" })));
  assert.ok(!F.isDefault(mk("a", "A", { links: [{ to: "end", when: "" }] })));
});

test("a link can go to every other step of the transaction, in order and numbered, never to its own step", () => {
  const choices = F.linkChoices(LIST, LIST[3]);
  assert.deepEqual(choices.map((c) => c.label), [
    "1. Receive the order email", "2. Check the customer", "3. Enter the sales order in SAP", "5. File the order"]);
  assert.deepEqual(choices.map((c) => c.value), ["s1", "s2", "s3", "s5"]);
  assert.deepEqual(F.linkChoices([], LIST[0]), []);
});

test("a link row reads where it goes, relative to its step", () => {
  const s4 = LIST[3];
  assert.equal(F.linkReading(LIST, s4, { to: "s3", when: "the check fails" }),
    "Goes back to step 3, Enter the sales order in SAP, when the check fails");
  assert.equal(F.linkReading(LIST, LIST[0], { to: "s2", when: "a new customer" }),
    "Goes on to step 2, Check the customer, when a new customer");
  assert.equal(F.linkReading(LIST, LIST[0], { to: "s4", when: "a known customer" }),
    "Skips to step 4, Send the confirmation, when a known customer");
  assert.equal(F.linkReading(LIST, LIST[2], { to: "end", when: "the order is rejected" }), "Ends here when the order is rejected");
  assert.equal(F.linkReading(LIST, LIST[2], { to: "end", when: "" }), "Ends here", "no when: the sentence stops");
  assert.equal(F.linkReading(LIST, s4, { to: "gone", when: "x" }), "Goes to a step no longer in this transaction, when x");
  // The step itself hidden (not in the list): the verb cannot say back or on.
  assert.equal(F.linkReading(LIST, mk("h", "Hidden"), { to: "s2", when: "" }), "Goes to step 2, Check the customer");
});

test("a condition set on the same step in another transaction reads as set there", () => {
  assert.equal(F.inheritedLine([{ text: "a new customer", where: "Transaction 1" }]),
    "Only when a new customer (set in Transaction 1) · then the next step");
  assert.equal(F.inheritedLine([{ text: "x", where: "Transaction 1" }, { text: "y", where: "Transaction 3" }]),
    "Only when x or y (set in other transactions) · then the next step");
  assert.equal(F.inheritedLine([]), "");
  assert.equal(F.inheritedLine([{ text: "  ", where: "Transaction 1" }]), "", "a blank condition is none");
});

test("the step panel's one line: the condition and each link, short", () => {
  const s4 = mk("s4", "Send the confirmation", { only_when: "the order is complete",
    links: [{ to: "s2", when: "the check fails" }, { to: "end", when: "the customer cancels" }] });
  const list = LIST.slice(0, 3).concat([s4, LIST[4]]);
  assert.equal(F.panelLine(list, s4),
    "Only when the order is complete · Goes back to step 2 when the check fails · Ends here when the customer cancels");
  assert.equal(F.panelLine(LIST, LIST[0]), "", "nothing set: no line");
  // The box's conditions, whichever of its steps set them, each once.
  assert.equal(F.panelLine(LIST, LIST[1], ["", "a new customer", " a new  customer", "x"]), "Only when a new customer or x");
});

test("the edits write only_when and links, and an empty condition or the last link removed leaves no key", () => {
  const s = mk("s2", "Check the customer");
  assert.ok(F.setOnlyWhen(s, "  a new \t customer "));
  assert.equal(s.only_when, "a new customer", "one line, as the map and the PDD read it");
  assert.ok(!F.setOnlyWhen(s, "a new customer"), "the same text is no change");
  assert.ok(F.setOnlyWhen(s, ""));
  assert.ok(!("only_when" in s));

  assert.ok(!F.addLink(s, "s2", "x"), "a link never points at its own step");
  assert.ok(!F.addLink(s, "", "x"));
  assert.ok(F.addLink(s, "s1", ""));
  assert.ok(F.addLink(s, F.END, " rejected "));
  assert.deepEqual(s.links, [{ to: "s1", when: "" }, { to: "end", when: "rejected" }]);
  assert.ok(F.setLinkWhen(s, 0, "missing data"));
  assert.ok(!F.setLinkWhen(s, 0, "missing data "), "the same text is no change");
  assert.ok(F.setLinkTarget(s, 0, "s4"));
  assert.ok(!F.setLinkTarget(s, 0, "s2"), "not to its own step");
  assert.deepEqual(s.links, [{ to: "s4", when: "missing data" }, { to: "end", when: "rejected" }]);
  assert.ok(F.removeLink(s, 0));
  assert.ok(F.removeLink(s, 0));
  assert.ok(!F.removeLink(s, 0));
  assert.ok(!("links" in s), "no links: no key");
});

test("hiding or removing a target drops the links to it, and says which", () => {
  const steps = [
    mk("a", "A", { links: [{ to: "b", when: "x" }, { to: "end", when: "y" }] }),
    mk("b", "B"),
    mk("c", "C", { links: [{ to: "b", when: "z" }] }),
    mk("d", "D", { links: [{ to: "a", when: "w" }] }),
  ];
  const dropped = F.dropLinksTo(steps, new Set(["b"]));
  assert.deepEqual(dropped.map((d) => d.step.step_id + ">" + d.link.to + ":" + d.link.when), ["a>b:x", "c>b:z"]);
  assert.deepEqual(steps[0].links, [{ to: "end", when: "y" }]);
  assert.ok(!("links" in steps[2]), "its only link gone: no key");
  assert.deepEqual(steps[3].links, [{ to: "a", when: "w" }], "a link to another step stays");
  assert.deepEqual(F.dropLinksTo(steps, ["zzz"]), [], "nothing to drop");
});

test("a merge points the links to its steps at the merged step, and drops a link that would point at itself", () => {
  // b and c are merged into b: d's link to c goes to b, and b's own link to c
  // (now itself) is dropped; two links repeated by the merge are kept once.
  const merged = mk("b", "B + C", { links: F.mergedLinks([
    mk("b", "B", { links: [{ to: "c", when: "retry" }] }),
    mk("c", "C", { links: [{ to: "end", when: "rejected" }] }),
  ]) });
  const steps = [
    mk("a", "A", { links: [{ to: "c", when: "x" }, { to: "b", when: "x" }] }),
    merged,
    mk("d", "D", { links: [{ to: "c", when: "again" }] }),
  ];
  const dropped = F.retargetLinks(steps, new Map([["b", "b"], ["c", "b"]]));
  assert.equal(dropped, 1);
  assert.deepEqual(merged.links, [{ to: "end", when: "rejected" }]);
  assert.deepEqual(steps[0].links, [{ to: "b", when: "x" }]);
  assert.deepEqual(steps[2].links, [{ to: "b", when: "again" }]);
});

test("a split keeps the condition on the first half and moves the links to the second", () => {
  const whole = mk("s", "S", { only_when: "a new customer", links: [{ to: "end", when: "rejected" }] });
  const first = Object.assign({}, whole);
  const second = Object.assign({}, whole, { step_id: "s-2" });
  F.splitFlow(first, second);
  assert.deepEqual([first.only_when, first.links], ["a new customer", undefined]);
  assert.deepEqual([second.only_when, second.links], [undefined, [{ to: "end", when: "rejected" }]]);
});

test("2.0.1: the Flow line names the next step, and the end after the last", () => {
  assert.equal(F.nextLine(LIST, LIST[1]), "Then: Enter the sales order in SAP");
  assert.equal(F.nextLine(LIST, LIST[4]), "Then: the end");
  assert.equal(F.nextLine([], LIST[0]), F.DEFAULT_LINE);
});

test("2.0.1: a Decision's targets say where they lie, and a step another transaction did is offered and read by its name", () => {
  const choices = F.linkChoices(LIST, LIST[2], [{ value: "x1", name: "Order from the supplier" }, { value: "s1", name: "dup" }]);
  assert.deepEqual(choices.map((c) => [c.value, c.kind]),
    [["s1", "back"], ["s2", "back"], ["s4", "ahead"], ["s5", "ahead"], ["x1", "other"]]);
  const others = new Map([["x1", "Order from the supplier"]]);
  assert.deepEqual(F.linkPlace(LIST, LIST[2], { to: "x1" }, others), { kind: "other", name: "Order from the supplier" });
  assert.equal(F.linkReading(LIST, LIST[2], { to: "x1", when: "the stock is short" }, others),
    "Goes to Order from the supplier, when the stock is short");
  assert.equal(F.linkShort(LIST, LIST[2], { to: "x1", when: "the stock is short" }, others),
    "Goes to Order from the supplier when the stock is short");
  assert.equal(F.linkPlace(LIST, LIST[2], { to: "x1" }).kind, "missing", "without the process's other steps it is missing, as before");
});
