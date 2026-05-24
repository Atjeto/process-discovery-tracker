/*
 * BPMN renderer using bpmn-js. We load the read-only NAVIGATED-VIEWER bundle
 * (dist/bpmn-navigated-viewer.production.min.js, exposed as the BpmnJS global) --
 * pan + zoom + click-to-drill, but no dragging. Dragging boxes in the old Modeler
 * bundle re-docked edges to arbitrary borders and tangled the map; it only existed
 * to compensate for a poor auto-layout. Instead we now re-lay-out the mined diagram
 * with bpmn.io's own engine (bpmn-auto-layout): strip the file's hand-rolled DI and
 * lay it out fresh -> a clean, layered, read-only deliverable.
 *
 * Reads an exported `process_map*.bpmn` and renders it into the host element.
 * Falls back gracefully if bpmn-js failed to load.
 */

"use strict";

(function () {
  let viewer = null;
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
    let xml = fs.readFileSync(bpmnFilePath, "utf-8");
    // Re-layout with bpmn.io's own engine (bpmn-auto-layout) instead of the
    // mined file's hand-rolled coordinates: strip the DI and lay it out fresh,
    // so the read-only diagram is clean -- layered left-to-right, end terminal,
    // far fewer crossings -- with no manual dragging. Falls back to the file's
    // own layout if the layouter is unavailable (worst case = the old layout,
    // never a broken map).
    try {
      // require() resolves bpmn-auto-layout's CommonJS build (index.cjs). A
      // dynamic import() of its ESM build hard-crashes the Electron renderer.
      const { layoutProcess } = require("bpmn-auto-layout");
      const stripped = xml.replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/g, "");
      xml = await layoutProcess(stripped);
    } catch (e) {
      console.warn("[bpmn] auto-layout unavailable; using the file's own layout:", e && e.message);
    }
    if (viewer) {
      try { viewer.destroy(); } catch (_) {}
      viewer = null;
    }
    viewer = new BpmnJS({ container: host });
    try {
      const result = await viewer.importXML(xml);
      const warnings = (result && result.warnings) || [];
      viewer.get("canvas").zoom("fit-viewport", "auto");
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
