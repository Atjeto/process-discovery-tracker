/*
 * theme.js -- viewer theme state, persistence, and the theme-dependent
 * JS colour palettes.
 *
 * The viewer ships two themes: the default light "Warm Editorial" and an
 * opt-in dark "Studio Dark". CSS chrome themes itself through the
 * `:root` / `:root[data-theme="dark"]` token blocks in styles.css; this
 * module owns the two things CSS variables cannot cover:
 *
 *   (a) the current-theme state, the topbar toggle's persistence, and a
 *       change-notification bus so JS-painted views can repaint; and
 *   (b) the colour palettes that are NOT CSS-variable driven -- the
 *       activity-band / step / phase palettes painted as inline styles,
 *       and the DFG token snapshot cytoscape needs (it renders to a
 *       <canvas> and cannot read CSS vars).
 *
 * A leaf module: it depends only on `document` / `localStorage`, so any
 * other module can require it with no circular-dependency risk.
 */

"use strict";

/* ---- persistence ------------------------------------------------- */

/* localStorage key. The inline pre-paint bootstrap in index.html's
   <head> reads the SAME key to set data-theme before first paint --
   keep the two in sync. */
const THEME_KEY = "pdt.theme"; // "light" | "dark"

function _read() {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch (_) { return "light"; }
}
function _write(name) {
  try { localStorage.setItem(THEME_KEY, name); } catch (_) {}
}

let _theme = _read();

/* ---- apply + change bus ------------------------------------------ */

/* Dark is signalled by data-theme="dark" on <html>; light is the
   attribute's absence (the bare :root block). */
function applyTheme(name) {
  if (typeof document === "undefined") return; // non-DOM env (e.g. node --test)
  const root = document.documentElement;
  if (name === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
}

/** @type {Set<(name: string) => void>} */
const _subs = new Set();

/**
 * Register `fn` to run after every theme change.
 * @param {(name: string) => void} fn
 * @returns {() => void} an unsubscribe function
 */
function onChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _notify() {
  for (const fn of [..._subs]) { // copy: a callback may (un)subscribe
    try { fn(_theme); }
    catch (e) { console.error("[theme] onChange subscriber threw:", e); }
  }
}

/** @returns {"light"|"dark"} */
function getTheme() { return _theme; }

/** Apply, persist, and notify -- the path the toggle goes through. */
function setTheme(name) {
  const next = name === "dark" ? "dark" : "light";
  if (next === _theme) return;
  _theme = next;
  applyTheme(_theme);
  _write(_theme);
  _notify();
}

function toggleTheme() { setTheme(_theme === "dark" ? "light" : "dark"); }

/* Re-assert the attribute at module load. The inline <head> bootstrap
   has normally set it already; this is an idempotent safety net and
   covers the light case explicitly. */
applyTheme(_theme);

/* ---- theme-dependent colour palettes ----------------------------- */

/* Activity-band colours (flow-view.js). Bands are solid fills carrying
   white labels, so each colour must be deep/saturated enough to clear
   white text. Light values are the originals; dark values are brighter
   and cooler so the bands read on the #171c2a base. */
const LIGHT_APP = {
  map: {
    "chrome.exe": "#b07a32", "msedge.exe": "#2f8a93", "firefox.exe": "#c0612f",
    "SAPGUI.exe": "#2f6f9f", "saplogon.exe": "#2f6f9f", "EXCEL.EXE": "#3f8a5c",
    "OUTLOOK.EXE": "#5b5fb0", "winword.exe": "#4a6f93", "powerpnt.exe": "#b5503a",
    "Teams.exe": "#7159a8",
  },
  palette: ["#2f6f9f", "#3f8a5c", "#b07a32", "#7159a8", "#2f8a93", "#c0612f", "#b5503a", "#5b5fb0"],
  fallback: "#505050",
};
const DARK_APP = {
  map: {
    "chrome.exe": "#e0a44a", "msedge.exe": "#2dd4bf", "firefox.exe": "#e8775a",
    "SAPGUI.exe": "#60a5fa", "saplogon.exe": "#60a5fa", "EXCEL.EXE": "#34d399",
    "OUTLOOK.EXE": "#8b8fd6", "winword.exe": "#7aa0c8", "powerpnt.exe": "#ef7a5a",
    "Teams.exe": "#a78bda",
  },
  palette: ["#60a5fa", "#34d399", "#e0a44a", "#a78bda", "#2dd4bf", "#e8775a", "#ef7a5a", "#8b8fd6"],
  fallback: "#4a5270",
};

/* DFG token snapshot -- cytoscape renders to <canvas> and cannot read
   CSS vars, so dfg-viewer.js reads this per render(). Keys mirror the
   styles.css :root tokens noted beside each value. */
const LIGHT_DFG = {
  fg: "#2c2418", fg2: "#635848", fg3: "#9a8e7e",
  bg: "#faf8f4", bg2: "#ffffff", rule: "#e5ddd0",
  accent: "#c07830", accent3: "#b08040", bad: "#a05a3a",
};
const DARK_DFG = {
  fg: "#e4e7f0", fg2: "#b4bcce", fg3: "#8c96b0",
  bg: "#171c2a", bg2: "#1e2436", rule: "#2e3650",
  accent: "#2dd4bf", accent3: "#fbbf24", bad: "#e8775a",
};

/** @returns {{map: Object, palette: string[], fallback: string}} */
function appColors()    { return _theme === "dark" ? DARK_APP : LIGHT_APP; }
/** @returns {Object} DFG hex snapshot for the active theme */
function dfgStyleTokens() { return _theme === "dark" ? DARK_DFG : LIGHT_DFG; }

module.exports = {
  getTheme, setTheme, applyTheme, toggleTheme, onChange,
  appColors, dfgStyleTokens,
};
