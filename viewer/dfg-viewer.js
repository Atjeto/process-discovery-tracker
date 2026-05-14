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
            color: "#CCCAC2",
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-max-width": 130,
            shape: "round-rectangle",
            "background-color": "#19191E",
            "border-color": "#242429",
            "border-width": 1,
            padding: "10px",
            width: "label",
            height: "label",
          },
        },
        {
          selector: 'node[role = "start"]',
          style: {
            "background-color": "#19191E",
            "border-color": "#6E8A66",
            "border-width": 1.5,
          },
        },
        {
          selector: 'node[role = "end"]',
          style: {
            "background-color": "#19191E",
            "border-color": "#885A42",
            "border-width": 1.5,
          },
        },
        {
          selector: "edge",
          style: {
            width: "data(width)",
            "line-color": "#464440",
            "target-arrow-color": "#6A6862",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(freq)",
            "font-family": '"IBM Plex Mono", Consolas, monospace',
            "font-size": 9,
            color: "#6A6862",
            "text-background-color": "#131316",
            "text-background-opacity": 0.85,
            "text-background-padding": 2,
          },
        },
        {
          selector: "edge:selected, node:selected",
          style: { "line-color": "#6E8A66", "border-color": "#6E8A66" },
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
      cy.on("tap", "node", (e) => onNodeClick(e.target.data("id")));
    }
    if (opts.onZoomChange) {
      cy.on("zoom", () => opts.onZoomChange(cy.zoom()));
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
