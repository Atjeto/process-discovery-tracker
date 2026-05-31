# Changelog

All notable changes to the Process Discovery Tracker. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.22.0] - 2026-06-01

App Library "Discover from window" ([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md))
becomes legible and lossless. A real-run discovery of a browser-hosted web app
(Spotify in Chrome) surfaced that the editor was silently *erasing* the one kind
of signature such apps produce, and that a discovered row carried no context to
name it by. Both fixed; discovery now enriches each row with the context the UIA
walk already captured.

### Fixed

- **`class_name`-keyed signatures are no longer dropped on Save (data loss).** A
  control with no stable id and no accessible name is keyed by the picker on its
  `class_name` (ADR-0023 confidence 0.4). The App Library editor modelled only
  `control_type` / `automation_id` / `name` / `window_title_regex`, so a
  `{class_name: …}` signature rendered as a blank **"(unset signature)"** *and was
  rewritten to `{}` the moment you saved* — captured, shown blank, erased.
  `class_name` is now a first-class, editable signature field that survives the
  round-trip (`vocab-view.js`); `canonical-author.js::vocabSignatureKey` gained the
  `cn` branch Python's `_snapshot_sig_key` already had, so re-discovery dedups it
  instead of re-adding duplicates.
- **`PDT_APP_VOCABULARIES` was broken on Windows.** The viewer split the extra-dirs
  list on `/[;:]/`, shredding drive-letter paths (`D:\…`) at the colon. It now
  splits on `path.delimiter`, matching Python's `os.pathsep`.

### Added

