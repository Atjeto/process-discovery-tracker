# Tech-Debt Findings — Session Handoff

**Version reviewed:** v0.19.0 · **Date:** 2026-05-29 · **Lens:** maintainability / technical debt
**Scope:** all 3 layers (capture / normalization / viewer) + tests + dependencies.
**Purpose:** one of 3 parallel review sessions. This file is the *tech-debt* findings, for
cross-comparison against the other sessions to eliminate overlap. Dedupe **by lens**, not just
by file — several items below will also surface in a security or bug-hunting review, but the
angle here is "what slows change / risks regressions," not exploitability.

All locations are real `file:line` in the source tree (NOT `viewer/dist/`, which is gitignored
build output, nor `viewer/python/`, the bundled embeddable).

Scoring: **Priority = (Impact + Risk) × (6 − Effort)**, each axis 1–5 (Effort inverted).

> **Update — 2026-06-27 (status reconcile + #16 partial).** A pass re-verified
> the open items against current code (this file is v0.19.0-era). **Already
> resolved, do NOT re-open:** **#1** (durability-path swallowing — `obs.js` now
> `bootLog`s every stop/status/path-null branch, tagged `TD#1b`), **#2** (no
> unbounded `while` remains in `capture/main.js`), **#3** (`electron-builder`
> devDep removed), **#11** (`normalize.normalize()` decomposed — §0.7),
> **#12** (`flow-view.js` split — §0.7), **#15** (Electron 33→42 — v0.20.0),
> **#19** (`dagre`→`@dagrejs/dagre` — v0.20.0). **#5** is NOT a live bug: the
> two range checks are logically equivalent (`b < a` skip ≡ `b >= a` accept);
> only the copy-paste *duplication* remains (a no-behaviour-change refactor,
> deferred per the phasing). **#16 — DONE for 3 of 4 modules:** seeded fuzzers
> added for `app_vocab`, `canonical_match`, `classification`
> (`test_*_fuzz.py`). They surfaced + fixed ~16 real robustness gaps where a
> malformed template / vocab YAML or an odd-shape capture event would have
> CRASHED normalization with an `AttributeError`/`TypeError` (non-dict
> vocab/scope/rule/step/data, non-string window_title/process_name/app/title,
> non-numeric duration, an unhashable list-valued signature field); every guard
> is identity on well-formed input (golden 10/10 byte-stable). `pdd_export` is
> **deferred**: it needs `python-docx`, which the test runner's system Python
> lacks, so a fuzzer there would only ever skip.

---

## Tier 1 — Quick wins (low effort, self-contained)

