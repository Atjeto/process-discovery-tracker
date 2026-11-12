"use strict";

/*
 * step-band-width.js: how wide a step's band on the Timeline's Steps lane is
 * drawn (lane LANES; the owner's acceptance of the redesign: "data is not
 * overlapping"). Pure; step-band-width.test.js drives it, and
 * views/flow-view-timeline.js draws it, then asks step-band-label.js what
 * the band says at the width drawn.
 *
 * A band is as wide as its time, never narrower than MIN_PX (so a step of a
 * moment, or of a few pixels at this zoom, can still be seen and clicked),
 * and never past the start of the next band of the same transaction: its
 * drawn width is at most the gap to that start. A band whose next band is in
 * another transaction is not held back by it. A band that ends up too narrow
 * for a label shows none; its tooltip names it, the pane's list holds it,
 * and the zoom widens it.
 */

/* The least width a band is drawn at, px. */
const MIN_PX = 2;
/* Under this width a band is drawn without its padding (styles.css
   .tl-step-band.slim): the padding would make it wider than drawn. */
const SLIM_PX = 12;

/* `bands` = [{ id, key, startPx, endPx }]: each band's step id, its
   transaction (`key`: the step's case_id, null for a step outside every
   transaction), and where its time starts and ends, in px from the start of
   the lanes. Returns a Map from id to { leftPx, widthPx, slim }. */
function drawnBands(bands, minPx) {
  const min = Number.isFinite(minPx) && minPx > 0 ? minPx : MIN_PX;
  const list = (Array.isArray(bands) ? bands : [])
    .filter((b) => b && b.id != null && Number.isFinite(b.startPx) && Number.isFinite(b.endPx))
    .map((b, i) => ({ b, i }))
    .sort((x, y) => x.b.startPx - y.b.startPx || x.i - y.i);
  const out = new Map();
  list.forEach(({ b }, n) => {
    const key = b.key == null ? null : b.key;
    // The next band of the same transaction, in the order of the lane.
    let next = null;
    for (let k = n + 1; k < list.length; k++) {
      const c = list[k].b;
      if ((c.key == null ? null : c.key) === key) { next = c; break; }
    }
    const time = Math.max(0, b.endPx - b.startPx);
    const room = next ? Math.max(0, next.startPx - b.startPx) : Infinity;
    const widthPx = Math.max(min, Math.min(time, room));
    out.set(b.id, { leftPx: b.startPx, widthPx, slim: widthPx < SLIM_PX });
  });
  return out;
}

module.exports = { drawnBands, MIN_PX, SLIM_PX };
