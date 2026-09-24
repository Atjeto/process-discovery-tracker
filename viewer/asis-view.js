"use strict";

/*
 * asis-view.js: the map the PDD prints, on the Map level (contract C18,
 * AD-32; lane MV): the As-Is copy chosen for the PDD, else
 * process_map_step.bpmn (map-view.js decides which). It is drawn by bpmn-js,
 * read only (its navigated viewer: drag to pan, Ctrl and the wheel to zoom,
 * as in the editor), fitted when drawn, with the exclusive gateways' marker
 * as the editor and the PDD's picture draw it, and as linked as the map from
 * the transactions (asis-links.js says what each click does):
 *   a task opens the step panel on the step it stands for, or says in the
 *     panel that no step has its name;
 *   a data object opens its attachment through the safe open path
 *     (analyst-ui.openAttachment, then main's viewer:openAttachment);
 *   a note shows its whole text in a small popover (#map-asis-note);
 *   the legend is part of the picture: no pointer, no click.
 * Contract C19: a map with sub-processes has one plane per sub-process
 * (map-planes.js). The view shows the plane of the level chosen (showLevel;
 * a plane shown for the first time is fitted, one shown before comes back as
 * it was left), a task in a plane opens the panel at that level, a collapsed
 * sub-process opens the panel on its node, and bpmn-js's own drill down (the
 * arrow on a sub-process, the breadcrumbs above a plane) tells the Map the
 * level it went to (configure's onLevel).
 * Editing stays in the editor (refmap-ui.js); refmap-ui.syncMapView decides
 * when this view draws and which level it shows.
 */

const State = require("./state.js");
const RunsModel = require("./runs-model.js");
const Links = require("./asis-links.js");
const SPM = require("./sub-process-maps.js");
const Planes = require("./map-planes.js");
const { toast } = require("./dom.js");

let _viewer = null;     // the navigated viewer on screen
let _host = null;       // its host (#map-asis-canvas)
let _observer = null;   // the host's size, so the canvas knows it
let _pop = null;        // the note popover
let _fitted = new Map(); // per plane (its root), the view right after its last fit: { x, y, scale }
let _ready = false;     // the map is drawn (its import is done)
let _main = null;       // the main map's root
let _quiet = false;     // a plane this module shows: not the analyst's drill down
let _cfg = {};          // { onLevel(names), mainName() } (configure)

/* The bpmn-js navigated viewer. The page's global BpmnJS is the modeler (the
   editor); this is the read only viewer of the same bpmn-js version, loaded
   on first use. */
let _Viewer = null;
function _viewerClass() {
  if (!_Viewer) _Viewer = require("bpmn-js/dist/bpmn-navigated-viewer.production.min.js");
  return _Viewer;
}

/* ---- Clicks ---------------------------------------------------------------- */

/* A task (or a collapsed sub-process): the step panel on its step (the node
   rule of the live map) at the level its plane is (C19: `names`, the names
   of the sub-processes around it), or the panel's one line when no step of
   the transactions has the task's name there. */
function _openTask(name, names) {
  const s = State.getSession();
  if (!s) return;
  const runs = RunsModel.buildRuns(s.stats, (s.annotations && s.annotations.steps) || []).runs;
  const txs = runs.map((r) => r.members);
  const path = Links.projectPath(names, txs);
  const lists = !path ? [] : path.length ? SPM.levelVisits(txs, path).map((v) => v.visible) : runs.map((r) => r.visible);
  const node = Links.taskNode(name, lists);
  const Panel = require("./views/step-panel.js");
  if (node != null) Panel.openForNode(node, path);
  else Panel.openForMissing(name);
}

/* A data object: its attachment, opened as the step pane opens it. */
function _openFile(action) {
  const s = State.getSession();
  if (!s) return;
  const att = Links.attachmentFor(action, (s.annotations || {}).attachments);
  if (!att) { toast("This file is not attached to the project.", "error"); return; }
  require("./views/analyst-ui.js").openAttachment(att.id);
}

function _onClick(e) {
  const action = Links.elementAction(e && e.element);
  if (!action || action.kind !== "note") hideNote();
  if (!action) return;
  if (action.kind === "task") _openTask(action.name, action.path);
  else if (action.kind === "file") _openFile(action);
  else if (action.kind === "note") _showNote(action.text, e.originalEvent);
}

/* ---- The note popover ---------------------------------------------------- */

function _onKey(e) {
  if (e.key === "Escape") hideNote();
}

