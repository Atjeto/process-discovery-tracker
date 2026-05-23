/*
 * DFG (Directly-Follows Graph) renderer using cytoscape + dagre layout.
 * Loaded via <script> in index.html so the cytoscape global is
 * available before this script runs.
 */

"use strict";

(function () {
  if (typeof cytoscape === "undefined") return;
  if (typeof cytoscapeDagre !== "undefined") {
    cytoscape.use(cytoscapeDagre);
  } else if (typeof window.cytoscapeDagre !== "undefined") {
    cytoscape.use(window.cytoscapeDagre);
  }

  let cy = null;

  const PdtTheme = require("./theme.js");

  /* H3 conformance-overlay colours. Fixed semantic hexes (not theme
     tokens) so "matches the template" / "off-template" read the same in
     both themes; chosen to sit legibly on the light and dark DFG
     backgrounds alike. */
  const CONF_GREEN = "#4f9d5b";
  const CONF_AMBER = "#cf9233";

  /* Persist a dragged DFG layout so it survives a re-render (tab/level switch)
     and a re-open, keyed by the exact node set: a different graph gets a fresh
     dagre layout and a changed node set self-heals (only matching nodes are
     repositioned). localStorage, because the DFG is built live and has no
     .bpmn to save into like the Process diagram does. */
  function _hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function _layoutStore() { try { return window.localStorage; } catch (_) { return null; } }
  function _layoutKey(c) { return "pdt.dfgLayout." + _hash(c.nodes().map((n) => n.id()).sort().join("")); }
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

  function render(host, dfg, opts) {
    opts = opts || {};
    host.innerHTML = "";
    if (!dfg || !dfg.edges || !dfg.edges.length) {
      host.innerHTML = '<div class="map-empty-inline">no DFG data</div>';
      return;
    }
    const onNodeClick = opts.onNodeClick;
    /* H3: when a conformance map is supplied, every node is coloured
       green (matches a canonical step) or amber (off-template). */
    const conformance = opts.conformance || null;
    const nodes = new Set();
    for (const e of dfg.edges) { nodes.add(e.source); nodes.add(e.target); }
    const maxFreq = Math.max(...dfg.edges.map((e) => e.frequency || 1));
    const elements = [];
    for (const n of nodes) {
      const isStart = dfg.start_activities && dfg.start_activities[n];
      const isEnd = dfg.end_activities && dfg.end_activities[n];
      elements.push({
        data: {
          id: n,
          label: n,
          role: isStart ? "start" : isEnd ? "end" : "activity",
          conf: conformance ? (conformance[n] || "amber") : null,
        },
      });
    }
    for (const e of dfg.edges) {
      elements.push({
        data: {
          id: `${e.source}__${e.target}`,
          source: e.source,
          target: e.target,
          freq: e.frequency || 1,
          width: 1 + 5 * Math.sqrt((e.frequency || 1) / maxFreq),
        },
      });
    }

    if (cy) { try { cy.destroy(); } catch (_) {} cy = null; }
    const tok = PdtTheme.dfgStyleTokens();
    cy = cytoscape({
      container: host,
      elements,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-family": '"Plus Jakarta Sans", -apple-system, "Segoe UI", system-ui, sans-serif',
            "font-size": 11,
            // Colours come from theme.js (PdtTheme.dfgStyleTokens) -- cytoscape
            // renders to a <canvas> and cannot read CSS vars, so the active
            // theme's token snapshot is read fresh on each render().
            color: tok.fg,
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-max-width": 130,
            shape: "round-rectangle",
            "background-color": tok.bg2,
            "border-color": tok.rule,
            "border-width": 1,
            padding: "10px",
            width: "label",
            height: "label",
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
        // H3 conformance overlay -- listed after role styles so the
        // conformance border wins when a map is supplied.
        {
          selector: 'node[conf = "green"]',
          style: { "border-color": CONF_GREEN, "border-width": 3 },
        },
        {
          selector: 'node[conf = "amber"]',
          style: { "border-color": CONF_AMBER, "border-width": 3 },
        },
        {
          selector: "edge",
          style: {
            width: "data(width)",
            "line-color": tok.fg3,
            "target-arrow-color": tok.fg3,
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(freq)",
            "font-family": '"JetBrains Mono", Consolas, monospace',
            "font-size": 9,
            color: tok.fg2,
            "text-background-color": tok.bg,
            "text-background-opacity": 0.85,
            "text-background-padding": 2,
          },
        },
        {
          selector: "edge:selected, node:selected",
          style: { "line-color": tok.accent, "border-color": tok.accent },
        },
        // Variant overlay (Phase E): hovering a node highlights the
        // session paths through it and dims everything else.
        {
          selector: ".vh-dim",
          style: { opacity: 0.12 },
        },
        {
          selector: "node.vh-on",
          style: { "border-color": tok.accent3, "border-width": 2.5 },
        },
        {
          selector: "edge.vh-on",
          style: { "line-color": tok.accent3, "target-arrow-color": tok.accent3 },
        },
      ],
      layout: {
        name: typeof dagre !== "undefined" || typeof window.dagre !== "undefined"
          ? "dagre"
          : "breadthfirst",
        rankDir: "LR",
        nodeSep: 30,
        rankSep: 80,
        edgeSep: 10,
      },
    });
    // Debug/test handle: expose the cytoscape instance on the container so the
    // verification harness can drive node taps (the canvas has no clickable DOM).
    host.__cy = cy;
    if (onNodeClick) {
      cy.on("tap", "node", (e) => {
        // Surface the original DOM event so the picker can position
        // itself near the cursor (P1.5).
        onNodeClick(e.target.data("id"), e.originalEvent || null);
      });
    }
    // Persist a dragged node arrangement so it survives a re-render / re-open.
    cy.on("dragfree", "node", () => _saveLayout(cy));
    if (opts.onZoomChange) {
      cy.on("zoom", () => opts.onZoomChange(cy.zoom()));
    }

    // Variant overlay (Phase E). Pre-index, for every activity, the set
    // of node ids and edge ids on variants passing through it. On node
    // hover, dim everything outside that union.
    const variants = opts.variants || [];
    if (variants.length) {
      const nodeIndex = new Map();  // activity -> Set(node ids)
      const edgeIndex = new Map();  // activity -> Set(edge ids)
      for (const v of variants) {
        const seq = v.variant || [];
        const vNodes = new Set(seq);
        const vEdges = new Set();
        for (let i = 0; i < seq.length - 1; i++) {
          vEdges.add(seq[i] + "__" + seq[i + 1]);
        }
        for (const act of seq) {
          if (!nodeIndex.has(act)) nodeIndex.set(act, new Set());
          if (!edgeIndex.has(act)) edgeIndex.set(act, new Set());
          for (const n of vNodes) nodeIndex.get(act).add(n);
          for (const e of vEdges) edgeIndex.get(act).add(e);
        }
      }
      cy.on("mouseover", "node", (e) => {
        const act = e.target.data("id");
        const keepNodes = nodeIndex.get(act);
        const keepEdges = edgeIndex.get(act);
        if (!keepNodes) return;  // activity not on any variant
        cy.elements().addClass("vh-dim");
        cy.nodes().forEach((n) => {
          if (keepNodes.has(n.data("id"))) {
            n.removeClass("vh-dim").addClass("vh-on");
          }
        });
        cy.edges().forEach((ed) => {
          if (keepEdges.has(ed.data("id"))) {
            ed.removeClass("vh-dim").addClass("vh-on");
          }
        });
      });
      cy.on("mouseout", "node", () => {
        cy.elements().removeClass("vh-dim vh-on");
      });
    }
    setTimeout(() => {
      _restoreLayout(cy);   // re-apply any saved drags over the fresh dagre layout
      try { cy.fit(undefined, 24); } catch (_) {}
      if (opts.onZoomChange && cy) opts.onZoomChange(cy.zoom());
    }, 50);
  }

  function fit() { if (cy) { try { cy.fit(undefined, 24); } catch (_) {} } }
  function zoomIn() {
    if (!cy) return;
    const c = cy.extent();
    cy.zoom({ level: cy.zoom() * 1.25,
              renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }
  function zoomOut() {
    if (!cy) return;
    cy.zoom({ level: cy.zoom() / 1.25,
              renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }
  function getZoom() { return cy ? cy.zoom() : 1; }

  /* Export the current DFG as a standalone SVG. cytoscape has no
     native SVG export (that needs the cytoscape-svg extension, which
     isn't bundled), so we serialize the graph by hand: a rect + label
     per node, a line + arrowhead per edge. Coordinates come straight
     from the laid-out graph via node.position() / .width() / .height().
     Good enough for Figma / Lucidchart import. The palette below is
     intentionally the light theme regardless of the viewer's current
     theme -- an exported diagram goes into a document, which expects a
     light background. */
  function exportSvg() {
    if (!cy) return null;
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const PAD = 30;
    const bb = cy.elements().boundingBox();
    const W = Math.ceil(bb.w + PAD * 2);
    const H = Math.ceil(bb.h + PAD * 2);
    const ox = PAD - bb.x1;
    const oy = PAD - bb.y1;
    const parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W +
      '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">');
    parts.push('<desc>Process Discovery Tracker - Flow diagram (DFG)</desc>');
    parts.push('<rect width="' + W + '" height="' + H + '" fill="#faf8f4"/>');
    parts.push('<defs><marker id="arr" markerWidth="8" markerHeight="8" ' +
      'refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#9a8e7e"/></marker></defs>');
    // Edges first so nodes sit on top.
    cy.edges().forEach((ed) => {
      const s = ed.source().position(), t = ed.target().position();
      const x1 = s.x + ox, y1 = s.y + oy, x2 = t.x + ox, y2 = t.y + oy;
      const w = ed.data("width") || 1.5;
      parts.push('<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
        '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
        '" stroke="#9a8e7e" stroke-width="' + w.toFixed(1) +
        '" marker-end="url(#arr)"/>');
    });
    // Nodes.
    cy.nodes().forEach((n) => {
      const p = n.position();
      const w = n.width(), h = n.height();
      const x = p.x + ox - w / 2, y = p.y + oy - h / 2;
      const role = n.data("role");
      const border = role === "start" ? "#c07830" : role === "end" ? "#a05a3a" : "#e5ddd0";
      parts.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) +
        '" rx="6" fill="#ffffff" stroke="' + border + '" stroke-width="1.5"/>');
      parts.push('<text x="' + (p.x + ox).toFixed(1) + '" y="' + (p.y + oy + 4).toFixed(1) +
        '" font-family="sans-serif" font-size="11" fill="#2c2418" ' +
        'text-anchor="middle">' + esc(n.data("label") || "") + '</text>');
    });
    parts.push('</svg>');
    return parts.join("\n");
  }

  module.exports = { render, fit, zoomIn, zoomOut, getZoom, exportSvg };
})();
