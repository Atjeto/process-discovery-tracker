# e2e — Session-view smoke (merge gate)

The in-repo, **asserting** Playwright end-to-end gate for the analyst viewer.
It is the successor to the out-of-repo `_pdt_verify` scratch harness — which
was eyeball-only (`console.log` + screenshots, no exit code) and gated nothing,
which is how UI bugs shipped past green unit tests.

This driver launches the **real** viewer Electron app pre-loaded with the
committed demo session and **asserts**, exiting non-zero on any regression so CI
can block the merge.

## What it checks

- **Zero PAGE ERRORs** — no errors on the renderer console across the run.
- **Session loaded** — `#session-loaded` becomes visible.
- **All 5 Session-view levels render** — flow / steps / phases / map / analysis;
  each level's layout container must become visible when its
  `.view-mode-btn[data-level=…]` is clicked.
- **Map-overlay regression stays fixed** — on the Map level the process-map host
  (`#session-layout-map .map-host`) must not vertically overlap the raw-events
  host (`.event-table-host`): map bottom must be `<=` raw-events top. This pins
  the recently fixed overlay bug.

Optional elements that are merely absent (e.g. an empty-state with no map) are
tolerated; only genuine regressions fail the gate. On failure the relevant
`fail-*.png` screenshot is written to this directory (gitignored) as an
artifact.

## Run it

The viewer must already be `npm install`-ed (so `viewer/node_modules/electron`
exists — this driver reuses that Electron and does **not** install its own).

```
cd e2e
npm install
npm test          # === node session-smoke.js
```

Exit code `0` = all checks passed; `1` = a check failed; `2` = the driver could
not launch Electron / crashed.

## CI

Runs as the `e2e` GitHub Actions job (`.github/workflows/e2e.yml`) on
`windows-latest` for pull requests and pushes to `master`. Unlike the unit-test
job (`js.yml`), it does **not** set `ELECTRON_SKIP_BINARY_DOWNLOAD` — it needs
the real Electron binary to launch the app. Once stable it is intended to be
marked a **required** status check.
