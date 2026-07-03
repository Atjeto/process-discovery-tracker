# Performance ceiling — 2026-07-03

Measured performance ceiling for the viewer at three synthetic-scale tiers.
Branch `redesign-r1`, HEAD `bbd1695`. Read-only on product code — no
viewer/pipeline/test/e2e file was changed to produce these numbers.

**Method caveat: one dev box, one run per cell, indicative not benchmark.**
Every number below is pasted from a single scripted run (no repeated trials,
no statistical spread) on one Windows 11 dev machine. Treat differences under
roughly 20% as noise; treat the multi-x jumps called out in *Knees* below as
signal.

## Method

Recreated the NAV-AUDIT-2026-07-03 §J scale-probe approach (its
`build-big.js`, scratchpad, outside the repo): read the demo session's
`events.jsonl` (155 events, `sessions/example-aggregate/sess-2026-0514-0900`),
repeat it N times with each repetition's timestamps shifted by `r x 15 min`,
every event given a fresh 16-byte hex id, each case-start marker label
suffixed ` rN`, `session_start`/`session_end` kept only on the first/last
repetition, then re-sorted monotonically. Three tiers were built (N=15/30/60)
into the scratchpad and each re-analyzed with
`viewer/python/python.exe normalization/normalize.py <tier-folder> --mine`.

Viewer measurements were driven with the in-repo Playwright launch
(`playwright-core` from `e2e/node_modules`, `viewer/node_modules/electron`),
light theme, window content size 1500x950, per CHIP-GUARDRAILS. Each tier was
launched twice: once cold (fresh `electron.launch()`), then closed and
launched a second time against the same session folder for the "warm" number
and for every subsequent measurement.

**Method deviation — "one warm reload" is a second launch, not `page.reload()`.**
The task's literal instruction was a warm *reload* before measuring. A first
attempt used Playwright's in-window `page.reload()`. This app's `main.js`
hands the initial `--session=<folder>` off to the renderer via
`mainWindow.webContents.once("did-finish-load", ...)` — a **one-shot**
listener. `page.reload()` fires a second `did-finish-load` that the listener
has already been consumed for, so the reloaded renderer comes back with
`State.getSession() === null`: `renderTimeline()` throws
`Cannot read properties of null (reading 'events')`, and every read of the
Steps list / case tree / map reads zero. Reproduced once (Tier 1, first run):
cold load 991ms `loaded=true`; `page.reload()` 60184ms `loaded=false` (the
`#session-loaded` wait timed out because the view never re-populates). An
in-window reload is therefore not a valid warm-measurement path for this app.
The OS/V8/disk-cache "warm" state the task intends was obtained instead by
launching Electron a **second time** against the same session folder; all
measurements ran against that second instance. This is a fact about
`viewer/main.js`'s one-shot IPC wiring, observed while producing this doc —
not a proposed change (no product code was touched).

Per tier: session load timing, Steps flat list at element notch, Steps case
tree at screen notch, Flow timeline (paint + one zoom-in/zoom-out round
trip), filter-box keystroke latency, Map at screen notch (Flow diagram /
DFG), DOM node total + JS heap, and one screenshot pass per surface
(scratchpad, referenced by filename below — not committed to the repo).

## Pipeline vitals (paste-verifiable, from each tier's `stats.json` `meta`)

| Tier | Multiplier | `raw_event_count` | `step_count` | `case_count` | Span (manifest) | `normalize.py --mine` wall time |
|---|---|---|---|---|---|---|
| 1 | x15 | 2297 | 960 | 60 | 3.60h | 8.3s |
| 2 | x30 | 4592 | 1920 | 120 | 7.34h | 6.3s |
| 3 | x60 | 9182 | 3840 | 240 | 14.85h | 15.1s |

