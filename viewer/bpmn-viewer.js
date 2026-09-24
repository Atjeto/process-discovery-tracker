/*
 * BPMN editor using bpmn-js: the full-screen editor of an edited map
 * (refmap-ui.js, ADR-0019). Loads the MODELER bundle (the BpmnJS global from
 * dist/bpmn-modeler.production.min.js); the editor host is not a .map-host,
 * so the palette and context pad show. The copy opens on its own saved
 * coordinates (the pipeline lays out process_map_step.bpmn, and the analyst's
 * edits are saved into the copy), the import is made the baseline (the
 * command stack is cleared) so only the analyst's own edits persist back to
 * the .bpmn file. Each save is reported to the save state in the top bar
 * (opts.report, save-state.js): a start when an edit waits to be written, an
 * end when the file is written or the write failed.
 *
 * A new copy (the Map's Edit, refmap-ui.js) opens from its XML before its
 * file exists (opts.xml): nothing is written until the analyst changes it,
 * and opts.onChange hears each change first, so the copy is kept then.
 * changed() tells whether the map differs from the one opened, so a copy
 * whose changes were all undone can be dropped when the editor closes.
 *
 * Falls back gracefully if bpmn-js failed to load.
 */

"use strict";

(function () {
  let viewer = null;
  let host = null;       // the editor's container
  let writer = null;     // the delayed write of the map on screen
  let opened = null;     // the map on screen as it was opened, as the editor writes it (changed())
  const fs = require("node:fs");
  const path = require("node:path");
  const SAVE_DELAY_MS = 600;

  /* The delayed write of an edited map: `write` runs `delayMs` after the
     last edit, and `report` hears { phase: "start" } when an edit starts to
     wait, then { phase: "end", ok, error, code } once it is written or the
     write failed. An edit made while a write runs waits for the next write,
     and its start stays open until then, so the top bar says Saving... until
     nothing waits. flush() writes what waits now (before another map opens). */
  function createDelayedWrite({ delayMs, write, report, setTimer, clearTimer }) {
    const later = setTimer || ((fn, ms) => setTimeout(fn, ms));
    const cancel = clearTimer || ((t) => clearTimeout(t));
    // A report that fails is logged: the writes go on (the chain below
    // never rejects, so a later write always runs).
    const say = (evt) => {
      if (typeof report !== "function") return;
      try { report(evt); } catch (e) { console.error("[bpmn] the save state was not told about a map write:", e); }
    };
    let timer = null;
    let waiting = false;   // a start was reported and its end not yet
    let chain = Promise.resolve();
    function flush() {
      if (timer) { cancel(timer); timer = null; }
      chain = chain.then(async () => {
        if (!waiting || timer) return;
        let err = null;
        try { await write(); } catch (e) { err = e || new Error("the map could not be written"); }
        if (timer) return;   // a newer edit waits: its write ends the start
        waiting = false;
        say(err
          ? { phase: "end", ok: false, error: String((err && err.message) || err), code: (err && err.code) || null }
          : { phase: "end", ok: true, error: null, code: null });
      });
      return chain;
    }
    function schedule() {
      if (!waiting) { waiting = true; say({ phase: "start" }); }
      if (timer) cancel(timer);
      timer = later(() => { timer = null; flush(); }, delayMs);
    }
    return { schedule, flush, pending: () => waiting };
  }

  /* Fit the diagram in view, clear of the tool palette at the left (V2 item
     7: fitted to the whole viewport, the palette covered the first task and
     the start event). */
  function fitClear() {
    if (!viewer) return;
    const canvas = viewer.get("canvas");
    canvas.zoom("fit-viewport", "auto");
    const palette = host && host.querySelector(".djs-palette");
    if (!palette) return;
    const left = Math.max(0, palette.getBoundingClientRect().right - host.getBoundingClientRect().left) + 16;
    const vb = canvas.viewbox();
    const inner = vb.inner, outer = vb.outer;
    if (!inner || !(inner.width > 0) || !(inner.height > 0) || outer.width <= left + 48) return;
    const scale = Math.min((outer.width - left - 16) / inner.width, (outer.height - 32) / inner.height, vb.scale || 1);
    canvas.viewbox({
      x: inner.x - left / scale,
      y: inner.y - (outer.height / scale - inner.height) / 2,
      width: outer.width / scale,
      height: outer.height / scale,
    });
  }

  /* Render the .bpmn file into host, editable. `opts`: { editable: true } (the
     editor is the only caller), `report`, which hears each save (see
     createDelayedWrite), `xml`, the map to open when its file is not written
     yet (a new copy: the first write creates it), and `onChange`, which
     hears each change (an edit, its undo, its redo) before its write waits.
     An edit of the map shown before still waiting for its write is written
     first. */
  async function render(container, bpmnFilePath, opts) {
    if (writer) { const w = writer; writer = null; await w.flush(); }
    opened = null;
    host = container;
    host.innerHTML = "";
    if (typeof BpmnJS === "undefined") {
      host.innerHTML = '<div class="map-empty-inline">bpmn-js failed to load. ' +
        'The BPMN file is still on disk and importable into Adonis.</div>';
      return;
    }
    const given = opts && typeof opts.xml === "string" ? opts.xml : null;
    if (given == null && (!bpmnFilePath || !fs.existsSync(bpmnFilePath))) {
      host.innerHTML = '<div class="map-empty-inline">no BPMN file yet</div>';
      return;
    }
    const xml = given != null ? given : fs.readFileSync(bpmnFilePath, "utf-8");
    if (viewer) {
      try { viewer.destroy(); } catch (_) {}
      viewer = null;
    }
    const v = viewer = new BpmnJS({ container: host });
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
      // The map as opened, as the editor writes it: changed() compares with it.
      try { opened = (await v.saveXML({ format: true })).xml || null; } catch (_) { opened = null; }
      // Its keys while it is open (bpmn-js binds none by itself): Ctrl+Z and
      // Ctrl+Y (or Ctrl+Shift+Z) undo and redo the map's own changes, Delete
      // removes the selection. The viewer's own shortcuts step aside while the
      // editor shows (renderer.js); unbindKeys gives the keys back on close.
      try { v.get("keyboard").bind(document); }
      catch (e) { console.warn("[bpmn] the editor's keys were not bound:", e && e.message); }
      fitClear();
      try { host.__bpmnViewer = viewer; } catch (_) {}   // debug/verification handle (cf. dfg host.__cy)
      /* Persist the analyst's edits back to the .bpmn (delayed): each edit,
         its undo and its redo (an undo back to the map as opened is written
         too), never the import's own clear, so opening a map never rewrites
         its file. A failed write is said in the top bar; the edit stays in
         the editor, and the next edit writes the whole map again. */
      if (bpmnFilePath) {
        const w = writer = createDelayedWrite({
          delayMs: SAVE_DELAY_MS,
          report: opts && opts.report,
          write: async () => {
            const { xml: out } = await v.saveXML({ format: true });
            if (!out) throw new Error("the map could not be written out");
            fs.mkdirSync(path.dirname(bpmnFilePath), { recursive: true });
            fs.writeFileSync(bpmnFilePath, out, "utf-8");
          },
        });
        const onChange = opts && typeof opts.onChange === "function" ? opts.onChange : null;
        v.get("eventBus").on("commandStack.changed", (e) => {
          const trigger = e && e.trigger;
          if (trigger !== "execute" && trigger !== "undo" && trigger !== "redo") return;
          if (writer !== w) return;
          if (onChange) {
            try { onChange(); } catch (err) { console.error("[bpmn] a change of the map was not heard:", err); }
          }
          w.schedule();
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
    try { fitClear(); } catch (_) { /* no diagram to fit */ }
  }

  /* Write an edit still waiting for its delayed write now: the editor
     closes, and the Map shows the map from its file. */
  function flush() {
    return writer ? writer.flush() : Promise.resolve();
  }

  /* The editor closed: its keys go back to the viewer. */
  function unbindKeys() {
    if (!viewer) return;
    try { viewer.get("keyboard").unbind(); } catch (_) { /* no keyboard: nothing bound */ }
  }

  /* Whether the map in the editor differs from the one opened: false while
     nothing was changed, or every change was undone (the command stack is
     back at its start: an undone label edit leaves an empty label bound in
     the XML, so the stack decides), or the changes left the map written out
     as it was opened; true otherwise, or when that cannot be told. */
  async function changed() {
    if (!viewer) return false;
    let stack;
    try { stack = viewer.get("commandStack"); } catch (_) { return true; }
    if (!stack.canUndo()) return false;
    if (opened == null) return true;
    try {
      const { xml } = await viewer.saveXML({ format: true });
      return xml !== opened;
    } catch (_) { return true; }
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

  module.exports = { render, fit, flush, changed, unbindKeys, exportSvg, exportXml, createDelayedWrite };
})();
