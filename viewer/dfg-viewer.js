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

  function render(host, dfg, opts) {
    opts = opts || {};
    host.innerHTML = "";
    if (!dfg || !dfg.edges || !dfg.edges.length) {
      host.innerHTML = '<div class="map-empty-inline">no DFG data</div>';
      return;
    }
    const onNodeClick = opts.onNodeClick;
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
    cy = cytoscape({
      container: host,
      elements,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-family": '"IBM Plex Sans", -apple-system, "Segoe UI", system-ui, sans-serif',
            "font-size": 11,
            // Token snapshot at write time (cytoscape doesn't read CSS vars).
            // Keep these aligned with viewer/styles.css :root tokens.
            color: "#D8D6CE",          // --fg
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-max-width": 130,
            shape: "round-rectangle",
            "background-color": "#2E2E37", // --bg-3
            "border-color": "#424250",     // --rule
            "border-width": 1,
            padding: "10px",
            width: "label",
            height: "label",
          },
        },
        {
          selector: 'node[role = "start"]',
          style: {
            "background-color": "#2E2E37", // --bg-3
            "border-color": "#6E8A66",     // --accent
            "border-width": 1.5,
          },
        },
        {
          selector: 'node[role = "end"]',
          style: {
            "background-color": "#2E2E37", // --bg-3
            "border-color": "#885A42",     // --bad
            "border-width": 1.5,
          },
        },
        {
          selector: "edge",
          style: {
            width: "data(width)",
            "line-color": "#5A5854",       // --fg-4
            "target-arrow-color": "#807E78", // --fg-3
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(freq)",
            "font-family": '"IBM Plex Mono", Consolas, monospace',
            "font-size": 9,
            color: "#807E78",              // --fg-3
            "text-background-color": "#22222A", // --bg-2
            "text-background-opacity": 0.85,
            "text-background-padding": 2,
          },
        },
        {
          selector: "edge:selected, node:selected",
          style: { "line-color": "#6E8A66", "border-color": "#6E8A66" },
        },
        // Variant overlay (Phase E): hovering a node highlights the
        // session paths through it and dims everything else.
        {
          selector: ".vh-dim",
          style: { opacity: 0.12 },
        },
        {
          selector: "node.vh-on",
          style: { "border-color": "#A08050", "border-width": 2.5 },
        },
        {
          selector: "edge.vh-on",
          style: { "line-color": "#A08050", "target-arrow-color": "#A08050" },
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
    if (onNodeClick) {
      cy.on("tap", "node", (e) => {
        // Surface the original DOM event so the picker can position
        // itself near the cursor (P1.5).
        onNodeClick(e.target.data("id"), e.originalEvent || null);
      });
    }
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

  window.PdtDfg = { render, fit, zoomIn, zoomOut, getZoom };
})();
