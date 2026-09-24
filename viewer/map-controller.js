"use strict";

/*
 * map-controller.js: the Map level's process map (BA-helper cycle). One Flow
 * diagram, a directly-follows graph built from the runs' steps
 * (process-map-levels.buildAnnotationDfg), drawn by dfg-viewer.js (dagre,
 * left to right) with time-weighted edges, and its controls: "fit" (scroll
 * zooms and drag pans the map itself) and, once a box was dragged, "Reset
 * layout" beside it (lane CC: the boxes go back where the map lays them out;
 * the dragged arrangement is kept per level on this computer). Every path
 * shows: a map of 3 to 5 runs has no rare path to thin, and its exception
 * branches are what the PDD needs.
 *
 * The controller owns the control wiring; it does NOT own the data. The
 * caller's `dataSource()` resolves the graph for the loaded session:
 *   { dfg, edgeWeight, nodeSystems }  a graph to draw ("time" weights the
 *                         edges by the time that flowed along them;
 *                         nodeSystems names each box's system under its name),
 *   or { emptyMessage }   HTML shown in the host instead (not analyzed, no
 *                         runs, the run check failed, no steps yet).
 * A node click selects the node and calls config.onNodeClick(label): the step
 * panel opens beside the map (its steps, the video, what was said).
 * Contract C19: the data may name the boxes that are sub-processes
 * (`subNodes`, marked on the map; a double-click on one calls
 * config.onNodeDblClick(label), which opens its map) and the level the map
 * is of (`layoutScope`, so each level keeps its own dragged arrangement).
 */

const PdtDfg = require("./dfg-viewer.js");
const { flowEdges } = require("./process-map-levels.js");

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
    onNodeClick = null,
    onNodeDblClick = null,
  } = config;

  function _setZoomVisible(visible) {
    if (zoomControls && zoomControls.wrap) {
      zoomControls.wrap.style.display = visible ? "" : "none";
    }
  }

  /* Reset layout (lane CC) shows beside fit only while the map drawn has
     boxes moved by hand. */
  function _syncReset() {
    const btn = zoomControls && zoomControls.reset;
    if (btn) btn.hidden = !(PdtDfg && typeof PdtDfg.layoutSaved === "function" && PdtDfg.layoutSaved());
  }

  /* Draw `data` into the host. */
  function _renderDfg(data) {
    if (!hostDfg || !PdtDfg) return;
    const dfg = data && data.dfg;
    const opts = {
      // A node click selects the node and opens the step panel (V2 item 4).
      onNodeClick: (label) => {
        if (typeof PdtDfg.selectNode === "function") PdtDfg.selectNode(label);
        if (onNodeClick) onNodeClick(label);
      },
      nodeSystems: (data && data.nodeSystems) || null,
      subNodes: (data && data.subNodes) || [],
      layoutScope: (data && data.layoutScope) || "",
      // A box dragged: Reset layout shows.
      onLayoutChange: _syncReset,
    };
    if (onNodeDblClick) opts.onNodeDblClick = onNodeDblClick;
    // §B2: the data source decides the edge-weight encoding ("time" for the
    // process map); the edge tooltip carries the numbers.
    if (data && data.edgeWeight) opts.edgeWeight = data.edgeWeight;

    // C17: a map is drawn once it has an edge, those from the start and to
    // the end included (one step alone is start, the step, end).
    if (flowEdges(dfg).length) {
      PdtDfg.render(hostDfg, dfg, opts);
      _setZoomVisible(true);
      _syncReset();
      return;
    }
    // Nothing to draw: take any previous graph down so no export reads it.
    if (typeof PdtDfg.clear === "function") PdtDfg.clear();
    hostDfg.innerHTML = '<div class="map-empty-inline">' +
      ((data && data.emptyMessage) || "No steps to draw yet.") + "</div>";
    _setZoomVisible(false);
    _syncReset();
  }

  /* Draw the map: the single entry point. */
  function render() {
    const data = (typeof dataSource === "function" ? dataSource() : null) || {};
    _renderDfg(data);
    return Promise.resolve();
  }

  /* ============ Control wiring ===================================== */

  // The fit fits this map while it shows; while the As-Is map shows instead,
  // the fit is that map's (refmap-ui.js).
  if (zoomControls && zoomControls.fit) {
    zoomControls.fit.addEventListener("click", () => {
      if (hostDfg && !hostDfg.getClientRects().length) return;
      if (PdtDfg && PdtDfg.fit) PdtDfg.fit();
    });
  }
  // Reset layout: the boxes moved by hand go back where the map lays them out.
  if (zoomControls && zoomControls.reset) {
    zoomControls.reset.addEventListener("click", () => {
      if (!PdtDfg || typeof PdtDfg.resetLayout !== "function") return;
      PdtDfg.resetLayout();
      render();
    });
  }

  return { render, syncReset: _syncReset };
}

module.exports = { createMapController };
