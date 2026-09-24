# e2e: the viewer smokes (merge gate)

Playwright drives the **real** viewer (the Electron app in `viewer/`) and
**asserts**: each smoke prints one line per check and exits non-zero on a
regression, so CI blocks the merge. UI bugs are invisible to the unit suites;
these are where they show.

## Run

`viewer/` must be `npm install`-ed first: the smokes reuse
`viewer/node_modules/electron` and install no Electron of their own.

```
cd e2e
npm install
npm test                                  # = node run-all.js
node session-smoke.js                     # one smoke on its own
PDT_E2E_WINDOW=1366x768 node run-all.js   # (Bash) at a smaller window
```

**`run-all.js`** runs the seven smokes one after another, each even when an
earlier one failed, passes their output through, then prints one summary
line per smoke and a total:

```
[run-all] PASS session-smoke.js    ..../.... checks   ..s  exit 0
[run-all] 7 smokes: 7 passed, 0 failed
```

A smoke exits `0` when every check passed, `1` when a check failed, `2`
when it could not run (the viewer did not launch, or the driver crashed).
`run-all.js` exits `0` only when every smoke did, else `1`.

## What each smoke covers

Every smoke also fails on any page error.

| Smoke | Covers |
|---|---|
| `session-smoke.js` | The shell: one top bar (Open, the four levels, the status line, Export, Help, theme; no Analyze button, no More menu), the four levels render, the Run select on the Timeline only, the version in Help. The **map connectivity pin**: the map from the runs is one connected graph (one component, one entry step, one final step), left to right, every path drawn. The Timeline's side panel, lanes and one clock; the step pane's fact line and screenshots; Export's map image and BPMN; Edit as the As-Is map (analyzes first after a rename; edit, save, reload; delete and Ctrl+Z; the source file untouched); a marker insert shown at once as pending, then applied; runs never nest; an unreadable `annotations.json` shown as an error, never written over. |
| `overview-smoke.js` | The Overview as the home: What is left (five stages, one button, each next act landing where it says), the recording line, the ten document fields saved and undoable, Recents named by the title, Observations, the marker fixes and Apply with its confirmation; Attach video synced with two clicks; the PDD export with and without an As-Is copy; a copy with no markers; the automatic analysis on a copy never analyzed (one status line, Cancel, the log only on a failure). |
| `runs-smoke.js` | The Steps level: the runs and the reference run, Use as reference run, renames saved and carried to the same drafts, the draft-fix count, the keyboard, Confirm run and Reopen run, other runs opened not confirmed, a merge carried to every run, Hide in all runs, the differences, Save as this process and a later session compared with it (Stop comparing, Forget), the Saved names dialog, Re-analyze keeping the analyst's steps. |
| `map-slim-smoke.js` | The Map: one diagram with only its own controls, the edge tip in words, every path drawn, the map following the steps live, a renamed draft staying one box, the message when no run is marked or the run check failed, a one-run session getting its map and its As-Is copy. |
| `transcript-smoke.js` | The meeting transcript: Attach, the lane before and after Sync, the sentences in the step pane and on the Overview, Add to a description or a document field, a bad file refused, the sentences in the exported PDD, Remove, an unreadable `transcript.json`. |
| `panel-smoke.js` | The step panel from its three doors (a map box, a timeline step band, a Steps row with Watch), each playing the right moment in its own video; the map boxes naming their system; Attach video copying the video into the folder with a relative path, and the folder moved to another place still finding it. |
| `companion-smoke.js` | Sessions without a recording (contract C16): New without a recording and New from a video (the folder's files, the implicit run, the Timeline on the video's length), steps added by hand in order and moved, a system per step, screenshots from a file, a paste and a video frame, Use in PDD, Remove with Undo and Redo, attachments on the session and on a step, notes on a step and at a moment, and what the exported PDD carries. |

## How a smoke launches the viewer

- **Temp copies only.** A smoke copies a committed demo session
  (`sessions/example-aggregate/sess-2026-0514-0900`) into the OS temp folder
  and analyzes it there with the current pipeline (the bundled
  `viewer/python`, else `python` on the path), so the committed demo is never
  rewritten. Without a Python that has the pipeline dependencies the
  smokes fail (`overview-smoke.js` and `map-slim-smoke.js` as a failed
  check, the others with exit 2); `session-smoke.js` instead opens the
  committed session and skips the checks that write into it.
  `companion-smoke.js` makes its own projects in a temp folder.
- **A throwaway profile** (`throwaway-profile.js`, `launchViewer()`): each
  launch runs on its own Electron user-data folder (`--user-data-dir` under
  the OS temp folder), so no run reads or overwrites the developer's saved
  names, saved processes, recent list or layout. The launch checks that the
  viewer really uses it, and the folder is removed when the app closes.
- **Window size.** The window's content is 1500x950, or the size
  `PDT_E2E_WINDOW` names (`<width>x<height>`; a value that does not parse is
  an error). The real window is sized, not an emulated viewport. Windows
  refuses a window larger than the display, so each launch logs the display's
  work area, the content size and the page size it really got: that line is
  the size a run was checked at. CI's display is 1024x720.
- **One retry.** A launch that fails logs why (the viewer process's exit and
  its last output lines), then retries once, so an intermittent launch
  failure on a slow runner shows its cause without failing the run.
- **Dialogs.** A smoke replaces the main process's open and save dialogs
  (`dialog.showOpenDialog`, `dialog.showSaveDialog`) with ones that answer a
  known path.
- **Failure artifacts.** Screenshots land in this folder as `*.png`
  (gitignored).

## Fixtures

- `fixtures/meeting-transcript.vtt`: a synthetic Teams transcript of ten
  invented sentences by "SME" and "Analyst", from a call that starts 30 s
  before the demo recording (`transcript-smoke.js`).
- The synthetic video: `panel-smoke.js` and `companion-smoke.js` record a
  32 s `.webm` in the viewer's own window (a canvas and MediaRecorder, each
  frame showing its own time) and keep it in the OS temp folder
  (`pdt-e2e-synthetic-32s-v1.webm`) for the next run.

## CI

The `e2e` job (`.github/workflows/e2e.yml`) runs `npm test` here on
`windows-latest` for pull requests and pushes to `master`. It installs the
pipeline dependencies for `python`, and the viewer with its real Electron
binary (unlike `js.yml`, it does not set `ELECTRON_SKIP_BINARY_DOWNLOAD`).
