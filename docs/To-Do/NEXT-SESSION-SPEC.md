# Next-Session Spec — Recognition, Segmentation & Alignment

**Written:** 2026-05-22 · **Branch:** `viewer-refactor` (many commits ahead of
`master`, **unpushed**) · **Status of this doc:** plan of record for the next
working session.

This is a self-contained hand-off. Read it top to bottom; it assumes no memory
of the prior session.

---

## 1. Where we are

Three layers of work landed this cycle. Read these first for context:

- **[VALUE-CHAIN-REVIEW.md](../architecture/VALUE-CHAIN-REVIEW.md)** — the
  strategic frame: the app loses meaning at five seams; the fix reduces to
  three decisions. *Read this first.*
- **[ADR-0010](../adr/0010-ux-overhaul-viewer-recorder.md)** — 12 viewer/recorder
  UX fixes. **All implemented** (commits `d9fbc13`, `ff9922d`, `89417b5`,
  `b1464d8`, `98e5a2b`, `8e0c168`, `8d667cf`).
- **[ADR-0009](../adr/0009-normalization-redesign-v013.md)** — redirected:
  cross-session canonical templates are mis-targeted for one-off processes;
  the segmentation fix is **intra-session repetition alignment**. Anchor-based
  case detection (`case_assignment.py`) was already built + wired.
- **[ADR-0011](../adr/0011-platform-recognition-layer.md)** — the **recognition
  layer**: classify interactions by documented platform/framework signatures
  (UIA ControlTypes + Chromium/Bootstrap/AG-Grid/SharePoint/O365/Win32), not
  per-session opaque selectors. Implemented viewer-side (`viewer/recognition.js`).

Built + unit-tested this cycle (capture 65, viewer 164, normalization 35 in
step_suggest; all green):

- Browser-chrome noise filter in `step_suggest.py` (`175bec7`).
- ATM template validated against the real capture (`9b2c401`).
- **Intra-session alignment**: engine `viewer/step-alignment.js` (`5eb7a60`) +
  Steps-view wiring — repeat badges, "Apply to N repeats" (`43f6002`).
- **Recognition layer** `viewer/recognition.js` (`0577c46`), wired into the
  alignment signature + `describeInteraction`.
- Diagnostic tools `scripts/inspect-events.js`, `scripts/count-cases.js` (`ef7e64a`).

**The AG-Grid fact-find is resolved** (against the real ATM capture,
`C:\Users\rasha\Downloads\Event Analysis.jsonl`, 2037 events):
`class_name` carries CSS classes (`ag-cell-edit-input` confirmed); per-cell
identity is **not** recoverable (grid = one coarse step); two browsers
(`chrome.exe` = TAMBA, `msedge.exe` = call-mgmt); `txtsr` is the serial-search
field; the omnibox/tabs are browser-chrome noise. **Per-cell granularity is a
permanent capture limitation** — design around coarse grid steps.

---

## 2. Open decision — resolve FIRST (gates alignment value)

**Case segmentation over-segments.** On the full capture, the `txtsr` anchor →
**16 hits, 13 cases, but only 2 distinct serials.** The worker re-searches the
same serial repeatedly; current `detect_cases_from_anchors` opens a new case on
same-label-after-gap, inflating 2 tickets into 13.

Pick the model (then implement in `normalization/case_assignment.py`):

| Option | Result | Cost |
|---|---|---|
| **A. Merge same-label cases** | ~2 clean tickets | Overlapping time-ranges break `stamp_anchor_cases`' time-containment when tickets interleave |
| **B. Keep occurrences** | 13 traces / 2 variants | Inflated ticket count, but lots of repetition for alignment |
| **C. Active-case stamping** *(recommended)* | correct for interleaving | Bigger change: case_id stable per label; stamp each event to the *most-recent preceding anchor's* case, not by time-range containment |

**Recommendation: C.** It is the only model correct for interleaved multi-app
work (search A → work → search B → back to A). Also add a **degenerate-case
guard** (drop cases below ~2 interactions / ~1s — the 0.6s sliver seen in the
partial). Both go in `case_assignment.py`; extend `test_anchor_cases.py`.

Confirm the model with the owner before building — it is a process-modeling
choice, not just code.

---

## 3. Prioritized work

### P1 — Recognition: cross-language + drive the pipeline (ADR-0011 follow-ups 1-2)
Right now `recognition.js` is viewer-only; the Python pipeline still uses a
hardcoded browser-chrome list. Unify them:
1. Lift the signature table to a shared data file (e.g.
   `shared/recognition-patterns.json`) consumed by **both** `viewer/recognition.js`
   and a new `normalization/recognition.py`. (Viewer loads JSON natively;
   Python `json.load`. Avoid YAML to keep the viewer dependency-free.)
