# Architecture Issues & Refactor Register

> **Status — RESOLVED.** The viewer refactor is complete: the structural issues
> (S1-S8) were addressed across [ADR-0003](./adr/0003-viewer-architecture-refactor.md)
> Phases 1-3, and the design-system issues (D1-D3) and regressions (R1-R4) were
> superseded by the Warm Editorial redesign
> ([ADR-0004](./adr/0004-flow-timeline-steps-rework.md)). See the Resolution section
> below. This document is kept as the audit of record — the problem statements
> below are unedited.
>
> It catalogued the **structural problems**, **design-system problems**, and
> **current UI regressions** found in the viewer; ADR-0003 turned it into the
> four-phase refactor decision.

## How to read this

Each entry has an ID, a severity, the **blast radius** (what breaks / is hard
because of it), and a **suggested direction** (not a committed solution).

- **Severity** — High = actively causes bugs or blocks change; Medium = real cost,
  not yet on fire; Low = friction.
- IDs: `S` = structural, `D` = design system, `R` = current regression.

The recurring complaint — "fix one thing, another breaks" — is not bad luck. It is
the predictable behaviour of **S1** + **S2**: one giant file, and timeline logic
copied three times. Most regressions below are symptoms of those two.

> **Capture app:** this register covers the viewer only. The capture app's
> equivalent audit is [CAPTURE-ARCHITECTURE-ISSUES.md](./CAPTURE-ARCHITECTURE-ISSUES.md).

---

## Resolution — shipped

Every issue below was addressed by the viewer refactor. The structural work landed
across ADR-0003 Phases 1-3; the design-system issues and the colour-blend
regressions were superseded by the Warm Editorial light-theme redesign
([ADR-0004](./adr/0004-flow-timeline-steps-rework.md)).

| ID | Resolved by |
|----|-------------|
| S1 | Phase 3 — `renderer.js` decomposed into per-view + infrastructure modules (~5,700 → ~1,200 lines). |
| S2 | Phase 1 — one shared `timeline/timeline-core.js`; the three timelines no longer duplicate tick / lane logic. |
| S3 | Phase 1 — `renderTimeline()` migrated onto the timeline core as lane plugins (commit `faed9f6`). |
| S4 | Phase 2 — zoom / scroll / sizing state moved into `state.js`. |
| S5 | Phase 2 — the three-way level dispatch collapsed to a `LEVEL_RENDERERS` map. |
| S6 | Phase 2 — annotation edits do a targeted per-view re-render instead of a full session reload. |
| S7 | Phase 3 — the `window.Pdt*` globals converted to CommonJS modules and deleted. |
| S8 | Phase 1 — optional Flow lanes are now lane plugins with a uniform contract. |
| R1 | Phase 1 — the double-scrollbar fixed once, in the timeline core. |
| D1-D3, R2-R4 | Superseded by the Warm Editorial redesign (ADR-0004) — the dark palette these describe was replaced wholesale. |

The "Suggested sequencing" section near the end is the original pre-refactor plan,
kept for context.

## Structural issues

### S1 — `renderer.js` is a 5,708-line monolith — *High*

One file holds session loading, all four view surfaces, the entire Flow timeline,
global state, IPC wiring, and every UI event handler.

- **Blast radius:** every viewer change edits this file; nothing can be unit-tested
  in isolation; it is a constant merge-conflict surface; no contributor can hold it
  in their head.
- **Direction:** split along the seams the `window.Pdt*` modules already imply —
  `session-load`, `flow-view`, `steps-view`, `phases-view`, `aggregate-view`,
  `timeline`, `state`. See [VIEWER.md](./architecture/VIEWER.md).

### S2 — Timeline logic is implemented three times — *High*

`renderTimeline()` (`renderer.js`), `renderStepTimeline()` (`step-editor.js`), and
`renderPhaseTimeline()` (`phase-editor.js`) are independent renderers.
`pickTickIntervalMs` and `fmtAxisLabel` are near-identical copies in both editors;
`renderer.js` has a third, divergent tick chooser (`pickTickStep`); lane-packing
exists twice; `escapeHtml`/`escapeAttr` twice.

- **Blast radius:** **this is the direct mechanism behind the recurring timeline
  regressions** — a fix applied to one renderer never reaches the other two.
- **Direction:** one shared timeline module — a single tick/axis helper, one
  lane-packing function, one band primitive, one zoom/scroll/persist contract. See
  [VIEWER-TIMELINE.md](./architecture/VIEWER-TIMELINE.md) → "unification opportunity".

### S3 — `renderTimeline()` is a 432-line function with mixed concerns — *High*

Event filtering, lane geometry, DOM construction, click handlers, and the minimap
refresh are all inline in one function.

- **Blast radius:** layout maths cannot be tested without a DOM; every new lane
  enlarges the function; reasoning about "where does this 60px come from" is hard.
- **Direction:** separate pure layout maths (testable) from DOM construction; make
  lanes pluggable (see S8).

### S4 — Zoom / scroll / sizing state is scattered — *Medium*

Three zoom variables (`zoomFactor`, `stepZoom`, `phaseZoom`), three CSS-variable
sizes owned by `layout-controls.js` (`--timeline-height`, `--mini-timeline-height`,
`--video-width`), and several `pdt.*` `localStorage` keys. No single source of
truth; resize and zoom can disagree (the README already records a past resize bug
where `flex` overrode the height variable).

- **Direction:** one explicit timeline-view-state object per timeline instance,
  owning zoom + scroll + height together.

