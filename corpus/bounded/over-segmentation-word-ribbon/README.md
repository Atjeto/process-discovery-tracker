# bounded / over-segmentation — Word Mailings ribbon (coverage edge)

**Bug class:** over-segmentation (roadmap §11b). **Tier:** bounded. **Knob:**
`step_split_on_element`. **Also a §11e recorder-coverage finding — read the
caveat.**

## What it is

A real C# recorder capture (non-verbose / production stream) of a Word
mail-merge attempt — two cases (real markers): Mailings tab → open the
Start-Mail-Merge / Select-Recipients menus → type a letter line → Save.

## The coverage finding (why this scenario is an edge, not a clean pin)

The **business** mail-merge steps do **not** reach the production recorder
stream:

- **Mail-merge ribbon items reject `InvokePattern`** — `MailMergeStartMailMergeMenu`
  and `MailMergeSelectRecipients` throw "Unsupported Pattern" on Invoke (they are
  dropdown MenuItems whose ExpandCollapse state is **not** a subscribed recorder
  event). So opening them produces no captured event.
- **Document text is `text_changed`**, which is verbose-gated
  (`UiaSubscriber.cs:147`) → the typed letter body is absent from the production
  stream.

What *is* captured per case: the Mailings/Home `selection_changed` tab switches,
`FileSave` (Invoke, the only vocab match), and **incidental `value_changed` on
the `Row up` / `Row Down` position-indicator buttons** (value `"Row 1 of 1"`),
which fire as the document selection moves.

## Ground truth (measured both ways)

| calibration | `step_split_on_element` | step_count | grain |
|-------------|:----:|:----:|-------|
| **default** (shipped) | `true`  | **8** | `Enter Row 1 of 1` / `Fill Row up` / `Fill Row Down` / `Save` |
| **candidate** (§11b)  | `false` | **4** | `Fill Row up, Row Down` / `Save` per case |

2 cases; 2 App-Vocabulary matches (`FileSave`). The 8→4 over-segmentation here is
driven by the **incidental** `Row up/Down` value_changed, not by business
actions — so treat this scenario as evidence that (a) the element-split fires on
*any* consecutive distinct-element value_changed, including UI-chrome noise, and
(b) Word's real automation surface (mail-merge menus, document text) is a
**recorder coverage gap** worth closing for §11e (it argues for either capturing
ExpandCollapse or surfacing the menu leaf Invokes). It is the weakest of the
three real scenarios precisely because the recorder cannot see the business work.

## Reproduce

`script.ps1` (+ `uia-lib.ps1`) is the driver; method in
[docs/REAL-VALUE-TESTING.md](../../../docs/REAL-VALUE-TESTING.md). Re-normalize
under both calibrations for the 8→4. Do **not** flip the default — owner-gated
([docs/To-Do/SEGMENTATION-CALIBRATION-FINDINGS.md](../../../docs/To-Do/SEGMENTATION-CALIBRATION-FINDINGS.md)).
