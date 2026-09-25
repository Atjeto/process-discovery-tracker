"use strict";

/*
 * window-registry.js: the projects open in the viewer's windows (lane MW),
 * in the main process.
 *
 * The viewer is one process with several windows (main.js): Open, Open in a
 * new window... opens another project beside the one on screen, and a second
 * start of the viewer opens a new window in the running one. Each window
 * shows one project at most. A project is open for editing in one window
 * only: another window that opens it gets it read only, the way a hand-off
 * opens (read-only.js), its project line "Open in another window: read only
 * here". A window that closes, or opens another project, lets its project
 * go. Nothing is written anywhere: the list lives in the main process and
 * ends with it.
 *
 *   open(id, folder, readOnly)  the window `id` (its webContents id) shows
 *                               `folder`; `readOnly` true when it opens read
 *                               only anyway (a hand-off). Returns { readOnly,
 *                               elsewhere }: elsewhere is true when another
 *                               window has the project open for editing, and
 *                               then readOnly is true too.
 *   close(id)                   the window is gone.
 *   readOnlyHere(id, folder)    whether the window `id` shows `folder` read
 *                               only because another window edits it (main
 *                               refuses that window's writes into it).
 *   editorOf(folder)            the window that has `folder` open for
 *                               editing, or null.
 *   size()                      how many windows show a project.
 *
 * Pure: no electron, so the unit tests pin the rule.
 */

const path = require("node:path");

/* One key per folder: resolved, without a trailing slash, in lower case
   (Windows folder names ignore case; the viewer runs on Windows only). */
function folderKey(folder) {
  return path.resolve(String(folder || "")).replace(/[\\/]+$/, "").toLowerCase();
}

function createRegistry() {
  const byWindow = new Map();   // id -> { folder, key, readOnly, elsewhere }

  function editorOf(folder, exceptId) {
    const key = folderKey(folder);
    for (const [id, e] of byWindow) {
      if (id !== exceptId && e.key === key && !e.readOnly) return id;
    }
    return null;
  }

  return {
    open(id, folder, readOnly) {
      const elsewhere = !readOnly && editorOf(folder, id) !== null;
      const entry = { folder: String(folder), key: folderKey(folder), readOnly: !!readOnly || elsewhere, elsewhere };
      byWindow.set(id, entry);
      return { readOnly: entry.readOnly, elsewhere };
    },
    close(id) {
      byWindow.delete(id);
    },
    readOnlyHere(id, folder) {
      const e = byWindow.get(id);
      return !!(e && e.elsewhere && e.key === folderKey(folder));
    },
    editorOf(folder) {
      return editorOf(folder, undefined);
    },
    size() {
      return byWindow.size;
    },
  };
}

module.exports = { createRegistry, folderKey };
