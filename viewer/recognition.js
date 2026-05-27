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
 * shared by the viewer's phrasing + the alignment signature.
 *
 * The signature TABLE itself lives in shared/recognition-patterns.json so the
 * Python pipeline (normalization/recognition.py) recognises interactions from
 * the SAME data (ADR-0011 follow-up). This file owns only the matching LOGIC.
 * The JSON ships to resources/shared/ as an extraResource; in dev it is
 * ../shared/ -- `__dirname/../shared` resolves to both (see build-package.js).
 */

const path = require("node:path");
const PATTERNS = require(path.join(__dirname, "..", "shared", "recognition-patterns.json"));

// Ordered most-specific first; first match wins. `cls` entries are matched as
// substrings of class_name unless `exactCls` is set. `ctIn` optionally
// constrains the UIA control_type.
const FRAMEWORK_SIGNATURES = PATTERNS.frameworkSignatures;
// UIA ControlType -> semantic base. Microsoft's documented taxonomy; always
// available even when no framework signature matches.
const UIA_BASE = PATTERNS.uiaBase;

/**
 * Recognise one interaction's data.
 * @param {Object} data  an interaction event's `data` (control_type,
 *   class_name, framework_id, ...)
 * @returns {{category:string, framework:string, isChrome:boolean, typeLabel:string}}
 */
function recognize(data) {
  data = data || {};
  // Coerce: a corrupt/hand-edited session can carry a non-string class_name /
  // control_type, and the substring / toLowerCase matching below would throw on
  // a number. Mirror recognition.py.
  const cls = String(data.class_name || "");
  const ct = String(data.control_type || "");

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
