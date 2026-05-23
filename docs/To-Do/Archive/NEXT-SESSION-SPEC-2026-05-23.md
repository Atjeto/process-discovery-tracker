# Next-Session Spec — Verify v0.15.0, then recognition & classification

**Written:** 2026-05-23 · **Branch:** `viewer-refactor` (released through
**v0.15.0**) · **Status:** plan of record for the next working session.

Self-contained hand-off — read top to bottom; assumes no memory of the prior
session. The previous spec (P0 coherence + segmentation, now done) is archived at
[Archive/NEXT-SESSION-SPEC-2026-05-22.md](Archive/NEXT-SESSION-SPEC-2026-05-22.md).

---

## 1. Where we are

**v0.15.0 shipped** (GitHub Release at `Atjeto/process-discovery-tracker`, commit
`a2b2f85` on `viewer-refactor`). Three things landed this cycle:

- **P0 coherence pass** (`docs/architecture/COHERENCE-AUDIT.md`) — step merge
  symmetry (`mergeStepWithNext` = step+next; `mergeSelectedSteps` = the
  multi-selection; `viewer/views/steps-view.js`), the repeat badge only when it
  discriminates ("N×"; `viewer/step-editor.js`), interaction-colour + repeat
  legends.
- **Case segmentation → active-case stamping** (`normalization/case_assignment.py`):
  `case_id` is stable per anchor label, every event is stamped to the
  most-recent preceding anchor (correct under interleaving), and a
  degenerate-case guard drops slivers (`min_case_interactions` /
  `min_case_duration_ms`). Replaces the old gap/pause split.
  `scripts/count-cases.js` + `normalization/canonical/atm-ticket-handling.yaml`
  aligned.
- **Process map = notation × level matrix** — the Process diagram (BPMN) **and**
  the Flow diagram (DFG) each render at Activity / Step / Phase; the level
  selector never swaps notation and the notation tabs never reset the level
  (`viewer/views/aggregate-view.js` `renderMap()`). **Step/phase BPMN is the
  observed flow**, mined from the annotations via `normalization/bpmn_observed.py`
  (one trace per case → PM4Py `discover_inductive` → `mining.export_bpmn` with a
  pure-Python BPMNDI layout, so bpmn-js renders it). `normalize.py` writes
  `process_map_step.bpmn` / `process_map_phase.bpmn` under `--mine`.

**Correction to carry forward:** the Process diagram supports **all three
levels** — it is *not* activity-only. (The old claim in `COHERENCE-AUDIT.md` /
ADR-0009 that "step can only render as a DFG" is wrong — do not act on it.)

---

## 2. Verify v0.15.0 in a real run — DO THIS FIRST

Nothing this cycle has been eyeballed in a running build (the cycle's UI bugs
were invisible to the green tests, and one shipped map bug only surfaced when the
owner looked). Validate via the **packaged app** (it bundles its own Python — no
dev-box pip) or the dev viewer (`npm start` in `viewer/`). The real session is on
the dev box (see §5).

1. **Case count** — re-analyze the real ATM session, or run
   `node scripts/count-cases.js <events.jsonl>`: active-case stamping should now
   report ~2 cases, not the old ~13. If still inflated, tune the degenerate guard
   / label handling in `case_assignment.py`.
2. **Steps view** — "Merge with next" vs "Merge selected"; "N×" badges only on
   steps that recur in *some* (not all) cases; the interaction-colour + repeat
   legends.
