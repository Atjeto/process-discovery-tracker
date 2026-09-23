# Normalization

> Overview-level. For depth see [`normalization/README.md`](../../normalization/README.md)
> and [ADR-0002](../adr/0002-app-vocabularies.md).

## Purpose & entry point

Normalization is the **analyst-side Python pipeline** that turns a raw
`events.jsonl` into an analyzable, mineable dataset, and, when asked, a PDD.
It is a CLI (contract C11):

```
python normalize.py <session_folder> [--taxonomy <taxonomy.yaml>] [--mine]
    [--pdd-out <path.docx>] [--pdd-map-image <path.png>] [--pdd-tobe-image <path.png>]
    [--names <remembered-names.json>]
```

`--taxonomy` stays for now (whether drafting or analysis still need activity
classification is an open question, [ADR-0029](../adr/0029-ba-helper-refocus.md)
Q4). `--names` is new: the viewer's remembered-names store (contract C4), so
a drafted step whose `draft_key` the analyst has already named once takes
that name again. Flags removed with the features behind them: `--canonical`,
`--phase-bpmn-out`, `--step-csv-out`, `--memo-out`, `--bootstrap-vocab-out`,
`--vocab-id`, `--vocab-name`, `--bootstrap-vocabs-json`, and `--step-bpmn-out`
(it only ever rendered a template's steps; the step-level map BPMN the
viewer exports is `process_map_step.bpmn`, written by `--mine`). Exit codes
are contract C13, documented in [shared/SCHEMA.md](../../shared/SCHEMA.md).
The transcript importer (below) has its own, separate CLI entry point.

It is invoked either directly by an analyst or — far more often — by the Viewer,
which spawns it via [`viewer/python-runner.js`](../../viewer/python-runner.js) using
a bundled Python embeddable distribution.

## Pipeline stages

`normalize()` (`normalize.py`) is a thin orchestrator over the named stage
helpers in `pipeline_stages.py`, in this order:

0. **Exclude self / ignored processes**: before anything else, drop PDT's
   own interactions (the operator panel, dialogs) and any analyst-excluded
   process or window from the *derived* stream (`process_filter.py`), so
   self-capture noise never mines into phantom steps. Raw `events.jsonl` is
   untouched; re-analyzing an existing session cleans it.
1. **Coalesce + marker edits** (`_run_coalesce`): a keystroke-coalescing
   pass (`coalesce.py`, `coalesce_typing_bursts`) folds per-keystroke
   `value_changed` bursts on one control into a single final-value event
   (v0.13 §1), then replays `annotations.json.marker_edits` (rename /
   re-time / delete / insert) onto the marker stream (`marker_edits.py`).
2. **Case assignment + app-vocab enrichment** (`_run_case_assignment`):
   walk the Start/End marker stream, build the case tree, stamp every
   activity/interaction with its `case_ids` stack (`case_assignment.py`
   `assign_case_ids`; deterministic ids seeded from the session, contract
   C9 / RP-01). Anchor-based case detection is gone: `case_assignment.py`
   has no anchor code path anymore, so a session with no fired run markers
   has no cases at all (a Flow instruction tells the analyst to mark runs).
   Loaded App Vocabularies then enrich matching interactions
   (`meaningful_name` / `screen_id` / `vocab_flags`), and
   `app_names.build_app_names` derives a readable name per executable for
   this recording (stats.json `meta.app_names`, deliverable-audit gap 3).
3. **Step drafting** (`_run_step_segmentation`): the drafting rule
   (contract C1, `step_suggest.auto_suggest_steps`) replaces the earlier
   free-running step auto-suggester. Within one run, walk interactions in
   time order; a step is a run of consecutive interactions on one screen,
   ending at (a) a commit interaction, inclusive (a button / split button /
   menu item / link invocation, or a vocab entry with `completion: true`);
   (b) the first interaction on a different screen, exclusive; or (c) the
   end of the run. Every drafted step carries a value-free `draft_key`
   (`"<app>|<screen>|<commit>"`), `name_source` (`remembered` when the
   `--names` store has that key, else `draft`), and `end_reason` (`commit`
   / `screen_change` / `run_end`). `draft_summary()` computes the P1
   draft-quality probe numbers on the fresh drafts (before the merge
   below); `_merge_steps()` then keeps every analyst-owned step
   (`manually_authored` / `edited` / `confirmed` / `hidden`) and replaces
   only the `auto_suggested` set, dropping a fresh draft that overlaps an
   analyst-owned step and inheriting `step_id` / `grain_keys` where a fresh
   step re-covers the same interactions. `restamp_preserved_case_ids`
   (contract C9) then moves a preserved step to whichever run now contains
   it, if its own run was removed. The merged steps are written back to
   `annotations.json` here (not deferred to the final export step).
