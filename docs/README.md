# Documentation index

Process Discovery Tracker (PDT) is an internal Windows tool for a business
analyst or process manager. An SME records a business process a few times,
the recorder drafts the steps, the analyst confirms one transaction and
reviews how the others differ, and the tool produces a process map and a
tool-neutral PDD, handed to the developers as numbered versions with a
Technical details workbook.

> **New here? Start with [architecture/OVERVIEW.md](architecture/OVERVIEW.md).**

The index has two parts:

- **Current (light version):** what the code on `master` does now, and the
  plan it is being built to.
- **Product edition, historical:** kept for reference. These docs describe
  the v1.5.0 product (a process-mining product for outside buyers); its code
  lives on branch `product-edition`, tag `product-edition-v1.5.0`. Where one
  of them disagrees with a current doc or with the code, the current doc and
  the code win.

## Find the right doc

| You want to | Read |
|---|---|
| Know where the project is going and why | [To-Do/BA-HELPER-PLAN-2026-09-22.md](To-Do/BA-HELPER-PLAN-2026-09-22.md), [adr/0029-ba-helper-refocus.md](adr/0029-ba-helper-refocus.md) |
| Understand the whole system fast | [architecture/OVERVIEW.md](architecture/OVERVIEW.md) |
| Work with session files | [architecture/DATA-MODEL.md](architecture/DATA-MODEL.md), [../shared/SCHEMA.md](../shared/SCHEMA.md) |
| Change how recording works | [architecture/CAPTURE.md](architecture/CAPTURE.md) |
| Change the Python pipeline | [architecture/NORMALIZATION.md](architecture/NORMALIZATION.md) |
| Set up, test, build | [../CONTRIBUTING.md](../CONTRIBUTING.md), [BUILD-AND-DIST.md](BUILD-AND-DIST.md) |
| Install on a machine | [DEPLOY.md](DEPLOY.md) |
| Diagnose a failure | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| Run the owner-only checks | [To-Do/P1-DRAFT-PROBE-RUNBOOK.md](To-Do/P1-DRAFT-PROBE-RUNBOOK.md), [To-Do/P5-REAL-SESSION-GATE.md](To-Do/P5-REAL-SESSION-GATE.md) |

## Current (light version)

### Direction and plan

| Doc | Covers |
|---|---|
| [To-Do/BA-HELPER-PLAN-2026-09-22.md](To-Do/BA-HELPER-PLAN-2026-09-22.md) | Plan of record (approved 2026-09-23): the scenario, the analyst path, the feature verdicts, the phases |
| [adr/0029-ba-helper-refocus.md](adr/0029-ba-helper-refocus.md) | ADR for the refocus: the key choices and everything that was cut |
| [To-Do/RESTART-POINT-2026-09-22.md](To-Do/RESTART-POINT-2026-09-22.md) | The baseline the refocus started from: health, CI history, code review RP-01 to RP-36 |
| [To-Do/UI-CLARITY-AUDIT-2026-09-23.md](To-Do/UI-CLARITY-AUDIT-2026-09-23.md) | Element-by-element audit of the light viewer; the subtraction lanes LUX-A and LUX-B applied it |
| [To-Do/STEP-BACK-REVIEW-2026-09-23.md](To-Do/STEP-BACK-REVIEW-2026-09-23.md) | The concept-level step back: the PDD, the capture app and the viewer from the reader's side; its lanes are the plan's AD-24 and AD-26 |
| [To-Do/COMPANION-CRITIQUE-2026-09-23.md](To-Do/COMPANION-CRITIQUE-2026-09-23.md) | Screen-by-screen critique of the light viewer as a business process companion (AD-28) |
| [To-Do/P1-DRAFT-PROBE-RUNBOOK.md](To-Do/P1-DRAFT-PROBE-RUNBOOK.md) | The owner's probe of draft quality on a real recording (plan risk R1) |
| [To-Do/P5-REAL-SESSION-GATE.md](To-Do/P5-REAL-SESSION-GATE.md) | The owner's real-session gate for the whole path |

### Architecture reference

| Doc | Covers |
|---|---|
| [architecture/OVERVIEW.md](architecture/OVERVIEW.md) | The three layers, the session folder, the data flow |
| [architecture/DATA-MODEL.md](architecture/DATA-MODEL.md) | The session files, the annotation model, the viewer's in-memory session |
| [../shared/SCHEMA.md](../shared/SCHEMA.md) | **Authoritative** file formats and data dictionary |
| [architecture/CAPTURE.md](architecture/CAPTURE.md) | The capture app and the C# recorder |
| [architecture/NORMALIZATION.md](architecture/NORMALIZATION.md) | The pipeline: CLI, stages, modules, outputs |
| [interaction-recorder.md](interaction-recorder.md) | Design of the C# UI Automation recorder |
| [architecture/DESIGN-SYSTEM.md](architecture/DESIGN-SYSTEM.md) | CSS tokens, the two themes, contrast rules, the UI copy style guide |
| [architecture/VIEWER.md](architecture/VIEWER.md) | The viewer: its modules, the four levels, the step panel, state, IPC, the automatic analysis, the exports, a hand-off opened read only |
| [architecture/VIEWER-TIMELINE.md](architecture/VIEWER-TIMELINE.md) | The timeline: its lanes, the one clock, a video project's timeline, the video beside it |

