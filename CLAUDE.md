# CLAUDE.md

Project context for Claude Code. For the full documentation set start at
[docs/README.md](docs/README.md); for architecture,
[docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md).

**Active direction (2026-05) — START HERE:** **v0.15.0 shipped** — the P0
coherence pass, active-case case segmentation, and a full notation×level
process-map matrix (the Process diagram now renders Step/Phase as observed-flow
BPMN — it is **not** activity-only). The next-session plan of record is
[docs/To-Do/NEXT-SESSION-SPEC.md](docs/To-Do/NEXT-SESSION-SPEC.md); it leads with
**verifying v0.15.0 in a real run** (the cycle's UI was never eyeballed), then P1
recognition cross-language lift + P2 classification. Hold every feature to the
coherence discipline in [COHERENCE-AUDIT.md](docs/architecture/COHERENCE-AUDIT.md)
— a new "verb" needs its inverse, a legend, a control-interaction check, and a
real-run check (UI bugs are invisible to green tests). Strategic frame:
[VALUE-CHAIN-REVIEW.md](docs/architecture/VALUE-CHAIN-REVIEW.md); ADRs in
`docs/adr/`. Validate by running the **packaged app** (it bundles its own
Python), not dev-box pip.

## What this is

Process Discovery Tracker — an internal Windows **process-mining** tool. A worker
records how they perform a business process (Capture); an analyst transforms the
recording (Normalization) and explores it (Viewer) to produce process maps, a
step/phase breakdown, and statistics. Current version: **0.15.0** (SemVer 0.x).

The two halves never talk over a network — the hand-off is a self-contained
**session folder** moved from the worker's machine to the analyst's.

## Layout

| Path | What |
|------|------|
| `capture/` | Worker-side Electron tray app + the C# .NET 8 recorder sidecar (`capture/recorder/`). |
| `normalization/` | Analyst-side Python pipeline (`normalize.py` + ~13 modules). |
| `viewer/` | Analyst-side Electron app; bundles a Python embeddable to run normalization. |
| `shared/SCHEMA.md` | The authoritative session-data format contract. |
| `docs/` | Documentation set, ADRs, design specs — index at `docs/README.md`. |
| `scripts/` | PowerShell / Node build, release, and admin scripts. |
| `sessions/`, `dist/` | Gitignored — captured sessions and build output. |

## Commands

Run from `capture/` or `viewer/`:

```
npm install
npm start          # launch the Electron app
npm test           # node:test unit suite
```

Build the C# recorder (from `capture/`): `npm run build:recorder` (needs the
.NET 8 SDK). Ship a release (from the repo root, PowerShell):

```
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force
.\scripts\build-distribution.ps1 -SkipPython
.\scripts\publish-release.ps1 -Version X.Y.Z -NotesFromChangelog
```

Detail: [docs/BUILD-AND-DIST.md](docs/BUILD-AND-DIST.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

## Conventions

- **No bundler.** Both Electron apps use CommonJS `require()` directly
  (`nodeIntegration: true`); there is no webpack/Vite/esbuild step. New modules
  are plain `module.exports`.
- **Tests** use Node's built-in `node:test` — no test-framework dependency.
- **Architecture decisions** are recorded as ADRs in `docs/adr/`.
- **Raw capture data is immutable** — `events.jsonl` is append-only; analyst
  edits live in the `annotations.json` sidecar, and re-normalization is
  non-destructive.
- Windows-only; PowerShell for scripts. The git repo root is this directory,
  default branch `master`.

## Gotchas

- The capture recorder is a **separate C# process**, not Node — see
  [ADR-0001](docs/adr/0001-click-recorder-sidecar-language.md).
- Distribution uses **electron-packager** (via each app's `build-package.js`),
  not electron-builder.
- The viewer ships a **bundled Python** (`viewer/python/`); the analyst machine
  needs no Python install.