4. **Classification** (`_run_classification`): taxonomy classification
   (`classification.py`) plus the analyst's `classification_overrides[]`
   (applied last, before collapse), then two collapses: `collapse_adjacent`
   (the per-window rows `events.csv` keeps) and
   `collapse_activity_occurrences` (the coarser event-log rows the process
   maps mine, so a directly-follows self-loop cannot appear).
5. **Event-log export** (`_run_event_log_export`): build the PM4Py event
   log and write `events.xes` + `events.csv`.
6. **Statistics** (`_run_stats`): compute activity / case / step / variant
   / outlier / rework stats and write `stats.json`, including the
   `step_state_breakdown` (now `auto_suggested` / `manually_authored` /
   `edited` / `confirmed` / `hidden`), `draft_summary`, and `app_names`
   meta fields.
7. **Analysis layer** (`_run_analysis`): when the session has steps,
   compute the heuristic waste / time-study / segment / automation-candidate
   / efficiency findings ([ADR-0008](../adr/0008-build-the-analysis-layer.md),
   [ADR-0016](../adr/0016-segment-level-automation-candidacy.md)); always
   compute the case-boundary-free Tier-1 blocks (`case_quality`, `facts`,
   `findings`). A stage that fails leaves its own output key `null` and
   records one entry in `analysis.json.stage_errors` (contract C12); the
   findings stage does not even attempt to run if one of its own inputs
   failed. There is no ROI stage anymore: the business-case formula lives
   in the owner's QB app ([ADR-0029](../adr/0029-ba-helper-refocus.md) D3).
8. **Mining + PDD export** (`_run_mining_exports`): with `--mine`, the DFG
   (`dfg.json`), the aggregate activity-level `process_map.bpmn` (PM4Py
   inductive miner), the observed-flow step BPMN
   (`process_map_step.bpmn`, via `bpmn_observed.py`, with no phase-level
   counterpart anymore), and per-case BPMNs under `process_maps/`. With
   `--pdd-out`: render the PDD (`pdd_export.write_pdd`), built around the
   analyst's confirmed pattern run (contract C3) and document sections
   (contract C6); a failure here raises after every analysis output is
   already written (contract C13 exit code 3).

Boundary suggestion (suggested markers, [ADR-0017](../adr/0017-suggested-markers.md))
and anchor candidates ([ADR-0018](../adr/0018-anchor-candidates.md)), the
unbracketed-session recovery detectors that used to run right after case
assignment, are gone (`marker_suggest.py` and `anchor_suggest.py` are
deleted). A missed run marker is now added by hand in Flow. Canonical
matching (`canonical_match.py`, stage "8" in the pre-[ADR-0029](../adr/0029-ba-helper-refocus.md)
version of this doc) and drift detection (`phase_reconcile.py`'s
`_compute_drift_markers`) are gone with it; both files are deleted.

## Module map (`normalization/`)

