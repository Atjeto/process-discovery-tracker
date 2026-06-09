# Lab-Phase Spec — Honesty Redesign, Phase A

> **Status:** Approved direction (2026-06-10), distilled from the owner-Claude
> design session. Branch: `lab-phase-a` off `master` (clean edition v1.0.0,
> no ML / no LLM — that constraint is permanent for product runtime; see
> "LLM posture" below). This doc is the build contract for Phase A and the
> standing frame for the lab phase.

## 1. Strategic frame (why)

PDT's working version is the **clean edition**. The v1.0-ml experiment is
parked on `project-vision-ai-ml` (kept; its *classical* pieces get ported
where named below; its LLM runtime does not return — "Claude is the LLM,
no LLM in the product").

**Operating model:** consultant-led. The deliverable is a **findings memo**
(2 pages, measured claims + evidence), long-form PDD second. The app is the
assembly line, organized buyer-first: *what did we find → show me the
evidence → let me tune the machine* (Memo / Evidence / Machine layers).

**Honesty architecture** — output is confidence-tiered and the tier gates
what renders:

- **Tier 1 — Measured facts** (always): time-in-app/window, switch cadence
  + focus dwell, idle/wait, re-keyed values (when vocab coverage exists),
  repeated sequences. Case boundaries NOT required.
- **Tier 2 — Case-based analysis** (gated): cycle times, variants,
  per-case comparison. Renders ONLY when case quality passes: markers
  present, or an anchor accepted with coverage ≥ 0.7. Below the gate the
  section is *replaced* by the anchor-picker call to action — never
  rendered on inferred/empty cases.
- **Tier 3 — Projections** (€-ROI): only on Tier 2 + explicit
  `roi_inputs`. (Already honest; unchanged.)

**Cargo-cult cuts** (canon imported from system-log process mining that
desktop data can't support): inductive-miner BPMN on unmarked data,
per-case BPMN exports, percentile/stdev tables at small N, the VA/BNVA/NVA
efficiency ratio while `bnva_ms` defaults to 0, auto-phases. These hide
behind expert flags or gates — they don't render with fact-level authority.

**The lab phase** (owner's company = laboratory, sealed posture dogfooded)
exits with six assets: (1) anchor verdict on real marker-less sessions,
(2) calibration baseline corpus, (3) vocab library for the real app estate,
(4) template flywheel proof (session 2 self-segments), (5) 3–5
mirror-tested anonymized memos, (6) a timed pilot runbook. Build order is
pulled by what those runs need — hence Phase A below.

## 2. Phase A scope (this build)

### A1. Pipeline — `case_quality` (new, additive in analysis.json)

```json
"case_quality": {
  "mode": "markers" | "anchor" | "unsegmented",
  "case_count": 14,
  "coverage": 0.94,            // fraction of interactions inside cases
  "tier2_unlocked": true,       // mode != unsegmented AND coverage >= 0.7
  "anchor": { "field_property": "...", "field_value": "..." }  // when mode=anchor
}
```

Computed in a new `normalization/case_quality.py`, invoked from
`pipeline_stages._run_analysis` (or adjacent), written into analysis.json.

### A2. Pipeline — `facts` block (Tier 1, new, additive in analysis.json)

```json
"facts": {
  "active_ms": 0, "idle_ms": 0,
  "top_apps": [{"app": "...", "ms": 0, "share": 0.31}],   // top 5
  "app_switches": 47, "switches_per_hour": 11.2,
  "longest_focus_ms": 0,
  "rekey_count": 0,            // same masked value entered in >=2 apps (derived stream)
  "repeated_sequence_count": 0 // motif count (A3)
}
```

New `normalization/facts.py`. All measured; no heuristic judgments.

### A3. Pipeline — findings detector library (new, additive)

`normalization/findings.py` producing `"findings": [...]` in analysis.json.
Each finding: `{id, detector, claim, evidence: {numbers..., step_ids/event_ids,
screenshot_refs}, tier, confidence_note}`. **Claims are comparative/factual,
never normative** ("31% of active time is in X", not "too much X").
Detectors fire only when preconditions hold:

| Detector | Precondition | Source |
|---|---|---|
| `screen_time_sink` | none | facts/top windows |
| `fragmentation` | none | switch cadence + dwell (report, don't judge) |
| `waiting` | none | idle-in-step + `time_study.waiting_ms` |
| `repetition` | segments exist | ADR-0016 `automation_candidates` (multi-instance) |
| `backtracking` | steps exist | motif port: `git show project-vision-ai-ml:normalization/patterns/motif_mining.py` — stdlib, port as-is into `normalization/motifs.py`, detect A→B→A bounces + repeats |
| `rekey_transfer` | vocab matches or value-equality on masked derived values | coalesced interactions |
| `coverage_caveat` | any app at basic/minimal/wall trust | per-app capture tiers from `framework`/`identity_source`/`coverage_hint` (§11e fields — already captured, currently unrendered) |
| `variant_divergence` | Tier 2 + ≥2 sessions | deferred to Phase B (Compare surface) |

### A4. Pipeline — memo export

`normalization/memo_export.py` + `--memo-out <path.md>` flag on
normalize.py. Markdown, 2 pages: header (session, date, capture coverage
line), fact strip, top findings (claim + evidence numbers + starred
screenshot refs), Tier 2 section only if unlocked (else one line: "not
case-segmented; N anchor candidates awaiting review"), "to say more" box
(missing inputs, honestly enumerated). Templated sentences + measured
numbers only. docx is Phase B; md is the deliverable seed.

### A5. Viewer — Overview level (new default)

New first entry in the view-mode bar: **Overview** (`#session-layout-overview`),
default level on session load (replaces flow as `State.currentLevel`
default). Single column, top to bottom:

1. **Case-quality badge** — 3 states from `analysis.case_quality`
   (`✓ Markers — N cases` / `✓ Anchor "<field>" — N cases, X% coverage` /
   `⚠ Unsegmented`).
2. **Anchor hero** (only when unsegmented + candidates exist): full-width
   card listing `annotations.anchor_candidates` with case-count/coverage
   /sample values, Accept/Dismiss **reusing the existing accept path**
   (the logic behind `renderAnchorCandidates` — find it via
   viewer/views/flow-view.js:1513 comment; do NOT duplicate the
   accept/dismiss/re-analyze wiring, call it).
3. **Fact strip** from `analysis.facts` (6 tiles).
4. **Findings feed** from `analysis.findings`: claim, evidence numbers,
   `Show on timeline` (jump to flow + seek — reuse `jumpToStepInFlow` /
   `seekToTimestamp`), checkbox `include in memo` persisted to
   `annotations.memo_selection[]` (additive key).
5. **"To say more"** box (driven by: roi_inputs absent, tier2 locked,
   coverage caveats).
6. Export bar: Memo (runs normalize `--memo-out` via existing
   runNormalize IPC pattern or a dedicated lightweight IPC; writes
   `<session>/memo.md`, then `revealFile`).

Honesty gates in existing views (small, surgical): Analysis view hides the
efficiency-ratio block unless an analyst has set any `bnva_ms` override;
time_study percentile/stdev columns render only when `instances >= 10`
(otherwise instances+total+range). No other Analysis restructuring in
Phase A.

### A6. Validation (definition of done — non-negotiable)

- `python -m pytest normalization/test/` green incl. new
  `test_case_quality.py`, `test_facts.py`, `test_findings.py`,
  `test_memo_export.py`.
- `normalization/golden_check.py` green over the 10 demo sessions —
  additive keys mean goldens regenerate per the documented CHIP-GUARDRAILS
  workflow (do not hand-wave this; run it).
- `cd viewer && npm test` green.
- `cd e2e && node session-smoke.js` green (existing gate untouched).
- **New `e2e/overview-smoke.js`**: launches the real viewer; asserts
  (a) default level is Overview and `#session-layout-overview` visible,
  (b) badge renders with the markers state on the demo session,
  (c) fact strip shows non-empty tiles, (d) on a marker-stripped temp copy
  (strip marker events the way `freshenSession()` copies, then
  re-normalize) the anchor hero renders with ≥1 candidate, (e) memo export
  produces a non-empty memo.md, (f) zero page errors. Screenshot the
  Overview both states into e2e/ artifacts.
- **A human-readable check**: open one generated memo.md and one
  screenshot; confirm the memo reads as claims+numbers, not template
  skeleton showing through. Paste the memo body into the final report.

### Out of scope (Phase B/C — do not touch)

Instance-strip redesign of time study, map matrix slimming, vocab semantic
fields + discovery autofill + "Copy for LLM", template-as-byproduct polish,
Compare reframe, readiness check, dead-man alert, docx memo, Engagement
concept (stays dead), anything LLM-runtime.

## 3. Constraints (hard)

- Conventions: CommonJS, no bundler, `node:test`/`pytest` only, additive
  annotations/analysis keys, raw events immutable, suggest-don't-mutate.
- Read [docs/CHIP-GUARDRAILS.md](CHIP-GUARDRAILS.md) before touching
  anything; the session golden, map-connectivity pin, and ADR registry
  guard must stay green.
- Bundled `viewer/python/` runs the pipeline — new modules stdlib-or-
  already-bundled only (pandas/pm4py exist in bundle; stdlib preferred).
- No git commits to master; work + commit on `lab-phase-a`. No releases.
- No LLM/network anywhere in product runtime (egress guard stays
  empty-allowlist).
- Company captures never enter an assistant context; validation uses
  committed demo sessions only.

## 4. LLM posture (standing)

LLM use is **authoring-time, consultant-side only**: a future "Copy for
LLM" export (Phase B) produces reviewable, PII-masked derived JSON for
pasting into a Claude session; suggestions return as reviewed-checklist
imports. Three engagement data postures (sealed / reviewable-derived /
open) become a setting in Phase B; sealed = the button doesn't render.

## 5. Owner's week-zero test (runs tonight, needs no Phase A code)

On a real marker-less session, locally:
`viewer\python\python.exe normalization\normalize.py <session> ` then
inspect `annotations.json → anchor_candidates[]` (or the viewer's Markers
panel). Verdict feeds back structure-only: candidate count, top score,
coverage, case balance — that decides whether the anchor thesis holds on
the worst real data or the detector needs work. Phase A's hero UI makes
this flow first-class either way.
