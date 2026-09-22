# CLAUDE.md

Project context for Claude Code. **New session?** Read the *Active direction* block
below, then jump to the doc you need from the *Documentation map*. Full index:
[docs/README.md](docs/README.md); architecture: [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md).

**Active direction (2026-09), START HERE:** PDT is being refocused from a product
into an internal **BA / process-manager helper**: an SME records a process a few
times (alone or during a call), the recorder drafts the steps, the analyst confirms
run 1, and the app produces a process map and a tool-neutral PDD. Plan of record
(approved 2026-09-23): [docs/To-Do/BA-HELPER-PLAN-2026-09-22.md](docs/To-Do/BA-HELPER-PLAN-2026-09-22.md).
Baseline it starts from (health, CI history, code review RP-01 to RP-36):
[docs/To-Do/RESTART-POINT-2026-09-22.md](docs/To-Do/RESTART-POINT-2026-09-22.md).
The complete v1.5.0 product is shelved on the `product-edition` branch (tag
`product-edition-v1.5.0`). Cycle progress: `.claude/agent-findings/2026-09-23_ba-helper-cycle-resume-state.md`.
The rest of this file still describes the v1.5.0 product until the refocus docs
land; where it disagrees with the plan, the plan wins.

**Previous direction (2026-07), kept as history:** Released **v1.4.0** (2026-07-02):
a viewer-only presentation/disclosure pass (design critique 2026-07-01;
[docs/architecture/DISCLOSURE-MODEL.md](docs/architecture/DISCLOSURE-MODEL.md),
[docs/To-Do/DESIGN-CRITIQUE-2026-07-01.md](docs/To-Do/DESIGN-CRITIQUE-2026-07-01.md)),
on top of **v1.3.0** (2026-06-28).
**Version-number note (read first):** this block describes work by its *internal
lab-phase / 0.x cycle* names, but the shipped **release tags are 1.x**. The project
re-versioned at the **2026-06-09 1.0 milestone**, which also split the **clean
edition** (no-ML — this is `master`) from the parked **ml edition**
(`project-vision-ai-ml`, tag `v1.0.0-ml`, not on master). Lab-phase → release map:
**Phases A–E → v1.1.0**, **Phase F → v1.2.0**, **Phases G+H → v1.3.0**. So the
"v0.20.0 → v0.22.2" cycle named below is the **pre-1.0 internal numbering** that
shipped inside **v1.0.0–v1.1.0**; the CHANGELOG headers are the source of truth for
release tags. The big feature cycle was **v0.20.0** — the push toward a small
internal rollout; **v0.20.1 → v0.22.2** are coherence + fix-first increments on top
of it (see *Since v0.20.0* below). The v0.19.0 lineage still ships — **Phase 0** of the
ML recommendation, two non-ML detectors (**suggested markers**
[ADR-0017](docs/adr/0017-suggested-markers.md) and **anchor candidates**
[ADR-0018](docs/adr/0018-anchor-candidates.md)) that close the "worker forgot to
fire markers" failure mode, suggest-don't-mutate. The **v0.20.0** cycle landed
(detail in [CHANGELOG.md](CHANGELOG.md)):
- **Foundation (Wave 0).** An in-repo **e2e merge gate** (`e2e/session-smoke.js`,
  the real viewer, asserts + exit codes — incl. the map-connectivity pin), a
  **session golden** over all 10 demo sessions (`normalization/golden_check.py`),
  a **calibration config surface** threaded through `normalize()`, the
  **`normalize()` + `flow-view.js` god-file splits** (`pipeline_stages.py`,
  `session_io.py`, … / `flow-view-*.js`), a **Node-side egress guard**, the first
  **`Recorder.Tests`** C# suite, and **self-sign scaffolding** (now ship-unsigned,
  [ADR-0026](docs/adr/0026-distribution-unsigned-and-services-boutique-scope.md)).
- **Fix-first.** Security (click-to-RCE hardening on the screenshot-open path; PDD
  screenshot containment), correctness, and capture-durability fixes; **Electron
  33 → 42**; **`dagre` → `@dagrejs/dagre`** (0 npm-audit advisories).
