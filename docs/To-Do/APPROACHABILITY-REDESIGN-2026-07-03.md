# Approachability Redesign — plan of record (2026-07-03)

> **Trigger:** owner critique, 2026-07-02/03 — a full-app walkthrough of why the
> owner "struggled for months to sit down and annotate" real recordings.
> **Status:** plan of record for the next cycle; the operational successor to
> the drained autonomous backlog in [NEXT-SESSION-SPEC.md](NEXT-SESSION-SPEC.md) §3.
> **Authority:** extends the Honesty Redesign ([LAB-PHASE-SPEC.md](../LAB-PHASE-SPEC.md) §1).
> Memo / Evidence / Machine and the tier gates stay supreme; this doc adds a
> **use gate** on top of them. No new taxonomy. The 2026-07-01 disclosure pass
> ([DESIGN-CRITIQUE-2026-07-01.md](DESIGN-CRITIQUE-2026-07-01.md)) stands; it
> polished presentation — this cycle fixes what is presented.

## 1. The bug

The app is information-saturated to the point that its only real user cannot
make himself use it. Every panel is honest, tested, and documented — and the
sum is "unapproachable, scary, tiring just to look at." That is the defect.

**Cycle success metric (the only one):** one real session → ≤ 45 minutes of
analyst work → a 2-page findings memo — repeated on three real sessions,
timed, without dread. The committed demo session is **never again an
acceptance test** for a surface; every phase gate below ends on a real
session. (The demo stays as regression data — goldens, e2e — not as proof of
usefulness.)

## 2. Diagnosis — the layer model

Four layers; each lower layer invalidates the work above it. The week's
complaints (Analysis, Compare, vocabs, templates, Steps, timeline) all
trace down.

- **L0 — Labels.** Vocab coverage ≈ zero for the real estate (TAMBA / SNFI /
  ES Call Management — the shipped vocabs cover the SaaS/Office probe estate),
  and window titles embed case values the shared strip-patterns don't know.
  Result: the value-free screen key degenerates to raw titles → **nothing
  collapses anywhere** (steps roll-up, map screen axis, analysis grouping).
