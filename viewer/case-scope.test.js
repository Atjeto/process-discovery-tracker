"use strict";
/*
 * RP-34: the Flow "Run:" dropdown escapes the case id, which comes from
 * annotations.json (session data, untrusted), in the option's value
 * attribute as well as in its text (case-scope.js, used by
 * flow-view.populateCaseScope).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { caseScopeOptionsHtml } = require("./case-scope.js");

const HOSTILE = 'c1"><img src=x onerror="alert(1)">';

test("a crafted case id cannot break out of the option's value attribute", () => {
  const html = caseScopeOptionsHtml([{ id: HOSTILE, label: HOSTILE, startMs: 1000 }], "", 0);
  assert.ok(!html.includes("<img"), "no markup from the id reaches the page: " + html);
  assert.ok(html.includes('value="c1&quot;&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"'), html);
  // Exactly the two options, both closed normally.
  assert.equal((html.match(/<option /g) || []).length, 2);
});

test("the selected case and the duplicate-label suffix still work", () => {
  const html = caseScopeOptionsHtml([
    { id: "a", label: "Send email", startMs: 61000 },
    { id: "b", label: "Send email", startMs: 125000 },
    { id: "c", label: "c", startMs: 0 },
  ], "b", 1000);
  assert.ok(html.includes('<option value="b" selected>Send email [2:04]</option>'), html);
  assert.ok(html.includes('<option value="a">Send email [1:00]</option>'), html);
  assert.ok(html.includes('<option value="c">c</option>'), html);
});

test("no runs: one plain line under All runs", () => {
  assert.equal(caseScopeOptionsHtml([], "", NaN),
    '<option value="">All runs</option><option value="" disabled>(no runs yet)</option>');
});
