# Design critique — full-surface pass (2026-07-01)

> Method: drove the released-shape viewer (v1.3.0 master) via the in-repo e2e launch
> recipe against the committed demo session (re-analyzed, then reverted), screenshotted
> every surface (Overview / Flow / Steps+detail / Phases / Map+drawer / Analysis top-to-
> bottom / Compare / Template / App Library / dark theme), and ran clipping + density
> probes. Zero page errors. Brief being judged against: **calm by default, deep on
> demand** — readable, meaningful, actionable data without clutter; an on-demand
> analytical layer the analyst can open when they want more.
>
> All fixes below stay inside the Honesty Redesign (Memo / Evidence / Machine +
> tier gates, LAB-PHASE-SPEC §1). No new taxonomy. A preference-collapse is never a
> substitute for a tier gate — gates always win.

## Verdict in one line

The architecture already *is* the brief (Overview-first memo layer, tier-gated
Evidence, Machine drawers) — the remaining work is polish where default surfaces
render **zero-information or duplicated content that looks like a result**.

## To-do — priority order

### P1 — defaults that render noise as if it were signal

- [x] **1. Collapse the video stage when no recording is linked (Flow view).**
  ~40% of the viewport is a black "No OBS recording linked" box even though the
  session bar itself says `VIDEO no recording`. When the manifest has no video,
  render a slim band (one line + "Link recording…" affordance) and give the space
  to the timeline + notes panel. *Verify: e2e screenshot of Flow with the demo
  session; guard could pin stage height < timeline height when no video.*
- [x] **2. Gate "Waste by screen" like its sibling "Process efficiency" (Analysis).**
  Before any waste/business-required judgment exists, it renders a wall of
  identical full-width green bars — zero information that *looks like* "all
  value-add", while Process efficiency correctly withholds with a call-to-action.
  Same replace-pattern: until ≥1 step is judged, show the CTA, not default-green.
- [x] **3. Floor the €-ROI hero figure (Analysis).** "0.01 h saved per year" renders
  at hero (34px) weight on short sessions. Below a floor (e.g. < 1 h/yr) replace the
  hero with a sentence: "Under an hour a year at observed volume — more recorded
  instances would size this." An analyst pasting the hero into a memo gets laughed
  at; it undercuts the honesty brand the rest of the panel earns.

### P2 — clutter and duplication on the default path

- [x] **4. De-duplicate the findings feed (Overview).** The same italic methodology
  sentence repeats verbatim under each finding of the same detector (3× for
  repetition findings on the demo). Show it once per detector group or behind ⓘ.
  Consider folding the mono evidence line + explainer behind the card so the
  resident card is claim + "include in memo" (memo layer), evidence one click in
  (evidence layer).
- [x] **5. Render screenshot evidence as a chip/thumbnail, not a raw path.**
  "★ screenshots/shot_04.png" is a Machine-layer string sitting in the memo layer.
- [x] **6. Print each automation-candidate chain once (Analysis).** The full
  step-chain name appears twice per candidate row (bold title + gray sub-line) and
  a third time in the ROI table below. Once, with "+N more" expansion.
- [ ] **7. Give un-vocabed labels an affordance instead of leaking raw tokens.**
  `va01` surfaces as-is in the step list, the map node, and every Analysis row —
  correct data, but it reads as debris and nothing tells the analyst the one-click
  cure. Extend the existing right-click "Add to App Library…" (Steps view, Phase H
  G-8) to map nodes and Analysis rows, or minimally style unmatched labels with a
  subtle "unnamed control" tooltip pointing at the App Library.
  **Investigated and skipped (2026-07-01):** detecting "no vocab match" IS
  available (an interaction's `meaningful_name` is absent), but the Analysis
  "Where the time goes" row (`.ts-row`) is an aggregate across every instance of
  a `process_label` group — potentially many distinct interactions/controls —
  while the existing "Add to App Library…" flow needs ONE interaction's
  signature. Picking a representative interaction would be new, un-scoped
  aggregation logic with a real risk of silently misnaming the wrong control.
  An honest skip beats a hack; map nodes were already excluded from scope.
- [x] **8. Merge the duplicate case-state chips (Overview).** "✓ 4 cases — marked by
  the worker" (badge) and "CASE ANALYSIS ON" (chip) state the same fact in two
  vocabularies. One badge, subtitle carries the second clause.
- [x] **9. Demote the resident session chip row.** EVENTS / STATUS / VIDEO /
  ANALYZED / VOCABS chips persist on every session surface but are static session
  metadata — the collapsed SESSION SUMMARY band's job. Fold them into it (or show
  only state that can change mid-session).
