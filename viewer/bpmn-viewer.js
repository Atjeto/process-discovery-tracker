/*
 * BPMN renderer using bpmn-js (BpmnViewer global from
 * dist/bpmn-viewer.production.min.js, exposed as BpmnJS).
 *
 * Reads an exported `process_map.bpmn` and renders it into the host
 * element. Falls back gracefully if bpmn-js failed to load.
 */

"use strict";

(function () {
  let viewer = null;
  const fs = require("node:fs");

  async function render(host, bpmnFilePath) {
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
    viewer = new BpmnJS({ container: host });
    try {
      const result = await viewer.importXML(xml);
      const warnings = (result && result.warnings) || [];
      const canvas = viewer.get("canvas");
      canvas.zoom("fit-viewport", "auto");
      if (warnings.length) {
        const note = document.createElement("div");
        note.className = "bpmn-warning";
        note.textContent = `${warnings.length} BPMN parse warning(s) -- diagram may be imperfect.`;
        host.appendChild(note);
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

  window.PdtBpmn = { render, fit };
})();