Tier 1 reproduces the NAV-AUDIT §J baseline exactly (2297 raw events, span
3.60h, 960 steps, 60 cases — no divergence, so tiers 2/3 proceeded per the
task's stop condition). Tiers 2 and 3 scale linearly from Tier 1 (2x/4x
events -> 2x/4x steps and cases, as expected from a pure repeat-and-shift
synthetic build). No pipeline run failed, hung, or exceeded the 5-minute
budget — Tier 3's `--mine` pass, the heaviest, completed in 15.1s.

## The tier x surface table

Cold/warm load, and every subsequent row, are the **warm** (second-launch)
instance's numbers unless the row says otherwise.

| Surface / metric | Tier 1 (x15) | Tier 2 (x30) | Tier 3 (x60) |
|---|---|---|---|
| Cold session load -> Overview interactive (ms) | 1045 | 1330 | 1577 |
| Warm session load -> Overview interactive (ms) | 1168 | 1184 | 1577 |
| Steps flat list (element notch) render (ms) | 38 | 76 | 155 |
| Steps flat list DOM rows | 960 of 960 (1.00) | 1920 of 1920 (1.00) | 3840 of 3840 (1.00) |
| Steps case tree (screen notch) render (ms) | 27 | 51 | 103 |
| Steps case tree: case heads | 60 | 120 | 240 |
| Steps case tree: item rows (collapsed) | 0 (lazy) | 0 (lazy) | 0 (lazy) |
| Flow timeline initial paint (ms) | 46 | 90 | 184 |
| Flow timeline: activity bands | 315 | 630 | 1260 |
| Flow timeline: case bands | 60 | 120 | 240 |
| Flow timeline: case **labels** rendered | 0 | 0 | 0 |
| Flow timeline: step bands | 285 | 570 | 1140 |
| Flow timeline: minimap bands | 240 | 30 | 0 |
| Flow timeline: minimap container present | yes | yes | yes |
| Flow timeline: timeline width (px) | 1527 | 1531 | 1525 |
| Flow timeline: zoom-in + zoom-out round trip (ms) | 202 | 298 | 490 |
| Filter keystroke -> list update, end-to-end (ms) | 198 | 269 | 404 |
| Filter keystroke: rows before -> after ("SAP") | 960 -> 225 | 1920 -> 450 | 3840 -> 900 |
| Filter keystroke: fixed debounce share | 120ms = 61% of 198ms | 120ms = 45% of 269ms | 120ms = 30% of 404ms |
| Map (screen notch, Flow diagram/DFG) render (ms) | 51 | 50 | 51 |
| Map (screen notch): nodes / edges | 5 / 4 | 5 / 4 | 5 / 4 |
| Total DOM nodes (`querySelectorAll('*').length`) | 31 721 | 61 223 | 120 612 |
| JS heap (`performance.memory.usedJSHeapSize`) | 29.4 MB | 44.7 MB | 56.8 MB |
| Page errors (console + `pageerror`) | 0 | 0 | 0 |

`performance.memory` was available in every run (Electron/Chromium exposes
it by default here), so no tier needed the "unavailable" fallback.

## Subjective pass (screenshots in scratchpad, not the repo)

- `shot-tier1-flow.png` / `shot-tier2-flow.png` / `shot-tier3-flow.png` — the
  Flow timeline stays visually legible and un-broken at all three tiers: no
  layout collapse, no overlapping chrome, ticks/lanes/legend render cleanly.
  The repeating "Order #109xx..." text visible in every screenshot's densely
  packed middle band is the always-on **activity lane's title text**
  (`.tl-act-title`, e.g. "Salesforce - Order #10900 entry" truncated to fit) —
  a live DOM probe confirmed this directly (`querySelectorAll` on
  `.tl-case-label` returned 0 elements at all three tiers, matching the table
  row above; the visible text's class is `.tl-act-title`, not
  `.tl-case-label`). **Case labels (`.tl-case-label`) render 0 at every tier**
  — see *Knees* for the mechanism; this is unchanged across tiers, not a
  Tier-1-only-then-vanishes pattern. The minimap strip is visibly present at
  Tier 1, thin at Tier 2, and **empty space** at Tier 3 (container still
  there, zero bands drawn inside it — see *Knees*).
