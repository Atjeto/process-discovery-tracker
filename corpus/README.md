# Test corpus — roadmap (§11a)

This file sketches the three-tier ground-truth corpus from
[PDT-ROADMAP-CODEBASE-FIT.md §11](../docs/To-Do/PDT-ROADMAP-CODEBASE-FIT.md) and
[PDT-MASTER-ASSESSMENT.md §11a](../docs/To-Do/PDT-MASTER-ASSESSMENT.md). The
tiers exist to calibrate and regression-test the pipeline against *known* output
without needing a live recorder in CI.

## The three tiers

| Tier | Source | Committed? | Gates CI? | Purpose |
|------|--------|-----------|-----------|---------|
| **narrow** | one scripted workflow, exact ground truth | ✅ yes | ✅ yes | pin the load-bearing invariants (the 308-step explosion is the first bug class to pin) |
| **bounded** | parameterized scripts injecting *known* variations | ✅ yes | ✅ yes | exercise the segmentation/alignment knobs across controlled variety |
| **wide** | real human captures | ❌ **out-of-repo** (CLAUDE.md: "company captures stay local") | ❌ no | exploratory; the source of new narrow cases |

Each future scenario carries a `script.{ps1,playwright.ts}` (the driver),
`expected.json` (the diff target — a lightweight **projection**, not full
artifacts or pixels), and a `README.md` naming the bug class it pins.

## What exists today (the de-facto narrow tier)

The **narrow tier is already operating** as the session-level golden gate:

- `normalization/golden_check.py` re-normalizes the committed
  `sessions/example-aggregate/` demo corpus (**10 sessions** of the order-to-cash
  process at varying case volumes) and diffs a lightweight projection
  (`stats.json.meta` scalars + per-case step `process_label` set + DFG shape)
  against committed goldens in `normalization/golden/`.
- It runs on **pre-recorded `events.jsonl`** — re-normalize → diff — so it needs
  **no recorder and no Electron in CI** and gates on `windows-latest` today.
- The in-repo `e2e/session-smoke.js` is the complementary UI gate (the real
  viewer is driven headless and asserts behaviour, not pixels).

Regenerate the goldens after an *intentional* pipeline-output change:

```
viewer/python/python.exe normalization/golden_check.py --update
```

and say so in the commit; an *unintentional* drift is a bug to fix, not to mask.

## Real-recorder scenarios (§11b, 2026-05-30)

The first **real-recorder ground-truth** scenarios now sit alongside the demo
golden — captured by driving the real C# recorder against installed desktop apps
(the §11b real-data step, method in
[../docs/REAL-VALUE-TESTING.md](../docs/REAL-VALUE-TESTING.md)), so the
over-segmentation grain is calibrated against real captures, not only the
synthetic demo. Each carries `events.jsonl` + `manifest.json` (the capture),
`expected.json` (a **calibration-aware** projection — the golden-style projection
under both `step_split_on_element` settings, default sub-projection is the diff
target), a bug-class `README.md`, and the `script.ps1` (+ `uia-lib.ps1`) driver.

| scenario | tier | app | step_count default → candidate | cases |
|----------|------|-----|:---:|:---:|
| `narrow/over-segmentation-outlook-compose` | narrow | Outlook compose (field entry) | **9 → 3** | 3 |
| `bounded/over-segmentation-excel-dataprep` | bounded | Excel data-prep (cell rewrite) | **8 → 3** | 3 |
| `bounded/over-segmentation-word-ribbon` | bounded | Word Mailings ribbon (coverage edge) | **8 → 4** | 2 |

All three reproduce the over-segmentation on real captures: the shipped default
(`step_split_on_element=true`) splits one logical step per field/cell-value;
the candidate (`false`) lands the sensible ~1-step-per-case grain — corroborating
the synthetic demo's 64 → 15 (`sess-2026-0514-0900`). Full evidence + the
mechanism: [../docs/To-Do/SEGMENTATION-CALIBRATION-FINDINGS.md](../docs/To-Do/SEGMENTATION-CALIBRATION-FINDINGS.md).
The Word scenario doubles as a §11e recorder-coverage finding (mail-merge menus
+ document text are invisible to the non-verbose stream). The capture/measure
orchestrator (`build-corpus.js` / `measure.js`) lives in the out-of-repo
`_pdt_verify/real-corpus/` harness; the per-scenario `script.ps1` is committed
for reference. These are **not yet wired into a CI gate** (see below).

## Next steps

- Promote the existing demo set into an explicit `corpus/narrow/` layout with a
  per-scenario `expected.json` + bug-class `README.md` (the projection format is
  already settled — see golden_check's `build_projection`).
- ~~Add `corpus/bounded/` parameterized scripts once §11b calibration begins.~~
  **Started (2026-05-30)** — the real-recorder scenarios above. A future gate can
  diff each `expected.json` `default_calibration.projection` like golden_check.
- Keep `corpus/wide/` **out-of-repo**; it feeds new narrow cases but never lands
  in git.

**Driving the real C# recorder in CI is explicitly out of scope** for this gate
(live UIA capture needs a self-hosted runner with a desktop session — Fit
Analysis §11 "CI-driving caveat"). The narrow golden on pre-recorded data is
what gates merges; live-recorder CI stays a documented manual pre-release check.
