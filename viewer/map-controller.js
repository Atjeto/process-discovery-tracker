"use strict";

/*
 * map-controller.js -- the interactive process-map UI, extracted so it can mount
 * in both the Compare-Sessions surface and the single-session Session view's
 * "Map" level without DOM-ID collisions or duplicated wiring.
 *
 * The controller owns the cross-cutting map state:
 *   - notation:  "bpmn" (Process diagram) | "dfg" (Flow diagram)
 *   - level:     "activity" | "step" | "phase"
 *   - drillFilter: when descending from a Flow node, what scope to apply
 *                  ({ level, parent, phaseName? | labels? })
 *   - rareCutoff: minimum edge frequency on the Flow diagram (slider)
 *
 * It does NOT own the data. The caller passes a `dataSource` callback that
 * resolves to the DFG / BPMN-path for the requested (notation, level, scope)
 * combination, so the multi-session merged map and the single-session map can
 * share the same UI. The controller also takes:
 *
 *   - `activityLabelsForStep`: caller-supplied function returning the activity
 *     labels emitted inside the given step name (data-source specific -- the
 *     aggregate view pools across sessions, the single-session view scopes
 *     to one).
 *   - `onActivityNodeClick`: bottom-level node-click -- aggregate uses this
 *     to drill into the source session, single-session uses it to seek the
 *     timeline.
 *
 * Render flow (single entry point):
 *   render() -> syncNotationTabs + syncLevelSelect + renderScopeChip
 *            -> dataSource({notation, level, scope})
 *            -> renderBpmn(data) | renderDfg(data)
 *
 * Both PdtBpmn and PdtDfg expose the same zoom API (zoomIn / zoomOut / fit /
 * getZoom) so `activeViewer()` works uniformly.
 */

const fs = require("node:fs");
const PdtBpmn = require("./bpmn-viewer.js");
const PdtDfg = require("./dfg-viewer.js");
const { dropRareEdges } = require("./process-map-levels.js");

function _escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* Restrict a DFG to a set of node labels -- keep an edge only when BOTH
   endpoints survive, with the matching start/end markers. */
function _filterDfgToLabels(dfg, labels) {
  if (!dfg || !labels) return dfg;
  const keep = (n) => labels.has(n);
  const filtObj = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => keep(k)));
  return {
    edges: (dfg.edges || []).filter((e) => keep(e.source) && keep(e.target)),
    start_activities: filtObj(dfg.start_activities),
    end_activities: filtObj(dfg.end_activities),
  };
}

/**
 * Create a map controller bound to a set of DOM nodes + a data source.
 *
 * @param {Object} config
 * @param {HTMLElement} config.hostBpmn               container for BPMN render
 * @param {HTMLElement} config.hostDfg                container for DFG render
 * @param {HTMLElement[]} config.notationTabs         tab elements with data-map="bpmn"/"dfg"
 * @param {HTMLSelectElement} [config.levelSelect]    level dropdown (activity/step/phase)
 * @param {HTMLElement} [config.scopeChip]            <span> for the drill-down scope chip
 * @param {Object} [config.zoomControls]              { in, out, fit, wrap, pct }
 * @param {Object} [config.rareSlider]                { wrap, range, label }
 * @param {Function} config.dataSource                ({notation, level, scope}) => { dfg, variants, conformance, bpmnPath, emptyMessage }
 * @param {Function} [config.activityLabelsForStep]   (stepLabel) => Set<string> -- caller-supplied label resolver for activity scope drill
 * @param {Function} [config.onActivityNodeClick]     (label, ev) => void -- bottom-level click
 * @param {Function} [config.onChange]                () => void -- notify caller that visible state changed
 * @param {"bpmn"|"dfg"} [config.initialNotation="bpmn"]
 * @param {"activity"|"step"|"phase"} [config.initialLevel="activity"]
 * @param {number} [config.initialRareCutoff=1]
 *
 * @returns {{
 *   render: () => Promise<void>,
 *   setLevel: (level: string) => void,
 *   setNotation: (notation: string) => void,
 *   setScope: (scope: Object|null) => void,
 *   getState: () => { notation: string, level: string, scope: Object|null, rareCutoff: number },
 *   refit: () => void,
 * }}
 */