function _showNote(text, ev) {
  if (!_host) return;
  hideNote();
  const pop = document.createElement("div");
  pop.className = "map-asis-pop";
  pop.id = "map-asis-note";
  pop.setAttribute("role", "note");
  const p = document.createElement("p");
  p.className = "map-asis-pop-text";
  p.textContent = text;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-btn xs map-asis-pop-close";
  close.title = "Close the note";
  close.setAttribute("aria-label", "Close the note");
  close.textContent = "✕";
  close.addEventListener("click", () => hideNote());
  pop.append(p, close);
  _host.appendChild(pop);
  _pop = pop;
  // Beside the click, inside the map.
  const box = _host.getBoundingClientRect();
  const x = ev && Number.isFinite(ev.clientX) ? ev.clientX - box.left : 16;
  const y = ev && Number.isFinite(ev.clientY) ? ev.clientY - box.top : 16;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(x + 12, _host.clientWidth - w - 8)) + "px";
  pop.style.top = Math.max(8, Math.min(y + 12, _host.clientHeight - h - 8)) + "px";
  document.addEventListener("keydown", _onKey);
}

/* Close the note popover (a click elsewhere, Esc, pan or zoom, a redraw). */
function hideNote() {
  if (_pop) { _pop.remove(); _pop = null; }
  document.removeEventListener("keydown", _onKey);
}

/* ---- The canvas ------------------------------------------------------------ */

/* Take the map down (another project, no As-Is copy, before a redraw). */
function clear() {
  hideNote();
  if (_observer) { try { _observer.disconnect(); } catch (_) { /* gone */ } _observer = null; }
  if (_viewer) { try { _viewer.destroy(); } catch (_) { /* gone */ } _viewer = null; }
  if (_host) { try { delete _host.__bpmnViewer; } catch (_) { /* a plain property */ } _host.innerHTML = ""; }
  _host = null;
  _fitted = new Map();
  _ready = false;
  _main = null;
}

/* Whether the map is drawn (or drawing) in `host`. */
function drawnIn(host) {
  return !!(_viewer && _host && _host === host);
}

/* The plane on screen in view. */
function fit() {
  if (!_viewer || !_host || !_host.clientWidth) return;
  try {
    const canvas = _viewer.get("canvas");
    canvas.zoom("fit-viewport", "auto");
    const vb = canvas.viewbox();
    _fitted.set(canvas.getRootElement(), { x: vb.x, y: vb.y, scale: vb.scale });
  } catch (_) { /* no diagram yet */ }
}

/* The host changed size (the step panel beside it, the window, the Map
   shown again): the canvas takes the new size, and a plane nobody moved
   since it was fitted (or never fitted, drawn while hidden) is fitted again. */
function _resized() {
  if (!_viewer) return;
  hideNote();
  let vb = null, root = null;
  try {
    const canvas = _viewer.get("canvas");
    canvas.resized();
    vb = canvas.viewbox();
    root = canvas.getRootElement();
  } catch (_) { return; }
  const f = _fitted.get(root);
  const still = f && Math.abs(vb.x - f.x) < 0.5 && Math.abs(vb.y - f.y) < 0.5 && Math.abs(vb.scale - f.scale) < 1e-6;
  if (!f || still) fit();
}

/* ---- The planes (C19) -------------------------------------------------------- */

/* { onLevel(names), mainName() }: onLevel hears the path of names of the
   plane bpmn-js's own drill down went to; mainName names the main map's
   crumb above a plane when the process has no name of its own. */
function configure(cfg) {
  _cfg = cfg || {};
}

/* The root of the plane of the map at `path` ([] the main map), or null when
   the map drawn has none (map-planes.findPlane) or is not drawn yet. */
function _rootFor(path) {
  if (!_viewer || !_ready) return null;
  if (!Array.isArray(path) || !path.length) return _main;
  const id = Planes.findPlane(_viewer.getDefinitions(), path);
  return id ? _viewer.get("canvas").findRoot(id + "_plane") || null : null;
}

/* Whether the map drawn has a plane for the map at `path`: true or false;
   null while no map is drawn. */
function hasLevel(path) {
  if (!_viewer || !_ready) return null;
  return !!_rootFor(path);
}

/* bpmn-js names the main map's crumb above a plane by the process's id when
   the process has no name ("Process_1"): it reads the main map's name. */
function _nameCrumbs() {
  const a = _host && _host.querySelector(".bjs-breadcrumbs li:first-child .bjs-crumb a");
  const bo = _main && _main.businessObject;
  if (!a || !bo || bo.name || a.textContent !== bo.id) return;
  const name = typeof _cfg.mainName === "function" ? String(_cfg.mainName() || "") : "";
  if (name) { a.textContent = name; a.title = name; }
}

