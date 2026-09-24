"use strict";
/*
 * identity-line.js -- the one composed human identity line for a captured
 * control, plus the small helper it needs.
 *
 * Its own module so the Steps surface (step-editor.js) can render the
 * identity line without any App Library code.
 *
 * Pure module: no DOM, no IPC. Unit-tested in identity-line.test.js.
 */

/* Treat a non-object as an empty object, so callers can read fields off an
   absent signature or data blob without a guard at every site. */
function _asData(x) {
  return x && typeof x === "object" ? x : {};
}

/* THE one composed human identity line for a control, shown under each
   interaction in the step pane's More: which control an action was on.

   Shape: `<ControlType> · "<best identity>" · <window/screen context>`
     - best identity = name || automation_id || class_name (in THAT order: the
       human-legible label first, because a person reads the accessible name
       best).
     - window/screen context = the explicit `scope` string when the caller has
       one (a named screen), else the signature/event's own window_title, else
       omitted.
   A project is recorded once, so the line carries no judgment of whether the
   control would be found again in another recording (the marker that said so
   went with the App Library).

   `signature` is a signature-shaped object (control_type / automation_id / name
   / class_name / window_title / window_title_regex; a raw captured-event data
   blob works, since only those fields are read).
   `scope` (optional) is an explicit screen/window context string to append.

   Returns { text, controlType, identity:{kind,value}, context }. */
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

  // Compose the sentence. An empty identity reads as "unidentified control".
  const parts = [];
  parts.push(controlType || "Control");
  parts.push(identity.value ? '"' + identity.value + '"' : "(unidentified control)");
  if (context) parts.push(context);
  return { text: parts.join(" · "), controlType, identity, context };
}

module.exports = { identityLine };
