# ADR-0006: Sequencing the IMPROVEMENTS Backlog — Execute IMPLEMENTATION-SPEC, Defer the Analysis Layer

**Status:** Accepted — Phase A in progress
**Date:** 2026-05-17
**Deciders:** Project owner

## Context

Two large planning documents landed in `docs/To-Do/` on 2026-05-17:

- **`docs/To-Do/IMPROVEMENTS.md`** — an 81-entry pain-point register
  (I1–I81), collapsed into 15 root-cause clusters (A–O), with an 8-phase
  plan (~30–35 days). It makes a new **analysis layer** (Cluster N — waste
  classification, time study, automation scoring, process-efficiency ratio)
  the foundational Phase 1, claiming "the data to produce them
  automatically is already captured."
- **`docs/To-Do/IMPLEMENTATION-SPEC.md`** — a concrete,
  file-and-function-level how-to guide. It covers 61 of the 81 entries in
  9 phases (A–I) and **defers the analysis layer entirely** pending real
  8-hour passive-recording data.

The two documents disagree on sequencing — most sharply on whether the
analysis layer is foundational or premature. Both were also written
slightly ahead of the code. A verification pass (three exploration agents
over `normalization/`, `viewer/`, `capture/`, cross-checked against ADRs
0001/0003/0004/0005 and the 0.7.0 CHANGELOG) found spec claims that no
longer match reality: three are **wrong**, two propose **work already
done**, and four rest on **stale framing**. Executing the spec verbatim
would hit those snags.

This is the analysis-and-sequencing analogue of how `IMPROVEMENTS.md` is a
register and a decision is still owed: this ADR records which document
governs, what to do about the analysis layer, and the corrections to fold
in before implementation.

## Decision

**Adopt `docs/To-Do/IMPLEMENTATION-SPEC.md` as the execution plan.**
`IMPROVEMENTS.md` remains the rationale (the WHY); the spec is the
instruction set (the HOW). **Defer the analysis layer** as the spec does.
Execute Phases A–I in the order in *Recommended Execution Order* below,
applying every item in *Codebase Verification* first.

## Options Considered

### Option A — Follow IMPLEMENTATION-SPEC, defer the analysis layer *(chosen)*

| Dimension | Assessment |
|-----------|------------|
| Complexity | Med — 9 phases of bounded, mostly independent changes |
| Risk | Low — each phase ships independently; no new data model |
| Time-to-value | Fast — Phase A helps the analyst on day one |
| Data readiness | Matches reality |

### Option B — Build the analysis layer first (IMPROVEMENTS.md Phase 1)

| Dimension | Assessment |
|-----------|------------|
| Complexity | High — 4 new Python modules + a new `analysis.json` sidecar |
| Risk | High — heuristic classifiers (what counts as "waste") need real data to tune; none exists yet |
| Time-to-value | Slow — ~5–7 days before any visible benefit |
| Data readiness | **Over-stated** — see Trade-off Analysis |

### Option C — Thin slice now (step-level time study + efficiency scaffold)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Med |
| Risk | Med — still ships heuristics ahead of data; efficiency stays blocked on waste classification |
| Verdict | Rejected — half-measure; Phase D already improves the deliverable without it |

## Trade-off Analysis

The core tension is **analysis layer now vs. later**. The verification pass
settles it: IMPROVEMENTS.md's "data is already captured" is *partially true
but incomplete*. The pipeline emits the *raw* inputs (idle events, the
interaction stream, per-label activity durations) but **not** the per-step
aggregations the four modules need — idle gaps are not rolled up to step
level, there is no app-switch count, `stats.json` is keyed by activity
label not by step, and there is no per-step interaction-sequence variant
table. The efficiency ratio is fully blocked on the waste classifier.

Building the layer is therefore real new pre-computation work (~200–300
lines on top of 4 modules), and its heuristics are design work that
benefits enormously from real 8-hour recordings to calibrate against. That
data does not exist yet. Shipping waste/automation heuristics tuned against
guesses risks plausible-but-wrong output — the kind that quietly erodes
trust in the tool.

Deferring loses nothing in the meantime: **Phase D** (a self-contained HTML
findings report) upgrades the analyst's deliverable from raw artifacts to a
presentable document using *only data that already exists*. The analysis
layer gets its own spec once the first passive recording produces data.

## Codebase Verification — Corrections to Apply Before Executing

The spec is broadly accurate, but it must be executed *against the current
0.7.0 code*, not verbatim.

### Wrong — the spec assumes something that does not exist

1. **`viewer:exportFile` does not accept generated string content.**
   Phase D1 claims the handler "already supports writing string content to
   a user-picked path." It does not — it copies an existing file
   (`{ sourcePath, suggestedName }` → `fs.copyFileSync`). The HTML findings
   report produces a *generated string*. **Fix:** add a new IPC handler
   modeled on the existing `viewer:saveSvgFile` (which does write string
   content) — e.g. `viewer:saveHtmlFile` — or extend `exportFile` to
   accept a `content` field.
2. **`State.subscribe("*")` wildcard does not exist.** Phase F1 wires
   auto-save via `State.subscribe("*")`. The State bus (`viewer/state.js`)
   only supports named topics (`steps`, `phases`, `timeline`, `markers`).
   **Fix:** add wildcard support to `state.js`, or subscribe
   `scheduleAutoSave()` to each named topic explicitly.