/* Show the plane of the map at `path`: one shown for the first time is
   fitted, one shown before comes back as it was left (bpmn-js keeps each
   plane's view). False when the map drawn has no such plane. */
function showLevel(path) {
  const root = _rootFor(path);
  if (!root) return false;
  const canvas = _viewer.get("canvas");
  if (canvas.getRootElement() !== root) {
    _quiet = true;
    try { canvas.setRootElement(root); } finally { _quiet = false; }
    hideNote();
    if (!_fitted.has(root)) fit();
    _nameCrumbs();
  }
  return true;
}

/* bpmn-js's own drill down (the arrow on a collapsed sub-process, a crumb
   above a plane): a plane shown for the first time is fitted, and the Map
   hears the path of names it went to. */
function _rootSet(e) {
  if (_quiet) return;
  hideNote();
  const root = e && e.element;
  if (root && !_fitted.has(root)) fit();
  _nameCrumbs();
  if (typeof _cfg.onLevel !== "function") return;
  try { _cfg.onLevel(Planes.pathOfRoot(root)); }
  catch (err) { console.error("[asis-view] the Map did not follow the plane shown:", err); }
}

/* Mark what a click opens (a pointer) and the legend (clicks go through it
   to the canvas, which pans). */
function _mark(v) {
  const canvas = v.get("canvas");
  for (const el of v.get("elementRegistry").getAll()) {
    if (Links.isLegend(el)) canvas.addMarker(el, "pdt-inert");
    else if (Links.elementAction(el)) canvas.addMarker(el, "pdt-link");
  }
}

/* An exclusive gateway whose diagram says nothing of its marker shows the
   marker, as the editor and the PDD's picture draw it (both are bpmn-js's
   modeler, which sets it on import; its viewer leaves the diamond empty). */
function _gatewayMarkers(v) {
  const reg = v.get("elementRegistry");
  const graphics = v.get("graphicsFactory");
  for (const el of reg.filter((e) => e.type === "bpmn:ExclusiveGateway")) {
    const di = el.di;
    if (!di || Object.prototype.hasOwnProperty.call(di, "isMarkerVisible")) continue;
    di.isMarkerVisible = true;
    const gfx = reg.getGraphics(el);
    if (gfx) graphics.update("shape", el, gfx);
  }
}

/* The drawn map's definitions (bpmn-moddle's objects, which outlive the
   view: map-planes.js finds a plane in them), or null while none is drawn. */
function definitions() {
  if (!_viewer || !_ready) return null;
  try { return _viewer.getDefinitions() || null; } catch (_) { return null; }
}

/* Draw `xml` into `host`, read only and fitted, on the plane of the map at
   `path` when it has one (C19; else its main map). Resolves true once it is
   drawn; false when it could not be (the host says why), or when another
   draw or a clear came first. */
async function draw(host, xml, path) {
  clear();
  if (!host) return false;
  _host = host;
  const fail = (why) => {
    console.error("[asis-view] the As-Is map could not be drawn:", why);
    host.innerHTML = '<div class="map-empty-inline"></div>';
    host.firstChild.textContent = "The As-Is map could not be drawn: " + String(why).replace(/[.\s]+$/, "") + ".";
    return false;
  };
  if (!xml) return fail("its file could not be read");
  let Viewer;
  try { Viewer = _viewerClass(); } catch (e) { return fail("bpmn-js did not load (" + ((e && e.message) || e) + ")"); }
  const mount = document.createElement("div");
  mount.className = "map-asis-mount";
  host.appendChild(mount);
  const v = new Viewer({ container: mount });
  _viewer = v;
  try {
    await v.importXML(xml);
  } catch (e) {
    if (_viewer !== v) return false;
    try { v.destroy(); } catch (_) { /* gone */ }
    _viewer = null;
    host.innerHTML = "";
    return fail((e && e.message) || String(e));
  }
  if (_viewer !== v) return false;
  _main = v.get("canvas").getRootElement();
  _ready = true;
  try { _gatewayMarkers(v); } catch (e) { console.error("[asis-view] the gateways' markers were not drawn:", e); }
  _mark(v);
  if (!(Array.isArray(path) && path.length && showLevel(path))) fit();
  v.on("element.click", _onClick);
  v.on("canvas.viewbox.changing", hideNote);
  v.on("root.set", _rootSet);
  if (typeof ResizeObserver === "function") {
    _observer = new ResizeObserver(() => { if (_viewer === v) _resized(); });
    _observer.observe(host);
  }
  host.__bpmnViewer = v;   // test handle, as the editor's host has
  return true;
}

module.exports = { draw, clear, drawnIn, fit, hideNote, configure, hasLevel, showLevel, definitions };
