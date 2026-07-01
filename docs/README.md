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
| Know what the product does (feature catalogue) | [FEATURES.md](FEATURES.md) |
| Set up a dev environment / build / test | [../CONTRIBUTING.md](../CONTRIBUTING.md) |
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

Originally written in the refactor-review pass (2026-05-16); last full refresh
2026-05-31 for v0.20.0 (€-ROI, the view-time grain slider, Reference Maps, real
App Vocabularies + point-and-learn discovery, recorder capture-confidence, PII
masking + consent, the map-readability fixes, and the in-repo e2e/golden/ADR
guards), building on the v0.19.0 detectors and the v0.15.0 analysis & recognition
layers; reconciled to v0.22.2 (2026-06-02) for the post-v0.20.0 increments —
Compare drill-downs + the retired per-step path flags
([ADR-0027](adr/0027-retire-per-step-path-flags.md)), App Library delete +
discovery hardening, and the UI density pass. Describes the code as it is today.

| Doc | Covers |
|---|---|
| [architecture/OVERVIEW.md](architecture/OVERVIEW.md) | System architecture, the three layers, data flow, key principles |
| [architecture/DATA-MODEL.md](architecture/DATA-MODEL.md) | Event/annotation model + the Viewer's in-memory session object |
| [architecture/CAPTURE.md](architecture/CAPTURE.md) | Capture app + C# recorder sidecar (overview) |
| [architecture/NORMALIZATION.md](architecture/NORMALIZATION.md) | The Python transformation pipeline (overview) |
| [architecture/VIEWER.md](architecture/VIEWER.md) | Viewer architecture — modules, views, state, IPC, render pipeline *(deep)* |
| [architecture/VIEWER-TIMELINE.md](architecture/VIEWER-TIMELINE.md) | The timeline subsystem and the shared timeline core *(deep)* |
| [architecture/DESIGN-SYSTEM.md](architecture/DESIGN-SYSTEM.md) | CSS tokens, colour palettes, and the contrast problem |
| [architecture/DISCLOSURE-MODEL.md](architecture/DISCLOSURE-MODEL.md) | Where content renders — Memo/Evidence/Machine as mechanical placement rules |
| [ARCHITECTURE-ISSUES.md](ARCHITECTURE-ISSUES.md) | Viewer refactor register — structural / design-system / regression issues (all resolved) |
| [CAPTURE-ARCHITECTURE-ISSUES.md](CAPTURE-ARCHITECTURE-ISSUES.md) | Capture refactor register — tech-debt items C1-C8 (all resolved in v0.5.0) |
| [architecture/VALUE-CHAIN-REVIEW.md](architecture/VALUE-CHAIN-REVIEW.md) | Strategic review — where meaning leaks across the capture→insight value chain |
| [architecture/COHERENCE-AUDIT.md](architecture/COHERENCE-AUDIT.md) | Coherence discipline — every "verb" needs its inverse, a legend, and a real-run check |
| [architecture/NORTH-STAR.md](architecture/NORTH-STAR.md) | The target ("perfect") state — the value chain at its best, the gap, and the path |

## Current — operational & component docs

