"use strict";

/* ADR-0019: Reference Maps store. Pure manifest logic + fs-backed fork/dup/
   destroy, exercised against a temp session folder. No Electron needed. */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const RM = require("./reference-maps.js");

function tmpSession() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pdt-rm-"));
}

test("buildEntry fills defaults and clamps an unknown kind to reference", () => {
  const e = RM.buildEntry({ file: "derived_maps/x.bpmn", kind: "bogus" });
  assert.equal(e.kind, "reference");
  assert.ok(e.map_id.startsWith("rm_"));
  assert.equal(e.pdd_role, null);
  assert.equal(RM.buildEntry({ file: "f", kind: "to_be" }).kind, "to_be");
});

test("upsert replaces by id (does not append); find / remove work", () => {
  const anno = {};
  RM.upsert(anno, RM.buildEntry({ map_id: "rm_1", file: "f" }));
  assert.equal(RM.list(anno).length, 1);
  RM.upsert(anno, RM.buildEntry({ map_id: "rm_1", file: "g", name: "renamed" }));
  assert.equal(RM.list(anno).length, 1);
  assert.equal(RM.find(anno, "rm_1").name, "renamed");
  assert.equal(RM.remove(anno, "rm_1").map_id, "rm_1");
  assert.equal(RM.list(anno).length, 0);
});

test("setPddRole is exclusive per slot; unknown role clears", () => {
  const anno = {};
  RM.upsert(anno, RM.buildEntry({ map_id: "a", file: "a" }));
  RM.upsert(anno, RM.buildEntry({ map_id: "b", file: "b" }));
  RM.setPddRole(anno, "a", "to_be");
  RM.setPddRole(anno, "b", "to_be"); // steals the slot from a
  assert.equal(RM.find(anno, "a").pdd_role, null);
  assert.equal(RM.find(anno, "b").pdd_role, "to_be");
  assert.equal(RM.pddPick(anno, "to_be").map_id, "b");
  RM.setPddRole(anno, "b", "garbage");
  assert.equal(RM.find(anno, "b").pdd_role, null);
});

test("isStale compares forked-from hash vs current source hash", () => {
  const e = RM.buildEntry({ file: "f", forked_from_hash: "abc" });
  assert.equal(RM.isStale(e, "abc"), false);
  assert.equal(RM.isStale(e, "def"), true);
  assert.equal(RM.isStale(e, null), false); // unknown current => not stale
});

test("hashContent is deterministic and 16 chars", () => {
  const h1 = RM.hashContent(Buffer.from("<bpmn/>"));
  assert.equal(h1, RM.hashContent(Buffer.from("<bpmn/>")));
  assert.notEqual(h1, RM.hashContent(Buffer.from("<bpmn x/>")));
  assert.equal(h1.length, 16);
});

