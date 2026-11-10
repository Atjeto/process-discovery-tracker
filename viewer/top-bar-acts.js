"use strict";

/*
 * top-bar-acts.js: the top bar's next act and its Undo and Redo (lane W0,
 * plan 11.1 and 11.4 of END-GOAL-REVIEW-AND-PLAN-2026-11-10).
 *
 * Two things a process manager could not see from where they work: what the
 * project's next act is (the Checklist lives on the Overview) and that a
 * change can be undone (Ctrl+Z works everywhere, nothing said so).
 *   - The next act: a button on the Timeline, Steps and the Map, named by
 *     overview-view.js nextActText from the Checklist's own stages and
 *     counts; a click opens the Checklist. Not on the Overview (the
 *     Checklist is there), not in a read-only project, not before the first
 *     analysis (no Checklist is drawn), not once nothing is left.
 *   - Undo and Redo: what Ctrl+Z and Ctrl+Y call (session.js performUndo and
 *     performRedo), on every level; with nothing to undo or redo they stay,
 *     marked aria-disabled. Not in a read-only project, and not while the
 *     map editor is open, where the keys belong to the map (refmap-ui.js).
 * Pure: renderer.js gathers the inputs and draws the result.
 */

const NEXT_TITLE = "Opens the Checklist.";
const UNDO_LABEL = "Undo";
const REDO_LABEL = "Redo";
const UNDO_TITLE = "Undoes the last change. Key: Ctrl+Z";
const REDO_TITLE = "Does the undone change again. Key: Ctrl+Y";

/* What the top bar shows, from:
     session        a project is open
     readOnly       it opened read only (a hand-off, or open in another window)
     unreadable     its annotations.json cannot be read (the banner alone)
     level          "overview" | "flow" | "steps" | "map"
     checklist      the Overview draws the Checklist (the first analysis ran)
     mapEditorOpen  the map editor covers the app
     nextText       overview-view.js nextActText (null: nothing left)
     canUndo, canRedo  session.js canUndo() and canRedo()
   Returns { next: { shown, text }, undo: { shown, enabled }, redo: { shown,
   enabled } }. */
function topBarActs(o) {
  const i = o || {};
  const editable = !!i.session && !i.readOnly && !i.unreadable;
  const nextShown = editable && !!i.checklist && i.level !== "overview" && !i.mapEditorOpen &&
    typeof i.nextText === "string" && i.nextText !== "";
  const keysHere = editable && !i.mapEditorOpen;
  return {
    next: { shown: nextShown, text: nextShown ? i.nextText : "" },
    undo: { shown: keysHere, enabled: keysHere && !!i.canUndo },
    redo: { shown: keysHere, enabled: keysHere && !!i.canRedo },
  };
}

/* The next act's tooltip: the full text after it while the button cuts it. */
function nextTitle(text, cut) {
  return cut && text ? NEXT_TITLE + " " + text : NEXT_TITLE;
}

module.exports = { topBarActs, nextTitle, NEXT_TITLE, UNDO_LABEL, REDO_LABEL, UNDO_TITLE, REDO_TITLE };
