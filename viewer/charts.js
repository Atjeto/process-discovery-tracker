/*
 * Inline SVG charts -- bar and ranked-list. No external deps.
 *
 * Lives in the renderer process. Renders into a host element.
 * Re-renders idempotently by clearing the host first.
 */

"use strict";

function svgEl(tag, attrs, parent) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    el.setAttribute(k, v);
  }
  if (parent) parent.appendChild(el);
  return el;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function shortLabel(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Horizontal bar chart sorted by value desc.
 * data: [{ label, value, secondary? }]
 * opts: { unit, color, secondaryColor, maxBars }
 */
function renderBarChart(host, data, opts) {
  opts = opts || {};
  host.innerHTML = "";
  if (!data || !data.length) {
    host.innerHTML = '<div class="chart-empty">no data</div>';
    return;
  }
  const maxBars = opts.maxBars || 12;
  const rows = data.slice(0, maxBars);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const labelW = 160;
  const barH = 18;
  const gap = 6;
  const valueW = 70;
  const width = host.clientWidth || 360;
  const height = rows.length * (barH + gap) + 12;
  const svg = svgEl("svg", {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    class: "bar-chart",
  });
  host.appendChild(svg);
  const barAreaX = labelW + 10;
  const barAreaW = Math.max(60, width - barAreaX - valueW - 10);
  rows.forEach((row, i) => {
    const y = i * (barH + gap) + 4;
    const w = Math.max(2, (row.value / max) * barAreaW);
    // Label
    const lbl = svgEl("text", {
      x: labelW,
      y: y + barH * 0.7,
      "text-anchor": "end",
      class: "bar-label",
    }, svg);
    lbl.textContent = shortLabel(row.label, 26);
    lbl.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "title"));
    lbl.lastChild.textContent = row.label;
    // Bar
    svgEl("rect", {
      x: barAreaX,
      y,
      width: w,
      height: barH,
      rx: 3,
      class: "bar-rect",
      fill: opts.color || "var(--accent)",
    }, svg);
    // Secondary bar (e.g. p90) overlay
    if (row.secondary != null) {
      const w2 = Math.max(2, (row.secondary / max) * barAreaW);
      svgEl("rect", {
        x: barAreaX,
        y: y + barH - 4,
        width: w2,
        height: 3,
        class: "bar-secondary",
        fill: opts.secondaryColor || "var(--warn)",
      }, svg);
    }
    // Value text
    const valTxt = svgEl("text", {
      x: barAreaX + w + 6,
      y: y + barH * 0.72,
      class: "bar-value",
    }, svg);
    valTxt.textContent = row.valueLabel || `${row.value}${opts.unit || ""}`;
    // P1.7: tiny sparkline (10-bucket histogram of timestamps) at the
    // bar's right edge, when caller passed `sparkline` data. Adds
    // temporal context to a frequency or duration chart -- "this
    // activity clustered early" vs "spread evenly".
    if (Array.isArray(row.sparkline) && row.sparkline.length) {
      const sparkW = 60, sparkH = barH - 4;
      const sparkX = width - sparkW - 4;
      const sparkY = y + 2;
      const buckets = row.sparkline;
      const maxB = Math.max(1, ...buckets);
      const bw = sparkW / buckets.length;
      // Background strip so sparse rows still register.
      svgEl("rect", {
        x: sparkX, y: sparkY, width: sparkW, height: sparkH,
        fill: "var(--bg-3)", opacity: 0.5, rx: 1,
      }, svg);
      buckets.forEach((b, bi) => {
        if (!b) return;
        const h = Math.max(1, Math.round(sparkH * (b / maxB)));
        svgEl("rect", {
          x: sparkX + bi * bw,
          y: sparkY + sparkH - h,
          width: Math.max(1, bw - 0.5),
          height: h,
          fill: "var(--accent-2)",
          opacity: 0.85,
        }, svg);
      });
      // Title for hover-discoverability.
      const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
      t.textContent = "Time distribution across the session";
      svg.lastChild.appendChild(t);
    }
  });
  if (data.length > maxBars) {
    const more = svgEl("text", {
      x: width / 2,
      y: height - 2,
      "text-anchor": "middle",
      class: "chart-more",
    }, svg);
    more.textContent = `+ ${data.length - maxBars} more`;
  }
}

function fmtDurationS(s) {
  if (s == null) return "-";
  if (s < 1) return `${(s * 1000).toFixed(0)}ms`;
  if (s < 60) return `${s.toFixed(1)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

module.exports = { renderBarChart, fmtDurationS };
