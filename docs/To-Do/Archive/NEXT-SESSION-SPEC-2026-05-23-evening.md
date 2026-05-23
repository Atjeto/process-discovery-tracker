# Next-Session Spec — Analysis-layer abstraction, map readability, drill-down filtering

**Written:** 2026-05-23 (evening) · **Branch:** `viewer-refactor` ·
**Status:** plan of record for the next working session.

Self-contained hand-off — read top to bottom; assumes no memory of the prior
session. The spec just executed is archived at
[Archive/NEXT-SESSION-SPEC-2026-05-23.md](Archive/NEXT-SESSION-SPEC-2026-05-23.md).

---

## 0. A VISUAL VERIFICATION HARNESS EXISTS — USE IT

This cycle's recurring failure was shipping UI changes I couldn't see, which
broke trust. There is now a Playwright harness that drives the **real** viewer
and screenshots it, so a headless agent CAN eyeball the UI. **Use it to confirm
every UI change before claiming it done.**

- **Where:** `_pdt_verify/driver.js` (a scratch dir *outside* the repo;
  `playwright-core` installed there — not a repo dependency).
- **How it works:** `_electron.launch` runs the viewer's own Electron with
  `--session=<analyzed session folder>` (the viewer preloads it; see
  `main.js parseInitialSessionArg`), then drives the page and writes
  `shot-*.png`. Read the PNGs back to see the render.
- **Reaching the aggregate MAP** (Process/Flow diagram lives in the
  Compare-Sessions view, not the single-session view): mock the native folder
  picker in the main process, then click the tab + the open button —
  `await app.evaluate(({dialog}, p) => { dialog.showOpenDialog = async () => ({canceled:false, filePaths:[p]}); }, SESSION)`,
  then click `.tab[data-view="aggregate"]` and `#btn-open-multi-hero`. Switch
  level with `#map-level` (`activity|step|phase`) and notation with
  `.panel-tab[data-map="bpmn"|"dfg"]`.
- **A loadable analyzed session:** re-analyze a bundled example —
  `viewer/python/python.exe normalization/normalize.py sessions/example-aggregate/sess-2026-0514-0900 --mine`
  (writes `annotations.json` + `process_map_step.bpmn` + `stats.json`).
- The example-aggregate is gitignored-but-tracked demo data; re-analyzing it is
  a local verification step — **do not commit** the regenerated session files.

---

## 1. Where we are

v0.15.0 plus a large real-run cycle, committed at `fa10f62` and the follow-on
features on top. **Done and screenshot-verified this cycle:** empty-value anchor
fix; P1 shared recognition table (`shared/recognition-patterns.json` +
`normalization/recognition.py`); P2 recognition-led activity classification;
§4a observed-flow Step/Phase BPMN export; P4 stats split-brain (`step_stats`),
re-analyze relationship preservation, team-taxonomy promotion (backend **and**
the in-app "Save to team taxonomy…" button); P5 D3 screenshot occlusion; the
viewer real-run fixes (step-map **label collapse** via `process_label`, Raw
Events overlap, map zoom/pan, draggable + persistent BPMN map); Flow/DFG layout
persistence; phase→step→activity drill-down (level-cascade). Tests: **177
normalization + 167 viewer + 65 capture** green.

---

## 2. P0 — the Analysis layer + stats are per-INSTANCE, not per-step-type

**The "endless list".** The Analysis tab's Cross-Session Time Study renders one
row per *raw* step ("Salesforce: Search — CUST-10852", "… — CUST-10905", …) —
an endless, near-valueless list. Root cause: `analysis_time_study._group_key`
groups by `canonical_step_id or ("step:" + step_id)`, so with **no Process
Template** every instance is its own group. The same per-instance fragmentation
affects `stats_compute.step_stats` and `step_variants` (keyed on raw `name`),
and likely `analysis_waste` / `analysis_automation` / `analysis_efficiency`
(audit them + `analysis_common`).

**Fix:** make `process_label` the step-grouping fallback **everywhere** —
`canonical_step_id` → `process_label` → `step_id` — so a step seen across N
orders collapses to ONE row with `instances = N`. This is the exact abstraction
the process map already uses (`step_suggest.process_label`, stamped on every
step at normalize); reuse that field, don't reinvent. Then the time study reads
"Salesforce: Search · instances 9 · mean 5.4s", which is the point of the view.
Verify in the harness (Analysis tab) and in the Markdown report's tables.

This is the headline: until it lands, the Analysis tab and the step report are
unusable on real (mostly-unique-valued) data.

---

## 3. Map gateway readability (the XOR fan-out)

Checked this cycle: the **collapsed** step map's exclusive gateways are at most
**2-way** — the wide fans were the un-abstracted per-order nodes, fixed by
`process_label`. Note BPMN XOR legitimately supports N-way exclusive choice, so
">2 branches" is valid notation, not a bug. Remaining work:

- The **activity-level** map can still fan wide when the taxonomy is sparse
  (many distinct apps, few rules). A wide fan there is the signal the owner
  intuited — under-identified steps; the cure is better identification
  (taxonomy / recognition / templates), not forcing binary gateways.
- **Scale:** on a long (8h) recording even a correct model can be dense.
  Consider collapsing low-frequency branches behind a "+N more / show rare
  paths" affordance, and/or a frequency threshold on the mined model.

---

## 4. Carried forward / still open

- **Drill-down subtree FILTERING.** Drill-down currently *cascades the level* on
  a node click (phase→step→activity) but shows the whole next level, not the
  clicked node's children. Make it scope: click phase X → step level filtered to
  X's `step_ids`; click step Y → activity level filtered to Y's interactions'
  apps. Touches `aggregate-view.drillDownLevel`, `buildAnnotationDfg` (add a
  filter arg), and the activity DFG. Verify with the harness.
- **PDD "living projection".** Still undefined. The report already re-derives
  from current annotations on each export, so "living" needs a concrete meaning
  (regenerate-on-view? embed the model in the viewer? a queryable projection?)
  before it is buildable. Get the definition first.
- **Released-`.exe` smoke (never eyeballed in a packaged build):** confirm the
  packaged app finds `resources/shared/recognition-patterns.json` (P1 bundling)
  and verify D3 single-monitor screenshot occlusion on a real capture (the
  recorder dims its own windows during a grab — needs a one-monitor recording).

---

## 5. Environment & conventions

- **Two machines:** dev box (node/python/git OK) vs. the locked-down work laptop
  (released `.exe` only — never suggest installs there).
- **Company data stays local.** Use the structure-only scripts
  (`scripts/inspect-events.js`, `scripts/count-cases.js`); never read a real
  `events.jsonl` into the assistant.
- **Validate via the packaged app *and* the §0 harness**, not just green tests —
  UI bugs are invisible to the unit suites.
- **Commit style:** imperative subject; **no Co-Authored-By trailer**;
  quote-safe body. Branch `viewer-refactor`. Release flow in the
  release-workflow reference; `gh` authed as `Atjeto`.

---

## 6. Suggested order

1. **P0 analysis/stats `process_label` abstraction (§2)** — makes the Analysis
   tab + report usable; verify in the harness.
2. **Drill-down subtree filtering (§4).**
3. **Map readability at scale (§3)** — only if wide fans persist on real data.
4. **PDD "living projection" (§4)** — once the owner defines it.
5. **Released-`.exe` + recorder smoke (§4).**
