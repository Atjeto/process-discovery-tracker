"use strict";

/*
 * Unit tests for recognition.js. The cases use the REAL class_name /
 * control_type signatures captured in the ATM session, so the table is
 * verified against actual platform/framework data, not invented examples.
 * Run with `npm test` (node:test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { recognize, isBrowserChrome } = require("./recognition.js");

function d(o) { return o; }

/* ---- Browser chrome (Chromium / Edge) ------------------------------ */

test("Chrome omnibox is browser chrome (navigation, not a step)", () => {
  const r = recognize(d({ control_type: "Edit", class_name: "OmniboxViewViews", framework_id: "Chrome", automation_id: "view_1012" }));
  assert.equal(r.category, "browser_chrome");
  assert.equal(r.isChrome, true);
  assert.ok(isBrowserChrome(d({ class_name: "OmniboxViewViews" })));
});

test("browser tab strip switches are chrome", () => {
  assert.equal(recognize(d({ control_type: "TabItem", class_name: "Tab" })).isChrome, true);
  assert.equal(recognize(d({ control_type: "TabItem", class_name: "EdgeTab" })).isChrome, true);
});

test("browser toolbar buttons are chrome", () => {
  for (const c of ["BackForwardButton", "BookmarkButton", "DownloadBubbleTransparentButton", "BrowserAppMenuButton"]) {
    assert.equal(recognize(d({ control_type: "Button", class_name: c })).isChrome, true, c);
  }
});

/* ---- Web frameworks ------------------------------------------------ */

test("AG-Grid editable cell", () => {
  const r = recognize(d({ control_type: "Edit", class_name: "ag-cell-edit-input" }));
  assert.equal(r.category, "grid_cell");
  assert.equal(r.framework, "ag-grid");
  assert.equal(r.isChrome, false);
});

test("Bootstrap form field and primary button", () => {
  assert.equal(recognize(d({ control_type: "Edit", class_name: "form-control" })).category, "form_field");
  assert.equal(recognize(d({ control_type: "Edit", class_name: "input-validation-error form-control" })).category, "form_field");
  const btn = recognize(d({ control_type: "Button", class_name: "btn btn-primary" }));
  assert.equal(btn.category, "primary_action");
  assert.equal(btn.framework, "bootstrap");
});

test("SharePoint React field editor: plain vs rich text", () => {
  const plain = recognize(d({ control_type: "Edit", class_name: "ReactFieldEditor-core--display ReactFieldEditor-TextMultiLine ReactFieldEditor-linkFocusIndicator" }));
  assert.equal(plain.category, "form_field");
  assert.equal(plain.framework, "sharepoint");
  const rich = recognize(d({ control_type: "Edit", class_name: "ReactFieldEditor-core--display ReactFieldEditor-TextMultiLine ReactFieldEditor-RichText ReactFieldEditor-linkFocusIndicator" }));
  assert.equal(rich.category, "rich_text");
});

test("Office 365 comment and suite search", () => {
  assert.equal(recognize(d({ control_type: "Edit", class_name: "od-addNewCommentTextField-mentionableTextBox" })).category, "comment");
  assert.equal(recognize(d({ control_type: "ComboBox", class_name: "VHvmmNt2vVrKJb47LhAFLw== RYkU34alOZUcY7/0Kql/VA== o365sx-searchBoxActive" })).category, "search");
});

test("Win32 / Office native rich text and ribbon", () => {
  assert.equal(recognize(d({ control_type: "Edit", class_name: "RichEdit20WPT", framework_id: "Win32" })).category, "rich_text");
  assert.equal(recognize(d({ control_type: "Pane", class_name: "NetUIHWND" })).category, "office_ui");
});

/* ---- UIA base layer (no framework signature) ----------------------- */

test("falls back to the UIA control-type taxonomy", () => {
  assert.equal(recognize(d({ control_type: "Edit" })).category, "text_entry");
  assert.equal(recognize(d({ control_type: "Button" })).category, "action");
  assert.equal(recognize(d({ control_type: "ComboBox" })).category, "selection");
  assert.equal(recognize(d({ control_type: "CheckBox" })).category, "toggle");
  assert.equal(recognize(d({ control_type: "TreeItem" })).category, "tree_nav");
  // an in-app TabItem with no browser-tab class is tab navigation, not chrome
  const tab = recognize(d({ control_type: "TabItem", class_name: "some-app-tab" }));
  assert.equal(tab.category, "tab_nav");
  assert.equal(tab.isChrome, false);
});

test("unknown control type degrades gracefully", () => {
  const r = recognize(d({ control_type: "" }));
  assert.equal(r.category, "unknown");
  assert.equal(r.framework, "generic");
});
