"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { isProgramsOwnChange } = require("./user-acted.js");

test("an interaction the recorder marked as a program's own change is left out; the rest stays", () => {
  const marked = { type: "interaction", data: { kind: "value_changed", name: "Quantity", value: "1", user_acted: false } };
  assert.strictEqual(isProgramsOwnChange(marked), true);
  assert.strictEqual(isProgramsOwnChange({ type: "interaction", data: { kind: "value_changed", value: "2" } }), false);
  assert.strictEqual(isProgramsOwnChange({ type: "interaction", data: { kind: "invoked", user_acted: true } }), false);
  assert.strictEqual(isProgramsOwnChange({ type: "activity", data: { user_acted: false } }), false);
  assert.strictEqual(isProgramsOwnChange(null), false);
});