3. **The command palette is single-provider (`setProvider`), not
   multi-provider (`registerProvider`).** Phase I's plan for each view to
   call `registerProvider('steps', …)` requires first converting
   `command-palette.js` from one `provider` function to a keyed registry.
   Treat that conversion as the first task of that Phase I item.

### Already done — skip these spec items

4. **Phase C3 / I40 (DFG/BPMN decoupling) is already implemented.**
   `normalize.py`'s `--mine` path already wraps DFG and BPMN mining in
   separate `try/except` blocks; one failing does not lose the other.
   **Skip C3.**
5. **Phase B6 / I46 (OBS scene reuse) is already implemented.** `obs.js`
   `ensureScene()` already calls `GetSceneList` and only creates the scene
   when absent. **Skip B6.**

### Stale framing — the premise is off; the change is still partly valid

6. **The event table is already collapsed.** Phase A1 says to "replace the
   event table as the default content" and add a toggle. It already lives
   inside a collapsed `<details class="event-table-host">` in
   `index.html`. **So:** Phase A1 is purely *additive* — add a new
   always-visible `#session-summary` panel; drop the toggle sub-task; do
   not reuse the collapsed `<details>` slot.
7. **A one-line timeline summary already exists.** `flow-view.js` has
   `renderTimelineSummary()` writing `#timeline-summary`. The new panel is
   richer; decide whether it replaces or sits above that line.
8. **The density-histogram lane (I71) is already off by default** (the
   Lanes menu defaults `density:false`) and a code comment indicates it
   already counts only user-activity events. Verify, then likely treat the
   I71 filter as a no-op.
9. **`stats.json` has no per-app time breakdown and no app-switch count.**
   The Phase A summary's "Top apps by time" and "App switches" must be
   computed client-side from `session.events` — `stats.json`'s
   `activity_stats` is keyed by activity label, not app.

### Other facts to carry into implementation

- `CLAUDE.md` stated version 0.6.0 while the CHANGELOG is at 0.7.0 (fixed
  alongside this ADR). 0.7.0 landed a collapse change
  (`collapse_activity_occurrences`, the self-loop fix) and
  `classification_overrides` — **Phase C1 (collapse-by-app) must reconcile
  with that 0.7.0 collapse work** before touching the collapse stage.
- `_seq` does not exist on recorder events, and `normalize.py` sorts events
  by `timestamp` only (no secondary key) — Phase E2 (sequence counter) is
  genuinely needed and built from scratch.
- The C# recorder has zero automated tests (ADR-0005, explicit). Phases E,
  and the recorder-touching parts of B and G, are validated by manual
  smoke test only — partial on the dev box (the capture app runs; few real
  target apps available).
- The session object from `loadSessionData()` has exactly the 10 keys the
  spec lists; adding an `analysis.json` sidecar later is genuinely a
  one-line change there.

## Recommended Execution Order

A pending-but-undated 8-hour recording means **Phase A leads** (highest
value, no dependencies, fully testable on the dev box) and **Phase G is
pulled early** — but G depends on C1 + E1, so C and E come first.

| # | Phase | Scope | Depends on | Notes |
|---|-------|-------|-----------|-------|
| 1 | **A** | Session summary + analyst orientation (viewer) | — | Corrections 6–9 |
| 2 | **C** | Pipeline hardening (Python) | — | Skip C3; C1 reconciles with 0.7.0 collapse work |
| 3 | **E** | Recorder signal quality (C#) | — | Manual test only |
| 4 | **G** | 8-hour passive-capture prep | C1, E1 | Pulled ahead of B/D/F/H |
| 5 | **B** | Capture confidence | — | Skip B6 |
| 6 | **D** | HTML findings report + PDD enhancement | A, C | Correction 1 |
| 7 | **F** | Project layer + knowledge persistence | A | Correction 2 |
| 8 | **H** | Comparison + video + markers | A, C | — |
| 9 | **I** | Vocabulary + polish | — | Correction 3 |

Each phase ships independently with its own CHANGELOG entry. Per-phase
implementation detail lives in `docs/To-Do/IMPLEMENTATION-SPEC.md`; this
ADR governs sequencing and the corrections above.

## Consequences

**Easier:**
- Every Phase A–I item is bounded, independently shippable, and needs no
  new data model. Phase A delivers value immediately.
- The analyst's deliverable still improves (Phase D) without the analysis
  layer.

**Costs / deferred:**
- IE-grade outputs (waste %, automation scoring, efficiency ratio) wait for
  a follow-up spec.
- Recorder-side changes (E, parts of B/G) ship without automated test
  coverage — manual verification only.

**To revisit:**
- Once the first 8-hour passive recording produces data, write the
  analysis-layer spec and calibrate its heuristics against that real data
  (entries I74–I81, I59).

## Action Items

1. [x] Land this ADR; fix the stale `CLAUDE.md` version (0.6.0 → 0.7.0).
2. [ ] Phase A — session summary panel + Compare-Sessions outlier flag.
3. [ ] Phases C → E → G → B → D → F → H → I, applying the corrections; one
       CHANGELOG entry per phase.
4. [ ] After the first 8-hour passive recording, write the analysis-layer
       spec (I74–I81, I59) and calibrate heuristics against real data.
