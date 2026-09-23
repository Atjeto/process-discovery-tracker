/*
 * Unit test for report-md.js -- the Markdown report's free-text escaping.
 * Confluence/most Markdown renderers pass raw HTML through, so untrusted cells
 * (session status, labels) must be HTML- and table-neutralized. The session
 * report was cut (BA-helper refocus); the aggregate report carries the same
 * escaping, so the invariant is pinned there.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAggregateReport } = require("./report-md.js");

function sessionWith(status) {
  return {
    sessionFolder: "C:/sessions/s1",
    manifest: { session_id: "s1", status,
                started_at: "2026-05-18T09:00:00Z" },
    events: [],
  };
}

test("free-text cells neutralize HTML and the table separator", () => {
  const md = buildAggregateReport([sessionWith("<script>alert(1)</script>|pipe")], [], [], null, []);
  assert.ok(!md.includes("<script>"), "raw <script> must not survive");
  assert.ok(md.includes("&lt;script&gt;"), "HTML angle brackets escaped");
  assert.ok(md.includes("\\|"), "the | table separator is backslash-escaped");
});

test("a benign status is left readable", () => {
  const md = buildAggregateReport([sessionWith("completed")], [], [], null, []);
  assert.ok(md.includes("completed"));
});
