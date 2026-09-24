"use strict";
// What a click on the As-Is map does (asis-links.js, contract C18): the
// element dispatch on a step BPMN shaped like the pipeline's
// (mining.export_bpmn: user and manual tasks, a data object per attachment,
// the notes and the legend as text annotations), read by bpmn-moddle, the
// model bpmn-js itself reads, so a type is matched as bpmn-js matches it; and
// the task-to-step matching by the live map's node rule.

const test = require("node:test");
const assert = require("node:assert");
const BpmnModdle = require("bpmn-moddle");
const L = require("./asis-links.js");

const Moddle = BpmnModdle.default || BpmnModdle;
// A window title's separator and the value separator the value rules cut at,
// built from their codes.
const SEP = " " + String.fromCharCode(45) + " ";
const EM = String.fromCharCode(0x2014);

const NOTE = "The order is saved only after the credit check passes; a blocked customer goes to the credit team first.";
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://process-discovery-tracker/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="node_0" />
    <bpmn:userTask id="node_1_Save" name="Salesforce${SEP}Order: Save order">
      <bpmn:documentation>Salesforce, Order. In 4 of 4 transactions, 8s on average.</bpmn:documentation>
      <bpmn:property id="Property_att-1" name="__targetRef_placeholder" />
      <bpmn:dataInputAssociation id="DataInputAssociation_att-1">
        <bpmn:sourceRef>DataObjectReference_att-1</bpmn:sourceRef>
        <bpmn:targetRef>Property_att-1</bpmn:targetRef>
      </bpmn:dataInputAssociation>
    </bpmn:userTask>
    <bpmn:manualTask id="node_2_Call" name="Call the  customer&#10;back" />
    <bpmn:task id="Activity_0abc" name="Added in the editor" />
    <bpmn:exclusiveGateway id="node_3" />
    <bpmn:endEvent id="node_4_End" name="End" />
    <bpmn:sequenceFlow id="flow_0" sourceRef="node_0" targetRef="node_1_Save" />
    <bpmn:sequenceFlow id="flow_1" name="3 of 4 transactions" sourceRef="node_1_Save" targetRef="node_3" />
    <bpmn:dataObject id="DataObject_att-1" />
    <bpmn:dataObjectReference id="DataObjectReference_att-1" name="Order spec" dataObjectRef="DataObject_att-1">
      <bpmn:documentation>attachments/order spec.txt</bpmn:documentation>
    </bpmn:dataObjectReference>
    <bpmn:dataObject id="DataObject_att_2" />
    <bpmn:dataObjectReference id="DataObjectReference_att_2" name="A long label cut for the map" dataObjectRef="DataObject_att_2">
      <bpmn:documentation>A long label cut for the map, whole here&#13;
attachments/rates.xlsx</bpmn:documentation>
    </bpmn:dataObjectReference>
    <bpmn:dataObject id="DataObject_0xyz" />
    <bpmn:dataObjectReference id="Data_Ref_0xyz" name="Drawn in the editor" dataObjectRef="DataObject_0xyz" />
    <bpmn:textAnnotation id="TextAnnotation_1">
      <bpmn:documentation>${NOTE}</bpmn:documentation>
      <bpmn:text>The order is saved only after the credit check passes; a blocked customer goes to the…</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:textAnnotation id="TextAnnotation_2">
      <bpmn:text>Check the plant code.&#13;
Then the rate.</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:textAnnotation id="TextAnnotation_3" />
    <bpmn:textAnnotation id="TextAnnotation_legend">
      <bpmn:text>Colour by system
Salesforce: blue</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:association id="Association_1" associationDirection="None" sourceRef="node_1_Save" targetRef="TextAnnotation_1" />
  </bpmn:process>
