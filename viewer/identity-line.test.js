"use strict";
/*
 * Unit tests for identity-line.js: the composed human identity line for a
 * captured control.
 * Fixtures are hand-built, never a real capture (CLAUDE.md: company captures
 * stay local).
 */

const test = require("node:test");
const assert = require("node:assert");

const { identityLine } = require("./identity-line.js");

/* R1 App Library pass: the ONE composed human identity line that replaces the
   four raw signature inputs on the default path. */
test("identityLine: name present → controlType · \"name\" · window, no marker", () => {
  const line = identityLine(
    { control_type: "Button", name: "Search", automation_id: "search-btn", window_title: "Salesforce - Account lookup" }
  );
  assert.equal(line.identity.kind, "name");
  assert.equal(line.identity.value, "Search");
  assert.equal(line.controlType, "Button");
  assert.equal(line.context, "Salesforce - Account lookup");
  assert.equal(line.marker, null); // a clean accessible name is not flagged
  assert.equal(line.text, 'Button · "Search" · Salesforce - Account lookup');
});

test("identityLine: automation_id fallback when no name; stable id → no marker", () => {
  const line = identityLine({ control_type: "Edit", automation_id: "customer_id", window_title: "New Account" });
  assert.equal(line.identity.kind, "automation_id");
  assert.equal(line.identity.value, "customer_id");
  assert.equal(line.marker, null); // "customer_id" is not a per-render counter
  assert.equal(line.text, 'Edit · "customer_id" · New Account');
});

test("identityLine: a volatile-looking automation_id (name absent) gets a volatile marker", () => {
  const line = identityLine({ control_type: "Edit", automation_id: "input-378" });
  assert.equal(line.identity.kind, "automation_id");
  assert.ok(line.marker && line.marker.kind === "volatile");
  assert.match(line.marker.note, /auto-generated|change/i);
});

test("identityLine: class-only weak case → class_name identity + weak marker", () => {
  const line = identityLine({ control_type: "Button", class_name: "x-btn" });
  assert.equal(line.identity.kind, "class_name");
  assert.equal(line.identity.value, "x-btn");
  assert.ok(line.marker && line.marker.kind === "weak");
  assert.equal(line.text, 'Button · "x-btn"'); // no window context → omitted
});

test("identityLine: empty signature → unidentified control, weak marker, safe text", () => {
  const line = identityLine({});
  assert.equal(line.identity.kind, "unknown");
  assert.equal(line.identity.value, "");
  assert.ok(line.marker && line.marker.kind === "weak");
  assert.equal(line.text, 'Control · (unidentified control)');
});

test("identityLine: an explicit scope string wins over the control's own window", () => {
  const line = identityLine(
    { control_type: "Button", name: "Save", window_title: "raw window" },
    "New order"
  );
  assert.equal(line.context, "New order");
  assert.equal(line.text, 'Button · "Save" · New order');
});
