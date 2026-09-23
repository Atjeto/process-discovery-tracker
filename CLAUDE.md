# CLAUDE.md

Project context for Claude Code. Read *Start here* first. Full docs index:
[docs/README.md](docs/README.md).

## Start here

- **Direction (since 2026-09-23).** PDT is an internal helper for a business
  analyst / process manager, not a product. An SME records a process a few
  times (alone or during a call), the recorder drafts the steps, the analyst
  confirms run 1, and the app produces a process map and a tool-neutral PDD.
- **Plan of record** (approved 2026-09-23):
  [docs/To-Do/BA-HELPER-PLAN-2026-09-22.md](docs/To-Do/BA-HELPER-PLAN-2026-09-22.md).
  Decisions and the list of what was cut:
  [ADR-0029](docs/adr/0029-ba-helper-refocus.md).
- **Cycle state** (lanes, the autonomous decisions AD-1 to AD-21, the merge
  gates): [.claude/agent-findings/2026-09-23_ba-helper-cycle-resume-state.md](.claude/agent-findings/2026-09-23_ba-helper-cycle-resume-state.md).
  Data contracts C1 to C13:
  [.claude/agent-findings/2026-09-23_ba-helper-contracts.md](.claude/agent-findings/2026-09-23_ba-helper-contracts.md).
- **Baseline** the refocus started from (health, CI history, code review
  RP-01 to RP-36): [docs/To-Do/RESTART-POINT-2026-09-22.md](docs/To-Do/RESTART-POINT-2026-09-22.md).
- **Not landed yet:** the UI subtraction (lanes LUX-A and LUX-B) that applies
  [docs/To-Do/UI-CLARITY-AUDIT-2026-09-23.md](docs/To-Do/UI-CLARITY-AUDIT-2026-09-23.md).
  Viewer layout details will change with it.
- **Owner-gated:** the P1 draft probe
  ([runbook](docs/To-Do/P1-DRAFT-PROBE-RUNBOOK.md)) and the P5 real-session
  gate ([runbook](docs/To-Do/P5-REAL-SESSION-GATE.md)). Demo data never
  closes either.
- **The shelved product.** The complete v1.5.0 product is kept on branch
  `product-edition`, tag `product-edition-v1.5.0`. Nothing of it is deleted.
