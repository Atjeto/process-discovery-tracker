"use strict";

/*
 * asis-links.js: what a click on the As-Is map does (contract C18, AD-32).
 * The As-Is copy chosen for the PDD shows on the Map level drawn by bpmn-js
 * (asis-view.js), as linked as the map from the transactions:
 *   a task opens the step panel on the step it stands for: a step of the
 *     transactions whose map box (process-map-levels.mapNodeLabel, the node
 *     rule of the live map) is the task's name;
 *   a data object opens its attachment: the pipeline names it
 *     DataObjectReference_<attachment id> and ends its documentation with
 *     "attachments/<file>" (mining.export_bpmn);
 *   a text annotation shows its note: its documentation holds the whole text
 *     when the map shows it cut, else its text is the whole note; a step's
 *     exceptions (C27: TextAnnotation_exc_<k> under a task) show the same
 *     way, their documentation "When <when>: <then>" per entry;
 *   a system label (2.0.1: TextAnnotation_system_<k> above a task, or a
 *     map's one TextAnnotation_system), a Done by label (C25:
 *     TextAnnotation_doneby_<k> under a task, or TextAnnotation_doneby),
 *     the legend of a copy made before
 *     2.0.1 (TextAnnotation_legend), the flows, the events and the gateways
 *     do nothing.
 * Contract C19: a map with sub-processes has a plane per sub-process
 * (map-planes.js). A collapsed sub-process opens the panel on its node, and
 * a task inside a sub-process's plane on its node at that level (the names
 * of the sub-processes around it, matched to the project's own sub-processes
 * by projectPath). The ids inside a plane carry its prefix ("Sub2_"), so the
 * data object and legend ids are read without it.
 * Pure: no DOM and no bpmn-js. An element is a bpmn-js diagram element (or a
 * business object), and its type is matched with is(), as bpmn-js matches it,
 * so a plain task, a manual task and the user task of a copy made before lane
 * CL (every recorded step was one) are all tasks.
 */

const { mapNodeLabel } = require("./process-map-levels.js");
const SPM = require("./sub-process-maps.js");
const Planes = require("./map-planes.js");

const LEGEND_ID = "TextAnnotation_legend";
/* A system label the pipeline writes (2.0.1): above a task, or the one label
   of a map done in one system; and (C25) a Done by label: under a task, or
   the one label of a map done by one role or person. */
const SYSTEM_ID = /^TextAnnotation_(?:system|doneby)(?:_\d+)?$/;
const DATA_PREFIX = "DataObjectReference_";
/* The id the pipeline gives the text annotation of a step's notes (C18,
   mining.py: TextAnnotation_1, TextAnnotation_2, ...; in a sub-process's
   plane with its prefix). The legend is TextAnnotation_legend, and one the
   analyst draws in the map editor gets bpmn-js's own id. */
const NOTE_ID = /^TextAnnotation_\d+$/;
/* C27: the text annotation of a step's exceptions (mining.py:
   TextAnnotation_exc_1, ...; in a sub-process's plane with its prefix). It
   is the process, not the analyst's working note: the PDD's pictures keep it
   (never isStepNote). */
const EXCEPTION_ID = /^TextAnnotation_exc_\d+$/;

/* bpmn-js's is(): the element's business object is an instance of `type`. */
function is(element, type) {
  const bo = (element && element.businessObject) || element;
  return !!(bo && typeof bo.$instanceOf === "function" && bo.$instanceOf(type));
}

function _bo(element) {
  return (element && element.businessObject) || element || {};
}

/* A text as one line, its whitespace collapsed ("" for a non string). */
function _line(v) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/* Windows line ends read as one new line. */
function _lines(v) {
  return typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "";
}

/* An element's documentation as one text, its entries on their own lines. */
function documentation(element) {
  const docs = _bo(element).documentation;
  return (Array.isArray(docs) ? docs : [])
    .map((d) => _lines(d && d.text)).filter(Boolean).join("\n");
}

/* The legend of the systems' colours on a copy made before 2.0.1: part of
   the picture, never a link (a sub-process's plane has its own, its id
   prefixed). */
function isLegend(element) {
  return is(element, "bpmn:TextAnnotation") && Planes.baseId(_bo(element).id) === LEGEND_ID;
}

/* A system label (2.0.1) or a Done by label (C25): part of the picture,
   never a link. The analyst changes it by typing in the map editor. */
function isSystemLabel(element) {
  return is(element, "bpmn:TextAnnotation") && SYSTEM_ID.test(Planes.baseId(_bo(element).id));
}

/* A step's notes on the map (C18): the text annotation the pipeline wrote
   for them, never the legend or one the analyst drew in the editor. Lane
   FX2: the PDD's pictures of the maps leave these out, with the lines that
   join them to their tasks (refmap-ui.js), since notes stay in the app; the
   Map on screen keeps them. */
function isStepNote(element) {
  return is(element, "bpmn:TextAnnotation") && NOTE_ID.test(Planes.baseId(_bo(element).id));
}

/* C27: a step's exceptions on the map. A click shows their whole text, as
   a note's does; the PDD's pictures keep them. */
