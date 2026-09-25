"use strict";
/* bpmn-text-wrap.js (lane FX3, validation pass 3, F26): the maps' names
   break between words, never inside one that fits a line. */

const test = require("node:test");
const assert = require("node:assert/strict");
const { TextWrapModule, wrapLines, innerWidth } = require("./bpmn-text-wrap.js");

/* A measure where every character is 6 px wide. */
const six = (text) => String(text).length * 6;

test("a name is wrapped between words, and no word that fits a line is cut", () => {
  // The drafted name the validation pass saw cut as "Tracking.x" / "lsx: Save workbook".
  const lines = wrapLines("Excel - Order Tracking.xlsx: Save workbook", 86, six);
  assert.deepEqual(lines, ["Excel - Order", "Tracking.xlsx:", "Save workbook"]);
  for (const line of lines) assert.ok(six(line) <= 86, line);
  assert.equal(lines.join(" "), "Excel - Order Tracking.xlsx: Save workbook", "every word, whole, in order");
  // A hyphen between words is a word: it ends a line, it never splits one.
  assert.deepEqual(wrapLines("Outlook - Order confirmation: Send", 86, six), ["Outlook -", "Order", "confirmation:", "Send"]);
});

test("a word wider than the box keeps a line of its own; the name's own line breaks stay", () => {
  assert.deepEqual(wrapLines("Open Averyveryveryverylongword now", 60, six), ["Open", "Averyveryveryverylongword", "now"]);
  assert.deepEqual(wrapLines("Colour by system\nSAP: orange", 500, six), ["Colour by system", "SAP: orange"]);
  assert.deepEqual(wrapLines("", 86, six), [""]);
  assert.deepEqual(wrapLines("a  b", 500, six), ["a b"], "spaces between words read as one");
});

test("the width a name is laid out in is its box less the padding, as diagram-js reads them", () => {
  assert.equal(innerWidth({ box: { width: 100, height: 80 }, padding: 7 }), 86);
  assert.equal(innerWidth({ box: { width: 140 }, padding: { left: 5, right: 7, top: 0, bottom: 0 } }), 128);
  assert.equal(innerWidth({ box: { width: 90 } }), 90);
  assert.equal(innerWidth({}), 150, "diagram-js's default label size");
});

test("the module wraps the names the text renderer draws, and nothing else changes", () => {
  const drawn = [];
  const renderer = {
    getDefaultStyle: () => ({ fontFamily: "Arial, sans-serif", fontSize: 12, fontWeight: "normal" }),
    createText: (text, options) => { drawn.push({ text, options }); return "svg"; },
  };
  const Ctor = TextWrapModule.pdtTextWrap[1];
  assert.deepEqual(TextWrapModule.__init__, ["pdtTextWrap"]);
  assert.deepEqual(Ctor.$inject, ["textRenderer"]);
  new Ctor(renderer);
  const opts = { box: { width: 100, height: 80 }, padding: 7, align: "center-middle" };
  assert.equal(renderer.createText("Excel - Order Tracking.xlsx: Save workbook", opts), "svg");
  assert.equal(drawn.length, 1);
  assert.ok(drawn[0].text.includes("\n"), "wrapped into lines: " + JSON.stringify(drawn[0].text));
  assert.equal(drawn[0].text.split("\n").join(" "), "Excel - Order Tracking.xlsx: Save workbook");
  assert.equal(drawn[0].options, opts, "the options pass through");
  renderer.createText("", opts);
  assert.equal(drawn[1].text, "", "an empty name stays empty");
});