- **§11c €-ROI** ([ADR-0016](docs/adr/0016-segment-level-automation-candidacy.md) lineage)
  — `analysis_roi.py` projects a conservative/expected/optimistic savings band,
  rendered in the Session **Analysis** panel, automation candidates **ranked** by
  priority, and embedded in **PDD §4.4**.
- **§11f** structural **PII masking** (`pii_masking.py`, derived stream only,
  join-preserving tokens) + capture **consent** UX (`consent-window.js`).
- **§11d real-value App Vocabularies** (Office / ServiceNow / Salesforce / Jira /
  Zendesk, probed not guessed) + **point-and-learn discovery
  ([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md))** — snapshot a window,
  the volatility-diff picker (`signature_pick.py`) skips volatile ids.
- **§11e recorder capture-confidence** ([ADR-0023](docs/adr/0023-recorder-capture-confidence.md))
  — additive `framework` / `identity_source` / `confidence` / `value_source` /
  `ocr_text` per interaction, so the moat degrades *honestly*.
- **ADR-0024 view-time grain slider** — step grain is a reversible **view** roll-up
  over `element ⊂ screen ⊂ app ⊂ phase ⊂ case` (default notch = screen), driving
  Flow / Steps / Map / Analysis / Compare; never a destructive normalize-time flip.
- **Map-connectivity fixes** — a **value-free screen axis** (no per-record fan-out),
  **dagre left-to-right** layout (the previously-unwired engine), and the e2e
  connectivity pin (screen-grain DFG = 1 component, 1 start, 1 end).
- **Reference Maps ([ADR-0019](docs/adr/0019-reference-maps.md))** — **⑂ Fork map**
  snapshots the mined Process diagram into a standalone, fully-editable bpmn-js
  copy (a one-way leaf the pipeline never re-mines/merges/regenerates; metadata in
  `annotations.json reference_maps[]`, blob in `derived_maps/<id>.bpmn`), typed
  As-Is/To-Be/Reference with provenance + drift + Re-fork, a selected To-Be map
  embedding into the PDD's §4.5.
- **CI guardrails** — the **ADR-registry guard** (`test_adr_registry.py`) and
  [CHIP-GUARDRAILS.md](docs/CHIP-GUARDRAILS.md) (each invariant paired with the
  guard that fails on regression).
- **[ADR-0026](docs/adr/0026-distribution-unsigned-and-services-boutique-scope.md)**
  records the **ship-unsigned** + **services-boutique-scope** owner decisions (the
  out-of-scope list is no longer "remaining work").

**Since v0.20.0 (v0.20.1 → v0.22.2)** — coherence + fix-first increments:
- **Compare-panel drill-downs + retire the per-step path flags
  ([ADR-0027](docs/adr/0027-retire-per-step-path-flags.md)).** The process maps and
  Compare panels became real drill-downs (sparklines removed); **`waste` is now the
  only per-step flag** — `conditional` / `exception_path` / `automation_candidate`
  are sourced from where they actually live (the map's branch frequency, the
  observed trace variants, and segment-grain candidacy
  [ADR-0016](docs/adr/0016-segment-level-automation-candidacy.md)), not a dead
  checkbox. Legacy keys in old `annotations.json` are ignored, not migrated.
- **App Library hardening** ([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md))
  — **delete a vocab**; "Discover from window" now keeps `class_name` signatures,
  **enriches each discovered row** with annotator context (role / framework /
  region / ancestry / weak-signature note), finds the recorder in a **sibling
  capture install** on a viewer-only PC, and survives non-ASCII control names
  (UTF-8 stdin) + slow/large windows (60 s budget, completed pass used on timeout).
- **UI density pass** — consolidated bands + demoted resident chrome across viewer
  and capture; capture dialog footers and muted-label contrast pinned to AA.

