# Next-Session Spec — plan of record

**Updated:** 2026-05-28 · **Branch:** `viewer-refactor` · **Status:** plan of record.

Self-contained hand-off — read top to bottom; assumes no memory of the prior
session. Earlier specs live in git history and [Archive/](Archive/).

---

## 0. Verify UI changes in the harness — proactively, not as an offer

This project's recurring failure is shipping UI that was never eyeballed. A
Playwright harness drives the **real** viewer and screenshots it, so a headless
agent CAN see the UI. Use it to confirm every UI change before claiming it done.

- **Where:** `_pdt_verify/` (a dir *outside* the repo; `playwright-core` installed
  there, not a repo dependency) — `driver.js` plus per-task scratch drivers.
- **How:** `_electron.launch` runs the viewer's own Electron with
  `--session=<analyzed folder>` (see `main.js parseInitialSessionArg`), drives the
  page, writes `*.png` to read back. It logs `PAGE ERROR:` on any console error.
- **A loadable session:** re-analyze a bundled example —
  `viewer/python/python.exe normalization/normalize.py sessions/example-aggregate/sess-2026-0514-0900 --mine`.
  **`example-aggregate` is committed demo data — do NOT commit the regenerated files**
  (`git checkout -- ...` + `git clean -f ...` that folder when done).
- **Tests:** system Python with pytest (`python -m pytest normalization/test/`);
  the bundled `viewer/python` has the runtime deps (pm4py, python-docx) but no
  pytest, so use it for direct/`--mine` runs. Viewer: `npm test` in `viewer/`.

---

## 1. Where we are

Last release **v0.16.3**. A large **polishing cycle is committed but unreleased on
`viewer-refactor`** (clean tree) — full list in CHANGELOG `[Unreleased]`.
Direction: **productization toward a small internal rollout, analyst-deliverable
first**; bar = "as polished as it can be." Landed this cycle:

- **PDD = a real Process Definition Document.** `normalization/pdd_export.py` now
  mirrors a standard RPA PDD (document control · introduction · As-Is process
  [overview, applications, **embedded process-map image**, statistics, detailed
  steps, input data] · automation assessment · exceptions), auto-filling what the
  pipeline has and marking analyst-judgement gaps with `[To be completed]`.
- **One-click "View map"** from a single session (Session view's process-map bar →
  loads it into the Compare/map view) — also the route that supplies the PDD's map.
- **Decluttered Analysis** — the Compare-Sessions Analysis panel (adaptive columns,
  signal-only rows, the all-`—` automation table → a note) and the single-session
  "Waste by step" (sorted by waste, instant steps behind an expander, rows still editable).
- **Pipeline hardened** — committed seeded fuzzers for `case_assignment`,
  `stats_compute`, the analysis layer, and `step_suggest` (each pins invariants +
  a corrupt-log robustness regime; found + fixed real crashes), a `parse_ts`
  timezone-consistency sweep across all 8 copies, and a `process_label` Python↔JS golden.

---

## 2. Queued backlog (next work)

1. **Segment-level automation / waste (headline).** Owner steer: marking an
   *atomic* step/click as an "automation candidate" is the wrong grain —
   automating one click mid-flow has no value (it forces a human→bot→human
   handoff). Reframe `analysis_automation` (and likely `analysis_waste`) +
   **PDD §4** to assess an automatable **segment** — a contiguous, same-app,
   human-uninterrupted run that forms a narrative — not individual steps.
2. **Full in-view single-session map.** Embed the interactive map *inside* the
   Session view instead of routing through Compare-Sessions. Bigger build: the map
   UI (level/notation controls, drill-scope, rare-path slider, `#map-level` /
   `#dfg-host` / `.panel-tab` DOM) is tightly coupled to `views/aggregate-view.js`
   state + element IDs — needs a careful refactor-for-reuse + full
   level×notation×theme harness check. The one-click "View map" is the low-risk interim.
3. **Group "Waste by step" by step type.** The single-session list is still
   per-instance (4× "Search — CUST-X" across cases). Grouping by type cuts it
   further but changes the per-step edit model — design the edit semantics first.
4. **Consolidate the `parse_ts` family.** Eight near-duplicate copies; the tz sweep
   made them consistent but they still differ in fallback (raise / None / epoch).
   Extract one shared helper that callers wrap with their own fallback.
   `test_parse_ts_consistency.py` guards the behaviour during the refactor.
5. **Broader doc-coverage audit.** Beyond this truth-up: README version, the older
   `docs/DOC-COVERAGE-AUDIT.md` findings, ADR statuses — confirm what's still real.

---

## 3. Owner-blocked / calibration (cannot be done headless)

- **Calibration on real captures** — `process_label` value-stripping, the
  rare-path cutoff, the fuzzy "same step" thresholds. Needs more representative
  real captures (owner-side). Fuzzing proves robustness, NOT calibration.
- **Released-`.exe` smoke** on the locked-down work laptop: the packaged app's
  recognition-JSON load + the recorder's single-monitor screenshot occlusion.
- **PDD "living projection"** — still undefined; needs a concrete owner definition.

---

## 4. Environment & conventions

- **Two machines:** dev box (node / python / git / .NET) vs. the locked-down work
  laptop (released `.exe` only — never suggest installs there).
- **Company captures stay local.** Use `scripts/inspect-events.js` /
  `scripts/count-cases.js`; never read a real `events.jsonl` into the assistant.
- **Validate via the packaged app *and* the §0 harness**, not just green tests —
  UI bugs are invisible to the unit suites.
- **Commit style:** imperative subject; **no Co-Authored-By trailer**; quote-safe
  body. Branch `viewer-refactor`; `gh` authed as `Atjeto`. For `.ps1`, scope-set
  `RemoteSigned`, not `-ExecutionPolicy Bypass`.
