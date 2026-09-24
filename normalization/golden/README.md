# Session golden

These `*.projection.json` files are the regression baseline for the whole
pipeline. The gate, `normalization/golden_check.py`, copies each committed
demo session in `sessions/example-aggregate/` to a temp folder, analyzes it
there (`normalize.py --mine`) and compares a projection of the output with
the golden here.

## What is pinned

A projection, not the full outputs: the full files change on every run
(timestamps), and pixel diffs break with the theme. Per session:

- the stable `stats.json` meta counts (raw events, dropped lines, activities
  after the collapse, interactions, runs, marker edits applied, vocabulary
  matches, steps and the steps per state);
- the step count and the distinct `process_label` set;
- the step map (`process_map_step.bpmn`): its task names, its tasks counted
  by kind (contract C18: a recorded step is a user task, a step added by hand
  a manual task; none is left a plain task), and its one start and one end
  event, with the end's name (the Result's first line, else "End").

Gateway and flow counts are left out on purpose. They come from pm4py's
inductive miner, which CI installs unpinned while the app bundles its own
copy, so they can move with the miner version. The e2e connectivity check in
`e2e/session-smoke.js` pins the map's shape instead (one connected graph,
one entry step, one final step).

## Semantics

- The golden pins what the current pipeline produces from the committed
  `events.jsonl`. It detects change; it does not judge correctness. After a
  pipeline change that alters the output on purpose, regenerate with a
  Python that has the pipeline dependencies (the bundled
  `viewer/python/python.exe`, or a CI environment with `requirements.txt`):
  `python golden_check.py --update`. Say so in the commit.
- The analysis runs in a temp copy, so the committed demo sessions are never
  regenerated in place.

## History

Before [ADR-0029](../../docs/adr/0029-ba-helper-refocus.md) this golden also
pinned the activity-level map's shape (`dfg.json`), and an early version of
this file recorded the old step suggester's over-segmentation (the
"308-step" class). Both are gone. Steps are drafted by one fixed rule now
(contract C1, `step_suggest.auto_suggest_steps`: one step per screen visit,
ending at its commit action), with no calibration knob to re-baseline
against.

## CI

`normalization/test/test_golden_projection.py` runs this gate under pytest.
It skips where the pipeline dependencies (pandas, pm4py) are missing, as on a
bare dev Python, and gates where they are present (the `pytest.yml` CI job
installs `requirements.txt`, and the full-deps recipe in
[CONTRIBUTING.md](../../CONTRIBUTING.md) runs it locally).
