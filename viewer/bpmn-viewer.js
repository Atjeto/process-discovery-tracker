/*
 * BPMN renderer using bpmn-js. Loads the MODELER bundle (the BpmnJS global from
 * dist/bpmn-modeler.production.min.js) so the analyst can DRAG boxes to nudge the
 * layout; the editor palette/context-pad are hidden in CSS so it's a move-only
 * tool. The mined file's own coordinates are poor, so after import we re-lay-out
 * the diagram with DAGRE -- the same layered, crossing-minimised engine that lays
 * out the Flow diagram (DFG) cleanly -- as a readable starting point. That auto
 * layout is made the baseline (the command stack is cleared) so only the
 * analyst's own drags count as edits and persist back to the .bpmn.
 *
 * Reads an exported `process_map*.bpmn` and renders it into the host element.
 * Falls back gracefully if bpmn-js failed to load.
 */

"use strict";

(function () {
  let viewer = null;
  let saveTimer = null;  // debounce for persisting a dragged layout
  const fs = require("node:fs");

  /* Re-position every node with dagre (layered, crossing-minimised) and re-route
     the sequence flows, replacing the mined file's weak coordinates. dagre is a
     global (loaded in index.html; the DFG uses it too). No-op + false if dagre
     or the modeling services are unavailable. */
  function applyDagreLayout(v) {
    if (typeof dagre === "undefined") return false;
    let modeling, elementRegistry, canvas;
    try {
      modeling = v.get("modeling");
      elementRegistry = v.get("elementRegistry");
      canvas = v.get("canvas");
    } catch (_) { return false; }
    const root = canvas.getRootElement();
    const nodes = elementRegistry.filter((e) =>
      e !== root && !e.waypoints && !e.labelTarget && e.parent &&
      typeof e.width === "number" && typeof e.x === "number");
    const edges = elementRegistry.filter((e) => e.waypoints && e.source && e.target);
    if (!nodes.length) return false;
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 90, marginx: 30, marginy: 30 });
    g.setDefaultEdgeLabel(() => ({}));
    nodes.forEach((n) => g.setNode(n.id, { width: n.width, height: n.height }));
    edges.forEach((e) => g.setEdge(e.source.id, e.target.id, {}, e.id));
    dagre.layout(g);
    // dagre reports node centres; bpmn-js positions by top-left. Move by delta.
    nodes.forEach((n) => {
      const gn = g.node(n.id);
      if (!gn) return;
      const dx = (gn.x - n.width / 2) - n.x;
      const dy = (gn.y - n.height / 2) - n.y;
      if (dx || dy) { try { modeling.moveShape(n, { x: dx, y: dy }); } catch (_) {} }
    });
    // Re-route every flow now that the nodes moved (orthogonal manhattan routing).
    edges.forEach((e) => { try { modeling.layoutConnection(e); } catch (_) {} });
    return true;
  }

  async function render(host, bpmnFilePath, opts) {
    opts = opts || {};
    host.innerHTML = "";
    if (typeof BpmnJS === "undefined") {
      host.innerHTML = '<div class="map-empty-inline">bpmn-js failed to load. ' +
        'The BPMN file is still on disk and importable into Adonis.</div>';
      return;
    }
    if (!bpmnFilePath || !fs.existsSync(bpmnFilePath)) {
      host.innerHTML = '<div class="map-empty-inline">no BPMN file yet</div>';
      return;
    }
    const xml = fs.readFileSync(bpmnFilePath, "utf-8");
    if (viewer) {
      try { viewer.destroy(); } catch (_) {}
      viewer = null;
    }
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    viewer = new BpmnJS({ container: host });
    try {
      const result = await viewer.importXML(xml);
      const warnings = (result && result.warnings) || [];
      // The mined coordinates are poor; re-lay-out with dagre, then make that the
      // baseline (clear undo) so neither the import nor the auto-layout counts as
      // an edit -- only the analyst's own drags do.
      try {
        applyDagreLayout(viewer);
        viewer.get("commandStack").clear();
      } catch (e) {
        console.warn("[bpmn] dagre layout failed; using the file's layout:", e && e.message);
      }
      viewer.get("canvas").zoom("fit-viewport", "auto");
      /* Persist the analyst's manual nudges back to the .bpmn (debounced),
         guarded on canUndo so neither the import nor the baseline auto-layout
         rewrites the file. A re-analyze regenerates + re-lays-out the map. */
      if (bpmnFilePath) {
        viewer.get("eventBus").on("commandStack.changed", () => {
          let edited = false;
          try { edited = !!(viewer && viewer.get("commandStack").canUndo()); } catch (_) { edited = false; }
          if (!edited) return;
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(async () => {
            saveTimer = null;
            if (!viewer) return;
            try {
              const { xml: out } = await viewer.saveXML({ format: true });
              if (out) fs.writeFileSync(bpmnFilePath, out, "utf-8");
            } catch (_) { /* best-effort; the in-memory layout still holds */ }
          }, 600);
        });
      }
      if (warnings.length) {
        const note = document.createElement("div");
        note.className = "bpmn-warning";
        note.textContent = `${warnings.length} BPMN parse warning(s) -- diagram may be imperfect.`;
        host.appendChild(note);
      }
      /* Drill-down: click a task / activity node to drill back to the source
         session at the matching activity. */
      if (opts.onNodeClick) {
        const eventBus = viewer.get("eventBus");
        eventBus.on("element.click", (e) => {
          const el = e.element;
          if (!el || !el.businessObject) return;
          const t = el.type || "";
          if (!t.includes("Task") && !t.includes("Activity") && !t.includes("CallActivity")) return;
          const label = el.businessObject.name || el.id;
          opts.onNodeClick(label);
        });
      }
    } catch (e) {
      host.innerHTML = '<div class="map-empty-inline">BPMN render failed: ' +
        (e && e.message ? e.message : String(e)) + '</div>';
    }
  }

  function fit() {
    if (viewer) {
      try { viewer.get("canvas").zoom("fit-viewport", "auto"); } catch (_) {}
    }
  }

  /* Current zoom level (1 = 100%). Mirrors dfg-viewer.js's getZoom so
     the shared map-zoom controls can read either viewer. */
  function getZoom() {
    if (!viewer) return 1;
    try { return viewer.get("canvas").zoom() || 1; } catch (_) { return 1; }
  }

  function zoomIn() {
    if (!viewer) return;
    try { viewer.get("canvas").zoom(getZoom() * 1.25); } catch (_) {}
  }

  function zoomOut() {
    if (!viewer) return;
    try { viewer.get("canvas").zoom(getZoom() / 1.25); } catch (_) {}
  }

  /* Export the rendered diagram as SVG (Figma / Lucidchart / browser
     all import SVG). bpmn-js's saveSVG returns a Promise<{ svg }>. */
  async function exportSvg() {
    if (!viewer) return null;
    try {
      const { svg } = await viewer.saveSVG();
      return svg || null;
    } catch (_) { return null; }
  }

  module.exports = { render, fit, zoomIn, zoomOut, getZoom, exportSvg };
})();
