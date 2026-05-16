# Documentation Index

Process Discovery Tracker is an internal Windows **process-mining** tool: a worker
records how they perform a business process (Capture), an analyst transforms the
recording (Normalization) and explores it (Viewer) to produce process maps and
statistics.

This folder holds the project's documentation. It is split into three tiers:
current **architecture reference** (what the code is now), current **operational
& component** docs, and **historical** design specs (kept for context).

> **New here? Start with [architecture/OVERVIEW.md](architecture/OVERVIEW.md).**

## Find the right doc

| You want to… | Read |
|---|---|
| Understand the whole system fast | [architecture/OVERVIEW.md](architecture/OVERVIEW.md) |
| Work with session data / file formats | [architecture/DATA-MODEL.md](architecture/DATA-MODEL.md) · [../shared/SCHEMA.md](../shared/SCHEMA.md) |
| Change how recording works | [architecture/CAPTURE.md](architecture/CAPTURE.md) |
| Change the Python pipeline | [architecture/NORMALIZATION.md](architecture/NORMALIZATION.md) |
| Work on the Viewer app | [architecture/VIEWER.md](architecture/VIEWER.md) |
| Touch the timeline | [architecture/VIEWER-TIMELINE.md](architecture/VIEWER-TIMELINE.md) |
| Change UI styling or colour | [architecture/DESIGN-SYSTEM.md](architecture/DESIGN-SYSTEM.md) |
| Know what's structurally wrong | [ARCHITECTURE-ISSUES.md](ARCHITECTURE-ISSUES.md) |
| See the refactor decision & migration path | [adr/0003-viewer-architecture-refactor.md](adr/0003-viewer-architecture-refactor.md) |
| Build or ship a release | [BUILD-AND-DIST.md](BUILD-AND-DIST.md) · [DEPLOY.md](DEPLOY.md) |
| Diagnose a failure | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

## Current — architecture reference

Written as part of the refactor-review pass (2026-05-16); describes the code as it
is today.

| Doc | Covers |
|---|---|
| [architecture/OVERVIEW.md](architecture/OVERVIEW.md) | System architecture, the three layers, data flow, key principles |
| [architecture/DATA-MODEL.md](architecture/DATA-MODEL.md) | Event/annotation model + the Viewer's in-memory session object |
| [architecture/CAPTURE.md](architecture/CAPTURE.md) | Capture app + C# recorder sidecar (overview) |
| [architecture/NORMALIZATION.md](architecture/NORMALIZATION.md) | The Python transformation pipeline (overview) |
| [architecture/VIEWER.md](architecture/VIEWER.md) | Viewer architecture — modules, views, state, IPC, render pipeline *(deep)* |
| [architecture/VIEWER-TIMELINE.md](architecture/VIEWER-TIMELINE.md) | The timeline subsystem and its triplicated renderers *(deep)* |
| [architecture/DESIGN-SYSTEM.md](architecture/DESIGN-SYSTEM.md) | CSS tokens, colour palettes, and the contrast problem |
| [ARCHITECTURE-ISSUES.md](ARCHITECTURE-ISSUES.md) | Structural problems, design-system problems, current regressions — the refactor register |

## Current — operational & component docs

| Doc | Covers |
|---|---|
| [../README.md](../README.md) | Repo quick-start and per-release feature notes |
| [../CHANGELOG.md](../CHANGELOG.md) | Per-release history |
| [../SECURITY.md](../SECURITY.md) | Threat model and security posture |
| [../shared/SCHEMA.md](../shared/SCHEMA.md) | **Authoritative** session-data schema + data dictionary |
| [BUILD-AND-DIST.md](BUILD-AND-DIST.md) | Build pipeline and distribution model |
| [DEPLOY.md](DEPLOY.md) | Field-installation steps |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Error messages and diagnostics |
| [Security-QA.md](Security-QA.md) | One-page Q&A for a corporate security review |
| [SPEC-DEFERRED.md](SPEC-DEFERRED.md) | Features intentionally deferred past v1.0 |
| [interaction-recorder.md](interaction-recorder.md) | Design of the C# UI Automation recorder |
| [adr/0001-click-recorder-sidecar-language.md](adr/0001-click-recorder-sidecar-language.md) | ADR — why the recorder is C#, not Python |
| [adr/0002-app-vocabularies.md](adr/0002-app-vocabularies.md) | ADR — why the App Vocabulary layer exists |
| [adr/0003-viewer-architecture-refactor.md](adr/0003-viewer-architecture-refactor.md) | ADR — the viewer refactor decision and migration path |
| [../capture/README.md](../capture/README.md) | Capture component quick-start |
| [../viewer/README.md](../viewer/README.md) | Viewer component quick-start |
| [../normalization/README.md](../normalization/README.md) | Normalization component quick-start |
| `User-Guide.docx` | Generated end-user guide (binary; produced at release time) |

## Historical — design specs

Kept for context and intent. These describe what was *planned*; where they conflict
with the architecture reference above, **the architecture reference wins**. The
first three live at the workspace root, one level above the repo.

| Doc | Was | Superseded by |
|---|---|---|
| `../../PROCESS_DISCOVERY_BRIEF.md` | Initial intake brief / requirements | the design doc, then the shipped product |
| `../../process_discovery_tracker_design.md` | v0.2 design baseline (§-numbered) | this architecture reference for current-state facts |
| `../../annotation-model.md` | Design of the Steps/Phases annotation model | `../shared/SCHEMA.md` + DATA-MODEL.md |
| [IMPLEMENTATION_SPEC.md](IMPLEMENTATION_SPEC.md) | Phase A–G build spec (imperative "what to build") | the shipped code; VIEWER.md / CAPTURE.md / NORMALIZATION.md |
| [UX-CHANGES.md](UX-CHANGES.md) | v0.3 feature narrative | `../CHANGELOG.md` |
