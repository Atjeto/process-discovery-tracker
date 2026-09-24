# Viewer

The analyst's Electron app. It opens a session folder (a recording from the
capture app, or a project started from a video or from nothing), runs the
Python pipeline by itself, and shows the session in four levels: Overview,
Timeline, Steps and Map. The analyst confirms the reference run, reviews the
other runs, writes the document and exports the PDD and the process map.

How it is built: [docs/architecture/VIEWER.md](../docs/architecture/VIEWER.md)
and [VIEWER-TIMELINE.md](../docs/architecture/VIEWER-TIMELINE.md). What it
does: [docs/FEATURES.md](../docs/FEATURES.md).

## Run

```
npm install
npm start          # the app; Ctrl+R reloads the renderer
npm test           # the unit suite (node:test), incl. the UI copy guard
```

`npx electron . --session=<folder>` opens a session folder at launch.

## Python

The pipeline runs with the first Python found:

1. `PDT_PYTHON`, when set;
2. the bundled embeddable in `viewer/python/` (`resources/python/` in a
   packaged build), built by `scripts/build-python-embeddable.ps1`;
3. `python` on the path, with `normalization/requirements.txt` installed.

The scripts it runs (`normalize.py`, `transcript_import.py`) are found in
`../normalization/` from source and under `resources/normalization/` in a
packaged build; the shared rule files in `../shared/` or
`resources/shared/`.

## Where things are kept

- Everything about a session lives in its folder: the analyst's edits in
  `annotations.json` (backups `annotations.json.2` to `.5`), the analysis
  outputs, an attached video in `video/`, the transcript, screenshots and
  attachments the analyst added, and the edited maps in `derived_maps/`.
- On the analyst's computer (the app's user data folder): the saved names
  and the saved processes in `pdt-library/`, and the recent list, the theme
  and the layout in the app's local storage.

## Tests

- Unit tests: `npm test` here (`*.test.js` next to each module).
- The real app: the e2e smokes in [`../e2e/`](../e2e/README.md).