- [x] **10. Compress the Template and App Library prose landings.** Both lead with
  2–3 paragraphs before the first control. One-sentence definition + primary
  actions resident; the rest behind a "How this works ▸" disclosure. (Copy stays
  business-English per the UI copy guide.)
- [x] **11. Tighten the Compare empty state and make its pointer a button.** Two
  long italic paragraphs → one sentence + disclosure; "see each session's
  Overview" should be the same CTA-button pattern the locked map uses
  (`data-map-cta` equivalent), not prose.

### P3 — smaller legibility / consistency fixes

- [x] **12. Strengthen the active-notation tab state on the map toolbar.** The
  selected "Process diagram"/"Flow diagram" tab reads as *disabled* (gray-on-gray);
  the active tab needs the accent treatment other selected controls get.
- [x] **13. Silence the Steps mini-timeline chips below a width threshold.** At
  default zoom the chips render clipped one-letter fragments ("S..", "E" — probe
  measured 111–155px overflow). Below the threshold render color-only chips;
  text appears on zoom.
- [x] **14. Split the mixed fact tile (Overview).** "1 RE-TYPED VALUES / 9 repeated
  sequences" is two metrics in one tile plus a grammar slip. Two tiles, or
  re-word ("Re-typed value · 1", subtitle "9 repeated sequences" only if the
  pairing is intentional). **Landed as:** kept one tile (splitting to 7 would
  crowd/wrap the 6-tile-tuned 980px row) but fixed the grammar slip.
- [x] **15. One name for the grain control.** Helper copy says "Grain slider", the
  control label says "DETAIL:", Analysis copy says "Detail slider". Pick "Detail"
  everywhere (business-English rule already bans "grain" in rendered copy).
- [x] **16. Use the plain-disabled style for "Delete template" on the empty Template
  view.** Currently the most color-saturated control on the surface is a disabled
  destructive action — the eye lands on it first.
- [x] **17. Collapse the raw signature block per interaction row (App Library).**
  CONTROL_TYPE / CLASS_NAME / AUTOMATION_ID / WINDOW_TITLE_REGEX inputs sit at
  equal weight with MEANINGFUL NAME + the semantics strip. Machine layer inside
  the card: "Match signature ▸" collapsed by default, semantics strip stays.
- [x] **18. Overflow the App Library toolbar.** Seven buttons; "Reload list" and
  "Open YAML in editor" are Machine-layer verbs — demote to a "⋯" menu next to the
  primary actions.
- [x] **19. Hide "Scope to playhead" on Overview.** There is no visible
  playhead/timeline on that level; the link is orphaned chrome.
- [x] **20. Ellipsize the timeline app labels.** `tl-act-app` "Chrome" clips by
  ~13px in narrow bands (probe-confirmed) — needs ellipsis/min-width. **Root
  cause:** a flex-column min-width:auto default kept the label's own box wider
  than the band; `min-width: 0` fixed it.

### P4 — the "configurable analytical modules" ask (new, small scope)

- [x] **21. Per-analyst collapse state for Analysis sections.** The Analysis view is
  a fixed stack (Efficiency → Waste → Where-the-time-goes → Candidates → ROI).
  Make each section header a disclosure and persist collapsed state per analyst
  (localStorage, like `pdt.theme`). This delivers "configurable modules" inside
  the existing taxonomy: preference hides an *Evidence* module for *this analyst*;
  tier gates still decide whether a module may render at all, and a gated section
  keeps its replace-pattern CTA even when "expanded". Do **not** build a dashboard
  builder — collapse + persistence is the coherent step. *Coherence checklist
  applies: inverse (expand), legend (chevron affordance), control interaction
  (Detail slider + case filter unaffected), real-run check in e2e.*

## What already works — keep, and don't regress

- **Overview-first landing** is exactly the calm memo layer the brief asks for:
  badge → six fact tiles → findings with "include in memo". (Pinned by
  `e2e/overview-smoke.js`.)
- **The honesty gates double as progressive disclosure** — Tier-2 replace-pattern,
  withheld efficiency figure, wage-less ROI withholding monetary figures, the map's
  ADVANCED VIEWS drawer with its "exploration, not evidence" caveat, Machine-layer
  YAML drawers on Template/App Library.
- **The slimmed default map** (one connected screen-grain chain, time-weighted
  edges) is readable at a glance; expert content stays in the drawer.
- **Empty states teach** (Phases view lists both creation paths; step detail's
  "pick a step" panel explains flags and where non-per-step facts live).
- **Theming** — dark is a true recolour; per-view helper lines are dismissible;
  no console errors anywhere on the tour.

## Screenshots

Session-scratch only (not committed): `01-overview…10-overview-dark` under the
session scratchpad; regenerate with the e2e launch recipe in
[CHIP-GUARDRAILS.md](../CHIP-GUARDRAILS.md) → "How to drive the viewer".
