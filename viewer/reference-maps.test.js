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

test("lane MV: forkEntry makes a new copy's row with its provenance and writes nothing (Edit keeps it at its first change)", () => {
  const sf = tmpSession();
  const srcFile = path.join(sf, "process_map_step.bpmn");
  fs.writeFileSync(srcFile, "<source/>");
  const e = RM.forkEntry({
    xml: "<source/>", source: { notation: "bpmn", level: "step" }, sourceBpmnPath: srcFile,
    name: "As-Is map", kind: "as_is", nowIso: "2026-09-24T00:00:00.000Z",
  });
  assert.match(e.file, /^derived_maps\/rm_.+\.bpmn$/);
  assert.equal(e.forked_from_hash, RM.fileHash(srcFile));
  assert.equal(e.name, "As-Is map");
  assert.equal(e.kind, "as_is");
  assert.equal(e.pdd_role, null);
  assert.equal(e.forked_at, "2026-09-24T00:00:00.000Z");
  assert.equal(fs.existsSync(path.join(sf, "derived_maps")), false, "no folder, no file");
  assert.equal(e.forked_from_steps, null, "no signature of the steps was given");
  // Lane FX2: the signature of the maps the steps drew, kept on the row.
  assert.equal(RM.forkEntry({ xml: "<source/>", source: { level: "step" }, stepsSig: "abc123" }).forked_from_steps, "abc123");
  // Kept: the file and the row, as fork makes them at once.
  const anno = {};
  RM.writeBpmn(sf, e, "<source/>");
  RM.upsert(anno, e);
  assert.equal(RM.readBpmn(sf, RM.find(anno, e.map_id)), "<source/>");
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

/* A step map as the pipeline writes it (mining.export_bpmn): the process
   elements (a task's documentation, its incoming and outgoing flows and the
   files it holds inside it), then the diagram. `v` varies what is not the
   process: the ids (a prefix), the order of the process elements
   (reversed), the layout (a shift) and the documentation text. MAP has an
   unnamed start, a parallel block, two choices joined gateway to gateway, a
   manual task, a named end, a file, a note and the legend. */
const MAP = {
  nodes: [
    ["start", "startEvent", ""],
    ["search", "task", "Account lookup: Search"],
    ["fork", "parallelGateway", ""],
    ["open", "task", "Open customer record"],
    ["track", "task", "Order Tracking.xlsx: Save workbook"],
    ["meet", "parallelGateway", ""],
    ["x1", "exclusiveGateway", ""],
    ["save", "task", "Order: Save order"],
    ["call", "manualTask", "Call the customer"],
    ["x2", "exclusiveGateway", ""],
    ["x3", "exclusiveGateway", ""],
    ["mail", "task", "Outlook: Send confirmation"],
    ["print", "task", "Print the order"],
    ["x4", "exclusiveGateway", ""],
    ["end", "endEvent", "Order saved & confirmed"],
  ],
  flows: [
    ["start", "search", ""], ["search", "fork", ""], ["fork", "open", ""], ["fork", "track", ""],
    ["open", "meet", ""], ["track", "meet", ""], ["meet", "x1", ""],
    ["x1", "save", "Customer found"], ["x1", "call", "Customer unknown"],
    ["save", "x2", ""], ["call", "x2", ""], ["x2", "x3", ""],
    ["x3", "mail", "3 of 4 transactions"], ["x3", "print", "1 of 4 transactions"],
    ["mail", "x4", ""], ["print", "x4", ""], ["x4", "end", ""],
  ],
  data: [["att1", "Order form.pdf", "save"]],
  notes: [["search", "Ask for the customer number first"]],
  legend: "Colour by system\nSalesforce: blue\nExcel: green",
};
function stepMap(map, v = {}) {
  const id = (k) => (v.ids || "") + k;
  const text = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const attr = (s) => text(s).replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
  const flows = map.flows.map(([s, t, name], i) => ({ id: id("flow_" + i), s, t, name }));
  const els = map.nodes.map(([k, kind, name]) => {
    const held = map.data.filter((d) => d[2] === k);
    return `<bpmn:${kind} id="${id(k)}"${name ? ` name="${attr(name)}"` : ""}>` +
      (v.doc ? `<bpmn:documentation>${text(v.doc + k)}</bpmn:documentation>` : "") +
      flows.filter((f) => f.t === k).map((f) => `<bpmn:incoming>${f.id}</bpmn:incoming>`).join("") +
      flows.filter((f) => f.s === k).map((f) => `<bpmn:outgoing>${f.id}</bpmn:outgoing>`).join("") +
      (held.length ? `<bpmn:property id="${id("Property_" + k)}" name="__targetRef_placeholder" />` : "") +
      held.map(([dk]) => `<bpmn:dataInputAssociation id="${id("DataInputAssociation_" + dk)}">` +
        `<bpmn:sourceRef>${id("DataObjectReference_" + dk)}</bpmn:sourceRef>` +
        `<bpmn:targetRef>${id("Property_" + k)}</bpmn:targetRef></bpmn:dataInputAssociation>`).join("") +
      `</bpmn:${kind}>`;
  });
  for (const f of flows) {
    els.push(`<bpmn:sequenceFlow id="${f.id}" sourceRef="${id(f.s)}" targetRef="${id(f.t)}"${f.name ? ` name="${attr(f.name)}"` : ""} />`);
  }
  for (const [dk, name] of map.data) {
    els.push(`<bpmn:dataObject id="${id("DataObject_" + dk)}" />`,
      `<bpmn:dataObjectReference id="${id("DataObjectReference_" + dk)}" name="${attr(name)}" dataObjectRef="${id("DataObject_" + dk)}" />`);
  }
  map.notes.forEach(([k, note], i) => {
    els.push(`<bpmn:textAnnotation id="${id("TextAnnotation_" + i)}"><bpmn:text>${text(note)}</bpmn:text></bpmn:textAnnotation>`,
      `<bpmn:association id="${id("Association_" + i)}" associationDirection="None" sourceRef="${id(k)}" targetRef="${id("TextAnnotation_" + i)}" />`);
  });
  if (map.legend) els.push(`<bpmn:textAnnotation id="${id("TextAnnotation_legend")}"><bpmn:text>${text(map.legend)}</bpmn:text></bpmn:textAnnotation>`);
  if (v.reverse) els.reverse();
  const shapes = map.nodes.map(([k], i) => `<bpmndi:BPMNShape id="${id("Shape_" + k)}" bpmnElement="${id(k)}">` +
    `<dc:Bounds x="${(v.dx || 0) + 150 * i}" y="120" width="100" height="80" /></bpmndi:BPMNShape>`);
  return "<?xml version='1.0' encoding='utf-8'?>\n" +
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" ' +
    'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_1">\n  <bpmn:process id="Process_1" isExecutable="false">\n    ' +
    els.join("\n    ") + "\n  </bpmn:process>\n  " +
    '<bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">' +
    shapes.join("") + "</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>\n</bpmn:definitions>\n";
}
/* The next analysis of the same steps: other ids, another order, another
   layout and other documentation. */
const REORDERED = { ids: "n7_", reverse: true, dx: 37, doc: "In 3 of 4 transactions, 5s on average. " };
function changed(edit) {
  const map = JSON.parse(JSON.stringify(MAP));
  edit(map);
  return stepMap(map);
}
const flowOf = (map, s, t) => map.flows.find((f) => f[0] === s && f[1] === t);

test("processSignature: one process with other ids, element order, layout and documentation has one signature", () => {
  const a = stepMap(MAP), b = stepMap(MAP, REORDERED);
  assert.notEqual(RM.hashContent(Buffer.from(a)), RM.hashContent(Buffer.from(b)), "the bytes differ");
  assert.match(RM.processSignature(a), /^[0-9a-f]{16}$/);
  assert.equal(RM.processSignature(b), RM.processSignature(a));
});

test("processSignature: a change to the process changes it", () => {
  const base = RM.processSignature(stepMap(MAP));
  const edits = {
    "a renamed task": (m) => { m.nodes[7][2] = "Order: Save the order"; },
    "an added flow": (m) => { m.flows.push(["x3", "x4", ""]); },
    "a changed condition name": (m) => { flowOf(m, "x1", "call")[2] = "Customer not found"; },
    "a task of another kind": (m) => { m.nodes[8][1] = "task"; },
    "a renamed end event": (m) => { m.nodes[14][2] = "Order saved"; },
    "a renamed data object": (m) => { m.data[0][1] = "Order form v2.pdf"; },
    "a data object held by another task": (m) => { m.data[0][2] = "call"; },
    "another note text": (m) => { m.notes[0][1] = "Ask for the order number first"; },
    "a note joined to another task": (m) => { m.notes[0][0] = "open"; },
    "another legend": (m) => { m.legend = "Colour by system\nSalesforce: orange\nExcel: green"; },
    // Each branch keeps its task and its name but leaves from the other
    // choice: the kinds and names of every flow's ends are as before, so
    // only the gateways told apart by what they join see it.
    "branches wired to the other choice": (m) => {
      flowOf(m, "x1", "call")[0] = "x3"; flowOf(m, "call", "x2")[1] = "x4";
      flowOf(m, "x3", "print")[0] = "x1"; flowOf(m, "print", "x4")[1] = "x2";
    },
  };
  for (const [what, edit] of Object.entries(edits)) {
    const sig = RM.processSignature(changed(edit));
    assert.match(String(sig), /^[0-9a-f]{16}$/, what);
    assert.notEqual(sig, base, what);
  }
});

test("processSignature: no signature for XML that draws no process", () => {
  assert.equal(RM.processSignature(null), null);
  assert.equal(RM.processSignature(""), null);
  assert.equal(RM.processSignature("<bpmn:definitions><bpmn:process id=\"P\" /></bpmn:definitions>"), null);
});

test("isStale: a copy with a process signature compares the process; one made before keeps the byte rule", () => {
  const e = RM.buildEntry({ file: "f", forked_from_hash: "abc", forked_from_sig: "s1" });
  assert.equal(RM.isStale(e, "def", "s1"), false, "other bytes, the same process");
  assert.equal(RM.isStale(e, "abc", "s2"), true, "another process");
  assert.equal(RM.isStale(e, "def", null), false, "an unknown current process is no change");
  const before = RM.buildEntry({ file: "f", forked_from_hash: "abc" });
  assert.equal(RM.isStale(before, "def", "s1"), true, "no signature: the bytes decide, as before");
  assert.equal(RM.isStale(before, "abc", "s2"), false);
});

test("fork stores the process signature: the next analysis of the same steps is no drift, a changed process is, a duplicate carries it", () => {
  const sf = tmpSession();
  const src = path.join(sf, "process_map_step.bpmn");
  fs.writeFileSync(src, stepMap(MAP));
  const anno = {};
  const e = RM.fork({
    sessionFolder: sf, anno, xml: stepMap(MAP), source: { level: "step" },
    sourceBpmnPath: src, nowIso: "t",
  });
  assert.equal(e.forked_from_hash, RM.fileHash(src));
  assert.equal(e.forked_from_sig, RM.processSignature(stepMap(MAP)));
  fs.writeFileSync(src, stepMap(MAP, REORDERED));
  let now = RM.sourceMarks(src);
  assert.notEqual(now.hash, e.forked_from_hash, "the file's bytes changed");
  assert.equal(RM.isStale(e, now.hash, now.sig), false);
  fs.writeFileSync(src, changed((m) => { m.nodes[7][2] = "Order: Save the order"; }));
  now = RM.sourceMarks(src);
  assert.equal(RM.isStale(e, now.hash, now.sig), true);
  const dup = RM.duplicate({ sessionFolder: sf, anno, srcEntry: Object.assign({}, e, { forked_from_steps: "s1" }), nowIso: "t2" });
  assert.equal(dup.forked_from_sig, e.forked_from_sig);
  assert.equal(dup.forked_from_steps, "s1", "a duplicate carries the steps it was made from (lane FX2)");
  assert.equal(RM.sourceMarks(path.join(sf, "missing.bpmn")), null);
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

test("destroy removes the manifest row and leaves the blob to the save that follows (it moves the file out for an undo, analyst-files.js)", () => {
  const sf = tmpSession();
  const anno = {};
  const e = RM.fork({ sessionFolder: sf, anno, xml: "<a/>", source: { level: "activity" }, nowIso: "t" });
  const full = path.join(sf, e.file);
  assert.ok(fs.existsSync(full));
  RM.destroy({ sessionFolder: sf, anno, id: e.map_id });
  assert.equal(RM.list(anno).length, 0);
  // The blob is not unlinked here: the annotations save moves it out of the
  // folder for an undo (analyst-files.test.js), which brings back a WORKING entry.
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

test("the stored shape of a map keeps its keys (the Export menu reads it) and adds the process signature it was copied from, and (lane FX2) the steps'", () => {
  const e = RM.buildEntry({ file: "derived_maps/x.bpmn", name: "As-Is map", kind: "as_is", source: { level: "step" }, forked_at: "t" });
  assert.deepEqual(Object.keys(e).sort(),
    ["edited_at", "file", "forked_at", "forked_from_hash", "forked_from_sig", "forked_from_steps", "kind", "map_id", "name", "notes", "pdd_role", "source"]);
});

test("C18: a copy made before the step map had its colours, notes and attachments is told apart (no user or manual task, no legend, no colour in it)", () => {
  const before = '<bpmn:process id="P"><bpmn:task id="t1" name="Save order" /><bpmn:startEvent id="s" /></bpmn:process>';
  const after = '<bpmn:process id="P"><bpmn:userTask id="t1" name="Save order">\n</bpmn:userTask></bpmn:process>';
  assert.equal(RM.predatesRichMap(before), true);
  assert.equal(RM.predatesRichMap(after), false);
  assert.equal(RM.predatesRichMap('<manualTask id="t2"/>'), false, "a manual task, any prefix");
  assert.equal(RM.predatesRichMap('<bpmn:userTaskish id="x"/>'), true, "only the element names count");
  assert.equal(RM.predatesRichMap(null), true);
  // Lane CL: a task done in a system is a plain task now; the legend or a
  // task's colour tells the map apart, on any plane.
  const plain = '<bpmn:process id="P"><bpmn:task id="node_1_Save" name="Save order" />' +
    '<bpmn:textAnnotation id="TextAnnotation_legend"><bpmn:text>Colour by system</bpmn:text></bpmn:textAnnotation></bpmn:process>';
  assert.equal(RM.predatesRichMap(plain), false, "the legend");
  assert.equal(RM.predatesRichMap(before.replace("</bpmn:process>",
    '<bpmn:subProcess id="s1"><bpmn:textAnnotation id="Sub1_TextAnnotation_legend" /></bpmn:subProcess></bpmn:process>')), false,
    "a sub-process's legend");
  assert.equal(RM.predatesRichMap(before + '<bpmndi:BPMNShape id="Sh" bpmnElement="t1" bioc:fill="#bfdbfe" bioc:stroke="#1e3a8a" />'), false,
    "a task's colour");
  assert.equal(RM.predatesRichMap(before.replace("t1", "TextAnnotation_legendary")), true, "only the legend's id counts");
});

test("2.0.1: a copy with system labels (above a task, or once for the map) is a rich map, never one to copy again for that", () => {
  const head = '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="Process_1"><bpmn:task id="t1" name="Save" />';
  const tail = "</bpmn:process></bpmn:definitions>";
  assert.equal(RM.predatesRichMap(head + tail), true, "control: plain tasks alone");
  assert.equal(RM.predatesRichMap(head + '<bpmn:textAnnotation id="TextAnnotation_system_1"><bpmn:text>SAP</bpmn:text></bpmn:textAnnotation>' + tail), false);
  assert.equal(RM.predatesRichMap(head + '<bpmn:textAnnotation id="TextAnnotation_system"><bpmn:text>System: SAP</bpmn:text></bpmn:textAnnotation>' + tail), false);
  assert.equal(RM.predatesRichMap(head + '<bpmn:textAnnotation id="Sub1_TextAnnotation_system_2" />' + tail), false, "on a sub-process's plane");
});

test("2.0.1: a copy drawn in colours or with the legend, and no system label, predates the labels", () => {
  const RM = require("./reference-maps.js");
  const task = '<bpmn:task id="Task_1" name="Save" />';
  assert.equal(RM.predatesLabels('<x><bpmndi:BPMNShape bpmnElement="Task_1" bioc:fill="#bfdbfe" /></x>'), true);
  assert.equal(RM.predatesLabels('<x><bpmn:textAnnotation id="TextAnnotation_legend" /></x>'), true);
  assert.equal(RM.predatesLabels('<x><bpmn:textAnnotation id="Sub1_TextAnnotation_legend" /></x>'), true);
  assert.equal(RM.predatesLabels('<x>' + task + '<bpmn:textAnnotation id="TextAnnotation_system_1" /></x>'), false);
  assert.equal(RM.predatesLabels('<x>' + task + '<bpmn:textAnnotation id="TextAnnotation_system" /></x>'), false);
  assert.equal(RM.predatesLabels('<x>' + task + '</x>'), false, "a map with no colour says nothing about labels");
});
