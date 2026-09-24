/*
 * flow-view-apps.js: per-app colour, the system a timeline band names, and
 * the timeline legend for the Flow level. Extracted from flow-view.js
 * (god-file split): pure presentation helpers with no back-references into
 * the Flow view.
 *
 * A band is coloured by its application and named by its system: the one
 * vocabulary of systems (shared/system-names.json, contract C14), so a
 * Chrome window on Salesforce reads "Salesforce", as in the step pane, the
 * map and the PDD.
 */

"use strict";

const PdtTheme = require("../theme.js");
const { systemName } = require("../system-names.js");

/* Per-app colour. Known apps get fixed assignments so the same colour
   is stable across sessions; unknown apps get a deterministic slot via
   a small hash so they stay stable too. The palettes -- and the
   light/dark split -- live in theme.js; bands are solid fills carrying
   white labels, so every colour is deep enough to clear white text. */
function appColor(app) {
  const { map, palette, fallback } = PdtTheme.appColors();
  if (!app) return fallback;
  if (map[app]) return map[app];
  let h = 0;
  const s = app.toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/* The system a band of `app` with window title `title` names; `names` is the
   recording's own names (stats.json meta.app_names). */
function appLabel(app, title, names) {
  return systemName(app, title, names) || String(app || "unknown").replace(/\.exe$/i, "");
}

/* The legend: one entry per system the timeline draws, with its band's
   colour. `observed` maps a system to the application its bands came from. */
function renderLegend(observed) {
  const host = document.getElementById("legend-apps");
  if (!host) return;
  host.innerHTML = "";
  const entries = [...(observed || new Map())].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [system, app] of entries) {
    const span = document.createElement("span");
    span.className = "legend-app";
    const sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = appColor(app);
    span.appendChild(sw);
    span.appendChild(document.createTextNode(system));
    host.appendChild(span);
  }
}

module.exports = { appColor, appLabel, renderLegend };