- **Versions.** The current release is **v1.5.0** (the product edition). The
  light version is being prepared as **2.0.0** and is not released yet (see
  `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md)).

History: from 2026-05 to 2026-07 PDT was built as a process-mining product:
0.x releases, then 1.x from the 2026-06-09 1.0 milestone (tag `v1.0.0-clean`;
an ML edition is parked on branch `project-vision-ai-ml`, tag `v1.0.0-ml`) up
to v1.5.0 on 2026-07-03. [CHANGELOG.md](CHANGELOG.md) holds the per-release
history; its headers, not internal cycle names, are the source of truth for
tags.

## What this is

A Windows tool in three layers that never talk over a network:

1. **Capture** (`capture/`): the SME's tray app (Electron) plus a C# .NET 8
   UI Automation recorder sidecar. One run hotkey brackets each run of the
   process. It writes an append-only `events.jsonl`, a `manifest.json` and
   screenshots; OBS video is optional.
2. **Normalization** (`normalization/`): the Python pipeline. It turns the
   markers into runs, drafts each run's steps, computes statistics and
   findings, mines the step-level map (`--mine`) and writes the PDD
   (`--pdd-out`).
3. **Viewer** (`viewer/`): the analyst's Electron app. It bundles its own
   Python and runs the pipeline on "Analyze". Four levels: Overview, Flow,
   Steps, Map.

The hand-off is the **session folder**, copied from the SME's machine to the
analyst's. The analyst may add a video (the SME's own OBS recording, or a
recording of the call; one active video per session) and a Teams transcript.
No AI ships inside the product.

## The analyst path

Plan section 5, as it stands in the code:

1. **Open** the session folder.
2. **Attach a video** if there is one, and the meeting transcript if there is
   one. Its sentences line up with the recording (through the video's sync,
   or by matching one sentence to one moment).
3. **Confirm run 1**, the pattern run: rename, merge, split, hide, or add
   steps against the video or the screenshots. A missed run marker is added
   by hand in Flow. Every rename is remembered.
4. **Review runs 2 to N**: each shows its differences from the pattern run.
5. **Check the map** built from the runs' steps.
6. **Finish the map**: fork an editable As-Is copy (and a To-Be when wanted);
   the copies chosen for the PDD embed in it.
7. **Read the findings.**
8. **Export the PDD.** Optionally "Save as this process": a later session of
   the same process is then compared with it, and its drafts already carry
   the remembered names.

## Layout

| Path | What |
|---|---|
| `capture/` | SME side: tray app, Live Session window, run hotkey; the C# recorder in `capture/recorder/` (tests in `Recorder.Tests/`). |
| `normalization/` | Analyst side Python pipeline: `normalize.py` and its stage modules; `transcript_import.py`; `golden_check.py` and `golden/`. |
| `viewer/` | Analyst side Electron app. `viewer/python/` is the bundled Python (gitignored, built by `scripts/build-python-embeddable.ps1`). |
| `e2e/` | The in-repo Playwright gate: smokes against the real viewer, all run by `run-all.js`. |
| `shared/` | Cross-layer contracts: [SCHEMA.md](shared/SCHEMA.md) (authoritative); `recognition-patterns.json`; `process-label-patterns.json` and `screen-label-patterns.json` with their goldens; `run-differences-golden.json` (pins the viewer and the PDD to one alignment rule). |
| `docs/` | Docs, ADRs, plans and audits; index at [docs/README.md](docs/README.md). |
| `scripts/` | Build and release scripts, plus the structure-only data scripts. |
| `sessions/example-aggregate/` | The committed demo: 10 sessions of one order-to-cash process. |
| `corpus/` | Product-era test scenarios (scripts, events, expected outputs); no test or gate reads them. |
| `.claude/agent-findings/` | Cycle records: contracts, resume state, findings register, cut map. |
| `sessions/` (rest), `dist/` | Gitignored: captured sessions and build output. |

## Documentation map

| Read | When |
|---|---|
| [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md) | The layers and the data flow, first. |
| [docs/architecture/DATA-MODEL.md](docs/architecture/DATA-MODEL.md), [shared/SCHEMA.md](shared/SCHEMA.md) | Session files, the annotation model. Touching session data: read SCHEMA. |
| [docs/architecture/CAPTURE.md](docs/architecture/CAPTURE.md) | The capture app and the recorder. |
| [docs/architecture/NORMALIZATION.md](docs/architecture/NORMALIZATION.md) | The pipeline: CLI, stages, modules. |
| [docs/architecture/VIEWER.md](docs/architecture/VIEWER.md), [VIEWER-TIMELINE.md](docs/architecture/VIEWER-TIMELINE.md) | The viewer's internals. Both still describe the product viewer; the rewrite waits for the subtraction lane. |
| [docs/architecture/DESIGN-SYSTEM.md](docs/architecture/DESIGN-SYSTEM.md) | CSS tokens, themes, contrast, the UI copy style guide. |
| [docs/architecture/COHERENCE-AUDIT.md](docs/architecture/COHERENCE-AUDIT.md) | The discipline every new verb passes. |
| [docs/adr/](docs/adr/README.md) | Decisions; the registry is CI-enforced. |
| [CONTRIBUTING.md](CONTRIBUTING.md), [docs/BUILD-AND-DIST.md](docs/BUILD-AND-DIST.md), [docs/DEPLOY.md](docs/DEPLOY.md) | Dev setup, build, release, install. |
| [CHANGELOG.md](CHANGELOG.md) | Release history; `[Unreleased]` is the 2.0.0 draft. |

## Key concepts

- **The drafting rule** (contract C1, `step_suggest.auto_suggest_steps`).
  Within a run, walk the interactions in time order: a step is a stretch on
  one screen, ending at a commit interaction (a button, split button, menu
  item or link invocation, or a vocab entry with `completion: true`),
  inclusive; or at the first interaction on another screen, exclusive; or at
  the end of the run. Interactions outside every run are drafted the same way
  with `case_id: null`. Each draft carries `draft_key`
  (`"<app>|<screen>|<commit>"`, value-free), `name_source` (`remembered` or
  `draft`) and `end_reason` (`commit`, `screen_change`, `run_end`).
- **Merged steps keep `draft_keys`**: the members' keys in order. A merge in
  the pattern run is carried to the same drafts in the other runs, and the
  differences view and the PDD's section 6.1 align on one rule (draft key,
  merge key, else label), pinned by `shared/run-differences-golden.json`.
- **Step states:** `auto_suggested` (a draft), `confirmed`, `edited`,
  `manually_authored`, `hidden`. Everything except `auto_suggested` survives
  re-analysis. Drafts are hidden, not deleted, so Analyze cannot bring them
  back.
- **The pattern run** (`annotations.pattern_run`, C3): the run the analyst
  confirms first (default: the first run with a step). Confirm run turns its
  remaining drafts into `confirmed`; Reopen run is the inverse.
  `draft_fixes` counts merge, split, add and drop on it: the P1 probe number.
- **Remembered names** (light vocab, C4):
  `<viewer userData>/pdt-library/remembered-names.json`, keyed by
  `draft_key`. A rename is remembered, applied at once to the session's other
  drafts with that key, and read by the pipeline through `--names` on every
  Analyze. The Remembered names dialog renames or forgets one.
- **Saved processes** (light template, C5):
  `<viewer userData>/pdt-library/processes.json`, written by "Save as this
  process". A session with no confirmed pattern run is compared with the
  closest saved process (distinct `draft_key` overlap, Jaccard, at least 0.5).
  Viewer only; the pipeline never reads it.
- **Runs.** Case detection is markers only. Runs never nest: a Start that
  arrives while a run is open ends that run first (the derived start marker
  names it in `ends_case_id`). Case ids are deterministic (C9:
  `uuid5(namespace, "<session_id>:<start marker event_id>")`), so analyst
  steps stay attached across re-analysis. A session with no run markers has
  no runs.
- **The map.** The Map level draws one process map from the runs' visible
  steps. `--mine` writes the matching step-level BPMN,
  `process_map_step.bpmn`, which Fork copies into an editable As-Is or To-Be
  map (`annotations.reference_maps[]`, blob in `derived_maps/`; ADR-0019).
  The pipeline never touches a fork.
- **The PDD** (`pdd_export.py`) is tool-neutral and built around the
  confirmed pattern run. Document sections (C6, `annotations.document`:
  title, purpose, scope, contacts, business rules, exceptions, notes) fill its
  placeholders and survive re-export; a step's `description` (C7) is its text
  in the detailed steps. Section 1 holds the findings.
- **The meeting transcript** (C8). The viewer's Attach transcript runs
  `transcript_import.py`, which writes `transcript.json`. A sentence's wall
  time is `manifest.started_at + offset + start_s`; the offset is
  `transcript.offset_ms` once the analyst synced it, else the attached
  video's offset, else the sentence is not placed. Sync writes `offset_ms`, a
  re-import resets it to `null`, Remove deletes `transcript.json` only. A
  sentence added to a step's description or a document field reaches the
  PDD. Nothing interprets the text.
- **Raw data is immutable.** `events.jsonl` is append-only; every analyst edit
  lives in `annotations.json`. Both writers replace that file atomically
  (temp file, then rename); the viewer first copies the current file into
  `annotations.json.2` (newest) to `.5`. An unreadable `annotations.json` is
  reported and never overwritten. Keys of cut features round-trip untouched
  (C10).
- **Honest failures.** A failed analysis stage writes its key as `null` and
  one entry in `analysis.json.stage_errors` (C12); renderers say "this check
  could not run on this recording", never a measured zero.
- **`normalize.py` exit codes** (C13): 0 success; 1 usage error or not a
  session folder (also an unexpected crash); 2 unreadable `annotations.json`,
  nothing written; 3 a requested export failed after the analysis outputs
  were written. Errors are one stderr line starting `[normalize] ERROR:`.
- **Value-free labels.** `process_label` (the grouping key) and the screen
  string strip record numbers and case values with the rules in
  `shared/process-label-patterns.json` and `shared/screen-label-patterns.json`,
  loaded by both Python (`step_suggest`) and JS (`process-map-levels.js`).
  Nothing to hand-sync. A vocab `screen_id` wins when present.
- **Recognition layer** ([ADR-0011](docs/adr/0011-platform-recognition-layer.md)):
  interactions are typed by documented platform signatures in
  `shared/recognition-patterns.json`, read by `viewer/recognition.js` and
  `normalization/recognition.py`.
- **Classification** is an internal engine with no editing UI (AD-16).
  Drafting does not use it; the analysis stages and the PDD findings do,
  fed by the bundled `taxonomy.yaml` the viewer always passes.

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

Import a Teams transcript (exit 0 imported, 1 bad arguments or not a session
folder, 2 unreadable or unsupported transcript, 3 session read or write
failure):

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
`origin/master` (`gh release create` tags the default branch's HEAD);
`-Prerelease` marks a pre-release. Detail:
[docs/BUILD-AND-DIST.md](docs/BUILD-AND-DIST.md).

## Verification

- UI bugs are invisible to the unit suites: validate behaviour in the real
  viewer through the e2e smokes. `e2e/session-smoke.js` holds the map
  connectivity pin (one component, one entry step, one final step).
- The gates before any merge to master (resume state, "Gates"): full-deps
  pytest, the golden, `node --test` in `viewer/` and `capture/`,
  `node run-all.js` in `e2e/`, and `dotnet test` when `capture/recorder/`
  changed.
- CI runs `pytest.yml`, `js.yml` and `e2e.yml` on `windows-latest`. Check
  `gh run list --branch master --limit 6` at session start: CI once stayed red
  for months while local runs looked green.
- Agents read [docs/CHIP-GUARDRAILS.md](docs/CHIP-GUARDRAILS.md) for the hard
  invariants and how to launch the viewer. Its command list and DOM-handle map
  predate the light viewer (rewrite queued); the commands in this file are
  current.
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
