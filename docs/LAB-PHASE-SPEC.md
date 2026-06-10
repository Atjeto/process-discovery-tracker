# Lab-Phase Spec — Honesty Redesign, Phases A–E

> **Status:** Approved direction (2026-06-10). **Phase A: BUILT + validated**
> on `lab-phase-a` (overview-smoke 9/9, session-smoke 22/22, pytest 458,
> viewer 276; consolidation to master pending owner sign-off).
> **Phase B: BUILT + validated** on `lab-phase-b` (map-slim-smoke 9/9,
> session-smoke 22/22, overview-smoke 9/9, pytest 465, viewer 280, capture
> 86, recorder 69, session golden green WITHOUT regeneration — the dfg.json
> projection counts did not move; consolidation pending owner sign-off).
> **Phase C: BUILT + validated** on `lab-phase-c` (vocab-smoke 22/22 incl.
> the §C2 checklist / §C3 export / §C4 sealed pins, overview-smoke 11/11,
> session-smoke 22/22, map-slim-smoke 9/9, pytest 486 incl. the new
> semantics round-trip + discovery-autofill suites, viewer 297, capture 86,
> recorder 69, session golden green WITHOUT regeneration — the shipped
> vocabs carry no semantic fields, so the pipeline output is bit-stable;
> consolidation pending owner sign-off).
> Phases D–E below are the remaining build contracts, written to be
> **chipped one per session**: each is self-contained, sized for one
> session, and ends with the same non-negotiable validation discipline
> as §A6.
>
> **Chip protocol (every phase):** branch `lab-phase-<x>` off the latest
> consolidated tip (master once Phase A is merged; else off the prior
> phase branch). Read this doc §1 (frame) + §3 (hard constraints) +
> [CHIP-GUARDRAILS.md](CHIP-GUARDRAILS.md) first. Hard rules from §3 apply
> verbatim to every phase. No master commits, no releases, max 1–2
> concurrent subagents, no narration, validation before any "done" claim.
> Clean edition stays no-ML/no-LLM at runtime — permanent.

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

### Out of scope for Phase A

Everything in Phases B–E below, the Engagement concept (stays dead), and
anything LLM-runtime (permanently).

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

## Phase B — Honest analysis surfaces + deliverable polish

**Why now:** serves lab assets 5 (mirror-tested memos) and 6 (timed
runbook) — the memo/PDD pair must read clean before any colleague sees one.

### B1. Time study → instance strip ("Where the time goes")

Replace the Analysis view's time-study stats table with an **instance
strip**: one row per step group — name, N, total time, and one dot per
instance on a shared horizontal time axis; click a dot → jump to that
step on the Flow timeline (reuse `jumpToStepInFlow`). Summary stat columns
(mean/stdev/percentiles) render only at `instances >= 10` (gate exists
from A5 — keep it, relocate). Rename the section header "Time study" →
"Where the time goes". Data source unchanged (`analysis.time_study` +
`step_id` evidence); this is a render change only.

### B2. Map slimming (cargo-cult cut, §1)

- Default map = **screen-grain DFG with time-weighted edges**: edge
  thickness/labels from accumulated transition *time*, not traversal
  count (extend `buildAnnotationDfg` in process-map-levels.js with an
  edge-weight mode; keep count available in the edge tooltip).
- **Step-grain observed BPMN renders only when `case_quality.tier2_unlocked`**;
  locked state shows the §1 replace-pattern (one line + anchor CTA link).
- Remove from the UI (keep CLI flags + files): inductive-miner BPMN
  (`--mine` output `process_map.bpmn`), per-case BPMNs, the
  activity-taxonomy map level. The notation×level matrix collapses to the
  two defaults + an **Expert drawer** (a collapsed `<details>` exposing
  the removed cells, clearly labeled "expert / off-contract views").
- e2e: the map-connectivity pin (session-smoke) MUST stay green —
  screen-grain DFG remains its subject. Update selectors only if the
  DOM moves, never the assertion.

### B3. PDD restructure — findings-first + honesty parity

