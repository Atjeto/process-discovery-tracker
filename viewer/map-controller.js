"use strict";

/*
 * map-controller.js: the Map level's process map (BA-helper cycle). One Flow
 * diagram, a directly-follows graph built from the runs' steps
 * (process-map-levels.buildAnnotationDfg), drawn by dfg-viewer.js (dagre,
 * left to right) with time-weighted edges, the rare-path slider and the zoom
 * controls.
 *
 * The controller owns the view state (the rare-path cutoff) and the control
 * wiring; it does NOT own the data. The caller's `dataSource()` resolves the
 * graph for the loaded session:
 *   { dfg, edgeWeight }   a graph to draw ("time" weights the edges by the
 *                         time that flowed along them), or
 *   { emptyMessage }      HTML shown in the host instead (not analyzed, no
 *                         runs, the run check failed, no steps yet).
 * A node click selects the node and reveals its counts; nothing drills.
 */

const PdtDfg = require("./dfg-viewer.js");
const { dropRareEdges } = require("./process-map-levels.js");

/**
 * Create the map controller bound to its DOM nodes and data source.
 *
 * @param {Object} config
 * @param {HTMLElement} config.hostDfg          container the map draws into
 * @param {Object} [config.zoomControls]        { in, out, fit, wrap, pct }
 * @param {Object} [config.rareSlider]          { wrap, range, label }
 * @param {Function} config.dataSource          () => { dfg, edgeWeight } | { emptyMessage }
 * @returns {{ render: () => Promise<void> }}
 */
function createMapController(config) {
  const {
    hostDfg,
    zoomControls = null,
    rareSlider = null,
    dataSource,
  } = config;

  let rareCutoff = 1;

  function _setZoomVisible(visible) {
    if (zoomControls && zoomControls.wrap) {
      zoomControls.wrap.style.display = visible ? "" : "none";
    }
  }
  function _setZoomPct(z) {
    if (zoomControls && zoomControls.pct) {
      zoomControls.pct.textContent = Math.round((z || 1) * 100) + "%";
    }
  }
  function _refit() {
    if (PdtDfg && PdtDfg.fit) { PdtDfg.fit(); _setZoomPct(PdtDfg.getZoom ? PdtDfg.getZoom() : 1); }
  }

  /* Draw `data` into the host. */
  function _renderDfg(data) {
    if (!hostDfg || !PdtDfg) return;
    let dfg = data && data.dfg;
    const opts = {
      onZoomChange: (z) => _setZoomPct(z),
      // NAV-AUDIT §E1: a node click selects the node and reveals its counts.
      onNodeClick: (label) => { if (typeof PdtDfg.selectNode === "function") PdtDfg.selectNode(label); },
    };
    // §B2: the data source decides the edge-weight encoding ("time" for the
    // process map); the viewer keeps the other weight in the edge tooltip.
    if (data && data.edgeWeight) opts.edgeWeight = data.edgeWeight;

    /* ADR-0013 #5: rare-path frequency slider. The slider's range tracks this
       map's busiest edge; a cutoff of 1 shows every path, higher hides paths
       seen fewer times. dropRareEdges clamps the cutoff to maxFreq, so the map
       is never blanked. The slider hides when the map has no edges and
       disables when there is no spread to thin. */
    const baseHasEdges = !!(dfg && dfg.edges && dfg.edges.length);
    // reduce, not Math.max(...spread): a large DFG would overflow the JS
    // argument-count limit and throw.
    const maxFreq = baseHasEdges
      ? dfg.edges.reduce((m, e) => Math.max(m, e.frequency || 1), 1) : 1;
    const canThin = baseHasEdges && maxFreq > 1 && dfg.edges.length >= 3;
    let hiddenRare = 0;
    let appliedCutoff = 1;
    if (canThin && rareCutoff > 1) {
      const r = dropRareEdges(dfg, rareCutoff);
      dfg = r.dfg;
      hiddenRare = r.hidden;
      appliedCutoff = r.cutoff;
    }
    if (rareSlider) {
      if (rareSlider.wrap) rareSlider.wrap.style.display = baseHasEdges ? "" : "none";
      if (rareSlider.range) {
        rareSlider.range.max = String(Math.max(1, maxFreq));
        rareSlider.range.value = String(Math.min(rareCutoff, Math.max(1, maxFreq)));
        rareSlider.range.disabled = !canThin;
      }
      if (rareSlider.label) {
        rareSlider.label.textContent = appliedCutoff > 1
          ? ("≥ " + appliedCutoff + "×  (" + hiddenRare + " hidden)")
          : "All paths";
      }
    }

    if (dfg && dfg.edges && dfg.edges.length) {
      PdtDfg.render(hostDfg, dfg, opts);
      _setZoomVisible(true);
      return;
    }
    // Nothing to draw: take any previous graph down so no export reads it.
    if (typeof PdtDfg.clear === "function") PdtDfg.clear();
    hostDfg.innerHTML = '<div class="map-empty-inline">' +
      ((data && data.emptyMessage) || "No steps to draw yet.") + "</div>";
    _setZoomVisible(false);
  }

  /* Draw the map: the single entry point. */
  function render() {
    const data = (typeof dataSource === "function" ? dataSource() : null) || {};
    _renderDfg(data);
    return Promise.resolve();
  }

  /* ============ Control wiring ===================================== */

  if (zoomControls) {
    if (zoomControls.in) zoomControls.in.addEventListener("click", () => {
      if (PdtDfg.zoomIn) { PdtDfg.zoomIn(); _setZoomPct(PdtDfg.getZoom ? PdtDfg.getZoom() : 1); }
    });
    if (zoomControls.out) zoomControls.out.addEventListener("click", () => {
      if (PdtDfg.zoomOut) { PdtDfg.zoomOut(); _setZoomPct(PdtDfg.getZoom ? PdtDfg.getZoom() : 1); }
    });
    if (zoomControls.fit) zoomControls.fit.addEventListener("click", () => _refit());
  }

  if (rareSlider && rareSlider.range) {
    rareSlider.range.addEventListener("input", (e) => {
      // ADR-0013 #5: re-renders live as it drags, without an auto-fit so the
      // user's pan/zoom is preserved.
      rareCutoff = Math.max(1, parseInt(e.target.value, 10) || 1);
      _renderDfg((typeof dataSource === "function" ? dataSource() : null) || {});
    });
  }

  return { render };
}

module.exports = { createMapController };