The goal remains **productization toward a small internal rollout,
analyst-deliverable first.** Bar: **"as polished as it can be."** Hold
every feature to the coherence discipline in
[COHERENCE-AUDIT.md](docs/architecture/COHERENCE-AUDIT.md) — a new "verb" needs its
inverse, a legend, a control-interaction check, and a real-run check (UI bugs are
invisible to green tests); verify UI changes in the in-repo `e2e/session-smoke.js`
gate (the real viewer, asserts + exit codes — see [docs/CHIP-GUARDRAILS.md](docs/CHIP-GUARDRAILS.md))
and the deeper-eyeball `_pdt_verify` harness. Plan of
record + queued backlog: [docs/To-Do/NEXT-SESSION-SPEC.md](docs/To-Do/NEXT-SESSION-SPEC.md).
Strategic frame: [VALUE-CHAIN-REVIEW.md](docs/architecture/VALUE-CHAIN-REVIEW.md);
ADRs in `docs/adr/`. Validate by running the **packaged app** (it bundles its own
Python), not dev-box pip.

## What this is

Process Discovery Tracker — an internal **Windows process-mining** tool, three
layers that never talk over a network:

1. **Capture** (`capture/`) — a worker records a business process. An Electron tray
   app + a C# UI-Automation recorder sidecar emit an append-only `events.jsonl`.
2. **Normalization** (`normalization/`) — an analyst-side Python pipeline turns the
   raw events into cases, steps, statistics, and mined process maps.
3. **Viewer** (`viewer/`) — an analyst Electron app to explore, annotate, and export
   (process maps, a step/phase breakdown, statistics, a PDD document).

The hand-off between the two halves is a self-contained **session folder** moved
from the worker's machine to the analyst's — no network, no shared services.
Current released version **v1.4.0** (the **clean edition** line; tags + CHANGELOG
are the source of truth — see the *Version-number note* at the top for why the
"0.2x" cycle numbers in this doc are pre-1.0 internal milestones).

## Layout

| Path | What |
|------|------|
| `capture/` | Worker-side Electron tray app + the C# .NET 8 recorder sidecar (`capture/recorder/`). |
| `normalization/` | Analyst-side Python pipeline (`normalize.py` + its modules). |
| `viewer/` | Analyst-side Electron app; bundles a Python embeddable to run normalization. |
| `shared/` | Cross-layer contracts — `SCHEMA.md` (authoritative session-data format); `recognition-patterns.json` (platform/framework signatures); and the value-free grouping rule sets shared Python↔JS: `process-label-patterns.json` (step-type label, ADR-0013) + `screen-label-patterns.json` (value-free screen/window string, ADR-0024 §6a/§6b). |
| `docs/` | Documentation set, ADRs, design specs — index at `docs/README.md`. |
| `scripts/` | PowerShell / Node build, release, and admin scripts (incl. structure-only data peeks). |
| `sessions/`, `dist/` | Gitignored — captured sessions and build output. |
| `_pdt_verify/` | *(Outside the repo)* the Playwright UI-verification harness — see *Verification*. |

## Documentation map

Full index: [docs/README.md](docs/README.md). The high-traffic docs and when to read each:

**Understand the system**
- [architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md) — the three layers, data flow, key principles. Read first.
- [architecture/DATA-MODEL.md](docs/architecture/DATA-MODEL.md) + [shared/SCHEMA.md](shared/SCHEMA.md) — the event/annotation model and the **authoritative** file-format + data dictionary. Touching session data → read SCHEMA.
- [docs/FEATURES.md](docs/FEATURES.md) — capability catalogue (what the product does, by component).

**Work on a layer**
- [architecture/CAPTURE.md](docs/architecture/CAPTURE.md) — the worker app + C# recorder.
- [architecture/NORMALIZATION.md](docs/architecture/NORMALIZATION.md) — the Python pipeline (stages + module map).
- [architecture/VIEWER.md](docs/architecture/VIEWER.md) — viewer modules, views, state, IPC, render pipeline *(deep)*.
- [architecture/VIEWER-TIMELINE.md](docs/architecture/VIEWER-TIMELINE.md) — the timeline subsystem.
- [architecture/DESIGN-SYSTEM.md](docs/architecture/DESIGN-SYSTEM.md) — CSS tokens, light/dark palettes, contrast rules.

