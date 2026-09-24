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
 *     when the map shows it cut, else its text is the whole note;
 *   the legend (TextAnnotation_legend), the flows, the events and the
 *     gateways do nothing.
 * Pure: no DOM and no bpmn-js. An element is a bpmn-js diagram element (or a
 * business object), and its type is matched with is(), as bpmn-js matches it,
 * so a user task and a manual task are tasks.
 */

const { mapNodeLabel } = require("./process-map-levels.js");

const LEGEND_ID = "TextAnnotation_legend";
const DATA_PREFIX = "DataObjectReference_";

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

/* The legend of the systems' colours: part of the picture, never a link. */
function isLegend(element) {
  return is(element, "bpmn:TextAnnotation") && _bo(element).id === LEGEND_ID;
}

/* What a click on `element` does:
     { kind: "task", name }       open the step panel on the task's step;
     { kind: "file", id, file }   open the attachment (the id from the
                                  element's id, the file from its
                                  documentation; either may be "");
     { kind: "note", text }       show the note's whole text;
   or null: nothing (the legend, a flow, an event, a gateway, the canvas, a
   data object that names no attachment, an empty note). */
function elementAction(element) {
  if (!element) return null;
  const bo = _bo(element);
  if (is(element, "bpmn:Task")) {
    return { kind: "task", name: _line(bo.name) };
  }
  if (is(element, "bpmn:DataObjectReference")) {
    const id = typeof bo.id === "string" && bo.id.startsWith(DATA_PREFIX) ? bo.id.slice(DATA_PREFIX.length) : "";
    const last = documentation(element).split("\n").pop() || "";
    const m = /^attachments[\\/]+(.+)$/.exec(last.trim());
    const file = m ? m[1].trim() : "";
    return id || file ? { kind: "file", id, file } : null;
  }
  if (is(element, "bpmn:TextAnnotation")) {
    if (isLegend(element)) return null;
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

module.exports = { LEGEND_ID, is, documentation, isLegend, elementAction, taskNode, attachmentFor };
