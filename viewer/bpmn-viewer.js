/*
 * BPMN editor using bpmn-js: the full-screen editor of an edited map
 * (refmap-ui.js, ADR-0019). Loads the MODELER bundle (the BpmnJS global from
 * dist/bpmn-modeler.production.min.js); the editor host is not a .map-host,
 * so the palette and context pad show. The copy opens on its own saved
 * coordinates (the pipeline lays out process_map_step.bpmn, and the analyst's
 * edits are saved into the copy), the import is made the baseline (the
 * command stack is cleared) so only the analyst's own edits persist back to
 * the .bpmn file.
 *
 * Falls back gracefully if bpmn-js failed to load.
 */

"use strict";

(function () {
  let viewer = null;
  let saveTimer = null;  // debounce for persisting an edit
  const fs = require("node:fs");

  /* Render the .bpmn file into host, editable. `opts` is kept for the call
     site's { editable: true }; the editor is the only caller. */
  async function render(host, bpmnFilePath, opts) {
    void opts;
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
      // The import is the baseline (clear undo): only the analyst's own edits
      // count, and only they are saved back.
      try {
        viewer.get("commandStack").clear();
      } catch (e) {
        console.warn("[bpmn] could not reset the edit history after import:", e && e.message);
      }
      viewer.get("canvas").zoom("fit-viewport", "auto");
      try { host.__bpmnViewer = viewer; } catch (_) {}   // debug/verification handle (cf. dfg host.__cy)
      /* Persist the analyst's edits back to the .bpmn (debounced), guarded
         on canUndo so the import never rewrites the file. */
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

  /* Export the rendered diagram as SVG (Figma / Lucidchart / browser
     all import SVG). bpmn-js's saveSVG returns a Promise<{ svg }>. */
  async function exportSvg() {
    if (!viewer) return null;
    try {
      const { svg } = await viewer.saveSVG();
      return svg || null;
    } catch (_) { return null; }
  }

  /* ADR-0019: serialise the CURRENT diagram (including the analyst's edits)
     as BPMN 2.0 XML. */
  async function exportXml() {
    if (!viewer) return null;
    try {
      const { xml } = await viewer.saveXML({ format: true });
      return xml || null;
    } catch (_) { return null; }
  }

  module.exports = { render, fit, exportSvg, exportXml };
})();
