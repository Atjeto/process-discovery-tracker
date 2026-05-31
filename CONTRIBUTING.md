# Contributing

Developer guide for the Process Discovery Tracker. New to the project? Read
[docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md) first — it explains
the three-layer system in a page.

## Prerequisites

- **Node.js 18+** and npm — for both Electron apps.
- **.NET 8 SDK** — for the C# recorder sidecar (`capture/recorder/`).
- **Python 3.12** — only to run or develop the normalization pipeline directly;
  the viewer ships its own bundled Python.
- **PowerShell** — the build and release scripts are `.ps1`.
- **Windows** — the product is Windows-only (UI Automation, `active-win`, OBS).
- Optional: **OBS Studio 28+** (WebSocket enabled) for video capture; the **`gh`**
  CLI for publishing releases.

## Working on each component

### Capture (`capture/`)

```
cd capture
npm install
npm run build:recorder   # compile the C# sidecar (once, or after recorder/ changes)
npm start                # launch the tray app
npm test                 # node:test unit suite
```

`PDT_DEBUG=1` enables the `boot.log` diagnostic. See
[capture/README.md](capture/README.md) and
[docs/architecture/CAPTURE.md](docs/architecture/CAPTURE.md).

### Viewer (`viewer/`)

```
cd viewer
npm install
npm start
npm test
```

The viewer spawns the Python pipeline; in dev it resolves `../normalization/`.
See [viewer/README.md](viewer/README.md) and
[docs/architecture/VIEWER.md](docs/architecture/VIEWER.md).

### Normalization (`normalization/`)

```
cd normalization
pip install -r requirements.txt
python normalize.py <session_folder> --taxonomy sample-taxonomy.yaml --mine
```

See [docs/architecture/NORMALIZATION.md](docs/architecture/NORMALIZATION.md).

## Building & releasing

`scripts/build-distribution.ps1` produces ship-ready folders + release zips for
both apps; `scripts/publish-release.ps1` cuts the GitHub Release. The full
procedure — version bump, CHANGELOG, build, verify, publish — is documented in
[docs/BUILD-AND-DIST.md](docs/BUILD-AND-DIST.md).

## Conventions

- **No bundler.** Both Electron renderers use CommonJS `require()` directly
  (`nodeIntegration: true`). New code is plain `module.exports` — do not add
  webpack/Vite/esbuild.
- **Tests** use Node's built-in `node:test` (no Jest/Mocha). Keep pure-logic
  modules under test; GUI behaviour is verified by launching the app.
- **Architecture decisions** that are non-obvious or contested get an ADR in
  [`docs/adr/`](docs/adr/) — copy the format of an existing one. **The ADR number
  is `max(existing) + 1`: never reuse a number, never fill a gap.** Add your row to
  the registry [`docs/adr/README.md`](docs/adr/README.md) in the same commit — it is
  the single source of truth and is **CI-enforced** (`normalization/test/test_adr_registry.py`
  fails the build on a duplicate, an unregistered ADR, or a reused gap).
- **Concurrent agents / chips.** When more than one agent runs at once (a known
  hazard — they share the working dir and have collided before): each works on a
  **distinct, explicitly-named branch off `master`** (never commit to `master`
  directly), in its own git worktree, and each takes a **distinct next ADR number**
  per the rule above. If two tasks touch the same layer, prefer running them
  **sequentially**. Reconcile divergent branches in a verify-and-merge sweep, not by
  letting them race.
- **Raw capture data is immutable.** `events.jsonl` is append-only; every analyst
  correction is an `annotations.json` sidecar entry. Re-normalization must stay
  non-destructive — it preserves manually-authored and edited steps.
- **Keep docs current.** When you change behaviour, update the matching
  architecture doc and `CHANGELOG.md` in the same change — outdated docs are
  worse than none.

## The documentation set

[docs/README.md](docs/README.md) is the index — it maps every doc and says which
to read for a given task. Architecture reference lives in `docs/architecture/`,
decision records in `docs/adr/`, the data contract in
[`shared/SCHEMA.md`](shared/SCHEMA.md), and the capability catalogue in
[`docs/FEATURES.md`](docs/FEATURES.md).
