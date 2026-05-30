# bounded / over-segmentation — Excel data-prep (cell-value flow)

**Bug class:** over-segmentation (roadmap §11b; the element-split / "308-step"
class). **Tier:** bounded (controlled variety across the knob — a different app
and a different *source* of consecutive value_changed than the Outlook narrow
pin). **Knob:** `step_split_on_element`.

## What it is

A real C# recorder capture (non-verbose / production stream) of three Excel
data-prep passes (= three cases, real start/end markers). Per case the driver
runs the repetitive data-prep core the `excel.yaml` vocab targets — Filter
(Toggle), Sort A→Z (Invoke), the PivotTable dropdown (ExpandCollapse), Copy,
Save — over a small synthetic Name column (`Alice/Bob/Charlie/Dora/Evan`).

The **Sort A→Z** is what drives the segmentation here: re-sorting the column
rewrites the cells, so the recorder emits `value_changed` on cells `A1…A6`
(`XLSpreadsheetCell`, distinct elements) with no `focus_changed` between them
(verbose-gated). That is the same consecutive-distinct-element value pattern as
Outlook, from a different cause (app-driven cell rewrite vs. human field entry).

## Ground truth (measured both ways)

| calibration | `step_split_on_element` | step_count | grain |
|-------------|:----:|:----:|-------|
| **default** (shipped) | `true`  | **8** | one step per rewritten cell (`Enter A2…A5`, `Enter Alice`) + `Save` + `Select Data, Insert` |
| **candidate** (§11b)  | `false` | **3** | one step per case — `Select Data, Insert` + `Save` |

3 cases either way; 2 App-Vocabulary matches (`FileSave`). `expected.json` carries
both projections; the **default** sub-projection is the regression diff-target.

## Capture caveat (real, worth knowing)

Programmatic ribbon **Invoke** is captured inconsistently: the managed UIA
`Invoked` event source can go stale before the recorder queries it, so several
invokes resolved to an empty element (the aids `Filter`/`SortAscendingExcel`/
`Copy` did not all land as identified events; `FileSave` did). A real human's
mouse click raises a cleaner `Invoked`. The over-segmentation signal here does
**not** depend on the ribbon invokes — it comes from the genuine cell
`value_changed` rewrites, which are captured reliably. See the parallel finding
about `InsertPivotTableDropdown.Invoke()` blocking until COM timeout (handled
with ExpandCollapse) in `script.ps1`.

## Reproduce

See the Outlook narrow scenario's README and
[docs/REAL-VALUE-TESTING.md](../../../docs/REAL-VALUE-TESTING.md). `script.ps1`
(+ `uia-lib.ps1`) is the driver; re-normalize this folder under both calibrations
to reproduce the 8→3. Do **not** flip the default — owner-gated
([docs/To-Do/SEGMENTATION-CALIBRATION-FINDINGS.md](../../../docs/To-Do/SEGMENTATION-CALIBRATION-FINDINGS.md)).
