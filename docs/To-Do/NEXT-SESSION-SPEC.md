# Next-Session Spec — Documentation fix pass + the remaining implementation backlog

**Written:** 2026-05-23 (late) · **Branch:** `viewer-refactor` ·
**Status:** plan of record for the next working session.

Self-contained hand-off — read top to bottom; assumes no memory of the prior
session. The spec just executed (analysis-layer abstraction, map readability,
drill-down filtering) is archived at
[Archive/NEXT-SESSION-SPEC-2026-05-23-evening.md](Archive/NEXT-SESSION-SPEC-2026-05-23-evening.md).

---

## 0. The verification harness exists — USE IT for any UI change

This project's recurring failure was shipping UI changes that were never
eyeballed. There is a Playwright harness that drives the **real** viewer and
screenshots it, so a headless agent CAN see the UI. **Use it to confirm every UI
change before claiming it done — proactively, not as an offer.**

- **Where:** `_pdt_verify/driver.js` (a scratch dir *outside* the repo;
  `playwright-core` installed there — not a repo dependency).
- **How it works:** `_electron.launch` runs the viewer's own Electron with
  `--session=<analyzed session folder>` (see `main.js parseInitialSessionArg`),
  drives the page, and writes `shot-*.png`. Read the PNGs back to see the render.
  It logs `PAGE ERROR:` for any console error.
- **Reaching the aggregate map:** mock the native folder picker, then click the
  tab + open button —
  `await app.evaluate(({dialog}, p) => { dialog.showOpenDialog = async () => ({canceled:false, filePaths:[p]}); }, SESSION)`,
  then click `.tab[data-view="aggregate"]` and `#btn-open-multi-hero`. Switch
  level with `#map-level` (`activity|step|phase`), notation with
  `.panel-tab[data-map="bpmn"|"dfg"]`. The DFG canvas exposes its cytoscape
  instance on `#dfg-host.__cy` so node taps can be driven (`cy.nodes()[i].emit("tap")`).
- **A loadable analyzed session:** re-analyze a bundled example —
  `viewer/python/python.exe normalization/normalize.py sessions/example-aggregate/sess-2026-0514-0900 --mine`.
- The driver already covers: step-level collapse, scoped drill-down + chip,
  "Hide rare paths", and the Analysis-tab time study. **The example-aggregate is
  gitignored-but-tracked demo data — do NOT commit the regenerated session files.**

---

## 1. Where we are

v0.15.0 plus a large follow-on cycle, **done and verified but uncommitted on
`viewer-refactor`**:

- **Code (harness-verified):** removed the dead aggregate Flow/Steps/Phases
  switcher; the P0 analysis "endless list" fix (value-free `process_label` is now
  the step-grouping key in `analysis_time_study`, `analysis_automation`,
  `stats_compute.step_stats`/`step_variants` — a step seen across N cases collapses
  to one row with `instances=N`); scoped phase→step→activity drill-down on the Flow
  diagram with a "scoped: …/show all" chip; a "Hide rare paths" Flow-diagram toggle
  (`process-map-levels.dropRareEdges`). Tests green: **171 viewer + 51 Python
  analysis/stats** (plus the rest of the suites).
