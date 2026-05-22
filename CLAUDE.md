# CLAUDE.md

Project context for Claude Code. For the full documentation set start at
[docs/README.md](docs/README.md); for architecture,
[docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md).

**Active direction (2026-05):** the systemic value-chain gaps (why the app
produces logs, not process insight) and the phased plan to close them are in
[docs/architecture/VALUE-CHAIN-REVIEW.md](docs/architecture/VALUE-CHAIN-REVIEW.md)
— read it before working on segmentation, the process map, recorder UX, or step
annotation. Tactical fix list: [ADR-0010](docs/adr/0010-ux-overhaul-viewer-recorder.md).
The cross-session canonical-template path in
[ADR-0009](docs/adr/0009-normalization-redesign-v013.md) is redirected to
intra-session repetition alignment (see the review's Decision 1).

## What this is

Process Discovery Tracker — an internal Windows **process-mining** tool. A worker
records how they perform a business process (Capture); an analyst transforms the
recording (Normalization) and explores it (Viewer) to produce process maps, a
step/phase breakdown, and statistics. Current version: **0.12.0** (SemVer 0.x).

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