- `shot-tier1-steps-flat.png` / `shot-tier2-steps-flat.png` /
  `shot-tier3-steps-flat.png` — legible at all three tiers; the left panel
  scrolls, the mini step-timeline compresses into a denser but still-readable
  rhythm. Nothing clips or overlaps even at 3840 rows.
- `shot-tier1-steps-tree.png` / `shot-tier2-steps-tree.png` /
  `shot-tier3-steps-tree.png` — clean at all three tiers: collapsed case
  rows, one line each ("Order #10900 r0 - 5 items - 20.0s"). Confirms the
  NAV-AUDIT verdict that the case tree is "the graceful default" for Steps,
  now demonstrated to 240 cases with no visible strain.
- `shot-tier1-map.png` / `shot-tier2-map.png` / `shot-tier3-map.png` —
  **completely unaffected by scale**: the same 5-node/4-edge linear chain
  renders at all three tiers (the value-free screen axis rolls up cases into
  a small, fixed set of unique screens; case count does not fan the map out).
- `shot-tier1-overview.png` / `shot-tier2-overview.png` /
  `shot-tier3-overview.png` — Overview is unaffected by scale at all three
  tiers, consistent with the NAV-AUDIT Tier-1 finding.
- Nothing visibly broke, errored, or became unusable at any tier. Zero page
  errors were recorded across all three runs (18 total measurement passes:
  6 surfaces x 3 tiers).

## Knees

Where each surface's cost stops being linear with item/event count, or
confirmation that it stayed linear through Tier 3.

- **Steps flat list render, Steps case tree render, Flow timeline paint —
  linear, no knee through Tier 3.** Render time scales almost exactly with
  item count (2.00x/4.08x, 1.89x/3.81x, and 1.96x/4.00x respectively against
  a 2x/4x item-count scale) and stays under 200ms even at the top tier
  (3840 steps / 1260 activity bands). Nothing here strains by Tier 3.
- **Filter-box render cost is linear-to-slightly-sublinear per row** (0.081,
  0.078, 0.074 ms/row across the three tiers) — the filter mechanism itself
  holds up. The end-to-end number grows (198 -> 269 -> 404ms) only because
  the render portion grows with N while the 120ms debounce is fixed, so the
  debounce's *share* of the total shrinks from 61% to 30% as N grows. This is
  a favorable property, not a knee.
- **Map at screen notch — flat, no knee, insulated from case-count scale.**
  51/50/51ms and a constant 5 nodes / 4 edges at every tier: the value-free
  screen-grain roll-up (ADR-0024 §6a/6b) means the map's cost is a function
  of the number of distinct screens in the process, not the number of cases
  or events. This is the surface with the strongest declared strategy.
- **Case-label density — the NAV-AUDIT §J finding was fixed on this branch
  before this probe ran; the fix's own degrade point is "0 at every tier
  measured," confirmed directly.** The audit (Tier-1-equivalent, 60 case
  bands / 3.6h) found "60 case labels overlap into unreadable repetition"
  (top friction #9). Commit `4d4dca3` (already on this HEAD, landed the same
  day as the audit) added `caseLabelFits()` in
  `viewer/views/flow-view-timeline.js`: a case label renders only when its
  band is `>= CASE_LABEL_MIN_PX` (46px) wide on screen; narrower bands are a
  pure color stripe with the full label one hover away via the band's
  `title`. The commit's own verification note states "60->0 labels / 0
  overlaps at 3.6h" — i.e. even at the audit's original Tier-1-equivalent
  span, the fix already suppresses every case label at this window width.
  This probe's table row (`Flow timeline: case labels rendered` = 0/0/0)
  confirms that exactly at all three tiers, and a direct DOM probe
  (`querySelectorAll(".tl-case-label").length === 0`) verified it live
  rather than trusting the table alone — see *Ambiguities and resolutions*
  below (self-correction entry) for how this was caught. The
  repeating text visible in every flow screenshot is a different lane
  entirely (the always-on activity title band, `.tl-act-title`), unaffected
  by `caseLabelFits()`. Net: the audit's original friction (overlapping,
  unreadable labels) is gone, replaced by a different one — an analyst
  scanning any of these three tiers sees color-coded case stripes with **no
  case identity readable without hovering each one**, since the width floor
  that prevents overlap also prevents nearly all labels from ever appearing
  at these spans/window widths.
