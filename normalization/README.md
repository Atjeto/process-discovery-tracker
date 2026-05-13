# Normalization

Python pipeline that turns a captured session into XES + CSV + statistics + (optional) mined BPMN.

Runs on the analyst's machine. Re-runnable against an updated taxonomy without recapture (§6.3).

## Install

Python 3.10+. From this folder:

```
pip install -r requirements.txt
```

Per §11.5 the production install will be a python-embeddable folder shipped alongside the viewer (no admin install required); for development plain `pip` is fine.

## Usage

```
python normalize.py path/to/session/folder \
    --taxonomy sample-taxonomy.yaml \
    --mine
```

Outputs land alongside the input:

| File | Contents |
|---|---|
| `events.xes` | IEEE 1849-2016 event log, one trace per top-level case |
| `events.csv` | Flat CSV of activity events for Excel / non-XES tooling |
| `stats.json` | Per-activity + per-case + variants + outliers + rework |
| `process_map.bpmn` | (--mine only) PM4Py inductive miner output, BPMN 2.0 XML |
| `dfg.json` | (--mine only) Directly-Follows Graph for the viewer's first-pass map |

`events.jsonl` is never modified. Re-run with a different taxonomy whenever the classification rules improve.

## Pipeline

1. Load `events.jsonl`, sort by timestamp (defensive).
2. Walk the marker stream, build the case tree, stamp every activity event with `case_ids` (innermost first).
3. Apply taxonomy classification -- first match wins; unmatched events get `Unclassified -- <app>`.
4. Extract `transaction_id` from window titles where the rule defines one.
5. Collapse adjacent identical activity events (same app, title, label, case_ids) with summed duration.
6. Emit XES (PM4Py exporter) + CSV (pandas).
7. Compute statistics.
8. (Optional) Run PM4Py inductive miner, emit BPMN + DFG.

## Code map

| File | Role |
|---|---|
| `normalize.py` | CLI entry; orchestrates the pipeline |
| `case_assignment.py` | Marker stream walk + case_id stamping (§5.2) |
| `classification.py` | Taxonomy rules + collapse |
| `xes_export.py` | XES + CSV emission |
| `mining.py` | PM4Py wrappers (inductive, heuristics, DFG, BPMN) |
| `statistics.py` | Per-activity, per-case, variants, outliers, rework |
| `sample-taxonomy.yaml` | Example classification rules |