`normalization/pdd_export.py`: §1 becomes the findings memo content
(same `analysis.findings` + `annotations.memo_selection[]` source as
memo_export — one source of truth, the two artifacts cannot disagree).
Fix the Phase-A handoff: the **ungated efficiency ratio in PDD §3.4** gets
the same bnva_ms-override gate as the viewer; when withheld, the §1
replace-pattern note. Tier-2 sections (cycle times, variants) gate on
`case_quality.tier2_unlocked`. As-Is/To-Be map pair section unchanged.

### B4. Memo polish

- `--memo-out` docx variant (python-docx is in the bundled python — same
  engine pdd_export uses), embedding starred screenshots inline as
  evidence figures.
- **Repetition-label shortening** (Phase-A handoff): segment labels in
  findings/memo render as `app — first 2 steps … (+N more)` capped ~60
  chars; full label in evidence detail.

### B5. Validation (DoD)

Suites + both e2e smokes green; overview-smoke extended only if Overview
DOM changed. New `e2e/map-slim-smoke.js`: default map is time-weighted
screen DFG; BPMN tab locked on a marker-stripped copy + unlocked on the
demo session; expert drawer opens; zero page errors. Eyeball: one docx
memo opened (screenshot), one PDD §1 read — paste both checks in report.
Regenerate goldens ONLY if the golden projection actually changes (it
covers stats.meta/steps/DFG — B2's dfg.json edge weights WILL hit it;
follow the CHIP-GUARDRAILS update workflow and say so).

---

## Phase C — Vocab semantics, discovery autofill, Copy-for-LLM, posture

**Why now:** serves lab asset 3 (vocab library for the real estate) — the
10-minute-per-app discovery promise.

### C1. Vocab record semantics (additive YAML fields)

Extend the app-vocab interaction shape (loader: `app_vocab.py`; authoring
UI: vocab-view) with optional fields: `verb` (enter/click/select/submit —
**auto-derived** from control_type × event kind), `object` (human/LLM),
`completion` (bool — **auto-heuristic**: Button + save/submit/send/OK
text), `case_id_source` (bool — bridges to anchor candidacy),
`carries_value` (bool — auto: value_changed observed), `means` (free
text, optional). Loader tolerates absent fields (all existing vocabs stay
valid). Consumers: `completion` becomes a step-boundary hint in
step_suggest (natural step ends); `case_id_source` candidates feed
anchor_suggest scoring (small bonus, never a gate); `carries_value` feeds
the rekey detector's field set.

### C2. Discovery autofill

`discover_vocab.py` (+ the viewer Discover flow): after the volatility
diff, auto-fill `verb`/`carries_value`/`completion`-candidates and screen
grouping on every discovered row, so the human pass is *review*, not
authoring. The vocab editor shows the auto-filled skeleton as a
**checklist** (approve / edit per row) rather than empty boxes.

### C3. "Copy for LLM" + import (authoring-time, consultant-side)

- Viewer button (App Library + Overview) producing **one human-readable
  JSON** to clipboard/file from the DERIVED stream only: vocab skeleton
  rows (signatures + auto-semantics + window titles), fact strip,
  findings, step groups. PII-masked values only; no raw events.jsonl
  content; no screenshots. The export is the reviewable-egress artifact —
  a security officer must be able to read it line by line.
- Import path: paste/load a suggestions JSON (`{row_key: {object, means,
  name}}`) → rendered as a reviewed checklist (suggest-don't-mutate;
  nothing applies without per-row or select-all approval).

### C4. Data-posture setting

Per-session/app-level setting `data_posture: sealed | reviewable | open`
(default `reviewable`), persisted in viewer user-config. `sealed` removes
the Copy-for-LLM buttons from the DOM entirely (the egress promise is
enforced by code, mirroring the egress-guard philosophy). Posture is
displayed on the Overview header line.

### C5. Validation (DoD)

Suites green; vocab loader round-trip tests (old vocabs load unchanged;
new fields tolerated + consumed); discovery autofill pytest on a recorded
snapshot fixture; e2e `vocab-smoke.js` extended: discovery produces
checklist rows with auto-filled verbs; sealed posture hides the button.
Eyeball: one exported Copy-for-LLM JSON read line-by-line for leakage
(paste it in the report), one discovered vocab screenshot.