**Decisions & current direction**
- [docs/adr/](docs/adr/) — Architecture Decision Records (0001–0015); the newest decisions live here.
- [architecture/COHERENCE-AUDIT.md](docs/architecture/COHERENCE-AUDIT.md) — the coherence discipline every feature must pass.
- [architecture/VALUE-CHAIN-REVIEW.md](docs/architecture/VALUE-CHAIN-REVIEW.md) — the strategic frame (where meaning leaks).
- [docs/To-Do/NEXT-SESSION-SPEC.md](docs/To-Do/NEXT-SESSION-SPEC.md) — the plan of record for the next session.
- [docs/DOC-COVERAGE-AUDIT.md](docs/DOC-COVERAGE-AUDIT.md) — the live documentation coverage/consistency worklist.

**Operate**
- [CONTRIBUTING.md](CONTRIBUTING.md) — dev setup, build, test, conventions.
- [docs/BUILD-AND-DIST.md](docs/BUILD-AND-DIST.md) + [docs/DEPLOY.md](docs/DEPLOY.md) — build pipeline + field install.
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — error messages and diagnostics.
- [CHANGELOG.md](CHANGELOG.md) — per-release history.
- [SECURITY.md](SECURITY.md) + [docs/Security-QA.md](docs/Security-QA.md) — threat model + corp-security Q&A.

## Key concepts

A few facts that recur and trip people up:

- **Raw data is immutable; analysis is a sidecar.** `events.jsonl` is append-only.
  Every analyst edit (steps, phases, markers, classification overrides) lives in
  `annotations.json`. Re-normalization is **non-destructive** — it preserves
  `manually_authored` / `edited` annotations and regenerates only the `auto_*` set.