- **Docs:** wrote **ADR-0013** (the `process_label` grouping + map readability),
  refreshed NORMALIZATION / VIEWER / DATA-MODEL / SCHEMA / OVERVIEW / FEATURES, and
  ticked the now-done action items in ADR-0010 (all), ADR-0011, ADR-0012 (#1–6).
- **Audit:** ran a full coverage/consistency pass → **`docs/DOC-COVERAGE-AUDIT.md`**
  (30 verified findings). That audit is this session's headline output and the
  worklist for §2.

Nothing here is committed yet; the example-aggregate session was re-analyzed for
verification and must not be committed.

---

## 2. PRIMARY — the documentation fix pass

**Source of truth:** [`docs/DOC-COVERAGE-AUDIT.md`](../DOC-COVERAGE-AUDIT.md) — 30
verified findings (9 NOT COVERED, 9 SHOULD BE COVERED, 12 INCONSISTENT), each with
a file (often a line), what's wrong, and the corrected fact. Work it in the
audit's own six-step order:

1. **Correctness-first (IN-1…IN-6).** Statements that actively mislead: the
   crash-loss bound (CAPTURE.md says synchronous append; it's a 500 ms batch
   queue), `_merge_steps` location + "split/merge UIs deferred" (SCHEMA.md),
   "Pdt\* modules" (OVERVIEW.md), interaction-recorder.md "Proposed".
2. **Version truth (IN-8, IN-9).** README is stuck at v0.5.0 → bring to 0.15.0;
   add the missing `[0.11.0]` CHANGELOG section (or note the skipped tag).
3. **ADR hygiene (SC-1…SC-5, IN-12, IN-7).** Flip stale statuses (ADR-0001 still
   "Proposed", ADR-0006 "Phase A in progress"), tick done action items
   (0002/0009), fix the broken ADR-0008 link + the stale line/test counts.
4. **Stale frames (IN-10, IN-11).** SPEC-DEFERRED.md context + its shipped items;
   the COHERENCE-AUDIT "recognition is viewer-only" point (Python side shipped).
5. **Coverage fills (NC-1…NC-9).** Missing config keys, manifest fields, modules
   (`coalesce.py`, `classification_overrides.py`, `report-html.js`,
   `canonical-author.js`, `views/identity-picker.js`), and export surfaces (HTML
   findings report, Step-statistics table, DFG→SVG serializer).

Rows for steps 1–5 are self-contained. **Step 6 — the new-ADR judgment calls
(SC-6…SC-9)** — needs a quick read of the cited source docs and an owner steer:
the "Studio Dark" theme, the v0.2.0 distribution pivot, intra-session repetition
alignment, and the VALUE-CHAIN-REVIEW decisions each *might* warrant a short
retroactive ADR. Decide per item; don't manufacture ADRs for their own sake.

---

## 3. Open implementation backlog (carried from the ADRs)

- **ADR-0012 #7 — recognition-driven anchor detection (the headline functional
  item).** Replace the opaque `automation_id == "txtsr"` case anchor with a
  recognised signature, so case detection generalises across engagements (ties
  into ADR-0011's recognition layer).
- **ADR-0013 #5 — calibration.** Tune `process_label`'s value-stripping and the
  rare-path frequency cutoff against more / more-representative real captures;
  consider a frequency *slider* if the binary "Hide rare paths" toggle proves too
  coarse.
- **ADR-0013 #6 — BPMN drill-scoping (deferred).** Drill-down scoping is
  DFG-only; the Process diagram (BPMN) is a static mined file, so scoping it needs
  live re-mining in JS or a normalize round-trip. Decide if it's worth it.

---

## 4. Owner-blocked / owner-side (cannot be done headless)

- **PDD "living projection" — still undefined.** Needs a concrete definition from
  the owner before it's buildable (regenerate-on-view? embed the model in the
  viewer? a queryable projection?). The export already re-derives from current
  annotations on each run. **Get the definition first.**
- **Released-`.exe` smoke.** Confirm the packaged app finds
  `resources/shared/recognition-patterns.json` (the P1 bundling), and verify the
  recorder's D3 screenshot occlusion (it dims its own always-on-top windows during
  a grab) on a real **single-monitor** capture. Needs the work laptop + a
  one-display recording.

---

## 5. Environment & conventions

- **Two machines:** dev box (node/python/git OK) vs. the locked-down work laptop
  (released `.exe` only — never suggest installs there).
- **Company data stays local.** Use `scripts/inspect-events.js` /
  `scripts/count-cases.js`; never read a real `events.jsonl` into the assistant.
- **Validate via the packaged app *and* the §0 harness**, not just green tests —
  UI bugs are invisible to the unit suites.
- **Commit style:** imperative subject; **no Co-Authored-By trailer**; quote-safe
  body. Branch `viewer-refactor`; `gh` authed as `Atjeto`. For `.ps1`, scope-set
  `RemoteSigned` in-shell — do **not** use `-ExecutionPolicy Bypass`.

---

## 6. Suggested order

1. **Documentation fix pass (§2)** — the bulk; mostly mechanical and
   self-contained, and it's the agreed next-session focus.
2. **ADR-0012 #7 recognition-driven anchors (§3)** — the headline functional item.
3. **ADR-0013 #5 calibration (§3)** — once more real captures exist.
4. **New-ADR judgment calls (§2 step 6) + ADR-0013 #6** — with owner input.
5. **Owner-blocked items (§4)** — when the owner defines PDD / runs the packaged smoke.
