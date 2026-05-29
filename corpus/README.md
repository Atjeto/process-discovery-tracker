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

## Next steps

- Promote the existing demo set into an explicit `corpus/narrow/` layout with a
  per-scenario `expected.json` + bug-class `README.md` (the projection format is
  already settled — see golden_check's `build_projection`).
- Add `corpus/bounded/` parameterized scripts once §11b calibration begins.
- Keep `corpus/wide/` **out-of-repo**; it feeds new narrow cases but never lands
  in git.

**Driving the real C# recorder in CI is explicitly out of scope** for this gate
(live UIA capture needs a self-hosted runner with a desktop session — Fit
Analysis §11 "CI-driving caveat"). The narrow golden on pre-recorded data is
what gates merges; live-recorder CI stays a documented manual pre-release check.
