# ADR-0003: Viewer Architecture Refactor — Incremental Modularization

**Status:** Proposed
**Date:** 2026-05-16
**Deciders:** Project owner

## Context

The viewer works and ships, but it has become structurally unsound, and the
symptom is concrete: small fixes in the timeline area keep regressing other parts
of the timeline. That is not bad luck — it is the predictable behaviour of the
current architecture.

**What is wrong** (full catalogue in [ARCHITECTURE-ISSUES.md](../ARCHITECTURE-ISSUES.md);
the load-bearing problems):

- **One monolith.** [`renderer.js`](../../viewer/renderer.js) is **5,708 lines** —
  session loading, all four view surfaces, the entire Flow timeline, global state,
  IPC wiring, and every event handler in a single file. Every change has a
  whole-file blast radius and nothing can be tested in isolation.
- **The timeline is built three times.** `renderTimeline()`, `renderStepTimeline()`,
  and `renderPhaseTimeline()` are independent renderers; tick maths, axis
  formatting, and lane-packing are copy-pasted between them. **A fix in one never
  reaches the other two** — this is the literal mechanism behind the recurring
  regressions.
- **No module boundaries.** Feature files communicate through seven informal
  `window.Pdt*` globals; there is no enforced interface and the dependency comment
  in `renderer.js` is already stale.
- **No state model.** State is scattered module-level `let`s; every annotation edit
  triggers a full session reload and a re-render of every surface.
- **No test seam.** Layout maths is entangled with DOM construction, so none of it
  is verifiable without launching the app.

**Forces / constraints:**

- The viewer is **production-stable** (v0.3 shipped). A refactor must be
  incremental — no long window where nothing ships.
- **Solo developer.** The solution must be maintainable by one person and must not
  introduce a heavy framework or toolchain to babysit.
- The renderer **already uses CommonJS `require()`** (`renderer.js` requires
  `electron`/`node:fs`; `project.js` and `python-runner.js` are `module.exports`).
  Real modules are therefore available **with no bundler and no build step.**
- The timeline is performance-sensitive custom DOM code; a virtual-DOM framework is
  not an obvious fit.
- Effort is at a premium — the fix must be proportionate, not a gold-plated rewrite.

## Decision

**Restructure the viewer in place into explicit CommonJS modules — no framework, no
bundler — organised around three new seams, and migrate in four independently
shippable phases.**

The three seams:

1. **A single shared timeline core.** One module renders a time-band strip from a
   declarative config (lanes, data, zoom, height). The Flow, Steps, and Phases
   timelines all become thin callers of it. Optional Flow lanes (density, cases,
   markers, …) become **lane plugins** with a uniform `{ height, render }`
   contract. This deletes the triplication outright.
2. **A central state module.** One module owns `currentSession`, `currentLevel`,
   zoom, selection, and undo/redo, with explicit getters/setters and a minimal
   change notification. Views read from it and re-render *themselves* — no more
   full-session reload per edit.
3. **Per-view modules.** Flow / Steps / Phases / Aggregate each become their own
   module. `renderer.js` collapses to a thin (~100-line) entry point that wires
   modules together.

Recommended target shape (folder names are adjustable; the seams are not):

```
viewer/
  index.html
  main.js                 Electron main — unchanged
  python-runner.js        unchanged
  app/
    renderer.js           thin entry: build state, wire views, handle global keys
    state.js              the state store (currentSession, level, zoom, selection, undo)
    session.js            load / save / undo round-trip (wraps the IPC calls)
    ipc.js                typed wrappers over ipcRenderer.invoke("viewer:*")
    timeline/
      timeline-core.js    lane layout, ticks, zoom, scroll, band primitives
      lanes/              activity · density · cases · markers · steps · notes …
    views/
      flow-view.js  steps-view.js  phases-view.js  aggregate-view.js
    ui/                   charts · dfg-viewer · bpmn-viewer · command-palette · report-md · layout-controls
```

Modules use CommonJS `require`/`module.exports` (the pattern `project.js` already
uses) so `index.html` loads **one** `<script>` and everything else is `require`d.
No webpack/Vite/esbuild. Pure timeline-core layout maths gets unit tests via Node's
built-in `node:test` runner — **no new dependency**.

The design system (low-contrast palette, blended marks — issues D1–D3) is a
**parallel track**, not part of this structural decision; it is sequenced as
Phase 4 below.

## Options Considered

### Option A: Framework rewrite (React / Svelte + bundler)

Rebuild the renderer as components with reactive state and a bundler.

| Dimension | Assessment |
|---|---|
| Effort | High — ~8,000 lines of working code rewritten |
| Risk to production | High — long non-shipping window; behaviour drift |
| Incremental shippability | Poor — framework boundary is hard to cross piecemeal |
| Maintainability gain | High *eventually* |
| Build / tooling cost | New — bundler, framework, its upgrade treadmill |
| Fit for a solo dev | Poor — ongoing toolchain burden for one person |

**Pros:** proper component model; reactive state; large ecosystem.
**Cons:** rewrites working production code; the performance-sensitive custom
timeline does not map cleanly onto a vdom; introduces a permanent build step and
framework-upgrade maintenance; highest risk by far.