- **Annotator context on every discovered row ([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md)).**
  Discovery captures far more than the signature keys on; the surplus used to be
  discarded at `bootstrap_from_snapshot`. Each entry now carries — as discovery-meta
  (shown in the editor, stripped on save, like `confidence` / `identity_source`) —
  the UIA **role**, the **framework**, a value-free on-screen **region** (a 3×3
  bucket from the control's bounds), the tree **ancestry**, and an honest
  **weak-signature note**. A row reads "button · bottom-left · chromium · under
  Window › Pane — weak, keyed on class_name" instead of a contextless blank.
- **Over-merge transparency.** A generic `class_name` with no label collapses
  genuinely *distinct* controls under one `seen_count` — a "×5" that hides five
  different buttons. The merged members are now kept and listed per row
  (`bootstrap_from_snapshot` `_members`), so the analyst can see what a weak bucket
  actually contains and split a wrong merge.
- **`e2e/vocab-smoke.js`** — a new in-repo gate that drives the REAL viewer App
  Library: asserts the enriched row renders legibly (no clipped labels) and that
  the `class_name` signature survives Save. Wired into the e2e `test` script
  alongside `session-smoke.js`.

## [0.21.0] - 2026-06-01

A coherence + capability cycle on top of 0.20.1: the process maps and Compare
panels became real drill-downs, the per-step flag model was corrected, and the App
Library gained delete + a point-and-click "Discover from window".

### Added

- **Delete an App Library vocabulary.** Each entry in the App Library list now has
  a delete (✕) affordance (reveals on row hover / when selected) with a confirm —
  the inverse of "+ New" / "Discover", which was missing. Analyzed sessions keep
  their results; only future analyses stop using the deleted vocab. Guarded
  (`viewer:deleteVocab`): refuses anything that isn't a `.yaml/.yml` inside a known
  App Library dir.

### Changed

- **"Discover from window" is now point-and-click ([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md)).**
  The old flow snapshotted the *foreground* window — but clicking the "Snapshot"
  button made the viewer itself the foreground, so it grabbed the wrong window (a
  misclick/misread trap). Now: **"Point to a window…" → the recorder enters standby
  → you click the target window → a confirmation shows which window you picked →
  only then is it snapshotted.** New recorder `pick` command (`WindowPicker.cs`,
  polls for the next click, resolves the top-level window under the cursor) +
  `pickWindow()` / `viewer:pickWindow`; discovery then snapshots that specific HWND
  (the recorder already accepted an HWND target). Esc or a 35s timeout cancels.

- **Compare-Sessions panels are now drill-downs, not just bars.** The Activity-
  frequency and Case-duration bars highlighted on hover but did nothing on click
  (a dead affordance). Now: clicking an **activity** filters the whole Compare
  surface to it (`#agg-filter`; inverse = clear the box); clicking a **case** opens
  its source session in the Session view and seeks the Flow timeline to where the
  case begins. The hover/cursor affordance is shown **only** on bars that are
  actually clickable (`renderBarChart` `onBarClick`), so non-interactive charts no
  longer advertise a click they can't honour.
- **Per-step flags reduced to `waste` ([ADR-0027](docs/adr/0027-retire-per-step-path-flags.md)).**
  The step detail dropped the `Conditional`, `Exception path`, and `Automation
  candidate` checkboxes — a single step is not a path or a segment, so those never
  had a coherent per-step meaning. The concepts are sourced where they belong:
  automation candidacy from coherent segments (ADR-0016), exceptions/variations
  from the observed trace variants, conditionality from the map's branch
  frequency. **`waste` stays** (a genuine per-step value-add judgment that feeds
  the efficiency analysis). PDD **§5 "Exceptions & variations" is re-sourced from
  `stats.trace_variants` + rework loops** instead of the retired flags. Legacy
  `annotations.json` keys are ignored, not migrated; golden-neutral.

### Removed

- **Activity/Case panel sparklines.** The tiny 10-bucket time-distribution
  histograms next to each bar carried no actionable insight (just decoration) and
  had no legend — removed.

## [0.20.1] - 2026-05-31

A UI-polish + accessibility patch on top of 0.20.0 — no new capability.

### Changed

- **UI density pass (viewer + capture).** Reduced always-on chrome without
  removing any capability: the viewer merges the session facts into the actions
  bar (one row, was two), relocates the mined-BPMN status into the Map panel
  header, compacts the VOCABS pill (full app list → tooltip), tucks the
  destructive Hide/Delete step actions behind a `⋯` overflow (Split/Merge stay
  visible), groups the Compare export menu, and makes per-view help dismissible.
  Capture consolidates the tray's parallel Quick-start submenus into one carrying
  a "Nest under current" checkbox, and caps the operator-panel saved-label
  quick-pick height (scrolls) so a long list can't push the live controls off.

### Fixed

- **Capture dialogs pin their action footer.** Profile and Session-setup now
  scroll their content inside a `.scroll` region with the hint + **Save/Cancel**
  footer pinned (consistent with Settings) — the action buttons are always visible
  without scrolling, even on a short window.
- **Muted-label contrast now clears WCAG AA**, per the design system's own
  ≥4.5:1 intent. The viewer light-theme `--fg-3` (muted labels) was **3.03:1** on
  `--bg` — below AA for small text; darkened `#9a8e7e → #786c5a` (≈4.84:1, still a
  warm taupe). The capture windows' `--fg-3` was a no-margin **4.5:1**; nudged
  `#807E78 → #8E8C82` (≈5.4:1). Dark themes already passed and are unchanged.

### Docs

- A concrete in-repo recipe for launching/driving the viewer for UI validation
  (the `e2e/` harness, no out-of-repo deps) + the DOM-handle map, in
  CHIP-GUARDRAILS.md — so a fresh chipped session can validate UI without
  rediscovering how.

## [0.20.0] - 2026-05-31

The big push toward a small internal rollout — a deliverable-first cycle that
hardened the foundation, landed the commercial closer, and made the recorder and
vocabularies real against probed apps. **Foundation (Wave 0):** an in-repo e2e
merge gate (the real viewer, asserts + exit codes), a session golden over all 10
demo sessions, a calibration config surface, the `normalize()` and `flow-view.js`
god-file splits, a Node-side egress guard, the first `Recorder.Tests` C# suite,
and an ADR-registry CI guard ([CHIP-GUARDRAILS.md](docs/CHIP-GUARDRAILS.md)).
**Commercial closer:** the €-ROI layer (`analysis_roi.py` → Session Analysis panel
+ PDD §4.4) projects each automation candidate into a conservative/expected/
optimistic savings band, with candidates ranked by priority. **Real capture &
vocab:** recorder capture-confidence ([ADR-0023](docs/adr/0023-recorder-capture-confidence.md)
— honest degradation on hard frameworks), probed App Vocabularies (Office /
ServiceNow / Salesforce / Jira / Zendesk) and point-and-learn discovery
([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md)). **Analyst surface:**
the view-time grain slider ([ADR-0024](docs/adr/0024-step-grain-as-view-time-rollup.md)),
Reference Maps ([ADR-0019](docs/adr/0019-reference-maps.md)), and the
map-readability fixes (value-free screen axis + dagre left-to-right, pinned by the
e2e connectivity check). **Privacy & platform:** structural PII masking + a capture
consent gate (§11f); Electron 33 → 42 and `dagre → @dagrejs/dagre` (0 npm-audit
advisories); click-to-RCE hardening on the screenshot-open path. Distribution stays
**unsigned by design**, and scope is fixed as a services boutique
([ADR-0026](docs/adr/0026-distribution-unsigned-and-services-boutique-scope.md)).

### Added

- **Reference Maps — decoupled, fully-editable BPMN copies of a mined map ([ADR-0019](docs/adr/0019-reference-maps.md)).**
  From the Process diagram, **⑂ Fork map** snapshots the current cell into a
  standalone `.bpmn` the analyst edits with the full bpmn-js palette — a **one-way
  leaf** the pipeline never re-mines, merges, or regenerates. Copies live in a
  per-session **Reference maps** gallery (`derived_maps/<map_id>.bpmn` + an
  `annotations.json reference_maps[]` row), are typed **As-Is / To-Be / Reference**,
  and carry visible provenance (forked-from cell + date, "hand-edited, not updated
  by analysis") with a **drift** chip + **Re-fork** when the source map later changes.
  A selected **To-Be** map embeds in the PDD's new **§4.5 Proposed to-be process**
  (captioned as analyst-authored, not mined); a selected **As-Is** copy can override
  the mined As-Is image. "What you see is what you fork" (the laid-out live view is
  snapshotted, not the raw mined file); the editor skips auto-layout to honour the
  hand-positioning. Every verb (fork / rename / kind / PDD-role / delete) is
  Ctrl+Z-able, and the copies survive re-analyze untouched. Reuses the vendored
  bpmn-js modeler (palette un-hidden off `.map-host`), the existing `saveXML`-to-path
  persistence, and the existing PDD image bridge (`exportSvg` → off-screen PNG raster
  → `--pdd-tobe-image`). See [SCHEMA](shared/SCHEMA.md) §`reference_maps`.
- **Step grain is a view-time roll-up — one grain slider across Flow / Steps / Map ([ADR-0024](docs/adr/0024-step-grain-as-view-time-rollup.md)).**
  Segmentation stays at the finest grain; how far steps consolidate is now a
  reversible **view** control, not a destructive normalize-time flip. A node/step
  at the chosen notch is a run of consecutive steps within a case sharing that
  notch's key, over the UI-containment ladder `element ⊂ screen ⊂ app ⊂ phase ⊂
  case`. Default resting notch = **screen** ("one step per screen"). Sliding back
  undoes it with zero data mutation; raw `events.jsonl` is untouched.
  - **P1 — containment keys on steps.** Every step now carries `grain_keys`
    (`{element, screen, app}`) resolved from its interactions at analyze time
    (`step_suggest.step_grain_keys`): `element` = the field typed into, `screen`
    = the vocab `screen_id` else `window_title`, `app` = `process_name`. The
    `phase` / `case` notches read the step's existing `phase_id` / `case_id`.
    Stamped on auto, canonical-matched, and preserved steps alike; a
    hand-authored step gets `(element/screen/app)` placeholders the viewer
    refines at view time. Additive — the golden projection is unchanged. See
    [SCHEMA](shared/SCHEMA.md).
  - **P2 — view-time roll-up engine.** `process-map-levels.rollUpSteps(steps,
    notch)` folds a session's steps into one group per run of consecutive
    (per-case) steps sharing the notch's key; `element` is identity (every step
    shown — the fine count is reproduced exactly), `screen`/`app`/`phase`/`case`
    consolidate. `buildAnnotationDfg` is generalised from "same `process_label`"
    to "same key at the chosen notch" (back-compatible: `step`/`phase` unchanged).
    A view-time `resolveStepGrainKeys` fallback derives the keys from events for
    sessions analyzed before `grain_keys` existed. No re-normalization on a notch
    change. Verified on real captures — the `element` notch reproduces the fine
    counts exactly (Outlook 9, Excel 8, demo 64) and `screen` consolidates
    sensibly (3, 4, 19); the demo's coarse end is ~15 at the `app` notch.
  - **P3 — one grain slider across Flow / Steps / Map.** A single **Grain**
    slider in the Session view-mode bar (notches element/screen/app/phase/case,
    default **screen**) sets a shared `State.grain`. The Steps list rolls up to
    the notch — one row per consecutive run, with a fold count, read-oriented
    (click a group to edit its first member; slide to `element` to edit every
    step). The Map's level selector is folded into the same ladder and synced
    with the slider (the old Activity level stays as a taxonomy escape hatch);
    the Flow diagram (DFG) rolls up live, and the Process diagram (BPMN) — mined
    only at the Element/Phase grains — falls back to the Flow diagram for
    screen/app/case rather than rendering a dead host. No re-normalization on a
    notch change; sliding back restores the detail. e2e (`session-smoke.js`)
    pins the slider, the element↔screen consolidation (demo 64↔19), and the
    €-ROI total holding invariant across notches.
  - **P4 — €-ROI total is provably notch-invariant.** The grain is a *view*
    control, so it never re-runs the pipeline: the €-ROI is computed once from
    event-stream segments (ADR-0016) and the slider can't move it. This is the
    load-bearing reason the roll-up is view-time rather than a normalize-time
    flip — re-segmenting *would* move the total (demo 0.01→0.02 h/yr), so grain
    must not re-segment. The step-grained itemisation (Steps, Map) follows the
    notch; the segment-grained ROI/automation list sits above the step grain and
    stays put, with the total invariant either way. New `analysis_roi` tests pin
    that the total is a pure, order-insensitive sum over candidates (re-itemising
    or re-ranking can't move it); the Analysis panel states the invariance.
  - **P6 — grain reaches every view (deferred follow-ups).** The
    **Compare-Sessions** map gains the same grain ladder (its level select →
    element/screen/app/phase/case + Activity, synced to `State.grain`, BPMN→Flow
    fallback for screen/app/case). The **Analysis** Time study + Waste-by-step
    re-itemise by the current notch at view time (the €-ROI headline total stays
    invariant), and the **Flow** timeline's step lane rolls up to the notch — so
    the single grain control drives Flow / Steps / Map / Analysis and Compare.

### Fixed

- **Process maps now lay out left-to-right instead of as a radial hub / scrambled
  diagram — `dagre` was never actually wired up.** Both renderers were written to
  re-lay-out with `dagre` (the comments say "dagre is a global loaded in
  index.html"), but it never was: `index.html` loaded `cytoscape-dagre` but not a
  `dagre` global, and nothing assigned `window.dagre`. So the **Flow diagram (DFG)**
  silently fell back to cytoscape's `breadthfirst` — a **radial hub** that turns
  any flow with a busy node (SAP) into an unreadable star — and the **Process
  diagram (BPMN)** `applyDagreLayout` returned early and rendered the mined file's
  weak coordinates (`end` stranded mid-flow, edges crossing). This affected *every*
  session, not the demo I'd been spot-checking. Fix: `dfg-viewer.js` requests the
  `dagre` layout whenever the (already-bundled) `cytoscape-dagre` extension is
  registered, and `bpmn-viewer.js` `require("@dagrejs/dagre")` directly. Result —
  Flow + Process diagrams render as clean left-to-right layered flows at every
  grain (screen/app DFG: radial star → LR chain; activity BPMN: `end` now rightmost).
  `e2e/session-smoke.js` gains a **layout-readability pin** (the screen-grain DFG
  must read left-to-right — source leftmost, sink rightmost, wider-than-tall —
  catching a silent fall back to the radial layout). NOTE: validated on the demo;
  the layout engine is topology-agnostic so it carries to taxonomy/real captures,
  but those should still be eyeballed.

- **Element-grain step maps no longer fan out per record because of a numbered
  window-title prefix ([ADR-0024](docs/adr/0024-step-grain-as-view-time-rollup.md) §6a).**
  A step's auto-name is `"{window-title app prefix}: {action}"`; for browser apps
  the window title carries the record id in the prefix (`Create INC0010010 |
  Incident | ServiceNow`), so the value-free `process_label` still differed per
  case and the element-grain map split into per-record combs. The window-title
  prefix (`step_suggest._short_app`) now passes through a value-free strip
  (`screen_label`) that removes embedded record numbers / id tokens — sharing the
  rules with the viewer's `screenType` via the new
  **`shared/screen-label-patterns.json`** (single source, no hand-synced regex;
  the id rule is uppercase-led so codes that ARE the name, e.g. SAP `va01`,
  survive). Real ServiceNow element grain: **44 → 18 nodes, 3 → 1 sink**. Golden-
  neutral (the demo window titles carry the app name before the first separator,
  so the strip is a no-op there — verified).

- **One logical screen is now one screen-grain node, even when the vocab only
  partially matches a form ([ADR-0024](docs/adr/0024-step-grain-as-view-time-rollup.md) §6b).**
  An App Vocabulary assigns a value-free `screen_id` (e.g. `incident`, `compose`)
  only to interactions whose *control* matched a vocab signature; an interaction
  on the same form whose control isn't in the vocab got no `screen_id` and fell
  back to the raw `window_title`. So a step with no vocab-matched control split off
  as a distinct per-case screen node (`incident` *and* `Create INC0010010 |
  Incident | ServiceNow`), and the screen-grain map showed a duplicate-screen
  loop. `app_vocab.enrich_events` now tags every in-scope interaction with the
  screen whose `window_title_regex` matches (`_screen_by_window`), independent of a
  control match — so one form is one screen. It is a *screen tag only*, not a name
  match, so it does **not** inflate the vocab match-rate / coverage. Verified on
  the real ServiceNow capture: 7 window-title screen variants → **1 `incident`
  node**. Golden-neutral (step naming uses the window-title app prefix, not
  `screen_id`); new `test_app_vocab` test.

- **Process diagram (BPMN) steps now lay out in execution order — a loop/redo
  gateway no longer scrambles the diagram.** The pure-Python BPMNDI layout
  (`mining._layout`) ranked nodes by longest-path over the *raw* edge set, so a
  single back-edge from an inductive-miner loop/redo gateway (e.g. `SAP: Create
  sales order → <upstream gateway>`) inflated the rank of everything past the
  loop. The mined step/phase **and activity** Process diagrams rendered with steps
  **out of execution order** (`Outlook: Send` left of `Outlook: Enter To`) and the
  end event **stranded mid-flow**. Ranking now runs over the **acyclic forward
  edge set** (`mining._forward_edges` strips DFS back-edges before ranking; the
  back-edges are still *drawn*, only the column assignment ignores them), so the
  linear spine stays ordered left→right with the start leftmost and end rightmost.
  The Flow diagram (DFG) was already correctly ordered — this was a Process-diagram
  layout bug only, pre-existing and independent of ADR-0024. Verified in the viewer
  on the demo single-session and 10-session aggregate step BPMN; golden-neutral
  (the golden projection never read BPMN DI); pinned by a new `test_bpmn_observed`
  cycle test.

- **The default (screen-grain) Flow diagram no longer fans out into a per-case
  hairball ([ADR-0024](docs/adr/0024-step-grain-as-view-time-rollup.md) regression).**
  The screen grain key resolved to the raw `window_title`, which routinely embeds
  the case value ("Salesforce - Order #10900", "Outlook - Order #10852
  confirmation"). Grouping on the raw title made the *same* logical screen a
  *distinct* node per case, so the default Flow diagram (DFG) and Step/Screen maps
  rendered as a tangle of orphaned per-order nodes instead of a clean linear chain
  — the 10-session demo aggregate at the screen notch had **76 nodes / 35 distinct
  end-nodes**. The screen axis now groups **value-free** (`process-map-levels.screenType`),
  stripping embedded record numbers / id tokens the same way `process_label`
  strips step values — so one "Salesforce - Order" screen collapses to one node
  across every case while genuinely-different screens ("Account lookup" vs "Credit
  check") stay apart. Demo aggregate screen-grain map: **76 → 6 nodes, 35 → 1 end
  node**, a single connected chain. Pure presentation — applied at view time, raw
  `grain_keys` untouched (detail is never destroyed), no re-normalization, no
  golden change. The fix lands inside `grainKey`/`grainLabel`, so the Map, the
  Steps list, and the Analysis "Waste by screen" itemisation all inherit it.
  `e2e/session-smoke.js` gains a **map-connectivity pin** (the screen-grain DFG
  must be one component with one start and one end); short transaction codes like
  `va01` are preserved (the digit-run threshold is 3+).

- **In-app vocabulary discovery — "point-and-learn" ([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md), [build spec](docs/To-Do/SELF-SERVICE-VOCAB-DISCOVERY-SPEC.md)).**
  Turns the manual real-value UIA probing ([REAL-VALUE-TESTING.md](docs/REAL-VALUE-TESTING.md))
  into a shipped, on-device, self-service feature: the analyst points at a
  prepared window and gets a named-able, stable-signature App Vocabulary
  skeleton — no dev box, no off-box agent, nothing leaves the machine.
  - **P1 — recorder `snapshot` command.** A new stdio command alongside
    `hello`/`pause`/`resume`/`shutdown`: `{cmd:"snapshot", target:"foreground"|<hwnd>, passes:2}`
    walks the target window's UIA subtree once per pass and streams every
    identifiable control as a `snapshot_control` line (`control_type` /
    `automation_id` / `name` / `class_name` / `framework_id` plus ADR-0023's
    `framework` / `identity_source` / `confidence` / `bounds`, with `depth` /
    `role` / `pass`), then a `snapshot_done` per pass. Two passes ≥1s apart let
    the picker diff for volatile ids; capped at ~2000 controls; wakes a
    Chromium renderer's lazily-built a11y tree first. Transient — never written
    to `events.jsonl`. The pure traversal (`SnapshotWalker` over an
    `ISnapshotElement` seam) is pinned by new `Recorder.Tests`; the production
    single-file recorder build stays green.
  - **P2 — the volatility-diff signature picker (the clever core).** New
    `normalization/signature_pick.py` joins the two-pass snapshot's controls by
    a *stability-independent* key (role + label + ancestry + bounds bucket —
    never the candidate id), marks an `automation_id` **volatile** when it
    changed across passes *or* matches a per-render pattern (`^input-\d+$`,
    `^combobox-(input|button)-\d+$`, bare GUID, …), then picks the most-stable
    identity down the ADR-0023 ladder, **skipping volatile fields** — turning the
    analyst's "which id is real?" guess into a measured fact.
    `app_vocab.bootstrap_from_snapshot` builds a named-able skeleton over the
    full control set (name pre-filled from the label, screens grouped by window
    title, each entry carrying the picked `identity_source` / `confidence` /
    `volatile_aids`). The **ground-truth test** (`test_signature_pick.py`)
    validates the picker against the committed hand-probed vocabs: it KEEPS the
    stable ids (Office `FileSave`, ServiceNow `incident.short_description`,
    Outlook `4117`, Jira `summary-field`) and **DEMOTES** Salesforce `input-378`
    / Zendesk auto-ids to the accessible label. Pure-Python; the session-golden
    is unchanged (discovery is purely additive).
  - **P3 — App Library "Discover from window".** A new button on the App Library
    tab: point at a prepared app window and the viewer spawns the recorder for a
    two-pass snapshot (`recorder-snapshot.js`), runs the picker +
    `bootstrap_from_snapshot` via the bundled Python
    (`normalization/discover_vocab.py`), and loads a stable-signature skeleton
    into the editor. Each discovered interaction shows **why** its signature was
    picked — the `identity_source` rung + ADR-0023 confidence, and the rejected
    volatile id(s) (the legend). **Re-discovery merges** into the selected vocab:
    new controls are added, analyst-named ones preserved (never overwritten),
    screens merged additively, a tuned scope left intact. Entirely on-device —
    the recorder snapshots locally, nothing is written until Save, and
    discovery-provenance fields are stripped from the persisted YAML. End-to-end
    verified against a live window (snapshot → discover → skeleton).

- **Recorder desktop-coverage hardening (§11e, [ADR-0023](docs/adr/0023-recorder-capture-confidence.md)).**
  The C# recorder now reports per-element capture quality so the moat degrades
  *honestly* instead of silently producing thin captures on hard frameworks.
  Every interaction gains four additive signal fields (following the
  `coverage_hint` precedent — emitted, allowlisted, schema'd, surfaced in the
  structure-only `scripts/inspect-events.js`, consumed by the analyst not the
  pipeline):
  - `framework` — a **normalized UI-toolkit** detection
    (`win32`/`winforms`/`wpf`/`winui`/`chromium`/`java`/`javafx`/`qt`/`remote`/
    `terminal`/`unknown`) re-derived from `framework_id` **+** the window class,
    so toolkits that misreport their `framework_id` (Java/Qt report `Win32`;
    Citrix/RDP wrap a foreign session) are recognised by their platform-stable
    window class. Distinct from the recognition layer's web-app `framework` axis.
  - `identity_source` — the **identity-ladder rung**
    (`automation_id` → `name` → `class_name` → `ocr` → `none`).
  - `confidence` — **per-element capture confidence** in `[0,1]`, blending the
    rung with the toolkit (capped at `0.30` on `remote`/`terminal` surfaces).
  - `value_source` — flags a value **recovered** off the primary ValuePattern
    path via `TextPattern` (`text_pattern`), generalizing the AG-Grid fix.
  - **OCR last resort** (`ocr_text`, default-off via `interactions.ocr`): an
    identityless element's on-screen region is captured and labelled via
    `Windows.Media.Ocr` — a Win10+ **system API** (on-device, no bundle
    inflation; not Tesseract). A genuine last resort, gated to
    `identity_source == "none"`.
  - **Deployment rules** ([DEPLOY.md](docs/DEPLOY.md)): run the recorder
    *inside* a Citrix/RDP session (a `framework: "remote"` capture means you're
    on the wrong side of the glass), and lean on the **local video backstop**
    where structured capture can't reach.
  - The recorder's decision logic is pinned by the new `Recorder.Tests`
    (framework detection, identity ladder, confidence, value recovery, OCR
    gating, and a headless OCR-engine round-trip). The single-file build moved to
    TFM `net8.0-windows10.0.19041.0` for the WinRT surface (publish + startup
    verified). Live validation against real Java/Qt/Citrix apps is deferred.
- **Pre-built App Vocabularies (§11d, no-LLM bootstrap).** Ships a curated
  starter set under `normalization/app_vocabularies/` — `salesforce.yaml`,
  `sap-gui.yaml`, `excel.yaml`, `outlook.yaml`, and a browser-chrome
  `chrome.yaml` — bootstrapped from the committed `example-aggregate` demo via
  `normalize.py --bootstrap-vocab-out` and curated (meaningful names, screens,
  flags). Signatures are on `control_type` + `automation_id` + `name` (never CSS
  selectors). A new `app_vocabularies/README.md` documents the set and how to
  author your own; the old `sample-salesforce` / `sample-outlook` worked
  examples are replaced. Verified by re-normalizing the demo: the four desktop
  apps enrich at 100% coverage (114 interactions named). As part of the
  predicted-vs-actual diff this exposed that the recorder reports the exe name
  with inconsistent casing (`chrome.exe` but `EXCEL.EXE` / `SAPGUI.exe`), so
  **vocab `scope.process_name` matching is now case-insensitive** (a vocab no
  longer silently misses the app it targets).
- **Capture-side worker consent gate (§11f).** A consent window
  (`capture/consent-window.js` + `ui/consent.html`, mirroring the existing
  `*-window.js` modules) can be shown at session start, and every
  `manifest.json` now carries a `consent` record. Configurable via
  `config.consent.mode`: `"off"` (default — no prompt, records
  `required: false`, preserving the prior start flow), `"per_session"` (prompt
  every start), or `"once"` (prompt once per worker + `version`, remembered in
  user-config). Declining **aborts the session start** — no folder is created.
  The C# recorder is unchanged. Pure record/decision logic lives in the
  electron-free `capture/consent.js` (unit-tested); the window's IPC round-trip
  and HTML escaping were verified in a real-run harness check.
- **Structural PII masking (§11f).** A new normalization stage
  (`normalization/pii_masking.py`) redacts sensitive UIA field **values** —
  password, SSN, card, CVV, PIN, secret/token, IBAN, routing/account number,
  matched by the field's tokenized name · automation_id · control_type — in the
  **derived** event stream only. Raw `events.jsonl` is never rewritten; masking
  applies to the in-memory copy that feeds events.csv / events.xes / stats /
  steps / analysis / maps. Each value is replaced by a one-way, join-preserving
  token `«category#hash»` (`sha256(session_id + ":" + value)[:8]`), so process
  mining still distinguishes distinct secrets while the original is
  unrecoverable. Privacy by default; the analyst-owned `pii_masking_config`
  can disable it or add custom rules, and the rule-set that ran is recorded in
  the additive `pii_masking` annotations key. Pinned by deterministic unit tests
  and a seeded property-based fuzzer (immutability + no-leak + join-preservation
  invariants).
- **Automation-candidate ranking (§11f).** `analysis_automation.score_automation`
  now scores each candidate by automation priority — `instance_count × mean
  elapsed time × automatable fraction` (the same fraction the €-ROI layer resolves
  from `roi_inputs`, per-segment override aware) — and stamps a 1-based `rank` on
  the multi-instance candidates (single-instance rows get `rank: null`,
  `rank_score: 0`). The order feeds both the `roi` band and the PDD focus list, and
  surfaces as a `#` column in the viewer's Automation-candidates table and a Rank
  column in PDD §4.3. The previous instance-count-first ordering buried a
  rare-but-long segment beneath a frequent-but-trivial one.
- **€-ROI panel in the Session-view Analysis level (§11c — the commercial closer).**
  The Python ROI core (`analysis_roi.py`) already projected each multi-instance
  automation candidate into a conservative/expected/optimistic savings band; the
  viewer now renders it. The new "Return on automation (€-ROI)" section shows the
  band per candidate (hours/yr while no labour rate is set, € net/yr once one is),
  the expected-band session totals, and a band-encoding legend mapping each column
  to its realism multiplier. An **Edit assumptions…** form captures the session-level
  `roi_inputs` (loaded €/hr, currency, annual volume, build cost, amortization,
  automatable share, realism factors) and a per-row **tune** form captures per-segment
  overrides; both persist through the existing annotations + undo path
  (`saveAnnotationsWithUndo`) and trigger a re-analyze so the € recomputes in place.
  Honours the no-fabricated-wage rule — monetary figures stay withheld until a rate
  is supplied. No schema change (`roi_inputs` / `roi` were already in SCHEMA).

### Security

- **Click-to-RCE hardening on the screenshot-open path.** The `viewer:openExternal`
  IPC handler (the `shell.openPath` sink) now rejects absolute paths, `..`
  traversal, and non-image extensions, and confirms the resolved path stays under
  the active session's `screenshots/` directory before opening — closing a path
  where an attacker-planted file in a moved session folder could launch via Windows
  file association. The renderer's `openScreenshot()` adds matching defense-in-depth.
- **PDD export screenshot containment.** `screenshot_refs` from `annotations.json`
  are now resolved and skipped unless they stay within the session folder; absolute
  refs are rejected — closing an off-folder image-read / information-disclosure path.

### Fixed

- **Process map no longer overlays the Raw Events / Analysis sections** on the
  Session view's Map level. `.session-layout-map` carried the `min-height:0`
  flex-shrink trap already removed from the Steps/Phases layouts, so the map host
  painted down over the collapsible panels that follow it; the details now flow
  below the map and the view scrolls.
- **Captured marker/system events are no longer silently lost** on a failed
  `events.jsonl` write — the batch is logged, surfaced, and re-queued for retry.
- **Idle auto-end fires once per idle stretch** instead of re-firing every 5 s and
  emitting hundreds of duplicate boundary events; marker-close loops are now bounded.
- **OBS status failures are logged** and a missing recording path is surfaced
  (previously a failed `GetRecordStatus`/`StopRecord` was swallowed, leaving video
  the viewer could not locate).
- **One unreadable engagement folder no longer prevents the tray from launching**
  (`findOrphanedSessions` reads are guarded).
- **Canonical step spans absorb interleaved interior events** for the
  `until_app_change` / `until_pause` / `until_field_change` boundary modes instead
  of truncating the span on a non-matching interior interaction.
- **A long idle gap alone can now surface a suggested marker** (the idle-gap signal
  was mathematically below its own suggestion gate).
- **A malformed timestamp no longer crashes the pipeline** —
  `coalesce_typing_bursts` uses the lenient parser like the rest of the pipeline.
- **Phase membership stays consistent** (`phase.step_ids` ↔ `step.phase_id`) across
  step delete / split / merge, plus a Python reconcile pass after re-merge.
- **PDD renders steps that are not in any phase** (under "Unphased steps") and no
  longer renders hidden, noise-suppressed steps.
- **Saving an App-Library vocab preserves `seen_count`** and other unmodeled fields
  (they were being stripped on every save, losing the bootstrapped frequency rank).
- **Renaming a marker now goes through the undo stack** (it bypassed undo and made
  the next Ctrl+Z revert the rename).
- **PDD process-map embed failures are logged** instead of silently producing a
  placeholder map.

### Changed

- **Electron 33 → 42** in both the capture and viewer apps, returning to the
  supported-release window (Electron 33 no longer receives Chromium/V8 security
  backports). Unit suites stay green and the viewer boots/renders (BPMN, DFG,
  charts) under 42 with zero page errors; the packaged build still needs a
  real-run validation pass on the locked-down laptop before release.
- **Removed the unused `electron-builder` dev-dependency** (plus its `dist` script
  and `build` block) from both apps — distribution is via `@electron/packager`
  (`build-package.js`), not electron-builder. This clears every `npm audit`
  advisory (11 → 0; they were all in electron-builder's transitive tree).
- **Replaced the unmaintained `dagre` 0.8.5 with the maintained `@dagrejs/dagre`**
  fork, via `cytoscape-dagre` 2.5 → 3.0 (which bundles the fork). Dropped the now-
  redundant standalone `dagre` `<script>` tag from `index.html`. DFG layout
  verified unchanged in the harness (nodes positioned, 0 page errors).

### Tests

- **Golden corpus widened from 1 to all 10 `example-aggregate` sessions**
  (partial §11a). `golden_check.py` `REFERENCE_SESSIONS` now pins the whole
  committed demo set (order-to-cash at varying case volumes); each is
  re-normalized on its pre-recorded `events.jsonl` and diffed against a
  committed projection golden — **no recorder and no Electron in CI**. A new
  `corpus/README.md` sketches the narrow/bounded/wide tier roadmap and records
  that the demo set is the de-facto narrow tier and that live-recorder-in-CI is
  out of scope (needs a self-hosted desktop runner).

## [0.19.0] - 2026-05-29

**Phase 0 of the ML integration recommendation — non-ML, classical-statistics
support for unbracketed sessions.** Two complementary detectors close the
"worker forgot to fire markers, no Process Template configured" failure
mode that was the recurring cause of one-big-default-case sessions. Both
honour the suggest-don't-mutate invariant: detection lives in
`annotations.json`; the analyst Accepts or Dismisses; raw `events.jsonl`
is untouched. Zero new pip dependencies.

### Added

- **Suggested markers ([ADR-0017](docs/adr/0017-suggested-markers.md)).**
  A hand-rolled change-point detector (`normalization/marker_suggest.py`,
  ~420 lines, pandas + stdlib) walks the uncased stretches of the event
  stream and surfaces candidate Start/End boundaries on four heuristic
  signals — idle gap, return to a "home" app, transaction-ID-like value
  typed, app-cluster boundary (hand-rolled Union-Find over a Markov
  adjacency graph). Each suggestion gets a stable 12-char blake2b
  signature over `(marker_type, ts bucketed to 5 s, before_app,
  after_app, reason)` so dismiss and accept survive re-normalize.
  Candidates render as **dashed `.tl-marker.tl-suggested` bars** on the
  Flow timeline (with a new "suggested marker" chip in the legend strip)
  and as `.marker-row.suggested` rows in the markers side-panel with
  Accept (`✓`) / Dismiss (`✕`) buttons. Accept queues a real
  `marker_edits[]` `op:"insert"` with a `derived_from_signature` link
  for audit; the next normalize sees the link and drops the now-handled
  suggestion. Dismiss writes the signature to
  `marker_suggestions_dismissed[]`, suppressed on every future run.
  Both reversible via Ctrl+Z.
- **Anchor candidates ([ADR-0018](docs/adr/0018-anchor-candidates.md)).**
  A pattern-mining detector (`normalization/anchor_suggest.py`, stdlib
  only) ranks fields that look like case anchors. For each candidate
  `(automation_id, name)` field, the detector **simulates** what
  `case_assignment.detect_cases_from_anchors` would produce with that
  field as the anchor, then scores the resulting case structure on four
  signals — coverage, balance (1 − CV of case sizes), label diversity,
  focus (right-sized handful of cases). Top 5 surface as an
  **"Anchor candidates" panel** above the markers list. Accept writes
  a session-level `case_anchor_override` into `annotations.json`;
  `normalize.py` consults it BEFORE the marker-mode fallback so the next
  Analyze stamps cases by the chosen field. Dismiss writes to
  `anchor_candidates_dismissed[]`; Clear is the inverse of Accept.
  Precedence: **Process Template `case_anchor` > session-level override
  > markers** — the engagement contract still wins when both exist.
- **`marker_suggestions[]`, `marker_suggestions_dismissed[]`,
  `anchor_candidates[]`, `anchor_candidates_dismissed[]`, and
  `case_anchor_override`** as new additive top-level blocks on
  `annotations.json`; all documented in
  [shared/SCHEMA.md](shared/SCHEMA.md).
- **A `derived_from_signature` field on `marker_edits[]` `op:"insert"`
  entries** for accepted marker suggestions — provides a human-readable
  audit trail and is what the merge consults on re-normalize to suppress
  the accepted candidate.
- **`scripts/preflight.ps1` and `build-distribution.ps1` integrity gates
  unchanged.** No build-pipeline changes this cycle.

### Tests

- 36 new deterministic regression scenarios (19 marker + 17 anchor)
  pinning behaviour on hand-built fixtures.
- 10 seeded property-based fuzzer regimes (5 marker + 5 anchor) covering
  **~19,000 randomised inputs**. The headline anchor invariant: every
  emitted `anchor_config` round-trips through the production
  `case_assignment.detect_cases_from_anchors` and produces ≥ 2 cases —
  guaranteeing every candidate is actionable. The marker fuzzer pins
  the four guards (excluded_range, inside existing case, near a real
  Start, sub-`min_case_interactions` slivers) and the merge's
  idempotence under dismiss + accept.
- Full Python suite: **277 passing, 3 skipped** (1 mine for pandas, 2
  pre-existing). Viewer node:test suite: **194 passing**.

### Verified

End-to-end via the project's `_pdt_verify` Playwright harness against a
markers-stripped fixture (`sessions/_fixtures/sess-unbracketed-fixture`).
The unbracketed session correctly produces 6 paired Start/End suggested
markers (labelled with the typed customer IDs the worker would otherwise
have to bracket by hand) and 3 anchor candidates with `customer-id-field`
ranked first at score 0.935 (98.8 % coverage, CV 0.034). Accept the
anchor → 3 cases stamped via override on the next normalize; Clear
restores the unbracketed state; Accept a marker → real op:insert in
`marker_edits[]` with the derived_from_signature link. Zero console
errors throughout. Control on the cleanly-bracketed
`sess-2026-0515-1255` produces 0 suggested markers (correct — no missing
boundaries), 3 anchor candidates (informational), no regression.

## [0.18.1] - 2026-05-28

Same-day follow-up to v0.18.0 — four real-user issues that surfaced
immediately after the in-view Map level shipped.

### Fixed

- **Session-view Map level was silently never rendering.** v0.18.0 added
  `"map"` to `LEVEL_RENDERERS` and to the layouts that `applyLevel` swaps
  in/out, but forgot to add it to `MODE_VIEWPORT` — the table the
  viewport-transfer code uses to carry zoom + scroll across mode switches.
  When the user clicked Map from any other level (Flow / Steps / Phases
  / Analysis), `applyLevel("map")` called `_viewportApplyToMode("map",
  snap)` which early-returned on `if (!m) return` because
  `MODE_VIEWPORT["map"]` was undefined — **silently skipping
  `m.render()` and therefore skipping `renderMapLevel` entirely**. The
  panel chrome (notation tabs, level dropdown) was visible because
  `applyLevel` had already swapped `display:""` on the layout, but the
  BPMN / DFG host stayed empty forever — no diagram, not even the
  empty-state message (the controller's render was the thing that would
  have set it). On the very first session load (`--session=<path>` from
  launch) the code path is different and the controller renders, which
  is why the harness never caught this and v0.18.0 shipped broken. Fix:
  add a `MODE_VIEWPORT.map` entry with no-op zoom accessors (analogous
  to Analysis) and `render: renderMapLevel`. Verified by reproducing the
  empty host in the harness (`bpmnHostInnerHTMLStart: ""`,
  `zoomWrapDisplay: "none"`), then confirming the host now contains a
  populated `<div class="bjs-container">` with the activity-BPMN
  diagram after the fix.
- **The map-controller's BPMN render no longer swallows exceptions
  silently.** Defensive cleanup: any future bpmn-js failure now logs
  to console and shows a fallback in the host with the file path,
  error message, and a hint to re-run Analyze with "Build process map"
  checked. Turns "Map is mysteriously empty" into "Map says exactly
  why" if any future failure mode does land an exception.

### Added

- **PDD export from the Session view.** v0.18.0 added the in-view Map level
  but left the **PDD (`.docx`) export Compare-Sessions-only** — to generate
  a PDD for a single session the analyst had to switch tabs, re-pick the
  folder, and re-load it as a one-element aggregate. The Session view's
  Export menu now has a `PDD (.docx)` entry that pre-renders the Map
  level's Flow diagram (so the PDD's As-Is process map section embeds
  *this* session's diagram, not whatever was last on Compare-Sessions),
  then runs the shared export path with a new `{singleSession:true}`
  option that forces the target to `State.getSession()` instead of
  defaulting to aggregate sessions when those are also loaded.
- **Clickable waste-type chips on the Analysis view's Waste-by-step list.**
  The `motion` / `rework` / etc. chips on each row were `<span>`s that
  looked like buttons but only bubbled the click up to the row's "adjust
  business-required time" handler — surprising and unhelpful. They are now
  `<button class="waste-tag-btn">` with their own click handler that
  **filters the Waste-by-step list to step types tagged with that waste
  type** (click `motion` → list narrows to motion-tagged rows; click the
  same chip again, or the new "show all ✕" indicator chip, to clear).
  `stopPropagation` keeps the adjust modal from opening on a chip click.

### Changed

- **Session-view Map empty-state messages mention the "Build process map"
  checkbox** (`#cb-mine` in the ⋯ More menu). v0.18.0's messages told the
  analyst to "click Analyze session" without explaining that the Map files
  are only produced when the checkbox is on — so an analyst who'd
  unchecked it once would re-run Analyze repeatedly and see no map. The
  activity-DFG empty message also now explains the taxonomy dependency
  (the activity DFG comes from taxonomy-classified events; Step / Phase
  Flow uses the analyst's annotations and needs no taxonomy).
- **`exportArtifact(kind, callOpts)`** in `viewer/renderer.js` takes an
  optional `callOpts.singleSession` to force a single-session target.
  Without the flag, behaviour is unchanged (Compare-Sessions filtered
  sessions take priority over the current session).

## [0.18.0] - 2026-05-28

The in-view single-session Map level. The interactive process map (notation ×
level × drill-scope × rare-path cutoff) used to live only in
Compare-Sessions; this cycle adds it as a 5th level inside the Session view,
alongside Flow / Steps / Phases / Analysis. The v0.17.0 "View map" one-click
that routed through Compare-Sessions retires — the Map level supersedes it.
The map UI is now a reusable controller (`viewer/map-controller.js`) shared
by both surfaces. Build-pipeline guards added against three failure modes the
recent release prep tripped over.

### Added

- **Map level in the Session view.** Click "Map" in the level switcher
  (Flow / Steps / Phases / **Map** / Analysis) to open the interactive process
  map for the current session: Process diagram (BPMN) or Flow diagram (DFG)
  at Activity / Step / Phase level, with zoom, drill-down (click a phase to
  scope to its steps, click a step to scope to its activities), and the
  rare-path slider for thinning a long flow's tail. Clicking an
  activity-level node seeks the Flow timeline to that event and switches to
  the Flow level. Same notation × level matrix as Compare-Sessions, bound to
  a single-session data source. Verified in the `_pdt_verify` harness across
  all 2 × 3 × 2 = 12 notation × level × theme combinations + a
  Compare-Sessions regression check (`viewer/index.html`, `viewer/renderer.js`,
  `viewer/styles.css`, `viewer/map-controller.js`).

### Changed

- **The process map UI is now a reusable controller**
  (`viewer/map-controller.js`). The cross-cutting state (notation, level,
  drill scope, rare-path cutoff) and the wiring of the tab / level pill /
  zoom / slider / scope chip used to be tangled with `aggregate-view.js`'s
  multi-session lifecycle and hardcoded DOM IDs (`#bpmn-host`, `#dfg-host`,
  `#map-level`, etc.); pulled into a `createMapController(config)` factory
  that takes DOM nodes + a `dataSource` callback so both Compare-Sessions
  (multi-session merged map) and the new Session-view Map level
  (single-session map) share the same UI. Net: aggregate-view.js shrinks
  by 208 lines; no user-visible behaviour change in Compare-Sessions.
- **`scripts/preflight.ps1` now gates CHANGELOG header integrity and lockfile
  version sync** in addition to the existing npm-audit check. The CHANGELOG
  check fails if any `## [X.Y.Z]` header that was present at the latest git
  tag has disappeared from `CHANGELOG.md` — catches the regression where
  `114edfa` accidentally absorbed the `[0.16.3]` section into `[Unreleased]`,
  where it would have shipped under v0.17.0 if the bump-time audit hadn't
  noticed. The lockfile check fails if `package.json`'s `version` doesn't
  match `package-lock.json`'s root `version` — catches lockfile drift like
  the four-version lag `viewer/package-lock.json` had before the v0.17.0
  prep. Both new checks use a head + regex (not `ConvertFrom-Json`, which in
  PS 5.1 trips on the empty-string keys npm v3+ lockfiles use in
  `"packages": {"": {...}}`).
- **`scripts/build-distribution.ps1`** now runs `preflight.ps1` as step 0 (so
  the three sanity checks gate every release build, not just commits), and
  wraps the electron-packager `npm run package` step in a 3-attempt retry
  with `$env:TEMP\electron-packager\` cleanup between attempts. Defender /
  Search-indexer scanning the staging dir mid-copy occasionally makes
  electron-packager die with `ENOENT` on a freshly-written asset (verified
  against `bpmn-js/dist/assets/bpmn-font/font/bpmn.svg` during the v0.17.1
  build).

### Removed

- **The v0.17.0 "View map" one-click interim** — `#btn-view-map` in the
  Session view's process-map status bar — is gone. It was the low-risk path
  to the interactive map before this cycle's in-view Map level shipped;
  the level switcher now goes straight there.

## [0.17.1] - 2026-05-28

Doc-only follow-up to v0.17.0 (same-day). The `.exe` binaries are functionally
identical — the running code is unchanged. What catches up: the README, the
backlog spec, a couple of release-process ops notes, and the active-branch
guidance.

### Changed

- **README leads with "What's new in v0.17.0".** It had been tops at v0.15.0 —
  ten versions behind reality. Now lists the v0.16.x – v0.17.0 highlights:
  segment-level automation candidacy, the PDD restructure, one-click "View map",
  decluttered Analysis, capture polish (Settings/Profile IA + the freeze fix +
  the Chromium fix), intra-session repetition alignment, and pipeline hardening.
- **`docs/To-Do/NEXT-SESSION-SPEC.md` backlog refreshed.** The four big items
  from the v0.16.x – v0.17.0 cycle (segment-level automation, group-Waste-by-step,
  parse_ts consolidation, broader doc-coverage audit) all landed; the only
  remaining feature-sized item is the in-view single-session map (the one-click
  "View map" shipped in v0.17.0 is the low-risk interim). Three small follow-ups
  noticed during the release prep are queued.
- **Active-branch guidance flipped from `viewer-refactor` → `master`.** The
  long-running `viewer-refactor` refactor branch was merged into `master` at
  v0.17.0 (clean fast-forward); `viewer-refactor` is preserved on origin at the
  same commit but is no longer used for active work. `CLAUDE.md` +
  `docs/To-Do/NEXT-SESSION-SPEC.md` updated to point new sessions at `master`.
- **`docs/SPEC-DEFERRED.md` superseded notice** strengthened — the doc was
  written at v0.2.0 and many items have since shipped without being marked.
  Readers are pointed at `NEXT-SESSION-SPEC.md` for the live backlog.
- **`docs/DOC-COVERAGE-AUDIT.md`** — stale `Branch: viewer-refactor` reference
  in the header reframed to note the branch was merged into `master` at v0.17.0.

### Added

- **`docs/DEPLOY.md`: MAX_PATH extraction note.** The viewer zip's deepest paths
  reach ~175 chars (PM4Py inductive-variant filenames), and a deeply-nested
  extract destination (an indexed OneDrive sync path, a long project tree) can
  push past Windows' 260-char MAX_PATH and cause Shell "Extract All" / PowerShell
  `Expand-Archive` to silently fail mid-rollback. The new bullet on the analyst
  install step calls out an extract destination under ~80 chars as safe.
- **`docs/BUILD-AND-DIST.md`: Release checklist section.** Captures the
  lockfile-bump reminder (`viewer/package-lock.json` had lagged four minor
  versions before the v0.17.0 prep noticed — `npm install` in each app dir
  after a version bump propagates it into the lockfile), plus the bump → build →
  push → publish sequence, and the order constraint that `gh release create`
  tags the remote default-branch HEAD at the moment it runs (so push before
  publish, and land any post-release docs cleanup after publish).

## [0.17.0] - 2026-05-28

The productization-toward-internal-rollout cycle. The analyst-deliverable loop
— process map + step/phase breakdown + PDD/report — has been polished to a
real-world bar: the PDD now follows a standard RPA Process Definition Document
structure with an embedded process map, a single session reaches the
interactive map in one click, and the cross-session Analysis panel +
single-session Waste-by-step list are decluttered to signal-only. The analysis
model is reframed from per-click candidates to coherent automatable segments
([ADR-0016](docs/adr/0016-segment-level-automation-candidacy.md)). Capture is
hardened for the field laptop: the ~5 s session-start freeze is gone, the
Settings / Profile / Session-setup tray IA is split by lifetime, Chromium
web-content reaches the recorder out of the box, and a family of seeded
property-based fuzzers + a `process_label` Python↔JS golden + a `parse_ts`
consistency sweep pin the normalization pipeline against corrupt or
hand-edited logs.

### Added

- **Settings and Profile become top-level tray entries with a real persistence
  layer.** Configuration was buried under "Help & config → Set up a recording
  session" and conflated three concerns: worker identity, persistent settings,
  and per-session inputs. The capture tray now has three discoverable surfaces
  split by lifetime — **Settings…** (Hotkeys, Video/OBS, Screenshots, Storage &
  recording limits — persistent across sessions), **Profile…** (worker identity:
  id, display name, role, team — stamped onto every recording's manifest), and
  **Session setup…** (engagement code/name and process labels — per-engagement,
  shown only when idle). Persistence is a new partial-config overlay at
  `userData/user-config.json` that's deep-merged ON TOP of the YAML config at
  launch, so the YAML supplies session-level shape and the UI-edited slices win
  for what they own. The first-run welcome gets a "Set up your profile" CTA so a
  fresh operator hits identity setup before recording. The legacy standalone
  `obs-settings.json` is migrated into the overlay automatically on first load
  (`capture/user-config.js`, `capture/settings-window.js`,
  `capture/profile-window.js`, `capture/ui/settings.html`, `capture/ui/profile.html`,
  `capture/main.js`, `capture/config.js`, `capture/ui/welcome.html`).
- **"View map" — one-click access to a single session's process map.** The
  interactive map (zoom/pan, Activity/Step/Phase × Flow/BPMN) lived only in the
  Compare-Sessions view, so an analyst working one session had to go there and
  re-pick the folder. The Session view's process-map status bar now has a "View
  map" action that opens the current session in that view directly — also the
  path to getting the map into the PDD (`viewer/index.html`, `viewer/renderer.js`,
  `viewer/views/aggregate-view.js`).
- **The PDD (.docx) now follows a standard RPA Process Definition Document
  structure.** The flagship stakeholder deliverable previously jumped from a
  three-line title block into the step-by-step body. It now mirrors the outline
  of a real PDD (modelled on the document UiPath Task Capture generates from a
  recording): document control, an introduction (purpose / objectives / key
  contacts), an As-Is process description (overview, an **applications-used**
  table, a process-map placeholder, statistics with a "where the time went"
  breakdown, the detailed steps, input data), an **automation assessment** with
  a scored automation-candidates table, and an **exceptions & variations**
  section. Sections are auto-filled where the pipeline has the data and carry
  explicit "[To be completed]" placeholders for the analyst-judgement parts
  (purpose, scope, exception handling), so the document reads as a structured
  PDD rather than a data dump. When exporting from the viewer, the currently-
  rendered Flow map is rasterised and embedded as the As-Is process map
  (section 3.3) (`normalization/pdd_export.py`, `viewer/dfg-viewer.js`,
  `viewer/renderer.js`, `viewer/python-runner.js`).
- **Toast: browser foreground without UIA events.** A belt-and-braces safety
  net for the rare case where the wake-up poller still can't surface a Chromium
  window's AXTree (managed Chrome with accessibility policy disabled,
  AppContainer-restricted builds). When a browser process (`chrome.exe` /
  `msedge.exe` / `brave.exe` / others) is foreground for 8 s and zero
  interactions have reached the tracker from a browser, a once-per-session
  toast tells the analyst the session is rolling but the browser is opaque to
  UIA, with a pointer to the registry-policy fallback in `docs/DEPLOY.md`
  (`capture/main.js`).
- **Smoke test for the wake-up.** `capture/test/wake-up.smoke.test.js` +
  `_pdt_verify/real-capture-test/wake-up-smoke.js`: launches a stock Chromium,
  types into a local form, asserts the recorder emits ≥ 2 web-content
  `value_changed` events with `framework_id="Chrome"` and recognisable form
  labels. Skipped cleanly when Playwright isn't installed so the capture test
  suite still passes on a checkout without Playwright.

### Changed

- **Automation candidacy is reported at the coherent-segment grain, not per
  atomic step ([ADR-0016](docs/adr/0016-segment-level-automation-candidacy.md)).** The previous design ranked individual logical
  steps as automation candidates — a per-click table that read as "automate
  this Search button, this Submit, this Open record" in isolation. That framing
  is misleading: a human–robot–human pipeline (worker fills the form, robot
  clicks Search, worker copies the result) is worse than fully manual. The unit
  of automation an analyst can actually scope is a *coherent stretch of work*
  the robot could take end-to-end. The analysis layer now detects **segments**
  — contiguous runs of interactions inside one case that share the same app,
  bounded by app/case switches or a 30 s idle gap — and scores candidacy by
  pooling segments with the same `(app, ordered step labels)` signature. A row
  is "salesforce — Search → Copy → Paste, 4 instances across cases, total
  2 m 14 s, mean 33.5 s"; sub-5 s single-step segments are dropped because they
  cannot be automation units on their own. PDD §4 renders the segment table
  plus a short narrative summary instead of the 60-row per-click grid; §3.5
  no longer surfaces the per-step "Automation candidate" flag. The Analysis
  view and the Compare-Sessions automation panel render the same segment
  shape, and confirm/dismiss is now keyed by `segment_signature` in
  `analysis_overrides[]` rather than `step_id`. `analysis.json.meta.heuristic_version`
  is bumped to **2**; a new `analysis.json.segments` array exposes the raw
  segments for the viewer. The change does not retire the App-Vocab
  `flags.automation_candidate` per step — it is still a valid signal — but
  the analysis/PDD/findings-report rendering paths no longer surface it
  (`normalization/analysis_segments.py`, `normalization/analysis_automation.py`,
  `normalization/analysis.py`, `normalization/pdd_export.py`,
  `viewer/views/analysis-view.js`, `viewer/views/aggregate-view.js`,
  `viewer/analysis-aggregate.js`, `viewer/report-html.js`, `viewer/report-md.js`,
  `shared/SCHEMA.md`).
- **The Compare-Sessions Analysis panel is far less cluttered.** The cross-session
  time study rendered every step in a fixed 9-column table — including the ~26
  instant (0 ms) micro-steps and columns that were all-zero or always "1" — and the
  automation-candidates table showed a full grid of "—" whenever a step lacked the
  2+ sessions needed to score it. Now the time study is sorted by time and lists
  only steps with a measured duration (with a "+N instant steps" note), and each
  column appears only when it carries signal (Sessions / Min-Max / Waiting /
  Switching show just when non-trivial — a single session collapses to Step /
  Instances / Mean / Active); the automation table collapses to a one-line note
  when nothing is scoreable yet. Also fixes a stray "Heuristic IE findings" typo in
  the panel caption (`viewer/views/aggregate-view.js`, `viewer/index.html`,
  `viewer/styles.css`).
- **The single-session "Waste by step" list is decluttered too.** It rendered one
  bar per step instance (64 for a 4-case session), most of them instant 0 ms
  micro-steps with empty bars. It now sorts by waste then duration — so the
  wasteful and time-heavy steps surface first — and tucks the instant steps
  behind an "N instant steps" expander; every row stays editable
  (`viewer/views/analysis-view.js`, `viewer/styles.css`).
- **Group single-session "Waste by step" rows by step type with aggregate
  VA/NVA; "adjust" propagates across instances.** A 4-case capture still
  produced one row per instance (4× "Search — CUST-XXX", 4× "Save order —
  Express"…) — the analyst was reading the same step type repeated. Rows are
  now rolled up by `process_label` (the value-free step-type key the process
  map and stats already group on), aggregating va_ms / bnva_ms / nva_ms across
  every instance, with an "N×" instance badge and the existing nva-then-total
  sort. The 64-row demo session collapses to 17 step-type rows (8 with a
  measured duration + 9 instant). Editing one with "adjust" writes the
  override keyed by `process_label` instead of `step_id`, so it propagates to
  every instance of that step type ("this step type is actually waste"); a
  more-specific per-step_id override still wins on conflicts. The
  normalization side (`analysis_waste.classify_waste`) reads the new scope
  through `analysis_common.overrides_by_process_label` and stamps
  `process_label` onto each waste entry so the merge is identical in Python
  and JS (`viewer/views/analysis-view.js`, `viewer/styles.css`,
  `normalization/analysis_waste.py`, `normalization/analysis_common.py`).
- **The capture tray's legacy status window and standalone OBS-settings window
  are gone.** `status-window.js` + `ui/status-window.html` were the kept-for-one-
  release fallback before the Live Session window subsumed their counters, recent
  events, and quick actions; `obs-settings-window.js` + `ui/obs-settings.html` are
  subsumed by the new Settings window's Video/OBS section. The "Help & config"
  submenu collapses to just "Help" — config no longer lives there, since Settings
  and Profile are top-level. The capture README + help-window doc reflect the new
  IA, and `package.json`'s build files list is updated (it was both stale —
  referenced the deleted `status-window.js` — and incomplete: missed several JS
  modules) (`capture/main.js`, `capture/package.json`, `capture/ui/help-window.html`,
  `capture/README.md`, `capture/operator-panel.js`).
- **Consolidate the eight `parse_ts` copies into one shared helper.** Each
  pipeline module (`analysis_common`, `bpmn_observed`, `canonical_match`,
  `case_assignment`, `coalesce`, `stats_compute`, `step_suggest`, `xes_export`)
  carried its own near-duplicate ISO-8601 parser — the same surface, three
  fallback semantics (raise / `None` / epoch). The behaviour now lives in
  `normalization/_dt.py` as three named modes (`parse_ts`, `parse_ts_or_none`,
  `parse_ts_or_epoch`); each module re-exports the right one so no caller
  changes. Removes the drift surface that produced the recent tz-naive bug in
  the first place; the family-wide guard (`test_parse_ts_consistency.py`) now
  also covers the shared helper directly.

### Fixed

- **Chromium web-content interactions now reach the recorder out of the box.**
  The C# UIA recorder previously relied on Chrome's accessibility tree being
  already enabled — which Chrome only does lazily, after an external
  accessibility tool queries it. On a stock user-launched Chrome this meant the
  recorder captured only the omnibox / browser chrome and was silent on the web
  content the user was actually working in. A real Salesforce / ServiceNow /
  web-ERP session would produce a session log that contained next to nothing
  analytical, even though the recorder appeared healthy. `UiaSubscriber.Start()`
  now (a) does a **synchronous wake on Start** so any Chromium window already
  up has its AXTree built before the first event of interest could fire, then
  (b) runs a **ramped background poller** — 250 ms ticks for the first 5 s
  (catches windows opened after session start), settling to 1 s after that. The
  targeted query uses a cached `OrCondition` over the Chromium family of window
  classes (`Chrome_WidgetWin_0..3`, `ApplicationFrameWindow`) plus
  `FrameworkId == "Chrome"` so it covers Chrome, Edge, Brave, Electron-host
  apps, and Win11 Chromium variants without an every-second top-level-window
  walk. With the fix, a real httpbin.org form-fill on a plain Chromium produces
  16 real interactions with labelled inputs (`Customer name:`, `E-mail
  address:`) and the typed values, identical to forcing
  `--force-renderer-accessibility`. Edge (`msedge.exe`) is observed identically.
  A `capture/test/wake-up.smoke.test.js` smoke test guards the wake-up against
  silent regression (`capture/recorder/UiaSubscriber.cs`,
  `docs/architecture/CAPTURE.md`, `docs/DEPLOY.md`).
- **`recorder_died` event no longer fires on clean shutdowns.** The exit
  handler used to emit `recorder_died` on every recorder process exit —
  including the normal end-of-session shutdown, where the tracker has just sent
  `recorder_stop` and the C# process exits with code 0. Every session log
  carried a misleading "recorder_died" entry. The handler now treats
  `code === 0 && !signal` as a clean shutdown and skips both the
  `recorder_died` emission and the auto-restart path. The `recorder_died`
  event keeps its documented "the recorder crashed" semantics from the schema
  (`capture/main.js`).
- **`case_assignment._explicit_field_matches` no longer crashes on a malformed
  anchor template.** A template that put a dict under `case_anchor.field` (a
  misreading of the schema — `field` is the property NAME, not a match spec)
  used to take the whole normalize run down with
  `TypeError: unhashable type: 'dict'`. The function now warns and treats the
  bad input as no-match so a single typo doesn't lose the rest of the analysis
  (`normalization/case_assignment.py`).
- **Starting a capture session is instant — no more ~5s freeze when OBS isn't
  running.** `startSession()` awaited a best-effort `setupOBS()` on the critical
  path, so a missing or idle OBS held up the start by the OBS WebSocket
  connect-timeout (~5 seconds, every time). Best-effort OBS now connects in the
  background after the session folder + tracker + recorder are already live; if
  and when OBS connects, `attachObsRecording()` wires the video-sync record into
  the running session and fires the `obs_recording_start` system event. Strict
  mode (`config.obs.required = true`) is unchanged — it still awaits up front so
  a forced-OBS failure tears down before any session folder is created. Verified
  by the new `_pdt_verify/capture-smoke.js` Playwright driver: `pdt:startSession`
  resolves in 625–685 ms with OBS unreachable (`capture/main.js`).
- **Two blocking modals on the session-start path replaced with non-blocking
  toasts.** A `validateConfig` warning ("Engagement ID is still 'default'") used
  to halt with a `Start anyway / Cancel` dialog, and the once-only "recording
  without OBS video" hint was a full `dialog.showMessageBox`. Both are now
  `notifyUser()` toasts — starting always proceeds; the once-only hint keeps its
  `userData/obs-hint-shown.json` flag and surfaces only the first time best-effort
  OBS fails (`capture/main.js`).
- **First-session `recorder.zip` extraction no longer freezes the start.** The
  >100 MB `recorder.zip` was synchronously extracted via `spawnSync("tar", …)`
  inside `resolveRecorderPath` the first time a session started — a multi-second
  freeze on first capture after install. `recorder.js` now exposes an async
  `ensureRecorderExtracted()` that runs during `app.whenReady()`, shows a
  "Preparing interaction recorder" notification while it runs, and resolves to a
  no-op when `recorder.exe` is already on disk. The sync extraction remains as a
  safety fallback but is no longer reached on the normal session-start path
  (`capture/recorder.js`, `capture/main.js`).
- **Analysis no longer crashes on a corrupt log record whose `data` is null or
  not an object.** A truncated or hand-edited `events.jsonl` line carrying
  `"data": null` (or a non-dict `data`) aborted the whole run with an
  `AttributeError` / mapping `TypeError` during case detection and stamping — the
  timestamp path already degraded to a fallback, but the `data` path did not.
  Every `data` access in `normalization/case_assignment.py` now treats a missing
  or non-dict payload as empty (the record is preserved and left uncased), so a
  single bad line degrades instead of failing the session. Found by a new seeded
  property-based fuzzer over the case-assignment pipeline
  (`normalization/test/test_case_assignment_fuzz.py`).
- **Statistics no longer crash on a corrupt duration or case timestamp.** A
  hand-edited `events.jsonl` could carry a non-numeric `duration_ms` or a
  non-ISO case timestamp (the load-time shape coercion guarantees `data` is a
  dict, but not its value types). `activity_stats` / `case_stats` then crashed on
  `sum()` / timestamp parsing — taking down the whole statistics step that feeds
  the PDD tables, the findings report, and the Analysis view. Such values now
  degrade to 0 / an unknown duration. Found by a new seeded fuzzer over
  `stats_compute` (`normalization/test/test_stats_compute_fuzz.py`).
- **Step suggestion no longer crashes on a corrupt log — a non-string field or a
  mixed-timezone timestamp.** Two reachable crashes in the segmentation path,
  surfaced by a new seeded fuzzer over `auto_suggest_steps`: the shared
  recognition classifier ran `.lower()` / substring matching on `class_name` /
  `control_type` and threw if a hand-edited record made one a non-string
  (`recognition.py` + `viewer/recognition.js` now coerce, keeping the Python/JS
  pair in lock-step); and `step_suggest.parse_ts` returned a naive datetime for a
  zone-less timestamp but tz-aware for the rest, so a case mixing them died with
  "can't subtract offset-naive and offset-aware" — it now normalizes to UTC.
- **The same timezone normalization now applies to every `parse_ts` copy across
  the pipeline.** A zone-less timestamp parsed naive in `analysis_common`,
  `bpmn_observed`, `canonical_match`, `case_assignment`, `coalesce`,
  `stats_compute`, and `xes_export` too — the same latent crash, reachable
  wherever those compare or subtract timestamps. All eight copies now return a
  tz-aware datetime; a family-wide guard (`test_parse_ts_consistency.py`) keeps
  them from drifting apart again.
- **A single-case observed BPMN renders as the path it actually took, not a
  mined model.** `write_observed_bpmn` ran the lone case through PM4Py's
  inductive miner regardless — but a single case is one observed path with
  nothing to generalize. When a step label recurred in that one trace (a
  re-entered field, or the value-free `process_label` collapsing two entries to
  one name) the miner turned the repeat into optional/loop gateways the lone
  path couldn't justify, and being block-structured smeared those diamonds
  across the whole diagram even around unrelated steps. A `len(log) == 1` path
  now builds the BPMN as a literal `start → t1 → … → end` chain (new
  `_linear_bpmn`), so one case renders as the path it actually took and a
  recurring step simply appears again in sequence (`normalization/bpmn_observed.py`).
- **The Phases view no longer shows a blank bordered box when a session has no
  phases.** An un-phased session (the common starting state) left the phase
  timeline as an empty void; it now shows a centered hint ("No phases yet —
  group steps into phases…"), matching the empty-state treatment used elsewhere
  (`viewer/phase-editor.js`).
- **The Analysis view now refreshes after an in-app "Analyze session".** A
  re-analyze wrote `analysis.json` and reloaded the session, but
  `loadSessionIntoView` re-rendered the Flow, Steps, and Phases levels and *not*
  the Analysis level (which was added later) — so the view kept saying "No
  analysis available" despite "Analysis complete," until the session was
  reopened. It now re-renders on every (re)load (`viewer/views/flow-view.js`).

## [0.16.3] - 2026-05-25

### Fixed

- **Analysis no longer crashes when a session's Process Template file is missing.**
  A session matched against a template on one machine remembers that template's
  path; opened on a machine that doesn't have the file (a hand-off), re-analysis
  died with `FileNotFoundError` and the session couldn't be analyzed at all. A
  missing, unreadable, or malformed template is now treated as "no template" — the
  run logs a warning and proceeds without it (`normalization/canonical_match.py`,
  `normalization/normalize.py`, `viewer/python-runner.js`).

## [0.16.2] - 2026-05-25

### Changed

- **The Session view's top is far less cluttered at laptop widths.** The action
  bar packed eight buttons (wrapping to three rows on a 13" screen), and the
  process-map status, the session chips, and the Session Summary each took their
  own row — pushing the timeline a third of the way down the screen. Occasional
  actions (Match Process Template, Classify activities, Save to App Library, Attach
  & Sync video) and the *Build process map* setting now live behind one visible
  "⋯ More" menu; the process-map status rides the slimmed action row; the chips sit
  on a single line; and the level switcher (Flow / Steps / Phases / Analysis) is
  promoted above the Session Summary. The timeline now starts ~50px higher and the
  bar no longer wraps at 1100px (`viewer/index.html`, `viewer/renderer.js`,
  `viewer/styles.css`).
- **The Steps editor and the header are tidier at laptop widths too.** The Steps
  bulk actions (Group / Delete / Merge selected) used to sit permanently greyed-out;
  they now appear only when 2+ steps are ticked, and the single-key shortcut list
  (J / K / S / M / N) is demoted from a full inline row to a hover hint. The
  decorative "Capture · Mine · Synthesize" tagline is hidden below 1200px and the
  top tabs no longer wrap, so the header stays a single row on a laptop. Together
  with the change above, the Session timeline starts ~90px higher at 1100px
  (`viewer/index.html`, `viewer/views/steps-view.js`, `viewer/styles.css`).

### Fixed

- **Dialog body text no longer clipped or mis-aligned.** Every non-Help popup
  (e.g. "Classify activities") inherited the Help modal's two-column grid, so its
  body was squeezed into the 200px nav column and clipped on the left while the
  footer jumped to the top. The base modal is now a single flex column with a
  padded, left-aligned, scrollable body and a footer pinned bottom-right; the
  two-column grid is scoped to the Help modal alone via `:has(.help-nav)`
  (`viewer/styles.css`).
- **BPMN Process diagram: event names stay on their node, and flows converge
  straight into the end.** After the dagre relayout a node's *name* — a separate
  external label, not drawn inside the box — was left behind at the node's old
  position (the "Start label fell off the start mark box"); each external label now
  moves with its node. Separately, a block-structured miner closes every branch
  with a matching join, so the map ended on a gateway whose only exit was the
  terminal node — a merge diamond that reads like a decision branching into nothing
  (and an XOR-join carries the identical symbol to an XOR-split, so it is genuinely
  misleading). Such a terminal join is now collapsed: its incoming flows reconnect
  straight to the end node so the branches converge directly, while a meaningful
  mid-process join is left intact (`viewer/bpmn-viewer.js`).
- **BPMN external labels are legible in dark mode.** Event and gateway names float
  on the canvas rather than inside a box, and bpmn-js paints them near-black, so
  they vanished against the dark canvas. They now take the foreground colour while
  internal task labels (on their white boxes) stay dark (`viewer/styles.css`).

## [0.16.1] - 2026-05-24

### Changed

- **The BPMN Process diagram lays out cleanly now.** Its coordinates came from a
  hand-rolled routine, so `end` stranded mid-diagram with crossing edges, and the
  drag-to-reorganize affordance was really there to compensate. It now re-lays-out
  with **dagre** — the same layered, crossing-minimised engine that lays out the
  Flow diagram (DFG) cleanly — into a left-to-right flow, then makes that the
  baseline. Flows follow dagre's **node-avoiding** routing (a long edge runs in
  the lane between node rows instead of cutting through an unrelated box). The
  diagram stays draggable (bpmn-js Modeler) for manual nudges, but a clean layout
  is the starting point (`viewer/bpmn-viewer.js`).

### Fixed

- **Middle-clicking the Flow timeline pans it instead of locking up.** Middle-click
  on the scrollable timeline triggered Chromium's native auto-scroll, which bounced
  erratically toward the cursor and left the page in auto-scroll mode so the next
  click was swallowed ("locked controls"). Middle-button now drag-pans the timeline
  (the native behaviour is suppressed); any mouse release ends the pan cleanly so it
  can't stick (`viewer/views/flow-view.js`, `viewer/styles.css`).

## [0.16.0] - 2026-05-24

### Added

- **Aligned reading of repeated work — curate one ticket, apply to all.** The
  Steps view gains a **Flat / Aligned** toggle. Aligned shows the consensus
  **backbone** across the session's detected cases — each step with a frequency
  pill ("seen in 10/12 cases") and its aligned instances (jump to any in Flow).
  Editing a backbone step's name / description / flags and clicking **Apply to all
  N instances** propagates the curation to every case in a *single* annotations
  write, so one Ctrl+Z reverts the whole thing. Steps a single case has that the
  consensus lacks surface as **exceptions**, edited in place. The per-step filter
  hides in Aligned mode and the toggle shows only with 2+ cases (ADR-0015 phases
  2–4; `viewer/step-alignment.js` `alignCases`, `viewer/views/steps-view.js`,
  `viewer/step-editor.js`).
- **Recognition-driven case anchors.** A case anchor can now be named by a
  *recognised* platform signature (`case_anchor.recognized: "search"`, ADR-0011)
  instead of an engagement-specific `automation_id` — composable with a value/label
  pattern, with the explicit id rule kept as a fallback. Case detection generalises
  across apps without per-engagement selectors (`normalization/case_assignment.py`;
  ADR-0012 #7).
- **Step-level statistics (resolves the activity/step stats split-brain).**
  `stats.json` now carries `step_stats` — per-step-name frequency + duration
  distribution (mean / median / p90 / p99), the step-level analogue of
  `activity_stats` — and the Markdown report gains a **Step statistics** table
  beside the Activity one, so the stepped view gets the same treatment as the
  activity view (`normalization/stats_compute.py`, `viewer/report-md.js`).
- **Team-wide taxonomy promotion.** `classification.upsert_taxonomy_rules`
  writes analyst rules directly into a shared `taxonomy.yaml` (de-duped,
  preserving other keys) so they classify every future session — the
  direct-write companion to the existing hand-merged "promote to taxonomy"
  export. (Backend; the in-app button + the choice of which file is the team
  taxonomy still need wiring for the locked-down deployment.)
- **Rearrange the process map by dragging — and it sticks.** The BPMN process
  map now uses the bpmn-js Modeler instead of the read-only viewer bundle, so:
  drag a box to reorganize the auto-layout, click a box to drill to the source,
  and scroll-to-zoom / drag-to-pan actually work (the old bundle had no
  navigation at all). Dragged positions are saved back to the `.bpmn`, so they
  survive a level/tab switch and re-opening the session; a re-analyze
  regenerates the map and resets it. The create/delete editor chrome is hidden,
  so it stays a move-only layout tool (`viewer/bpmn-viewer.js`, `viewer/index.html`,
  `viewer/styles.css`).
- **Team-taxonomy promotion is in-app.** The Classify-activities manager gains a
  "Save to team taxonomy…" button: pick or create a shared `taxonomy.yaml` and
  the labels are merge-upserted into it (dupes skipped, other keys preserved),
  so they classify every future session — not just this one
  (`viewer/views/flow-view.js`, `viewer/main.js`, `viewer/ipc.js`).
- **Flow-diagram layout persists.** Dragging a node in the Flow diagram now
  survives a level/tab switch and re-open, saved per exact node set so a changed
  graph (after re-analyze) gets a fresh layout (`viewer/dfg-viewer.js`).
- **Click a map node to drill down a level.** On the process map, clicking a
  phase node descends to the step level and a step node to the activity level
  (phase→step→activity); the activity level still drills to the source session
  (`viewer/views/aggregate-view.js`).
- **Drill-down now scopes to the clicked node's children (Flow diagram).**
  Clicking a phase node descends to the step level showing only that phase's
  steps; clicking a step node descends to the activity level showing only the
  activity labels seen inside that step. A "scoped: <parent> · show all" chip in
  the map header is the inverse. The Process diagram (BPMN) is a static mined
  file, so there a click descends unfiltered, as before
  (`viewer/views/aggregate-view.js`, `viewer/process-map-levels.js`).
- **Rare-path frequency slider for the Flow diagram.** On a long, dense recording
  the map can carry many low-frequency deviations. A slider sets the minimum edge
  frequency shown — at 1× every path shows; raising it hides paths seen fewer than
  N times, the live label reading "≥ N× (M hidden)". The cutoff is clamped to the
  busiest edge so the map is never blanked, and the slider disables when there is no
  frequency spread to thin. (Generalises the earlier binary "hide rare paths"
  toggle — `viewer/process-map-levels.js` `dropRareEdges`,
  `viewer/views/aggregate-view.js`; ADR-0013 #5.)

### Fixed

- **Divergent steps no longer vanish from the aligned reading.** A step a case
  performs differently from the consensus (a substitution) was aligned diagonally
  and counted as neither a backbone member nor an exception — it disappeared from
  the analyst's view entirely. Every non-hidden step now surfaces as exactly one
  or the other, guarded by a property-based fuzzer (`viewer/step-alignment.js`,
  `viewer/step-alignment.fuzz.test.js`).
- **Normalization survives a corrupt or hand-edited `events.jsonl`.** A
  valid-JSON-but-non-object line (`123` / `"x"` / `[]` / `null`), a
  numeric/null/missing timestamp, a null or missing `data`, a missing `event_id`,
  or a non-string interaction `kind` each used to crash the whole run with an
  uncaught exception. `load_events` now drops non-object lines (like malformed
  JSON) and a boundary guarantees the event shape every downstream stage relies
  on; `parse_ts` falls back rather than throwing (`normalization/normalize.py`,
  `normalization/step_suggest.py`).
- **A repeated recorder `hello` no longer double-captures.** The C# recorder
  reassigned its UIA subscriber on a second `hello` without stopping the first,
  leaking its handlers so every interaction was recorded twice (a silent
  data-integrity bug). `hello` is now idempotent (`capture/recorder/Program.cs`).
- **Anchor case detection tolerates bad timestamps + a misconfigured regex.** A
  non-ISO timestamp on an anchor event, or a typo in a template's
  `case_anchor.matches` regex, crashed the run; timestamps now fall back to the
  epoch and an invalid regex warns + matches nothing
  (`normalization/case_assignment.py`).
- **Empty serial-box clicks no longer fragment case detection.** A focus or
  click on the case-anchor field before anything is typed fired the anchor with
  an empty value, opening a throwaway empty-label "case" that the
  degenerate-case guard then dropped — orphaning the interactions that had been
  stamped to it. Such empty-value fires are now ignored, so the work stays
  attributed to the ticket in progress (`normalization/case_assignment.py`,
  mirrored in `scripts/count-cases.js`).
- **Step / Phase BPMN export is no longer empty.** The export buttons emitted a
  bare Start→End because they ran the template-derived BPMN path with no
  Process Template. They now export the **observed-flow** Step/Phase diagram —
  the same `process_map_step|phase.bpmn` the viewer displays — mining it first
  if needed (`viewer/renderer.js`).
- **Re-analyze keeps curated step→phase / step→template links.** A re-analyze
  regenerates auto steps with new ids, so a phase's `step_ids` (and any template
  link) on a step that was grouped but not otherwise edited used to dangle — the
  grouping was silently lost. A fresh step now inherits the prior step's id and
  curated `phase_id` / `canonical_step_id` when it re-covers the same
  interactions (`step_suggest._merge_steps` / `_inherit_step_identity`).
- **Recorder windows no longer occlude screenshots on a single monitor (D3).**
  The capture dims its own always-on-top windows (panel / label picker / status)
  to opacity 0 for the duration of each grab and restores them in a `finally`,
  so the worker's screen is captured cleanly even with one display
  (`capture/screenshots.js`, `capture/main.js`).
- **Step-level Flow / map no longer explodes into one node per case.** Auto step
  names embed each case's values ("Search — CUST-10101", "Enter 25 in Quantity"),
  so every case produced unique nodes and the step-level diagram became a
  hairball (unusable on a long recording). A value-free `process_label` collapses
  the same kind of step to one node — computed **live** in the viewer
  (`process-map-levels.js`) so the Flow collapses without a re-analyze, and
  stamped at normalize (`step_suggest.process_label`) for the observed-flow BPMN,
  so both diagrams agree.
- **Raw Events panel no longer paints over the Steps screen.** A `min-height:0`
  re-added to `.session-layout-stepsphases` (to bound the editor) had silently
  undone the earlier overlap fix (commit `1833fb5`): the column could shrink
  below its content, so an open Raw Events panel overflowed and overlapped the
  editor instead of scrolling. Removed it, with a comment so it isn't re-added
  (`viewer/styles.css`).
- **Dead Flow / Steps / Phases switcher removed from Compare Sessions.** The
  three-button level switcher in the aggregate toolbar wrote to a state value
  nothing read, so clicking it only moved the highlight and re-rendered the same
  view. The process-map level is set by the "Activity / Step / Phase level"
  dropdown beside the map; the orphaned control and its backing state are gone
  (`viewer/index.html`, `viewer/renderer.js`, `viewer/state.js`).
- **Analysis time study and step statistics no longer fragment per instance.**
  The cross-session time study, `step_stats`, `step_variants`, and the pooled
  automation candidates grouped steps by `canonical_step_id` / raw `step_id` or
  raw name, so with no Process Template every order made its own row — an endless,
  near-valueless list ("Salesforce: Search — CUST-10900", "— CUST-10901", …). They
  now fall back to the value-free `process_label` (the same abstraction the process
  map uses), so a step seen across N orders collapses to one row with `instances=N`
  ("Salesforce: Search · 4"). New shared `step_group_key` / `step_group_label`
  helpers in `analysis_common.py`; applied in `analysis_time_study`,
  `analysis_automation`, and `stats_compute`.

### Changed

- **Recognition signature table is now shared (ADR-0011 follow-ups 1–2).** The
  platform/framework signatures moved to `shared/recognition-patterns.json`,
  loaded by both the viewer (`viewer/recognition.js`) and the Python pipeline
  (new `normalization/recognition.py`). The step auto-suggester's browser-chrome
  noise filter now uses the shared recognition instead of its own hardcoded
  class list, so the viewer and the pipeline classify interactions identically.
- **Activity classification leads with framework recognition (ADR-0011 follow-up
  3).** When the window-title taxonomy doesn't match an activity, its label is
  now derived from the dominant framework-recognised category of the
  interactions in that window ("Form entry", "Data grid", "Search", …) instead
  of "Unclassified — app", so the activity map shows meaningful work even with
  no taxonomy. The taxonomy still owns business labels (it wins);
  `normalization/classification.py`.

## [0.15.0] - 2026-05-23

### Added

- **Recorder stays reachable (D1).** The Live Session window and the
  Start-marker picker now sit at the highest always-on-top level, so they
  stay above other applications instead of disappearing behind them. During
  an active session a left-click on the tray icon brings the Live Session
  window to the front (right-click still opens the menu) — so you can always
  reach Stop / markers without resorting to hotkeys.
- **Interactions are colour-coded (A1).** In the step detail, each interaction
  is tinted by kind — value entry (amber), action (blue), selection (teal),
  toggle (purple) — so a step reads at a glance instead of as a text wall.
- **Choose where a step splits (A2).** Each interaction has a scissors control;
  click it to set the split boundary, and Split cuts there instead of always at
  the interaction-count midpoint (it still falls back to the midpoint).
- **Step timeline context menu (A5).** Right-click a step block to split, merge,
  rename, hide/unhide, jump to Flow, watch, or flag as waste / automation.
- **Step flags are visible and reach outputs (A3).** Flagged steps are badged in
  the list (waste steps are also struck through), the toolbar shows a flag-count
  summary, and the per-session report gains a Steps table with a Flags column.
- **Process map at step or phase level (C1b).** A depth selector builds the Flow
  diagram from your steps or phases (one trace per case), so the map is
  meaningful even with no taxonomy. A blank activity map auto-falls-back to the
  step/phase level when annotations exist.
- **Unclassified-activity warning + classify-in-place (C1a).** The Flow view
  warns when most activity is unclassified (why the application map looks empty),
  and a right-click "Classify this app…" on an activity band adds a taxonomy rule
  and re-analyzes.
- **Configurable hotkeys (D2).** The session-setup window records the four
  recorder shortcuts via a live key-capture — no more hand-editing the YAML.
- **In-app classification manager.** A "Classify activities…" action lists every
  application observed in the session and lets you label each in one place
  (writing per-session classification rules) and re-analyze — the bulk companion
  to the per-band "Classify this app…", so an empty application-level map can be
  fixed without hand-editing taxonomy YAML. The unclassified-activity banner
  links to it.
- **Platform/framework recognition layer (ADR-0011).** Interaction recognition
  is anchored on documented, cross-app platform signatures — the UIA
  ControlType taxonomy plus Chromium/Edge chrome, Bootstrap, AG-Grid,
  SharePoint, Office 365 and Win32/Office conventions — instead of one
  engagement's opaque automation_ids. Steps align across tickets by semantic
  category, unnamed elements read as their real type ("a data-grid cell"), and
  per-session selectors (`txtsr`, window-title taxonomy) drop to examples.
- **Step- and phase-level Process diagram (observed flow).** The Process diagram
  (BPMN) now renders at Step and Phase levels, not just Activity — each mined
  from your actual annotated step/phase flow (with its branches), the BPMN
  counterpart of the Flow diagram. Notation (Process diagram / Flow diagram) and
  level (Activity / Step / Phase) are now fully independent controls: changing
  one never resets the other.

### Changed

- **Case segmentation now uses active-case stamping.** A case_id is stable per
  anchor label (e.g. a serial number), so re-searching the same value resumes
  its case instead of opening a new one, and every event is attributed to the
  most-recently-anchored case — correct even when work on several cases
  interleaves. A degenerate-case guard drops slivers (under ~2 interactions or
  ~1s). This replaces the old gap/pause split, which inflated a couple of
  repeated searches into a dozen "cases".

### Fixed

- **Marker screenshots captured the recorder instead of the work (D3).**
  Firing a marker moves focus to the recorder's monitor, so the screenshot
  showed the recorder UI. Screenshots now aim at the last work-window's
  monitor — the recorder's own windows are excluded from that tracking — so a
  marker captures what the worker was doing. (Single-monitor occlusion, where
  the panel physically covers the work app on one screen, is a separate
  pre-capture follow-up.)
- **The session name entered at setup was never shown (D4).** The project name
  typed in *Set up a recording session* was stored only inside the config
  snapshot and surfaced nowhere. It is now a first-class manifest field
  (`engagement_name`), used as the name in the recents list and shown in the
  viewer's session summary. Existing sessions fall back to the config snapshot.
- **The selected-step pane dragged both panes taller (B1).** The Steps editor
  now pins its row to the available height; each pane scrolls internally, so
  expanding a step's interactions no longer pushes the step list off-screen.
- **Typing into several fields collapsed into one step (A4).** Step suggestion
  now ends a step when typing moves to a different field, so filling N fields
  yields N steps instead of one glued blob. Type-then-click coupling (e.g. type
  a serial then click Search) is preserved; gated by a default-on config flag.
- **Step merge is the clean inverse of split.** "Merge with next" always merges
  the step with the one after it; a separate "Merge selected" merges exactly the
  ticked steps — so one control no longer silently merges the wrong pair. Merge
  is now offered wherever split is (step detail, context menu, toolbar, and the
  M shortcut).
- **The map level selector no longer hijacks the notation.** Choosing Step or
  Phase changes the level in place on the current diagram instead of yanking you
  onto the Flow diagram, and switching diagram keeps the chosen level.
- **The repeat badge is signal, not noise.** A step is badged ("N×") only when
  it recurs in some — but not all — cases; a step that recurs in every case (the
  uniform backbone) gets no badge. "Apply to repeats" stays available regardless.
- **Legends for the new encodings.** A colour key for the interaction-kind bars
  and a one-line key for the repeat badge, so neither reads as an unexplained code.

## [0.14.4] - 2026-05-19

### Added

- **Flow → Steps navigation.** Clicking anywhere on the Flow timeline
  (a band, a marker, a screenshot, or the new right-click "Jump to
  step here" item) parks the timestamp; the next time you open the
  Steps view, the step containing (or closest to, by nearest edge)
  that timestamp is selected and scrolled into view. The Flow
  timeline's right-click menu now opens on the background too, not
  only on case / activity bands.

### Fixed

- **Step times disagreed with the Step timeline axis.** The step
  detail tiles (Start, End) and the interaction-list times used the
  raw UTC portion of the ISO timestamp, while the timeline axis above
  used local time — the step detail showed 08:55:07 next to a 10:55
  axis label on the same step. All step times now render in local
  time.
- **The selected step block on the Step mini-timeline was almost
  invisible.** Replaced a 1-px muted outline with a 2-px accent
  outline plus a brightness/saturate boost and a z-index lift so the
  highlight reads on every block colour.
- **Screenshot dots on the Flow timeline blinked on hover with no
  preview.** The hover-thumbnail used an unresolved relative path and
  could never load; removed the wiring. The dot still scales subtly
  to acknowledge the hover.
- **Clicking a screenshot in the gallery only seeked the video.** It
  now also opens the screenshot full-size, matching the behaviour of
  the dot icon on the timeline.

### Known issues

- The right-click **Jump to step here** item correctly pre-positions
  the Steps view (the right step is selected and scrolled when you
  switch tab), but does not yet auto-switch to Steps — you still have
  to click the Steps tab after picking the menu item.

## [0.14.3] - 2026-05-19

### Fixed

- **The Steps-view step list had dead space below the rows and was too
  short on a laptop viewport.** The v0.14.2 cap was viewport-height
  based, so on a ~800-px-tall laptop the list got capped to ~200 px
  (~7 rows) while the pane stretched taller to match the selected-step
  editor. The list pane is now a flex column and the step list fills
  the remaining pane height (driven by the editor's content via the
  grid row), with a 350-px floor so the list is always tall enough to
  navigate.

## [0.14.2] - 2026-05-19

### Fixed

- **The Steps-view scroll change shipped in v0.14.1 broke the editor
  panes** — transparent panes with content scrolling through them, the
  selected-step editor and the raw events bleeding into the background.
  Reworked as a plain max-height cap on the step list (with a floor) so
  it cannot collapse the panes. The step list scrolls within its own
  pane and the selected-step editor stays in view as you scroll the
  list.

## [0.14.1] - 2026-05-19

### Changed

- The step interaction list and auto-generated step descriptions now
  phrase every recorder event kind — including toggle / checkbox
  changes ("Turned Remember me on") and payload-less text-change
  notifications — with a graceful generic fallback for any future kind.
  Descriptions read as one sentence per action.
- Auto-detected step names now carry the value the step acted on —
  "Search — SN12345" rather than a bare "Search", "Enter SN12345 in
  Serial Number" rather than "Fill Serial Number" — so a step is
  recognisable from the list without opening its interactions.

### Fixed

- In the Steps view a long step list scrolls within its own pane again,
  with the filter bar pinned; the selected-step detail stays in view no
  matter how far down the list you scroll.

## [0.14.0] - 2026-05-19

### Added

- **A step now shows what it interacted with, not just how many
  interactions.** The step detail panel showed a bare count, so
  understanding a step meant cross-referencing the raw event stream by
  hand. It now lists each interaction as a readable line — *Typed
  "SN12345" into Serial Number*, *Clicked Search*, *Selected "Resolved"
  in Status* — collapsible, with the full typed values shown.

- **Auto-detected steps are now self-describing.** An auto-suggested
  step had an empty description. It now carries a generated prose
  summary of what it did — *"Entered 'SN12345' into Serial Number (20
  keystrokes), clicked Search."* — with full field values and the
  keystroke count behind a coalesced typing burst, so a step reads
  meaningfully in the list and in exports without anyone drilling into
  the events. An analyst's own edits to a step survive re-analysis as
  before.

## [0.13.0] - 2026-05-19

### Added

- **Canonical step rules match controls flexibly.** A match rule
  previously compared three fields for exact equality. Rules now accept
  `contains`, `starts_with`, and `matches` (regex) operators over six
  fields — control type, AutomationId, name, value, class name and
  framework ID — so a template can target a control by a stable part of
  its label instead of its full, volatile text.

- **A step rule can declare how far the step extends.** Each canonical
  step carries a `boundary` mode that decides which following events it
  absorbs: `single`, `until_app_change`, `until_pause`,
  `until_field_change`, `until_next_step`, or the default
  contiguous-group behaviour — so a template can describe a step that
  spans a stretch of work, not just one click.

- **Cases can be detected from a recurring field value.** A template
  can name a *case anchor* — a control whose value identifies the work
  item (a ticket number, a serial). The pipeline opens a new case each
  time the anchor changes value and stamps every interaction and
  activity in that span, so a recording of repeated work splits into
  one case per item with no manual markers.

- **Keystroke runs are coalesced as an early pipeline stage.** Typing
  reaches the pipeline as one `value_changed` event per keystroke. A
  dedicated stage now folds a run of edits to one control into a single
  event carrying the final value before any later stage sees the
  stream, with a prefix guard so two different fields typed
  back-to-back are kept apart.

### Changed

- **Automatic step suggestion fragments less.** With no canonical
  template, step suggestion no longer starts a new step on every app or
  window switch, and tolerates a longer idle gap (10 s) and more
  interactions (60) before splitting. It does start a fresh step after
  a completion action — a click on a button or link labelled "search",
  "submit", "save" and the like.

## [0.12.2] - 2026-05-19

### Fixed

- **A browser-heavy recording still fragmented into hundreds of
  auto-detected steps.** Step suggestion started a new step on every
  change of the raw window title, and web-app titles carry volatile
  text (a live memory counter, the "- Microsoft Edge" tail), so the
  *same* application read as a fresh step over and over. Segmentation
  now keys on the stable app prefix — the title up to its first
  separator, the same label it already uses for naming — so a window
  whose title only churns cosmetically no longer splits the step.

- **Auto-suggested phases were unusable.** "Suggest groupings" bundled
  any steps less than 30 s apart and treated every browser tab as one
  app, so a dense session collapsed into two or three enormous
  "Mixed-app phase" blobs. It now groups steps into continuous-work
  blocks — runs with no idle pause longer than two minutes between
  them — and names each phase after its dominant app.

- **A phase could not be deleted or split.** The phase detail pane had
  no height limit, so a phase with many steps pushed its Save / Delete
  buttons off-screen; the step list now scrolls within a fixed height.
  "Split" was wired to nothing — each step row in a phase now carries a
  split control that moves that step and everything after it into a new
  phase.

- **"Jump" on a raw-events row did nothing without a video.** The jump
  action, and clicking an event row, only seeked a video. With no
  recording linked it now moves the Flow timeline playhead to the event
  and scrolls it into view.

## [0.12.1] - 2026-05-19

### Fixed

- **A recorded session of browser work produced hundreds of unusable
  auto-detected steps.** Typing into a web-app field reached step
  suggestion as a flood of per-keystroke `value_changed` events: the
  recorder's debounce coalescer keys on a control's AutomationId or
  Name, and Chrome exposes neither on most web inputs, so it silently
  skipped them — then the step interaction cap sliced one typed value
  into five or six fragment "steps" with growing-prefix names. Step
  suggestion now coalesces a run of `value_changed` events on one
  control before it segments, and folds the browser's repeated
  same-tab `selection_changed` re-fires; a step name no longer echoes
  the window title back as its own label. The recorder's coalescer
  also gained a UIA RuntimeId fallback so identity-less web fields are
  coalesced at capture time in new recordings. Existing sessions are
  fixed on the next Re-analyze — no re-recording needed.

## [0.12.0] - 2026-05-18

> Version note: the `v0.11.0` tag carried this same content and was immediately
> re-released as `v0.12.0` (a renumber — there was no separate 0.11.0 feature set),
> which is why the version sequence has no `[0.11.0]` section.

### Added

- **Process Template steps can be identified from the App Library.** A
  step's match rules — the UI patterns that recognise it in a captured
  session — are now composed through a per-step **Match rules…** picker
  that draws on the App Library (the per-app catalog of named UI
  interactions), a basic app/window rule, or an interaction lifted from
  a sample session. Library-sourced rules keep a reference back to the
  catalog entry and show a drift badge when that entry later changes.

- **Inline phase assignment in the Process Template editor.** Each step
  row has a **Phase** dropdown — assign it to an existing phase or
  create one on the spot. The template's `phases` block, which the
  exports roll steps up into, stays in sync automatically.

- **Close and Delete for a Process Template.** The actions bar gained
  **Close** (unload the template from the editor) and **Delete** (remove
  the `.yaml` from disk, with confirmation). Version-history snapshots
  are deliberately kept on delete.

- **Step reordering in the Steps view.** Each step row has up/down
  buttons, and a **Sort by time** action reorders the whole list
  chronologically.

- **Per-row actions in the Raw events table.** A row can now jump the
  video and timeline to its event, spin a new step off it, or add the
  event to the selected step — not just seek.

- **Zoom controls for the Process diagram.** The BPMN process-map tab in
  Compare Sessions gained zoom-in / zoom-out / fit controls, matching
  the Flow diagram.

### Changed

- **The Process Template tab was relaid out.** Two main columns —
  Template steps and Import steps from a session — with the Advanced
  YAML editor demoted from a co-equal third column to a collapsible
  strip below, reclaiming the space for the panels that matter.

- **Clearer naming.** The app-and-window-only match rule is now a "Basic
  match rule" (was "coarse rule"); the bulk step-import panel is now
  "Import steps from a session" (was "Rough-in from a recording").

- **Steps can be multi-selected with a plain click** on their checkbox;
  Ctrl+click still works.

- **The Raw events table uses the available height** instead of a fixed
  360px panel, and stays collapsible.

### Fixed

- **The Match rules… picker rendered in a narrow left strip** because it
  reused a modal layout meant for a nav sidebar it does not have.

- **A manual step added with no video loaded landed far off the
  timeline** — the fallback timestamp was wall-clock now; it is now
  anchored within the session's recorded span.

- **"Merge with next" ignored a multi-selection.** With two or more
  steps selected it now merges exactly those, in chronological order,
  and names what merged.

- **"+ Add interaction" in the App Library gave no sign anything
  happened** — the new row now scrolls into view, briefly highlights,
  and takes focus.

- **The help text mis-described cases and phases.** Cases are derived
  from markers during normalization, not marked during recording; the
  phases text now explains what phases are for and where to define them.

## [0.10.0] - 2026-05-18

### Added

- **Add a step at the video playhead, without leaving Flow view.** A
  "+ Step" button in the timeline toolbar — and the `S` keyboard
  shortcut — create a step boundary at the current video playhead, so
  a manual step can be marked while watching in Flow view instead of
  switching to the Steps view to place it blind. The playhead inside
  an existing step splits it there; in open space it starts a new step
  running to the next boundary; on a session with no steps yet it
  carves the recording into "Step 1" / "Step 2" at the playhead. The
  per-step lane is switched on so the new boundary appears on the
  timeline immediately.

### Fixed

- **Space and the arrow keys double-fired against the video's native
  controls.** When the `<video>` element had keyboard focus, a Space
  or Left/Right press was handled twice — once by the browser's
  built-in media controls and once by the viewer's global shortcut
  handler — so the two play/pause toggles cancelled out and Space
  appeared to do nothing. The global handler now leaves those keys to
  the native control whenever the video element is focused.

- **The session summary panel could be squeezed flat.** After the
  v0.9.0 session-view overlap fix pinned the event-table and log
  panels to their content height, the summary panel was left as the
  only shrinkable element in the scrolling session column — so it
  collapsed, and its `overflow: hidden` clipped the body, leaving it
  unable to open. It is now pinned like its sibling panels.

- **Command palette result clicks and keyboard navigation.** Hovering
  a result rebuilt the whole list on every mouse-enter, swapping the
  row out between mousedown and mouseup so a click never landed;
  selection highlighting now updates in place. Arrow / Enter / Esc /
  Tab navigation is bound at the document level, so it works whenever
  the palette is open rather than only while the search box holds
  focus.

## [0.9.0] - 2026-05-18

### Added

- **The Analysis view's heuristic findings can now be corrected.** The waste
  and automation classifiers ship as provisional estimates — the value-add vs.
  business-required time split is a guess (all active time defaults to
  value-add), and an automation candidate cannot be judged real from a single
  recording. The Analysis sub-view is now interactive: click a step's waste row
  to set how much of its time is business-required overhead, and confirm or
  dismiss each automation candidate. Corrections are saved to
  `annotations.json` with undo, shown immediately, and folded into the analysis
  layer on the next Analyze run — flowing through to `analysis.json` and the
  PDD export.

- **Compare Sessions gained an Analysis panel.** Loading several recordings of
  the same process now pools their heuristic findings: a cross-session time
  study, a per-worker cycle-time comparison, automation candidates scored
  across sessions — a step seen once per session finally has enough instances
  to judge for repetitiveness — and a process-efficiency trend. Each automation
  candidate carries a fingerprint of how its step was performed, so the same
  step compares cleanly from one recording to the next.

### Fixed

- **The session summary's "Where the time went" bars rendered empty.** The
  bar fill was an inline element, so the browser ignored its width and
  height — the percentages showed but the bars beside them stayed blank.

- **The Flow, Steps, and Phases views could overlap the panels below them.**
  With the analysis-log or raw-events panel open, the session layout was
  squeezed below its content height and the video and annotations spilled
  over the panels beneath. The layout now keeps its height and the session
  view scrolls instead.

## [0.8.0] - 2026-05-18

### Added

- **A pass of vocabulary, capture, and viewer polish.** An auto-detected
  step now shows *why* the tool grouped its interactions ("Grouped 8
  interactions in SAP, max gap 4s"). The screenshot gallery collapses a
  run of near-identical frames behind a "(+N near-duplicates)" badge —
  click to expand — computed from a perceptual hash written during
  normalization. A pipeline failure in the analysis log is prefixed with
  a plain-language explanation of the likely cause. The Ctrl+K command
  palette became multi-provider, so the Steps and Phases views
  contribute their own commands, with a ⌘K hint in the topbar. The
  session summary reports **App Vocabulary coverage** per app, and a
  bootstrapped vocabulary is now ranked by how often each control was
  used — rarely-seen controls fold under a disclosure. On the capture
  side: events are written through a 500 ms batching queue (markers and
  lifecycle events still flush immediately); a long idle stretch is
  tagged **at-desk** when the recorder still saw activity, and rendered
  distinctly on the timeline; each activity event and the manifest carry
  window and display geometry, so the viewer badges which **monitor** a
  window was on; and a session that ends with stored sessions over a
  size threshold prompts a cleanup reminder.

- **Comparing sessions, the video, and markers all got sharper.** The
  Compare Sessions view gains a **Group by worker** toggle — the
  activity and case charts split and colour by worker so you can see
  how different people ran the same process; a **side-by-side** mode
  that stacks two sessions' step timelines, shared steps in green and
  divergent ones in amber, with a plain-language summary of where they
  agree; a **conformance overlay** on the Flow diagram that colours
  each node green (matches a Process Template step) or amber
  (off-template) and lists template steps no session reached; a warning
  when the loaded sessions were analyzed against **different taxonomy
  versions**; and a **Variants by: Activity / Step** toggle on the Path
  variations table, so you can compare the analyst's stepped view of
  the process, not just the raw activity sequence. On the Session view,
  a **Sync video** button re-aligns a recording interactively — click a
  moment in the video, then the matching point on the timeline; a
  **▶ Watch** button on each step plays the recording across just that
  step's span; a timeline range can now be **excluded from analysis**
  (step suggestion and statistics skip it) as well as turned into a
  case; re-analyzing a session that already has steps now **asks for
  confirmation** first, since it regenerates auto-detected steps and
  clears the undo history; and every save of `annotations.json` keeps
  **five rotating backups** as a safety net.

- **Projects carry knowledge forward.** A saved project now auto-saves
  a few seconds after you switch tab or view, so a workspace stays
  current without a manual Save. Project files store their session and
  template paths *relative* to the project file, so a project folder
  can be moved or shared without breaking. A project can also carry a
  **team denylist** of apps to leave out of step suggestion — applied
  to any session opened under the project that has no denylist of its
  own — a **Project notes** field, editable from the Project menu and
  included in the findings report, and a **step-template session**:
  open a step-less session under a project that names one and the
  viewer offers to seed it with the template's step structure, each
  step positioned by relative time.

- **Set a project's step template from the menu.** The Project menu
  gains a "Set current session as step template" action: with a
  project open and a session loaded, one click records that session as
  the project's step template, so later step-less sessions opened under
  the project can be seeded from it. Previously the template could only
  be set by hand-editing the project file.

- **One-click HTML findings report.** The Session view's export bar
  gains a "Findings report..." button. It produces a self-contained
  HTML document — process summary, the process map inline, the steps
  table, the waste / automation / efficiency findings, notes, and
  starred screenshots, plus an editable recommendations block — that
  opens in any browser with no external assets. A pre-export dialog
  picks which optional sections to include. Screenshots gain a star
  toggle in the Screenshots panel; only starred screenshots are
  embedded in the report.

- **A process-analysis layer turns a recording into IE-grade
  findings.** After step suggestion, normalization now runs four
  heuristic analyzers and writes an `analysis.json` sidecar: a per-step
  **waste classification** (value-add vs. waiting / motion / rework /
  cross-app overprocessing — the DOWNTIME wastes), a **time study**
  (per-step cycle time across instances, split into active / waiting /
  switching), **automation-candidate** scoring (repetitiveness and
  rule-basedness, scored only where a step repeats often enough to
  judge), and the **process-efficiency ratio** (value-add over total
  stepped time). The viewer gains a fourth Session sub-view —
  **Analysis** — showing the efficiency ratio, a per-step waste bar,
  the time-study table, and the automation list; the session summary
  panel surfaces the efficiency ratio as a tile; and the PDD export
  appends the waste and automation context under each step. The
  classifiers are deliberately conservative and labelled provisional:
  they are tuned ahead of real 8-hour recording data and meant to be
  recalibrated against it. See
  [ADR-0008](docs/adr/0008-build-the-analysis-layer.md).

- **Session summary panel.** An analyzed session now opens with a
  summary above the timeline instead of leaving the analyst to scroll
  and reconstruct what happened: engagement and worker, duration, case /
  event / step counts, a "where the time went" breakdown of the top
  activities, the app-switch count and longest single-app stretch, and
  the longest cases. It also surfaces **marker problems** — a Start with
  no matching End, an orphaned End, a suspiciously short case — each,
  where fixable, with a one-click button that queues the correcting
  marker edit for the next analysis.

- **Compare Sessions flags duration outliers.** When the loaded set
  holds a session whose total duration is a statistical outlier (a
  Tukey fence around the median), a banner names it and offers to drop
  it from the comparison, so one unusually long or short recording
  doesn't quietly skew the merged statistics.

- **Taxonomy rules that match nothing are surfaced.** Normalization now
  records a per-rule match count in `stats.json`
  (`meta.taxonomy_report`) and prints a note for every taxonomy rule
  that classified zero events — a typo in a rule's title pattern no
  longer fails silently.

- **Canonical match-rate drift warning.** When a re-analysis against a
  Process Template sees its interaction match rate fall sharply from
  the previous run (more than 20 points), normalization records it in
  `stats.json` and the session summary shows a warning — the usual
  cause is the target application changing its field identifiers.

- **The interaction recorder filters browser and Electron chrome.**
  The C# recorder now drops the Chromium render-tree scaffolding events
  — empty-id Pane / Group / Document / Custom panes — that every
  browser, and every Electron app, fires for its own internal DOM, the
  same way it already dropped Win32 desktop-shell chrome. Real web-app
  controls, which carry a page-set automation id, are untouched.
  Without this, an all-day browser-heavy recording could bury the
  signal under tens of thousands of noise events.

- **Recorder health lands on the timeline, not just the debug log.**
  The recorder's periodic stats — events emitted, events dropped, an
  error count, and a snapshot of the last failure (process, control,
  message) — are now written to `events.jsonl` as `recorder_health`
  system events, so capture trouble is visible against the session it
  happened in instead of only in the debug log.

- **Applications the recorder cannot see are flagged.** When a
  foreground application produces no interaction events for a sustained
  stretch — typically because it runs elevated, or exposes no UI
  Automation surface — the capture app records an `uncaptured_app`
  event and shows the worker a one-time notice. Such an app used to
  record silently, with no interactions and no explanation.

- **Interaction events carry capture-quality signals.** The first
  interaction captured for each application is tagged with a
  `coverage_hint` — `rich`, `basic`, or `minimal` — a quick read on how
  much detail UI Automation exposes for that app; and a value clamped
  at the 256-character limit is flagged `value_truncated` so a partial
  value is not mistaken for the whole.

- **Events carry a sequence number.** Every event in `events.jsonl`
  now has a monotonic `_seq`; normalization sorts on
  `(timestamp, _seq)`, so events written within the same millisecond
  keep their true order through the pipeline.

- **Sessions can run through idle for all-day recordings.** A new
  `auto_end_on_idle` config key (default on) governs whether an idle
  stretch past `auto_end_idle_minutes` ends the session. Set it off for
  an 8-hour passive recording — idle is still logged, but only the
  worker, or the end of the shift, ends the session.

- **Bracket a case straight from a timeline selection.** The range-
  selection card on the Flow timeline gains an "Insert case from
  selection" button: name the case and it queues a Start and End
  marker at the selection's edges, applied on the next analysis. An
  analyst can now mark process instances in a long passive recording
  after the fact, with no capture-time markers.

- **A post-session summary closes out each recording.** When a capture
  session ends, the Live Session window shows a summary — duration,
  event / marker / screenshot / interaction counts, and whether video
  was recorded — with an optional field to name the session. The name
  is saved to the session manifest and shown in the viewer's Recents
  list, so a worker hands off a recording knowing it is complete and an
  analyst can tell sessions apart at a glance.

- **The recording setup is checked before capture starts.** A
  pre-flight validation runs at session start; if the engagement ID is
  still the default or the session folder is not writable, it asks the
  operator to confirm before recording — catching a misfiled or
  unwritable session before a long recording goes into it, not after.

- **Hotkeys fall back to an alternate binding when one is taken.** If a
  global shortcut can't be registered because another app already holds
  it (some screen recorders and password managers grab Ctrl+Shift+S),
  capture now tries the Ctrl+Alt+ variant and tells the operator which
  binding is live, instead of the hotkey silently doing nothing.

- **Sessions carry an integrity manifest.** Capture writes
  `session-integrity.json` — every file in the session folder with its
  size — when a session ends. Opening the session in the viewer checks
  that manifest against what actually arrived and shows a warning
  banner if files went missing, so a session copied incompletely (a
  dropped video, a truncated event log) is caught before analysis
  instead of silently producing a partial result.

### Changed

- **Step states read in plain language.** The four pipeline step states
  (`auto_suggested`, `auto_matched`, `manually_authored`, `edited`)
  surface to the analyst as just two — "Auto-detected" and "Confirmed" —
  in the step-list tooltip and the summary panel. The pipeline
  distinction is unchanged; only the wording the analyst sees.

- **The Session view points at what to do next.** Once analyzed, a
  context banner in the summary panel suggests the next move — review
  the auto-detected steps, or group reviewed steps into phases — and a
  long recording auto-scrolls to its first case on load.

- **Re-analysis no longer duplicates analyst-owned steps.** When
  normalization regenerates auto-detected steps, a fresh step that
  overlaps a manually-authored, edited, or hidden step by more than
  half its duration is dropped instead of stacked on top — the analyst
  no longer inherits overlapping duplicates to find and delete.

- **Web apps inside a browser are now visible.** The capture tracker
  starts a new activity event when the window title changes, not only
  when the application changes — so a worker moving between Salesforce,
  web-SAP and Workday inside one Chrome window produces three activity
  events instead of one undifferentiated `chrome.exe` event, and the
  process map shows the real flow. The title is normalized first
  (unread counts, unsaved markers and the browser-name suffix are
  ignored) so cosmetic churn doesn't fragment the timeline. This
  realigns capture with the original design — see
  [ADR-0007](docs/adr/0007-activity-event-granularity.md).

- **The interaction-recorder debounce is configurable.** The window
  that coalesces a burst of value changes into one event — typing into
  a field emits a single event with the final value — was a hardcoded
  750 ms. It is now an `interactions.debounce_ms` config key, passed to
  the recorder sidecar in its startup handshake.

## [0.7.0] - 2026-05-17

### Fixed

- **The Flow map no longer draws meaningless self-loops.** A directly-
  follows graph node with an arrow back to itself has no business
  meaning — it was an artifact of the event log keeping consecutive
  same-activity events separate. Normalization now collapses a run of
  one activity into a single occurrence for the process-mining log (the
  finer per-window rows are kept in `events.csv`), so a self-loop is
  structurally impossible — in the Flow graph, the XES log, and the
  mined BPMN alike.

- **The capture tray menu opens on right-click again.** The tray set a
  context menu and also handled right-click explicitly; on Windows the
  two double-fired and right-click did nothing. Both clicks now open
  the menu reliably.

### Added

- **Per-web-app taxonomy.** A canonical `normalization/taxonomy.yaml`
  classifies browser windows into the actual web apps they host
  (Salesforce, SAP, …) instead of one coarse `Unclassified --
  chrome.exe` node. There is deliberately no per-browser catch-all rule
  — an unmatched window stays `Unclassified`, a prompt for the analyst.
  The viewer's Analyze step picks the taxonomy up automatically.

- **Reclassify an activity from the Flow map.** Clicking a map node
  offers a Reclassify action: give the activity its correct label and
  the correction — stored as a `classification_overrides` entry in
  `annotations.json` — flows through re-analysis into the process map,
  the statistics, and the exports. An `Unclassified` node is now a
  prompt the analyst can answer, not a dead end.

## [0.6.0] - 2026-05-17

### Added

- **Studio Dark — a dark theme for the viewer.** A second, opt-in theme
  alongside the default light Warm Editorial: a cool charcoal-blue base,
  a teal accent, a brighter foreground — cinematic and technical. A
  toggle in the topbar switches it at runtime, the choice is remembered,
  and the stored theme is applied before first paint so there is no
  flash. The dark theme covers every view — the timeline bands, the
  step / phase editors, the Flow-diagram (DFG) graph, and the charts
  included.

### Changed

- **Video stage glow.** The video pane carries a subtle radial-gradient
  depth, and the no-video placeholder a faint grid — applied to both
  themes so they stay visually matched.

## [0.5.0] - 2026-05-17

### Changed

- **Capture app tech-debt remediation.** Following an architecture audit
  (`docs/CAPTURE-ARCHITECTURE-ISSUES.md`), the capture app was reworked: a
  `node:test` suite covers the pure-logic modules; the ~1,580-line
  `main.js` is decomposed into focused modules (boot-log, notify,
  session-storage, window-manager); config defaults are consolidated to a
  single source; and each window's HTML is extracted from its JS module
  into a `ui/*.html` file. The decomposition and HTML extraction are
  behaviour-preserving.
- **Screenshots are debounced.** Coincident triggers (an app switch
  landing together with a marker fire) collapse to a single capture
  instead of several near-duplicates. Manual screenshots are never
  suppressed.
- **Viewer: Flow timeline on the shared timeline core.** The Flow
  timeline is migrated onto the timeline-core lane plugins.
- **Viewer: process map is resizable; Activity Frequency chart fix.**

### Added

- **Capture-time failure notifications.** If screenshots start failing
  during a session, the operator gets a desktop notification rather than
  the failure landing only in the debug log.
- **Recorder liveness watchdog.** The interaction-recorder sidecar is
  monitored; if it wedges without exiting, it is terminated and the
  existing restart path recovers it.

## [0.4.0] - 2026-05-16

### Changed (Warm Editorial redesign)

- **Light-theme visual redesign.** The dark "stratified-dark" viewer
  theme is replaced by "Warm Editorial" — a warm off-white palette, an
  amber accent, sharp corners, soft shadows, and self-hosted Plus
  Jakarta Sans + JetBrains Mono typography, applied from a Claude Design
  handoff.
- **Fill-the-window layout.** Every screen fills the viewport and flexes
  its panels by ratio rather than stacking each at a fixed minimum, so
  the video, the screenshot gallery, the process map, and the editors
  grow with the display. The drag-resize handles remain.
- **Flow timeline rebuilt.** Vivid, distinct per-app band colours; case
  bands moved to a labelled header lane above the activity bands; a
  dedicated screenshot rail with clear camera markers; the Flow-diagram
  graph re-themed to the light palette.
- **Bottom playback bar.** A global video transport — skip, play/pause,
  scrub — pinned below the Session view.
- **Steps view polish.** Compact step durations in the list, Duration /
  Start / End stat tiles in the detail pane, and proper card styling.

### Added (round-2 UX feedback — features)

- **Recent dropdown in the top-bar.** Recent sessions + projects were
  only reachable from the Session empty-state, which vanishes once a
  session loads. New "Recent" dropdown next to the Project menu lists
  recent projects + recent sessions + bundled examples, reachable any
  time.
- **Capture: explicit "Start capture session" button.** The Live
  Session window had no obvious way to begin — its primary control was
  "Fire" (a marker), which auto-starts a session as a side effect. It
  now shows a prominent Start button when idle; the marker controls
  dim until a session is running.
- **Timeline Lanes menu.** The timeline had grown to nine stacked
  lanes. A new "Lanes" dropdown in the timeline header toggles idle /
  markers / screenshots / cases / density / window-titles / per-step
  bands / note dots. Defaults keep the core lanes on and the denser
  additions off; the choice persists.
- **Flow diagram variant overlay.** Hovering a node in the Compare
  Sessions Flow diagram now highlights the session paths (variants)
  running through that activity and dims everything else — you see
  where work diverges. The standalone variant-flow Sankey
  (`viewer/variant-viewer.js`) is removed; the Flow diagram absorbed
  the useful idea.
- **Process map SVG export.** New "Process map SVG" export button.
  Exports whichever map is showing — the BPMN process diagram (via
  bpmn-js `saveSVG`) or the Flow diagram (via a hand-written
  cytoscape→SVG serializer) — as an SVG that imports cleanly into
  Figma, Lucidchart, and browsers.

### Changed (round-2 UX feedback — clarity)

- **"Rework loops" panel renamed** to "Repeated activities within a
  case", with a plain-English explainer ("activities a worker did
  more than once inside the same case — often a sign of rework").
- **Capture session-config window** rewritten for a business
  audience: "Set up a recording session", every field relabelled in
  plain language with a one-line helper.

### Added (round-2 UX feedback — step-noise solution)

- **Step-noise denylist.** A session captured with OBS (or any app the
  UIA recorder picks up) visible used to produce dozens of unannotatable
  steps ("OBS 31.0.1: 12 interactions"). New per-session denylist:
  `annotations.json` gains `step_filters.ignored_processes`;
  `step_suggest.py` drops matching interactions (case-insensitive
  substring on process_name + window_title) before step suggestion.
  New "Ignored apps..." button on the Steps view toolbar opens a dialog
  listing every app observed in the session with its interaction count;
  ticking an app + Save re-analyzes the session with that app excluded.
- **Bulk-delete steps.** Ctrl+click 2+ steps, then "Delete selected"
  removes them in one confirm. Ctrl+Z restores the whole batch.
- **Hide step as noise.** New "Hide as noise" button on the step editor.
  Hidden steps drop out of the list (revealed via a new "hidden" filter
  chip) and — unlike a delete — survive re-analyze: `_merge_steps`
  preserves the `hidden` state so a re-suggest doesn't resurrect them.

### Fixed (round-2 UX feedback — bug bash)

- **Resize handle did nothing.** `.timeline-scroll` had `flex: 1`
  (flex-basis 0) which overrode its `height: var(--timeline-height)`,
  so the `#resize-timeline` drag updated the CSS variable but nothing
  moved. Now `flex: 0 0 auto` so the height var drives the viewport.
- **Zoom buttons overlapped the tabs** in Compare Sessions — the
  verbiage rename had blown the tab labels up. Header now wraps;
  `.map-zoom` is shrink-resistant; the BPMN tab label trimmed back to
  "Process diagram".
- **Misleading `+` cursor** on the timeline (`crosshair`) changed to a
  normal cursor; activity-band hover uses `pointer`. Legend gained an
  interaction hint.
- **Screenshot dots** toned down from 14px glowing circles to quiet
  9px markers that brighten on hover.
- **Cases dropdown** showed a lone "All cases" with no explanation on
  an unanalyzed session; now adds a "(no cases yet — click Analyze
  session first)" hint.
- **Steps editor scroll** — the selected-step editor scrolled off-screen
  when the step list was scrolled. The detail pane is now `sticky` so it
  stays put while the list scrolls.

### Added (P2.2 full + audit fixes)

- **P2.2 Variant flow visualization (full).** New `viewer/variant-viewer.js`
  module renders trace_variants as a Sankey-style metro map: each
  unique (column, activity) becomes a node, edges connect consecutive
  activities across variants, both node and edge widths scale with
  the number of sessions flowing through. Divergence columns are
  highlighted in amber so split points are obvious at a glance. The
  Path variations panel in Compare Sessions now has Flow / Table tabs;
  Flow is the default. Click a node to drill into the activity.

### Fixed (audit pass on the deferred batch)

- **P2.7 screenshot gallery filter** simplified to All / Manual / Auto.
  The previous Marker / App switch / Activity resumed options never
  matched anything because capture's `tracker.fireSystem("screenshot",
  ...)` doesn't write a `reason` field — those distinctions only ever
  lived in the spec. Filter now matches what the data actually carries.
- **P2.2 variant heat empty state.** Previous render's rows would
  persist when switching to a session set with no variants. Now shows
  "No variants — analyze sessions to populate."
- **AM.1 timestamp parsing** replaced fragile offset arithmetic
  (`off === 13 || off === 16 ...`) with an anchored regex that fails
  loudly on unrecognized formats instead of silently mangling them.
- **Process Template form editor**: edits to the Advanced YAML
  textarea now update the form view (debounced 350ms; bails silently
  while the YAML is mid-edit and unparseable). And step deletion now
  cleans up dangling references in `proc.phases[].step_ids[]` so a
  phase can't end up pointing at a missing step.
- **P2.12 window-title strip label threshold** was double-counting
  zoom: `host.clientWidth` already reflects the post-zoom width, so
  the previous `(w/100) * hostW * zoomFactor` was 1.5–3× too aggressive
  and labels appeared on bands that were actually too narrow.
- **P2.3 viewport state across modes** was losing the snapshot because
  `display: none` panels return 0 for `scrollWidth` / `clientWidth`.
  Snapshot now reads from the still-visible outgoing layout BEFORE
  swapping visibility.

### Added (deferred-spec follow-up pass)

- **Process Template form editor** replaces the regex-parsed read-only
  step list with an actual editable form: rename / reorder / add /
  delete steps, edit name and description, with reorder arrows on
  every row. Round-trips through `js-yaml` so the underlying match
  rules and other fields the analyst doesn't see stay intact. Match
  rules themselves remain in the Advanced YAML editor.
- **Phase drag-reorder** (P2.6). Step rows inside a phase can now be
  dragged to reorder; a drop indicator follows the cursor and the
  source row dims while dragging. Reorders persist via
  `annotations.json`.
- **Screenshot gallery** (P2.7). New "Open gallery..." link on the
  Screenshots side-panel opens a full-pane overlay. ←/→ steps
  through screenshots, Space toggles auto-advance (~1.2s), Esc
  closes, click the image to seek the video. Filter by trigger
  reason (manual / app switch / activity resumed / marker fire).
- **Window-title runs lane on the Flow timeline** (P2.12). New lane
  between density and steps showing one band per consecutive
  (app, title) run. Labels render only when bands are wide enough
  (~50px); narrow bands stay as colour stripes so the rhythm of
  title changes is visible without crowding labels.
- **Connect Flow / Steps / Phases viewport state** (P2.3). Switching
  view modes now transfers zoom and scroll fraction across the
  three modes — zoom Flow to 3x, scroll mid-session, switch to
  Steps and you stay at the same place.
- **Multi-version Process Template comparison** (AM.1). Every save
  of a Process Template archives a snapshot under
  `.template-history/<basename>/<timestamp>.yaml`. New "Compare
  Process Template versions" panel in the Compare Sessions view
  lets you pick two versions and see a structural diff: steps and
  phases added / removed / renamed.
- **Variant heat** (P2.2, scoped first cut). The Variants table
  in the Compare Sessions view now renders with a frequency-bar
  heat strip per row, an explicit session-count badge, and a
  visual divergence highlight on activities that appear at the
  same position across multiple variants (where paths split).
  Full timeline-overlay rendering deferred — that needs PM4Py
  per-step variant data plumbing on the Python side.

### Changed (verbiage pass for business-analyst audience)

A targeted sweep through user-facing labels, headers, button text,
help copy, and toasts to replace process-mining / engineering jargon
with business equivalents. Internal variable names, IPC channels,
file names, and code comments are unchanged so internal references
keep working. Highlights:

- **"Aggregate" → "Compare Sessions"** wherever it surfaces in the
  UI: the Tab 2 label, the help-modal navigation entry, the help
  text describing it, and the empty-state hero button ("Open
  sessions to compare..."). Internal handler / id names like
  `aggregateSessions`, `view-aggregate`, etc. stay as-is so
  existing wiring remains intact.
- **"Vocabulary" / "App Vocabulary" → "App Library"**: Tab 4
  label, the section heading, the prep CTA card, the Save / Bootstrap
  buttons, the related toast messages, and the New / Save dialogs.
- **"DFG" → "Flow diagram"**: the panel-tab in Compare Sessions's
  Process map. The discoverability tooltip explains it's a
  Direct-Follows Graph for analysts who recognize the term.
- **"BPMN" → "Process diagram (BPMN)"**: the other panel-tab.
  Keeps the industry-standard acronym (importable into Adonis,
  Bizagi, Camunda) but adds the parenthetical so it's not opaque
  to first-time readers.
- **"Canonical YAML saved" → "Process Template saved"** and other
  toast / dialog touches in the Process Template surface.
- **Process Template tab** layout reframed: the raw template
  definition is now behind an "Advanced: full template definition"
  expander rather than the default-visible YAML pane. The list of
  template steps stays directly editable; the underlying definition
  is collapsed-by-default for non-engineer analysts.
- **First-line README and help phrasing** stays focused on the
  analyst-trying-the-tool experience.

### Added

- **Mode-specific shortcuts overlay** (P2.4). Small persistent
  bottom-right widget on the Session view listing the current
  view-mode's 3-4 most-used shortcuts. Dismissable; preference
  persisted to localStorage.
- **Case-scope dropdown deduplication + scope-to-playhead** (P2.8).
  Duplicate marker labels in the case-scope dropdown get a
  `[H:MM:SS]` time-offset suffix so analysts can tell repeated
  cases apart. New `⇥ playhead` button next to the dropdown scopes
  to whichever case contains the current video playhead.
- **Snap-to-event on timeline click** (P2.9). Background click on
  the Flow timeline snaps to the nearest event within ~10px-worth
  of pixel tolerance (scaled by zoom). Genuine empty-space clicks
  still seek to the literal point.
- **Hotkey conflict detection at startup** (P2.10, capture).
  When `globalShortcut.register()` fails (another app is using the
  binding), a Windows toast surfaces the conflict naming each
  failed hotkey, instead of the silent boot.log-only signal.
- **Analyze-all per-iteration progress label** (P2.11). The
  Aggregate "Analyze all sessions" button shows
  "Analyzing N / total..." per-iteration so a long sweep doesn't
  look frozen. Cancel still works mid-loop.
- **Tray menu reorganization** (P2.13, capture). The previously-flat
  tray menu now groups everything beyond the muscle-memory action
  items (Fire Start / End / Pause / End session) into three named
  submenus: Live status (overlays + windows), Storage (recents +
  prune), and Help & config (help + OBS + session config). Fits
  on small-DPI screens.
- **Live-session window keyboard shortcuts** (P2.14, capture).
  S = focus the marker input, E = end marker, P = pause/resume,
  Y = open sync-marker row. Suppressed when an input is focused.
- **Auto-suggested phase grouping** (AM.2). New "Suggest groupings"
  link on the Phases pane runs two heuristics — group consecutive
  steps from the same app, and group consecutive steps with no idle
  gap > 30s — to propose phases. Preview shown as a confirm modal;
  Apply all creates auto-suggested phases the analyst can rename
  and tweak. Skips steps already in a phase.
- **Range selection on the timeline** (P1.1). Shift-drag across the
  Flow timeline to select a time range; a "Selection" stats card
  pops above the legend showing duration, event count, marker count,
  screenshot count, and top apps in the range. Esc clears. The range
  survives view-mode switches and clears on session change.
- **Screenshot hover thumbnails** (P1.2). Hovering a screenshot dot
  on the Flow timeline pops a 220×140 thumbnail preview near the dot.
  Click still opens the full modal.
- **Mini-map overview above the timeline** (P1.3). 30px strip showing
  the whole session compressed into the visible region. Click anywhere
  to jump; drag the highlighted viewport to scroll. Per-app coloured
  bands provide a thumbnail-of-the-timeline read at a glance.
- **Per-step duration bands on the Flow timeline** (P1.4). When a
  session has steps (auto-suggested, auto-matched, or manually
  authored), each step renders as a labeled band on a dedicated lane
  beneath the density histogram. Click a step band to switch to Steps
  view with that step selected.
- **DFG drill-down picker** (P1.5). Clicking a DFG node in the
  Aggregate view now lists every loaded session containing that
  activity (timestamp + session name) instead of jumping to the
  first match. Single-result auto-picks; ↑↓/Enter for keyboard
  navigation; Esc to dismiss. The picker positions near the click.
- **Batch "Remove N missing" link in Recents** (P1.6). When ≥2
  recents entries are flagged missing, a "Remove N missing" link
  appears alongside "Clear all" so the analyst doesn't have to
  ✕ each one individually.
- **Sparklines on aggregate bar charts** (P1.7). The
  activity-frequency and case-duration bar charts in the Aggregate
  view get a tiny 10-bucket sparkline at the bar's right edge,
  showing temporal distribution across the loaded sessions' wall-
  clock span. Quick read for "did this cluster early or evenly?"
- **Auto-clean stale recents** (P1.8). When a Recents entry is first
  detected missing, `firstMissingAt` is stamped on it. After 30 days
  of being missing, the entry is silently dropped on the next
  render. A temporarily-unplugged drive can't false-positive a real
  recent off the list.
- **Annotation lane on the Flow timeline** (P1.9). Numbered note
  dots render in their own lane between steps and cases when notes
  exist. Click a dot to jump to that note in the side panel and
  seek the video to the note's timestamp.
- **Persistent timeline zoom + scroll per session** (P1.10). Zoom
  factor and `#timeline-scroll.scrollLeft` are persisted to
  localStorage keyed by sessionFolder; reopening a session restores
  the zoom and scroll position. Scroll writes are throttled to once
  per 250ms.
- **Project / engagement layer** (P2.1). New `viewer/project.js` data
  module + topbar Project menu + `.pdt-project.json` file format. A
  project bundles the loaded aggregate session set, the current focus
  session, the active process template, the current view mode, the
  current case scope, and the timeline zoom into a single re-loadable
  file. New IPC handlers `viewer:saveProject`, `viewer:saveProjectAs`,
  `viewer:openProject`, `viewer:loadProjectFile`. The Session view's
  empty state now surfaces a "Recent projects" list alongside "Recent
  sessions"; click a recent project to restore everything in one go.
  Standalone-session opens (the existing flow) still work unchanged
  and don't create projects until you explicitly Save as.
- **Aggregate filter date-range hint.** "YYYY-MM-DD" hint label appears next
  to the From / To date inputs in the Aggregate view so the expected format
  is obvious in environments where browsers render date inputs as plain text.

### Changed

- **Capture window palette aligned to viewer.** All capture-side windows
  (help, OBS settings, session config, label picker, prep-app vocab,
  legacy status) now use the same stratified-dark sage / slate ladder as
  the viewer (`--bg: #14141A` through `--bg-5: #484854`,
  `--fg: #D8D6CE`, `--accent: #6E8A66` sage,
  `--accent-2: #5A7488` slate). Eliminates the electric-blue accent
  (`#3a86ff`) that lingered in the older tray surfaces and clashed with
  the rest of the app.
- **Capture help window** rewritten to document the v0.3 surface area:
  Live Session window, hotkey overlay, first-run welcome, marker
  close-then-open default, multi-monitor screenshot config, and the
  Session config window (vs. raw YAML).
- **Viewer help modal** now documents undo / redo (Ctrl+Z / Ctrl+Y),
  the right-click context menu on activity bands (insert markers,
  scope-to-case, jump-to-case-start/end), and the analysis Cancel
  button.
- **README** gains a "What's new in v0.3" section near the top so a
  first-time reader doesn't have to dig through the changelog to learn
  about the live session window, undo, marker close-then-open, etc.
- **`scripts/generate-icons.ps1`** now reads the sage / slate / bg
  hex tokens directly from `viewer/styles.css` instead of duplicating
  the hardcoded literals. Falls back to the previous defaults if the
  CSS file is missing (so a stripped dist still builds icons).

### Removed

- **Dead `escapeHtml` stub in welcome-window.js**. The inline
  duplicate inside the embedded `<script>` block was unused;
  template-literal callers all hit the module-level definition.
  Bookkeeping cleanup.
- **Last `window.confirm` from the legacy status window.** End-session
  click in `capture/status-window.js` now opens an inline confirm row
  (Cancel / End session) styled to match the operator-panel pattern,
  rather than a raw browser confirm dialog. With this, no
  `window.confirm` or `window.prompt` remains in either app's normal
  flow.

## [0.3.0] - 2026-05-15

UX overhaul (capture + viewer) plus structured logging and CI from a
parallel work stream. See [docs/UX-CHANGES.md](docs/UX-CHANGES.md) for
the full UX changeset rationale and
[docs/SPEC-DEFERRED.md](docs/SPEC-DEFERRED.md) for items intentionally
deferred to v0.4+.

### Added (UX overhaul)

- **Themed confirm / prompt modals.** Replaces every browser-native
  `window.confirm` / `window.prompt` site in the viewer (7 call sites)
  with `confirmModal()` / `promptModal()` helpers. Destructive
  confirms support a `danger: true` flag that styles the OK button
  red and focuses Cancel. Same swap applied in the capture-side
  operator panel (sync ID, end session inline-confirm rows). Browser
  dialogs no longer appear in either app's normal flow.
- **First-run welcome window** (`capture/welcome-window.js`). 560×540
  onboarding shown once per machine (gated by
  `userData/welcome-shown.json`). Three CTAs: open the live session
  window, open help, dismiss. Reopenable via tray → Help.
- **Hotkey overlay widget** (`capture/hotkey-overlay.js`). Always-on-
  top, click-through, frameless 220×110 corner widget showing the
  three primary hotkeys. Toggleable from the tray; visibility
  persisted across launches.
- **Live session window** (`capture/operator-panel.js`, rebuilt).
  Merges the old operator panel and status window: counter grid,
  recent-events feed, fire-marker input + nest checkbox, inline sync
  marker, inline end-session confirm. Stratified-dark palette to
  match the viewer. The legacy status window remains in the tray as
  "Show status window (legacy)" for one release.
- **Marker close-then-open by default.** Pressing Start with an
  existing open marker now closes the open marker(s) and opens a
  sibling, eliminating the "4 starts, 0 ends, all nested" pathology
  that caused overlapping case bands. Nest semantics remain
  available via the "Nest under current" checkbox in the live
  session window, the picker's secondary button, or a dedicated
  tray submenu. Shift+Enter in the picker flips the choice for one
  fire.
- **Multi-monitor screenshot follows foreground.** New
  `screenshots.display` config (`"active"` default, `"primary"`,
  `"all"`). Active mode picks the display containing the focused
  window via `active-win` bounds; all mode captures every display
  and emits one screenshot event per file with `_d<displayId>.jpg`
  suffix. Fallback chain: foreground bounds → cursor position →
  primary.
- **Native Windows toast on recorder / OBS failure.** When the UIA
  recorder dies permanently or OBS connect fails (non-strict), an
  Electron `Notification` surfaces the failure. Replaces the silent
  tray-tooltip-suffix-only signalling.
- **Annotations undo stack** (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y).
  Every step / phase / marker / note operation snapshots
  annotations.json before saving; undo reverts; redo replays. Stack
  capped at 50, reset on session switch. Action-labeled so the
  undo toast reads "Undone: split step."
- **Time-axis ticks on the Flow timeline.** Sensible tick step
  picked from `{1s, 2s, 5s, 10s, 15s, 30s, 1m, 2m, 5m, 10m, 15m,
  30m, 1h, 2h, 4h, 6h, 12h, 1d}` for ~12 ticks across the visible
  span. HH:MM:SS / HH:MM / M/D labels depending on granularity.
- **Event-density histogram lane.** 120-bucket histogram showing
  user-activity event volume per bin. Bookkeeping events (idle
  starts, pause/resume, recorder lifecycle) excluded so the lane
  reflects analyst-relevant activity. Makes idle-vs-active stretches
  readable at a glance.
- **Per-case lanes on the Flow timeline.** Each case occupies its
  own row via a sweep-line lane assignment, instead of all cases
  stacking onto a single depth-offset row. Dangling cases get a
  dashed right-edge treatment instead of merging visually with
  same-end-timestamp neighbours. Timeline height grows with
  `lanesNeeded`.
- **Case band context menu.** Right-click a case band: scope view
  to this case, jump to start, jump to end. Solves the case-scope-
  dropdown deduplication problem indirectly (you can pick visually).
- **Right-click discoverability hint.** Faint `⋯` fades in at the
  top-right of activity bands on hover; `cursor: context-menu`
  surfaces that right-click does something.
- **Analysis progress streaming + cancel.** Log host opens by
  default while normalize is running. Red Cancel button in the log
  summary kills the in-flight Python child (SIGTERM, then SIGKILL
  500ms later). Cancellation flows through all four normalize entry
  points (`viewer:runNormalize`, `viewer:runNormalizeExtended`,
  `viewer:testCanonicalMatch`, `viewer:bootstrapAppVocab`). The
  aggregate "Analyze all" loop additionally has its own Cancel
  button that kills the in-flight session and breaks the loop.
- **Brand-square icons** (`shared/tracker-icon.ico`, regenerable via
  `scripts/generate-icons.ps1`). Multi-resolution `.ico` (16/32/48/
  64/128/256) derived from the topbar logo design. Wired into both
  `capture/build-package.js` and `viewer/build-package.js` via
  `icon:`, so the .exe / taskbar / alt-tab / Start menu / window
  chrome show the brand square instead of the default Electron
  diamond. `capture/tray-icon.png` replaced with the matching
  32×32 brand square (was Motif's three-bar logo, an unrelated
  product).
- **Stratified-dark palette.** Viewer's six bg tokens (`--bg`
  through `--bg-5`) re-spaced across a wider lightness range
  (~6 points per step) so panels, the timeline strip, and rules
  visually separate at a glance. Foreground bumped to suit the
  brighter average surface. Accents unchanged. Hardcoded color
  literals in `dfg-viewer.js` and the right-click context menu
  rewritten to use CSS variables or token snapshots.
- **Filter clear-X buttons** on Recents (already shipped pre-v0.3
  but mentioned here for completeness).

### Added (other work stream)

- **Marker insert via the viewer timeline.** Right-click an activity band
  → "Insert Start marker here…" or "Insert End marker here". The edit is
  queued in `annotations.json.marker_edits` with `op: "insert"`; re-run
  normalization to apply. Closes the README's "analysts edit
  annotations.json directly until that ships" caveat. `apply_marker_edits`
  in `normalize.py` now supports the insert op.
- **Session config window in the capture app.** New "Session config..."
  tray menu entry opens a form for engagement ID, worker, idle threshold,
  process labels, and OBS scene. Saves to
  `%APPDATA%\process-discovery-tracker\quick-config.yaml`. The next
  launch picks this up automatically if `PDT_CONFIG` is unset.
- **Recorder sidecar threat model** section in `SECURITY.md`. Covers
  process boundary, IPC mechanism (NDJSON over stdio), privileges, what
  UIA does and doesn't expose, and the lifecycle events.
- **Structured logging** for normalization. `normalization/log_setup.py`
  configures a stdlib `logging` root with a stderr handler at WARNING and
  a per-session `RotatingFileHandler` writing `normalize.log` into the
  session folder at INFO. Called from `normalize.py` entry.
- **Capture-side log helpers.** `capture/log.js` exposes `appLogger()`
  (writes to `%APPDATA%\process-discovery-tracker\app.log`) and
  `createSessionLogger(folder)` (writes to `<session>/capture.log`).
  Always-on; complements the existing `bootLog` (gated on `PDT_DEBUG=1`).
- **OBS lifecycle now logs to `app.log`.** Connect failures, scene
  bootstrap failures, and start/stop record failures land in
  `app.log` in addition to the debug-only `boot.log`.
- **Pytest CI.** `.github/workflows/pytest.yml` runs the normalization
  test suite on push and PR to master/main. windows-latest, Python 3.12.
- **`stats.json.meta.dropped_jsonl_lines`.** Count of malformed JSONL
  events the normalizer dropped during load. Surfaces in the pipeline
  console output as well.
- **`docs/DEPLOY.md`.** Install, upgrade, rollback runbook for capture
  and viewer. Includes the BPMN export pivot path if Adonis ever
  rejects PM4Py's output.
- **`docs/TROUBLESHOOTING.md`.** Known failure modes (OBS, recorder,
  hotkeys, taxonomy YAML, slow mining) with log-file pointers.
- **Data dictionary** in `shared/SCHEMA.md`. Semantic notes for the
  `case_ids` stack, step lifecycle states, interaction enrichment
  precedence, and every `stats.json.meta` field.

### Changed

- **Silent exception handlers narrowed.** `bpmn_step.py`, `bpmn_phase.py`,
  and `pdd_export.py` previously caught `Exception` and `pass`'d. Each
  site now catches the specific exceptions it can produce and logs a
  warning with the step / file context. `step_csv.py` was reviewed and
  left as-is — its `except ImportError: pass` is an intentional optional
  pandas fallback to stdlib `csv`.
- **`pdd_export.py` italic bug fixed.** `p.italic = True` on a python-docx
  `Paragraph` is a no-op (only `Run` has `italic`). The previously-swallowed
  AttributeError is now properly avoided by iterating `p.runs`.
- **Malformed JSONL is now logged, not silently dropped.** `load_events`
  in `normalize.py` emits a `WARNING` per dropped line with line number
  and a 120-char snippet. The total count appears in the pipeline summary
  and in `stats.json.meta`.
- **Taxonomy promotion YAML uses `[REVIEW]` instead of `TODO -`.** The
  viewer's "Promote unclassified to taxonomy" export prefixes generated
  labels with `[REVIEW]` so they're visually distinct from forgotten
  developer TODOs that survived into shipped output.

## [0.2.0] - 2026-05-15

First release published via GitHub Releases. Prebuilt binaries are
attached as `capture-v0.2.0.zip` and `viewer-v0.2.0.zip`; the in-repo
`capture/dist/` and `viewer/dist/` trees are gone (gitignored). On a
fresh machine, download from the Releases page rather than cloning the
repo. See README "Installing a prebuilt release" for the SME-side flow.

### Added

- **`interactions.verbose` config flag.** Opt-in forensic mode that
  restores the raw UIA event firehose (focus_changed, text_changed,
  per-keystroke value_changed). Default off. Use only when debugging
  missing events or focus-tracking issues; expect ~3-5x more events
  per session.
- **Auto-extract for `recorder.zip` at runtime.** If `recorder.exe` is
  missing but `recorder.zip` is present next to where it should land,
  `resolveRecorderPath()` extracts it via Windows-native `tar.exe -xf`
  (libarchive-backed, ships with Win10+). Eliminates the silent-fail
  trap where capture sessions ran without UIA recording because the
  recorder zip was never manually extracted.
- **`scripts/publish-release.ps1`.** Wraps `gh release create
  vX.Y.Z dist\release\*.zip ...`. Verifies both assets exist before
  uploading; supports `-NotesFile`, `-Draft`, `-Prerelease`.
- **`docs/BUILD-AND-DIST.md`.** Explains the recorder.exe topology
  (`bin/` vs `obj/` vs `publish/` vs `dist/.../resources/publish/`),
  the distribution model (GitHub Releases), and what's safe to delete
  to reclaim disk space.

### Changed

- **UIA subscriber filters noise at the source.** Three high-volume
  subscriptions were dropped from the default subscription set:
  - `focus_changed` events (fired on every Tab keystroke, click-shift,
    menu hover, dialog open/close). The window/process semantics we
    actually care about ride along on the next signal event.
  - `text_changed` events (notification-only, no payload, mostly a
    heartbeat indicating typing somewhere).
  - Win32 desktop-chrome events (taskbar, window manager, AltTab
    list) where `FrameworkId == "Win32"` and `ControlType` is in
    `{Pane, Group, Window, Custom}`.
  - `value_changed` / `range_value_changed` are now coalesced per
    `(pid, automation_id || name)` within a 750ms debounce window:
    typing "Customer Acme Corp" in an edit field produces one event
    with the final value instead of one per keystroke.

  Expected event volume reduction: 70-85% in typical sessions. An
  8h session that previously produced ~85k events should land in
  the ~15-25k range without losing analytical signal.

- **`scripts/build-distribution.ps1`** now produces `dist/release/`
  containing `capture-vX.Y.Z.zip` and `viewer-vX.Y.Z.zip` ready to
  attach to a GitHub Release. Each zip has a single versioned
  top-level folder (e.g. `capture-v0.2.0/`) so Windows Explorer's
  "Extract All" produces the expected layout. New flags: `-Version`
  (override the release-asset version suffix), `-SkipRelease` (build
  but don't zip).

- **`README.md`** rewrote the "Building for distribution" and added a
  new "Installing a prebuilt release" section. Recipients are
  directed to the Releases page rather than to a manual zip dance.

### Removed

- **In-repo prebuilt `dist/` trees.** `capture/dist/` and `viewer/dist/`
  are now gitignored. The previous "commit the .zip-of-.exe to fit
  under GitHub's 100 MB file limit" workaround was replaced by GitHub
  Releases (2 GB per asset). About 600 MB of committed binaries dropped
  from the repo.
- **`scripts/unzip-dist.ps1`.** Obsolete — Releases ship unzipped
  folders.

### Migration notes

- **For SMEs / analysts**: stop cloning the repo to get the apps. Go
  to the [Releases page](../../releases), grab the two zips, extract,
  run.
- **For maintainers**: the recorder.exe must be rebuilt (`cd capture &&
  npm run build:recorder`) for the noise filter to take effect — the
  C# subscription set lives in `recorder.exe`, not the Electron host.
- **For anyone running an existing session with the old recorder**:
  no action required, but consider a fresh build to cut event volume.

## [0.1.0] - 2026-05-14

Pre-release internal builds. Not published to GitHub Releases; binaries
lived inside the repo as zipped .exe files in `capture/dist/` and
`viewer/dist/`. See git history for incremental changes.