</bpmn:definitions>`;

/* The model's elements as bpmn-js diagram elements (a shape per element, and
   the external label bpmn-js draws for a data object), by id. */
async function elements() {
  const { rootElement } = await new Moddle().fromXML(XML);
  const proc = rootElement.rootElements[0];
  const out = {};
  const add = (bo) => {
    if (!bo || !bo.id || out[bo.id]) return;
    out[bo.id] = { id: bo.id, type: bo.$type, businessObject: bo };
    for (const inner of bo.dataInputAssociations || []) add(inner);
    for (const inner of bo.properties || []) add(inner);
  };
  for (const bo of [...(proc.flowElements || []), ...(proc.artifacts || [])]) add(bo);
  out.process = { id: proc.id, type: proc.$type, businessObject: proc };
  const ref = out["DataObjectReference_att-1"];
  out.dataLabel = { id: ref.id + "_label", type: "label", businessObject: ref.businessObject, labelTarget: ref };
  return out;
}

test("a task of any kind opens the step panel: user tasks, manual tasks and the plain tasks drawn in the editor", async () => {
  const el = await elements();
  // On the main map: the level [] (C19).
  assert.deepStrictEqual(L.elementAction(el.node_1_Save), { kind: "task", name: "Salesforce" + SEP + "Order: Save order", path: [] });
  // A name on two lines, or with doubled spaces, reads as one line.
  assert.deepStrictEqual(L.elementAction(el.node_2_Call), { kind: "task", name: "Call the customer back", path: [] });
  assert.deepStrictEqual(L.elementAction(el.Activity_0abc), { kind: "task", name: "Added in the editor", path: [] });
  // Matched by type through the model (a user task is a task), never by a type string.
  assert.strictEqual(L.is(el.node_2_Call, "bpmn:Task"), true);
  assert.strictEqual(L.is(el.node_2_Call.businessObject, "bpmn:ManualTask"), true);
  assert.strictEqual(L.is({ type: "bpmn:UserTask", businessObject: { $type: "bpmn:UserTask" } }, "bpmn:Task"), false,
    "an element without its model is no task");
});

test("a data object opens its attachment: the id from its element id, the file from the last line of its documentation, its label too", async () => {
  const el = await elements();
  assert.deepStrictEqual(L.elementAction(el["DataObjectReference_att-1"]), { kind: "file", id: "att-1", file: "order spec.txt" });
  assert.deepStrictEqual(L.elementAction(el.dataLabel), { kind: "file", id: "att-1", file: "order spec.txt" },
    "a click on the name under the file does the same");
  assert.deepStrictEqual(L.elementAction(el.DataObjectReference_att_2), { kind: "file", id: "att_2", file: "rates.xlsx" });
  // A data object drawn in the editor names no attachment: nothing to open.
  assert.strictEqual(L.elementAction(el.Data_Ref_0xyz), null);
  assert.strictEqual(L.elementAction(el["DataObject_att-1"]), null, "the data object itself is not drawn");
});

test("a note shows its whole text: the documentation when the map shows it cut, else its text; an empty note and the legend do nothing", async () => {
  const el = await elements();
  assert.deepStrictEqual(L.elementAction(el.TextAnnotation_1), { kind: "note", text: NOTE });
  assert.deepStrictEqual(L.elementAction(el.TextAnnotation_2), { kind: "note", text: "Check the plant code.\nThen the rate." });
  assert.strictEqual(L.elementAction(el.TextAnnotation_3), null);
  assert.strictEqual(L.elementAction(el.TextAnnotation_legend), null);
  assert.strictEqual(L.isLegend(el.TextAnnotation_legend), true);
  assert.strictEqual(L.isLegend(el.TextAnnotation_1), false);
});

test("the flows, the events, the gateways, the associations and the canvas do nothing", async () => {
  const el = await elements();
  for (const id of ["node_0", "node_3", "node_4_End", "flow_0", "flow_1", "Association_1", "DataInputAssociation_att-1", "Property_att-1", "process"]) {
    assert.strictEqual(L.elementAction(el[id]), null, id);
  }
  assert.strictEqual(L.elementAction(null), null);
  assert.strictEqual(L.elementAction({}), null);
});

test("documentation: the entries on their own lines, Windows line ends read as one", () => {
  const bo = { documentation: [{ text: "one\r\ntwo" }, { text: "  " }, { text: "three" }] };
  assert.strictEqual(L.documentation(bo), "one\ntwo\nthree");
  assert.strictEqual(L.documentation({}), "");
});

/* ---- Contract C19: a sub-process and its plane ------------------------------- */

// The pipeline writes a sub-process as a collapsed bpmn:subProcess named by
// its node, its map drawn in a plane of its own, the ids inside it prefixed
// "Sub<n>_" (bpmn_observed._sub_process_planes); bpmn-js draws that plane on
// a root whose business object is the sub-process ("<id>_plane").
const SUB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://process-discovery-tracker/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:userTask id="node_1_Search" name="Search" />
    <bpmn:subProcess id="node_2_Save" name="Save order">
      <bpmn:userTask id="Sub1_node_1_Enter" name="Enter Product code" />
      <bpmn:subProcess id="Sub1_node_2_Check" name="Check the price">
        <bpmn:manualTask id="Sub2_node_1_Call" name="Call the  supplier" />
      </bpmn:subProcess>
      <bpmn:dataObject id="Sub1_DataObject_att-1" />
      <bpmn:dataObjectReference id="Sub1_DataObjectReference_att-1" name="Order spec" dataObjectRef="Sub1_DataObject_att-1">
        <bpmn:documentation>attachments/order spec.txt</bpmn:documentation>
      </bpmn:dataObjectReference>
      <bpmn:textAnnotation id="Sub1_TextAnnotation_1">
        <bpmn:text>Check the stock first.</bpmn:text>
      </bpmn:textAnnotation>
      <bpmn:textAnnotation id="Sub1_TextAnnotation_legend">
        <bpmn:text>Colour by system
Salesforce: blue</bpmn:text>
      </bpmn:textAnnotation>
    </bpmn:subProcess>
  </bpmn:process>
</bpmn:definitions>`;

