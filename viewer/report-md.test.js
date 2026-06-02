/*
 * Unit test for report-md.js -- the Markdown report's free-text escaping.
 * Confluence/most Markdown renderers pass raw HTML through, so untrusted cells
 * (engagement id, notes, labels) must be HTML- and table-neutralized.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSessionReport } = require("./report-md.js");

function sessionWith(engagement) {
  return {
    manifest: { engagement_id: engagement, session_id: "s1",
                started_at: "2026-05-18T09:00:00Z" },
    stats: { meta: {} },
    events: [],
    annotations: {},
  };
}

test("free-text cells neutralize HTML and the table separator", () => {
  const md = buildSessionReport(sessionWith("<script>alert(1)</script>|pipe"));
  assert.ok(!md.includes("<script>"), "raw <script> must not survive");
  assert.ok(md.includes("&lt;script&gt;"), "HTML angle brackets escaped");
  assert.ok(md.includes("\\|"), "the | table separator is backslash-escaped");
});

test("a benign engagement id is left readable", () => {
  const md = buildSessionReport(sessionWith("ENG-7"));
  assert.ok(md.includes("ENG-7"));
});
