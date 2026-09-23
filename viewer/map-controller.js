"use strict";

/*
 * map-controller.js: the Map level's process map (BA-helper cycle). One Flow
 * diagram, a directly-follows graph built from the runs' steps
 * (process-map-levels.buildAnnotationDfg), drawn by dfg-viewer.js (dagre,
 * left to right) with time-weighted edges, and its one control: "fit"
 * (scroll zooms and drag pans the map itself). Every path shows: a map of 3
 * to 5 runs has no rare path to thin, and its exception branches are what the
 * PDD needs.
 *
 * The controller owns the control wiring; it does NOT own the data. The
 * caller's `dataSource()` resolves the graph for the loaded session:
 *   { dfg, edgeWeight }   a graph to draw ("time" weights the edges by the
 *                         time that flowed along them), or
 *   { emptyMessage }      HTML shown in the host instead (not analyzed, no
 *                         runs, the run check failed, no steps yet).
 * A node click selects the node and reveals its counts; nothing drills.
 */

const PdtDfg = require("./dfg-viewer.js");

/**
 * Create the map controller bound to its DOM nodes and data source.
 *
 * @param {Object} config
 * @param {HTMLElement} config.hostDfg          container the map draws into
 * @param {Object} [config.zoomControls]        { fit, wrap }
 * @param {Function} config.dataSource          () => { dfg, edgeWeight } | { emptyMessage }
 * @returns {{ render: () => Promise<void> }}
 */
function createMapController(config) {
  const {
    hostDfg,
    zoomControls = null,
    dataSource,
  } = config;

  function _setZoomVisible(visible) {
    if (zoomControls && zoomControls.wrap) {
      zoomControls.wrap.style.display = visible ? "" : "none";
    }
  }

  /* Draw `data` into the host. */
  function _renderDfg(data) {
    if (!hostDfg || !PdtDfg) return;
    const dfg = data && data.dfg;
    const opts = {
      // NAV-AUDIT §E1: a node click selects the node and reveals its counts.
      onNodeClick: (label) => { if (typeof PdtDfg.selectNode === "function") PdtDfg.selectNode(label); },
    };
    // §B2: the data source decides the edge-weight encoding ("time" for the
    // process map); the edge tooltip carries the numbers.
    if (data && data.edgeWeight) opts.edgeWeight = data.edgeWeight;

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

  if (zoomControls && zoomControls.fit) {
    zoomControls.fit.addEventListener("click", () => { if (PdtDfg && PdtDfg.fit) PdtDfg.fit(); });
  }

  return { render };
}

module.exports = { createMapController };