---

## Phase D — Multi-session truth: Compare reframe, divergence, flywheel

**Why now:** serves lab assets 4 (template flywheel proof) and the
strongest finding class (cross-worker divergence) for asset 5.

### D1. `variant_divergence` detector (Tier 2, ≥2 sessions)

In the Compare/aggregate path: given ≥2 sessions of the same process
(same template or same accepted anchor), align case step-label sequences
(the aligned-reading backbone logic already in steps-view) and emit
findings: "Worker A completes in N steps (median X), worker B in M
(median Y); divergence at step Z." Written to an aggregate-level
`findings[]` (additive, in the aggregate stats payload), rendered in
Compare and exportable into the memo when a multi-session memo is
generated.

### D2. Compare surface reframe

Compare's top section becomes the divergence findings feed (same card
component as Overview); the merged map demotes below it. Aligned reading
gets promoted from a Steps-view toggle to the Compare default for
template-matched sessions.

### D3. Template-as-byproduct polish (flywheel)

- "Export as Process Template" from a curated session carries the
  **accepted anchor** into `canonical_process.case_anchor` (verify; wire
  if missing) — headline behavior: session 2 of the same process arrives
  **self-segmented** (anchor inherited via template) and auto-matched.
- The template YAML editor + version compare move behind a Machine-layer
  collapse in the template view; the byproduct path (button) is primary.
- Auto-phase suggestion comes out of the default pipeline flow: phases
  render only when the template defines them (config flag, default off;
  existing sessions with phases unaffected).

### D4. Validation (DoD)

Suites green. New `e2e/flywheel-smoke.js`: curate demo session 1 →
export template → load session 2 (second demo session) with the template
→ assert it case-segments via inherited anchor + auto-matches ≥1 step +
Compare shows ≥1 divergence finding on the pair. Eyeball: the divergence
finding text quality (paste in report).

---

## Phase E — Capture-side field kit (worker-facing)

**Why now:** serves lab assets 2 (colleague captures) and 6 (timed
runbook) — the first session that runs on a machine you're not sitting at.

### E1. Readiness check

Capture-app surface (tray menu + a `--readiness` CLI): disk space on the
session target (the C:-full → 0-events failure class), recorder
starts + UIA reachable, per-running-app trust tier (rich/basic/minimal/
wall from `framework`/`identity_source`/`coverage_hint` heuristics on a
10-second probe), writes `readiness-report.json` + a human summary
dialog. Run before any pilot day.

### E2. Dead-man alert

The capture tray already receives `recorder_health` (~30 s cadence) and
`recorder_died`. Add: if no interaction event AND no recorder_health for
> 2 minutes during an active session → tray icon goes warning-state +
Windows notification ("recorder silent — check capture"). The silent
10am death must be loud.

### E3. Worker close-out (port from ML branch, deterministic)

Port `capture/self-annotation/` (wizard.js + wizard-window.html +
wizard.test.js) from `project-vision-ai-ml` — it is heuristic-templated,
no LLM, and its tests ran green there. Trigger at session end; ≤5
observed-value questions; answers append `self_annotations[]`
(manually_authored: true). Add the **worker review handover**: after the
wizard, show the session summary (facts + step list, read-only) with
"Submit session" — worker agency as the consent feature.

### E4. Validation (DoD)

Capture `npm test` green incl. ported wizard tests; readiness CLI run
against the dev box pasted in report; dead-man path unit-tested by
faking the health-event gap (no real 2-minute wait in tests); a manual
capture run on the dev box exercising wizard → submit → session folder
carries `self_annotations[]` (paste the JSON block). e2e stays green.

---

## 5. Owner's week-zero test (runs tonight, needs no Phase A code)

On a real marker-less session, locally:
`viewer\python\python.exe normalization\normalize.py <session> ` then
inspect `annotations.json → anchor_candidates[]` (or the viewer's Markers
panel). Verdict feeds back structure-only: candidate count, top score,
coverage, case balance — that decides whether the anchor thesis holds on
the worst real data or the detector needs work. Phase A's hero UI makes
this flow first-class either way.
