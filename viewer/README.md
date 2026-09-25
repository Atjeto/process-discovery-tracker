# Viewer

The analyst's Electron app. It opens a project folder (a recording from the
capture app, or a project started from a video or from nothing), runs the
Python pipeline by itself, and shows the project in four levels: Overview,
Timeline, Steps and Map. The analyst confirms the reference transaction,
sets the flow where the process branches or loops, reviews the other
transactions, writes the document and exports the PDD, the process map, the
Technical details and the whole project as a zip. *Hand off...* gives the
developers a numbered version, which they open read only with *Open a
hand-off (.zip)...*.

How it is built: [docs/architecture/VIEWER.md](../docs/architecture/VIEWER.md)
and [VIEWER-TIMELINE.md](../docs/architecture/VIEWER-TIMELINE.md). What it
does: [docs/FEATURES.md](../docs/FEATURES.md).

## Run

```
npm install
npm start          # the app (no reload key: after a code change, quit and start it again)
npm test           # the unit suite (node:test), incl. the UI copy guard
```

`npx electron . --session=<folder>` opens a project folder at launch.

## Python

The pipeline runs with the first Python found:

1. `PDT_PYTHON`, when set;
2. the bundled embeddable in `viewer/python/` (`resources/python/` in a
   packaged build), built by `scripts/build-python-embeddable.ps1`;
3. `python` on the path, with `normalization/requirements.txt` installed.

The scripts it runs (`normalize.py`, `transcript_import.py`) are found in
`../normalization/` from source and under `resources/normalization/` in a
packaged build; the shared rule files in `../shared/` or
`resources/shared/`; the app's activity library in
`../library/activities.json` or `resources/library/activities.json`
(`PDT_LIBRARY` names another file, for tests), passed to every analysis as
`--library` (contract C21).

## Where things are kept

- Everything about a project lives in its folder (the code and the data
  call it the session folder, and a transaction a run): the analyst's
  edits in `annotations.json` (backups `annotations.json.2` to `.5`), the
  analysis outputs, an attached video in `video/`, the transcript,
  screenshots and attachments the analyst added, and the edited maps in
  `derived_maps/`. Every change saves itself there (the top bar says
  *Saved*), and Export, *Whole project (.zip)* makes one zip of the folder,
  next to it, to hand the project to someone.
- On the analyst's computer (the app's user data folder): the hand-offs
  opened in `handoffs/`, the files removed from a project waiting for an
  Undo in `pdt-removed/`
  (emptied when the app starts), and the recent list, the theme and the
  layout in the app's local storage.

## Tests

- Unit tests: `npm test` here (`*.test.js` next to each module).
- The real app: the e2e smokes in [`../e2e/`](../e2e/README.md).
