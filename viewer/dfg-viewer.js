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
  let _host = null;   // the container of the current render — for the node-info tip

  const PdtTheme = require("./theme.js");

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

  /* Compact duration for the edge tooltip ("1h 04m", "4m 32s", "12s",
     "<1s"). Mirrors the Python claim formatter. */
  function _fmtDur(ms) {
    const s = Math.round((ms || 0) / 1000);
    if (s < 1) return "<1s";
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60), rs = s % 60;
    if (m < 60) return rs ? m + "m " + String(rs).padStart(2, "0") + "s" : m + "m";
    const h = Math.floor(m / 60), rm = m % 60;
    return h + "h " + String(rm).padStart(2, "0") + "m";
  }

  function render(host, dfg, opts) {
    opts = opts || {};
    _host = host;
    _hideNodeTip();
    host.innerHTML = "";
    if (!dfg || !dfg.edges || !dfg.edges.length) {
      host.innerHTML = '<div class="map-empty-inline">no DFG data</div>';
      return;
    }
    const onNodeClick = opts.onNodeClick;
    const nodes = new Set();
    for (const e of dfg.edges) { nodes.add(e.source); nodes.add(e.target); }
    // reduce, not Math.max(...spread): a large DFG (thousands of edges) would
    // overflow the JS argument-count limit and throw.
    const maxFreq = dfg.edges.reduce((m, e) => Math.max(m, e.frequency || 1), 1);
    /* §B2 time-weighted edges: when the caller asks for edgeWeight "time"
       AND the edges carry measured `total_ms`, the thickness encodes the
       accumulated transition TIME (the process map). The numbers (how often
       the path was taken, its time) are one hover away in the edge tooltip,
       never drawn on the arrow (P2.4: an unexplained number read as a wait).
       With no measurable time anywhere the map degrades honestly to the
       count weighting rather than rendering uniform noodles. */
    const maxMs = dfg.edges.reduce((m, e) => Math.max(m, e.total_ms || 0), 0);
    const timeWeighted = opts.edgeWeight === "time" && maxMs > 0;
    const elements = [];
    for (const n of nodes) {
      const isStart = dfg.start_activities && dfg.start_activities[n];
      const isEnd = dfg.end_activities && dfg.end_activities[n];
      elements.push({
        data: {
          id: n,
          label: n,
          role: isStart ? "start" : isEnd ? "end" : "activity",
        },
      });
    }
    for (const e of dfg.edges) {
      const freq = e.frequency || 1;
      const totalMs = e.total_ms || 0;
      elements.push({
        data: {
          id: `${e.source}__${e.target}`,
          source: e.source,
          target: e.target,
          freq,
          totalMs,
          width: timeWeighted
            ? 1 + 5 * Math.sqrt(totalMs / maxMs)
            : 1 + 5 * Math.sqrt(freq / maxFreq),
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
          selector: "edge:selected, node:selected",
          style: { "line-color": tok.accent, "border-color": tok.accent },
        },
      ],
      layout: dagreRegistered
        ? {
            name: "dagre",
            rankDir: "LR",       // left-to-right layered flow, not a radial hub
            nodeSep: 30,
            rankSep: 80,
            edgeSep: 10,
          }
        : { name: "breadthfirst", directed: true, spacingFactor: 1.1 },
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

    /* §B2 / P2.4: edge hover tooltip. The canvas has no DOM titles, so a
       small positioned div says what the arrow carries, in words: how often
       the runs took it and the time from entering one step to entering the
       next (mostly the first step's own time, not a wait between them). */
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const tip = document.createElement("div");
    tip.className = "dfg-edge-tip";
    tip.style.display = "none";
    host.appendChild(tip);
    cy.on("mouseover", "edge", (e) => {
      const freq = e.target.data("freq") || 1;
      const totalMs = e.target.data("totalMs") || 0;
      let text = "Taken " + freq + (freq === 1 ? " time." : " times.");
      if (totalMs > 0) {
        text += " Start of one step to start of the next: " + _fmtDur(totalMs) + " in all" +
          (freq > 1 ? ", " + _fmtDur(totalMs / freq) + " on average." : ".");
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
      try { cy.fit(undefined, 24); } catch (_) {}
    }, 50);
  }

  /* Take the drawn graph down (the host then shows a message instead), so no
     export can read a map that is no longer on screen. */
  function clear() {
    _hideNodeTip();
    if (cy) { try { cy.destroy(); } catch (_) {} cy = null; }
    if (_host) { try { delete _host.__cy; } catch (_) {} }
  }

  function fit() { if (cy) { try { cy.fit(undefined, 24); } catch (_) {} } }

  /* ---- Node select + info reveal (NAV-AUDIT §E1) --------------------------
     A node click on the process map is a SELECT + REVEAL, never a view change:
     the node is selected (the accent `node:selected` style) and a small info
     tip — label, role, and how many times the flow enters/leaves it — is shown
     beside it. Built from the graph the viewer already has (no new data), and
     styled to mirror the existing `.dfg-edge-tip` so it reads as one family. */
  function _hideNodeTip() {
    if (_host) {
      const t = _host.querySelector(".dfg-node-tip");
      if (t) t.style.display = "none";
    }
  }
  /* Select a node by id and reveal its info tip. Returns true when the node was
     found and revealed, false otherwise (caller can fall back). */
  function selectNode(id) {
    if (!cy || !_host || id == null) return false;
    const node = cy.getElementById(String(id));
    if (!node || node.empty()) return false;
    cy.nodes().unselect();
    node.select();

    // Throughput from the live edges: sum the traversal counts in / out.
    let inCount = 0, outCount = 0;
    node.connectedEdges().forEach((e) => {
      const f = e.data("freq") || 0;
      if (e.data("target") === node.id()) inCount += f;
      if (e.data("source") === node.id()) outCount += f;
    });
    const role = node.data("role");
    const roleWord = role === "start" ? "start of the flow"
      : role === "end" ? "end of the flow" : "step";

    if (getComputedStyle(_host).position === "static") _host.style.position = "relative";
    let tip = _host.querySelector(".dfg-node-tip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "dfg-node-tip";
      _host.appendChild(tip);
    }
    const parts = [String(node.data("label") || node.id()), roleWord];
    if (inCount) parts.push("entered " + inCount + "×");
    if (outCount) parts.push("left " + outCount + "×");
    tip.textContent = parts.join(" · ");
    const p = node.renderedPosition();
    const rh = (node.renderedHeight && node.renderedHeight()) || 0;
    tip.style.display = "";
    // Position under the node; clamp into the host.
    tip.style.left = Math.max(0, Math.round(p.x - tip.offsetWidth / 2)) + "px";
    tip.style.top = Math.max(0, Math.round(p.y + rh / 2 + 6)) + "px";
    // Any pan/zoom invalidates the anchored position — hide it (same as edges).
    cy.off("pan zoom", _hideNodeTip);
    cy.on("pan zoom", _hideNodeTip);
    return true;
  }

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

  /* Rasterise the current Flow diagram to a PNG data URL for embedding in the
     PDD. Light background to match exportSvg (a document expects light).
     Returns null when no graph is rendered. */
  function exportPng() {
    if (!cy) return null;
    try {
      return cy.png({ output: "base64uri", bg: "#faf8f4", full: true, scale: 2 });
    } catch (e) {
      return null;
    }
  }

  module.exports = { render, clear, fit, selectNode, exportSvg, exportPng };
})();
