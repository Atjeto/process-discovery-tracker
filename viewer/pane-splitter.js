/*
 * pane-splitter.js: the divider between the Steps level's two panes, the
 * transactions and the selected step (#steps-splitter, role="separator").
 *
 * A drag moves the boundary (the pointer capture and the document's listeners
 * keep a fast drag on it); while it has the focus, Left and Right move it by
 * a small step and Home and End take it to the two ends; a double-click or
 * Enter gives the usual widths back. Its position is the transactions' share
 * of the split's width, set as --split-share on .editor-split, where the
 * stylesheet's clamp keeps each pane at its minimum at any window width
 * (--split-min-list, --split-min-detail): a narrower window or the step
 * panel opening squeezes the panes, never below their minimums. At 1100px
 * wide or less the panes stack: the divider hides and the share does not
 * apply (styles.css).
 *
 * The share is remembered on this computer (localStorage pdt.stepsSplit). It
 * is a convenience only: with the storage blocked the divider still works,
 * for as long as the viewer stays open.
 *
 * The pure parts (the clamp, a stored value, the separator's values, the
 * keys) are exported for the unit tests; wire() is called once by
 * views/steps-view.js.
 */

"use strict";

const STORAGE_KEY = "pdt.stepsSplit";
const KEY_STEP_PX = 20;

/* The transactions' width in pixels, held between their minimum and the width
   that leaves the selected step its minimum: the stylesheet's clamp in
   numbers. When both cannot hold, the transactions keep theirs, as in CSS. */
function clampList(px, total, lim) {
  return Math.max(lim.minList, Math.min(px, total - lim.handle - lim.minDetail));
}

/* A stored share: a number strictly between 0 and 1. Anything else (nothing
   stored, or a value this version cannot read) is null: the usual widths. */
function parseShare(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

/* The separator's values, in percent of the split's width: where the
   transactions end now, and the two ends at this width. */
function ariaValues(listPx, total, lim) {
  const pct = (px) => Math.round((px / total) * 100);
  return { now: pct(listPx), min: pct(lim.minList), max: pct(total - lim.handle - lim.minDetail) };
}

/* Where a key takes the transactions' edge, before the clamp; null for a key
   the divider leaves to the page (Enter, the reset, is handled apart). */
function keyTarget(key, listPx) {
  switch (key) {
    case "ArrowLeft": return listPx - KEY_STEP_PX;
    case "ArrowRight": return listPx + KEY_STEP_PX;
    case "Home": return -Infinity;
    case "End": return Infinity;
    default: return null;
  }
}

/* The storage is a convenience: blocked or full, the divider still works. */
function _stored() {
  try { return parseShare(localStorage.getItem(STORAGE_KEY)); } catch (_) { return null; }
}
function _remember(share) {
  try { localStorage.setItem(STORAGE_KEY, share.toFixed(4)); } catch (_) { /* kept until the viewer closes */ }
}
function _forget() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* nothing was kept */ }
}

/* The limits the stylesheet sets on the split, in pixels. */
function _limits(split) {
  const cs = getComputedStyle(split);
  const px = (name) => parseFloat(cs.getPropertyValue(name)) || 0;
  return { minList: px("--split-min-list"), minDetail: px("--split-min-detail"), handle: px("--split-handle") };
}

/* Wire the divider: its split is its parent, the transactions' pane is the
   pane before it. */
function wire(handle) {
  const split = handle.parentElement;
  const list = handle.previousElementSibling;
  const total = () => split.clientWidth;
  const listWidth = () => list.getBoundingClientRect().width;
  // Hidden with its level, or where the panes stack.
  const shown = () => total() > 0 && handle.offsetWidth > 0;

  // The values assistive technology reads, taken from the layout.
  function sync() {
    if (!shown()) return;
    const v = ariaValues(listWidth(), total(), _limits(split));
    handle.setAttribute("aria-valuenow", String(v.now));
    handle.setAttribute("aria-valuemin", String(v.min));
    handle.setAttribute("aria-valuemax", String(v.max));
  }
  function apply(share) {
    if (share == null) split.style.removeProperty("--split-share");
    else split.style.setProperty("--split-share", String(share));
    sync();
  }
  // The share that puts the transactions' edge at px, within the limits.
  const shareAt = (px) => clampList(px, total(), _limits(split)) / total();
  function reset() { _forget(); apply(null); }

  apply(_stored());

  // A drag: the pointer capture keeps one that leaves the window, and the
  // document's listeners carry it whether or not the capture holds.
  let drag = null;
  function finish() {
    const share = drag && drag.share;
    drag = null;
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", end);
    document.removeEventListener("pointercancel", end);
    handle.classList.remove("dragging");
    document.body.style.userSelect = "";
    if (share != null) _remember(share);
  }
  function end(e) {
    if (drag && e.pointerId === drag.id) finish();
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    // The button came up where the page could not see it: the drag is over.
    if ((e.buttons & 1) === 0) { finish(); return; }
    if (drag.share == null && e.clientX === drag.x) return;
    drag.share = shareAt(drag.from + e.clientX - drag.x);
    apply(drag.share);
  }
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !shown()) return;
    if (drag) finish();   // an earlier drag whose end the page never saw
    e.preventDefault();   // no text selection, and the mouse leaves the focus where it was
    drag = { id: e.pointerId, x: e.clientX, from: listWidth(), share: null };
    try { handle.setPointerCapture(e.pointerId); } catch (_) { /* the document's listeners carry the drag */ }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    handle.classList.add("dragging");
    document.body.style.userSelect = "none";
  });
  handle.addEventListener("dblclick", () => reset());
  // The divider's own keys; the Steps level's shortcuts (Enter renames the
  // selected step) do not see them.
  handle.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !shown()) return;
    if (e.key === "Enter") {
      reset();
    } else {
      const px = keyTarget(e.key, listWidth());
      if (px == null) return;
      const share = shareAt(px);
      apply(share);
      _remember(share);
    }
    e.preventDefault();
    e.stopPropagation();
  });
  // A window resize, the step panel opening or closing, the level shown.
  new ResizeObserver(() => sync()).observe(split);
}

module.exports = { wire, clampList, parseShare, ariaValues, keyTarget, STORAGE_KEY, KEY_STEP_PX };
