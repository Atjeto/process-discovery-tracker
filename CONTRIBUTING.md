# Contributing

Developer guide for the Process Discovery Tracker. New here? Read
[docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md) first; the
current direction and plan are at the top of [CLAUDE.md](CLAUDE.md).

## Prerequisites

- **Windows.** The tool is Windows-only (UI Automation, `active-win`, OBS).
- **Node.js 18 or newer** and npm, for both Electron apps and the e2e smokes
  (CI uses Node 20).
- **.NET 8 SDK**, for the C# recorder sidecar (`capture/recorder/`).
- **Python with the pipeline dependencies.** The viewer's bundled embeddable
  (`viewer/python/`, gitignored, built by
  `scripts/build-python-embeddable.ps1`) runs the pipeline, the golden and
  the e2e smokes. A system Python with `normalization/requirements.txt`
  installed works too (CI uses Python 3.12). Tests also need pytest: see
  *Test gates*.
- **PowerShell** for the build and release scripts. Scope-set the policy:
  `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force`.
- Optional: **OBS Studio 28+** with WebSocket enabled, for video capture; the
  **`gh`** CLI, for publishing releases.

## Working on each component

### Capture (`capture/`)

```
cd capture
npm install
npm run build:recorder   # compile the C# sidecar (once, and after recorder/ changes)
npm start                # launch the tray app
npm test                 # node:test unit suite
```

`PDT_DEBUG=1` turns on the `boot.log` diagnostic; `PDT_CONFIG` points at a
per-session YAML config (see `capture/sample-config.yaml`). Architecture:
[docs/architecture/CAPTURE.md](docs/architecture/CAPTURE.md).

### Viewer (`viewer/`)

```
cd viewer
npm install
npm start
npm test
```

The viewer runs the pipeline with `PDT_PYTHON` when set, else
`viewer/python/python.exe`, else the `python` on PATH; in development it
finds `../normalization/normalize.py`. The app has no reload key: after a
code change, quit it and start it again. Architecture:
[docs/architecture/VIEWER.md](docs/architecture/VIEWER.md).

### Normalization (`normalization/`)

Re-analyze a session the way the viewer does, and import a transcript:

```
viewer/python/python.exe normalization/normalize.py <session_folder> --taxonomy normalization/taxonomy.yaml --mine
viewer/python/python.exe normalization/transcript_import.py <session_folder> <transcript.vtt|.docx>
```

Add `--names <path to remembered-names.json>` to draft with the remembered
names. Stages, flags and exit codes:
[docs/architecture/NORMALIZATION.md](docs/architecture/NORMALIZATION.md).
Never re-analyze `sessions/example-aggregate/` in place for a commit: copy
the session to a temp folder first (the golden and the smokes do).

## Test gates

Run these before every merge to `master`; CI runs the same suites in three
workflows (`pytest.yml`, `js.yml`, `e2e.yml`) on `windows-latest`.

**1. Full-deps pytest.** A plain `python -m pytest normalization/test/` with
a system Python that has pytest but not pandas or pm4py skips every pipeline
test module and still looks green. Run the bundled interpreter with the
system pytest appended to its path instead (appending keeps the bundled
pandas and pm4py in charge; nothing gets installed), from `normalization/`:

```
../viewer/python/python.exe -c "import sys; sys.path.append(r'<system Python>\Lib\site-packages'); import pytest; sys.exit(pytest.main(['test/', '-q', '-p', 'no:cacheprovider']))"
```

On the owner's dev box `<system Python>` is
`C:\Users\rasha\AppData\Local\Python\pythoncore-3.14-64`. Confirm the run
reports passed tests, not skips.

**2. The session golden.** `viewer/python/python.exe normalization/golden_check.py`
re-analyzes the 10 demo sessions in temp folders and diffs a projection of
the output. Unintended drift is a bug; `--update` only for an intended
change, and say so in the commit.

**3. Unit suites.** `node --test` in `viewer/` and in `capture/` (`npm test`
does the same).

**4. The recorder**, when `capture/recorder/` changed:
`dotnet test capture/recorder/Recorder.Tests/Recorder.Tests.csproj`.

**5. e2e, the real viewer.**

```
cd e2e
npm install              # once; the smokes also reuse viewer/node_modules/electron
node run-all.js          # every smoke in turn, then one summary line each
```