function createMapController(config) {
  const {
    hostBpmn, hostDfg,
    notationTabs = [],
    levelSelect = null,
    scopeChip = null,
    zoomControls = null,
    rareSlider = null,
    dataSource,
    activityLabelsForStep = null,
    onActivityNodeClick = null,
    onChange = null,
    onRender = null,
  } = config;

  let notation = config.initialNotation || "bpmn";
  let level = config.initialLevel || "activity";
  let drillFilter = null;
  let rareCutoff = Math.max(1, config.initialRareCutoff || 1);

  function _activeViewer() {
    return notation === "bpmn" ? PdtBpmn : PdtDfg;
  }
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
    const v = _activeViewer();
    if (v && v.fit) { v.fit(); _setZoomPct(v.getZoom ? v.getZoom() : 1); }
  }
  function _notifyChange() {
    if (typeof onChange === "function") onChange();
  }

  /* P0.2: notation (Process diagram = BPMN, Flow diagram = DFG) and level
     (Activity / Step / Phase) are fully ORTHOGONAL. The level selector changes
     level and re-renders the CURRENT notation; the notation tabs change notation
     and re-render the CURRENT level. Neither resets the other. */
  function _syncNotationTabs() {
    notationTabs.forEach((t) => t.classList.toggle("active", t.dataset.map === notation));
    if (hostBpmn) hostBpmn.style.display = notation === "bpmn" ? "" : "none";
    if (hostDfg) hostDfg.style.display = notation === "dfg" ? "" : "none";
    _setZoomVisible(true);
    // The rare-path toggle only applies to the live DFG; renderDfg re-shows it
    // for the Flow diagram.
    if (notation === "bpmn" && rareSlider && rareSlider.wrap) {
      rareSlider.wrap.style.display = "none";
    }
  }

  function _syncLevelSelect() {
    if (levelSelect) levelSelect.value = level;
  }

  /* Show/hide the drill-down scope chip in the map header. It names the parent
     the Flow diagram is scoped to and offers a one-click "show all" -- the
     inverse of drilling in. Only the live DFG can be scoped, so the chip is
     hidden on the BPMN. */
  function _renderScopeChip() {
    if (!scopeChip) return;
    if (!drillFilter || notation !== "dfg") {
      scopeChip.style.display = "none";
      scopeChip.innerHTML = "";
      return;
    }
    scopeChip.style.display = "";
    scopeChip.innerHTML =
      '<span class="map-scope-lbl" title="The Flow diagram is scoped to this parent\'s children">scoped: ' +
      _escapeHtml(drillFilter.parent) + '</span>' +
      '<button type="button" class="map-scope-clear" title="Show the whole level">show all ✕</button>';
    const btn = scopeChip.querySelector(".map-scope-clear");
    if (btn) btn.addEventListener("click", () => {
      drillFilter = null;
      render().then(() => setTimeout(_refit, 50));
      _notifyChange();
    });
  }

  /* Drill-down navigation: clicking a node on the phase or step map descends
     one level (phase -> step -> activity). Activity is the bottom -- there a
     click drills to the source via `onActivityNodeClick`.

     Scoping: on the live Flow diagram (DFG) the descent is FILTERED to the
     clicked node's children. The Process diagram (BPMN) is a pre-mined static
     file that cannot be re-filtered live, so there a click descends UNFILTERED. */
  function _drillDownLevel(label) {
    const next = level === "phase" ? "step" : level === "step" ? "activity" : null;
    if (!next) {
      // NAV-AUDIT §E1: the grain notches with no deeper in-map destination
      // (screen / app / case) used to no-op here, leaving the default map
      // surface with dead nodes while the shortcuts overlay advertised a drill.
      // The grain is a GLOBAL view control (State.getGrain drives Steps + Flow
      // + Map together), so a node click must not silently mutate it — that
      // would be an unlabeled view change. Instead the click SELECTS the node
      // and REVEALS its info (label · role · throughput), the contract's
      // "click = select + reveal". Only the live Flow diagram has clickable
      // nodes at these notches (BPMN shows the "mined at Element/Phase"
      // fallback), so select on the DFG.
      if (notation === "dfg" && PdtDfg && typeof PdtDfg.selectNode === "function") {
        PdtDfg.selectNode(label);
      }
      return;
    }
    const canScope = notation === "dfg" && !!label;
    if (canScope && level === "phase") {
      drillFilter = { level: "step", parent: label, phaseName: label };
    } else if (canScope && level === "step") {
      const labels = (typeof activityLabelsForStep === "function")
        ? activityLabelsForStep(label) : new Set();
      drillFilter = { level: "activity", parent: label, labels };
    } else {
      drillFilter = null;
    }
    level = next;
    _syncLevelSelect();
    render().then(() => setTimeout(_refit, 50));
    _notifyChange();
  }

  async function _renderBpmn(data) {
    if (!hostBpmn || !PdtBpmn) return;
    if (!data || !data.bpmnPath || !fs.existsSync(data.bpmnPath)) {
      hostBpmn.innerHTML = '<div class="map-empty-inline">' +
        ((data && data.emptyMessage) ||
         ('No ' + level + '-level Process diagram available.')) + '</div>';
      return;
    }
    const opts = {};
    if (level === "activity" && onActivityNodeClick) {
      opts.onNodeClick = (label, ev) => onActivityNodeClick(label, ev);
    } else {
      opts.onNodeClick = (label) => _drillDownLevel(label);
    }
    try {
      await PdtBpmn.render(hostBpmn, data.bpmnPath, opts);
      _setZoomPct(PdtBpmn.getZoom());
      // Re-fit once -- if the host just became visible (level switch) bpmn-js
      // measured 0 dimensions and the diagram lands off-screen. Fit() with a
      // small defer makes the layout converge once the parent has painted.
      setTimeout(() => {
        try { if (PdtBpmn.fit) PdtBpmn.fit(); } catch (_) {}
      }, 50);
    } catch (e) {
      // v0.18.1: do NOT swallow silently -- a render failure with no message
      // leaves an empty host that looks like "the map is broken" to the
      // analyst. Log + show a fallback so we can diagnose at minimum.
      console.error("[map-controller] BPMN render failed for", data.bpmnPath, ":", e);
      hostBpmn.innerHTML = '<div class="map-empty-inline">Could not render the BPMN at <code>' +
        _escapeHtml(String(data.bpmnPath || "")) + '</code>: ' +
        _escapeHtml(String((e && e.message) || e)) +
        '. The file may be empty, malformed, or generated by a different version. Try re-running Analyze with "Build process map" checked.</div>';
    }
    _setZoomVisible(true);
  }

  function _renderDfg(data) {
    if (!hostDfg || !PdtDfg) return;
    let dfg = data && data.dfg;
    const opts = { onZoomChange: (z) => _setZoomPct(z) };
    // §B2: the data source decides the edge-weight encoding ("time" on the
    // annotation grain ladder, count on the taxonomy DFG); the viewer keeps
    // the other weight in the edge tooltip either way.
    if (data && data.edgeWeight) opts.edgeWeight = data.edgeWeight;

    if (level === "activity") {
      // Drill scope: a step node was clicked, so show only the activity labels
      // produced inside that step.
      if (drillFilter && drillFilter.level === "activity" && drillFilter.labels) {
        dfg = _filterDfgToLabels(dfg, drillFilter.labels);
      }
      if (onActivityNodeClick) {
        opts.onNodeClick = (label, ev) => onActivityNodeClick(label, ev);
      }
      if (data && data.variants) opts.variants = data.variants;
      if (data && data.conformance) opts.conformance = data.conformance;
    } else {
      opts.onNodeClick = (label) => _drillDownLevel(label);
    }

    /* ADR-0013 #5: rare-path frequency slider (Flow diagram only). The slider's
       range tracks this map's busiest edge; a cutoff of 1 shows every path,
       higher hides paths seen fewer times. dropRareEdges clamps the cutoff to
       maxFreq, so the map is never blanked. The slider hides on the BPMN
       (_syncNotationTabs) and when the map has no edges; it disables when there
       is no spread to thin. */
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
    } else if (drillFilter) {
      hostDfg.innerHTML = '<div class="map-empty-inline">No sub-flow inside "' +
        _escapeHtml(drillFilter.parent) + '" — it has a single ' +
        (level === "activity" ? "activity" : "step") +
        '. Use "show all" to see the whole level.</div>';
    } else {
      hostDfg.innerHTML = '<div class="map-empty-inline">' +
        ((data && data.emptyMessage) ||
         ('No ' + level + '-level flow yet.')) + '</div>';
    }
  }

  function _notifyRender(bpmnPath) {
    if (typeof onRender === "function") onRender({ notation, level, bpmnPath: bpmnPath || null });
  }

  /* Draw the active (notation × level) cell -- the single entry point.
     `opts.suppressFallback` is set when the user EXPLICITLY chose the Process
     diagram (clicked the tab): then a coarse grain with no BPMN shows the honest
     "mined at Element/Phase" message rather than silently flipping to the Flow
     diagram. A GRAIN change (the common case) leaves it off, so changing the
     grain to screen/app/case rolls up live on the Flow diagram -- the grain
     control always produces a usable map. */
  async function render(opts = {}) {
    _syncNotationTabs();
    _syncLevelSelect();
    _renderScopeChip();
    const data = (await Promise.resolve(
      dataSource({ notation, level, scope: drillFilter }))) || {};
    // ADR-0024: the Process diagram (BPMN) is mined only at the activity /
    // element / phase grains. For a coarser grain (screen / app / case) there is
    // NO BPMN file, but the Flow diagram rolls it up live -- so fall back to it
    // (unless the user explicitly clicked the Process diagram tab).
    if (notation === "bpmn" && !data.bpmnPath && !opts.suppressFallback) {
      const dfgData = (await Promise.resolve(
        dataSource({ notation: "dfg", level, scope: drillFilter }))) || {};
      if (dfgData.dfg) {
        notation = "dfg";
        _syncNotationTabs();
        _renderScopeChip();
        _renderDfg(dfgData);
        _notifyRender(null);
        _notifyChange();
        return;
      }
    }
    if (notation === "bpmn") {
      await _renderBpmn(data);
      _notifyRender(data.bpmnPath);
    } else {
      _renderDfg(data);
      _notifyRender(null);
    }
  }

  /* ============ Control wiring ===================================== */

  notationTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      // Notation changes IN PLACE -- the level is preserved. Switching to BPMN
      // clears any Flow-diagram scope (BPMN can't honour a live drill scope).
      notation = tab.dataset.map === "dfg" ? "dfg" : "bpmn";
      if (notation === "bpmn") drillFilter = null;
      // Explicit Process-diagram choice: don't silently fall back to the Flow
      // diagram -- show the honest "mined at Element/Phase" message at a coarse
      // grain so the tab the user clicked is the tab they see.
      render({ suppressFallback: notation === "bpmn" }).then(() => setTimeout(_refit, 50));
      _notifyChange();
    });
  });

  if (levelSelect) {
    levelSelect.addEventListener("change", () => {
      // C1b / P0.2: the level selector changes level IN PLACE on the current
      // notation -- it never swaps notation.
      level = levelSelect.value || "activity";
      drillFilter = null;   // an explicit level pick shows the whole level
      render().then(() => setTimeout(_refit, 50));
      _notifyChange();
    });
  }

  if (zoomControls) {
    if (zoomControls.in) zoomControls.in.addEventListener("click", () => {
      const v = _activeViewer();
      if (v && v.zoomIn) { v.zoomIn(); _setZoomPct(v.getZoom ? v.getZoom() : 1); }
    });
    if (zoomControls.out) zoomControls.out.addEventListener("click", () => {
      const v = _activeViewer();
      if (v && v.zoomOut) { v.zoomOut(); _setZoomPct(v.getZoom ? v.getZoom() : 1); }
    });
    if (zoomControls.fit) zoomControls.fit.addEventListener("click", () => {
      const v = _activeViewer();
      if (v && v.fit) { v.fit(); _setZoomPct(v.getZoom ? v.getZoom() : 1); }
    });
  }

  if (rareSlider && rareSlider.range) {
    rareSlider.range.addEventListener("input", (e) => {
      // ADR-0013 #5: re-renders live as it drags, without an auto-fit so the
      // user's pan/zoom is preserved.
      rareCutoff = Math.max(1, parseInt(e.target.value, 10) || 1);
      if (notation === "dfg") {
        Promise.resolve(dataSource({ notation, level, scope: drillFilter }))
          .then((d) => _renderDfg(d || {}));
      }
    });
  }

  return {
    render,
    setLevel: (newLevel) => {
      if (!newLevel || newLevel === level) return;
      level = newLevel;
      drillFilter = null;
      _syncLevelSelect();
      render().then(() => setTimeout(_refit, 50));
      _notifyChange();
    },
    setNotation: (newNotation) => {
      if (!newNotation || newNotation === notation) return;
      notation = newNotation === "dfg" ? "dfg" : "bpmn";
      if (notation === "bpmn") drillFilter = null;
      render({ suppressFallback: notation === "bpmn" }).then(() => setTimeout(_refit, 50));
      _notifyChange();
    },
    setScope: (newScope) => {
      drillFilter = newScope || null;
      render();
      _notifyChange();
    },
    /* Atomic multi-field update -- one render instead of N. Used when an
       upstream data refresh wants to nudge both level and notation in one go
       (e.g. an empty activity DFG defaulting to step/phase on the Flow tab).
       Always renders (the caller usually invokes this BECAUSE the data
       changed, even when the controller's own state didn't). Returns the
       render promise so a caller that must read the rendered diagram (the
       Fork action, G-1) can await the paint instead of sleeping. */
    setState: ({ notation: newNotation, level: newLevel, scope: newScope, rareCutoff: newCutoff } = {}) => {
      if (newNotation !== undefined) {
        notation = newNotation === "dfg" ? "dfg" : "bpmn";
        if (notation === "bpmn") drillFilter = null;
      }
      if (newLevel !== undefined && newLevel !== level) {
        level = newLevel;
        drillFilter = null;
      }
      _syncLevelSelect();
      if (newScope !== undefined) {
        drillFilter = newScope || null;
      }
      if (newCutoff !== undefined) {
        rareCutoff = Math.max(1, parseInt(newCutoff, 10) || 1);
      }
      const done = render();
      _notifyChange();
      return done;
    },
    getState: () => ({ notation, level, scope: drillFilter, rareCutoff }),
    refit: _refit,
  };
}

module.exports = { createMapController };