### Principles that still bind

| Doc | Covers |
|---|---|
| [architecture/COHERENCE-AUDIT.md](architecture/COHERENCE-AUDIT.md) | Every new verb needs its inverse, a legend, a control-interaction check and a real-run check |
| [LAB-PHASE-SPEC.md](LAB-PHASE-SPEC.md) | Section 1, the honesty rules the plan keeps (measured facts render as measured; nothing projected dresses up as measurement; gates gate whole composites). The rest of it is product-edition history |
| [architecture/DISCLOSURE-MODEL.md](architecture/DISCLOSURE-MODEL.md) | Those rules as placement rules (Memo / Evidence / Machine). Written for the product viewer's surfaces; the rules still hold |

### Decision records

[adr/README.md](adr/README.md) is the registry, with each ADR's status (CI
enforces the numbering). The decisions that shape the light version:

| ADR | Decision |
|---|---|
| [0029](adr/0029-ba-helper-refocus.md) | The BA-helper refocus |
| [0001](adr/0001-click-recorder-sidecar-language.md) | The recorder is a C# sidecar |
| [0002](adr/0002-app-vocabularies.md) | App vocabularies (the matching engine stays; in-app authoring is cut) |
| [0007](adr/0007-activity-event-granularity.md) | Activity-event granularity: the window title in the run key |
| [0011](adr/0011-platform-recognition-layer.md) | The platform recognition layer |
| [0012](adr/0012-active-case-stamping-and-map-matrix.md) | Marker-based case stamping (narrowed: anchors and the map matrix are cut) |
| [0013](adr/0013-value-free-grouping-and-map-readability.md) | Value-free grouping (`process_label`) |
| [0014](adr/0014-distribution-model.md) | GitHub Releases and electron-packager |
| [0019](adr/0019-reference-maps.md) | Reference maps: editable As-Is and To-Be copies |
| [0023](adr/0023-recorder-capture-confidence.md) | Recorder capture confidence |
| [0024](adr/0024-step-grain-as-view-time-rollup.md) | Step grain keys (narrowed: the grain slider is cut, `grain_keys` stay) |
| [0026](adr/0026-distribution-unsigned-and-services-boutique-scope.md) | Ship unsigned (its scope half is narrowed by ADR-0029) |
| [0027](adr/0027-retire-per-step-path-flags.md) | `waste` is the only per-step flag |

### Operate

