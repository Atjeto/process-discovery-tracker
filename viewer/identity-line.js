"use strict";
/*
 * identity-line.js -- the one composed human identity line for a captured
 * control, plus the two small helpers it needs.
 *
 * Moved out of vocab-match.js (the App Library matcher) so the kept Steps
 * surface (step-editor.js) does not depend on the App Library. vocab-match.js
 * imports these from here instead of carrying its own copies.
 *
 * Pure module: no DOM, no IPC. Unit-tested in identity-line.test.js.
 */

/* Treat a non-object as an empty object, so callers can read fields off an
   absent signature or data blob without a guard at every site. */
function _asData(x) {
  return x && typeof x === "object" ? x : {};
}

/* THE one composed human identity line for a control, shown wherever a row
   used to render the four raw signature inputs. Design (R1 App Library pass):
   the four signature fields are the MACHINE's re-identification key (kept as
   data, edited only in the raw-rule expansion); the HUMAN sees one line and
   writes one name.

   Shape: `<ControlType> · "<best identity>" · <window/screen context>`
     - best identity = name || automation_id || class_name (in THAT order: the
       human-legible label first, because a person reads the accessible name
       best).
     - window/screen context = the explicit `scope` string when the caller has
       one (a named screen), else the signature/event's own window_title, else
       omitted.
     - volatility/weak flags render as a small trailing marker `{kind, note}`
       (NOT baked into the string) so the view can attach the existing tooltip;
       the plain `.text` is always the human sentence with no marker noise.

   `signature` is a signature-shaped object (control_type / automation_id / name
   / class_name / window_title / window_title_regex; a rule signature OR a raw
   captured-event data blob both work, since only those fields are read).
   `scope` (optional) is an explicit screen/window context string to append.

   Returns { text, controlType, identity:{kind,value}, context, marker|null }. */
function identityLine(signature, scope) {
  const sig = _asData(signature);
  const controlType = String(sig.control_type || "").trim();
  // Human-first identity ladder: name, then automation_id, then class_name.
  let identity;
  if (sig.name) identity = { kind: "name", value: String(sig.name) };
  else if (sig.automation_id) identity = { kind: "automation_id", value: String(sig.automation_id) };
  else if (sig.class_name) identity = { kind: "class_name", value: String(sig.class_name) };
  else identity = { kind: "unknown", value: "" };

  // Window/screen context: explicit scope wins, else the control's own window.
  let context = "";
  if (typeof scope === "string" && scope.trim()) context = scope.trim();
  else if (sig.window_title) context = String(sig.window_title);
  else if (sig.window_title_regex) context = String(sig.window_title_regex);

  // A volatile-looking automation_id we're keying on, or a class_name-only
  // weak identity, gets a small marker with a tooltip the view renders.
  let marker = null;
  if (identity.kind === "automation_id" && looksVolatileId(identity.value)) {
    marker = {
      kind: "volatile",
      note: "This id looks auto-generated (a per-render counter), so it may change between recordings.",
    };
  } else if (identity.kind === "class_name") {
    marker = {
      kind: "weak",
      note: "Weak identity: keyed on a generic class name, with no stable id or accessible label. It may not match reliably.",
    };
  } else if (identity.kind === "unknown") {
    marker = {
      kind: "weak",
      note: "No stable identity was captured for this control.",
    };
  }

  // Compose the sentence. An empty identity reads as "unidentified control".
  const parts = [];
  parts.push(controlType || "Control");
  parts.push(identity.value ? '"' + identity.value + '"' : "(unidentified control)");
  if (context) parts.push(context);
  return { text: parts.join(" · "), controlType, identity, context, marker };
}

/* An id ending in a render counter (trailing digits after a hyphen or
   underscore), a `prefix-NNN` pattern, or a long hex hash is suspect.
   Advisory only. */
function looksVolatileId(aid) {
  const s = String(aid || "");
  return /[-_]\d{2,}$/.test(s) || /^[a-z]+-\d+$/i.test(s) || /[0-9a-f]{8,}/i.test(s);
}

module.exports = { identityLine, looksVolatileId, _asData };
