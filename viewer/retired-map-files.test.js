"use strict";
/*
 * The one map (BA-helper cycle): the viewer draws the process map from the
 * runs' steps and forks the step-level BPMN (process_map_step.bpmn). It no
 * longer reads the activity-level map files the pipeline used to write
 * (dfg.json, process_map.bpmn, process_maps/), so a later pipeline lane can
 * stop writing them. These checks fail if a read comes back.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadSessionData } = require("./main.js");

const RETIRED = /\bdfg\.json\b|\bprocess_map\.bpmn\b|\bprocess_maps\b/;

/* The code of a source without its comments (a comment may name a file the
   code does not read): block comments, and lines that are only a line comment. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
    .filter((l) => !l.trim().startsWith("//")).join("\n");
}

test("a session load carries no dfg (dfg.json is not read)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-retired-"));
  try {
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ session_id: "s1" }));
    fs.writeFileSync(path.join(dir, "events.jsonl"), "");
    fs.writeFileSync(path.join(dir, "dfg.json"), JSON.stringify({ edges: [{ source: "A", target: "B" }] }));
    const payload = loadSessionData(dir);
    assert.ok(!("dfg" in payload), "no dfg field: " + Object.keys(payload).join(","));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no viewer source names the retired map files", () => {
  const skip = new Set(["node_modules", "python", "fonts", "dist"]);
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if ((e.name.endsWith(".js") || e.name.endsWith(".html")) && !e.name.endsWith(".test.js")) files.push(p);
    }
  })(__dirname);
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const text = f.endsWith(".html") ? src.replace(/<!--[\s\S]*?-->/g, "") : codeOnly(src);
    if (RETIRED.test(text)) hits.push(path.relative(__dirname, f));
  }
  assert.deepEqual(hits, [], "a source names dfg.json, process_map.bpmn or process_maps/");
});