3. **Map matrix** — toggle every notation × level cell; the Step/Phase **Process
   diagram** must render an observed-flow BPMN *with branches* (re-analyze first
   so the new files exist — a session analyzed before 0.15.0 shows the "Analyze a
   session that has steps" message).
4. **ADR-0010 items never eyeballed** — recorder always-on-top + tray-click +
   marker-screenshot targeting + hotkey config; session name in recents/viewer.

Fix any regression here **before** building new features.

---

## 3. Prioritized feature work (carried forward as P1–P5)

### P1 — Recognition: cross-language + drive the pipeline (ADR-0011 follow-ups 1–2)
`viewer/recognition.js` is viewer-only; the Python pipeline still uses a
hardcoded browser-chrome list. Unify them:
1. Lift the signature table to `shared/recognition-patterns.json`, consumed by
   **both** `viewer/recognition.js` and a new `normalization/recognition.py`
   (viewer loads JSON natively; Python `json.load` — avoid YAML to keep the
   viewer dependency-free).
2. Replace `step_suggest._is_browser_chrome` (+ `_BROWSER_CHROME_CLASSES`) with
   the shared recognition; keep the `filter_browser_chrome` flag + tests.
3. Re-run `normalization/test/test_step_suggest.py` + the viewer suite.

### P2 — Reframe classification on recognition (ADR-0011 follow-up 3)
Activity/step classification should **lead with framework recognition** (semantic
type — "form field", "grid cell", "primary action") and use the window-title
`taxonomy.yaml` only for *business* labels. Shrinks the empty-map problem (the
map/lane show real semantic activity with zero taxonomy). Touches
`normalization/classification.py` + the Flow activity lane / DFG.

### P4 — Value-chain "what else"
- Team-wide **taxonomy editor** (the in-app classification manager `a3a179f` only
  writes per-session overrides).
- **PDD/report as a living projection** of the annotated model, not a one-time
  snapshot.
- Resolve the **activity-level vs step-level stats split-brain** (`stats.json`).
- Guarantee **re-normalization preserves curated relationships** (step→phase,
  step→template), not just step rows.
- The notation×level matrix landed; the **phase→step→activity drill-down**
  navigation is still open.

### P5 — ADR-0010 deferred sub-parts
- D3 **single-monitor screenshot occlusion** (the multi-monitor case is handled).
- D1 **mini-mode recorder toolbar** (the always-on-top + tray-click cover the
  stated pain).

---

## 4. Cleanup / debt found this cycle
- **Step/Phase BPMN export buttons are degenerate without a matched template.**
  `exportArtifact("step-bpmn"/"phase-bpmn")` (`viewer/renderer.js` ~448) runs
  `normalize` with no `--canonical`, so the template-derived `bpmn_step` /
  `bpmn_phase` emit an empty Start→End. Repoint export at the new observed-flow
  generator (`bpmn_observed`), or copy the session-folder
  `process_map_step|phase.bpmn`, or pass the persisted
  `annotations.matched_against.template_path`.
- **New ADR + stale-doc fix.** Write an ADR for active-case stamping + the
  notation×level matrix / observed-flow BPMN, and correct the "step can only
  render as a DFG" claim in `COHERENCE-AUDIT.md` and ADR-0009.

---

## 5. Environment & governance notes
- **Two machines:** the dev box (node/python/git/pip OK) vs. the locked-down work
  laptop (released `.exe` only — never suggest installs there).
- **Company data stays local.** The real capture is company data on a personal
  account. Use the **structure-only** scripts (`scripts/inspect-events.js`,
  `scripts/count-cases.js`) which print counts/timestamps, never values/titles.
  Do not read the raw `events.jsonl` into the assistant. Copies are at
  `D:\atm-test\events.jsonl` (partial) and `C:\Users\rasha\Downloads\Event
  Analysis.jsonl` (full) — the owner may clear these.
- **Validate via the packaged app**, not dev-box pip + CLI `normalize.py`. pm4py
  lives in the bundled Python (`viewer/python/`), **not** the bare dev Python —
  pm4py-dependent tests use `pytest.importorskip("pm4py")` and are validated by
  running the bundled interpreter (`viewer/python/python.exe`).
- **Commit style:** imperative subject; no Co-Authored-By trailer; quote-safe
  body. Branch `viewer-refactor`. Release flow (build → verify zips → push →
  **pre-tag** → `publish-release.ps1`) is in the release-workflow reference;
  `gh` is authed as `Atjeto`.

---

## 6. Suggested order
1. **Verify v0.15.0** (§2) — case count + Steps + map matrix on the real session;
   fix regressions first.
2. **P1** recognition cross-language lift.
3. **P2** classification on recognition.
4. **Cleanup** (§4) — the export-button fix + the ADR/doc correction (fold the
   doc work into the P1/P2 batch).
5. Then **P4 / P5**, each held to the four-point coherence discipline
   (inverse works · comprehension affordance · control-interaction check ·
   verified in a real run).