| # | Item | Location | I | R | E | Score |
|---|------|----------|---|---|---|-------|
| 1 | Silent error swallowing on durability-critical paths: OBS `GetRecordStatus`/`StopRecord` failure leaves `recording_path: null` (video viewer can't locate) with nothing logged; tracker append failure drops a marker/case-boundary silently; PDD process-map embed dropped silently. Add `bootLog` on each. | `capture/obs.js:108-136`, `capture/tracker.js:134-139`, `viewer/renderer.js:651` | 2 | 3 | 1 | **25** |
| 2 | Unbounded `while` loop on mutated shared state inside the idle-monitor interval callback. Safe today only because `fireMarker` always pops; one future change = infinite loop. Convert to bounded `for` over known marker depth. | `capture/main.js:282-285`, `1000-1002` | 2 | 3 | 1 | **25** |
| 3 | Dead/contradictory `electron-builder` devDep in both `package.json`s (docs + build use `@electron/packager`). Remove dep, `build` block, `dist` script. | `capture/package.json`, `viewer/package.json` | 1 | 1 | 1 | **10** |

## Tier 2 — Duplication & coupling (highest structural ROI)

| # | Item | Location | I | R | E | Score |
|---|------|----------|---|---|---|-------|
| 4 | Map-controller wiring + data-source duplicated; activity-stat merge and DFG-edge `"\x00"`-key merge duplicated. Extract shared `map-wiring.js` + `dfg-merge.js`. | `viewer/renderer.js:210-323,726-753` ↔ `viewer/views/aggregate-view.js:76-140,495-718` | 3 | 3 | 2 | **24** |
| 5 | Detector copy-paste scaffolding across 3 modules: `merge_*` fns, `signature()`/`_signature()`, two excluded-range parsers. **Latent bug:** range validity check is `b >= a` in one, `b < a` in another. Extract `suggestion_merge.py`. | `normalization/marker_suggest.py:136-151,202-219,557-595`, `anchor_suggest.py:158-164,321-361`, `step_suggest.py:38-65` | 3 | 3 | 2 | **24** |
| 6 | Module-global `_last*` cache → hidden temporal coupling of map render to the order of the last `renderAggregate()` call. Pass state explicitly into the data source. | `viewer/views/aggregate-view.js:206-210` | 3 | 3 | 2 | **24** |
| 7 | Manifest read-modify-write race, pattern duplicated across 4 sites. Background-OBS `.then()` can clobber `m.obs`/`m.displays`. Single `updateManifest(folder, fn)` helper. | `capture/main.js:531-536,780-782,919-923`, `capture/obs.js` | 2 | 4 | 2 | **24** |
| 8 | 3× duplicated inline context-menu builder (cssText + addItem + dismiss). Falls out once #11's marker-edits move to their own module. | `viewer/views/flow-view.js:1661,2778`, `steps-view.js:1018` | 2 | 2 | 2 | **16** |
| 9 | `btn.click()` used as control flow — re-analysis triggered by synthesizing clicks on hidden buttons. Replace with direct function calls. | `viewer/views/flow-view.js:1543,1637,1699`, `aggregate-view.js:1371`, `template-view.js:772` | 2 | 2 | 2 | **16** |
| 10 | Scattered magic numbers / timing contracts: `setTimeout(...,50)`×6 + `900` ("matches timing elsewhere"); 500 ms batch flush bare literal central to durability; BPMN filename map hardcoded 3×; truncation lengths differ (39/40/159). Name them. | `viewer/map-controller.js:168,195,219,323,334,373`, `renderer.js:783`, `capture/tracker.js:163` | 2 | 2 | 2 | **16** |

## Tier 3 — God files / functions (large; do as epics, opportunistically)

| # | Item | Location | I | R | E | Score |
|---|------|----------|---|---|---|-------|
| 11 | `normalize.normalize()` — ~485-line god function, **16 swallow-and-continue try/excepts**, 4-deep nesting. Every ADR bolts another block in. Decompose into named stages behind a runner. *(Highest-leverage Python refactor.)* | `normalization/normalize.py:347-832` | 4 | 4 | 3 | **24** |
| 12 | `flow-view.js` — 3794-line god file; `renderTimeline()` alone ~570 lines w/ 8 inline lane plugins + an 11-function marker-edit family. Extract `timeline/lanes/*` factories + `marker-edits.js`. *(Highest-leverage viewer refactor.)* | `viewer/views/flow-view.js` (whole), `:2130-2701` | 5 | 4 | 4 | **18** |
| 13 | `capture/main.js` — 1742-line god file embedding two full HTML documents + 18 interleaved IPC handlers. Other windows are already separate modules; these two are the outliers. Extract them + group IPC. | `capture/main.js` (whole), `:564-655`, `:1082-1225` | 4 | 2 | 3 | **18** |
| 14 | Other oversized render fns: `renderAggregate()`, `renderSessionSummary()`, `buildMenu()`. Split per-section. | `viewer/views/aggregate-view.js:445-804`, `flow-view.js:820-1040`, `capture/main.js:1339-1532` | 3 | 3 | 3 | **18** |

## Tier 4 — Test & dependency debt

| # | Item | Location | I | R | E | Score |
|---|------|----------|---|---|---|-------|
| 15 | **Electron `^33.2.0` past its security-support window** in both apps, compounded by `nodeIntegration: true`. Bump to a supported major; re-verify packaging on the locked-down laptop. *(Most security-relevant item; will overlap a security review.)* | `capture/package.json`, `viewer/package.json` | 3 | 5 | 3 | **24** |
| 16 | Missing fuzzers for parsing-heavy untrusted-input modules — same threat profile that justified the existing 7 fuzzers. | `normalization/classification.py`, `canonical_match.py`, `app_vocab.py`, `pdd_export.py` | 2 | 3 | 2 | **20** |
| 17 | Bundled **Python pinned to 3.11.9** (stale patch w/ later security fixes), shipping to analyst machines; deps floor-only, no lockfile. Bump patch + capture a resolved lock. | `scripts/build-python-embeddable.ps1`, `normalization/requirements.txt` | 1 | 3 | 2 | **16** |
| 18 | ~12k LOC of viewer views/controllers + the entire `capture/main.js` have **zero unit coverage** (UI-only verified via out-of-repo Playwright harness). Realistic mitigation: extract pure logic during #11–14 and unit-test the seams, not the god files in place. | `viewer/views/*`, `viewer/renderer.js`, `capture/main.js` | 4 | 4 | 4 | **16** |
| 19 | `dagre 0.8.5` unmaintained (last release ~2018) — migrate to maintained `@dagrejs/dagre` fork. | `viewer/package.json` | 1 | 2 | 2 | **12** |

---

## Explicitly cleared as HEALTHY — do not re-flag

Checked directly and found already paid down or robust. Listed so a parallel session doesn't
raise them as new debt:

- **`process_label` Python↔JS "sync risk"** — well-controlled: both sides load the same
  `shared/process-label-patterns.json` and are pinned by a shared golden
  (`shared/process-label-golden.json`) asserted in both `test_process_label.py` and
  `viewer/process-map-levels.test.js`. A rule change can't silently diverge.
  *(One residual, Low: no shared golden for the recognition matcher walk itself.)*
- **Timestamp handling** — consolidated into `normalization/_dt.py` (3 documented variants),
  pinned by `test_parse_ts_consistency.py`.
- **C# recorder** (`capture/recorder/UiaSubscriber.cs`) — robust threading/UIA-handle cleanup,
  double-subscription leak handled. Leave it.
- **`tracker.js` factoring** — clean (pure exported helpers, correct batch queue) except the
  silent-append issue (#1).
- **Hygiene** — no TODO/FIXME/HACK markers anywhere; no `.only`/`xfail`; the 3 skipped tests are
  all legitimate env guards.
- **.NET recorder** — `net8.0-windows`, zero NuGet `PackageReference` (no supply-chain surface).
  *(Note for later: .NET 8 LTS ends ~Nov 2026 — plan .NET 10 within the year. Not debt yet.)*

---

## Predicted overlap with the other 2 sessions

If a parallel session ran **security** or **correctness/bug-hunting**, expect collisions on:
items **#1** (silent swallowing), **#2** (unbounded loop), **#7** (manifest race), **#15**
(Electron 33), and `nodeIntegration: true`. The angle here is maintainability/regression-risk,
**not** exploitability or a reproduced bug — keep both entries if the lenses differ, and merge
only where the proposed remediation is identical.

---

## Suggested remediation phasing

- **Phase A (this sprint, ~0.5d):** #1, #2, #3 — safety/hygiene, near-zero behavioral risk.
- **Phase B (next sprint, ~3–4d):** #4–#7 (shared helpers; #5 also fixes a latent bug), then #8–#10.
- **Phase C (opportunistic epics):** #11 and #12 are highest-leverage; do the relevant one when a
  feature next touches that surface. #18 rides along — unit-test extracted seams. Hold each new
  "verb" to the COHERENCE-AUDIT checklist.
- **Phase D (scheduled, ~2–3d):** #15 first (security, needs packaging re-verification), then #17,
  #16, #19.
- **Sequencing:** B before C — dedup removes code that would otherwise be moved twice in the splits.

---

## Comparison vs. `docs/ARCHITECTURE-ISSUES.md` (resolved register)

`docs/ARCHITECTURE-ISSUES.md` is a **RESOLVED** register from the viewer refactor
(ADR-0003 Phases 1–3 + ADR-0004 Warm Editorial redesign). It scopes itself to the
**viewer only** (capture has a separate `CAPTURE-ARCHITECTURE-ISSUES.md` — also worth
re-checking for staleness). Comparing it against this audit shows the structural debt
it "closed" has **partially re-accreted** — the most important cross-session signal here.

### Headline: the monolith moved, it didn't disappear

**S1** ("renderer.js is a 5,708-line monolith") was marked resolved by splitting into
per-view modules (~5,700 → ~1,200). `renderer.js` is indeed ~1,674 now — but the split
**created `flow-view.js`, which has since grown to 3,794 lines.** S1's own problem
statement ("constant merge-conflict surface; no contributor can hold it in their head")
now applies verbatim to `flow-view.js`. The refactor relocated the monolith rather than
removing the conditions that grow one.

### Regression map — resolved-then-re-accreted

| Old ID | Claimed resolution | This audit's finding | Verdict |
|--------|-------------------|----------------------|---------|
| **S1** | renderer.js split to ~1,200 | `flow-view.js` now **3,794** lines (#12) | Re-accreted in a new file |
| **S3** | `renderTimeline()` (432 L) → lane plugins | `renderTimeline()` now **570 L** (`flow-view.js:2130-2701`, #12) | **Regressed — larger than before** |
| **S8** | lanes → `{height, render(host,ctx)}` plugin contract | 8 lanes use the contract but are defined **inline** inside `renderTimeline()` again (#12) | Contract kept, composition discipline lapsed |
| **S4** | scattered view-state → `state.js` | module-global `_last*` cache in `aggregate-view.js:206-210` (#6) | Same anti-pattern, new module |
| **S7** | `window.Pdt*` globals → CommonJS | cyclic `require()` dodged with lazy require (`steps-view.js:278`) | New coupling born from the split |

### Confirmed still-resolved — do NOT re-open

- **S2** (timeline logic implemented 3×) — genuinely fixed; `timeline/timeline-core.js`
  (~430 L) exists and this audit found **no** timeline triplication. The highest-leverage
  item in the old register held.
- **S5** (three-way level dispatch copy-pasted) — not seen; `LEVEL_RENDERERS` map intact.
- **S6** (full session reload per edit) — found in-place `annotations` mutation but not the
  full-reload pathology; appears resolved.

### Old register items OUTSIDE this audit's lens (unverified here)

- **D1–D3** (palette/contrast) and **R1–R4** (UI regressions) are design-system / visual
  issues, said to be superseded by ADR-0004. This was a **code-debt** review and did not
  assess the running UI's visuals — **cannot confirm or refute** these are still fixed.
  Route to a design/UX-lens session if one exists.

### Implication for #12

The viewer's structural debt is **cyclical** — S1/S3/S8 returned in `flow-view.js` within a
few release cycles. So #12 (split `flow-view.js`, extract lanes to real modules) should not
be treated as a one-off: it needs an **enforced composition discipline** (a lint cap on
file/function length, or lanes physically in `timeline/lanes/`) or it will re-accrete a
third time.
