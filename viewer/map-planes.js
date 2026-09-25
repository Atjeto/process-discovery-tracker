"use strict";

/*
 * map-planes.js: the maps of one BPMN file (contract C19, AD-33). The step
 * BPMN (process_map_step.bpmn) holds one plane per map of the project: the
 * main map is the process's plane, and a sub-process is a collapsed
 * bpmn:subProcess named by its map node, whose map is drawn in a plane of
 * its own (the ids inside it prefixed "Sub<n>_", the main plane's not). An
 * As-Is copy made from it holds the same planes, unless the analyst renamed
 * or removed a sub-process in the editor, or made the copy before the
 * sub-process existed.
 *
 * A plane is found by its path of names from the main map down, as the
 * project's maps are (sub-process-maps.js mapTree paths): the process holds
 * a bpmn:SubProcess named N for [N], and that one a bpmn:SubProcess named M
 * for [N, M]. Names compare with their whitespace collapsed, as bpmn-js keeps
 * a name typed on two lines. A sub-process has a plane when a BPMN diagram
 * draws it (bpmn-js then makes it a root, "<id>_plane").
 *
 * With them: the id an element has without its plane's prefix, the PDD's
 * pictures of the maps (the manifest --pdd-map-images reads) and the name of
 * an exported map image.
 *
 * Pure: bpmn-moddle's objects (bpmn-js holds the same), no DOM.
 */

/* The prefix of the ids inside a sub-process's plane. */
const SUB_PREFIX = /^Sub\d+_/;

/* An id without its plane's prefix ("" for a non string). */
function baseId(id) {
  return typeof id === "string" ? id.replace(SUB_PREFIX, "") : "";
}

/* A name as one line, its whitespace collapsed ("" for a non string). */
function _line(v) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/* The moddle element's type is `type` (or extends it), as bpmn-js matches. */
function _is(bo, type) {
  return !!(bo && typeof bo.$instanceOf === "function" && bo.$instanceOf(type));
}

function _samePath(a, b) {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/* The level an element is at: the names of the sub-processes around it, the
   outermost first ([] on the main map). */
function levelOf(bo) {
  const out = [];
  for (let p = bo && bo.$parent; p && _is(p, "bpmn:SubProcess"); p = p.$parent) out.unshift(_line(p.name));
  return out;
}

/* The path of a sub-process's own map: its level and its name. */
function pathOf(bo) {
  return _is(bo, "bpmn:SubProcess") ? levelOf(bo).concat([_line(bo.name)]) : [];
}

/* The path of the plane a bpmn-js root element draws: a sub-process's root
   carries the sub-process as its business object; the process's is []. */
function pathOfRoot(root) {
  return pathOf(root && root.businessObject);
}

/* Every sub-process of the file's processes, depth first, each with its
   path: [{ id, path, element }]. */
function subProcesses(definitions) {
  const out = [];
  const walk = (container) => {
    for (const el of (container && container.flowElements) || []) {
      if (!_is(el, "bpmn:SubProcess")) continue;
      out.push({ id: el.id, path: pathOf(el), element: el });
      walk(el);
    }
  };
  for (const root of (definitions && definitions.rootElements) || []) if (_is(root, "bpmn:Process")) walk(root);
  return out;
}

/* Whether a BPMN diagram of the file draws the element with this id. */
function hasDiagram(definitions, id) {
  return ((definitions && definitions.diagrams) || []).some((d) => {
    const el = d && d.plane && d.plane.bpmnElement;
    return !!el && typeof id === "string" && el.id === id;
  });
}

/* The id of the sub-process whose plane is the map at `path` (a list of map
   nodes, [] the main map), or null: the main map has no sub-process, and a
   path no drawn sub-process has (one only in the project, or renamed in the
   editor) finds none. Of two sub-processes with one path (a node on the map
   twice), the one with a plane. */
function findPlane(definitions, path) {
  const want = (Array.isArray(path) ? path : []).map(_line);
  if (!want.length) return null;
  const hit = subProcesses(definitions).find((sp) => _samePath(sp.path, want) && hasDiagram(definitions, sp.id));
  return hit ? hit.id : null;
}

/* ---- The PDD's pictures of the maps --------------------------------------- */

/* The maps the PDD gives a chapter of their own (a sub-process's map with a
   number, contract C19), in the order of `tree` (sub-process-maps.mapTree):
   [{ path, number }]. The main map keeps its own picture (--pdd-map-image). */
function pddMaps(tree) {
  return (Array.isArray(tree) ? tree : [])
    .filter((m) => m && Array.isArray(m.path) && m.path.length && m.number != null)
    .map((m) => ({ path: m.path.slice(), number: m.number }));
}

/* The manifest the pipeline reads (--pdd-map-images): { maps: [{ path, png
   }] } for the pictures that were drawn (`pictures`: [{ path, png }], png a
   file name beside the manifest, or empty for a map with no picture, which
   the PDD then prints as a table). */
function pddManifest(pictures) {
  return {
    maps: (Array.isArray(pictures) ? pictures : [])
      .filter((p) => p && Array.isArray(p.path) && typeof p.png === "string" && p.png.trim())
      .map((p) => ({ path: p.path.slice(), png: p.png.trim() })),
  };
}

/* The file name an exported map image is offered under: `base` (lane FX3:
   the project's name and the map's kind, "Order to cash map", "Order to
   cash As-Is map") for the main map, and for a sub-process's map its number
   when it has one ("Order to cash map of sub-process 2.4.svg"). */
function imageName(base, level) {
  const path = (level && level.path) || [];
  if (!path.length) return base + ".svg";
  const n = level && level.number != null ? String(level.number) : "";
  return base + (n ? " of sub-process " + n : " of a sub-process") + ".svg";
}

module.exports = {
  SUB_PREFIX, baseId, levelOf, pathOf, pathOfRoot, subProcesses, hasDiagram, findPlane,
  pddMaps, pddManifest, imageName,
};
