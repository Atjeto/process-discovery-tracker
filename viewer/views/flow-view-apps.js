/*
 * flow-view-apps.js -- per-app colour, display label, and the timeline
 * legend for the Flow level. Extracted from flow-view.js (god-file split):
 * pure presentation helpers with no back-references into the Flow view, so
 * flow-view.js just destructures these in place of the old local functions.
 */

"use strict";

const PdtTheme = require("../theme.js");

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

/* Friendly display name for known executables; falls back to the raw
   process name so unmapped apps remain identifiable in the legend. */
const APP_LABELS = {
  "chrome.exe": "Chrome", "msedge.exe": "Edge", "firefox.exe": "Firefox",
  "SAPGUI.exe": "SAP", "saplogon.exe": "SAP",
  "EXCEL.EXE": "Excel", "OUTLOOK.EXE": "Outlook",
  "winword.exe": "Word", "powerpnt.exe": "PowerPoint", "Teams.exe": "Teams",
};
function appLabel(app) { return APP_LABELS[app] || (app || "unknown").replace(/\.exe$/i, ""); }

function renderLegend(observedApps) {
  const host = document.getElementById("legend-apps");
  if (!host) return;
  host.innerHTML = "";
  const apps = Array.from(observedApps || []).sort();
  for (const app of apps) {
    const span = document.createElement("span");
    span.className = "legend-app";
    const sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = appColor(app);
    span.appendChild(sw);
    span.appendChild(document.createTextNode(appLabel(app)));
    host.appendChild(span);
  }
}

module.exports = { appColor, appLabel, renderLegend };