async function subElements() {
  const { rootElement } = await new Moddle().fromXML(SUB_XML);
  const out = {};
  const walk = (bo) => {
    out[bo.id] = { id: bo.id, type: bo.$type, businessObject: bo };
    for (const c of [...(bo.flowElements || []), ...(bo.artifacts || [])]) walk(c);
  };
  walk(rootElement.rootElements[0]);
  const sp = out.node_2_Save.businessObject;
  // The root bpmn-js draws the sub-process's plane on.
  out.plane = { id: sp.id + "_plane", type: sp.$type, businessObject: sp, di: { $instanceOf: (t) => t === "bpmndi:BPMNPlane" } };
  out.planeNoDi = { id: sp.id + "_plane", type: sp.$type, businessObject: sp };
  return out;
}

test("C19: a collapsed sub-process opens the panel on its node, at the level it is drawn on", async () => {
  const el = await subElements();
  assert.deepStrictEqual(L.elementAction(el.node_2_Save), { kind: "task", name: "Save order", path: [] });
  assert.deepStrictEqual(L.elementAction(el.Sub1_node_2_Check), { kind: "task", name: "Check the price", path: ["Save order"] });
});

test("C19: a task in a sub-process's plane opens the panel at that level: the names of the sub-processes around it", async () => {
  const el = await subElements();
  assert.deepStrictEqual(L.elementAction(el.Sub1_node_1_Enter), { kind: "task", name: "Enter Product code", path: ["Save order"] });
  assert.deepStrictEqual(L.elementAction(el.Sub2_node_1_Call), { kind: "task", name: "Call the supplier", path: ["Save order", "Check the price"] });
});

test("C19: a file and a note in a plane work as on the main map, their ids read without the plane's prefix; the plane's legend takes no click", async () => {
  const el = await subElements();
  assert.deepStrictEqual(L.elementAction(el["Sub1_DataObjectReference_att-1"]), { kind: "file", id: "att-1", file: "order spec.txt" });
  assert.deepStrictEqual(L.elementAction(el.Sub1_TextAnnotation_1), { kind: "note", text: "Check the stock first." });
  assert.strictEqual(L.isLegend(el.Sub1_TextAnnotation_legend), true);
  assert.strictEqual(L.elementAction(el.Sub1_TextAnnotation_legend), null);
  assert.strictEqual(L.isLegend(el.Sub1_TextAnnotation_1), false);
});

test("C19: a click on the canvas of a sub-process's plane (its root, whose business object is the sub-process) does nothing", async () => {
  const el = await subElements();
  assert.strictEqual(L.elementAction(el.plane), null);
  assert.strictEqual(L.elementAction(el.planeNoDi), null, "known by its id too");
});

const sub = (id, name, subs, extra) => Object.assign({ step_id: id, name, process_label: name, state: "manually_authored",
  time_range: null, order: 1 }, subs ? { sub_steps: subs } : {}, extra || {});

test("C19: projectPath reads the names on the map as the project's sub-processes, level by level", () => {
  const txs = [
    [sub("a", "Search", null, { order: 1 }),
      sub("b", "Save  order", [sub("b1", "Enter Product code", null, { order: 1 }),
        sub("b2", "Check the price", [sub("b21", "Call the supplier")], { order: 2 })], { order: 2, process_label: "Save order" })],
    [sub("c", "Save order", [sub("c1", "Look it up")], { order: 1, process_label: "Save order" })],
  ];
  assert.deepStrictEqual(L.projectPath([], txs), []);
  assert.deepStrictEqual(L.projectPath(["Save order"], txs), ["Save order"]);
  assert.deepStrictEqual(L.projectPath(["Save order", "Check the price"], txs), ["Save order", "Check the price"]);
  // Whitespace as bpmn-js may keep it.
  assert.deepStrictEqual(L.projectPath([" Save\norder "], txs), ["Save order"]);
  // A name no sub-process of the project has at its level: added or renamed
  // in the editor, a step that is no sub-process, or the wrong level.
  assert.strictEqual(L.projectPath(["Save the order"], txs), null);
  assert.strictEqual(L.projectPath(["Search"], txs), null);
  assert.strictEqual(L.projectPath(["Check the price"], txs), null);
  assert.strictEqual(L.projectPath(["Save order", "Enter Product code"], txs), null);
  // A hidden sub-process has no map.
  const hidden = [[sub("h", "Save order", [sub("h1", "x")], { state: "hidden" })]];
  assert.strictEqual(L.projectPath(["Save order"], hidden), null);
});

