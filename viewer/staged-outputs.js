"use strict";

/*
 * staged-outputs.js: what an analysis that was stopped leaves in the project
 * folder, and its removal (lane FX1).
 *
 * normalize.py writes each of its outputs (annotations.json, stats.json,
 * analysis.json, process_map_step.bpmn) beside its name as
 * "<name>.pdt-staged" and moves them into place together as its very last act
 * (normalization/session_io.py Staging). Cancel kills the process
 * (python-runner.js), so a stopped run never moves anything: the project's
 * outputs stay as they were, and only its staged files are left. They are
 * not the project's, so main.js removes them once the process has ended;
 * the next analysis would remove them too (session_io.clear_staged).
 */

const fs = require("node:fs");
const path = require("node:path");

const STAGED_SUFFIX = ".pdt-staged";

/* Remove the staged outputs directly in `root`. Returns how many went; a file
   that cannot be removed is left and said in the console. */
function clearStaged(root) {
  let names;
  try {
    names = fs.readdirSync(root);
  } catch (e) {
    if (e.code !== "ENOENT") console.warn("[staged-outputs] the project folder could not be read: " + e.message);
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith(STAGED_SUFFIX)) continue;
    try {
      fs.unlinkSync(path.join(root, name));
      removed++;
    } catch (e) {
      console.warn("[staged-outputs] " + name + " could not be removed: " + e.message);
    }
  }
  return removed;
}

module.exports = { STAGED_SUFFIX, clearStaged };