| File | Role |
|---|---|
| `normalize.py` | CLI entry point; a **thin orchestrator** that loads the session, runs the self/ignored-process filter inline, then calls the `_run_*` stages from `pipeline_stages.py` in order. `normalize.py` re-imports the names that `normalize.X` / `from normalize import X` and the tests still reference so those resolve unchanged. |
| `session_io.py` | Session-folder I/O: `load_events` (+ `_coerce_event_shape` defensive shaping), `load_manifest`, `load_annotations` / `write_annotations` (atomic, via `write_json_atomic`; raises `AnnotationsUnreadable`, contract C13 exit code 2), and the optional screenshot aHash pass (`compute_screenshot_hashes`). Pure I/O, no pipeline logic. |
| `marker_edits.py` | `apply_marker_edits` — replays `annotations.json.marker_edits` (rename / re-time / delete / synthetic insert) onto a **derived** event stream; raw `events.jsonl` untouched (§9.3 b). |
| `process_filter.py` | `filter_excluded`, which drops PDT's own interactions and any analyst-excluded process/window from the derived stream, before coalesce/case-assignment. |
| `pipeline_config.py` | Per-session config read from `annotations.json`: the step denylist (`_step_ignored_processes`), excluded ranges (`_excluded_ranges`), and the calibration surface (`_DEFAULT_CALIBRATION` / `_calibration` / `_step_calibration_kwargs`): only `coalesce_idle_ms` and `filter_browser_chrome` still do anything, and the old segmenter's other knobs are read and ignored (`_IGNORED_CALIBRATION_KEYS`). |
| `pipeline_stages.py` | The named pipeline stage helpers (`_run_coalesce` / `_run_case_assignment` / `_run_step_segmentation` / `_run_classification` / `_run_event_log_export` / `_run_stats` / `_run_analysis` / `_run_mining_exports` + `_init_existing_anno`). Each is one stage; `normalize()` is a thin orchestrator threading shared state between them. Heavy optional deps (pm4py, analysis, bpmn_observed, pdd_export) stay function-local. |
| `case_assignment.py` | Marker-based case tree + `case_ids` stamping (`assign_case_ids` / `collect_cases`), with deterministic case ids seeded from the session (contract C9 / RP-01). No anchor-based case detection anymore ([ADR-0029](../adr/0029-ba-helper-refocus.md)). |
| `recognition.py` | Classifies an interaction into a semantic *category* from documented platform/framework signatures, loaded from `shared/recognition-patterns.json` (shared with the viewer). `recognize()` / `is_browser_chrome()` ([ADR-0011](../adr/0011-platform-recognition-layer.md)). |
| `classification.py` | Rule-based activity classification against the taxonomy; an unmatched activity falls back to a **semantic** label from the dominant recognised interaction category (`Form entry -- chrome.exe`) rather than `Unclassified -- app`. |
| `classification_overrides.py` | Applies the analyst's reclassification corrections (`annotations.json.classification_overrides`) during normalization — instance + rule scope, after taxonomy classification (design §6.1 / §7.2). |
| `step_suggest.py` | **The drafting rule** (contract C1, `auto_suggest_steps`): one step per screen visit, ending at its commit action; stamps `draft_key` / `name_source` / `end_reason`, the value-free `process_label`, and the `grain_keys` (`element`/`screen`/`app`, [ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md), narrowed); the step-name prefix and `draft_key`'s screen component are value-freed via `screen_label` (shared `screen-label-patterns.json`, §6a). Owns `_merge_steps()` (keeps `manually_authored`/`edited`/`confirmed`/`hidden`, replaces `auto_suggested`), `_inherit_step_identity()`, `restamp_preserved_case_ids` (C9), `draft_summary()` (the P1 probe numbers), and `load_remembered_names()` (reads the `--names` store, C4). |
| `app_vocab.py` | Loads and applies App Vocabularies to enrich interactions (unchanged matching engine). The bootstrap/discovery authoring functions it used to expose are gone with point-and-learn discovery ([ADR-0025](../adr/0025-in-app-vocabulary-discovery.md), superseded). |
| `app_names.py` | **New.** `build_app_names` derives a readable display name per executable in the recording (an app vocabulary's name, else a window-title word match, else the capitalized executable name (never a fabricated product name); `display_name` looks one up. Feeds stats.json `meta.app_names`, the findings claims, the findings fact strip, and the PDD (deliverable-audit gap 3). Pure stdlib. |
| `coalesce.py` | Folds a burst of per-keystroke `value_changed` events on one control into a single final-value event (`coalesce_typing_bursts`, v0.13 §1). Runs first so later stages never see partial typed values. |
| `stats_compute.py` | Builds `stats.json` (activity / case / **step** / variant / outlier / rework / meta); `step_stats` + `step_variants` group by `process_label` so they don't fragment per instance. |
| `case_quality.py`, `motifs.py`, `facts.py`, `findings.py` | The Tier-1 measured blocks in `analysis.json`: `case_quality` (the Tier-2 gatekeeper), `motifs`/`find_bounces` (repeated-sequence + app-bounce mining feeding `facts`), `facts` (direct measurements, no heuristics), `findings` (the detector library's templated claims + evidence, `app_names`-aware). All additive; kept in full. |
| `analysis*.py` | Analysis layer: `analysis.py` orchestrates `analysis_waste` / `_time_study` (`analysis_segments`, `analysis_time_study`) / `_automation` (`analysis_automation`, a flat `AUTOMATABLE_FRACTION = 0.7` now that the per-segment `roi_inputs` override is gone) / `_efficiency` (`analysis_efficiency`) over the `analysis_common` per-step segmentation. Time-study + automation group steps by `step_group_key` (`canonical_step_id → process_label → step_id`) so repeated work collapses to one row ([ADR-0008](../adr/0008-build-the-analysis-layer.md), [ADR-0013](../adr/0013-value-free-grouping-and-map-readability.md)); `score_automation` ranks candidates by priority. Writes `analysis.json`, including `stage_errors` (contract C12). No ROI stage: `analysis_roi.py` is deleted ([ADR-0029](../adr/0029-ba-helper-refocus.md) D3). |
| `xes_export.py` | Emits `events.xes` (IEEE 1849-2016), one trace per top-level case. Still produced; its eventual removal (activity-level mining cut) is a later, not-yet-landed phase. |
| `mining.py` | PM4Py wrappers — inductive / heuristics miners, DFG. |
| `bpmn_observed.py` | **Observed-flow** Step BPMN, mined from the analyst's annotations (one trace per case over step labels → PM4Py → BPMN with a pure-Python layout). Needs no Process Template ([ADR-0012](../adr/0012-active-case-stamping-and-map-matrix.md), narrowed). No phase-level counterpart anymore (phases are cut). |
| `pdd_export.py` | The PDD `.docx` export, tool-neutral wording. Built around the confirmed **pattern run** (contract C3, the detailed step-by-step section), the analyst's **document sections** (contract C6), one measured timings table, and the differences between runs, each aligned to the pattern run. Section 1 (findings) is rendered from `memo_export`'s model. Honesty rules kept: hidden steps never appear (RP-06), a failed analysis stage says so (C12), applications show readable names (`app_names`, DA gap 3). |
| `memo_export.py` | The findings-content **model**, not an export of its own anymore: `build_memo_model` / `write_memo_into_docx` compute the Tier-1 facts + findings + (gated) Tier-2 case-based numbers that `pdd_export` renders into the PDD's section 1, with the analyst's `memo_selection[]` picking which findings show. The standalone findings-memo `.docx` and its `--memo-out` flag are gone ([ADR-0029](../adr/0029-ba-helper-refocus.md)). |
| `transcript_import.py` | **New** (contract C8). Parses a Teams `.vtt` or `.docx` transcript into timestamped, speaker-tagged segments (stdlib only: `zipfile` + `xml.etree` for `.docx`), copies the source file into `transcript/`, and writes `transcript.json`. Its own CLI entry point (not a `normalize.py` flag); exit codes documented in [shared/SCHEMA.md](../../shared/SCHEMA.md). |
| `log_setup.py` | Configures the rolling `normalize.log`. |

Deleted with the features they served ([ADR-0029](../adr/0029-ba-helper-refocus.md)):
`marker_suggest.py` (suggested markers), `anchor_suggest.py` (anchor
candidates), `canonical_match.py` (canonical step matching), `phase_reconcile.py`
(phase membership + canonical-drift markers, since both phases and
canonical matching are gone), `discover_vocab.py` + `signature_pick.py` (point-and-learn
vocabulary discovery), `pii_masking.py` (structural PII masking),
`analysis_roi.py` (the EUR-ROI layer), `step_csv.py` (`--step-csv-out`), and
`bpmn_step.py` / `bpmn_phase.py` (template-derived BPMN, needed `--canonical`).

## App Vocabularies, light vocab, and light template

**App Vocabularies** (`normalization/app_vocabularies/*.yaml`) are unchanged:
per-application dictionaries mapping raw UIA fields to human-readable
`meaningful_name` / `screen_id` / default `vocab_flags`, loaded and matched
by `app_vocab.py`. Rationale: [ADR-0002](../adr/0002-app-vocabularies.md).
Authoring one by hand, or bootstrapping one from a session or a live window
snapshot, is a workbench flow the viewer no longer has
([ADR-0025](../adr/0025-in-app-vocabulary-discovery.md), superseded); the
shipped vocabularies (`normalization/app_vocabularies/`) still load and
match exactly as before.

**Canonical step sets** (`--canonical`, "the right process steps" matched
against a reference definition) are gone entirely: no CLI flag, no
`canonical_match.py`, no `normalization/canonical/` directory.

Two lighter mechanisms replace what canonical sets and vocabulary discovery
used to do, both viewer-side (contracts C4 / C5, [ADR-0029](../adr/0029-ba-helper-refocus.md)
AD-7 / AD-8): a **remembered-names store**, keyed by a drafted step's
`draft_key`, that `--names` feeds back into drafting (step 3 above); and a
**saved-process store** the viewer matches a session against by `draft_key`
overlap, with no pipeline involvement at all (`normalize.py` never reads
it). See [shared/SCHEMA.md](../../shared/SCHEMA.md) for both shapes.

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
`events.xes`, `events.csv`, `stats.json`, `analysis.json` (case-based blocks
always; the step-grained blocks once the session has steps),
`process_map.bpmn` + `dfg.json` + the observed-flow `process_map_step.bpmn`
(no phase-level counterpart) + per-case `process_maps/` (with `--mine`), the
PDD `.docx` (with `--pdd-out`), an updated `annotations.json`, and
`normalize.log`. `transcript_import.py` additionally writes `transcript.json`
and a copy of the source file, from its own CLI. Re-running is
non-destructive — `stats.json.meta.normalization_run_at` lets consumers detect
stale derivatives. Field-level detail is in
[`shared/SCHEMA.md`](../../shared/SCHEMA.md) → "Post-normalization artifacts".
