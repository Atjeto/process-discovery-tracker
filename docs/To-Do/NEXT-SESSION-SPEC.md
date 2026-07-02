# Next-Session Spec — plan of record

**Updated:** 2026-06-27 · **Branch:** `master` · **Status:** plan of record (operational).
**Source-of-truth chain:** [PDT-MASTER-ASSESSMENT.md](PDT-MASTER-ASSESSMENT.md) (strategy) →
[PDT-ROADMAP-CODEBASE-FIT.md](PDT-ROADMAP-CODEBASE-FIT.md) (engineering fit) → **this doc**
(what we're doing next). When this doc and the Fit Analysis disagree on sequencing, the Fit
Analysis wins; this doc is its operational projection. **Scope is bounded by
[ADR-0026](../adr/0026-distribution-unsigned-and-services-boutique-scope.md)** — read the
"Out of scope" block below before treating any roadmap item as remaining work.

Self-contained hand-off — read top to bottom; assumes no memory of the prior
session. Earlier specs live in git history and [Archive/](Archive/).

> **Update — 2026-07-03 (plan of record moved).** The owner's full-app
> usability critique (2026-07-02/03) concluded this backlog's remaining
> owner-gated items are subsumed by a new cycle:
> **[APPROACHABILITY-REDESIGN-2026-07-03.md](APPROACHABILITY-REDESIGN-2026-07-03.md)**
> is now the operational plan of record (layer diagnosis, use gate, phases
> R1–R5). Start there. This file remains the historical record of the
> pre-redesign waves; its §3 real-data items land inside R2/R5.

> **Update — 2026-06-27 (reconcile to v0.22.2 + lab phases A–H).** This file
> predates the lab-phase cycle; the **live** sources are CLAUDE.md's *Active
> direction* block + [LAB-PHASE-SPEC.md](LAB-PHASE-SPEC.md) + CHANGELOG. The
> §0.x / §1 / §2 blocks below are the **historical record** of the Wave-0 /
> Wave-1 work (all landed). Current state:
> - **Released v0.22.2** — the v0.20.0 internal-rollout cycle + the
>   v0.20.1→0.22.2 coherence / fix-first increments (see CHANGELOG).
> - **Lab phases A–H all BUILT** (honesty redesign → real-session hardening).
>   The owner's first real-session findings
>   ([real-session-findings.md](real-session-findings.md), **G-1→G-8**) are
>   fully addressed; **Phase H** (G-6/7/8 — arrival-session reframe + one-click
>   per-app "Start from a recording" bootstrap + right-click "Add to App
>   Library") is the latest, on master.
> - **Tech-debt** ([tech-debt-findings.md](tech-debt-findings.md)): Tier-1 + the
>   god-file / Electron-42 / dagre-fork epics are done; **#16** fuzzers added for
>   `app_vocab` / `canonical_match` / `classification` / `pdd_export` (pure
>   helpers) — surfacing + fixing ~20 crash-on-corrupt-input gaps; **#7** manifest
>   read-modify-write race closed (one atomic `session.updateManifest`).
>   Remaining: opportunistic Tier-2 refactors (#4/#6/#8/#9/#10 — do alongside a
>   feature, not for their own sake) + #17 (bundled-Python patch bump + lockfile).
> - **What's genuinely next is owner-gated** (the §3 list still stands):
>   calibration on real captures, live-app coverage (SAP / Citrix / Java / Qt),
>   the released-`.exe` smoke on the locked-down laptop, and any release cut.
>   The autonomous / headless backlog is essentially drained.

---

## Out of scope — services-boutique, not enterprise-product ([ADR-0026](../adr/0026-distribution-unsigned-and-services-boutique-scope.md))

PDT is the engine behind an **owner-run process-discovery service**, not a self-serve
enterprise product. The items below are **out-of-scope / deferred — NOT backlog and NOT
remaining work.** An autonomous pass must **not** pick them up; reversal is an explicit
owner call, item-by-item.

- **BYOC / web viewer / multi-user** — the two-machine, air-gapped, single-analyst model is the product.
- **LLM-augmented vocab labeling** — there is no LLM in the product; vocab authoring is point-and-learn ([ADR-0025](../adr/0025-in-app-vocabulary-discovery.md)) + hand curation.
- **§11f cross-recording trace-merge** — stitching cases across separate recordings.
- **The "living-projection" deliverable** — never concretely defined; dropped.
- **MDM / Intune packaging** — unzip-and-run is the install story (ADR-0014).
- **Third-party penetration test; SIG-Lite / CAIQ security questionnaires; AV/EDR fleet validation.**
- **Recorder-in-CI** — CI stays recorder-free / Electron-free; the recorder is validated by `Recorder.Tests` + owner-run real captures.

The calibration/validation those items assumed (real Salesforce / ServiceNow / SAP / Office
captures, threshold tuning, coverage hardening on hard frameworks) is covered by **real
engagements** — owner-run, ~10 apps prepped — not by enterprise infrastructure to simulate them.

**Distribution:** releases ship **unsigned by design** (ADR-0026 decision 1). The Wave-0
"self-sign binaries with the internal cert" item (§2.6) is **retired** — signing under the
company cert is declined; the `-CertThumbprint` scaffolding stays for a future owner-held cert.

---

## 0. Verify UI changes in the harness — proactively, not as an offer

This project's recurring failure is shipping UI that was never eyeballed. A
Playwright harness drives the **real** viewer and screenshots it, so a headless
agent CAN see the UI. Use it to confirm every UI change before claiming it done.

- **Where (start here):** **in-repo `e2e/`** — it bundles `playwright-core` and drives the
  viewer's own electron, so you need nothing external. `e2e/session-smoke.js` is the worked
  launch example (+ the merge-gate asserts). The full **launch recipe + DOM-handle map** is
  in [docs/CHIP-GUARDRAILS.md](../CHIP-GUARDRAILS.md) → "How to drive the viewer". `_pdt_verify/`
  is an *optional* out-of-repo harness with extra scratch drivers — it may be **absent**, so
  don't depend on it.
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

## Reference Maps (ADR-0019) — landed 2026-05-31 on `master`

Decoupled, fully-editable BPMN copies of a mined map. From the Process diagram,
**⑂ Fork map** snapshots the current cell into a standalone `.bpmn` the analyst
edits with the full bpmn-js palette — a **one-way leaf** the pipeline never
re-mines, merges, or regenerates. Copies live in a per-session gallery
(`derived_maps/<map_id>.bpmn` + `annotations.json reference_maps[]`), are typed
As-Is/To-Be/Reference, carry provenance + drift (+ Re-fork), and a selected To-Be
map embeds in the PDD (§4.5, captioned analyst-authored). Delete keeps the blob so
Ctrl+Z restores a working entry; `entry.file` is containment-checked. Reuses the
vendored bpmn-js modeler (palette un-hidden off `.map-host`), `saveXML`-to-path
persistence, and the existing PDD image bridge (`exportSvg` → off-screen PNG raster
→ `--pdd-tobe-image`). Tests: `reference-maps.test.js` + two `pdd_export` To-Be
tests; the full **create→edit→save→reload→undo** round-trip (incl. the inverse and
the one-way-leaf invariant) is pinned in the gated real-viewer harness
`e2e/session-smoke.js`; real-run verified (light + dark, incl. a persisted-edit
reload) via `_pdt_verify/refmap-verify.js`. Next
(deferred): cross-session reference-map library; singleton→factory for side-by-side
live+editor; orphan-blob GC.

---

## 0.5 Real-value vocab cycle — 2026-05-30

The §11d App-Vocabulary work was reframed and executed: **Claude probes the real
apps** (not the owner; there is no LLM in the product) and maps **real** UIA
signatures. Landed on `master`:

- **7 real App Vocabularies** replacing the demo-fiction placeholders — Excel,
  Word, Outlook, Chrome, Edge (live UIA probe) + **ServiceNow** & **Salesforce**
  (probed from the owner's live PDI / Developer-Edition). Three signature
  strategies emerged: **idMso** (Office), **stable DOM ids** (ServiceNow),
  **label-based** (Salesforce Lightning — aids are volatile). Method:
  [../REAL-VALUE-TESTING.md](../REAL-VALUE-TESTING.md).
- **4 process templates** (`normalization/process_templates/`) — create/resolve
  incident, create account, send email, mail-merge — validated through `canonical_match`.
- **Excel proven end-to-end** through the real C# recorder (it emits the probed
  ids; the vocab enriches them). Lookups + golden + fuzzers all green.
- **§11b root-caused** — the over-segmentation is `step_split_on_element` (64→15
  steps when off); flip gated on real-corpus + UI validation
  ([SEGMENTATION-CALIBRATION-FINDINGS.md](SEGMENTATION-CALIBRATION-FINDINGS.md)).

**Next (owner-gated):** **[SUPERSEDED → [ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md)]** — the §11b "flip" is replaced by a view-time grain roll-up (see §0.8/§0.10); build that out against a real recorder-driven corpus +
viewer/analysis validation; cover **SAP / Jira / Zendesk** (need driving) per
[APP-COVERAGE-LIST.md](APP-COVERAGE-LIST.md); decide whether to make the demo real
(regenerate `example-aggregate` with probed ids so it re-enriches under the real vocabs).

---

## 0.6 §11e recorder desktop-coverage hardening — 2026-05-30

The autonomous, in-repo-gated surface of roadmap **§11e** landed on `master`
(branch `session-11e-recorder-hardening`, fast-forwarded; 5 commits). The C#
recorder now reports **per-element capture quality** so the moat degrades
*honestly* instead of silently thinning on hard frameworks
([ADR-0023](../adr/0023-recorder-capture-confidence.md)). Every interaction gains
additive, analyst-facing signal fields (the `coverage_hint` precedent: emit →
`events.js` allowlist → SCHEMA → `inspect-events.js`, **not** consumed by the
pipeline):

- **Framework detection** (`framework`) — normalized toolkit
  (win32/winforms/wpf/winui/chromium/java/javafx/qt/remote/terminal/unknown),
  re-derived from `framework_id` **+** window class so toolkits that misreport
  their `framework_id` (Java/Qt → `Win32`; Citrix/RDP wrap a session) are caught
  by their platform-stable window class. Distinct from recognition's web-app axis.
- **Identity ladder** (`identity_source`: automation_id→name→class_name→ocr→none)
  + **per-element confidence** (`confidence` ∈ [0,1], capped at 0.30 on
  remote/terminal).
- **Value recovery** (`value_source: "text_pattern"`) — generalizes the AG-Grid
  fix via `TextPattern` (the managed UIA API has no `LegacyIAccessiblePattern`).
- **OCR last resort** (`ocr_text`, default-off `interactions.ocr`) via
  **Windows.Media.Ocr** (Win10+ system API, not Tesseract). Recorder TFM bumped to
  `net8.0-windows10.0.19041.0`; single-file publish + `ready` startup verified.
- **Deployment rules** ([DEPLOY.md](../DEPLOY.md)) — run the recorder *inside* a
  Citrix/RDP session; lean on the local video backstop where structured capture
  can't reach.

All fields additive → **pipeline/golden unaffected** (golden 8/8 OK; sess-0514
still 64 steps — **§11b NOT flipped**, still owner-gated). Pinned by
`Recorder.Tests` (56, incl. a headless OCR-engine round-trip) + `events.test.js`.

**Deferred (owner / needs apps):** live validation against real
Java/Qt/Citrix/terminal apps — does detection fire, does the OCR label help (the
§11a real-data step). The `remote` signature set is deliberately small (high-
confidence class names only); broaden against a live Citrix/RDP session. The
confidence rung scores + the 0.30 cap ship intuition-calibrated; tune against a
real corpus (§11b). **Remaining autonomous tech-debt:** the god-file splits
(`viewer/views/flow-view.js` ~3,800 L; further `normalize.py` decomposition) —
**done in §0.7**.

---

## 0.7 God-file splits — 2026-05-30 (latest)

The remaining autonomous tech-debt from §0.6 landed on `master` in two passes
(branches `session-godfile-splits` then `session-godfile-splits-2`, both
fast-forwarded). Pure, **behaviour-preserving** refactors — no feature or output
change — done behind the session-golden + the Flow-view Playwright harness so the
recurring "shipped un-eyeballed UI" failure could not recur.

- **`flow-view.js` 3,811 → 1,854 L**, decomposed into five cohesive CommonJS
  sibling modules (no bundler; each a plain `module.exports`): **`flow-view-apps.js`**
  (per-app colour/label/legend, pure), **`flow-view-video.js`** (the video↔timeline
  bridge — playhead, seek, watch-step, re-sync), **`flow-view-screenshots.js`**
  (grid + gallery + star + openScreenshot), **`flow-view-markers.js`** (marker-edit
  resolution, the markers list, suggested markers + anchor candidates, per-marker
  edits), and **`flow-view-timeline.js`** (the `renderTimeline` lane stack + its
  lane helpers + the minimap + lane toggles + zoom/scroll persistence + the
  timeline summary). flow-view stays the hub: it re-exports the helpers' entry
  points so its public surface is unchanged for `renderer.js`/`steps-view.js`/
  `analysis-view.js`, and injects the glue each helper needs back from the hub
  (`initVideo`/`initMarkers`/`initTimeline`) so the graph stays acyclic (helpers
  `require()` only one-way: screenshots→video, markers→video,
  timeline→apps/video/markers/screenshots). What stays in flow-view: session
  load/analyze, range selection + the marker-INSERT/queue actions, the event
  table, case scope, session pills/summary, the command-palette provider.
- **`normalize.py` 1,192 → 253 L** (a thin orchestrator), continuing F4 into five
  focused modules: **`session_io.py`** (load/write + screenshot aHash),
  **`marker_edits.py`** (`apply_marker_edits` replay), **`phase_reconcile.py`**
  (`_merge_phases` / `reconcile_phase_membership` / `_compute_drift_markers`),
  **`pipeline_config.py`** (the step denylist / excluded ranges / F3 calibration
  surface), and **`pipeline_stages.py`** (the ten `_run_*` stage helpers +
  `_init_existing_anno`). normalize.py **re-imports the names** that `normalize.X`
  / `from normalize import X` and the tests still reference, so they resolve
  unchanged; the now-orphaned pipeline imports were trimmed so the orchestrator is
  clean.
- **Gates green at every commit (11 total):** viewer npm test 231/231, capture 81,
  pytest 314·passed/10·skipped (incl. the seeded fuzzers), golden **10/10 OK —
  sess-0514 still 64 steps** (this was a refactor, **NOT** the §11b flip), and the
  Flow-view harness probe **byte-identical** across every extraction (timeline
  lanes/legend/minimap, screenshot grid + gallery open→step→close, seek→playhead,
  the injected suggested-marker bar/row + anchor panel) with **0 page errors**.

**Remaining (next, both deferred — not blocking):** the `flow-view.js`
session-load + session-summary clusters could split further, but the file is now
a reasonable orchestrator; and a per-session-summary module would add injection
for little gain. No further god-file remains.

---

## 0.8 §11b real ground-truth corpus — 2026-05-30 (latest)

The §11b calibration's real-data half landed on `master` (branch
`session-11b-real-corpus`, fast-forwarded). The over-segmentation finding —
previously **synthetic-only** (the demo's 64→15) — is now **corpus-backed**:
the real C# recorder was driven against three installed desktop apps and the
captures committed under [`corpus/`](../../corpus/README.md).

- **Real captures + measurement.** Out-of-repo harness `_pdt_verify/real-corpus/`
  (`build-corpus.js` + `uia-lib.ps1` + `drive-{excel,outlook,word}.ps1` +
  `measure.js`) spawns the real recorder (non-verbose), drives the apps via COM
  (launch) + UIA (`InvokePattern`/`ValuePattern`), brackets cases with **real
  markers** synced off stdout sentinels, filters to in-case target-app
  interactions, and re-normalizes under both calibrations via the F3
  `annotations['calibration']` override.
- **Result — over-seg reproduces on real data; candidate fixes it:** Outlook
  compose **9→3** (1 step/field → 1 step/draft), Excel data-prep **8→3**, Word
  Mailings **8→4**. Same direction/magnitude as the synthetic 64→15. Committed as
  `corpus/narrow/over-segmentation-outlook-compose` +
  `corpus/bounded/over-segmentation-{excel-dataprep,word-ribbon}` (each with
  `events.jsonl`, a calibration-aware `expected.json`, a bug-class README, and the
  `script.ps1` driver). Evidence table + mechanism:
  [SEGMENTATION-CALIBRATION-FINDINGS.md](SEGMENTATION-CALIBRATION-FINDINGS.md).
- **Mechanism confirmed:** in the production (non-verbose) stream
  `focus_changed`/`text_changed` are verbose-gated (`UiaSubscriber.cs:147`), so
  multi-field/cell entry arrives as bare consecutive `value_changed` and the
  element-split fires on every boundary — *not* a synthetic artifact.
- **§11d deferred Outlook e2e proof: DONE.** The recorder emits the probed
  compose ids (To `4117` / Cc `4126` / Subject `4101`); `outlook.yaml` enriched
  them (9 vocab matches, and the step names are the vocab's). Excel `FileSave` too.
- **Recorder fix:** the 187 MB single-file recorder self-extracts ~180 MB to
  `%TEMP%`; on the dev box's space-constrained C: it captured **0 events**. Fixed
  by pointing `DOTNET_BUNDLE_EXTRACT_BASE_DIR` (+ `TEMP`/`TMP`) at D:.
- **§11e coverage finding (Word):** mail-merge ribbon items reject `InvokePattern`
  and document text is `text_changed` (verbose-gated) → the business mail-merge
  steps are invisible to the production stream (logged in that scenario's README).

**Reframed by owner review → [ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md) (Proposed).**
The corpus evidence stands, but the decision is no longer "flip the global
default." Owner review established that flipping is destructive (it deletes the
fine grain from `anno.steps`; the map's Step level reads them) and one-grain-fits-
all, and that **ROI is grain-invariant** (`analysis_roi.py` is time-based — total
hours/yr is unchanged whether a process is 2 steps or 75). So grain becomes a
**view-time roll-up over the UI-containment hierarchy** (element ⊂ screen ⊂ app ⊂
phase ⊂ case), driven by the level slider; `step_split_on_element` is demoted to
the slider's default notch (default = screen). ADR-0024 is drafted Proposed for
the owner to build out in a later session. Golden deliberately still pins
sess-0514 at **64 steps** (nothing flipped); `master` is local-only (not pushed).
**Deferred:** build out ADR-0024; web/SaaS drives; the Word §11e capture gap.

---

## 0.9 §11d Jira + Zendesk live-probed + ServiceNow refresh — 2026-05-31

Real vocabs, **live-probed then doc-grounded** — the right order this time
(structure from the probe, *function* from the docs), not the doc-guessing the
reverted `d8ddd3c` did. Drove the owner's authenticated Chrome via a
held-connection UIA harvester (`_pdt_verify/probe_web_window.ps1`, out-of-repo)
that wakes Chrome's renderer a11y by polling, then cross-checked every control
against the vendor docs. Landed on `master`:

- **Jira** (`app_vocabularies/jira.yaml`, ServiceNow-like stable aids) — create-issue
  GIC, issue detail (stable `issue.fields.status-view.status-button` transition),
  list, global nav; + `jira-create-issue` template. The probe corrected real guess
  errors (Priority's accessible name is the useless "Select Field" → key on aid;
  project/type picker aids carry volatile React suffixes → key on name).
- **Zendesk** (`zendesk.yaml`, Salesforce-like — every aid volatile, *proven* by
  re-probe renumbering → name-keyed) — ticket (new + open), views, search,
  customers, organizations, add-user/add-org modals, profile/voice menus; +
  `zendesk-create-ticket`. Doc-grounded: no Status field (status = the Submit-as-X
  action); Public reply = to requester; macro = prepared action.
- **ServiceNow `servicenow.yaml` → v2** — incident preserved + refreshed (priority
  [read-only/derived], number, lookups, watch-list) + **Change Request**
  (`change_request.*`) + **Catalog** item order (`oi_order_now_button`/`quantity`)
  & **REQ** record (`sc_request.*`) + a **generic platform layer** (record verbs,
  list/nav actions); + `servicenow-change-request` and `servicenow-catalog-request`
  templates. Doc-grounded (Impact×Urgency = Priority read-only; change
  Standard/Normal/Emergency; Order Now → REQ/RITM). Scope caveat documented: the
  catalog browse page titles itself "Catalog", outside `.*ServiceNow.*`.

Gates: lookups + `load_vocabularies` + `load_canonical` + canonical-match on
synthetic streams green; scope-isolated (inert on the order-to-cash demo); **golden
10/10 byte-for-byte**. Probe harness + per-app harvests live out-of-repo in
`_pdt_verify/`. **Remaining gaps:** SAP (Tier B, not driven this cycle); catalog
item *variables* (per-item dynamic, intentionally not vocab'd).

---

## 0.10 Cross-chip sanity sweep — 2026-05-30

Reconciliation after ~5 concurrent chips + 2 new design ADRs (the sweep ADR-0025 asked for).
**`master` re-verified green end-to-end** (independently run, not self-reported): pytest **314
pass / 10 skip** · golden **10/10** sessions OK · viewer **231** · capture **81** · recorder
**56** · e2e smoke **9/9**. All 27 commits since the Wave-1 merge (`73cc021`) are sound; the
`events.jsonl` immutability invariant and every golden held.

**Reconciled (concurrent chips couldn't see each other):**
- **§11b "flip the default" is SUPERSEDED by [ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md)**
  (grain becomes a *view-time roll-up*, not a destructive global flip). §0.8 already captured it;
  §0.5 and `SEGMENTATION-CALIBRATION-FINDINGS.md` (both predate the ADR) now carry the supersession
  pointer. Corpus evidence stands as roll-up fixtures; the flip is off the table. **ADR-0024 is
  Proposed, not built.**
- **ADR numbering (updated 2026-05-31):** the Wave-0 architecture-review proposals (e2e gate, Node
  egress guard, pluggable backend, calibration config) shipped as direct commits + the Fit Analysis,
  never as standalone ADRs — so 0018 jumped to 0023. **0019 was since reused** for
  [ADR-0019 Reference Maps](../adr/0019-reference-maps.md) (the editable-BPMN / To-Be feature,
  Accepted 2026-05-31); **0020–0022 remain unused.** 0023/0024/0025 are unique.

**In flight — NOT committed by this sweep:** the live Jira/Zendesk vocab cycle (§0.9) has untracked
working-tree files (`app_vocabularies/{jira,zendesk}.yaml`, `process_templates/{jira-create-issue,
zendesk-create-ticket}.yaml`, `docs/To-Do/JIRA-ZENDESK-PROBE-CHEATSHEET.md`) — they belong to the
running session and were left untouched.

**The two new ADRs are the next big build chunks — specs, not builds, both owner-gated on one
decision before coding:** ADR-0024 (lock the default grain notch + whether analysis itemisation
follows the slider) and ADR-0025 / [SELF-SERVICE-VOCAB-DISCOVERY-SPEC](SELF-SERVICE-VOCAB-DISCOVERY-SPEC.md)
(trigger placement: viewer App Library vs capture tray).

---

## 0.11 ADR-0024 grain roll-up built — 2026-05-31 (latest)

[ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md) is **built and
accepted** (P1–P4), on a branch off master. Step grain is now a **view-time**
roll-up over the containment ladder `element ⊂ screen ⊂ app ⊂ phase ⊂ case`,
driven by a single **Grain** slider in the Session view-mode bar (default
notch = **screen**). Segmentation still happens once at the finest grain; the
slider only changes the *view*, with zero data mutation (raw `events.jsonl`
untouched, sliding back restores the detail). What landed:

- **P1** `step.grain_keys = {element, screen, app}` stamped at analyze time
  (`step_suggest.step_grain_keys`); additive, goldens unchanged. SCHEMA updated.
- **P2** `process-map-levels.rollUpSteps` + `buildAnnotationDfg` generalised to
  the notch ladder; `resolveStepGrainKeys` view-time fallback. 11 unit tests.
- **P3** the shared Grain slider (`State.grain`), Steps-list roll-up rows, Map
  DFG/level synced to the notch, BPMN→Flow fallback for screen/app/case.
- **P4** €-ROI total proven notch-invariant (it's a view control; ROI is
  Python-computed from event-stream segments). e2e + `analysis_roi` tests.

Acceptance reproduced in the real viewer: `element` notch = fine counts (Outlook
9, Excel 8, demo 64); `screen` = 3 / 4 / 19; demo coarse end ~15 at `app`; €-ROI
total unchanged across notches; `e2e/session-smoke.js` 12/12 green.

**Follow-ups — DONE 2026-05-31 (P6, same branch):**
- ✅ **Compare-Sessions grain.** The Aggregate/Compare map's level select is the
  Grain ladder (element/screen/app/phase/case + Activity), synced to `State.grain`,
  BPMN→Flow fallback for screen/app/case.
- ✅ **Analysis time-study / waste-by-step follow the notch.** Both re-itemise by
  the current notch at view time (coarse notches read-only, since the
  business-required override is `process_label`-scoped); the €-ROI headline total
  stays invariant. e2e pins a "Waste by screen" section at the screen notch.
- ✅ **Flow timeline step-lane roll-up.** The step lane shows the roll-up at the
  notch (one band per consecutive run, with a fold count); `element` keeps every
  raw step band. So the single Grain control now drives Flow / Steps / Map /
  Analysis and Compare alike.

**Real-app validation + map regression FIX — DONE 2026-05-31** (branch
`real-app-map-validation`; full report:
[REAL-APP-MAP-VALIDATION-2026-05-31.md](REAL-APP-MAP-VALIDATION-2026-05-31.md)):
- ✅ **Headline map regression confirmed + fixed.** The default (screen) grain
  fanned out into a per-case hairball because the screen key fell back to the raw
  `window_title`, which embeds the case value (`Salesforce - Order #10900`,
  `Create INC0010010 | Incident`). New `process-map-levels.screenType` makes the
  screen axis **value-free** (strips record numbers / id-tokens) at view time —
  demo aggregate screen map **76 → 6 nodes, 35 → 1 end-node**. Committed `a64d0d4`;
  new `e2e` map-connectivity pin (screen-grain DFG = one component, one start, one
  end). Gates all green.
- ✅ **Web/SaaS `screen` validated on a LIVE capture.** Drove a real ServiceNow
  dev instance (`drive-servicenow.ps1`, 3 real incidents) — vocab matched the live
  form exactly (53 % coverage); the screen-axis fix collapsed the per-case
  `Create INC001001x | Incident` titles to one node. Excel (good) + Word (partial,
  §11e gap) desktop captures too; Outlook skipped (no mail profile on the box).

**Deeper issues the real capture surfaced — now resolved (see report §6):**
- **6a — element-grain window-title-PREFIX fan-out — ✅ DONE (`61ccce3`).**
  `step_suggest._short_app` strips embedded record tokens from the window-title
  prefix via a value-free `screen_label`, sharing rules with the viewer's
  `screenType` through the new `shared/screen-label-patterns.json` (single source).
  Real ServiceNow element grain 44 → 18 nodes, 3 → 1 sink. Golden-neutral.
- **Phase-level BPMN — ✅ validated working (no code fix).** Mines correctly when
  phases exist (validated on a throwaway phased copy → clean linear chain in the
  viewer); the demo's empty-state is correct because no committed session has
  phases. Upstream item is acquiring phases (analyst authoring / future
  auto-phase), not the miner.
- **6b — vocab-vs-window_title screen duplication — ✅ DONE (`1e9b843`).**
  `app_vocab.enrich_events` now tags every in-scope interaction with the screen whose
  `window_title_regex` matches (`_screen_by_window`), independent of a control match
  (a screen tag only — does not inflate match-rate). Real ServiceNow: 7 window-title
  screen variants → 1 `incident` node. Golden-neutral; new `test_app_vocab` test.
- **Outlook capture — ✅ FIXED** (`drive-outlook.ps1`, out-of-repo): the earlier
  "no mail profile" call was wrong — a cold COM launch needs `Namespace.Logon()`
  before `CreateItem`, and the per-case inspector churn was reused into one
  inspector. Now 100 % vocab coverage, value-free `compose` screen.

---

## 1. Where we are

Last release **v0.18.0** (2026-05-28) — adds the in-view Session-view Map level
as a 5th entry in the level switcher (Flow / Steps / Phases / **Map** /
Analysis), retiring the v0.17.0 "View map" one-click into Compare-Sessions. The
interactive process-map UI is now a reusable controller (`viewer/map-controller.js`)
shared by both surfaces; aggregate-view.js shrunk by 208 lines, no regression in
Compare-Sessions. Also a build-pipeline hardening pass (`preflight.ps1` gates
CHANGELOG header integrity + lockfile sync; `build-distribution.ps1` retries
electron-packager on the Defender / Search-indexer temp-dir race).

Landed on `master` since v0.18.0 — Phase 0 of the ML Integration Recommendation,
shipped as two complementary chips:

- **Suggested markers** ([ADR-0017](../adr/0017-suggested-markers.md), commit
  `5ec6d54`). A hand-rolled change-point detector
  (`normalization/marker_suggest.py`) surfaces candidate Start/End boundaries
  for unbracketed sessions as dashed markers in the Flow timeline; Accept
  promotes into the existing `marker_edits[]` op:insert path; Dismiss writes
  to `marker_suggestions_dismissed[]`. Item #2 of the recommendation.
- **Anchor candidates** ([ADR-0018](../adr/0018-anchor-candidates.md),
  uncommitted at the time of writing). A pattern-mining detector
  (`normalization/anchor_suggest.py`) ranks fields that look like case
  anchors (a customer-ID search box, a serial-number entry) and surfaces them
  above the Markers list; Accept writes a session-level
  `case_anchor_override` that `normalize.py` consults before falling back to
  marker mode. Item #5 of the recommendation; closes Phase 0.

Both detectors are non-ML, zero new pip deps, regenerated wholesale each
normalize, and idempotent across re-runs via stable 12-char signatures. Total
test coverage added: 36 deterministic scenarios + 10 fuzzer regimes
(~19k randomized inputs).

v0.17.0 (same cycle) closed the **productization cycle** — PDD restructured to
a standard RPA Process Definition Document with an embedded process map,
segment-level automation candidacy
([ADR-0016](../adr/0016-segment-level-automation-candidacy.md)), the
Compare-Sessions Analysis panel + single-session Waste-by-step decluttered,
capture tray IA split by lifetime (Settings / Profile / Session setup), ~5 s
session-start freeze gone, Chromium web-content reaches the recorder out of the
box, seeded fuzzers + parse_ts consolidation + a process_label Python↔JS golden
pin the normalization pipeline. v0.17.1 was the same-day doc catch-up.

Direction: **productization toward a small internal rollout, analyst-deliverable
first**; bar = "as polished as it can be." Internal-rollout phase begins now.

**Update (2026-05-29):** now at **v0.19.0**. This session landed the fix-first review queue
(security + correctness + capture-durability fixes), the **Electron 33→42** bump + the
`dagre`→`@dagrejs/dagre` fork swap (0 npm-audit advisories), and the Session-view process-map
**overlay fix** — all verified in the harness. It also produced the consolidated review register
([CONSOLIDATED-REVIEW-2026-05.md](CONSOLIDATED-REVIEW-2026-05.md)) and the strategic→engineering
roadmap reconciliation (the Master Assessment + Fit Analysis). **The engineering roadmap is now
the Wave 0 plan in §2.**

---

## 2. Plan of record — Wave 0 (the foundation)

The Fit Analysis establishes that the strategic roadmap (§11 workstreams) is mostly *additive*
and fits the architecture — but funnels through a shared **Wave 0 foundation** that must land
first. Wave 0 is the next work. Aggregate ≈ **12–22 focused days** (Fit §9). Items are roughly
parallel; the only hard ordering is **F2 before F4** (the golden must exist to verify the
`normalize()` refactor is non-destructive).

1. **F2 — session-level golden gate.** Re-normalize the committed `example-aggregate` sessions →
   diff a lightweight *projection* (`stats.json.meta` scalars + per-case step labels / markers /
   anchor) against a committed golden. Runs on pre-recorded `events.jsonl` — **no recorder or
   Electron in CI**. The keystone that protects every later change. *(In progress — being built
   this session.)*
2. **F1 — in-repo e2e gate.** Move the assertable subset of `_pdt_verify/` into a top-level
   `e2e/`, convert eyeball drivers to `assert` + exit codes, drop `ELECTRON_SKIP_BINARY_DOWNLOAD`
   for that job, wire into CI. **Supersedes §0's out-of-repo harness note** once it lands.
3. **F4 + F3 — decompose `normalize()` + calibration config surface.** Split the ~509-line
   orchestrator into named stages; thread a `calibration` block through the two
   `auto_suggest_steps` call sites (`normalize.py:553`, `:586`) + `coalesce`. F3 unblocks §11b
   (the segmentation knobs are currently unreachable). Do **F2 first** so the golden verifies the
   refactor. F4 is debt-paydown, not strictly blocking — but don't defer it past Wave 1.
4. **§11c — €-ROI layer.** New `analysis_roi.py` (slots into `analysis.run_analysis`) +
   session-level `roi_inputs` annotation key + `_write_roi()` PDD section + viewer panel. The
   commercial closer (the Discovery-Sprint deliverable); **no §11a dependency — can run in
   parallel now** on existing analysis output (`estimated_savings_ms` is currently `None`).
5. **6b — Node-side egress guard.** `no-restricted-imports` on `http`/`https`/`net` in the
   Electron main processes + a single allowlist seam (today: localhost OBS only). Half a day;
   makes the air-gap moat provable on the Node side too (the renderer is already CSP-locked).
6. **Self-sign binaries. — ✅ SCAFFOLDED, then RETIRED by [ADR-0026](../adr/0026-distribution-unsigned-and-services-boutique-scope.md).**
   The `-CertThumbprint` + `signtool sign` scaffolding landed in `build-distribution.ps1`, but
   signing under the *company* cert is **declined** (PDT is owner IP). Releases ship **unsigned by
   design**; the scaffolding stays ready for a future owner-held cert. Not remaining work.
7. **`Recorder.Tests.csproj`.** xUnit on .NET 8; 3 seed tests (`BuildEvent` field set,
   keystroke-coalescing boundary, marker/system-event flush bypass). **Hard prerequisite for
   §11e**; the bus-factor mitigation for the zero-test crown jewel. (dotnet 10 SDK confirmed on
   the dev box.)

After Wave 0: **Wave 1** (§11a real-data harness, §11b calibration, §11d bootstrap vocabs), then
**Wave 2** (§11e coverage hardening, §11f borrows, §13/6a pluggable backend). Full sequencing +
effort in [Fit Analysis §7/§9](PDT-ROADMAP-CODEBASE-FIT.md).

### Wave 1 — landed (2026-05-30, branch `wave1-overnight`)

An autonomous overnight pass shipped the verifiable Wave-1 surface as six
per-phase commits (all gates green: pytest 314 / golden 10·OK / viewer 231 /
capture 78 / dotnet 12 / e2e 9·9; each UI/behaviour change real-run verified):

1. **§11c €-ROI viewer panel** — `analysis-view.js` renders `analysis.json`'s
   `roi` band (hours/yr → € net/yr once a rate is set), expected-band totals, and
   a band-encoding legend; an **Edit assumptions…** form + per-row **tune** form
   write `roi_inputs` through the undo path and trigger a re-analyze. Real-run:
   edit → persist → re-analyze → € updates; Ctrl+Z reverts.
2. **§11f automation-candidate ranking** — `score_automation` scores by
   `instance_count × mean × automatable_fraction` (roi_inputs-aware), stamps
   `rank`/`rank_score`; surfaced in the viewer table + PDD §4.3.
3. **§11f structural PII masking** — new `pii_masking.py` stage redacts sensitive
   field values in the **derived** stream only (raw `events.jsonl` untouched) with
   a join-preserving `«category#hash»` token; `pii_masking` report + analyst
   `pii_masking_config`. Pinned by a seeded fuzzer; end-to-end no-leak proven.
4. **§11f capture consent gate** — `consent-window.js` + `consent.js` +
   `manifest.consent`; `config.consent.mode` = off (default) / per_session / once;
   declining aborts the start. Real-run verified the window + IPC decision.
5. **§11d pre-built App Vocabularies** — curated `salesforce/sap-gui/excel/outlook/
   chrome` vocabs (+README) bootstrapped from the demo; the predicted-vs-actual
   diff drove a **case-insensitive `scope.process_name`** fix; demo now enriches
   at 100% per app. Golden regenerated (intentional).
6. **§11a golden corpus** — widened to all 10 `example-aggregate` sessions +
   `corpus/README.md` tier roadmap. Still no recorder/Electron in CI.

**Wave-1 remaining (next):** §11b segmentation/alignment calibration (gated on
real captures — owner), §11f cross-recording trace-merge (depends on §11b),
§11d LLM-augmented labeling (owner hosting decision). See §3.

**Handoffs / owner decisions surfaced this pass:**
- **Consent default policy** — the gate ships `mode: "off"` (no behaviour change).
  Whether the internal rollout wants `per_session` or `once` by default is an
  owner/compliance decision; flip `config.consent.mode` to enable.
- **PII rule-set calibration** — the default categories (password/SSN/card/cvv/
  pin/secret/iban/routing/account) and the redaction-vs-hash choice ship sane,
  but the *right* set for the rollout's apps is owner-side; tune via
  `pii_masking_config.custom_rules`. Bump `ruleset_version` on a breaking change.
- **App-vocab tenant tuning** — the shipped vocabs are demo-derived starters; real
  Salesforce/SAP automation_ids differ. Retune against the first real captures
  (this is the §11d/§11a real-data step, owner-gated).
- **§11b not attempted** — fuzzing ≠ calibration; needs representative real
  captures. The demo `calibration` default was left as-is (golden + step counts
  give no justification to change it provisionally).

**Still-minor follow-ups** (pre-existing, low priority, not Wave 0):
- CHANGELOG header-integrity pre-commit hook (build-time gate via `preflight.ps1` already
  suffices).
- MAX_PATH PM4Py path-shaving in `viewer/python/` (DEPLOY.md carries the user-facing mitigation).

---

## 3. Owner-blocked / calibration (cannot be done headless)

- **Calibration on real captures** — `process_label` value-stripping, the
  rare-path cutoff, the fuzzy "same step" thresholds. Needs more representative
  real captures (owner-side). Fuzzing proves robustness, NOT calibration.
- **Marker-suggestion thresholds on real captures (ADR-0017).** The detector's
  signal weights (`0.5 / 0.5 / 0.6 / 0.2`), the `0.5` score threshold, the
  `40%` home-app share, the `20%` cluster edge fraction, and the
  `min_case_interactions=5` floor ship calibrated against the seeded fuzzer
  and the bundled demo. Whether they produce the right number of suggestions
  per hour on real Salesforce / Excel / Outlook captures is owner-side. Bumping
  `heuristic_version` on `marker_suggest.py` is the contract for breaking
  recalibrations — it invalidates the prior dismiss-set.
- **Anchor-candidate scoring weights on real captures (ADR-0018).** The
  four-signal blend (coverage 0.40 / balance 0.30 / diversity 0.20 /
  focus 0.10), the `_MIN_FIRES=2` / `_MIN_CASES=2` floors, and the top-5
  cap ship calibrated against the seeded fuzzer and the unbracketed
  fixture (where `customer-id-field` ranks first at 0.935). Whether this
  ranking surfaces the right field FIRST on real captures with 30+
  candidate fields is owner-side. Same `heuristic_version` posture as
  ADR-0017.
- **Released-`.exe` smoke** on the locked-down work laptop: the packaged app's
  recognition-JSON load + the recorder's single-monitor screenshot occlusion.
- **PDD "living projection"** — **out of scope ([ADR-0026](../adr/0026-distribution-unsigned-and-services-boutique-scope.md))**; never concretely defined, dropped (not "needs a definition").

---

## 4. Environment & conventions

- **Two machines:** dev box (node / python / git / .NET) vs. the locked-down work
  laptop (released `.exe` only — never suggest installs there).
- **Company captures stay local.** Use `scripts/inspect-events.js` /
  `scripts/count-cases.js`; never read a real `events.jsonl` into the assistant.
- **Validate via the packaged app *and* the §0 harness**, not just green tests —
  UI bugs are invisible to the unit suites.
- **Commit style:** imperative subject; **no Co-Authored-By trailer**; quote-safe
  body. Branch `master`; `gh` authed as `Atjeto`. For `.ps1`, scope-set
  `RemoteSigned`, not `-ExecutionPolicy Bypass`.
