"use strict";
/*
 * RP-34: the Timeline's "Transaction:" dropdown escapes the case id, which
 * comes from annotations.json (session data, untrusted), in the option's
 * value attribute as well as in its text (case-scope.js, used by
 * flow-view.populateCaseScope). AD-29: an option names its transaction the
 * way the Steps level does ("Transaction 1 · Order #10900").
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
  const titled = caseScopeOptionsHtml([{ id: "c1", label: HOSTILE, startMs: 1000, title: "Transaction 1" }], "", 0);
  assert.ok(!titled.includes("<img") && titled.includes("Transaction 1 · c1&quot;&gt;&lt;img"), titled);
});

test("AD-29: an option with the Steps level's title reads Transaction N, then its marker label when it says more than a number", () => {
  const html = caseScopeOptionsHtml([
    { id: "c1", label: "Order #10900", startMs: 0, title: "Transaction 1" },
    { id: "c2", label: "Run 2", startMs: 60000, title: "Transaction 2" },
    { id: "c3", label: "c3", startMs: 120000, title: "Transaction 3" },
  ], "c2", 0);
  assert.equal(html, '<option value="">All transactions</option>' +
    '<option value="c1">Transaction 1 · Order #10900</option>' +
    '<option value="c2" selected>Transaction 2</option>' +
    '<option value="c3">Transaction 3</option>');
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

test("no transactions: one plain line under All transactions", () => {
  assert.equal(caseScopeOptionsHtml([], "", NaN),
    '<option value="">All transactions</option><option value="" disabled>(no transactions yet)</option>');
});

test("lane FX2: a project whose one transaction is implicit offers it in the Checklist's words, and nothing else", () => {
  const AC = require("./analyst-content.js");
  assert.equal(AC.IMPLICIT_TRANSACTION, "One transaction (not marked)");
  assert.equal(caseScopeOptionsHtml([], "", NaN, AC.IMPLICIT_TRANSACTION),
    '<option value="" selected>One transaction (not marked)</option>');
});
