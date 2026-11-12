"use strict";
/* Lane A-2: a refused entry's reason is kept by its key until the field is
   edited again (field-refusal.js). The page side (the line under the field,
   aria-invalid, aria-describedby) is pinned by timeline-edit-smoke. */
const test = require("node:test");
const assert = require("node:assert");
const FR = require("./field-refusal.js");

test("a reason is kept by its key, renewed on a field drawn again, and forgotten when the field is edited or saved", () => {
  FR.forgetAll();
  FR.show(null, "The start of this step can be from 0:00 to 0:22.", "step:s1:start");
  assert.strictEqual(FR.heldFor("step:s1:start"), "The start of this step can be from 0:00 to 0:22.");
  assert.strictEqual(FR.heldFor("step:s1:end"), null, "one field's reason is not another's");
  const drawn = { dataset: {} };
  FR.renew(drawn, "step:s1:start");
  assert.strictEqual(drawn.dataset.refusalKey, "step:s1:start", "the field drawn again carries its key");
  FR.clear(drawn, "step:s1:start");
  assert.strictEqual(FR.heldFor("step:s1:start"), null);
});

test("nothing is kept without a text, and forgetAll forgets every reason (another project)", () => {
  FR.forgetAll();
  assert.strictEqual(FR.show(null, "", "k"), null);
  assert.strictEqual(FR.heldFor("k"), null);
  FR.show(null, "Why", "a");
  FR.show(null, "Why not", "b");
  FR.forgetAll();
  assert.strictEqual(FR.heldFor("a"), null);
  assert.strictEqual(FR.heldFor("b"), null);
});