- **L1 — The unit of work.** Segmentation emits mechanical fragments, not
  tasks ([ADR-0009](../adr/0009-normalization-redesign-v013.md) measured ~308
  fragments where ~70 real steps existed; "model mismatch, not a tuning
  bug"). Even with perfect L0 keys, the consecutive-run roll-up
  ([ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md)) splits on every
  app bounce, so interleaved work can never fold to memory-sized units.
- **L2 — Surfaces.** Views render fragments at full volume with per-fragment
  asks: a 500-row step list navigable by nothing the analyst remembers, a
  detail editor whose empty fields read as 500 × N owed answers, a timeline
  painting five lanes of confetti at 1-hour scale, a vocab editor made of
  blank UIA-schema inputs disconnected from the captured evidence
  ([vocab-view.js](../../viewer/views/vocab-view.js) is "self-contained" by
  design), and destination-nouns (Templates) nothing in any workflow ever
  hands you.
- **L3 — Analytics.** Consulting furniture rendered without earning it at
  observed N: a nine-column ROI table of manufactured zeros under its own
  "nothing to see" floor sentence, a flat config constant
  (`automatable_fraction` 0.7, [analysis_roi.py](../../normalization/analysis_roi.py))
  rendered as a per-row AUTO% column, a ranked candidate table duplicating
  the findings feed in a second vocabulary, waste/efficiency modules that are
  input-starved forms, and a Compare surface (~20 blocks) that **merges**
  when its one job is to **difference**.

Two structural observations worth keeping:

- **Surfaces grew fastest where use pressure was lowest.** Compare (needs a
  multi-session corpus that barely exists) reached ~20 blocks; Templates'
  only successful user is an e2e script. Nothing ever pushed back.
- **Only one deletion in project history** (ADR-0027, and it was a
  replacement). Every cycle added; sediment tags (`P0.2`…`§D2`) sit layered
  in single functions. The disclosure model demoted content; the use gate
  below is the first rule that can *remove* it.

## 3. The use gate (the border)

The tier gates answer *"may this render truthfully?"* The use gate answers
*"did this earn residence?"* A surface/module is resident only if, on a
**real** session, it produces at least one of:

1. **A memo sentence** — something pasteable into the 2-page deliverable
   without embarrassment;
2. **A recorded analyst decision** — an annotation/override/judgment that
   changes an output;
3. **A capture instruction** — name this control, accept this anchor, fire
   markers here, re-record app X.

Fails all three at N = one session → finding-when-it-has-something-to-say,
Machine drawer, or deletion. Corollaries:

- **An assumption never gets a column.** Config constants render once, in the
  assumptions line.
- **Gates gate composites, not just heroes.** A floored headline above a
  rendered table of zeros is a gate in name only.
- **A merged quantity cannot answer a comparison question.** Compare renders
  deltas or nothing.
- **Any per-item ask is multiplied by item count before it ships.** 500 ×
  anything is a rejected design.
- Heuristic: *a number earns pixels when someone will act on it; below that
  it's a sentence; below that a CTA; below that, nothing.*

## 4. Verdicts (whole app)

| Surface | Verdict |
|---|---|
| Overview (facts + findings) | Keep — the product. Absorbs candidates/waste/efficiency as findings; becomes home in R4. |
| Flow timeline | Keep, cut to 2 default lanes (apps + cases/playhead); other lanes opt-in; one click semantic = seek + select. |
| Video controls | Fine — untouched. |
| Steps list | Rebuild case-first on the R3 unit; element-grain flat list demotes to Machine drawer. |
| Step detail | Triage economics: one primary act per row; group-level annotation; full workspace only for memo-bound steps. |
| Phases | Keep — cheap, coherent. |
| Map | **No work.** Faithful renderer of polluted input; fixes are L0/L1. Notation × level matrix stays drawer-tier. |
| Analysis: Where the time goes | Keep — the one earning module (Tier 1). |
| Analysis: Candidates | Detection + Confirm/Dismiss stay; presentation becomes finding cards; ranked table killed below ~10 instances. |
| Analysis: €-ROI | Whole section gates on entered volume + wage; below: one sentence + Edit-assumptions CTA. No AUTO% column. |
| Analysis: Waste + Efficiency | Killed as resident modules; judgment affordance moves to the top time-sink steps; a finding once ≥1 judgment exists. |
| Analysis tab | Gutted in R1; retired into Overview's evidence layer in R4. |
| Compare | Findings + aligned reading + side-by-side + one delta table resident; merged chart / 80-row variants / pooled outliers+rework / agg-analysis → one Machine drawer; exports → menu; merged map only with template conformance. |
| App Library / vocabs | Rebuilt as the **match workbench** (R2) — session-grounded naming; YAML/form editor demotes to Machine drawer. |
| Templates | Out of primary nav. Returns in R4 as a byproduct verb ("Save as reference…") + auto-offer on a second session of the same process. |
| Capture app | Structurally fine; small guidance pass on recording controls (R4). Marker discipline is the one lever that matters. |
| PDD / memo export | Keep — the deliverable everything above is measured against. |

## 5. The repair plan

Each phase: branch off `master`, fast-forward back, delete the branch
(standing convention). e2e pins are updated **with** each cut — deliberately,
in the same commit, never left red or silently loosened. The session golden
is untouched all cycle (R1/R2/R4 are viewer-side; R3 is view-time by
design). Every phase ends with an owner sit-down on a real session — that
sit-down, not the green suite, closes the phase.

### R1 — Subtract (the fear pass) · viewer-only · ~1–2 sessions

Pure deletion/demotion per §4: gut Analysis (facts + Where-the-time-goes +
candidates-as-findings; ROI gated whole; waste/efficiency out), reorder
Compare (comparative content resident, merged content behind one drawer,
exports to a menu), timeline to 2 default lanes, Templates out of nav, step
detail collapsed to primary-act + expansion. No new capability anywhere.
**Gate:** resident block count per surface roughly halves; owner opens a real
session and reports "I can look at it."

### R2 — Name things fast (the match workbench) · ~2–3 sessions

The App Library rebuilt around captured evidence, closing ADR-0025's open
trigger-placement question in favor of **viewer-side, session-grounded**:

- Load session(s) + vocab together → three lists: **matched** (verify against
  screenshot), **unmatched captured controls** (the worklist — click, see
  screenshot + captured properties, type the business name; signature derives
  itself, volatility flagged by the existing picker logic), **dead rules**
  (entries matching nothing — the "is my selector wrong" state, first-class).
- Coverage % resident and rising as you work; screens named the same way
  (window_title_regex suggested by diffing observed titles — the volatility
  picker applied to titles).
- "Add to App Library…" reused wherever a raw label renders (steps rows,
  analysis rows via the group's modal interaction, shown honestly).
- Hand-editing YAML and the four blank signature inputs demote to the
  Machine drawer.

**Gate (real session, owner-run):** vocab authored in-app without touching
YAML; coverage visibly rises; element→screen roll-up reduces rows ≥ 5× on a
real capture (the L0 unlock, measured).

### R3 — The right unit (case × screen work items) · ~2–3 sessions, ADR first

**ADR-0028 (draft first):** the analyst-facing unit of work is the
**case-scoped screen visit** — fragments aggregated *across* bounces within a
case (non-consecutive merge), computed at view time on the ADR-0024 ladder
(no pipeline rewrite; raw steps preserved; golden stable). Annotations attach
at the group level via an additive `group_annotations` keyed
`(case_id, screen_key)` — name/note/waste once, flows to members at render
and export; per-fragment annotation stays possible in the drawer. Steps view
becomes: cases → work items → fragments (drill); the timeline step lane and
the map's step level read the same groups.
**Gate (real 1h session):** ≤ ~60 work items at default view; "find that
ticket" takes seconds; annotating the memo-bound ~15 feels like 15, not 500.

### R4 — The spine (verbs, not nouns) · ~1–2 sessions

The app is reorganized by the analyst's sequence, not the system's nouns.
Overview becomes home with a **next-act rail** derived from data state:
low coverage → "Name the top N controls" (workbench); unsegmented → "Review
the anchor candidate"; then "Walk the story" (timeline), "Judge the top 3
time sinks", "Assemble the memo" (include-in-memo queue → memo export).
Analysis tab retires into Overview's evidence layer. Templates return as a
byproduct verb ("Save as reference for this process") + an auto-offer when a
second session of the same process loads. Capture side gets the requested
recording-controls guidance (one status line + what-to-do-now affordance).
**Gate:** a cold open of a fresh real session shows exactly one suggested
next act; capture→memo requires no documentation.

### R5 — Prove and prune (the empirical border) · owner-paced + 1 session

Three real sessions → three timed memos (the lab-phase assets, finally:
anchor verdict, estate vocab library, mirror-tested memos). Lightly
instrument the sit-downs (time per stage, surfaces touched). Then execute
the border: **anything that contributed zero memo sentences, zero recorded
decisions, and zero capture instructions across all three memos is cut or
Machine-demoted**, with COHERENCE-AUDIT inverses. Update CLAUDE.md's active
direction; cut the release.

## 6. Process rules (new, permanent)

1. **Real-session acceptance.** No phase closes on demo data. The owner
   sit-down is the gate; the suites are the floor.
2. **Company captures stay local** — unchanged. The owner runs real-data
   gates; anything shared with an assistant goes through the structure-only
   scripts.
3. **The use gate applies to new work.** A proposed surface names its memo
   sentence / decision / capture instruction *in the spec* or it isn't built.
4. **Parking lot** (§8) collects new critique items mid-cycle; they do not
   reroute the phase in flight.

## 7. Unchanged constraints

Honesty architecture supreme (tier gates outrank everything, including this
plan); no ML/LLM runtime; raw `events.jsonl` immutable; suggest-don't-mutate;
two-machine model; ADR-0026 scope (services boutique — the out-of-scope list
stays out); ADR numbering + registry guard; commit style (imperative, no
trailer).

## 8. Parking lot

- (2026-07-03) Owner: "things will pop up as we work along" — add here, not
  to the phase in flight.
