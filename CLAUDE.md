# CLAUDE.md

Project context for Claude Code. Read *Start here* first. Full docs index:
[docs/README.md](docs/README.md).

## Start here

- **Direction (since 2026-09-23).** PDT is an internal business process
  companion for a business analyst / process manager, not a product. An SME
  records a process a few times (alone or during a call), the recorder
  drafts the steps, the analyst confirms one reference run, and the app
  produces a process map and a tool-neutral PDD. A project can also start
  from a video or from nothing.
- **Plan of record** (approved 2026-09-23):
  [docs/To-Do/BA-HELPER-PLAN-2026-09-22.md](docs/To-Do/BA-HELPER-PLAN-2026-09-22.md).
  Decisions and what was cut: [ADR-0029](docs/adr/0029-ba-helper-refocus.md).
  The reviews that reshaped the viewer:
  [STEP-BACK-REVIEW-2026-09-23.md](docs/To-Do/STEP-BACK-REVIEW-2026-09-23.md) and
  [COMPANION-CRITIQUE-2026-09-23.md](docs/To-Do/COMPANION-CRITIQUE-2026-09-23.md).
- **Cycle state** (lanes, the autonomous decisions AD-1 to AD-28, the merge
  gates): [.claude/agent-findings/2026-09-23_ba-helper-cycle-resume-state.md](.claude/agent-findings/2026-09-23_ba-helper-cycle-resume-state.md).
  Data contracts C1 to C16:
  [.claude/agent-findings/2026-09-23_ba-helper-contracts.md](.claude/agent-findings/2026-09-23_ba-helper-contracts.md).
- **Baseline** (health, CI history, code review RP-01 to RP-36):
  [docs/To-Do/RESTART-POINT-2026-09-22.md](docs/To-Do/RESTART-POINT-2026-09-22.md).
- **Owner-gated:** the P1 draft probe
  ([runbook](docs/To-Do/P1-DRAFT-PROBE-RUNBOOK.md)) and the P5 real-session
  gate ([runbook](docs/To-Do/P5-REAL-SESSION-GATE.md)). Demo data never
  closes either.
- **The shelved product.** The complete v1.5.0 product is kept on branch
  `product-edition`, tag `product-edition-v1.5.0`. Nothing of it is deleted.
