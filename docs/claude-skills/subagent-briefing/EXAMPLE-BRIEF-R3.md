# Example brief — R3 work items (a real brief, opus, zero-correction lane)

> The verbatim brief that produced commit `489d194` (ADR-0028 +
> case×screen work items) in the 2026-07-03 R-cycle — the strongest
> lane of that cycle: the agent probe-verified the load-bearing
> assumption before writing code, found the single label-resolution
> seam instead of patching three call sites, measured the demo's data
> shape and seeded its smoke honestly, and reported pass AND skip
> counts with the skips' coverage named. Use it as the model for
> **multi-phase feature cycles where agents commit** (owner-directed
> mode); use EXAMPLE-BRIEF.md for coordinator-commits polish passes.
>
> What to imitate, clause by clause:
> - **Scar-story law list** — every hard rule cites the failure that
>   created it ("each was violated once; treat as law"). Compliance
>   observably jumps when rules carry provenance.
> - **WHY block** — two sentences of design intent (what the unit of
>   work IS and why bounces break the old one) let the agent make
>   aligned micro-decisions the spec never enumerates.
> - **STEP 1 probe gate** — the phase's one load-bearing assumption is
>   verified FIRST, with stop-the-whole-phase wording and a pasted-
>   evidence requirement. Falsification as a numbered step, not a
>   footnote.
> - **Pre-authorized decision points** — forks the supervisor already
>   saw ("if registration requires a Python edit, STOP") come with the
>   approved fallback and a "state what you did" clause.
> - **Report contract** — paste final contracts (the ADR schema block),
>   every pin changed and why, counts with skips, ambiguities with
>   resolutions.

---

You are implementing phase R3 — the case×screen work-item unit + ADR-0028 — of an approved redesign in "D:\Game Development\Process Mining\process-discovery-tracker". Branch `redesign-r1` is checked out (HEAD 4b84d7c; R1+R2 landed). Work in place; no branch switches, no push, no release. One commit at the end (ADR + implementation together).

MANDATORY READING FIRST: docs/CHIP-GUARDRAILS.md (invariants incl. the ADR-registry guard + numbering rules, viewer launch recipe, UI-verification pitfalls), docs/To-Do/APPROACHABILITY-REDESIGN-2026-07-03.md §2 L1 + §5 R3 (your spec), docs/adr/0024-step-grain-as-view-time-rollup.md (the containment ladder + view-time precedent you extend), docs/adr/0009-normalization-redesign-v013.md (why fragment-tuning is banned), viewer/process-map-levels.js (rollUpSteps, screenType, resolveStepGrainKeys), viewer/views/steps-view.js, shared/SCHEMA.md (annotations format).

WHY: a worker handling one ticket bounces TAMBA→Excel→TAMBA a dozen times. Consecutive-run roll-up (ADR-0024) makes a new group at every bounce, so a real 1h session shows ~500 rows no one can navigate. The analyst's mental unit is "what I did on that ticket, per screen" — the CASE-SCOPED SCREEN VISIT, merged across bounces. R3 makes that the default Steps reading, with annotation at that level.

