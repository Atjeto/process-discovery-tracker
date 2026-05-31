# Normalization

> Overview-level. For depth see [`normalization/README.md`](../../normalization/README.md)
> and [ADR-0002](../adr/0002-app-vocabularies.md).

## Purpose & entry point

Normalization is the **analyst-side Python pipeline** that turns a raw
`events.jsonl` into an analyzable, mineable dataset. It is a CLI:

```
python normalize.py <session_folder> --taxonomy <taxonomy.yaml> [--mine] [--canonical <canonical.yaml>]
```

It is invoked either directly by an analyst or — far more often — by the Viewer,
which spawns it via [`viewer/python-runner.js`](../../viewer/python-runner.js) using
a bundled Python 3.12 embeddable distribution.

## Pipeline stages

`normalize.py` orchestrates these stages in order:

1. **Load & validate** — parse `events.jsonl`, defensively sort by timestamp,
   count dropped/malformed lines. A keystroke-coalescing pass (`coalesce.py`,
   `coalesce_typing_bursts`) then folds per-keystroke `value_changed` bursts on one
   control into a single final-value event before later stages see them (v0.13 §1).
2. **Apply marker edits** — replay `annotations.json.marker_edits`
   (rename / re-time / delete / insert) onto the marker stream.
2b. **Structural PII masking** ([§11f](../To-Do/PDT-ROADMAP-CODEBASE-FIT.md), `pii_masking.py`) —
   redact sensitive UIA field **values** (password / SSN / card / CVV / PIN /
   secret / IBAN / routing / account, matched by field name·automation_id·control_type)
   in the **derived** stream only, replacing each with a one-way, join-preserving
   `«category#hash»` token. Raw `events.jsonl` is never rewritten; the rule-set that
   ran is recorded in the `pii_masking` annotations key, and the analyst-owned
   `pii_masking_config` can disable it or add rules. Runs right after coalesce so
   every later stage (case assignment, steps, stats, analysis, maps) sees only the
   masked values.
