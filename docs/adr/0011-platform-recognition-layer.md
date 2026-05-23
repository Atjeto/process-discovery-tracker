# ADR-0011: Platform/Framework Recognition Layer

**Status:** Accepted — initial implementation 2026-05-22 (`viewer/recognition.js`)
**Date:** 2026-05-22
**Deciders:** Rasha (analyst/owner)
**Related:** [VALUE-CHAIN-REVIEW.md](../architecture/VALUE-CHAIN-REVIEW.md),
[ADR-0009](./0009-normalization-redesign-v013.md) (anchor detection)

## Context

Recognition of *what an interaction is* had been built on a single
engagement's **opaque, app-specific selectors** — `automation_id == "txtsr"`
as the case anchor, a hardcoded list of a few Chromium class names for the
noise filter, the alignment signature keyed on `automation_id`. Three problems:

1. **Opaque to the user.** `txtsr` / `view_1012` are developer-assigned IDs.
   A business user (or an analyst handed a capture they didn't record) cannot
   say what they mean — so "confirm the anchor" is not a real answer; it just
   relocates the impossible task.
2. **Per-session, non-general.** Every new engagement would need its selectors
   reverse-engineered. Recognition built this way doesn't transfer.
3. **It was guessing.** "`txtsr` = the serial search that starts a ticket" was
   inferred from the name + a prior spec, not from anything observable.

Meanwhile the capture is already full of **documented, stable, cross-app
platform/framework signatures** that recur across thousands of applications.

## Decision

Build recognition on **documented platform/framework invariants**, not
per-session selectors. `viewer/recognition.js` classifies an interaction into
a semantic *type* via two layers, most-specific first:

1. **Framework `class_name` signatures.** Chromium/Edge browser chrome
   (`OmniboxViewViews`, tab strip, toolbar buttons), Bootstrap
   (`form-control`, `btn-primary`), AG-Grid (`ag-` namespace), SharePoint SPFx
   (`ReactFieldEditor`, RichText variant), Office 365 / OneDrive (`o365sx-`,
   `od-…mentionableTextBox`), Win32/Office (`RichEdit20WPT`, `NetUIHWND`).
2. **The UIA ControlType base layer.** Microsoft's documented control taxonomy
   (Edit, Button, ComboBox, TabItem, TreeItem, …), always present — so an
   unknown app still degrades to a meaningful type rather than "a control".

Output: `{ category, framework, isChrome, typeLabel }`. `category` is a
semantic class (`form_field`, `grid_cell`, `rich_text`, `primary_action`,
`selection`, `toggle`, `browser_chrome`, `tab_nav`, `tree_nav`, `text_entry`,
`action`, `comment`, `search`, `unknown`); `isChrome` flags the browser frame
(navigation, not a process step).

### Grounding (researched, not assumed)

- **UIA ControlType identifiers** — a documented, stable enumeration
  (learn.microsoft.com, `uiauto-controltype-ids`).
- **Chromium Views accessibility** — `OmniboxViewViews` is exposed via UIA as
  `automationID view_1012 / className OmniboxViewViews / frameworkID Chrome`
  (chromium.org views-accessibility) — which **matches the real ATM capture
  exactly**, confirming the approach against live data.
- Bootstrap, AG-Grid, SharePoint SPFx, Office 365/OneDrive, Win32/Office are
  widely-used framework conventions with stable class signatures.

### What it does and does not give

- **Gives, generically and config-free:** semantic *type* — "typed in a form
  field", "edited a data-grid cell", "clicked a primary button", "wrote rich
  text", "browser navigation". Knowable from the platform alone.
- **Does not give:** business *meaning* — "serial number", "Banking". That
  needs a human, but it is a thin label on top; segmentation, noise-filtering,
  alignment and phrasing all run on the platform layer underneath.

## Consequences

### Easier
- Recognition transfers across apps/engagements with zero per-session selector
  reverse-engineering. A new deployment works out of the box for the common
  frameworks.
- The alignment signature ([step-alignment.js](../../viewer/step-alignment.js))
  now keys on the semantic `category`, not `automation_id` — the same step
  aligns across tickets despite differing ids/values.
- Interaction phrasing ([step-editor.js](../../viewer/step-editor.js)
  `describeInteraction`) falls back to the recognised type ("a data-grid
  cell") instead of "a control" when an element has no visible name.
- The per-session `txtsr` anchor and the `taxonomy.yaml` of window titles drop
  to **examples**, not the foundation.

### Harder / to revisit
- The framework signature table needs maintenance as frameworks evolve (new
  Chromium class names, framework versions). It is data, kept in one place.
- Recognition gives type, not the case *boundary*. "A search happened"
  (form field → primary action → record loads) is a recognisable *pattern*,
  but "each search = a new ticket" still needs analyst/SME confirmation or the
  video — recognition narrows that judgement, it does not remove it.

### Follow-ups
1. **Cross-language sharing.** The Python capture/normalization pipeline
   (`step_suggest.py` browser-chrome filter, step naming, classification)
   should consume the *same* signature table. Lift it to a shared data file
   both the viewer (JS) and normalization (Python) load, to avoid drift.
2. **Migrate the noise filter.** `step_suggest._is_browser_chrome` (a hardcoded
   class list) should be replaced by `recognize().isChrome`.
3. **Reframe classification (Seam 2).** Activity/step classification can lead
   with framework recognition (semantic type) and use window-title taxonomy
   only for business labelling — reducing the empty-map problem.
4. **Calibrate** the framework table and the alignment categories against more
   — and more representative — real captures.

## Action Items
1. [x] `viewer/recognition.js` + tests, grounded in documented invariants, verified against the real capture signatures.
2. [x] Rewire the alignment signature and `describeInteraction` onto `recognize()`.
3. [x] Lift the signature table to a shared file consumed by Python normalization. *(2026-05-23 — `shared/recognition-patterns.json`, loaded by `viewer/recognition.js` and the new `normalization/recognition.py`.)*
4. [x] Replace `step_suggest._is_browser_chrome` with the shared recognition. *(2026-05-23 — `step_suggest` now calls `recognition.is_browser_chrome`; the hardcoded class list is gone. `filter_browser_chrome` flag + tests retained.)*
5. [ ] Reframe activity/step classification to lead with framework recognition. *(Open — NEXT-SESSION P2.)*