- **Versions.** The current release is **v1.5.0** (the product edition). The
  light version is being prepared as **2.0.0** and is not released yet (see
  `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md)).

History: PDT was a process-mining product from 2026-05 to v1.5.0
(2026-07-03); an ML edition is parked on branch `project-vision-ai-ml`.
[CHANGELOG.md](CHANGELOG.md) headers are the source of truth for tags.

## What this is

A Windows tool in three layers that never talk over a network:

1. **Capture** (`capture/`): the SME's tray app (Electron) with a small
   recording bar, plus a C# .NET 8 UI Automation recorder sidecar. One start:
   the bar, the tray, the welcome and the run key all start the recording
   with Run 1, then each press starts the next run. It writes an append-only
   `events.jsonl`, a `manifest.json` and screenshots (OBS video optional);
   the end summary makes a zip for the analyst.
2. **Normalization** (`normalization/`): the Python pipeline: runs from the
   markers, drafted steps, statistics and the analysis, the step-level map
   (`--mine`) and the PDD (`--pdd-out`).
3. **Viewer** (`viewer/`): the analyst's Electron app, with its own Python;
   it runs the pipeline by itself. Four levels: Overview, Timeline, Steps,
   Map.

The hand-off is the **session folder**, copied from the SME's machine to the
analyst's; what the analyst adds (a video, a transcript, screenshots, notes,
attachments, edited maps) lives in it too. No AI ships inside the product.

## The analyst path

1. **Open** a recording folder, or *New from a video...* or *New without a
   recording...* (Open menu). The analysis runs by itself (on open when it
   is missing or older, after Leave apps out, inside Edit as the As-Is map,
   before a PDD export), with one status line and Cancel. *Apply N marker
   changes* stays deliberate; Help, Troubleshooting has Re-analyze.
2. **Attach** a video (copied into the folder, synced with two clicks) and a
   transcript, if any.
3. **Confirm the reference run** (run 1 unless another is picked): fix and
   name its steps, write descriptions, Confirm run.
4. **Review the other runs**: each lists its differences; they are not
   confirmed.
5. **Write the document** on the Overview (trigger, result and improvement
   among its fields).
6. **Check the map**; optionally *Edit as the As-Is map* (and a To-Be copy).
7. **Export the PDD**: its map is the edited As-Is copy when one exists, else
   the map from the runs.

Along the way the analyst adds what the recording lacks: steps, screenshots,
notes, attachments, a step's system.

## Layout

| Path | What |
|---|---|
| `capture/` | SME side: tray app, recording bar, end summary, run key; the C# recorder in `capture/recorder/` (tests in `Recorder.Tests/`). |
| `normalization/` | Analyst side Python pipeline: `normalize.py` and its stage modules; `transcript_import.py`; `golden_check.py` and `golden/`. |
| `viewer/` | Analyst side Electron app. `viewer/python/` is the bundled Python (gitignored, built by `scripts/build-python-embeddable.ps1`). |
| `e2e/` | The in-repo Playwright gate: seven smokes against the real viewer, all run by `run-all.js`. |
| `shared/` | Cross-layer contracts: [SCHEMA.md](shared/SCHEMA.md) (authoritative); `recognition-patterns.json`; `system-names.json`; `process-label-patterns.json` and `screen-label-patterns.json` with their goldens; `run-differences-golden.json` (pins the viewer and the PDD to one alignment rule). |
| `docs/` | Docs, ADRs, plans and audits; index at [docs/README.md](docs/README.md). |
| `scripts/` | Build and release scripts, plus the structure-only data scripts. |
| `sessions/example-aggregate/` | The committed demo: 10 sessions of one order-to-cash process. |
| `corpus/` | Product-era test scenarios; no test or gate reads them. |
| `.claude/agent-findings/` | Cycle records: contracts, resume state, findings register, cut map. |
| `sessions/` (rest), `dist/` | Gitignored: captured sessions and build output. |

## Documentation map

| Read | When |
|---|---|
| [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md) | The layers and the data flow, first. |
| [docs/architecture/DATA-MODEL.md](docs/architecture/DATA-MODEL.md), [shared/SCHEMA.md](shared/SCHEMA.md) | Session files, the annotation model. Touching session data: read SCHEMA. |
| [docs/architecture/CAPTURE.md](docs/architecture/CAPTURE.md) | The capture app and the recorder. |
| [docs/architecture/NORMALIZATION.md](docs/architecture/NORMALIZATION.md) | The pipeline: CLI, stages, modules. |
| [docs/architecture/VIEWER.md](docs/architecture/VIEWER.md), [VIEWER-TIMELINE.md](docs/architecture/VIEWER-TIMELINE.md) | The viewer: modules, levels, state, IPC, the timeline. |
| [docs/FEATURES.md](docs/FEATURES.md) | What the light version does, by component. |
| [docs/architecture/DESIGN-SYSTEM.md](docs/architecture/DESIGN-SYSTEM.md) | CSS tokens, themes, contrast, the UI copy style guide. |
| [docs/architecture/COHERENCE-AUDIT.md](docs/architecture/COHERENCE-AUDIT.md) | The discipline every new verb passes. |
| [docs/adr/](docs/adr/README.md) | Decisions; the registry is CI-enforced. |
| [CONTRIBUTING.md](CONTRIBUTING.md), [docs/BUILD-AND-DIST.md](docs/BUILD-AND-DIST.md), [docs/DEPLOY.md](docs/DEPLOY.md) | Dev setup, build, release, install. |
| [CHANGELOG.md](CHANGELOG.md) | Release history; `[Unreleased]` is the 2.0.0 draft. |

## Key concepts

- **The words** (AD-29). People read *transaction* for one pass through the
  process and *project* for what the analyst opens or starts; code, data
  keys (`case_id`, `pattern_run`), CLI flags and file names keep run, case
  and session.
- **The drafting rule** (C1, `step_suggest.py`). Within a run, a step is a
  stretch on one screen ending at a commit (a button, menu item or link
  invocation, or a vocab `completion: true`), inclusive; at the first
  interaction on another screen; or at the run's end. Each draft carries
  `draft_key` (`"<app>|<screen>|<commit>"`), `name_source` and `end_reason`;
  merged steps keep `draft_keys`.
- **Step states:** `auto_suggested` (a draft), `confirmed`, `edited`,
  `manually_authored`, `hidden`. All but drafts survive re-analysis; drafts
  are hidden, not deleted, so an analysis cannot bring them back.
- **The reference run** (`annotations.pattern_run`, C3): default the first
  run with a step; *Use as reference run* picks another. Confirm run turns
  its drafts into `confirmed`; Reopen run is the inverse. The other runs are
  reviewed, never confirmed (AD-28; `annotations.opened_runs`).
  `draft_fixes` counts its merges, splits, adds and drops: the P1 probe.
- **Saved names** (C4, `<viewer userData>/pdt-library/remembered-names.json`,
  keyed by `draft_key`): a rename is saved and names the session's other
  drafts of that key at once. The pipeline reads it through `--names`, after
  the session's own names, which travel with the folder. The Saved names
  dialog renames or forgets one.
- **Saved processes** (C5, `<viewer userData>/pdt-library/processes.json`):
  *Save as this process* stores the confirmed reference run; a session
  without one is compared with the closest saved process (`draft_key`
  overlap). Viewer only.
- **Runs.** Markers only, never nested: a Start while a run is open ends
  that run first. Case ids are deterministic (C9), so analyst steps stay
  attached across re-analysis. A recording without run markers has no runs.
- **Sessions without a recording** (C16): `manifest.source` `video` or
  `blank`, an empty `events.jsonl`, one implicit run until a Start is
  inserted; a video project's Timeline runs on the video's length. Steps
  added by hand have `time_range: null` and an `order` (Alt+Up and Alt+Down
  move one), listed after the timed steps, with no duration.
- **What the analyst adds** (C16), inside the folder: screenshots in
  `screenshots/analyst/` (a video frame, a pasted image or a file;
  `step.pdd_screenshot` picks the one the PDD prints), notes in
  `analyst_notes` (on a step or a moment; never printed; the old `notes`
  key round-trips), attachments in `attachments/` (listed in the PDD), and
  `step.system`. Removing one deletes its entry and file; Undo restores both.
- **System names** (C14): `shared/system-names.json` turns an application
  and a window title into the business system (Salesforce for a Chrome
  window on Salesforce), read by `app_names.py` and `system-names.js` for
  the legend, the fact line, the map boxes, the panel and the PDD. A
  `step.system` set by the analyst wins.
- **The video travels with the folder.** Attach video copies it into
  `video/` and stores its path relative to the folder; a missing absolute
  path falls back to a file of that name in the folder (`video-path.js`).
- **One clock.** The viewer's times and the PDD's pointers read the time
  since the recording started (m:ss or h:mm:ss); the time of day shows only
  in the Timeline's summary.
- **The step panel** (`views/step-panel.js`): three doors (a map box, a
  timeline step band, a Steps row) open one panel with every occurrence of
  the step: its moment, a small video, screenshots, what was said, notes.
- **The map.** One process map from the runs' visible steps, each box naming
  its system. `--mine` writes `process_map_step.bpmn`, which *Edit as the
  As-Is map* copies into an editable As-Is or To-Be map (ADR-0019; the
  pipeline never touches a copy). The chosen As-Is map shows first.
- **The PDD** (`pdd_export.py`): tool-neutral, built around the confirmed
  reference run. The document fields (C6) fill their places and survive
  re-export; a step's `description` (C7) is its text.
- **The meeting transcript** (C8): `transcript_import.py` writes
  `transcript.json`. A sentence is placed through its own sync, else the
  attached video's; added to a description or a document field, it reaches
  the PDD.
- **`analysis.json` `format`** (`pipeline_stages.ANALYSIS_FORMAT`, 2 now):
  the viewer analyzes a folder on open when it is missing or lower.
- **Raw data is immutable.** `events.jsonl` is append-only; analyst edits
  live in `annotations.json`, replaced atomically, the viewer keeping
  `annotations.json.2` (newest) to `.5`. An unreadable one is reported and
  never overwritten. Keys of cut features round-trip (C10).
- **Honest failures.** A failed stage writes its key as `null` plus one
  `stage_errors` entry (C12), shown as "could not run", never as zero.
  `normalize.py` exits (C13) 0, 1 usage or crash, 2 unreadable
  `annotations.json` (nothing written), 3 a failed export.
- **Shared rules.** `process_label` and the screen string strip case values
  (`shared/*-label-patterns.json`, loaded by Python and JS); interactions
  are typed by platform signatures (`shared/recognition-patterns.json`,
  [ADR-0011](docs/adr/0011-platform-recognition-layer.md)). Classification is
  an internal engine with no UI (AD-16).

## Commands

Each app (from `capture/` or `viewer/`):

```
npm install
npm start          # launch (Ctrl+R in the app reloads the renderer)
npm test           # node:test unit suite
```

Recorder (needs the .NET 8 SDK): `npm run build:recorder` in `capture/`;
tests: `dotnet test capture/recorder/Recorder.Tests/Recorder.Tests.csproj`.

**Full-deps pytest.** Plain `python -m pytest normalization/test/` skips the
pipeline tests (the system Python has pytest but no pandas or pm4py) and
still looks green. Run the bundled interpreter with the system pytest
appended, from `normalization/`:

```
../viewer/python/python.exe -c "import sys; sys.path.append(r'C:\Users\rasha\AppData\Local\Python\pythoncore-3.14-64\Lib\site-packages'); import pytest; sys.exit(pytest.main(['test/', '-q', '-p', 'no:cacheprovider']))"
```

Session golden (`--update` only for an intended output change):
`viewer/python/python.exe normalization/golden_check.py`

Re-analyze a session the way the viewer does:

```
viewer/python/python.exe normalization/normalize.py <session_folder> --taxonomy normalization/taxonomy.yaml --mine --names "<viewer userData>/pdt-library/remembered-names.json"
```

Import a Teams transcript (exit codes in NORMALIZATION.md):

```
viewer/python/python.exe normalization/transcript_import.py <session_folder> <transcript.vtt|.docx>
```

e2e (the real viewer on a throwaway profile; needs `npm install` in `viewer/`
and `e2e/` once):

```
cd e2e && node run-all.js                        # every smoke, one summary line each
PDT_E2E_WINDOW=1366x768 node run-all.js          # (Bash) run at a smaller window
```

The default window is 1500x950. CI's runner display is 1024x720 and Windows
refuses a window larger than the display, so check small sizes locally; each
launch logs the size it really ran at.

Build and publish (repo root, PowerShell):

```
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force
.\scripts\build-distribution.ps1 -SkipPython
.\scripts\publish-release.ps1 -Version X.Y.Z -NotesFromChangelog
```

`publish-release.ps1` refuses unless the tree is clean and HEAD equals
`origin/master`; `-Prerelease` marks a pre-release. Detail:
[docs/BUILD-AND-DIST.md](docs/BUILD-AND-DIST.md).

## Verification

- UI bugs are invisible to the unit suites: validate behaviour in the real
  viewer. `e2e/run-all.js` runs seven smokes: `session`, `overview`, `runs`,
  `map-slim`, `transcript`, `panel` and `companion` (each `<name>-smoke.js`;
  [e2e/README.md](e2e/README.md) says what each covers). `session-smoke.js`
  holds the map connectivity pin (one component, one entry, one end).
- The gates before any merge to master (resume state, "Gates"): full-deps
  pytest, the golden, `node --test` in `viewer/` and `capture/`,
  `node run-all.js` in `e2e/`, and `dotnet test` when `capture/recorder/`
  changed.
- CI runs `pytest.yml`, `js.yml` and `e2e.yml` on `windows-latest`. Check
  `gh run list --branch master --limit 6` after every push: CI once stayed
  red for months while local runs looked green.
- Agents read [docs/CHIP-GUARDRAILS.md](docs/CHIP-GUARDRAILS.md) first: the
  hard invariants with the guard for each, how to launch the viewer, and the
  DOM handles of every surface.
- Released-build claims are validated on the packaged app (it bundles its own
  Python), not the dev box.
- The skills pack lives in `~/.claude/skills/` (user-global);
  [docs/claude-skills/](docs/claude-skills/README.md) is a frozen snapshot.

## Conventions

- **No bundler.** Both Electron apps use CommonJS `require()`
  (`nodeIntegration: true`); new modules are plain `module.exports`.
- **Tests:** `node:test` (JS) and `pytest` (Python) only.
- **ADRs** in `docs/adr/`: the next number is `max + 1`, registered in
  `docs/adr/README.md` in the same commit (CI-enforced). A new verb also
  clears the COHERENCE-AUDIT checklist: its inverse, a legend, a
  control-interaction check, a real-run check.
- **Git:** branch off `master` per lane or session, fast-forward `master`,
  delete merged branches. Parallel sessions share this working directory:
  check the current branch before any git write, and use a worktree to
  isolate. Commit only when asked. Commits use an imperative subject and no
  `Co-Authored-By` trailer; write the message to a file and pass it with
  `git commit -F` (PowerShell 5.1 splits quoted arguments).
- **Docs** never hardcode line or test counts.
- **No dash punctuation** in anything written: docs, UI copy, commit
  messages, chat. No em dash, no en dash, and no ASCII stand-in for them (a
  double hyphen, or a hyphen with spaces around it) between clauses; use a
  colon, a comma, parentheses or a new sentence.
  `viewer/ui-copy-guard.test.js` fails on an em or en dash in UI strings.

## Environment

- **Two machines.** The dev box (node, python, git, .NET) and a locked-down
  work laptop that runs only released builds: never suggest installs there.
  SME machines are locked down the same way.
- **Company captures stay local.** Never read a real `events.jsonl` into an
  assistant; use only the structure-only `scripts/inspect-events.js` and
  `scripts/count-cases.js`. The P1 probe numbers are structure-only by design.
- `sessions/example-aggregate/` is committed demo data. Re-analyzing it for
  verification is fine (the golden and the e2e smokes use temp copies); never
  commit its regenerated files.
- **PowerShell:** scope-set `RemoteSigned`, never `-ExecutionPolicy Bypass`.
- **C: is space-constrained.** The single-file recorder self-extracts about
  180 MB; on a full C: it captures 0 events. Set
  `DOTNET_BUNDLE_EXTRACT_BASE_DIR` (and `TEMP`/`TMP` for builds) to a folder
  on D:.
- **Releases ship unsigned** ([ADR-0026](docs/adr/0026-distribution-unsigned-and-services-boutique-scope.md));
  never propose signing under the company certificate.
- **No browser extensions** for capture: corporate security flags them.
- **Internal use:** no masking or privacy caveats for data shown in the app
  or written to the PDD. The recorder's password redaction stays.

## Gotchas

- The recorder is a separate C# process ([ADR-0001](docs/adr/0001-click-recorder-sidecar-language.md)),
  talking NDJSON over stdio.
- Distribution uses **electron-packager** (each app's `build-package.js`),
  not electron-builder.
- The bundled Python cannot run pytest: use the recipe above.
- Capture writes are batched: activity and interaction events ride a 500 ms
  queue; markers and system events flush at once.
- A Playwright `page.reload()` breaks the viewer's session: the `--session`
  hand-off in `main.js` is a one-shot `did-finish-load` listener. Relaunch
  instead.
- A worktree build needs a real copy of `viewer/python`, not a junction:
  electron-packager fails with EPERM trying to symlink it.