| Doc | Covers |
|---|---|
| [../README.md](../README.md) | Repo quick-start and per-release feature notes |
| [../CLAUDE.md](../CLAUDE.md) | Project context for Claude Code — layout, commands, conventions |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Developer setup, build, test, and conventions |
| [CHIP-GUARDRAILS.md](CHIP-GUARDRAILS.md) | **Agents/chips read first** — the hard invariants, each paired with the CI guard that fails on regression |
| [FEATURES.md](FEATURES.md) | What the product does — capability catalogue by component |
| [../CHANGELOG.md](../CHANGELOG.md) | Per-release history |
| [../SECURITY.md](../SECURITY.md) | Threat model and security posture |
| [../shared/SCHEMA.md](../shared/SCHEMA.md) | **Authoritative** session-data schema + data dictionary |
| [BUILD-AND-DIST.md](BUILD-AND-DIST.md) | Build pipeline and distribution model |
| [DEPLOY.md](DEPLOY.md) | Field-installation steps |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Error messages and diagnostics |
| [Security-QA.md](Security-QA.md) | One-page Q&A for a corporate security review |
| [SPEC-DEFERRED.md](SPEC-DEFERRED.md) | Features intentionally deferred past v1.0 |
| [REAL-VALUE-TESTING.md](REAL-VALUE-TESTING.md) | The method for getting *real* UIA values into vocab/template authoring (§11d) and calibration (§11b) — probe live apps + drive the real recorder |
| [interaction-recorder.md](interaction-recorder.md) | Design of the C# UI Automation recorder |
| [adr/0001-click-recorder-sidecar-language.md](adr/0001-click-recorder-sidecar-language.md) | ADR — why the recorder is C#, not Python |
| [adr/0002-app-vocabularies.md](adr/0002-app-vocabularies.md) | ADR — why the App Vocabulary layer exists |
| [adr/0003-viewer-architecture-refactor.md](adr/0003-viewer-architecture-refactor.md) | ADR — the viewer refactor decision and migration path |
| [adr/0004-flow-timeline-steps-rework.md](adr/0004-flow-timeline-steps-rework.md) | ADR — the Flow timeline + Steps view rework (Warm Editorial) |
| [adr/0005-capture-architecture-remediation.md](adr/0005-capture-architecture-remediation.md) | ADR — the capture app tech-debt remediation (C1-C8) |
| [adr/0006-backlog-sequencing.md](adr/0006-backlog-sequencing.md) | ADR — sequencing the IMPROVEMENTS backlog; defer the analysis layer |
| [adr/0007-activity-event-granularity.md](adr/0007-activity-event-granularity.md) | ADR — activity-event granularity; title in the capture run key |
| [adr/0008-build-the-analysis-layer.md](adr/0008-build-the-analysis-layer.md) | ADR — build the heuristic IE/CI analysis layer |
| [adr/0009-normalization-redesign-v013.md](adr/0009-normalization-redesign-v013.md) | ADR — v0.13 normalization redesign; intra-session repetition alignment |
| [adr/0010-ux-overhaul-viewer-recorder.md](adr/0010-ux-overhaul-viewer-recorder.md) | ADR — viewer + recorder UX overhaul (12 fixes) |
| [adr/0011-platform-recognition-layer.md](adr/0011-platform-recognition-layer.md) | ADR — platform/framework recognition layer |
| [adr/0012-active-case-stamping-and-map-matrix.md](adr/0012-active-case-stamping-and-map-matrix.md) | ADR — active-case stamping + the notation × level map matrix |
| [adr/0013-value-free-grouping-and-map-readability.md](adr/0013-value-free-grouping-and-map-readability.md) | ADR — `process_label` value-free grouping + map readability |
| [adr/0014-distribution-model.md](adr/0014-distribution-model.md) | ADR — distribution model: GitHub Releases + electron-packager |
| [adr/0015-intra-session-repetition-alignment.md](adr/0015-intra-session-repetition-alignment.md) | ADR — intra-session repetition alignment (curate one, propagate to all) |
| [adr/0016-segment-level-automation-candidacy.md](adr/0016-segment-level-automation-candidacy.md) | ADR — segment-level (not atomic-step) automation candidacy |
| [adr/0017-suggested-markers.md](adr/0017-suggested-markers.md) | ADR — suggested markers: change-point detection for unbracketed sessions |
| [adr/0018-anchor-candidates.md](adr/0018-anchor-candidates.md) | ADR — anchor candidates: auto-rank the field that segments a session into cases |
| [adr/0019-reference-maps.md](adr/0019-reference-maps.md) | ADR — Reference Maps: decoupled, editable BPMN copies (As-Is → To-Be) |
| [adr/0023-recorder-capture-confidence.md](adr/0023-recorder-capture-confidence.md) | ADR — recorder capture-confidence model + OCR last resort (§11e) |
| [adr/0024-step-grain-as-view-time-rollup.md](adr/0024-step-grain-as-view-time-rollup.md) | ADR — step grain as a view-time roll-up (§11b, reframed) |
| [adr/0025-in-app-vocabulary-discovery.md](adr/0025-in-app-vocabulary-discovery.md) | ADR — in-app vocabulary discovery ("point-and-learn") |
| [adr/0026-distribution-unsigned-and-services-boutique-scope.md](adr/0026-distribution-unsigned-and-services-boutique-scope.md) | ADR — ship unsigned by design; services-boutique scope |
| [adr/0027-retire-per-step-path-flags.md](adr/0027-retire-per-step-path-flags.md) | ADR — retire the per-step path/segment flags; keep only `waste` |
| [adr/README.md](adr/README.md) | ADR index & registry (CI-enforced numbering) |
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