function isException(element) {
  return is(element, "bpmn:TextAnnotation") && EXCEPTION_ID.test(Planes.baseId(_bo(element).id));
}

/* The root of a plane: bpmn-js draws a sub-process's map on a root whose
   business object is the sub-process ("<id>_plane"). A click there is a
   click on the canvas. */
function _isPlaneRoot(element) {
  const bo = _bo(element);
  if (!element || element === bo) return false;
  const di = element.di;
  if (di && typeof di.$instanceOf === "function" && di.$instanceOf("bpmndi:BPMNPlane")) return true;
  return typeof element.id === "string" && typeof bo.id === "string" && element.id === bo.id + "_plane";
}

/* What a click on `element` does:
     { kind: "task", name, path } open the step panel on the task's step, at
                                  the level `path` names (the names of the
                                  sub-processes around it, [] on the main
                                  map); a collapsed sub-process is a task
                                  too, at the level it is drawn on;
     { kind: "file", id, file }   open the attachment (the id from the
                                  element's id, the file from its
                                  documentation; either may be "");
     { kind: "note", text }       show the note's whole text;
   or null: nothing (the legend, a flow, an event, a gateway, the canvas, a
   data object that names no attachment, an empty note). */
function elementAction(element) {
  if (!element || _isPlaneRoot(element)) return null;
  const bo = _bo(element);
  if (is(element, "bpmn:Task") || is(element, "bpmn:SubProcess")) {
    return { kind: "task", name: _line(bo.name), path: Planes.levelOf(bo) };
  }
  if (is(element, "bpmn:DataObjectReference")) {
    const own = Planes.baseId(bo.id);
    const id = own.startsWith(DATA_PREFIX) ? own.slice(DATA_PREFIX.length) : "";
    const last = documentation(element).split("\n").pop() || "";
    const m = /^attachments[\\/]+(.+)$/.exec(last.trim());
    const file = m ? m[1].trim() : "";
    return id || file ? { kind: "file", id, file } : null;
  }
  if (is(element, "bpmn:TextAnnotation")) {
    if (isLegend(element) || isSystemLabel(element)) return null;
    const text = documentation(element) || _lines(bo.text);
    return text ? { kind: "note", text } : null;
  }
  return null;
}

/* The map box a task stands for: the box (mapNodeLabel) of a step of the
   runs that is the task's name, whitespace collapsed on both sides; null
   when no step has it (a task added or renamed in the map, or a step renamed
   or hidden since the copy was made). `runs`: one array of steps per run
   (hidden steps are left out here too). */
function taskNode(name, runs) {
  const want = _line(name);
  if (!want) return null;
  for (const run of Array.isArray(runs) ? runs : []) {
    for (const st of Array.isArray(run) ? run : []) {
      if (!st || st.state === "hidden") continue;
      const node = mapNodeLabel(st);
      if (_line(node) === want) return node;
    }
  }
  return null;
}

/* The project's level for a path of names read on the As-Is map (the names
   of the sub-processes around a task, or the path of a plane): at each
   level, the node of a visible step there that is a sub-process and whose
   node is the name, whitespace collapsed on both sides; null when a name is
   no sub-process of the project at its level (one added or renamed in the
   editor, or dissolved since the copy was made). `transactions`: each
   transaction's main-level steps (sub-process-maps.js). */
function projectPath(names, transactions) {
  const out = [];
  for (const name of Array.isArray(names) ? names : []) {
    const want = _line(name);
    let hit = null;
    for (const v of SPM.levelVisits(transactions, out)) {
      const st = v.visible.find((s) => SPM.isSubProcess(s) && _line(mapNodeLabel(s)) === want);
      if (st) { hit = mapNodeLabel(st); break; }
    }
    if (hit == null) return null;
    out.push(hit);
  }
  return out;
}

/* The pipeline's key for an attachment id in an element id
   (bpmn_observed._data_objects: an XML-safe id of at most 40 characters). */
function _idKey(id) {
  return String(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
}

/* The last part of a file path. */
function _fileName(v) {
  return typeof v === "string" ? v.trim().split(/[\\/]/).pop() : "";
}

/* The attachment a data object opens: the project's attachment with its id,
   else the one whose id the pipeline's key names, else the one with its
   file; null when none is attached any more. */
function attachmentFor(action, attachments) {
  if (!action || action.kind !== "file") return null;
  const list = (Array.isArray(attachments) ? attachments : [])
    .filter((a) => a && typeof a.id === "string" && a.id && _fileName(a.file));
  if (action.id) {
    const exact = list.find((a) => a.id === action.id);
    if (exact) return exact;
    const keyed = list.filter((a) => _idKey(a.id) === action.id);
    const both = keyed.find((a) => action.file && _fileName(a.file) === action.file);
    if (both || keyed.length === 1) return both || keyed[0];
  }
  return (action.file && list.find((a) => _fileName(a.file) === action.file)) || null;
}

module.exports = { LEGEND_ID, is, documentation, isLegend, isSystemLabel, isStepNote, isException, elementAction, taskNode, projectPath, attachmentFor };
