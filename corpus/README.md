# Test corpus (product era)

These are product-era test scenarios. No test, gate or CI job reads them.

They are three recordings made in 2026-05 by driving the real C# recorder
against installed desktop apps, to calibrate the product edition's step
segmenter (its `step_split_on_element` knob). Each folder holds the
recording (`events.jsonl`, `manifest.json`), an `expected.json` projection
of that segmenter's output under both knob settings, a `README.md` on the
problem it showed, and the `script.ps1` driver (with `uia-lib.ps1`).

| Scenario | App | What it showed |
|---|---|---|
| `narrow/over-segmentation-outlook-compose` | Outlook, a new email (field entry) | 9 steps with the knob on, 3 with it off; 3 runs |
| `bounded/over-segmentation-excel-dataprep` | Excel data preparation (cell rewrite) | 8 steps with the knob on, 3 with it off; 3 runs |
| `bounded/over-segmentation-word-ribbon` | Word, the Mailings ribbon | 8 steps with the knob on, 4 with it off; 2 runs. The mail merge menus and the document text are invisible to the recorder's default stream |

That segmenter is gone. One fixed rule now drafts the steps (contract C1,
`normalization/step_suggest.py`: one step per screen visit, ending at its
commit action). The pipeline reads `step_split_on_element` and ignores it,
so the `expected.json` files describe output the pipeline no longer
produces. The recordings are still usable as real recorder input. The
calibration evidence is on branch `product-edition`
([SEGMENTATION-CALIBRATION-FINDINGS.md](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/To-Do/SEGMENTATION-CALIBRATION-FINDINGS.md)),
and the method for driving the real recorder is in
[REAL-VALUE-TESTING.md](../docs/REAL-VALUE-TESTING.md).

## What gates the pipeline today

- **The session golden.** `normalization/golden_check.py` copies each
  committed demo session in `sessions/example-aggregate/` to a temp folder,
  analyzes it there (`normalize.py --mine`) and compares a projection with
  `normalization/golden/`: stable `stats.json` meta counts, the step count,
  the distinct `process_label` set, and the step map's task names with its
  start and end events. pytest runs it as `test_golden_projection.py`. See
  [normalization/golden/README.md](../normalization/golden/README.md).
- **The e2e smokes** in `e2e/`, which drive the real viewer.

Recordings from company machines never land in the repo.