/* ---- The task to its step: the node rule of the live map ------------------ */

const draft = (id, name, extra) => Object.assign({ step_id: id, name, state: "auto_suggested", draft_key: "chrome|x|" + id }, extra || {});
const RUNS = [
  [
    draft("a1", "Salesforce" + SEP + "Account lookup: Look up the customer"),
    draft("a2", "Salesforce" + SEP + "Order: Save order"),
    { step_id: "a3", name: "Call the customer back", state: "manually_authored", process_label: "Call the customer back", time_range: null },
    draft("a4", "Notepad" + SEP + "Internal mappings.txt", { state: "hidden" }),
  ],
  [
    draft("b1", "Salesforce" + SEP + "Account lookup: Look up the customer"),
    { step_id: "b2", name: "Search " + EM + " CUST-10852", state: "edited" },
  ],
];

test("a task stands for the steps whose map box is its name: the box as the live map names it", () => {
  assert.strictEqual(L.taskNode("Salesforce" + SEP + "Order: Save order", RUNS), "Salesforce" + SEP + "Order: Save order");
  assert.strictEqual(L.taskNode("Call the customer back", RUNS), "Call the customer back", "a step added by hand");
  // Whitespace as bpmn-js may keep it (a name on two lines) finds the box.
  assert.strictEqual(L.taskNode("  Call the customer\nback ", RUNS), "Call the customer back");
  // A renamed draft is its name, never the name the value rules would cut it to.
  assert.strictEqual(L.taskNode("Salesforce" + SEP + "Account lookup: Look up the customer", RUNS),
    "Salesforce" + SEP + "Account lookup: Look up the customer");
  assert.strictEqual(L.taskNode("Salesforce", RUNS), null);
  // A step that is no draft groups by its name without the case value, as on
  // the live map: its task is "Search".
  assert.strictEqual(L.taskNode("Search", RUNS), "Search");
  assert.strictEqual(L.taskNode("Search " + EM + " CUST-10852", RUNS), null);
});

test("a task no step stands for matches nothing: added or renamed in the map, a hidden step, no name", () => {
  assert.strictEqual(L.taskNode("Added in the editor", RUNS), null);
  assert.strictEqual(L.taskNode("Notepad" + SEP + "Internal mappings.txt", RUNS), null, "the step is hidden");
  assert.strictEqual(L.taskNode("", RUNS), null);
  assert.strictEqual(L.taskNode(null, RUNS), null);
  assert.strictEqual(L.taskNode("Call the customer back", null), null);
});

/* ---- The data object to its attachment ------------------------------------ */

const ATTS = [
  { id: "att-1", file: "order spec.txt", label: "Order spec", step_id: "a2" },
  { id: "f/7 9", file: "rates.xlsx", label: "Rates", step_id: "a2" },
  { id: "att-3", file: "", label: "no file" },
  { id: "att-4", file: "mail.msg", label: "Mail", step_id: null },
];

test("a data object opens the attachment with its id, else the id the pipeline's key names, else the one with its file", () => {
  const file = (id, f) => ({ kind: "file", id, file: f });
  assert.strictEqual(L.attachmentFor(file("att-1", "order spec.txt"), ATTS), ATTS[0]);
  assert.strictEqual(L.attachmentFor(file("f_7_9", "rates.xlsx"), ATTS), ATTS[1], "the pipeline's XML safe key of the id");
  assert.strictEqual(L.attachmentFor(file("att-9", "mail.msg"), ATTS), ATTS[3], "attached again under another id: the file finds it");
  assert.strictEqual(L.attachmentFor(file("", "order spec.txt"), ATTS), ATTS[0]);
  assert.strictEqual(L.attachmentFor(file("att-1", ""), ATTS), ATTS[0]);
});

test("a data object whose attachment is gone, or that names none, opens nothing", () => {
  assert.strictEqual(L.attachmentFor({ kind: "file", id: "att-8", file: "gone.pdf" }, ATTS), null);
  assert.strictEqual(L.attachmentFor({ kind: "file", id: "att-3", file: "" }, ATTS), null, "an entry without a file");
  assert.strictEqual(L.attachmentFor({ kind: "file", id: "att-1", file: "order spec.txt" }, null), null);
  assert.strictEqual(L.attachmentFor({ kind: "note", text: "x" }, ATTS), null);
  assert.strictEqual(L.attachmentFor(null, ATTS), null);
});