### Option B: Incremental in-place modularization, no framework *(recommended)*

CommonJS modules, a shared timeline core, a state module, per-view modules — as
described in **Decision**.

| Dimension | Assessment |
|---|---|
| Effort | Medium — restructure, don't rewrite; render logic is largely kept |
| Risk to production | Low — every phase ships; behaviour preserved |
| Incremental shippability | Excellent — 4 independent phases, sub-steps within each |
| Maintainability gain | High — kills the triplication and the monolith |
| Build / tooling cost | ~None — buildless CommonJS; `node:test` for tests |
| Fit for a solo dev | Strong — vanilla JS, no framework to track |

**Pros:** directly removes the root causes (S1, S2); each step ships; no framework
lock-in; preserves the working DOM-render code; uses tooling already present.
**Cons:** still manual DOM updates — no reactivity; requires discipline to keep the
new module boundaries clean.

### Option C: Split files only (keep `window.Pdt*` globals)

Break `renderer.js` into smaller `<script>`-loaded files and extract the timeline
core, but keep the global-namespace contract.

| Dimension | Assessment |
|---|---|
| Effort | Low |
| Risk to production | Low |
| Incremental shippability | Good |
| Maintainability gain | Partial — file size down, coupling unchanged |
| Build / tooling cost | None |
| Fit for a solo dev | OK |

**Pros:** smallest change; no module-system migration.
**Cons:** leaves the informal-globals problem (S7) and implicit coupling in place;
"smaller monolith" rather than "modules"; no natural test seam. Half a fix.

## Trade-off Analysis

The real choice is **B vs C**; A is rejected as disproportionate risk for a
production app maintained by one person.

C is cheaper but stops short: smaller files that still share a global namespace are
easier to read but not meaningfully easier to change safely — the coupling that
makes timeline fixes regress survives. The single most valuable move is the shared
timeline core, and that is worth doing *as a real module with a tested, pure
layout function* — which is Option B. The extra cost of B over C is mostly the
`require`/`module.exports` conversion, and since the renderer already uses
`require()` and two modules already export that way, that cost is small and carries
no tooling penalty.

B forgoes reactivity. That is an accepted trade: the viewer's update points are few
and explicit, a hand-written state module with targeted re-render covers them, and
avoiding a framework removes an entire class of upgrade and build maintenance from a
solo developer's plate.

## Consequences

**Easier:**
- Timeline fixes land **once** and apply to all three timelines — the recurring
  regression class is gone (S2).
- Layout maths becomes pure and unit-testable (`node:test`).
- Each view can be reasoned about, and changed, in isolation (S1, S3).
- An edit re-renders only its own view, not the whole session (S6).

**Harder / costs:**
- A migration period where new (modular) and old (monolith) code coexist — managed
  by doing it phase-by-phase with the app shippable at every step.
- Module boundaries must be kept honest by discipline; there is no compiler
  enforcing them.
- `require()` graph and load order become things to keep tidy.

**To revisit later:**
- If the viewer grows much larger, reconsider a lightweight reactive layer — but
  only on top of the clean module boundaries this ADR establishes.
- The design-system pass (D1–D3) is tracked separately and should not block this.

## Action Items

Each phase is independently shippable; the app keeps working throughout.

**Phase 0 — Scaffolding**
1. [ ] Create the `app/` module tree; add a `node:test` script to `viewer/package.json`.
2. [ ] Convert `index.html` to load a single entry script; keep existing files working.

**Phase 1 — Shared timeline core (kills S2; fixes R1)**
3. [ ] Build `timeline/timeline-core.js` — lane layout, tick interval + axis labels, zoom, scroll, band primitive — with pure, unit-tested layout maths.
4. [ ] Migrate the **Steps** mini-timeline onto it (smallest, lowest risk), then **Phases**, then the **Flow** timeline.
5. [ ] Re-express Flow's optional lanes as lane plugins (`{ height, render }`).
6. [ ] Fix the double-scrollbar (R1) once, in the core.

**Phase 2 — State module (fixes S5, S6)**
7. [ ] Add `state.js`; move the scattered `renderer.js` `let`s into it.
8. [ ] Replace the per-edit full-session reload with targeted per-view re-render.

**Phase 3 — Decompose `renderer.js` (S1, S3, S7, S8)**
9. [x] Extract `flow-view` / `steps-view` / `phases-view` / `aggregate-view` modules.
10. [x] Extract `session.js` and `ipc.js`; reduce `renderer.js` to a thin wiring entry.
11. [x] Convert the `window.Pdt*` files to `require`/`module.exports`; delete the globals.

**Phase 4 — Design-system pass (parallel; fixes R2, R3, R4 / D1–D3)**
12. [ ] Decide and apply one colour fix across all timelines (tint alpha vs. saturation vs. borders).
13. [ ] Give phases a distinct palette; raise video-control and screenshot-dot contrast; relabel the `⇥ playhead` control.

**Recommended order:** 0 → 1 → 2 → 3, with 4 runnable in parallel at any point.
Phase 1 delivers the biggest win first — it ends the recurring timeline regressions.
