"use strict";

/*
 * finding-cards.js -- the shared finding-card component (lab-phase §D2,
 * re-altituded by the disclosure pass DISCLOSURE-MODEL rule 1).
 *
 * One card = one detector claim + its measured evidence. Extracted from
 * overview-view.js so the Overview findings feed and the Compare
 * surface's cross-session divergence feed render the SAME component
 * (same .ov-finding markup + styles) -- the two feeds cannot drift
 * apart visually or in what a "finding" looks like.
 *
 * Disclosure altitude (DISCLOSURE-MODEL rule 1: "lead with the sentence"):
 *   Resident  = tier chip + claim sentence + "include in PDD" checkbox
 *               + an expand chevron.
 *   Expand-in-place (hidden until the card/chevron is clicked, inline, no
 *               navigation) = the mono evidence line, the screenshot chip,
 *               "Show on timeline", any caller detail, and the methodology
 *               note (how it was measured).
 * The card is a pure string builder (no DOM, no State); callers wire the
 * expand toggle + the action clicks. Action affordances are opt-in --
 *   opts.timelineTarget(f)  truthy => the "Show on timeline" button
 *                           (Overview only; a cross-session finding has
 *                           no single timeline to jump).
 *   opts.memoSelection      a Set of finding ids => the "include in
 *                           PDD" checkbox, pre-checked from the set
 *                           (annotations.memo_selection feeds the PDD).
 *   opts.detailHtml(f)      extra pre-built HTML inserted after the
 *                           evidence numbers (Compare uses it for the
 *                           per-worker breakdown line).
 *   opts.screenshots        false => omit the screenshot chip(s) (a
 *                           surface with no screenshots to open, e.g.
 *                           Compare). Default: render them as chips.
 *   opts.omitMethodology    true => drop the per-card methodology note
 *                           (the caller renders it once per detector
 *                           group instead -- DISCLOSURE-MODEL rule 3).
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

/* Screenshot evidence renders as a friendly chip that OPENS the image
   (DISCLOSURE-MODEL rule 4: a raw path is never resident). The raw path
   stays reachable as the chip's title/tooltip. The caller wires the
   click (data-act="shot", data-shot="<relPath>") to the security-hardened
   openScreenshot() -- this builder never opens anything itself. */
function _screenshotChips(refs) {
  return (refs || []).map((r) =>
    '<button type="button" class="ov-finding-shot" data-act="shot" ' +
    'data-shot="' + escapeAttr(r) + '" title="Open screenshot: ' + escapeAttr(r) + '">' +
    '<span class="ov-shot-star">★</span> screenshot</button>').join(" ");
}

/** One finding card. See the module header for `opts`. */
function findingCardHtml(f, opts) {
  opts = opts || {};
  const ev = f.evidence || {};
  const nums = evidenceNumbers(ev);
  const refs = opts.screenshots === false ? [] : (ev.screenshot_refs || []).slice(0, 2);
  const target = typeof opts.timelineTarget === "function" ? opts.timelineTarget(f) : null;
  const memo = opts.memoSelection instanceof Set
    ? '<label class="ov-memo-check" title="Ticked findings are included in the exported PDD">' +
      '<input type="checkbox" data-act="memo"' + (opts.memoSelection.has(f.id) ? " checked" : "") + " /> include in PDD</label>"
    : "";
  const show = target
    ? '<button type="button" class="link-btn" data-act="show" title="Jump the Flow timeline (and video) to this finding\'s evidence">Show on timeline</button>'
    : "";
  const detail = typeof opts.detailHtml === "function" ? (opts.detailHtml(f) || "") : "";
  const method = (!opts.omitMethodology && f.confidence_note)
    ? '<div class="ov-finding-note">' + escapeHtml(f.confidence_note) + "</div>"
    : "";
  const shots = _screenshotChips(refs);

  // Evidence layer -- everything the reader clicks to reach. When there is
  // nothing behind the claim (no numbers, detail, screenshot, timeline or
  // method), the chevron is omitted so a bare finding stays a flat card.
  const evidenceBody =
    (nums ? '<div class="ov-finding-evidence">' + escapeHtml(nums) + "</div>" : "") +
    detail +
    (shots ? '<div class="ov-finding-refs">' + shots + "</div>" : "") +
    (show ? '<div class="ov-finding-actions">' + show + "</div>" : "") +
    method;
  const hasEvidence = !!evidenceBody.trim();

  const chevron = hasEvidence
    ? '<button type="button" class="ov-finding-expand" data-act="expand" aria-expanded="false" ' +
      'title="Show the evidence behind this finding">▸</button>'
    : "";

  return '<div class="ov-finding" data-fid="' + escapeAttr(f.id || "") + '">' +
    '<div class="ov-finding-head">' +
      '<span class="ov-finding-tier t' + (f.tier || 1) + '" title="' +
        (f.tier === 2 ? "Based on the identified cases — needs confirmed cases to be reliable"
                      : "Measured directly from the recording — no case identification needed") +
        '">' + (f.tier === 2 ? "case-based" : "measured") + "</span>" +
      '<span class="ov-finding-claim">' + escapeHtml(f.claim || "") + "</span>" +
      chevron +
    "</div>" +
    (memo ? '<div class="ov-finding-memo">' + memo + "</div>" : "") +
    (hasEvidence
      ? '<div class="ov-finding-body" hidden>' + evidenceBody + "</div>"
      : "") +
    "</div>";
}

module.exports = { findingCardHtml, evidenceNumbers };
