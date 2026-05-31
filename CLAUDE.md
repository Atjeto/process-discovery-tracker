# CLAUDE.md

Project context for Claude Code. **New session?** Read the *Active direction* block
below, then jump to the doc you need from the *Documentation map*. Full index:
[docs/README.md](docs/README.md); architecture: [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md).

**Active direction (2026-05) — START HERE:** Last release **v0.19.0** —
ships **Phase 0** of the ML integration recommendation, two non-ML
detectors that close the "worker forgot to fire markers, no Process
Template configured" failure mode. **Suggested markers**
([ADR-0017](docs/adr/0017-suggested-markers.md),
`normalization/marker_suggest.py`) — a hand-rolled change-point detector
surfaces candidate Start/End boundaries on the (idle gap / home-app
return / transaction-ID typed / app-cluster) signals; they render as
dashed `.tl-marker.tl-suggested` bars on the Flow timeline plus
Accept/Dismiss rows in the markers side-panel. **Anchor candidates**
([ADR-0018](docs/adr/0018-anchor-candidates.md),
`normalization/anchor_suggest.py`) — a pattern-mining detector ranks
fields whose typing would naturally segment the session into cases (a
customer-ID search box, a serial-number entry); the analyst Accepts the
top candidate to write a session-level `case_anchor_override` that
`normalize.py` consults before the marker-mode fallback. Both detectors
honour the suggest-don't-mutate invariant: detection lives in
`annotations.json`; raw `events.jsonl` is untouched; ~19k randomized
fuzzer inputs pin the invariants; Ctrl+Z reverts each Accept/Dismiss.
Phase 0 closes the non-ML surface — Phase 1 (LLM rationale on the PDD
side) stays deferred. The goal remains **productization toward a small
internal rollout, analyst-deliverable first.** Prior cycle (v0.18.x):
in-view Session-view Map level, PDD export from the Session view,
clickable waste-type chips, sharper Map empty-state messages.
What landed this cycle: the **PDD export now follows a real Process Definition
Document structure** (document control, As-Is process with an embedded process
map, automation assessment, exceptions) instead of piling up pipeline data; a
single session reaches the interactive map in one click (**"View map"** in the
Session view's process-map bar); the Compare-Sessions **Analysis panel** and the
single-session **"Waste by step"** list are decluttered (signal-only, adaptive);
the **capture tray IA was split by lifetime** — top-level **Settings…** (Hotkeys
/ Video-OBS / Screenshots / Storage), top-level **Profile…** (worker identity),
and a slim **Session setup…** (engagement + labels only), backed by a
`userData/user-config.json` overlay merged on top of the YAML; the **~5s session-
start freeze is gone** (best-effort OBS connect now in the background; blocking
modals on the start path replaced with toasts; recorder-zip extraction moved off
the start path to app launch); and the normalization pipeline is hardened against
corrupt/hand-edited logs with committed **seeded property-based fuzzers**
(`case_assignment`, `stats_compute`, the analysis layer, `step_suggest`), a
`parse_ts` timezone-consistency sweep, and a `process_label` Python↔JS golden. Bar: **"as polished as it can be."** Hold
every feature to the coherence discipline in
[COHERENCE-AUDIT.md](docs/architecture/COHERENCE-AUDIT.md) — a new "verb" needs its
inverse, a legend, a control-interaction check, and a real-run check (UI bugs are
invisible to green tests); verify UI changes in the `_pdt_verify` harness. Plan of
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
Current released version **0.19.0** (SemVer 0.x).

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

UI bugs are invisible to the unit suites — **validate behaviour, don't just write code.**
- Real-run the app (`npm start` in `viewer/`), or drive the headless harness
  `_pdt_verify/driver.js` (Playwright `_electron` launches the real viewer, drives it,
  and screenshots — read the PNGs back). Use it for **any** UI change.
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