| Doc | Covers |
|---|---|
| [../README.md](../README.md) | What the tool is, install, run from source |
| [../CLAUDE.md](../CLAUDE.md) | Project context for Claude Code: start here, commands, conventions, environment |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Dev setup, test commands, conventions |
| [../CHANGELOG.md](../CHANGELOG.md) | Release history; `[Unreleased]` is the 2.0.0 draft |
| [BUILD-AND-DIST.md](BUILD-AND-DIST.md) | Build pipeline and release zips |
| [To-Do/BUILD-BOX-VALIDATION.md](To-Do/BUILD-BOX-VALIDATION.md) | Open since 2026-05: a maintained bundled Python, packaged Electron 42 checks |
| [DEPLOY.md](DEPLOY.md) | Installing on an SME's or an analyst's machine |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Error messages and diagnostics |
| [../SECURITY.md](../SECURITY.md), [Security-QA.md](Security-QA.md) | Threat model; one-page Q&A for a corporate security review |
| [CHIP-GUARDRAILS.md](CHIP-GUARDRAILS.md) | Agents read first: the hard invariants and the guard for each, how to drive the viewer, the DOM handles of every surface |
| [FEATURES.md](FEATURES.md) | What the light version does, by component (the product edition's catalogue is on its branch) |
| `User-Guide.docx` | The product edition's generated user guide (binary, built by `build-user-guide.js`). No longer copied into a release: the in-app Help is the light version's guide |
| [../capture/README.md](../capture/README.md), [../viewer/README.md](../viewer/README.md), [../normalization/README.md](../normalization/README.md), [../e2e/README.md](../e2e/README.md) | Component quick-starts |
| [claude-skills/README.md](claude-skills/README.md) | Frozen 2026-07-03 snapshot of the skills pack (the live copy is user-global) |

## Product edition, historical

Kept for reference; the code these describe lives on branch
`product-edition`. Docs that described only cut features (the vocabulary
discovery spec and app coverage list, the segmentation calibration and
real-app map validation findings, the R5 sit-down runbook, the 2026-07
design critique and navigation audit, the deferred-work list and the doc
coverage audit) were deleted from `master` on 2026-09-24; they are on
branch `product-edition`.

### Architecture and strategy

| Doc | Was |
|---|---|
| [architecture/VALUE-CHAIN-REVIEW.md](architecture/VALUE-CHAIN-REVIEW.md) | Strategic review: where meaning leaked from capture to insight |
| [architecture/NORTH-STAR.md](architecture/NORTH-STAR.md) | The product's target state |
| [ARCHITECTURE-ISSUES.md](ARCHITECTURE-ISSUES.md) | Viewer refactor register (all resolved) |
| [CAPTURE-ARCHITECTURE-ISSUES.md](CAPTURE-ARCHITECTURE-ISSUES.md) | Capture refactor register C1 to C8 (all resolved in v0.5.0) |
| [LAB-PHASE-SPEC.md](LAB-PHASE-SPEC.md) | The honesty redesign, phases A to E (section 1 still binds, see above) |
| [REAL-VALUE-TESTING.md](REAL-VALUE-TESTING.md) | Method for real UIA values in vocab and template authoring and segmenter calibration |

### Decision records for cut or replaced features

| ADR | Status |
|---|---|
| [0003](adr/0003-viewer-architecture-refactor.md), [0004](adr/0004-flow-timeline-steps-rework.md), [0005](adr/0005-capture-architecture-remediation.md), [0006](adr/0006-backlog-sequencing.md), [0010](adr/0010-ux-overhaul-viewer-recorder.md) | Past refactors, reworks and sequencing; implemented, history now |
| [0008](adr/0008-build-the-analysis-layer.md), [0016](adr/0016-segment-level-automation-candidacy.md) | The analysis layer and segment-level automation candidacy; cut from the light version on 2026-09-25 (lane FX1), since no screen and no document read them |
| [0009](adr/0009-normalization-redesign-v013.md) | v0.13 normalization redesign; superseded in part |
| [0015](adr/0015-intra-session-repetition-alignment.md) | Intra-session alignment; its engine (`step-alignment.js`) is removed, the differences view aligns by draft key instead |
| [0017](adr/0017-suggested-markers.md), [0018](adr/0018-anchor-candidates.md) | Suggested markers and anchor candidates; cut |
| [0025](adr/0025-in-app-vocabulary-discovery.md) | In-app vocabulary discovery; cut (remembered names replace it) |
| [0028](adr/0028-case-screen-work-items.md) | Case by screen work items; cut (the runs and steps view replaces it) |

### Plans, audits and reviews

| Doc | Was |
|---|---|
| [To-Do/APPROACHABILITY-REDESIGN-2026-07-03.md](To-Do/APPROACHABILITY-REDESIGN-2026-07-03.md) | Plan of record before the refocus (superseded by the BA-helper plan) |
| [To-Do/NEXT-SESSION-SPEC.md](To-Do/NEXT-SESSION-SPEC.md) | Operational plan of record, 2026-06 |
| [To-Do/PDT-MASTER-ASSESSMENT.md](To-Do/PDT-MASTER-ASSESSMENT.md), [To-Do/PDT-ROADMAP-CODEBASE-FIT.md](To-Do/PDT-ROADMAP-CODEBASE-FIT.md) | Product strategy and the roadmap fit analysis |
| [To-Do/DELIVERABLE-AUDIT-2026-07-03.md](To-Do/DELIVERABLE-AUDIT-2026-07-03.md) | Audit of the memo and the PDD (the plan's fix list cites its gaps 2 to 10) |
| [To-Do/PERF-CEILING-2026-07-03.md](To-Do/PERF-CEILING-2026-07-03.md), [To-Do/REAL-DATA-VITALS-2026-07-03.md](To-Do/REAL-DATA-VITALS-2026-07-03.md) | Performance ceiling and structure-only vitals of real captures |
| [To-Do/real-session-findings.md](To-Do/real-session-findings.md), [To-Do/ui-copy-feedback.md](To-Do/ui-copy-feedback.md) | The first real company session (2026-06-10) and the owner's copy feedback |
| [To-Do/AGENT-DELEGATION-POSTMORTEM-2026-07-02.md](To-Do/AGENT-DELEGATION-POSTMORTEM-2026-07-02.md) | Delegation postmortem of the v1.4.0 pass |
| [To-Do/IMPLEMENTATION-SPEC-v0.13-normalization-redesign.md](To-Do/IMPLEMENTATION-SPEC-v0.13-normalization-redesign.md) | Build spec for the v0.13 pipeline redesign |
| [To-Do/CONSOLIDATED-REVIEW-2026-05.md](To-Do/CONSOLIDATED-REVIEW-2026-05.md), [To-Do/tech-debt-findings.md](To-Do/tech-debt-findings.md), [CODE-REVIEW-2026-05.md](CODE-REVIEW-2026-05.md), [security-review-session-findings.md](security-review-session-findings.md) | Code, tech-debt and security reviews of v0.19.0 |
| [IMPLEMENTATION_SPEC.md](IMPLEMENTATION_SPEC.md), [UX-CHANGES.md](UX-CHANGES.md) | The phase A to G build spec and the v0.3 feature narrative |
| `To-Do/Archive/` | Older specs and plans |

The original intake brief, the v0.2 design (`process_discovery_tracker_design.md`)
and the annotation-model design live at the workspace root, one level above
the repo.
