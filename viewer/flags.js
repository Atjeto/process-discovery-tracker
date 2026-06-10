/*
 * flags.js -- viewer feature flags (config switches, default OFF).
 *
 * The honesty redesign's cargo-cult cuts (lab-phase spec §1) take
 * heuristic affordances OUT of the default flow without deleting the
 * code: a flag here re-enables one deliberately. Flags persist in the
 * viewer user-config (localStorage, like pdt.theme / pdt.dataPosture)
 * and are read at module-wire time -- flipping one takes effect on the
 * next reload (Ctrl+R).
 *
 * Current flags:
 *   autoPhaseSuggest -- the Phases view's "Suggest groupings..."
 *     heuristic (continuous-work blocks). §D3: phases come from the
 *     Process Template (or the analyst's own grouping) by default;
 *     the auto-suggestion renders only when this flag is set. Enable
 *     from the DevTools console:
 *       require("./flags.js").setFlag("autoPhaseSuggest", true)
 *
 * Existing data is never touched: a session whose annotations already
 * carry phases (template rollup, manual grouping, or a past
 * suggestion) renders them regardless of any flag.
 *
 * A leaf module (no DOM): guarded localStorage so node:test can
 * require it headlessly, mirroring posture.js.
 */

"use strict";

const FLAG_PREFIX = "pdt.flag.";

/* The known flags and their defaults. An unknown name reads as false. */
const FLAG_DEFAULTS = {
  autoPhaseSuggest: false,
};

/* In-memory fallback where localStorage is absent (node:test). */
const _mem = Object.create(null);

function flagEnabled(name) {
  if (!(name in FLAG_DEFAULTS)) return false;
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(FLAG_PREFIX + name);
      if (v === "1") return true;
      if (v === "0") return false;
      return FLAG_DEFAULTS[name];
    }
  } catch (_) { /* fall through to memory */ }
  if (name in _mem) return _mem[name];
  return FLAG_DEFAULTS[name];
}

function setFlag(name, on) {
  if (!(name in FLAG_DEFAULTS)) return false;
  _mem[name] = !!on;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FLAG_PREFIX + name, on ? "1" : "0");
    }
  } catch (_) { /* memory copy already holds it */ }
  return true;
}

module.exports = { flagEnabled, setFlag, FLAG_DEFAULTS };