- **Flow timeline minimap — a real knee, degrades to empty.** Minimap bands
  go 240 -> 30 -> 0 across the three tiers, a non-linear collapse. Mechanism
  (`renderMinimap()`, `flow-view-timeline.js`): a band is skipped when
  `dur < span * 0.0005` — the filter threshold is **relative to the total
  session span**, while individual activity-event durations are fixed by the
  source data. As span grows (3.6h -> 7.3h -> 14.85h) the same durations
  increasingly fall under the growing relative floor. The minimap *container*
  never hides (`minimapPresent: true` at every tier — confirmed in
  `shot-tier3-flow.png`, an empty strip is visible where bands should be),
  so the visible result at Tier 3 is a blank strip rather than an honestly
  collapsed/hidden one. This is the clearest knee in the matrix.
- **Zoom round trip — grows with total rendered content, not case/step
  count directly.** 202 -> 298 -> 490ms (1.48x then 2.43x) while nothing else
  in that interaction scales linearly with the tier multiplier (it is always
  exactly one click-wait-click-wait sequence). The cost tracks the total
  number of DOM elements the zoom has to reflow/repaint (activity + case +
  step bands together, which do scale 2x/4x), so it is best read as a
  content-volume knee rather than a per-item one.
- **DOM node total — linear; JS heap — sub-linear (favorable).** DOM nodes
  track the tier multiplier closely (1.93x/3.80x against a 2x/4x events
  scale). Heap grows more slowly (1.52x/1.93x) than either DOM nodes or tier
  size, suggesting no runaway retention across the tiers measured.
- **Session load (cold and warm) — stayed flat and low, no knee.** 1045-1577ms
  cold, 1168-1577ms warm across all three tiers; well under a one-second-class
  budget even at 240 cases / 3840 steps.

## Thresholds and strategies

Per surface: the measured comfortable ceiling, the first symptom past it,
and a strategy recommendation. Every recommendation in this table is
**[recommendation — not scheduled work]**.