### S5 — The three-way level dispatch is copy-pasted — *Medium*

`if (currentLevel === "flow") renderTimeline(); … "steps" … "phases" …` appears at
roughly six sites in `renderer.js`. (`currentLevel` itself is fine — it *is*
explicit module state; the duplication is the issue.)

- **Direction:** a single `renderCurrentLevel()` dispatcher.

### S6 — Every annotation edit triggers a full session reload — *Medium*

`saveAnnotationsWithUndo()` writes `annotations.json`, then `loadSessionIntoView()`
re-reads the entire session folder and re-renders **every** surface — even for a
one-character step rename.

- **Blast radius:** performance on large sessions; obscures what actually changed.
- **Direction:** after the module split, re-render only the affected surface; or
  update `currentSession.annotations` in memory and render targeted.

### S7 — The window-globals contract is informal and its doc is stale — *Low–Medium*

Seven `window.Pdt*` globals with no enforced interface; `renderer.js`'s own header
comment lists only three of the seven dependencies.

- **Direction:** make module boundaries explicit. `project.js`'s collector-callback
  pattern is the in-repo model to copy.

### S8 — Optional Flow-timeline lanes are bolted in — *Low*

Each optional lane (window-title runs, per-step lane, note lane) was added as an
inline special case inside `renderTimeline()`; the function grows with every lane.

- **Direction:** a lane-plugin contract (`{ height, render(host, ctx) }`) so lanes
  compose instead of accreting.

---

## Design-system issues

See [DESIGN-SYSTEM.md](./architecture/DESIGN-SYSTEM.md) for the full analysis.

### D1 — Data marks blend into the background and each other — *High*

The most-reported user complaint. Low-saturation palettes, 8–12% alpha tints
(`color + "1F"` / `"14"`), and CSS `opacity` stacked on top of alpha-tinted
backgrounds compound into near-grey, weakly-separated marks.

- **Direction (options):** raise tint alpha; raise palette saturation; remove the
  double opacity (alpha *or* `opacity`, not both); rely on solid borders for edge
  definition. Pick deliberately and apply once across all three timelines.

### D2 — Steps and phases share a palette — *Medium*

`STEP_PALETTE` and `PHASE_PALETTE` are the same six colours, so a step and a phase
can be coloured identically.

- **Direction:** give phases a distinct hue family.

### D3 — Low-contrast video-control buttons — *Medium*

`.video-controls button` uses `--fg-3` text on a 6%-white background over a
translucent video bar — dark-on-dark, easily missed.

- **Direction:** brighten text to `--fg-2`; raise the button background opacity.

---

## Current UI regressions

Observed in the running viewer. Documented here as refactor inputs — **deliberately
not fixed in the documentation pass.**

### R1 — Double scrollbar on the Flow timeline

`.timeline-scroll` (`styles.css:280`) declares both `overflow-x: auto` and
`overflow-y: auto` and a fixed `height: var(--timeline-height, 160px)`. When
`renderTimeline()` sets the inner `#timeline` `minHeight` above 160px (any session
with stacked case lanes), the content overflows vertically and a second scrollbar
appears beside the horizontal one.

- **Why now:** a side effect of the resize-handle fix — giving `.timeline-scroll` a
  fixed height turned previously-unbounded content into vertical overflow.
- **Direction:** the Flow timeline should size to fit its lanes (drive
  `--timeline-height` from content height, or use `overflow-y: hidden` and let the
  strip grow) rather than scroll vertically. Tie this to **S4**.

### R2 — Screenshot controls are hard to see

Two parts: `.tl-screenshot` timeline dots are `opacity: 0.55` slate on dark (a
recent pass "toned down" the dots — now too faint to find); and the
`.video-controls` buttons are low-contrast (**D3**).

- **Direction:** raise dot opacity / use a brighter accent and keep the hover-grow;
  apply **D3** for the buttons.

### R3 — Orphaned "⇥ playhead" pill

`#btn-scope-to-playhead` (`index.html:162`) is a `link-btn` labelled `⇥ playhead`.
It is a *working* control — "scope to whichever case contains the video playhead" —
but the cryptic label and `link-btn` styling make it read as an unexplained
floating pill rather than a labelled button. (The user's literal reaction: "what is
this even.")

- **Direction:** a clearer label and/or icon; group it visibly with the case-scope
  dropdown it belongs to. UX-clarity, not a code defect.

### R4 — Colours blend together

Same root cause as **D1**; see [DESIGN-SYSTEM.md](./architecture/DESIGN-SYSTEM.md).

---

## Suggested sequencing (for the follow-up refactor plan)

1. **S2 — shared timeline module.** Highest leverage: it directly stops the
   recurring timeline regressions (R1, and the class of bug behind them) and is a
   bounded, well-understood scope.
2. **S3 + S8 — decompose `renderTimeline()`** into layout maths + pluggable lanes,
   on top of the shared module.
3. **S1 — split `renderer.js`** along the now-clearer seams.
4. **D1 (with D2/D3)** — a deliberate colour pass, applied once across all three
   timelines; can run in parallel as a design workstream.
5. **R1–R3** — small isolated fixes. They can be done immediately as quick wins, or
   absorbed into steps 1 and 4. R1 and R4 are *symptoms* of S2/D1 — fixing the root
   is what makes them stay fixed.

[ADR-0003](adr/0003-viewer-architecture-refactor.md) turns this register into a
sequenced, four-phase refactor decision.
