# Process Discovery Tracker

An internal Windows tool for a business analyst or process manager. A
subject-matter expert (SME) records a business process a few times on their
own PC. The analyst opens the recording, confirms the steps the recorder
drafted for one transaction, reviews how the other transactions differ, and gets a process
map and a tool-neutral process definition document (PDD).

> **Status.** The current release is v2.0.0 (2026-09-26), the light version.
> The earlier product edition, v1.5.0, is kept on branch `product-edition`
> (tag `product-edition-v1.5.0`). See [CHANGELOG.md](CHANGELOG.md).

## Who uses it

| Role | Machine | App |
|---|---|---|
| SME | their work PC | **Process Discovery Tracker** (capture): records while they work |
| Analyst | the analyst's PC | **Process Discovery Viewer**: turns the recording into a map and a PDD |
| Developer | their own PC | **Process Discovery Viewer**: opens a version the analyst handed off, read only |

The two apps never talk over a network. The recording's folder is copied
from the SME's PC to the analyst's (the capture app's end summary can zip
it). No telemetry, no update checks, no AI inside the tool.

## What it does

- **Records.** A UI Automation recorder logs every click, field and window,
  with screenshots. The SME starts each transaction of the process with one
  key (Ctrl+Shift+S by default) or the recording bar's button. An OBS video
  is optional.
- **Drafts.** The pipeline drafts each transaction's steps: one step per screen
  visit, ending at its commit action (a button, menu command or link such as
  Save or Submit).
- **Confirms.** The analyst confirms one transaction (the reference
  transaction), fixing names and boundaries against the video or the
  screenshots. The step names come from an activity library of each
  system, built from the names given in earlier projects.
- **Compares.** The other transactions show only their differences from the reference
  transaction.
- **Maps.** A BPMN process map built from the transactions, with the
  conditions and loops set on steps, a map per sub-process, and an editable
  As-Is (and To-Be) copy for the PDD.
- **Documents.** A PDD (.docx) built around the confirmed reference
  transaction, with the analyst's purpose, scope, trigger, result,
  contacts, rules, exceptions and notes, the measured timings, the data
  entered and the differences between transactions.
- **Adds what the recording lacks.** Steps, screenshots, notes, attachments
  and a step's system, added by hand; a project can also start from a video
  or from nothing.
- **Hands off.** A numbered version for the developers: one zip with the
  project, its PDD and a Technical details workbook (the recorded controls,
  the data fields, the values typed again in another system, the
  applications). A developer opens it read only.
- **Transcripts.** A Teams `.vtt` or `.docx` meeting transcript can be
  attached. Its sentences line up with the recording, and a sentence can be
  added to a step's description or to the document, so the SME's own words
  reach the PDD. Nothing in the tool interprets the text.

## Install

1. Download `capture-vX.Y.Z.zip` (SME) and `viewer-vX.Y.Z.zip` (analyst,
   developer) from the repository's GitHub Releases page.
2. Extract anywhere. No installer and no admin rights; the viewer bundles its
   own Python.
3. Run `Process Discovery Tracker.exe` or `Process Discovery Viewer.exe`. The
   builds are unsigned by design: on first launch Windows SmartScreen asks;
   choose More info, then Run anyway.

The capture app's tray menu opens its recordings folder. Field detail:
[docs/DEPLOY.md](docs/DEPLOY.md).

## Run from source

```
cd capture && npm install && npm run build:recorder && npm start
cd viewer && npm install && npm start
```

The recorder build needs the .NET 8 SDK. The viewer runs the pipeline with
`viewer/python/` when present (built by `scripts/build-python-embeddable.ps1`),
else with the `python` on PATH, which then needs
`normalization/requirements.txt`. Setup, tests and conventions:
[CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- [docs/README.md](docs/README.md): the index.
- [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md): how the
  three layers fit together.
- [shared/SCHEMA.md](shared/SCHEMA.md): the session folder's files, field by
  field.
- [docs/To-Do/BA-HELPER-PLAN-2026-09-22.md](docs/To-Do/BA-HELPER-PLAN-2026-09-22.md)
  and [ADR-0029](docs/adr/0029-ba-helper-refocus.md): why the tool looks the
  way it does.
- [SECURITY.md](SECURITY.md): the security posture.
