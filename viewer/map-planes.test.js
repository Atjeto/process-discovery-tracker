"use strict";
// The maps of one BPMN file (map-planes.js, contract C19): each sub-process's
// plane found by its path of names, on a file shaped like the pipeline's step
// BPMN (mining.export_bpmn: a collapsed bpmn:subProcess per sub-process node,
// named by its node, its map in a BPMNDiagram of its own, the ids inside it
// prefixed "Sub<n>_"), read by bpmn-moddle, the model bpmn-js itself reads;
// the id prefix; the PDD's pictures of the maps and the image file names.

const test = require("node:test");
const assert = require("node:assert/strict");
const BpmnModdle = require("bpmn-moddle");
const P = require("./map-planes.js");
const SPM = require("./sub-process-maps.js");

const Moddle = BpmnModdle.default || BpmnModdle;

// "Save order" is on the main map twice: the first shape has no plane (the
// pipeline gives the map to one of them), the second holds it. "Check the
// price" sits inside it, its name typed on two lines. "Create the order in
// SAP" is a sub-process no diagram draws (a copy edited by hand).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_1" targetNamespace="http://process-discovery-tracker/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="node_0" />
    <bpmn:userTask id="node_1_Search" name="Search the customer" />
    <bpmn:subProcess id="node_2_Save" name="Save order" />
    <bpmn:subProcess id="node_3_Save" name="Save order">
      <bpmn:startEvent id="Sub1_node_0" />
      <bpmn:userTask id="Sub1_node_1_Enter" name="Enter Product code" />
      <bpmn:subProcess id="Sub1_node_2_Check" name="Check  the&#10; price">
        <bpmn:userTask id="Sub2_node_1_Look" name="Look up the price" />
        <bpmn:textAnnotation id="Sub2_TextAnnotation_legend">
          <bpmn:text>Colour by system</bpmn:text>
        </bpmn:textAnnotation>
      </bpmn:subProcess>
      <bpmn:dataObject id="Sub1_DataObject_att-1" />
      <bpmn:dataObjectReference id="Sub1_DataObjectReference_att-1" name="Order spec" dataObjectRef="Sub1_DataObject_att-1">
        <bpmn:documentation>attachments/order spec.txt</bpmn:documentation>
      </bpmn:dataObjectReference>
    </bpmn:subProcess>
    <bpmn:subProcess id="node_4_Create" name="Create the order in SAP" />
    <bpmn:endEvent id="node_9_End" name="End" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Sub1_BPMNDiagram_1">
    <bpmndi:BPMNPlane id="Sub1_BPMNPlane_1" bpmnElement="node_3_Save" />
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Sub2_BPMNDiagram_1">
    <bpmndi:BPMNPlane id="Sub2_BPMNPlane_1" bpmnElement="Sub1_node_2_Check" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function parse(xml) {
  const { rootElement, warnings } = await new Moddle().fromXML(xml || XML);
  assert.deepEqual(warnings.map((w) => w.message), [], "precondition: the fixture reads without warnings");
  return rootElement;
}

/* Every element of the file by id. */
function byId(defs) {
  const out = {};
  const walk = (el) => {
    if (!el || typeof el !== "object" || !el.id || out[el.id]) return;
    out[el.id] = el;
    for (const k of ["flowElements", "artifacts"]) for (const c of el[k] || []) walk(c);
  };
  for (const r of defs.rootElements || []) walk(r);
  return out;
}

test("C19: every sub-process of the file with its path of names, depth first, whitespace collapsed", async () => {
  const defs = await parse();
  assert.deepEqual(P.subProcesses(defs).map((s) => [s.id, s.path]), [
    ["node_2_Save", ["Save order"]],
    ["node_3_Save", ["Save order"]],
    ["Sub1_node_2_Check", ["Save order", "Check the price"]],
    ["node_4_Create", ["Create the order in SAP"]],
  ]);
});

test("C19: findPlane finds the sub-process whose plane is the map at a path, the one with a plane when the node is there twice", async () => {
  const defs = await parse();
  assert.equal(P.findPlane(defs, ["Save order"]), "node_3_Save", "the shape without a plane is passed over");
  assert.equal(P.findPlane(defs, ["Save order", "Check the price"]), "Sub1_node_2_Check");
  // The project's node names match with their whitespace collapsed.
  assert.equal(P.findPlane(defs, ["  Save   order ", "Check the\nprice"]), "Sub1_node_2_Check");
  assert.equal(P.hasDiagram(defs, "node_3_Save"), true);
  assert.equal(P.hasDiagram(defs, "node_2_Save"), false);
});

test("C19: findPlane finds nothing for the main map, a sub-process no diagram draws, one renamed or only in the project, or a wrong depth", async () => {
  const defs = await parse();
  assert.equal(P.findPlane(defs, []), null, "the main map is the process's plane, no sub-process");
  assert.equal(P.findPlane(defs, ["Create the order in SAP"]), null, "drawn collapsed, with no map of its own");
  assert.equal(P.findPlane(defs, ["Save the order"]), null, "renamed in the editor");
  assert.equal(P.findPlane(defs, ["Check the price"]), null, "only inside Save order");
  assert.equal(P.findPlane(defs, ["Save order", "Look up the price"]), null, "a task is no sub-process");
  assert.equal(P.findPlane(null, ["Save order"]), null);
  assert.equal(P.findPlane(defs, null), null);
});

