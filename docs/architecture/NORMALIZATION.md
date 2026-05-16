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
   count dropped/malformed lines.
2. **Apply marker edits** — replay `annotations.json.marker_edits`
   (rename / re-time / delete / insert) onto the marker stream.
3. **Case assignment** — walk the marker stream, build the case tree, stamp every
   activity/interaction with its `case_ids` stack.
4. **Collapse** — merge adjacent identical activity events (same app/title/label/case).
5. **Interaction enrichment** — apply App Vocabularies to add `meaningful_name`,
   `screen_id`, and `vocab_flags`.
6. **Step suggestion** — group consecutive interactions into `auto_suggested` steps
   (the step-noise denylist in `step_filters.ignored_processes` is applied first).
7. **Canonical matching** — with `--canonical`, match interactions against a
   canonical step set, producing `auto_matched` steps.
8. **Step merge** — `_merge_steps()` keeps `manually_authored + edited` steps and
   replaces only the `auto_*` set (see [DATA-MODEL.md](./DATA-MODEL.md)).
9. **Drift detection** — flag steps whose canonical assignment would now resolve
   differently; record `drift_markers`.
10. **Statistics** — compute activity, case, variant, outlier, and rework stats.
11. **Export** — write `events.xes`, `events.csv`, `stats.json`, and the updated
    `annotations.json`.
12. **Mining** — with `--mine`, run PM4Py to produce `process_map.bpmn` and `dfg.json`.

## Module map (`normalization/`)

| File | Role |
|---|---|
| `normalize.py` | CLI entry point; orchestrates the pipeline; owns `_merge_steps()`. |
| `case_assignment.py` | Walks markers, builds the case tree, stamps `case_ids`. |
| `classification.py` | Rule-based activity classification against the taxonomy. |
| `step_suggest.py` | Heuristic `auto_suggested` step grouping from interactions. |
| `canonical_match.py` | Matches interactions to a canonical step set (`auto_matched`). |
| `app_vocab.py` | Loads and applies App Vocabularies to enrich interactions. |
| `stats_compute.py` | Builds `stats.json` (activity / case / variant / outlier / rework / meta). |
| `xes_export.py` | Emits `events.xes` (IEEE 1849-2016), one trace per top-level case. |
| `step_csv.py` | Flat CSV of step entities for pivot analysis. |
| `mining.py` | PM4Py wrappers — inductive / heuristics miners, DFG. |
| `bpmn_step.py` / `bpmn_phase.py` | Generate `process_map.bpmn` from steps / from phases. |
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

## Outputs

All written back into the same session folder:
`events.xes`, `events.csv`, `stats.json`, `process_map.bpmn` + `dfg.json` (with
`--mine`), an updated `annotations.json`, and `normalize.log`. Re-running is
non-destructive — `stats.json.meta.normalization_run_at` lets consumers detect
stale derivatives. Field-level detail is in
[`shared/SCHEMA.md`](../../shared/SCHEMA.md) → "Post-normalization artifacts".