Each smoke launches the real viewer on a throwaway profile against a temp,
re-analyzed copy of a demo session (or a project it makes in a temp folder),
so it needs a Python with the pipeline dependencies.
`e2e/session-smoke.js` holds the map connectivity pin. The
window is 1500x950 unless `PDT_E2E_WINDOW` names another size (for example
`1366x768`, the work laptop). CI's runner display is 1024x720 and Windows
refuses a window larger than the display, so check small sizes before
trusting a layout change; each launch logs the size it really ran at.

UI bugs are invisible to the unit suites: validate a UI change in the real
viewer. [docs/CHIP-GUARDRAILS.md](docs/CHIP-GUARDRAILS.md) has the launch
recipe, the hard invariants and the DOM handles of every surface.

## Building and releasing

`scripts/build-distribution.ps1` produces both apps and the release zips in
`dist/release/`; `scripts/publish-release.ps1 -Version X.Y.Z -NotesFromChangelog`
creates the GitHub Release (`-Prerelease` for a pre-release). It refuses to
run unless the tree is clean and `HEAD` equals `origin/master`, because
`gh release create` tags the default branch's head. Releases ship unsigned
([ADR-0026](docs/adr/0026-distribution-unsigned-and-services-boutique-scope.md)).
Full procedure: [docs/BUILD-AND-DIST.md](docs/BUILD-AND-DIST.md).

## Conventions

- **No bundler.** Both Electron apps use CommonJS `require()`
  (`nodeIntegration: true`). New code is plain `module.exports`; do not add
  webpack, Vite or esbuild.
- **Tests** use Node's built-in `node:test` and `pytest`, nothing else. A
  test changes in the same commit as the behavior it pins; never delete a
  guard to make it pass.
- **Shared rules, not copies.** The value-free label rules
  (`shared/process-label-patterns.json`, `shared/screen-label-patterns.json`),
  the platform signatures (`shared/recognition-patterns.json`) and the
  system names (`shared/system-names.json`) are loaded by both Python and
  JS; the label goldens in `shared/` pin both sides. The rules written in
  both languages are pinned by one golden each: the differences between
  transactions (`run-differences-golden.json`), the step flow's edges
  (`flow-links-golden.json`), the maps a project holds
  (`sub-process-maps-golden.json`), and the signature of the steps the
  Overview's rows were measured from (`steps-signature-golden.json`);
  `pdd-rows-golden.json` pins the PDD's rows the Overview shows. Change one
  side only together with the other and the golden.
- **Raw capture data is immutable.** `events.jsonl` is append-only; every
  analyst decision is an `annotations.json` entry. Re-analysis stays
  non-destructive, and keys of cut features round-trip untouched.
- **ADRs.** A non-obvious or contested decision gets an ADR in
  [`docs/adr/`](docs/adr/). The number is `max(existing) + 1`: never reuse a
  number, never fill a gap. Add the row to the registry
  [`docs/adr/README.md`](docs/adr/README.md) in the same commit;
  `normalization/test/test_adr_registry.py` fails the build otherwise.
- **Coherence.** A new verb needs its inverse, a legend, a
  control-interaction check and a real-run check
  ([COHERENCE-AUDIT.md](docs/architecture/COHERENCE-AUDIT.md)).
- **Git.** Branch off `master`, fast-forward `master` when the gates are
  green, delete the merged branch. Parallel agents share one working
  directory: isolate with a git worktree and check the current branch before
  any git write. Commit subjects are imperative, with no `Co-Authored-By`
  trailer; write the message to a file and use `git commit -F`.
- **Writing.** No dash punctuation in docs, UI copy or commit messages: no em
  dash, no en dash, and no ASCII stand-in for them (a double hyphen, or a
  hyphen with spaces around it) between clauses.
  `viewer/ui-copy-guard.test.js` fails on an em or en dash, and on the banned
  jargon, in UI strings (the list is in
  [DESIGN-SYSTEM.md](docs/architecture/DESIGN-SYSTEM.md)).
- **Docs.** Update the matching architecture doc and
  [`shared/SCHEMA.md`](shared/SCHEMA.md) in the same change as the behavior.
  Never hardcode line or test counts.
- **Company data.** Real captures never enter the repo or an assistant; use
  the structure-only `scripts/inspect-events.js` and `scripts/count-cases.js`.

## The documentation set

[docs/README.md](docs/README.md) is the index: current docs first, the
product edition's history after. Architecture reference lives in
`docs/architecture/`, decisions in `docs/adr/`, the data contract in
[`shared/SCHEMA.md`](shared/SCHEMA.md), and the plan of record in
[`docs/To-Do/BA-HELPER-PLAN-2026-09-22.md`](docs/To-Do/BA-HELPER-PLAN-2026-09-22.md).