test("fork writes blob under derived_maps/, stamps provenance, upserts row", () => {
  const sf = tmpSession();
  const anno = {};
  const entry = RM.fork({
    sessionFolder: sf, anno, xml: "<definitions/>",
    source: { notation: "bpmn", level: "step" }, name: "My map", kind: "to_be",
    nowIso: "2026-05-31T00:00:00.000Z",
  });
  assert.ok(fs.existsSync(path.join(sf, entry.file)));
  assert.match(entry.file, /^derived_maps\//);
  assert.equal(RM.readBpmn(sf, entry), "<definitions/>");
  assert.equal(RM.list(anno).length, 1);
  assert.equal(entry.kind, "to_be");
  assert.equal(entry.forked_at, "2026-05-31T00:00:00.000Z");
  assert.ok(entry.forked_from_hash); // hashed from xml when no source path
});

test("fork prefers the on-disk source hash; drift fires when the source changes", () => {
  const sf = tmpSession();
  const srcFile = path.join(sf, "process_map_step.bpmn");
  fs.writeFileSync(srcFile, "<source/>");
  const anno = {};
  const e = RM.fork({
    sessionFolder: sf, anno, xml: "<laidout/>", source: { level: "step" },
    sourceBpmnPath: srcFile, nowIso: "t",
  });
  assert.equal(e.forked_from_hash, RM.fileHash(srcFile));
  fs.writeFileSync(srcFile, "<source-changed/>");
  assert.equal(RM.isStale(e, RM.fileHash(srcFile)), true);
});

test("duplicate copies the blob as a To-Be map with no PDD role, fresh id + file", () => {
  const sf = tmpSession();
  const anno = {};
  const src = RM.fork({ sessionFolder: sf, anno, xml: "<a/>", source: { level: "step" }, name: "As-Is map", kind: "as_is", nowIso: "t" });
  RM.setRole(anno, src.map_id, "as_is");
  const dup = RM.duplicate({ sessionFolder: sf, anno, srcEntry: src, nowIso: "t2" });
  assert.notEqual(dup.map_id, src.map_id);
  assert.notEqual(dup.file, src.file);
  assert.equal(dup.name, "To-Be map");
  assert.equal(dup.kind, "to_be");
  assert.equal(dup.pdd_role, null);
  assert.equal(dup.source.level, "step");
  assert.equal(RM.readBpmn(sf, dup), "<a/>");
  assert.equal(RM.list(anno).length, 2);
  assert.equal(RM.pddPick(anno, "as_is").map_id, src.map_id, "the As-Is map keeps its role");
});

test("destroy removes the manifest row but KEEPS the blob (undo-safe)", () => {
  const sf = tmpSession();
  const anno = {};
  const e = RM.fork({ sessionFolder: sf, anno, xml: "<a/>", source: { level: "activity" }, nowIso: "t" });
  const full = path.join(sf, e.file);
  assert.ok(fs.existsSync(full));
  RM.destroy({ sessionFolder: sf, anno, id: e.map_id });
  assert.equal(RM.list(anno).length, 0);
  // Blob retained so a one-step annotations undo restores a WORKING entry.
  assert.ok(fs.existsSync(full), "blob must survive delete so Ctrl+Z restores a usable map");
  RM.upsert(anno, e);                       // simulate undo restoring the row
  assert.equal(RM.readBpmn(sf, e), "<a/>"); // and it still opens
});

test("absPath refuses a path that escapes the session folder", () => {
  const sf = tmpSession();
  assert.equal(RM.absPath(sf, { file: "../escape.bpmn" }), null);
  assert.ok(RM.absPath(sf, { file: "derived_maps/ok.bpmn" }) !== null);
  assert.equal(RM.readBpmn(sf, { file: "../../secret" }), null);
  assert.throws(() => RM.writeBpmn(sf, { file: "../evil.bpmn" }, "<x/>"));
});

test("setRole is the one role control: exclusive per slot, and the stored kind follows a chosen role", () => {
  const anno = {};
  RM.upsert(anno, RM.buildEntry({ map_id: "a", file: "a", kind: "reference" }));
  RM.upsert(anno, RM.buildEntry({ map_id: "b", file: "b", kind: "as_is" }));
  RM.setRole(anno, "a", "as_is");
  assert.deepEqual([RM.find(anno, "a").pdd_role, RM.find(anno, "a").kind], ["as_is", "as_is"]);
  RM.setRole(anno, "b", "as_is");   // takes the slot from a
  assert.equal(RM.find(anno, "a").pdd_role, null);
  assert.equal(RM.pddPick(anno, "as_is").map_id, "b");
  RM.setRole(anno, "b", "to_be");
  assert.deepEqual([RM.find(anno, "b").pdd_role, RM.find(anno, "b").kind], ["to_be", "to_be"]);
  RM.setRole(anno, "b", null);      // cleared: the role goes, the kind stays
  assert.deepEqual([RM.find(anno, "b").pdd_role, RM.find(anno, "b").kind], [null, "to_be"]);
  assert.equal(RM.setRole(anno, "missing", "as_is"), null);
});

test("the stored shape of a map is unchanged (the Export menu reads it)", () => {
  const e = RM.buildEntry({ file: "derived_maps/x.bpmn", name: "As-Is map", kind: "as_is", source: { level: "step" }, forked_at: "t" });
  assert.deepEqual(Object.keys(e).sort(),
    ["edited_at", "file", "forked_at", "forked_from_hash", "kind", "map_id", "name", "notes", "pdd_role", "source"]);
});
