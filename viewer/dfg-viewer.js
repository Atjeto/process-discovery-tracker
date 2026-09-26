/*
 * DFG (Directly-Follows Graph) renderer using cytoscape + dagre layout.
 * Loaded via <script> in index.html so the cytoscape global is
 * available before this script runs.
 */

"use strict";

(function () {
  if (typeof cytoscape === "undefined") return;
  // Register the dagre layout extension (it bundles its own dagre engine). The
  // layout-name guard below used to test a global `dagre` that was never wired
  // into index.html, so it silently fell back to `breadthfirst` -- a RADIAL hub
  // layout that turns any flow with a busy node (e.g. SAP) into an unreadable
  // star. Track whether the extension registered and request "dagre" off THAT.
  let dagreRegistered = false;
  if (typeof cytoscapeDagre !== "undefined") {
    cytoscape.use(cytoscapeDagre);
    dagreRegistered = true;
  } else if (typeof window.cytoscapeDagre !== "undefined") {
    cytoscape.use(window.cytoscapeDagre);
    dagreRegistered = true;
  }

  let cy = null;

  const PdtTheme = require("./theme.js");
  const Levels = require("./process-map-levels.js");
  const SystemNames = require("./system-names.js");
  const { formatDuration } = require("./dom.js");
  const { START, END, OTHERWISE } = Levels;
  // Joins an edge's two node ids: no step name has this character.
  const SEP = String.fromCharCode(1);

  /* C17: a label drawn on a line stays short (it fits between two boxes);
     the tooltip has it whole. */
  const LABEL_MAX = 26;
  function _shortLabel(text) {
    const s = String(text || "").trim();
    if (s.length <= LABEL_MAX) return s;
    const cut = s.slice(0, LABEL_MAX - 1);
    const sp = cut.lastIndexOf(" ");
    return (sp > 12 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, "") + "…";
  }

  /* C17: the map is laid out by dagre itself (not through cytoscape-dagre,
     which gives dagre no label sizes): each label's size is passed, so dagre
     keeps room for it between the ranks, and every line follows dagre's
     route around the boxes and the labels, drawn as a rounded polyline
     through its points (loops excepted: cytoscape draws those). A label sits
     at its route's middle point, which is where dagre placed it. */
  let dagreLib = null;
  try { dagreLib = require("@dagrejs/dagre"); } catch (e) {
    console.error("[dfg-viewer] dagre could not be loaded; the map falls back to cytoscape-dagre:", e && e.message);
  }
  // The same size as a box's text, so a label reads wherever the box does.
  const LABEL_FONT = 11;
  const FONT_FAMILY = '"Plus Jakarta Sans", -apple-system, "Segoe UI", system-ui, sans-serif';
  let _measure = null;
  function _labelBox(text) {
    let w = String(text).length * LABEL_FONT * 0.56;
    try {
      if (!_measure) _measure = document.createElement("canvas").getContext("2d");
      _measure.font = LABEL_FONT + "px " + FONT_FAMILY;
      w = _measure.measureText(String(text)).width;
    } catch (_) { /* the estimate above */ }
    // The text, its padding and border, and a little air around it.
    return { width: Math.ceil(w) + 18, height: 26 };
  }
  /* A box's size is its label's (lane FX3): cytoscape's own `width: label`
     is deprecated and warns on every draw, so the label is laid out here the
     way cytoscape lays it out (its lines, each wrapped between words at
     BOX_TEXT_MAX, measured in the box's font) and the size given as a
     number. BOX_FONT and BOX_TEXT_MAX are the node style's font-size and
     text-max-width below. */
  const BOX_FONT = 11;
  const BOX_TEXT_MAX = 130;
  const _boxSizes = new Map();
  function _textWidth(text) {
    try {
      if (!_measure) _measure = document.createElement("canvas").getContext("2d");
      _measure.font = "normal normal " + BOX_FONT + "px " + FONT_FAMILY;
      return Math.ceil(_measure.measureText(String(text)).width);
    } catch (_) {
      return Math.ceil(String(text).length * BOX_FONT * 0.56);
    }
  }
  function _boxLabelSize(label) {
    const key = String(label == null ? "" : label);
    if (_boxSizes.has(key)) return _boxSizes.get(key);
    const lines = [];
    for (const line of key.split("\n")) {
      if (_textWidth(line) <= BOX_TEXT_MAX) { lines.push(line); continue; }
      // cytoscape's wrap: words joined while the line fits, each word with
      // the space after it.
      let sub = "";
      const re = /[\s\u200b]+|$/g;
      let at = 0, m;
      while ((m = re.exec(line)) !== null) {
        const word = line.slice(at, m.index);
        at = m.index + m[0].length;
        const test = sub.length === 0 ? word : sub + word + m[0];
        if (_textWidth(test) <= BOX_TEXT_MAX) sub += word + m[0];
        else { if (sub) lines.push(sub); sub = word + m[0]; }
        if (m[0] === "") break;
      }
      if (!/^[\s\u200b]*$/.test(sub)) lines.push(sub);
    }
    const size = { width: Math.max(1, ...lines.map(_textWidth)), height: Math.max(1, lines.length) * BOX_FONT };
    _boxSizes.set(key, size);
    return size;
  }

  /* Lane FX3 (validation pass 2, item 17; pass 3, F24): the map is fitted
     only down to a zoom where its 11 px text still reads (about 10 px on
     screen, the size of the smallest text around it). A map too wide for
     that (a long row, beside the step panel) shows its start, level with
     its middle, and pans for the rest. */
  const MIN_READABLE_ZOOM = 0.9;
  function _fitReadable(c) {
    if (!c) return;
    try {
      c.fit(undefined, 24);
      if (c.zoom() >= MIN_READABLE_ZOOM) return;
      const bb = c.elements().boundingBox();
      c.zoom(MIN_READABLE_ZOOM);
      c.pan({ x: 24 - bb.x1 * MIN_READABLE_ZOOM, y: (c.height() - bb.h * MIN_READABLE_ZOOM) / 2 - bb.y1 * MIN_READABLE_ZOOM });
    } catch (_) { /* the map is gone */ }
  }

  const EPS = 0.001;
  const noZero = (x) => (Math.abs(x) < EPS ? (x < 0 ? -EPS : EPS) : x);

  /* Lay `c` out left to right; returns false when dagre is not there. */
  function _dagreLayout(c) {
    if (!dagreLib) return false;
    const g = new dagreLib.graphlib.Graph({ multigraph: true });
    // align "UR": the main path stays one straight row and the other paths
    // run beside it (dagre's default averages four alignments, which bends
    // the main path into a staircase).
    g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 80, edgesep: 12, align: "UR" });
    g.setDefaultEdgeLabel(() => ({}));
    c.nodes().forEach((n) => g.setNode(n.id(), { width: n.outerWidth(), height: n.outerHeight() }));
    c.edges().forEach((e) => {
      if (e.data("loop")) return;
      const box = e.data("label") ? _labelBox(e.data("label")) : { width: 0, height: 0 };
      // The paths the transactions take weigh more, so they stay straight.
      g.setEdge(e.source().id(), e.target().id(),
        { minlen: 1, weight: e.data("observed") ? 2 : 1, width: box.width, height: box.height, labelpos: "c" }, e.id());
    });
    dagreLib.layout(g);
    c.nodes().forEach((n) => {
      const d = g.node(n.id());
      if (d && Number.isFinite(d.x) && Number.isFinite(d.y)) n.position({ x: d.x, y: d.y });
    });
    // Each route's inner points, relative to the line from the source to the
    // target node (edge-distances: node-position).
    c.edges().forEach((e) => {
      if (e.data("loop")) return;
      const d = g.edge({ v: e.source().id(), w: e.target().id(), name: e.id() });
      const pts = d && Array.isArray(d.points) ? d.points.slice(1, -1) : [];
      const s = e.source().position(), t = e.target().position();
      const dx = t.x - s.x, dy = t.y - s.y, len2 = dx * dx + dy * dy;
      if (!pts.length || !len2) return;
      const len = Math.sqrt(len2);
      e.scratch("pdtRoute", {
        weights: pts.map((p) => noZero(((p.x - s.x) * dx + (p.y - s.y) * dy) / len2)),
        distances: pts.map((p) => noZero(((p.y - s.y) * dx - (p.x - s.x) * dy) / len)),
      });
      e.addClass("routed");
    });
    return true;
  }

  /* Persist a dragged DFG layout so it survives a re-render (tab/level switch)
     and a re-open, keyed by the exact node set: a different graph gets a fresh
     dagre layout and a changed node set self-heals (only matching nodes are
     repositioned). localStorage, because the DFG is built live and has no
     .bpmn to save into like the Process diagram does. C19: a sub-process's
     map is keyed by its level too (opts.layoutScope), so two maps with the
     same steps keep their own arrangement; the main map's key is as before. */
  let _scope = "";
  function _hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function _layoutStore() { try { return window.localStorage; } catch (_) { return null; } }
  function _layoutKey(c) {
    const ids = c.nodes().map((n) => n.id()).sort().join("");
    return "pdt.dfgLayout." + _hash(_scope ? _scope + SEP + ids : ids);
  }
  function _restoreLayout(c) {
    const ls = _layoutStore(); if (!ls) return;
    let saved; try { saved = JSON.parse(ls.getItem(_layoutKey(c)) || "null"); } catch (_) { return; }
    if (!saved) return;
    c.nodes().forEach((n) => {
      const p = saved[n.id()];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) n.position({ x: p.x, y: p.y });
    });
  }
  function _saveLayout(c) {
    const ls = _layoutStore(); if (!ls) return;
    const pos = {};
    c.nodes().forEach((n) => { const p = n.position(); pos[n.id()] = { x: p.x, y: p.y }; });
    try { ls.setItem(_layoutKey(c), JSON.stringify(pos)); } catch (_) {}
  }

  /* Whether the map drawn has a dragged arrangement kept (Reset layout shows
     only then). */
  function layoutSaved() {
    if (!cy) return false;
    const ls = _layoutStore(); if (!ls) return false;
    try { return ls.getItem(_layoutKey(cy)) != null; } catch (_) { return false; }
  }

  /* Reset layout (lane CC), the inverse of dragging a box: forget the
     arrangement kept for the map drawn (this level's key); the caller draws
     the map again, laid out afresh. Returns whether one was kept. */
  function resetLayout() {
    if (!cy) return false;
    const ls = _layoutStore(); if (!ls) return false;
    const key = _layoutKey(cy);
    let had = false;
    try { had = ls.getItem(key) != null; ls.removeItem(key); } catch (_) { /* nothing kept */ }
    return had;
  }

  /* An edge tip's duration, the one way the app says it (dom.js
     formatDuration). */
  function _fmtDur(ms) {
    return formatDuration(ms || 0);
  }

  /* Lane FX2: the quiet marker on a box whose step is flagged as waste (the
     word the Steps row and the step panel show). */
  const WASTE_MARK = "Waste";

  /* C19: the mark on a sub-process's box, as BPMN marks a collapsed
     sub-process: a small square with a plus at the bottom of the box, in the
     theme's colours (an image, so it keeps its size beside the label). */
  function _subMark(tok) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16">' +
      '<rect x="0.9" y="0.9" width="14.2" height="14.2" rx="2.5" fill="' + tok.bg2 + '" stroke="' + tok.fg2 + '" stroke-width="1.3"/>' +
      '<path d="M8 3.9v8.2M3.9 8h8.2" stroke="' + tok.fg + '" stroke-width="1.9" stroke-linecap="round"/></svg>';
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  function render(host, dfg, opts) {
    opts = opts || {};
    host.innerHTML = "";
    _scope = typeof opts.layoutScope === "string" ? opts.layoutScope : "";
    // C17: every edge of the map, the START and END events' included.
    const flow = Levels.flowEdges(dfg);
    if (!flow.length) {
      host.innerHTML = '<div class="map-empty-inline">no DFG data</div>';
      return;
    }
    const onNodeClick = opts.onNodeClick;
    const onNodeDblClick = opts.onNodeDblClick;
    // C19: the boxes that are sub-processes carry the mark.
    const subs = new Set(Array.isArray(opts.subNodes) ? opts.subNodes : []);
    const stepNodes = [];
    const seen = new Set([START, END]);
    for (const e of flow) for (const n of [e.from, e.to]) if (!seen.has(n)) { seen.add(n); stepNodes.push(n); }
    // reduce, not Math.max(...spread): a large DFG (thousands of edges) would
    // overflow the JS argument-count limit and throw.
    const maxFreq = flow.reduce((m, e) => Math.max(m, e.frequency || 0), 1);
    /* §B2 time-weighted edges: when the caller asks for edgeWeight "time"
       AND the edges carry measured `total_ms`, the thickness encodes the
       accumulated transition TIME (the process map). The numbers (how often
       the path was taken, its time) are one hover away in the edge tooltip,
       never drawn on the arrow (P2.4: an unexplained number read as a wait).
       With no measurable time anywhere the map degrades honestly to the
       count weighting rather than rendering uniform noodles. A path set in
       Steps that no transaction took is the thinnest line, dashed. */
    const maxMs = flow.reduce((m, e) => Math.max(m, e.total_ms || 0), 0);
    const timeWeighted = opts.edgeWeight === "time" && maxMs > 0;
    const elements = [];
    // The nodes: the start event first and the end event last, so dagre lays
    // the ranks from them (its search for loops starts at the first node).
    if (flow.some((e) => e.from === START)) {
      elements.push({ data: { id: START, label: "Start", kind: "event", role: "start-event" } });
    }
    // AD-28: a box names its step and, under it, the system it happened in,
    // unless its name already names it (lane LF-PIPE, #24).
    // Lane FX2: a box flagged as waste says so on a last line, quietly.
    const systems = opts.nodeSystems || {};
    const waste = new Set(Array.isArray(opts.wasteNodes) ? opts.wasteNodes : []);
    for (const n of stepNodes) {
      const isStart = dfg.start_activities && dfg.start_activities[n];
      const isEnd = dfg.end_activities && dfg.end_activities[n];
      const system = typeof systems[n] === "string" ? systems[n] : "";
      elements.push({
        data: {
          id: n,
          label: [n, SystemNames.systemLine(n, system), waste.has(n) ? WASTE_MARK : ""].filter(Boolean).join("\n"),
          system,
          role: isStart ? "start" : isEnd ? "end" : "activity",
          sub: subs.has(n),
          waste: waste.has(n),
        },
      });
    }
    if (flow.some((e) => e.to === END)) {
      elements.push({ data: { id: END, label: "End", kind: "event", role: "end-event" } });
    }
    // The edges: between steps first (the ones the transactions take before
    // the ones set in Steps, so dagre keeps the recorded order and turns a
    // loop back, not the path it returns to), then from the start and to the end.
    const ordered = flow.filter((e) => e.from !== START && e.to !== END)
      .concat(flow.filter((e) => e.from === START), flow.filter((e) => e.from !== START && e.to === END));
    for (const e of ordered) {
      const freq = e.frequency || 0;
      const totalMs = e.total_ms || 0;
      const data = {
        id: e.from + SEP + e.to,
        source: e.from,
        target: e.to,
        freq,
        totalMs,
        observed: !!e.observed,
        width: timeWeighted
          ? 1 + 5 * Math.sqrt(totalMs / maxMs)
          : 1 + 5 * Math.sqrt(freq / maxFreq),
      };
      // C17: the analyst's condition on the line, short; whole in the tooltip.
      if (e.label) { data.label = _shortLabel(e.label); data.fullLabel = e.label; }
      if (e.from === e.to) data.loop = true;
      elements.push({ data });
    }

    if (cy) { try { cy.destroy(); } catch (_) {} cy = null; }
    const tok = PdtTheme.dfgStyleTokens();
    cy = cytoscape({
      container: host,
      elements,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-family": '"Plus Jakarta Sans", -apple-system, "Segoe UI", system-ui, sans-serif',
            "font-size": BOX_FONT,
            // Colours come from theme.js (PdtTheme.dfgStyleTokens) -- cytoscape
            // renders to a <canvas> and cannot read CSS vars, so the active
            // theme's token snapshot is read fresh on each render().
            color: tok.fg,
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-max-width": BOX_TEXT_MAX,
            shape: "round-rectangle",
            "background-color": tok.bg2,
            "border-color": tok.rule,
            "border-width": 1,
            padding: "10px",
            // Lane FX3: the label's own size (_boxLabelSize), not the
            // deprecated "label" value.
            width: (ele) => _boxLabelSize(ele.data("label")).width,
            height: (ele) => _boxLabelSize(ele.data("label")).height,
          },
        },
        {
          selector: 'node[role = "start"]',
          style: {
            "background-color": tok.bg2,
            "border-color": tok.accent,
            "border-width": 1.5,
          },
        },
        {
          selector: 'node[role = "end"]',
          style: {
            "background-color": tok.bg2,
            "border-color": tok.bad,
            "border-width": 1.5,
          },
        },
        {
          // C19: a sub-process's box: its mark at the bottom, below the
          // label, which moves up to make room for it.
          selector: "node[?sub]",
          style: {
            "background-image": _subMark(tok),
            "background-width": 18,
            "background-height": 18,
            "background-position-x": "50%",
            "background-position-y": "100%",
            "background-offset-y": -4,
            padding: "17px",
            "text-margin-y": -9,
          },
        },
        {
          // Lane FX2: a box flagged as waste: its border dashed, its last
          // line the word Waste.
          selector: "node[?waste]",
          style: { "border-style": "dashed", "border-width": 2 },
        },
        {
          // Lane FX3: the dashes in the muted text colour, not the faint
          // hairline (about 1.3:1 on the box in the dark theme; now 5:1, and
          // 3.2:1 in the light one). A first or last step keeps its colour.
          selector: 'node[?waste][role = "activity"]',
          style: { "border-color": tok.fg3 },
        },
        {
          // C17: the process's start and end, small circles named beside them.
          selector: 'node[kind = "event"]',
          style: {
            shape: "ellipse",
            width: 18,
            height: 18,
            padding: 0,
            "background-color": tok.bg2,
            "border-color": tok.accent,
            "border-width": 2,
            "font-size": 11,
            color: tok.fg2,
            "text-valign": "center",
            "text-halign": "left",
            "text-margin-x": -5,
          },
        },
        {
          selector: 'node[role = "end-event"]',
          style: { "border-color": tok.fg2, "border-width": 4, "text-halign": "right", "text-margin-x": 5 },
        },
        {
          selector: "edge",
          style: {
            width: "data(width)",
            "line-color": tok.fg3,
            "target-arrow-color": tok.fg3,
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
          },
        },
        {
          // A path set in Steps that no transaction took.
          selector: "edge[!observed]",
          style: { "line-style": "dashed", "line-dash-pattern": [6, 4] },
        },
        {
          // C17: the analyst's condition, on the line, level and boxed so it
          // reads over the lines; hovering it shows the edge's tooltip.
          selector: "edge[label]",
          style: {
            label: "data(label)",
            "font-family": FONT_FAMILY,
            "font-size": LABEL_FONT,
            color: tok.fg,
            "text-rotation": "none",
            "text-background-color": tok.bg,
            "text-background-opacity": 1,
            "text-background-padding": "2px",
            "text-background-shape": "roundrectangle",
            "text-border-color": tok.rule,
            "text-border-width": 1,
            "text-border-opacity": 1,
            "text-events": "yes",
          },
        },
        {
          // The route dagre gave the line (_dagreLayout).
          selector: "edge.routed",
          style: {
            "curve-style": "round-segments",
            "segment-weights": (ele) => (ele.scratch("pdtRoute") || {}).weights,
            "segment-distances": (ele) => (ele.scratch("pdtRoute") || {}).distances,
            "segment-radius": 14,
            "edge-distances": "node-position",
          },
        },
        {
          // A loop on one box (a link to a step with the same box).
          selector: "edge[?loop]",
          style: { "curve-style": "bezier", "loop-direction": "-45deg", "loop-sweep": "-90deg", "control-point-step-size": 60 },
        },
        {
          selector: "edge:selected, node:selected",
          style: { "line-color": tok.accent, "border-color": tok.accent },
        },
      ],
      // dagre lays the map out below (_dagreLayout); without it, the
      // cytoscape-dagre layout, without the routes. (Not "preset": its fit
      // measures the boxes before their labels are, and cytoscape then keeps
      // them as taking no space, so they are never drawn.)
      layout: dagreLib ? { name: "null" }
        : dagreRegistered
          ? {
              name: "dagre",
              rankDir: "LR",       // left-to-right layered flow, not a radial hub
              nodeSep: 30,
              rankSep: 80,
              edgeSep: 10,
            }
          : { name: "breadthfirst", directed: true, spacingFactor: 1.1 },
    });
    if (dagreLib) {
      try { _dagreLayout(cy); } catch (e) {
        console.error("[dfg-viewer] the map layout failed:", e);
        cy.layout(dagreRegistered ? { name: "dagre", rankDir: "LR", nodeSep: 30, rankSep: 80, edgeSep: 10 }
          : { name: "breadthfirst", directed: true, spacingFactor: 1.1 }).run();
      }
    }
    // Debug/test handle: expose the cytoscape instance on the container so the
    // verification harness can drive node taps (the canvas has no clickable DOM).
    host.__cy = cy;
    if (onNodeClick) {
      cy.on("tap", "node", (e) => {
        // The start and end events are no step: nothing to open.
        if (e.target.data("kind") === "event") return;
        // Surface the original DOM event so the picker can position
        // itself near the cursor (P1.5).
        onNodeClick(e.target.data("id"), e.originalEvent || null);
      });
    }
    // C19: a double-click on a sub-process's box opens its map. The map is
    // drawn again for it, so the call waits until this event is done.
    if (onNodeDblClick) {
      cy.on("dbltap", "node", (e) => {
        if (!e.target.data("sub")) return;
        const id = e.target.data("id");
        setTimeout(() => onNodeDblClick(id), 0);
      });
    }
    // Persist a dragged node arrangement so it survives a re-render / re-open;
    // the caller shows Reset layout once there is one (opts.onLayoutChange).
    cy.on("dragfree", "node", () => {
      _saveLayout(cy);
      if (typeof opts.onLayoutChange === "function") opts.onLayoutChange();
    });

    /* §B2 / P2.4: edge hover tooltip. The canvas has no DOM titles, so a
       small positioned div says what the arrow carries, in words: how often
       the runs took it and the time from entering one step to entering the
       next (mostly the first step's own time, not a wait between them).
       C17: a condition set in Steps comes first, whole; a path set in Steps
       that no transaction took says so instead of a count. */
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const tip = document.createElement("div");
    tip.className = "dfg-edge-tip";
    tip.style.display = "none";
    host.appendChild(tip);
    cy.on("mouseover", "edge", (e) => {
      const freq = e.target.data("freq") || 0;
      const totalMs = e.target.data("totalMs") || 0;
      const full = e.target.data("fullLabel");
      let text = !full ? "" : full === OTHERWISE ? "Otherwise. " : "When " + full + ". ";
      if (!e.target.data("observed")) {
        text += "Set in Steps: no transaction's steps go this way.";
      } else {
        text += "Taken " + freq + (freq === 1 ? " time." : " times.");
        if (totalMs > 0) {
          text += " Start of one step to start of the next: " + _fmtDur(totalMs) + " in all" +
            (freq > 1 ? ", " + _fmtDur(totalMs / freq) + " on average." : ".");
        }
      }
      tip.textContent = text;
      const p = e.renderedPosition ||
        (e.originalEvent && { x: e.originalEvent.offsetX, y: e.originalEvent.offsetY });
      if (p) {
        tip.style.left = Math.max(0, Math.round(p.x + 10)) + "px";
        tip.style.top = Math.max(0, Math.round(p.y - 24)) + "px";
      }
      tip.style.display = "";
    });
    cy.on("mouseout", "edge", () => { tip.style.display = "none"; });
    // Any pan/zoom invalidates the anchored position — just hide it.
    cy.on("pan zoom", () => { tip.style.display = "none"; });

    setTimeout(() => {
      _restoreLayout(cy);   // re-apply any saved drags over the fresh dagre layout
      _fitReadable(cy);
    }, 50);
  }

  /* Take the drawn graph down (the host then shows a message instead), so no
     export can read a map that is no longer on screen. */
  function clear() {
    if (cy) {
      try { delete cy.container().__cy; } catch (_) {}
      try { cy.destroy(); } catch (_) {}
      cy = null;
    }
  }

  function fit() { _fitReadable(cy); }

  /* The host changed size (the step panel opened or closed beside it): the
     map fits it again, so no box is left cut off at its edge (2.0.1). */
  function resize() {
    if (!cy) return;
    try { cy.resize(); _fitReadable(cy); } catch (_) { /* the map went away */ }
  }

  /* A node click selects the node (the accent `node:selected` style); the
     step panel beside the map says what the box stands for (V2 item 4; the
     old tip, "step · entered 5x · left 5x", is gone). Returns true when the
     node was found. */
  function selectNode(id) {
    if (!cy || id == null) return false;
    const node = cy.getElementById(String(id));
    if (!node || node.empty()) return false;
    cy.nodes().unselect();
    node.select();
    return true;
  }

  module.exports = { render, clear, fit, resize, selectNode, layoutSaved, resetLayout, MIN_READABLE_ZOOM };
})();