| Surface | Measured comfortable ceiling | First symptom past it | Strategy |
|---|---|---|---|
| Steps flat list (element notch) | Held to 3840 rows / 155ms in this probe; the NAV-AUDIT already named it unbounded (960-of-960 DOM rows, no windowing) | Slower first paint and scroll-panel jank as row count keeps climbing past what was measured here | [recommendation — not scheduled work] virtualize the flat list (windowed rendering) once real sessions are observed to approach this row count |
| Steps case tree (screen notch) | No ceiling found through 240 cases / 103ms; item rows are already lazy (0 until expanded) | None observed in this probe | [recommendation — not scheduled work] nothing needed — the lazy-expand design is already the right strategy and scaled cleanly |
| Flow timeline paint (bands) | No ceiling found through 1260 activity bands / 184ms | None observed in this probe | [recommendation — not scheduled work] nothing needed for paint time itself |
| Flow timeline case labels | 0 rendered at every tier measured (3.6h/7.3h/14.85h, all at 1500px width) — the fix for the audit's overlap finding suppresses labels below this width per band well before Tier 1 | Case identity on the timeline requires a hover per band at any span this probe measured | [recommendation — not scheduled work] cap or roll up case-label density (e.g. show every Nth label, or a label only on hover/selection) instead of an all-or-nothing width floor |
| Flow timeline minimap | Comfortable to roughly 3.6h span (240 bands); thin by 7.3h (30 bands); empty by 14.85h (0 bands) | A visually blank minimap strip that still occupies layout space, with no indication it degraded rather than being empty by design | [recommendation — not scheduled work] make the short-band filter threshold absolute (or span-bucketed) rather than a fixed fraction of total span, so a multi-hour session still shows a representative minimap |
| Flow timeline zoom round trip | Comfortable through Tier 2 (298ms); noticeably heavier by Tier 3 (490ms) | A perceptible pause on zoom-in/zoom-out as total band count grows | [recommendation — not scheduled work] nothing needed at the tiers measured; worth re-measuring if real sessions exceed roughly 1200 activity bands |
| Filter box (keystroke -> list update) | No ceiling found through 3840 rows / 404ms total (120ms of which is a fixed, deliberate debounce) | None observed in this probe | [recommendation — not scheduled work] nothing needed — debounce share shrinks (not grows) as a fraction of the total as N increases |
| Map at screen notch | No ceiling found — flat 50-51ms and constant 5 nodes/4 edges through 240 cases | None observed in this probe (by construction: the value-free screen axis does not fan out with case count) | [recommendation — not scheduled work] nothing needed — this is the reference example of a scale-insulated surface |
| DOM node total / JS heap | 120 612 nodes / 56.8 MB heap at the top tier measured, no signs of runaway growth | Slower time-to-interactive as total node count climbs, compounding with the uncapped Steps flat list above | [recommendation — not scheduled work] revisit only if the Steps flat list is ever virtualized (that alone would cut the largest single contributor to total DOM nodes) |
| Session load (cold/warm) | No ceiling found — 1045-1577ms across all three tiers | None observed in this probe | [recommendation — not scheduled work] nothing needed at the tiers measured |

## Ambiguities and resolutions

- **"One warm reload" read as `page.reload()` first, then corrected to a
  second `electron.launch()`.** See the *Method* section above for the full
  mechanism (`main.js`'s one-shot `did-finish-load` IPC handoff). Flagged
  here because it is a genuine reading of the task's literal words that
  turned out not to be a valid measurement path for this specific app —
  not a preference call.
- **Tier 2/3 step counts were estimates ("~2000" / "~4000") in the task; the
  actual pipeline output is 1920 / 3840.** Both are within the task's "~"
  tolerance (4% and 4% off the stated estimates respectively) and scale
  exactly linearly from the audit's pinned Tier-1 baseline, so no
  adjustment was made to the synthetic-session builder.
- **Case-label numbers diverge from the NAV-AUDIT §J baseline at Tier 1**
  (audit: "60 case labels" rendered and overlapping; this run: 0 case labels
  at every tier, because commit `4d4dca3` — landed on this branch the same
  day as the audit, fixing that exact finding — already suppresses labels
  below a 46px-per-band width floor, and the commit's own verification note
  records "60->0 labels...at 3.6h"). Reported as a *Knees* finding, not
  silently reconciled to match the older number.
- **Self-correction during drafting: the repeating "Order #109xx" text in the
  flow screenshots was first (wrongly) attributed to case labels, then
  corrected after a direct DOM probe.** An early draft of this doc's
  *Knees*/*Subjective pass* sections read the visible "Order #10903..." text
  in `shot-tier1-flow.png` as `.tl-case-label` content and concluded labels
  were visible at Tier 1 and vanished at Tiers 2/3. The `caseLabels: 0`
  table cell (present from the first run) already contradicted that reading.
  A live probe (`querySelectorAll(".tl-case-label").length`, all three
  tiers) returned 0 at every tier; the visible text's actual class is
  `.tl-act-title` (the always-on activity-band title lane, a different lane
  entirely, unaffected by `caseLabelFits()`). The doc text was corrected
  before commit; this entry exists so the correction is visible rather than
  silently folded in.