- **`process_label`** — a step's auto name embeds case values ("Search — CUST-10852");
  the value-free `process_label` ("Search") is the grouping key for the step map **and**
  the analysis/stats, so repeated work across cases collapses to one node/row. It is
  computed in both Python (`step_suggest.process_label`) and JS
  (`process-map-levels.processLabel`) — **keep the two in sync** (the rules live in the
  shared `shared/process-label-patterns.json`, so there's nothing to hand-sync).
- **Value-free *screen* string** — the screen axis has the same problem: a window
  title embeds the case value ("Create INC0010010 | Incident | ServiceNow"). A sibling
  rule set (`shared/screen-label-patterns.json`, ADR-0024 §6a/§6b) strips embedded
  record numbers / id tokens so one logical screen is one node — applied by JS
  `process-map-levels.screenType` (screen-grain key/label) and Python
  `step_suggest.screen_label` (the window-title-derived step-name prefix). A vocab
  `screen_id` (via `window_title_regex`, tagged even on un-named controls) is preferred
  when present, so a matched form needs no stripping at all.
- **Recognition layer** — interactions are classified by documented platform/framework
  signatures (`shared/recognition-patterns.json`), not per-session opaque selectors;
  loaded by both the viewer (`recognition.js`) and Python (`recognition.py`).
- **Process map = a notation × level matrix** — Process diagram (BPMN) vs. Flow diagram
  (DFG), each at Activity / Step / Phase level. The level selector and the notation tabs
  are independent. Step/Phase BPMN is the *observed flow* mined from the annotations.
- **Cases** are detected by **anchor** (active-case stamping in `case_assignment.py`),
  not by idle-gap splitting.

## Commands

**Run / develop** (from `capture/` or `viewer/`):
```
npm install
npm start          # launch the Electron app (Ctrl+R in-app reloads renderer/CSS)
npm test           # node:test unit suite
```

**Python pipeline tests** — use a **system Python with pytest**; the bundled
`viewer/python/` can't run pytest (missing deps):
```
python -m pytest normalization/test/
```

**Re-analyze a session** (regenerates stats / annotations / maps) with the bundled Python:
```
viewer/python/python.exe normalization/normalize.py <session_folder> --mine
```

**Build the C# recorder** (from `capture/`, needs the .NET 8 SDK): `npm run build:recorder`

**Ship a release** (repo root, PowerShell):
```
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force
.\scripts\build-distribution.ps1 -SkipPython
.\scripts\publish-release.ps1 -Version X.Y.Z -NotesFromChangelog
```
Detail: [docs/BUILD-AND-DIST.md](docs/BUILD-AND-DIST.md), [CONTRIBUTING.md](CONTRIBUTING.md).

## Verification

> **Skills pack — live home is `~/.claude/skills/` (user-global, loads in every
> project; its own git repo):** the compiled judgment of prior sessions (core
> reasoning + design judgment, the delegation/briefing lifecycle, agent-facing
> counter-skills). Sessions that delegate read `subagent-briefing` there first; raw
> per-cycle findings land in this repo's `.claude/agent-findings/`; the global
> README carries the maintenance contract and lineage.
> [docs/claude-skills/](docs/claude-skills/README.md) is the frozen 2026-07-03
> snapshot that seeded it — don't edit the snapshot.
>
> **Agents/chips: read [docs/CHIP-GUARDRAILS.md](docs/CHIP-GUARDRAILS.md) before any task.**
> It pairs each hard invariant (map connectivity, the session golden, ADR numbering, immutable
> raw data, suggest-don't-mutate) with the **CI guard that fails if you break it** — so a
> context-blind change is caught even if you don't know the codebase. The map connectivity and
> ADR-number regressions both recurred until they became guards; do not regress them.

UI bugs are invisible to the unit suites — **validate behaviour, don't just write code.**
- **How to launch + drive the viewer is in [docs/CHIP-GUARDRAILS.md](docs/CHIP-GUARDRAILS.md)
  → "How to drive the viewer for UI validation"** — a copy-pasteable launch recipe + the
  DOM-handle map for every surface. It is **entirely in-repo**: `e2e/` bundles
  `playwright-core` and drives the viewer's own electron, so a fresh chip needs nothing
  external. `e2e/session-smoke.js` is the worked example (launches the REAL viewer + asserts).
- A human can instead `npm start` in `viewer/` (Ctrl+R reloads). `../_pdt_verify/` is an
  **optional, out-of-repo** scratch harness with extra drivers — it may be **absent**, so
  don't depend on it; the in-repo `e2e/` is the portable entry point.
- For released-build claims, validate the **packaged app** (it bundles its own Python),
  not dev-box pip.

## Conventions

- **No bundler.** Both Electron apps use CommonJS `require()` (`nodeIntegration: true`) —
  no webpack/Vite/esbuild. New modules are plain `module.exports`.
- **Tests:** Node's built-in `node:test` (JS) and `pytest` (Python) — no other frameworks.
- **ADRs** in `docs/adr/` record architecture decisions; a new "verb" also clears the
  COHERENCE-AUDIT checklist (inverse, legend, control-interaction, real-run).
- **Git:** repo root is this directory. **Active branch `master`** (the long-running
  `viewer-refactor` refactor branch was merged into `master` at v0.17.0 and is
  preserved on origin at the same commit, but is no longer used for active work).
  Commits use an imperative subject and **no `Co-Authored-By` trailer**.
- **Docs:** don't hardcode line/test counts in prose — they drift (the coverage audit
  found several stale ones).

## Environment

- **Two machines.** A dev box (node / python / git / .NET) and a **locked-down work
  laptop** that runs only the released `.exe` — never suggest installs there.
- **Company captures stay local.** Inspect a real `events.jsonl` only via the
  structure-only `scripts/inspect-events.js` / `scripts/count-cases.js`; never read a
  real capture into an assistant. `sessions/example-aggregate/` is committed demo data —
  re-analyzing it for verification is fine, but **don't commit the regenerated files**.
- **PowerShell** for scripts; scope-set `RemoteSigned`, not `-ExecutionPolicy Bypass`.

## Gotchas

- The capture recorder is a **separate C# process**, not Node — [ADR-0001](docs/adr/0001-click-recorder-sidecar-language.md).
- Distribution uses **electron-packager** (each app's `build-package.js`), not electron-builder.
- The viewer ships a **bundled Python** (`viewer/python/`) — the analyst machine needs no
  Python install. (That bundled Python can't run pytest, though — see *Commands*.)
- Capture writes are **batched** — activity/interaction events ride a 500 ms queue;
  markers and system events flush immediately. (Not synchronous-per-event.)
