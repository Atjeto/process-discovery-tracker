/*
 * BPMN renderer using bpmn-js. We load the MODELER bundle
 * (dist/bpmn-modeler.production.min.js, still exposed as the BpmnJS global),
 * not the read-only Viewer, so the analyst can DRAG the boxes to reorganize
 * the auto-laid-out map. The editor chrome (palette, context pad) is hidden in
 * CSS (.map-host .djs-palette/.djs-context-pad) and we pass no keyboard config,
 * so it behaves as a move-only layout tool: drag a box to move it, click a box
 * to drill to the source. Layout changes are in-memory (a re-render or
 * re-analyze regenerates the map); persisting them is a follow-up.
 *
 * Reads an exported `process_map.bpmn` and renders it into the host
 * element. Falls back gracefully if bpmn-js failed to load.
 */

"use strict";

(function () {
  let viewer = null;
  let saveTimer = null;  // debounce for persisting a dragged layout
  const fs = require("node:fs");

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
      const canvas = viewer.get("canvas");
      canvas.zoom("fit-viewport", "auto");
      /* Persist a dragged layout: when the analyst moves a box, save the
         modeler's XML (which carries the new DI coordinates) back to the
         .bpmn, debounced, so switching level/tab or re-opening the session
         keeps the arrangement. Guarded on commandStack.canUndo() so the
         one-off fire importXML emits doesn't rewrite the file on every load.
         (A re-analyze regenerates the map from scratch and resets it.) */
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
      /* Drill-down: click a task / activity node to drill back to the
         source session at the matching activity. Filter by element
         type so panning the canvas doesn't fire drills. */
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