test("C19: the level of an element is the names of the sub-processes around it; a sub-process's own map adds its name", async () => {
  const el = byId(await parse());
  assert.deepEqual(P.levelOf(el.node_1_Search), []);
  assert.deepEqual(P.levelOf(el.Sub1_node_1_Enter), ["Save order"]);
  assert.deepEqual(P.levelOf(el.Sub2_node_1_Look), ["Save order", "Check the price"]);
  assert.deepEqual(P.levelOf(el.Sub1_node_2_Check), ["Save order"], "a sub-process is drawn at the level around it");
  assert.deepEqual(P.pathOf(el.Sub1_node_2_Check), ["Save order", "Check the price"]);
  assert.deepEqual(P.pathOf(el.Process_1), [], "the process is the main map");
  assert.deepEqual(P.levelOf(null), []);
});

test("C19: the path of the plane a bpmn-js root draws: a sub-process's root carries it, the process's is the main map", async () => {
  const el = byId(await parse());
  assert.deepEqual(P.pathOfRoot({ id: "Sub1_node_2_Check_plane", businessObject: el.Sub1_node_2_Check }), ["Save order", "Check the price"]);
  assert.deepEqual(P.pathOfRoot({ id: "Process_1", businessObject: el.Process_1 }), []);
  assert.deepEqual(P.pathOfRoot(null), []);
});

test("C19: an id without its plane's prefix", () => {
  assert.equal(P.baseId("Sub1_DataObjectReference_att-1"), "DataObjectReference_att-1");
  assert.equal(P.baseId("Sub12_TextAnnotation_legend"), "TextAnnotation_legend");
  assert.equal(P.baseId("TextAnnotation_legend"), "TextAnnotation_legend", "the main plane's ids carry none");
  assert.equal(P.baseId("Subway_1"), "Subway_1", "only Sub, digits and an underscore");
  assert.equal(P.baseId("x_Sub1_y"), "x_Sub1_y", "only at the start");
  assert.equal(P.baseId(null), "");
});

/* ---- The PDD's pictures ------------------------------------------------------ */

const step = (id, name, extra) => Object.assign({ step_id: id, name, process_label: name, state: "manually_authored",
  time_range: null }, extra || {});

test("C19: the PDD's pictures are of the sub-processes' maps with a number (a chapter each), in the maps' order; the main map keeps its own", () => {
  // Transaction 1 (the reference) runs A, then B with sub-steps (b1 with its
  // own), then C; transaction 2 runs D with sub-steps, which the reference
  // does not: D's map has no number, so no chapter and no picture.
  const txs = [
    [step("1", "A", { order: 1 }),
      step("2", "B", { order: 2, sub_steps: [step("2.1", "b1", { order: 1, sub_steps: [step("2.1.1", "x", { order: 1 })] }), step("2.2", "b2", { order: 2 })] }),
      step("3", "C", { order: 3 })],
    [step("4", "A", { order: 1 }), step("5", "D", { order: 2, sub_steps: [step("5.1", "d1", { order: 1 })] })],
  ];
  const tree = SPM.mapTree(txs, { reference: 0 });
  assert.deepEqual(tree.map((m) => [m.path, m.number]), [[[], null], [["B"], "2"], [["B", "b1"], "2.1"], [["D"], null]],
    "precondition: the project's maps");
  assert.deepEqual(P.pddMaps(tree), [{ path: ["B"], number: "2" }, { path: ["B", "b1"], number: "2.1" }]);
  assert.deepEqual(P.pddMaps([]), []);
  assert.deepEqual(P.pddMaps(null), []);
});

test("C19: the manifest names each picture drawn by its map's path; a map without a picture is left out (the PDD prints it as a table)", () => {
  const m = P.pddManifest([
    { path: ["B"], png: "map-1.png" },
    { path: ["B", "b1"], png: "" },
    { path: ["C"], png: "  map-3.png " },
    { path: "D", png: "map-4.png" },
    null,
  ]);
  assert.deepEqual(m, { maps: [{ path: ["B"], png: "map-1.png" }, { path: ["C"], png: "map-3.png" }] });
  // The shape the pipeline reads (pdd_export._read_map_images).
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
  assert.deepEqual(P.pddManifest(null), { maps: [] });
});

test("an exported map image is named after its map: the main map as before, a sub-process's with its number", () => {
  assert.equal(P.imageName("process-map", { path: [], number: null }), "process-map.svg");
  assert.equal(P.imageName("as-is-map", null), "as-is-map.svg");
  assert.equal(P.imageName("process-map", { path: ["B", "b1"], number: "2.1" }), "process-map-sub-process-2.1.svg");
  assert.equal(P.imageName("as-is-map", { path: ["D"], number: null }), "as-is-map-sub-process.svg",
    "a map the reference transaction does not reach has no number");
});
