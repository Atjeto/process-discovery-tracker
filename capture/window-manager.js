"use strict";

/*
 * Shared singleton-window helper.
 *
 * Every tray window used the same copy-pasted bookkeeping: keep a module
 * ref, reuse it while alive, null it on "closed". This collapses that
 * into one place, keyed by a string.
 *
 *   show(key, factory)   reuse the live window (show + focus) or build one
 *   toggle(key, factory) close the live window, or build one if none
 *   isOpen(key)          true while a live window exists for the key
 *   get(key)             the live window, or null
 *
 * `factory` is called only when a new window is needed; it must return a
 * BrowserWindow. The manager registers the "closed" listener itself.
 */
function createWindowManager() {
  const live = new Map();

  function get(key) {
    const win = live.get(key);
    return win && !win.isDestroyed() ? win : null;
  }

  function show(key, factory) {
    const existing = get(key);
    if (existing) {
      existing.show();
      existing.focus();
      return existing;
    }
    const win = factory();
    live.set(key, win);
    win.on("closed", () => {
      if (live.get(key) === win) live.delete(key);
    });
    return win;
  }

  function toggle(key, factory) {
    const existing = get(key);
    if (existing) {
      existing.close();
      return null;
    }
    return show(key, factory);
  }

  function isOpen(key) {
    return get(key) !== null;
  }

  return { show, toggle, isOpen, get };
}

module.exports = { createWindowManager };