2. Replace `step_suggest._is_browser_chrome` (and its `_BROWSER_CHROME_CLASSES`)
   with the shared recognition. Keep the `filter_browser_chrome` flag + tests.
3. Re-run `normalization/test/test_step_suggest.py` (35) + viewer suite (164).

### P2 — Reframe classification on recognition (ADR-0011 follow-up 3)
Activity/step classification (Seam 2) should **lead with framework recognition**
(semantic type — "form field", "grid cell", "rich-text", "primary action") and
use the window-title `taxonomy.yaml` only for *business* labels. This shrinks
the empty-map problem: even with zero taxonomy, the map/lane show real
semantic activity instead of "Unclassified". Touches
`normalization/classification.py` + the Flow activity lane / DFG.

### P3 — Validate alignment on real data, then refine
1. Install analytics deps on the dev box: `pip install pandas pm4py` (the
   lightweight scripts dodged this; the full `normalize.py` needs them).
2. Normalize the real session with the ATM template (Match Process Template →
   `normalization/canonical/atm-ticket-handling.yaml`), open in the viewer
   Steps view.
3. Eyeball: repeat badges (`↻N`), "Apply to N repeats", and whether the
   value-agnostic signature in `step-alignment.js` groups the *right* steps.
4. If it over/under-groups, tune `stepSignature` toward fuzzy/variant-aware
   matching (sequence alignment), not exact category-set match. Calibrate
   against this real session.

### P4 — Value-chain "what else" (review §"what else needs changing")
- Team-wide **taxonomy editor** (the in-app classification manager `a3a179f`
  only writes per-session overrides).
- **PDD/report as a living projection** of the annotated model, not a one-time
  snapshot.
- Resolve the **activity-level vs step-level stats split-brain** (`stats.json`).
- Guarantee **re-normalization preserves curated relationships** (step→phase,
  step→template), not just step rows.
- Explicit **two-map IA** (phase default → step → activity drill-down).

### P5 — ADR-0010 deferred sub-parts
- D3 **single-monitor screenshot occlusion** — the pre-capture mechanism (the
  multi-monitor case is handled).
- D1 **mini-mode recorder toolbar** (the screen-saver level + tray-click cover
  the stated pain).

---

## 4. Verification debt (the standing job)

Everything above is unit/syntax-tested only — **none of the UI is verified in a
running Electron build.** Next session (or the owner) should launch and eyeball:
- **Recorder:** stays on top, tray left-click brings it forward mid-session,
  marker screenshot targets the work monitor (D1/D3); hotkey config records
  (D2); session name shows in recents + viewer (D4).
- **Viewer Steps:** interaction colour-coding (A1), click-to-split scissors (A2),
  step context menu (A5), panel layout no longer shoves the list off-screen
  (B1), flag badges + summary (A3), repeat badges + "Apply to N repeats".
- **Viewer maps:** Step/Phase depth selector + empty-activity auto-fallback
  (C1b); unclassified banner + "Classify activities…" manager (C1a + `a3a179f`).
- **Recognition:** unnamed interactions read as their type ("a data-grid cell").

---

## 5. Environment & governance notes

- **Two machines:** the dev box (this one — node/python/git/pip OK) vs. the
  locked-down work laptop (released `.exe` only — never suggest installs there).
- **Company data stays local.** The real capture is company data on a personal
  account. Use the **structure-only** scripts (`inspect-events.js`,
  `count-cases.js`) which print counts/timestamps, never values or titles. Do
  not read the raw `events.jsonl` into the assistant context. Partial + full
  copies are at `D:\atm-test\events.jsonl` and `C:\Users\rasha\Downloads\Event
  Analysis.jsonl` — the owner may clear these.
- **Commit style:** imperative subject; no Co-Authored-By trailer; avoid quote
  characters in the body (PowerShell here-string safety). Branch `viewer-refactor`.
- **Nothing is pushed.** Pushing / cutting a release is an owner decision; the
  release flow is in `reference_release_workflow` (build → verify Shell extract
  → push → publish-release.ps1).

---

## 6. Suggested order for next session

1. Confirm the **case-segmentation model** (§2) with the owner; implement C +
   degenerate guard in `case_assignment.py` (+ tests).
2. **P1** recognition cross-language lift (shared table → Python).
3. **P3** install deps, normalize the real session, eyeball alignment, calibrate.
4. Then P2 / P4 / P5 as priorities allow.
