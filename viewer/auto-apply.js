/*
 * auto-apply.js: when a change to the transactions reaches the steps by
 * itself (plan D4, the owner 2026-11-10: "apply by itself", in a recording
 * too). A transaction added, moved, ended, renamed or deleted is a marker
 * change (marker-edits.js); a moment after it the analysis runs once
 * (flow-view.js scheduleAutoApply) and the steps and the map follow it.
 * Nothing asks first and nothing says so when it worked. A run the analyst
 * cancelled, or one that failed, leaves the changes waiting: the top bar then
 * offers Update the steps, and the next change runs it again too. Pure;
 * unit-tested.
 */

"use strict";

/* The top bar's button while changes wait after a cancelled or failed run. */
const UPDATE_LABEL = "Update the steps";
const UPDATE_TITLE = "Updates the transactions, their steps and the map with your latest changes.";

/* Whether the transactions of `sess` follow a change by themselves: every
   project open for editing whose annotations can be read (a hand-off or a
   project open in another window is read only; an unreadable
   annotations.json is the banner's, and the pipeline would refuse it). */
function appliesItself(sess, readOnly) {
  return !!sess && !readOnly && !sess.annotationsError;
}

/* Whether a change waits for the analysis: a marker edit newer than the last
   analysis (`pending`, MarkerEdits.pendingEditCount), or the markers changed
   under an analysis without a newer edit (`stale`: an undo or a redo of a
   change the last analysis had already used). */
function changesWait(st) {
  return !!st && ((Number(st.pending) || 0) > 0 || !!st.stale);
}

/* Whether the run is due: the project applies itself, a change waits, and
   the analyst did not cancel the last run (nor did it fail) since the last
   change. st = { applies, pending, stale, held }. */
function runDue(st) {
  return !!st && !!st.applies && !st.held && changesWait(st);
}

/* Whether the top bar shows Update the steps: no run under way, and the
   changes wait because the last run was cancelled or failed.
   st = { applies, pending, stale, held, running }. */
function updateShows(st) {
  return !!st && !!st.applies && !st.running && !!st.held && changesWait(st);
}

/* Whether the changes are held after a run ended with `r` ({ ok, cancelled }):
   a run the analyst cancelled, or one that failed, holds them (until Update
   the steps or the next change); a run stopped for a save (`yielded`) runs
   again after it and holds nothing; a run that worked applied them all. */
function holdAfter(r, yielded) {
  if (!r) return true;
  if (r.cancelled) return !yielded;
  return !r.ok;
}

module.exports = { UPDATE_LABEL, UPDATE_TITLE, appliesItself, changesWait, runDue, updateShows, holdAfter };