HARD RULES:
- Pipeline untouched: NOTHING under normalization/ or capture/ changes. shared/SCHEMA.md may gain DOCUMENTATION for the new additive annotations key (that is the ONLY shared/ edit allowed). The session golden and pytest must stay green and untouched.
- The raw steps array and every existing annotation key keep their exact shape. Your new key is ADDITIVE.
- NEVER stage anything under sessions/; baseline-snapshot before your first viewer launch; run the documented revert pair (`git checkout -- sessions/example-aggregate/ && git clean -fdq sessions/example-aggregate/`) before commit; stage explicit paths only.
- Report paste-verifiable numbers; paste final contracts (the ADR's schema block, the grouping key) not remembered deltas. Check whether existing code already gives you a piece before building it. STOP and report on any contradiction — the critical one to watch is #1 below.
- No new npm deps; CommonJS; node:test; commit `git commit -F`, imperative subject, no Co-Authored-By trailer. Do not touch CHANGELOG.md (series convention; the release cut updates it).

STEP 1 — VERIFY THE LOAD-BEARING ASSUMPTION FIRST (before writing anything): the plan assumes a re-normalize PRESERVES an unknown additive top-level key in annotations.json (precedent: Phase E's self_annotations[] survived). Test it: hand-add a dummy `group_annotations` entry to the demo session's annotations.json, run `viewer/python/python.exe normalization/normalize.py sessions/example-aggregate/sess-2026-0514-0900 --mine`, and check the key survived. If it does NOT survive, STOP THE WHOLE PHASE and report — do not work around it with fan-out writes or Python edits. (Clean up the experiment either way; sessions/ never gets staged.)

STEP 2 — ADR-0028 (docs/adr/0028-case-screen-work-items.md, follow the existing ADR format; register it wherever the ADR-registry guard requires — read test_adr_registry.py's contract from the docs, but remember you may not edit normalization/; if registration requires a Python-side list edit, STOP and report instead). Status: "Accepted (direction pre-approved by APPROACHABILITY-REDESIGN-2026-07-03 §5 R3; owner real-session validation pending)". Content: context (ADR-0009/0024 lineage, the 500-row failure), decision (view-time case-scoped screen visit; NON-consecutive merge within a case; bounce count preserved as a fact; additive `group_annotations[]` keyed {case_id, screen_key} carrying {name?, notes?, waste?, hidden?, manually_authored: true}; viewer-written; pipeline-preserved-not-consumed), the render-time flow-down rule (members display their group's name), the EXPORT trade-off stated honestly (PDD/memo export is Python-side and does not read group names this phase — listed as the follow-up), the no-cases fallback (unsegmented sessions keep the ADR-0024 roll-up + a CTA to the anchor/markers path), and alternatives rejected (fan-out writes to member steps: pollutes 500 rows + breaks re-normalize preservation semantics; pipeline-time grouping: destroys ADR-0024's reversibility and golden stability).

STEP 3 — the grouping module (new viewer/work-items.js, PURE, unit-tested): given steps + interactions + case assignments + the current screen-key machinery (reuse resolveStepGrainKeys/screenType — do not reimplement), produce: cases[] → work_items[] {screen_key, display label, member step ids IN CHRONOLOGICAL ORDER, total duration, visit_count (number of consecutive runs folded), fragment_count}. Non-consecutive merge WITHIN a case only; steps outside any case group under an "Unassigned" pseudo-case at the end. Unit tests must include: A-B-A-B interleave folds to 2 items with visit_count 2 each; case boundary keeps same screen in two cases separate; hidden steps excluded from duration but listed; no-cases input returns the fallback signal.

STEP 4 — Steps view default becomes the case tree (viewer/views/steps-view.js + index.html + CSS): when the session has cases (markers or accepted anchor), the Steps list renders cases → work items (collapsed; expand shows member fragments with jump-to-timeline). Work-item row: display name (group_annotations name → else screen label), duration, `visited N× · M steps`, and the same one-click acts the R1c detail panel established (inline rename, waste toggle, hide) — these WRITE to group_annotations via the existing annotations-save IPC path (same undo integration as other annotation writes if the pattern is reusable; if the undo stack is per-annotation-type and nontrivial to extend, make saves undoable via the existing mechanism or report the gap honestly — do not build a new undo system). Selecting a work item shows the R1c detail panel scoped to the group (facts aggregated; name/waste/hide act on the group; "More ▸" lists members). The element-grain flat list and the ADR-0024 grain slider stay fully functional — reachable via the existing Detail slider (document in the view's helper line which reading is active). No-cases sessions: current behavior + one-line CTA to the anchor/markers path (replace-pattern, not both).

STEP 5 — render-time flow-down: wherever member steps display a name (timeline step-lane bands when that lane is toggled on, map step-level labels via the existing label resolution, step detail), a group-named step shows the group name. Find the ONE label-resolution seam (process-map-levels/steps-view share it) rather than patching call sites; report where it is.

VALIDATION: unit tests green (`npm test` viewer); ALL smokes green (session 32/32, overview 13/13, map-slim 9/9, vocab 33/33, workbench 12/12, flywheel 10/10) — update pins ONLY where they pinned the old default Steps reading, and say which; NEW e2e/workitems-smoke.js: demo session (has 4 marked cases) renders the case tree; a work item folds >1 fragment somewhere (verify the demo actually produces a multi-visit fold — if its 4 cases never revisit a screen, seed the smoke's temp session copy with a synthetic revisit the way workbench-smoke seeds its vocab, and say so); renaming a work item persists to annotations.json group_annotations, survives an in-app re-analyze (STEP 1's guarantee, now pinned), and the member's timeline band shows the new name; golden check via `viewer/python/python.exe normalization/golden_check.py` pasted OK; `python -m pytest normalization/test/` pasted (must be "N passed", not skipped — if it reports skips for missing deps, say so rather than claiming green). Real-viewer eyeball light+dark: case tree collapsed, one item expanded, group rename mid-flight; doubled-marker + clipping checks; PAGE ERRORS pasted (0).

COMMIT (one commit: ADR + SCHEMA doc + code + tests + smoke), then report: STEP 1 outcome (pasted evidence), the ADR's final schema block (pasted), the grouping key + label-resolution seam you used, files touched, every pin changed and why, all counts pasted, eyeball findings, ambiguities + resolutions.
