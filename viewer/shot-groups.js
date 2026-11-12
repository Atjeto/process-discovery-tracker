"use strict";

/*
 * shot-groups.js: screenshots close together on the Timeline's Screenshots
 * lane are drawn as one mark with their count (lane W2, plan section 11.3:
 * "Where screenshots are too close to tell apart, they are drawn as one mark
 * with their count"). Pure; shot-groups.test.js drives it,
 * views/flow-view-timeline.js draws the marks.
 *
 * A mark starts where its first screenshot is (a mark of one is centred on
 * its moment, MARK_PX wide; a mark of several is as wide as its count needs,
 * markWidth). A screenshot joins the mark before it while it would be drawn
 * on that mark (closer to the mark's first screenshot than the mark is
 * wide), so no mark covers another: a chain of screenshots each close to
 * the next is cut into marks a mark's width apart, never drawn as one long
 * mark far from its later screenshots. The places are px at the current
 * zoom, so zooming in splits a mark as the room allows.
 */

/* The width of a screenshot's mark, px (styles.css .tl-screenshot). */
const MARK_PX = 16;

/* How wide the mark of `count` screenshots is drawn: MARK_PX, and wider for
   a count of two digits or more (its count is 12 px text). */
function markWidth(count) {
  const digits = String(Math.max(1, Math.floor(Number(count) || 1))).length;
  return MARK_PX + 6 * (digits - 1);
}

/* `xs` = the screenshots' places in px, in time order; `widthOf` a mark's
   width in px for its count (a number: every mark that wide; default
   markWidth). Returns the marks as [{ from, to }]: the first and the last
   index of the screenshots each holds, in order, every index in one mark. */
function groupShots(xs, widthOf) {
  const w = typeof widthOf === "function" ? widthOf
    : Number.isFinite(widthOf) && widthOf > 0 ? () => widthOf : markWidth;
  const out = [];
  (Array.isArray(xs) ? xs : []).forEach((x, i) => {
    const last = out[out.length - 1];
    if (last && Number.isFinite(x) && x - last.x < w(last.to - last.from + 1)) { last.to = i; return; }
    out.push({ from: i, to: i, x: Number.isFinite(x) ? x : -Infinity });
  });
  return out.map((g) => ({ from: g.from, to: g.to }));
}

/* A mark of several screenshots, under the pointer: "3 screenshots from
   1:40 to 1:46. Click: show the first in the Screenshots tab." */
function groupTitle(count, fromAt, toAt) {
  return count + " screenshots from " + fromAt + " to " + toAt + ". Click: show the first in the Screenshots tab.";
}

module.exports = { MARK_PX, markWidth, groupShots, groupTitle };
