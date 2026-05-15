/*
 * Variant flow visualization (P2.2 full).
 *
 * Renders trace_variants from PM4Py mining as a Sankey-style metro
 * map: each unique (column, activity) becomes a node, edges connect
 * consecutive activities across variants, node + edge widths scale
 * with the number of sessions / variants flowing through them.
 *
 * Alignment is position-by-position -- variant[0] = column 0 etc.
 * This is the same naive alignment PM4Py uses for trace_variants in
 * the first place (a "variant" IS a position-aligned activity
 * sequence). Variants of different lengths simply terminate at
 * different columns.
 *
 * Pure SVG, no dependencies. Hover / click handlers passed in by
 * the caller for drill-down behaviour.
 */

"use strict";

(function () {
  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (parent) parent.appendChild(el);
    return el;
  }
  function shortLabel(s, n) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  /*
   * Build the column / node / edge data structure from the variant list.
   *
   * Input:  [{ variant: ["A","B","C"], frequency: 12 }, ...]
   * Output: {
   *   columns: [
   *     [{ key, activity, freq, variantIdxs: [...], y, h }, ...],
   *     ...
   *   ],
   *   edges: [
   *     { fromCol, fromIdx, toIdx, freq, variantIdxs, path },
   *     ...
   *   ],
   *   maxColFreq,
   *   totalFreq,
   * }
   */
  function buildFlowData(variants) {
    const columns = [];
    const edges = [];
    // Walk each variant; place each activity at column = its index.
    variants.forEach((v, vIdx) => {
      const seq = v.variant || [];
      const freq = v.frequency || 1;
      for (let col = 0; col < seq.length; col++) {
        if (!columns[col]) columns[col] = [];
        const act = seq[col];
        let node = columns[col].find((n) => n.activity === act);
        if (!node) {
          node = { activity: act, freq: 0, variantIdxs: [], col };
          columns[col].push(node);
        }
        node.freq += freq;
        node.variantIdxs.push(vIdx);
        // Edge from previous column.
        if (col > 0) {
          const prevAct = seq[col - 1];
          const fromIdx = columns[col - 1].findIndex((n) => n.activity === prevAct);
          const toIdx = columns[col].findIndex((n) => n.activity === act);
          let edge = edges.find((e) =>
            e.fromCol === col - 1 && e.fromIdx === fromIdx && e.toIdx === toIdx);
          if (!edge) {
            edge = { fromCol: col - 1, fromIdx, toIdx, freq: 0, variantIdxs: [] };
            edges.push(edge);
          }
          edge.freq += freq;
          edge.variantIdxs.push(vIdx);
        }
      }
    });
    // Sort each column by frequency desc (most common at top).
    for (const col of columns) col.sort((a, b) => b.freq - a.freq);
    // Recompute edge fromIdx / toIdx after sort.
    for (const e of edges) {
      const fromAct = variants[e.variantIdxs[0]].variant[e.fromCol];
      const toAct   = variants[e.variantIdxs[0]].variant[e.fromCol + 1];
      e.fromIdx = columns[e.fromCol].findIndex((n) => n.activity === fromAct);
      e.toIdx   = columns[e.fromCol + 1].findIndex((n) => n.activity === toAct);
    }
    let maxColFreq = 0;
    let totalFreq = 0;
    for (const col of columns) {
      let sum = 0;
      for (const n of col) sum += n.freq;
      if (sum > maxColFreq) maxColFreq = sum;
    }
    for (const v of variants) totalFreq += (v.frequency || 1);
    return { columns, edges, maxColFreq, totalFreq };
  }

  /*
   * Render the flow into `host` element. opts:
   *   onNodeClick(activity, variantIdxs) -- click on a node
   *   onEdgeClick(fromAct, toAct, variantIdxs) -- click on an edge
   *   maxColumns -- cap horizontal extent (default 40)
   */
  function render(host, variants, opts) {
    opts = opts || {};
    host.innerHTML = "";
    if (!variants || !variants.length) {
      host.innerHTML = '<div style="color:var(--fg-3);font-style:italic;padding:12px">No variants to render. Analyze sessions first to populate.</div>';
      return;
    }
    const data = buildFlowData(variants);
    if (!data.columns.length) { host.innerHTML = '<div style="color:var(--fg-3);padding:12px">Empty variants.</div>'; return; }
    const maxCols = Math.min(opts.maxColumns || 40, data.columns.length);
    if (data.columns.length > maxCols) {
      data.columns = data.columns.slice(0, maxCols);
      // Drop edges that go past the cap.
      for (let i = data.edges.length - 1; i >= 0; i--) {
        if (data.edges[i].fromCol >= maxCols - 1) data.edges.splice(i, 1);
      }
    }

    // Layout constants
    const COL_W = 140;          // horizontal spacing between column centers
    const COL_X0 = 40;          // left margin
    const TOP_PAD = 16;
    const BOT_PAD = 24;
    const NODE_W = 110;
    const MIN_NODE_H = 18;
    const MAX_NODE_H = 60;
    const NODE_GAP = 6;
    const HEIGHT_BUDGET_PER_COL = 380;

    // Compute per-column node heights from frequency.
    for (const col of data.columns) {
      const sum = col.reduce((a, n) => a + n.freq, 0) || 1;
      // Each column gets HEIGHT_BUDGET_PER_COL of vertical space minus
      // gap allowance.
      const gapTotal = NODE_GAP * Math.max(0, col.length - 1);
      const usable = Math.max(MIN_NODE_H * col.length, HEIGHT_BUDGET_PER_COL - gapTotal);
      let y = TOP_PAD;
      for (const n of col) {
        const frac = n.freq / sum;
        n.h = Math.max(MIN_NODE_H, Math.min(MAX_NODE_H, frac * usable));
        n.y = y;
        n.x = COL_X0 + n.col * COL_W;
        y += n.h + NODE_GAP;
      }
    }

    const totalCols = data.columns.length;
    const width = COL_X0 + totalCols * COL_W + 60;
    const colHeights = data.columns.map((col) => {
      if (!col.length) return 0;
      const last = col[col.length - 1];
      return last.y + last.h;
    });
    const height = Math.max(200, Math.max(...colHeights) + BOT_PAD);

    const svg = svgEl("svg", {
      width, height,
      viewBox: `0 0 ${width} ${height}`,
      class: "variant-flow-svg",
    });
    host.appendChild(svg);

    // Edges first so nodes render on top.
    const maxEdgeFreq = data.edges.reduce((m, e) => Math.max(m, e.freq), 1);
    const edgeGroup = svgEl("g", { class: "vf-edges" }, svg);
    for (const e of data.edges) {
      const fromNode = data.columns[e.fromCol][e.fromIdx];
      const toNode = data.columns[e.fromCol + 1] && data.columns[e.fromCol + 1][e.toIdx];
      if (!fromNode || !toNode) continue;
      const x1 = fromNode.x + NODE_W;
      const y1 = fromNode.y + fromNode.h / 2;
      const x2 = toNode.x;
      const y2 = toNode.y + toNode.h / 2;
      const ctrlX = (x1 + x2) / 2;
      const sw = Math.max(1, Math.round((e.freq / maxEdgeFreq) * 12));
      const path = svgEl("path", {
        d: `M ${x1} ${y1} C ${ctrlX} ${y1}, ${ctrlX} ${y2}, ${x2} ${y2}`,
        fill: "none",
        stroke: "var(--accent)",
        "stroke-width": sw,
        "stroke-opacity": 0.45,
        class: "vf-edge",
      }, edgeGroup);
      const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
      t.textContent = `${fromNode.activity} → ${toNode.activity}\n${e.freq} session(s) follow this transition`;
      path.appendChild(t);
      if (opts.onEdgeClick) {
        path.style.cursor = "pointer";
        path.addEventListener("mouseenter", () => {
          path.setAttribute("stroke-opacity", "0.9");
          path.setAttribute("stroke", "var(--accent-3)");
        });
        path.addEventListener("mouseleave", () => {
          path.setAttribute("stroke-opacity", "0.45");
          path.setAttribute("stroke", "var(--accent)");
        });
        path.addEventListener("click", () =>
          opts.onEdgeClick(fromNode.activity, toNode.activity, e.variantIdxs.slice()));
      }
    }

    // Nodes.
    const nodeGroup = svgEl("g", { class: "vf-nodes" }, svg);
    for (const col of data.columns) {
      const sum = col.reduce((a, n) => a + n.freq, 0);
      const isDivergence = col.length > 1;
      for (const n of col) {
        const g = svgEl("g", { class: "vf-node", transform: `translate(${n.x}, ${n.y})` }, nodeGroup);
        svgEl("rect", {
          width: NODE_W, height: n.h,
          rx: 3, ry: 3,
          fill: isDivergence ? "var(--accent-3)" : "var(--accent-2)",
          "fill-opacity": 0.85,
          stroke: "var(--rule)",
        }, g);
        const label = svgEl("text", {
          x: NODE_W / 2,
          y: n.h / 2 + 4,
          "text-anchor": "middle",
          "font-size": Math.min(11, Math.max(9, n.h / 3)),
          fill: "var(--bg)",
          "pointer-events": "none",
        }, g);
        label.textContent = shortLabel(n.activity, 16);
        const freqLabel = svgEl("text", {
          x: NODE_W / 2,
          y: n.h - 3,
          "text-anchor": "middle",
          "font-size": 8,
          fill: "var(--bg)",
          "pointer-events": "none",
          opacity: 0.85,
        }, g);
        freqLabel.textContent = n.freq + (sum && col.length > 1 ? ` (${Math.round(n.freq / sum * 100)}%)` : "");
        const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
        t.textContent = n.activity + "\n" + n.freq + " session(s) reach this position";
        g.appendChild(t);
        if (opts.onNodeClick) {
          g.style.cursor = "pointer";
          g.addEventListener("click", () => opts.onNodeClick(n.activity, n.variantIdxs.slice()));
        }
      }
      // Column index label at the bottom.
      const colLabel = svgEl("text", {
        x: data.columns[0] ? col[0].x + NODE_W / 2 : COL_X0,
        y: height - 6,
        "text-anchor": "middle",
        "font-size": 9,
        fill: "var(--fg-3)",
      }, svg);
      colLabel.textContent = "step " + (col[0].col + 1);
    }
  }

  window.PdtVariantFlow = { render, buildFlowData };
})();
