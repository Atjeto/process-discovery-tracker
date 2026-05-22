"use strict";

/*
 * recognition.js -- platform/framework interaction recognition.
 *
 * Principle (ADR-0011): classify what an interaction IS by anchoring on
 * documented, stable, cross-app platform/framework signatures -- NOT on a
 * single engagement's opaque automation_ids (txtsr, view_1012, ...). Those
 * IDs are app-specific and meaningless to a business user; the platform
 * conventions below recur across thousands of apps and are documented.
 *
 * Two layers, most-specific first:
 *   1. Framework class_name signatures -- Chromium/Edge browser chrome,
 *      Bootstrap, AG-Grid, SharePoint (SPFx), Office 365/OneDrive, Win32/
 *      Office. (`class_name` carries the CSS class for Chromium web content
 *      and the Win32 class for native apps.)
 *   2. The UIA ControlType base layer -- Microsoft's documented control
 *      taxonomy (Edit, Button, ComboBox, TabItem, TreeItem, ...), always
 *      present, so even an unknown app degrades to a meaningful type.
 *
 * Grounding (see ADR-0011 for citations):
 *   - UIA ControlType identifiers -- learn.microsoft.com (uiauto-controltype-ids)
 *   - Chromium Views a11y: OmniboxViewViews == view_1012 / framework Chrome
 *     -- chromium.org views-accessibility (matches the real capture exactly)
 *   - Bootstrap (form-control, btn-primary), AG-Grid (ag- namespace),
 *     SharePoint SPFx (ReactFieldEditor), O365/OneDrive (o365sx-/od-),
 *     Win32/Office (RichEdit20WPT, NetUIHWND).
 *
 * Returns a semantic TYPE, not business meaning. "form field", "data-grid
 * cell", "primary button" are knowable from the platform; "serial number" is
 * not -- that stays an analyst label on top. Pure (no DOM): unit-testable and
 * shared by the viewer's phrasing + the alignment signature. The Python
 * capture pipeline should consume the same table (follow-up in ADR-0011).
 */

// Ordered most-specific first; first match wins. `cls` entries are matched as
// substrings of class_name unless `exactCls` is set. `ctIn` optionally
// constrains the UIA control_type.
const FRAMEWORK_SIGNATURES = [
  // --- Chromium / Edge browser chrome. isChrome=true => navigation, not a
  //     process step (the frame around the page, not the page). ---
  { cls: ["OmniboxViewViews"], category: "browser_chrome", framework: "chromium", isChrome: true, typeLabel: "browser address bar" },
  { cls: ["BackForwardButton", "ReloadButton", "HomeButton", "BookmarkButton", "StarView",
          "AppMenuButton", "BrowserAppMenuButton", "DownloadBubbleTransparentButton",
          "NewTabButton", "TabStripControlButton", "TabStrip"],
    category: "browser_chrome", framework: "chromium", isChrome: true, typeLabel: "browser toolbar" },
  { ctIn: ["TabItem", "Tab"], cls: ["Tab", "EdgeTab"], exactCls: true,
    category: "browser_chrome", framework: "chromium", isChrome: true, typeLabel: "browser tab" },

  // --- AG-Grid (data grid). `ag-` is AG-Grid's CSS namespace. ---
  { cls: ["ag-cell-edit-input"], category: "grid_cell", framework: "ag-grid", typeLabel: "data-grid cell" },
  { cls: ["ag-filter", "ag-select", "ag-list", "ag-picker"], category: "selection", framework: "ag-grid", typeLabel: "grid filter" },

  // --- Bootstrap (+ ASP.NET/jQuery validation). btn-primary before form-control. ---
  { cls: ["btn-primary"], category: "primary_action", framework: "bootstrap", typeLabel: "primary button" },
  { cls: ["form-control"], category: "form_field", framework: "bootstrap", typeLabel: "form field" },

  // --- SharePoint (SPFx React field editors). RichText variant => rich_text. ---
  { cls: ["ReactFieldEditor"], richTextIf: "RichText", category: "form_field", framework: "sharepoint", typeLabel: "SharePoint field" },

  // --- Office 365 / OneDrive. ---
  { cls: ["od-addNewCommentTextField", "mentionableTextBox"], category: "comment", framework: "office365", typeLabel: "comment field" },
  { cls: ["o365sx-", "mssxsb-"], category: "search", framework: "office365", typeLabel: "Office 365 search" },

  // --- Win32 / Office native. ---
  { cls: ["RichEdit"], category: "rich_text", framework: "win32-office", typeLabel: "rich-text field" },
  { cls: ["NetUIHWND"], category: "office_ui", framework: "win32-office", typeLabel: "Office ribbon/pane" },
];

// UIA ControlType -> semantic base. Microsoft's documented taxonomy; always
// available even when no framework signature matches.
const UIA_BASE = {
  Edit:        { category: "text_entry", typeLabel: "text field" },
  Document:    { category: "text_entry", typeLabel: "document" },
  Button:      { category: "action", typeLabel: "button" },
  SplitButton: { category: "action", typeLabel: "button" },
  Hyperlink:   { category: "action", typeLabel: "link" },
  MenuItem:    { category: "action", typeLabel: "menu item" },
  ComboBox:    { category: "selection", typeLabel: "dropdown" },
  List:        { category: "selection", typeLabel: "list" },
  ListItem:    { category: "selection", typeLabel: "list item" },
  DataItem:    { category: "grid_cell", typeLabel: "data item" },
  CheckBox:    { category: "toggle", typeLabel: "checkbox" },
  RadioButton: { category: "toggle", typeLabel: "radio button" },
  TabItem:     { category: "tab_nav", typeLabel: "tab" },
  TreeItem:    { category: "tree_nav", typeLabel: "tree item" },
  Tree:        { category: "tree_nav", typeLabel: "tree" },
  Slider:      { category: "form_field", typeLabel: "slider" },
  Spinner:     { category: "form_field", typeLabel: "spinner" },
};

/**
 * Recognise one interaction's data.
 * @param {Object} data  an interaction event's `data` (control_type,
 *   class_name, framework_id, ...)
 * @returns {{category:string, framework:string, isChrome:boolean, typeLabel:string}}
 */
function recognize(data) {
  data = data || {};
  const cls = data.class_name || "";
  const ct = data.control_type || "";

  for (const sig of FRAMEWORK_SIGNATURES) {
    if (sig.ctIn && !sig.ctIn.includes(ct)) continue;
    const hit = (sig.cls || []).some((c) => sig.exactCls ? cls === c : (c && cls.includes(c)));
    if (!hit) continue;
    if (sig.richTextIf && cls.includes(sig.richTextIf)) {
      return { category: "rich_text", framework: sig.framework, isChrome: false, typeLabel: "rich-text field" };
    }
    return { category: sig.category, framework: sig.framework, isChrome: !!sig.isChrome, typeLabel: sig.typeLabel };
  }

  const base = UIA_BASE[ct];
  if (base) return { category: base.category, framework: "generic", isChrome: false, typeLabel: base.typeLabel };
  return { category: "unknown", framework: "generic", isChrome: false, typeLabel: ct ? ct.toLowerCase() : "control" };
}

/** True for the browser's own UI (address bar, tabs, toolbar) -- navigation
 *  noise rather than a process step. */
function isBrowserChrome(data) {
  return recognize(data).isChrome;
}

module.exports = { recognize, isBrowserChrome, FRAMEWORK_SIGNATURES };
