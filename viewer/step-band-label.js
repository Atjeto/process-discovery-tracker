"use strict";

/*
 * step-band-label.js: what a step's band on the Timeline's Steps lane says
 * (lane LANES, plan section 11.3: "the names readable, a band narrower than
 * its name showing its number only"). Pure; step-band-label.test.js drives
 * it, and views/flow-view-timeline.js draws it.
 *
 * A band shows the step's name, on up to two lines inside the band and cut
 * with an ellipsis, when the band is wide enough to read a part of it worth
 * reading (NAME_MIN_PX inside its padding) or the whole name fits on one
 * line. A band too narrow for the name shows the step's number in its
 * transaction only, the number the pane's Steps tab shows for it; a band too
 * narrow for that shows nothing. Its tooltip always carries the name.
 *
 * The numbers are the pane's (pane-lists.js stepGroups: a step's place in
 * its group, from 1), never a rule of their own.
 */

/* The band's padding on each side and its border, px (styles.css
   .tl-step-band). */
const PAD_PX = 5;
const BORDER_PX = 1;
/* The least room inside a band for its name: about seven letters of 12 px
   text on each of its two lines. */
const NAME_MIN_PX = 44;
/* The room a digit of the number takes, px (12 px text, tabular figures). */
const DIGIT_PX = 7.5;

/* The numbers the pane's Steps tab shows: a Map from step_id to its place in
   its group, from 1. `groups` is pane-lists.js stepGroups's
   [{ steps: [...] }]; a step listed twice keeps its first number. */
function stepNumbers(groups) {
  const out = new Map();
  for (const g of Array.isArray(groups) ? groups : []) {
    const steps = g && Array.isArray(g.steps) ? g.steps : [];
    steps.forEach((s, i) => {
      if (s && s.step_id && !out.has(s.step_id)) out.set(s.step_id, i + 1);
    });
  }
  return out;
}

/* What a band `widthPx` wide shows: { kind: "name" | "number" | "none",
   text }. `name` is the step's name, `nameWidthPx` how wide it is on one
   line (measured, 12 px; NaN when it cannot be measured), `num` the step's
   number (null without one). */
function bandLabel(widthPx, name, nameWidthPx, num) {
  const w = Number(widthPx) || 0;
  const inner = w - 2 * (PAD_PX + BORDER_PX);
  const text = typeof name === "string" ? name.trim() : "";
  if (text && (inner >= NAME_MIN_PX || (Number.isFinite(nameWidthPx) && nameWidthPx <= inner))) {
    return { kind: "name", text };
  }
  const n = Number.isFinite(num) && num > 0 ? String(num) : "";
  // A number may use the padding: it is short and centred.
  if (n && n.length * DIGIT_PX <= w - 2 * BORDER_PX - 2) return { kind: "number", text: n };
  return { kind: "none", text: "" };
}

module.exports = { stepNumbers, bandLabel, PAD_PX, BORDER_PX, NAME_MIN_PX, DIGIT_PX };