3. **Case assignment** — two mechanisms. **Marker-based:** walk the Start/End
   marker stream, build the case tree, stamp every activity/interaction with its
   `case_ids` stack. **Anchor-based** ([ADR-0012](../adr/0012-active-case-stamping-and-map-matrix.md)):
   when the canonical set names a `case_anchor` field, cases are detected from
   anchor fires instead — a case is named by its anchor value and is *stable per
   label* (`case_id = uuid5(label)`, so re-searching the same serial **resumes**
   that case rather than opening a new one), the most-recently-fired anchor is the
   active case, and stamping follows each case's disjoint active segments. A
   degenerate-case guard drops slivers and an empty-label guard ignores a focus on
   an empty anchor box (`detect_cases_from_anchors` / `stamp_anchor_cases`). The
   `case_anchor` field is named either by a **recognised** category (`recognized`,
   [ADR-0011](../adr/0011-platform-recognition-layer.md) — portable across
   engagements) or by an explicit `automation_id` / value rule (the per-engagement
   fallback; ADR-0012 #7). **Anchor precedence is `template > override > markers`:**
   the engagement-level Process Template's `case_anchor` wins; absent that, the
   session-level `annotations.json.case_anchor_override` (the analyst's accepted
   anchor candidate, [ADR-0018](../adr/0018-anchor-candidates.md)) is consulted via
   `coerce_anchor_override`; absent both, the pipeline falls back to marker mode.
4. **Collapse** — merge adjacent identical activity events (same app/title/label/case).
5. **Interaction enrichment** — apply App Vocabularies to add `meaningful_name`,
   `screen_id`, and `vocab_flags`.
6. **Step suggestion** — group consecutive interactions into `auto_suggested` steps
   (the step-noise denylist in `step_filters.ignored_processes` is applied first;
   the browser-chrome noise filter uses the shared recognition layer —
   [ADR-0011](../adr/0011-platform-recognition-layer.md)). Each step is stamped
   with a value-free **`process_label`** — its name with case values stripped
   (`Search — CUST-10900` → `Search`) — so repeated work collapses to one
   node/row downstream ([ADR-0013](../adr/0013-value-free-grouping-and-map-readability.md)).
7. **Boundary suggestion (unbracketed-session recovery)** — best-effort, runs
   right after case assignment. Two hand-rolled detectors close the "worker forgot
   to fire markers, no Process Template" failure mode where everything collapses
   into one default case (Phase 0 of the ML integration recommendation):
   - **Suggested markers** (`marker_suggest.suggest_markers` /
     `merge_marker_suggestions`, [ADR-0017](../adr/0017-suggested-markers.md)) — a
     change-point detector scores four signals (idle gap, return to a "home" app,
     transaction-ID-like value typed, app-cluster boundary) over the **uncased**
     stretches and emits paired Start/End candidates into
     `annotations.json.marker_suggestions[]`. Signature-keyed; the merge drops any
     boundary in `marker_suggestions_dismissed[]` or already accepted as a
     `marker_edits[]` op:insert, so dismissals/accepts survive re-normalize.
   - **Anchor candidates** (`anchor_suggest.suggest_anchors` /
     `merge_anchor_candidates`, [ADR-0018](../adr/0018-anchor-candidates.md)) —
     pattern-mines `value_changed` / `text_changed` fields, *simulates*
     `detect_cases_from_anchors` for each, scores the resulting case structure
     (coverage / balance / diversity / focus), and writes the top candidates into
     `anchor_candidates[]`. The analyst's Accept writes a `case_anchor_override`
     that stage 3 consults on the next run.
   Both honour the suggest-don't-mutate invariant: detection lives in
   `annotations.json`, raw `events.jsonl` is untouched, and a detector edge case is
   caught and never blocks the pipeline.
8. **Canonical matching** — with `--canonical`, match interactions against a
   canonical step set, producing `auto_matched` steps.
9. **Step merge** — `_merge_steps()` (in `step_suggest.py`) keeps
   `manually_authored + edited` steps and replaces only the `auto_*` set. A fresh
   auto step **inherits** the prior step's `step_id` and curated `phase_id` /
   `canonical_step_id` when it re-covers the same interactions
   (`_inherit_step_identity`), so a grouping or curation applied to a regenerated
   step is not silently lost on re-analyze (see [DATA-MODEL.md](./DATA-MODEL.md)).
10. **Drift detection** — flag steps whose canonical assignment would now resolve
   differently; record `drift_markers`.
11. **Statistics** — compute activity, case, variant, outlier, and rework stats.
12. **Export** — write `events.xes`, `events.csv`, `stats.json`, and the updated
    `annotations.json`.
13. **Analysis layer** — when the session has steps, compute the heuristic
    waste / time-study / automation / efficiency findings and write
    `analysis.json` ([ADR-0008](../adr/0008-build-the-analysis-layer.md)).
14. **Mining** — with `--mine`, run PM4Py to produce the activity-level
    `process_map.bpmn` and `dfg.json`, **and** the observed-flow
    `process_map_step.bpmn` / `process_map_phase.bpmn` (mined from the
    annotations via `bpmn_observed.py`) plus per-case BPMNs under `process_maps/`.

## Module map (`normalization/`)

| File | Role |
|---|---|
| `normalize.py` | CLI entry point; a **thin orchestrator** (~250 lines) that loads the session, runs the PII-masking stage inline, then calls the `_run_*` stages from `pipeline_stages.py` in order. The pipeline logic is decomposed (Wave 0 / F4 and after) into the five focused sibling modules below; `normalize.py` re-imports the names that `normalize.X` / `from normalize import X` and the tests still reference so those resolve unchanged. |
| `session_io.py` | Session-folder I/O: `load_events` (+ `_coerce_event_shape` defensive shaping), `load_manifest`, `load_annotations`, `write_annotations`, and the optional screenshot aHash pass (`compute_screenshot_hashes`). Pure I/O, no pipeline logic. |
| `marker_edits.py` | `apply_marker_edits` — replays `annotations.json.marker_edits` (rename / re-time / delete / synthetic insert) onto a **derived** event stream; raw `events.jsonl` untouched (§9.3 b). |
| `phase_reconcile.py` | Keeps regenerated `auto_*` annotations consistent with preserved `manually_authored`/`edited` ones on re-analyze: `_merge_phases`, `reconcile_phase_membership` (the dual phase↔step membership, CR M-4), and `_compute_drift_markers` (canonical-drift flags). |
| `pipeline_config.py` | Per-session config read from `annotations.json`: the step denylist (`_step_ignored_processes`), excluded ranges (`_excluded_ranges`), and the F3 calibration surface (`_DEFAULT_CALIBRATION` / `_calibration` / `_step_calibration_kwargs`). |
| `pipeline_stages.py` | The named pipeline stage helpers (`_run_coalesce` / `_run_case_assignment` / `_run_suggestions` / `_run_step_segmentation` / `_run_classification` / `_run_event_log_export` / `_run_stats` / `_run_analysis` / `_run_mining_exports` + `_init_existing_anno`). Each is the verbatim body of one stage; `normalize()` is now a thin orchestrator threading shared state between them. Heavy optional deps (pm4py, analysis, bpmn_*, pdd_export) stay function-local. |
| `case_assignment.py` | Marker-based case tree + `case_ids` stamping, **and** anchor-based active-case detection/stamping (`detect_cases_from_anchors` / `stamp_anchor_cases` — [ADR-0012](../adr/0012-active-case-stamping-and-map-matrix.md)). |
| `recognition.py` | Classifies an interaction into a semantic *category* from documented platform/framework signatures, loaded from `shared/recognition-patterns.json` (shared with the viewer). `recognize()` / `is_browser_chrome()` ([ADR-0011](../adr/0011-platform-recognition-layer.md)). |
| `classification.py` | Rule-based activity classification against the taxonomy; an unmatched activity falls back to a **semantic** label from the dominant recognised interaction category (`Form entry -- chrome.exe`) rather than `Unclassified -- app`. |
| `classification_overrides.py` | Applies the analyst's reclassification corrections (`annotations.json.classification_overrides`) during normalization — instance + rule scope, after taxonomy classification (design §6.1 / §7.2). |
| `step_suggest.py` | Heuristic `auto_suggested` step grouping; stamps the value-free `process_label` and the `grain_keys` (`element`/`screen`/`app`) the view-time grain ladder rolls up (ADR-0024); the step-name prefix is value-freed via `screen_label` (shared `screen-label-patterns.json`, §6a); owns `_merge_steps()` and `_inherit_step_identity()` (step-identity inheritance across re-analyze). |
| `marker_suggest.py` | Change-point detector for unbracketed sessions — scores idle-gap / home-app-return / transaction-ID-typed / app-cluster signals over the uncased stretches and emits paired Start/End suggestions; `suggest_markers` + signature-keyed `merge_marker_suggestions`. Hand-rolled, pandas + stdlib only ([ADR-0017](../adr/0017-suggested-markers.md)). |
| `anchor_suggest.py` | Pattern-mines `value_changed`/`text_changed` fields, simulates `detect_cases_from_anchors` per candidate, and ranks the fields that best segment the session into cases; `suggest_anchors` + `merge_anchor_candidates` + `coerce_anchor_override` (validates/strips the analyst's accepted override before it reaches case assignment). Stdlib only ([ADR-0018](../adr/0018-anchor-candidates.md)). |
| `canonical_match.py` | Matches interactions to a canonical step set (`auto_matched`). |
| `app_vocab.py` | Loads and applies App Vocabularies to enrich interactions. Also authors starter vocabs: `bootstrap_from_session` (interacted-only) and `bootstrap_from_snapshot` (full live-window control set via the volatility picker — [ADR-0025](../adr/0025-in-app-vocabulary-discovery.md)). |
| `signature_pick.py` | **Volatility-diff signature picker** (the ADR-0025 clever core). Joins a two-pass window snapshot's controls by a stability-independent key (role + label + ancestry + bounds bucket — never the candidate id), marks an `automation_id` volatile when it changed across passes *or* matches a per-render pattern (`^input-\d+$`, bare GUID, …), then picks the most-stable signature down the ADR-0023 ladder, skipping volatile fields — reproducing the analyst's hand-judged Office-idMso / ServiceNow-id / Salesforce-label calls. Pure-Python (no pandas/yaml). |
| `coalesce.py` | Folds a burst of per-keystroke `value_changed` events on one control into a single final-value event (`coalesce_typing_bursts`, v0.13 §1) — runs early (stage 1) so later stages never see partial typed values. |
| `pii_masking.py` | Structural PII masking (§11f) — `mask_events` redacts sensitive field **values** in the derived stream (raw `events.jsonl` untouched) with a one-way, join-preserving `«category#hash»` token; default rule-set + analyst `pii_masking_config`. Runs right after coalesce. stdlib-only. |
| `stats_compute.py` | Builds `stats.json` (activity / case / **step** / variant / outlier / rework / meta); `step_stats` + `step_variants` group by `process_label` so they don't fragment per instance. |
| `analysis*.py` | Analysis layer — `analysis.py` orchestrates `analysis_waste` / `_time_study` / `_automation` / `_efficiency` over the `analysis_common` per-step segmentation. Time-study + automation group steps by `step_group_key` (`canonical_step_id → process_label → step_id`) so repeated work collapses to one row ([ADR-0008](../adr/0008-build-the-analysis-layer.md), [ADR-0013](../adr/0013-value-free-grouping-and-map-readability.md)); writes `analysis.json`. |
| `xes_export.py` | Emits `events.xes` (IEEE 1849-2016), one trace per top-level case. |
| `step_csv.py` | Flat CSV of step entities for pivot analysis. |
| `mining.py` | PM4Py wrappers — inductive / heuristics miners, DFG. |
| `bpmn_observed.py` | **Observed-flow** Step/Phase BPMN, mined from the analyst's annotations (one trace per case over step/phase labels → PM4Py → BPMN with a pure-Python layout). Needs no Process Template ([ADR-0012](../adr/0012-active-case-stamping-and-map-matrix.md)). |
| `bpmn_step.py` / `bpmn_phase.py` | Template-derived Step/Phase BPMN (needs `--canonical`); the viewer + exports prefer the observed-flow file above when there is no template. |
| `pdd_export.py` | Process-definition `.docx` export. |
| `log_setup.py` | Configures the rolling `normalize.log`. |

## Canonical sets & App Vocabularies

Two external YAML layers shape the output beyond the raw heuristics:

- **Canonical step sets** (`--canonical`) — a reference definition of "the right
  process steps". Matching interactions against it produces `auto_matched` steps
  and a `match_rate`; drift detection watches for the canonical set shifting under
  prior analyst assignments.
- **App Vocabularies** (`normalization/app_vocabularies/*.yaml`) — per-application
  dictionaries mapping raw UIA fields to human-readable `meaningful_name` /
  `screen_id` / default `vocab_flags`. Rationale: [ADR-0002](../adr/0002-app-vocabularies.md).

## Recognition layer

`recognition.py` classifies an interaction into a semantic *category* — `form_field`,
`grid_cell`, `primary_action`, `browser_chrome`, … — from **documented, stable
platform/framework signatures** (UIA ControlTypes + Chromium/Bootstrap/AG-Grid/
SharePoint/Office), not per-session opaque selectors. The signature table lives in
`shared/recognition-patterns.json` and is loaded by **both** this module and the
viewer (`viewer/recognition.js`), so the two classify identically. It feeds the
step-suggester's browser-chrome noise filter and the classification fallback
above. Rationale and grounding: [ADR-0011](../adr/0011-platform-recognition-layer.md).

## Outputs

All written back into the same session folder:
`events.xes`, `events.csv`, `stats.json`, `analysis.json` (when the session has
steps), `process_map.bpmn` + `dfg.json` + the observed-flow
`process_map_step.bpmn` / `process_map_phase.bpmn` + per-case `process_maps/`
(with `--mine`), an updated `annotations.json`, and `normalize.log`. Re-running is
non-destructive — `stats.json.meta.normalization_run_at` lets consumers detect
stale derivatives. Field-level detail is in
[`shared/SCHEMA.md`](../../shared/SCHEMA.md) → "Post-normalization artifacts".
