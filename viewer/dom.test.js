/*
 * Unit tests for dom.js fitMenuPosition: where a context menu opened at a
 * click point goes so all of it stays inside the window (L5b). The DOM half
 * (placeMenu) is pinned by the e2e session smoke, which right-clicks the
 * Flow timeline at the window's bottom edge in the real viewer.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fitMenuPosition, toast } = require("./dom.js");

const VW = 1366, VH = 768, M = 4;
const W = 200, H = 105;   // the Flow timeline menu: 3 items

test("a menu that fits opens at the click point", () => {
  assert.deepEqual(fitMenuPosition(300, 200, W, H, VW, VH, M), { left: 300, top: 200 });
});

test("near the bottom edge the menu opens upwards from the click point", () => {
  assert.deepEqual(fitMenuPosition(300, 740, W, H, VW, VH, M), { left: 300, top: 740 - H });
});

test("near the right edge the menu opens leftwards from the click point", () => {
  assert.deepEqual(fitMenuPosition(1300, 200, W, H, VW, VH, M), { left: 1300 - W, top: 200 });
});

test("in the bottom right corner it opens up and to the left", () => {
  assert.deepEqual(fitMenuPosition(1360, 760, W, H, VW, VH, M), { left: 1360 - W, top: 760 - H });
});

test("at the very edge the opened-upwards menu still keeps the margin", () => {
  // Upwards from y = 767 the menu would end 1 px above the window edge,
  // inside the 4 px margin: it moves up to end at the margin.
  assert.deepEqual(fitMenuPosition(300, 767, W, H, VW, VH, M), { left: 300, top: VH - H - M });
});

test("when neither side of the point has room, it sits as close to the point as fits", () => {
  // A 700 px tall menu at y = 100 fits neither below (100 + 700 > 768) nor
  // above (100 - 700 < 0): it ends at the bottom margin, all of it shown.
  assert.deepEqual(fitMenuPosition(300, 100, W, 700, VW, VH, M), { left: 300, top: VH - 700 - M });
});

test("a menu taller than the window starts at the top margin", () => {
  assert.equal(fitMenuPosition(300, 400, W, 900, VW, VH, M).top, M);
});

test("from any click point inside the window every edge of the menu is inside it", () => {
  let n = 0;
  for (const [vw, vh] of [[1366, 768], [1024, 768], [1500, 950]]) {
    for (let x = 0; x <= vw; x += 37) {
      for (let y = 0; y <= vh; y += 23) {
        for (const [w, h] of [[200, 105], [240, 105], [240, 300]]) {
          const p = fitMenuPosition(x, y, w, h, vw, vh, M);
          const where = JSON.stringify({ vw, vh, x, y, w, h, p });
          assert.ok(p.left >= M && p.left + w <= vw - M, "horizontally inside " + where);
          assert.ok(p.top >= M && p.top + h <= vh - M, "vertically inside " + where);
          n++;
        }
      }
    }
  }
  assert.ok(n > 5000, "the sweep covered " + n + " placements");
});

test("the margin defaults to 4 px", () => {
  assert.deepEqual(fitMenuPosition(1366, 768, W, H, VW, VH), fitMenuPosition(1366, 768, W, H, VW, VH, 4));
});

/* ---- the toast: a held error is not covered by the act's success message ---- */

test("a held error toast stays until it ends: a success or info message does not replace it, another error does", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const el = { textContent: "", className: "", classList: { remove() { el.className = ""; } }, appendChild() {} };
  // An error carries a Dismiss button (lane A-1): the stub makes one.
  global.document = { querySelector: (sel) => (sel === "#toast" ? el : null),
    createElement: () => ({ dataset: {}, addEventListener() {}, setAttribute() {} }) };
  try {
    toast("Saved, but a file was not moved.", "error", { hold: true });
    toast("Video removed.", "success");
    toast("Undone: Remove the video", undefined);
    assert.equal(el.textContent, "Saved, but a file was not moved.");
    assert.equal(el.className, "toast show error");
    t.mock.timers.tick(7999);
    toast("Still held.", "info");
    assert.equal(el.textContent, "Saved, but a file was not moved.");
    t.mock.timers.tick(1);
    toast("Video removed.", "success");
    assert.equal(el.textContent, "Video removed.");
    toast("Kept for a while.", "error", { hold: true });
    toast("A second failure.", "error");
    assert.equal(el.textContent, "A second failure.", "another error replaces a held one");
    toast("Done.", "success");
    assert.equal(el.textContent, "Done.", "a plain error holds nothing");
  } finally {
    delete global.document;
  }
});

/* ---- lane A-1: an error stays until it is dismissed or replaced ---- */

const { toastLifetime, toastClosesOnInteraction, hideToast } = require("./dom.js");

test("how long a message shows: an error stays, an ordinary one 3.5 s, one with an action or a hold 8 s", () => {
  assert.equal(toastLifetime("error"), null);
  assert.equal(toastLifetime("error", { hold: true }), null);
  assert.equal(toastLifetime("error", { action: { label: "Undo" } }), null);
  assert.equal(toastLifetime(undefined), 3500);
  assert.equal(toastLifetime("success"), 3500);
  assert.equal(toastLifetime("info", { action: { label: "Undo" } }), 8000);
  assert.equal(toastLifetime("success", { hold: true }), 8000);
});

test("a click or a key press outside an error closes it only once it has been up 3.5 s", () => {
  assert.equal(toastClosesOnInteraction(1000, 1000), false);
  assert.equal(toastClosesOnInteraction(1000, 4499), false);
  assert.equal(toastClosesOnInteraction(1000, 4500), true);
  assert.equal(toastClosesOnInteraction(1000, 60000), true);
});

test("an error message is still shown long after an ordinary one would have gone; Dismiss and a newer message end it", (t) => {
  const el = { textContent: "", className: "", classList: { remove() { el.className = el.className.replace(/\s*show\b/, ""); } },
    appendChild() {} };
  global.document = { querySelector: (sel) => (sel === "#toast" ? el : null),
    createElement: () => ({ dataset: {}, addEventListener() {}, setAttribute() {} }) };
  // The previous test's timer belongs to its own mock clock: clearing it under
  // this test's mock would clear this test's first timer (same id).
  hideToast();
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    toast("Saved.", "success");
    t.mock.timers.tick(3500);
    assert.ok(!/\bshow\b/.test(el.className), "an ordinary message goes after 3.5 s");
    toast("The marker was not moved: a step would lose its last action.", "error");
    t.mock.timers.tick(60000);
    assert.equal(el.className, "toast show error", "the error is still shown a minute later");
    hideToast();
    assert.ok(!/\bshow\b/.test(el.className), "Dismiss takes it away");
    toast("Another refusal.", "error");
    toast("Done.", "success");
    assert.equal(el.textContent, "Done.", "a newer message replaces an error");
  } finally {
    delete global.document;
  }
});
