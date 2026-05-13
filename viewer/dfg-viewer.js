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
            "font-family": '-apple-system, "Segoe UI", system-ui, sans-serif',
            "font-size": 11,
            color: "#EDE7D3",
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-max-width": 130,
            shape: "round-rectangle",
            "background-color": "#25232F",
            "border-color": "#3A3744",
            "border-width": 1,
            padding: "10px",
            width: "label",
            height: "label",
          },
        },
        {
          selector: 'node[role = "start"]',
          style: {
            "background-color": "#3A4A38",
            "border-color": "#8BA17A",
            "border-width": 2,
          },
        },
        {
          selector: 'node[role = "end"]',
          style: {
            "background-color": "#4A3A2E",
            "border-color": "#C26F4A",
            "border-width": 2,
          },
        },
        {
          selector: "edge",
          style: {
            width: "data(width)",
            "line-color": "#4D4858",
            "target-arrow-color": "#7A7388",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(freq)",
            "font-size": 10,
            color: "#8A8278",
            "text-background-color": "#13121A",
            "text-background-opacity": 0.85,
            "text-background-padding": 2,
          },
        },
        {
          selector: "edge:selected, node:selected",
          style: { "line-color": "#8BA17A", "border-color": "#8BA17A" },
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
    setTimeout(() => { try { cy.fit(undefined, 24); } catch (_) {} }, 50);
  }

  function fit() { if (cy) { try { cy.fit(undefined, 24); } catch (_) {} } }

  window.PdtDfg = { render, fit };
})();
