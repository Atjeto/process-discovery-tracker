"use strict";
/* HIGH (review) — script-context JSON injection / RCE.
 *
 * buildOperatorHtml (operator-panel.js) interpolates operator-influenced
 * label strings into an inline <script> of a nodeIntegration:true window.
 * Bare JSON.stringify does NOT escape "</script>", so a label like
 * "</script><img onerror=...>" breaks out and executes. jsonForScript
 * neutralizes the markup-significant characters. This pins the helper AND
 * guards that the builder actually routes its script slots through it (a
 * context-blind future edit can't silently regress to JSON.stringify).
 * (The second builder, main.js's label picker, was removed with the
 * one-hotkey run flow.) */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { jsonForScript } = require("../json-for-script.js");

const ROOT = path.join(__dirname, "..");
const BS = String.fromCharCode(92);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

test("jsonForScript neutralizes a </script> breakout", () => {
  const out = jsonForScript(["</script><img src=x onerror=alert(1)>"]);
  assert.ok(!out.includes("<"), "no raw <");
  assert.ok(!out.includes(">"), "no raw >");
  assert.ok(!out.toLowerCase().includes("</script"), "no raw </script");
});

test("jsonForScript escapes < > & and the JS line terminators", () => {
  const out = jsonForScript(["a<b>c&d" + LS + "e" + PS + "f"]);
  assert.ok(!out.includes("<") && !out.includes(">") && !out.includes("&"));
  assert.ok(!out.includes(LS) && !out.includes(PS), "no raw line separators");
  assert.ok(out.includes(BS + "u2028") && out.includes(BS + "u2029"));
});

test("jsonForScript output still round-trips to the original data", () => {
  const data = ["Search", "</script>", "amp & <tag>", { nested: "</SCRIPT >" }];
  assert.deepStrictEqual(JSON.parse(jsonForScript(data)), data);
  // ...and is a valid JS expression embeddable in a <script>.
  // eslint-disable-next-line no-eval
  assert.deepStrictEqual(eval("(" + jsonForScript(data) + ")"), data);
});

test("undefined serializes to null, never a broken expression", () => {
  assert.strictEqual(jsonForScript(undefined), "null");
});

// Regression guard: the script-context builder must route its dynamic slots
// through jsonForScript, never bare JSON.stringify (which would re-open the
// breakout). We scan source rather than rendering (no electron in tests).
test("buildOperatorHtml uses jsonForScript for script slots", () => {
  for (const f of ["operator-panel.js"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf-8");
    assert.ok(
      src.includes("jsonForScript"),
      `${f} must use jsonForScript for its inline-<script> data slot`
    );
    assert.ok(
      !/JSON\.stringify\(\s*(?:\(config && config\.)?(?:config\.)?process_labels/.test(src),
      `${f} must not feed process_labels through bare JSON.stringify into a <script>`
    );
  }
});
