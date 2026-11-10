/*
 * show-here.js: which step the Timeline's "<step>" starts here acts on
 * (lane E, item E5), the pure side; show-here.test.js drives it.
 *
 * Steps written first (from notes, by hand) have no time. Each gets its
 * moment in the video in two acts: go to the moment, click "<step>" starts
 * here. The step it acts on is the selected step when its time is the
 * analyst's to set (no recorded action gives it one: it has none yet, or
 * one the analyst gave), else the first step without a time in the process
 * order. A recorded step is never its step. After the act the next step
 * without a time is selected, so twenty steps are twenty times "go to the
 * moment, click".
 */

"use strict";

const AC = require("./analyst-content.js");
const StepOrder = require("./step-order.js");

/* Whether the act can give `step` a moment: a visible step with no
   recorded action and no sub-steps, without a time, or with a time of the
   analyst's. */
function canShow(step) {
  return AC.stepTimePlaceable(step) || AC.stepTimeMovable(step);
}

/* The step the act gives the playhead's moment, or null (the button is
   hidden): `selected` (the selected step, or null) when it is one of
   `ordered` and canShow, else the first of `ordered` without a time.
   `ordered`: the main level's visible steps in their process order, the
   transactions in their order, then the steps outside them. */
function targetOf(selected, ordered) {
  const list = Array.isArray(ordered) ? ordered : [];
  if (selected && list.includes(selected) && canShow(selected)) return selected;
  return list.find((s) => AC.stepTimePlaceable(s)) || null;
}

/* The step selected after the act on `done`: the next step without a time
   after it in `ordered`, else the first one before it, else null. */
function nextAfter(done, ordered) {
  const list = Array.isArray(ordered) ? ordered : [];
  const i = list.indexOf(done);
  const after = list.slice(i + 1).find((s) => AC.stepTimePlaceable(s));
  return after || list.slice(0, Math.max(0, i)).find((s) => AC.stepTimePlaceable(s)) || null;
}

/* C22: the step keeps its place in the process when it gets its moment.
   `before`: its place's steps in their process order before the time
   changed (step-order.js processOrder); `after`: the place's steps now. The
   fewest placements that give the order before (deriveOrder, the step
   moved being the one placed when one must be); `canBeFree` as deriveOrder.
   Returns the steps whose placed_after changed. */
function keepPlace(before, after, step, canBeFree) {
  const now = Array.isArray(after) ? after : [];
  const order = (Array.isArray(before) ? before : []).filter((s) => now.includes(s));
  return StepOrder.deriveOrder(now, order, { moved: step, canBeFree });
}

/* A step's name as the button says it, the button's name, its tooltip
   (`clicked`: the right-click menu's entry, which acts at the moment
   clicked), and the message after the act. */
function nameOf(step) {
  return String((step && step.name) || "").trim() || "this step";
}
function labelOf(step) {
  return "\"" + nameOf(step) + "\" starts here";
}
function titleOf(step, clicked) {
  return "Sets the start of \"" + nameOf(step) + "\" to " +
    (clicked ? "the moment you clicked" : "the moment the video shows now") + ". Its place among the steps stays.";
}
function doneText(step, clock) {
  return "\"" + nameOf(step) + "\" starts at " + clock + ".";
}

module.exports = { canShow, targetOf, nextAfter, keepPlace, nameOf, labelOf, titleOf, doneText };
