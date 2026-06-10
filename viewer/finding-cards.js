"use strict";

/*
 * finding-cards.js -- the shared finding-card component (lab-phase §D2).
 *
 * One card = one detector claim + its measured evidence. Extracted from
 * overview-view.js so the Overview findings feed and the Compare
 * surface's cross-session divergence feed render the SAME component
 * (same .ov-finding markup + styles) -- the two feeds cannot drift
 * apart visually or in what a "finding" looks like.
 *
 * Pure string builders (no DOM, no State): callers wire their own
 * actions. Action affordances are opt-in --
 *   opts.timelineTarget(f)  truthy => the "Show on timeline" button
 *                           (Overview only; a cross-session finding has
 *                           no single timeline to jump).
 *   opts.memoSelection      a Set of finding ids => the "include in
 *                           memo" checkbox, pre-checked from the set.
 *   opts.detailHtml(f)      extra pre-built HTML inserted after the
 *                           evidence numbers (Compare uses it for the
 *                           per-worker breakdown line).
 */

const { escapeHtml, escapeAttr, formatDuration } = require("./dom.js");

function _fmt(ms) { return formatDuration(ms || 0); }
function _pct(x) { return Math.round((x || 0) * 100) + "%"; }

/* The scalar evidence numbers, compact -- mirrors memo_export's rendering
   so the feed and the memo read the same. */
function evidenceNumbers(ev) {
  const parts = [];
  for (const [k, v] of Object.entries(ev || {})) {
    if (typeof v !== "number" || !isFinite(v)) continue;
    if (k.endsWith("_ms")) parts.push(k.replace(/_/g, " ") + " " + _fmt(v));
    else if (k === "share" || k === "coverage") parts.push(k + " " + _pct(v));
    else parts.push(k.replace(/_/g, " ") + " " + (Number.isInteger(v) ? v : v.toFixed(2)));
  }
  return parts.join(" · ");
}

/** One finding card. See the module header for `opts`. */
function findingCardHtml(f, opts) {
  opts = opts || {};
  const ev = f.evidence || {};
  const nums = evidenceNumbers(ev);
  const refs = (ev.screenshot_refs || []).slice(0, 2);
  const target = typeof opts.timelineTarget === "function" ? opts.timelineTarget(f) : null;
  const memo = opts.memoSelection instanceof Set
    ? '<label class="ov-memo-check" title="Selected findings render in the exported memo (annotations.json memo_selection)">' +
      '<input type="checkbox" data-act="memo"' + (opts.memoSelection.has(f.id) ? " checked" : "") + " /> include in memo</label>"
    : "";
  const show = target
    ? '<button type="button" class="link-btn" data-act="show" title="Jump the Flow timeline (and video) to this finding\'s evidence">Show on timeline</button>'
    : "";
  const actions = (show || memo)
    ? '<div class="ov-finding-actions">' + show + memo + "</div>"
    : "";
  const detail = typeof opts.detailHtml === "function" ? (opts.detailHtml(f) || "") : "";
  return '<div class="ov-finding" data-fid="' + escapeAttr(f.id || "") + '">' +
    '<div class="ov-finding-head">' +
      '<span class="ov-finding-tier t' + (f.tier || 1) + '" title="' +
        (f.tier === 2 ? "Tier 2 — case-based" : "Tier 1 — measured, no cases needed") +
        '">T' + (f.tier || 1) + "</span>" +
      '<span class="ov-finding-claim">' + escapeHtml(f.claim || "") + "</span>" +
    "</div>" +
    (nums ? '<div class="ov-finding-evidence">' + escapeHtml(nums) + "</div>" : "") +
    detail +
    (refs.length ? '<div class="ov-finding-refs">' +
      refs.map((r) => "★ <code>" + escapeHtml(r) + "</code>").join(" ") + "</div>" : "") +
    (f.confidence_note ? '<div class="ov-finding-note">' + escapeHtml(f.confidence_note) + "</div>" : "") +
    actions + "</div>";
}

module.exports = { findingCardHtml, evidenceNumbers };
