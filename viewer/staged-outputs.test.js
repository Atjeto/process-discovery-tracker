/*
 * Unit tests for staged-outputs.js: after Cancel kills an analysis, its
 * staged outputs go and the project's own files stay (lane FX1).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { STAGED_SUFFIX, clearStaged } = require("./staged-outputs.js");

test("clearStaged removes the staged outputs and nothing else", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-staged-"));
  try {
    const keep = ["annotations.json", "stats.json", "analysis.json", "process_map_step.bpmn",
      "annotations.json.2", "notes.pdt-staged.txt"];
    for (const name of keep) fs.writeFileSync(path.join(root, name), "old " + name);
    for (const name of ["annotations.json", "stats.json", "analysis.json"]) {
      fs.writeFileSync(path.join(root, name + STAGED_SUFFIX), "new " + name);
    }
    fs.mkdirSync(path.join(root, "screenshots"));
    fs.writeFileSync(path.join(root, "screenshots", "x" + STAGED_SUFFIX), "not the pipeline's");
    assert.equal(clearStaged(root), 3);
    assert.deepEqual(fs.readdirSync(root).sort(), keep.concat(["screenshots"]).sort());
    for (const name of keep) assert.equal(fs.readFileSync(path.join(root, name), "utf8"), "old " + name);
    assert.ok(fs.existsSync(path.join(root, "screenshots", "x" + STAGED_SUFFIX)), "only the folder itself is swept");
    assert.equal(clearStaged(root), 0, "nothing left to remove");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("clearStaged of a folder that is gone removes nothing and does not throw", () => {
  assert.equal(clearStaged(path.join(os.tmpdir(), "pdt-no-such-folder-" + Date.now())), 0);
});

test("the suffix is the pipeline's (normalization/session_io.py STAGED_SUFFIX)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "normalization", "session_io.py"), "utf8");
  assert.ok(src.includes('STAGED_SUFFIX = "' + STAGED_SUFFIX + '"'), "session_io.py names the same suffix");
});
