# Troubleshooting

Known failure modes and how to diagnose them. How the parts fit:
[architecture/OVERVIEW.md](architecture/OVERVIEW.md). Install and upgrade
questions: [DEPLOY.md](DEPLOY.md). More capture-side answers:
[CAPTURE.md](architecture/CAPTURE.md#troubleshooting).

## Where to look first

| Symptom surface | Where |
|---|---|
| Capture app errors (OBS, saved settings) | `%APPDATA%\process-discovery-tracker-capture\app.log` |
| Capture app launch and lifecycle (set `PDT_DEBUG=1` first) | `%APPDATA%\process-discovery-tracker-capture\boot.log` |
| What the recorder sees on a machine | `%APPDATA%\process-discovery-tracker-capture\sessions\readiness-report.json` (Setup (analyst), Readiness check) |
| An analysis that failed in the viewer | The analysis log at the top of the viewer: it shows only after a failure, its first line the reason |
| Analysis warnings, dropped event lines | `<recording folder>\normalize.log` |
| The pipeline run from a shell | The console; an error is one stderr line starting `[normalize] ERROR:` |

The `dropped_jsonl_lines` field in `stats.json` counts the malformed event
lines the pipeline skipped. Zero is expected.

## Capture side

### OBS does not connect

**Symptom:** the recording has no video; with `obs.required` the start
stops with a "Recording not started" dialog. `app.log` shows
`OBS connect failed at ws://127.0.0.1:4455`.

**Check:**
1. Is OBS Studio running on the same machine? The capture app only connects
   to localhost.
2. Is the WebSocket server on? In OBS: Tools, WebSocket Server Settings,
   Enable WebSocket server; port 4455.
3. If the server has a password, is it saved under Setup (analyst),
   Settings, Video / OBS? It is stored in
   `%APPDATA%\process-discovery-tracker-capture\user-config.json`.
4. A firewall or endpoint security product: localhost WebSockets rarely trip
   them, but a timeout (rather than a refused connection) in `app.log`
   points there.

Settings, **Test OBS connection** runs the same handshake and shows the
underlying error.

### The recorder does not start

**Symptom:** the recording bar shows "Clicks and typing are not being
recorded" and a toast says so; runs and screenshots still record. With
`PDT_DEBUG=1`, `boot.log` shows `recorder spawn failed`, often with
`recorder.exe not found in any candidate path`.

**Check:**
1. Is `recorder.exe` present? See the lookup order in
   [BUILD-AND-DIST.md](BUILD-AND-DIST.md#runtime-resolution); a
   `recorder.zip` found there is extracted automatically.
2. Antivirus quarantine: a corporate product may flag the freshly unpacked
   .NET 8 single-file executable on first run. Allow `recorder.exe` by its
   full path. Releases are unsigned by design
   ([ADR-0026](adr/0026-distribution-unsigned-and-services-boutique-scope.md)).
3. A nearly full C: drive: the recorder unpacks itself to `%TEMP%` and
   records nothing when that fails. Set `DOTNET_BUNDLE_EXTRACT_BASE_DIR` to a
   folder on another drive; the readiness check tests the drive it will use.
4. `PDT_RECORDER_PATH` (a developer override) pointing at a missing file:
   unset it.

The recorder uses UI Automation (`UIAutomationCore.dll`), the Windows
accessibility API screen readers use: no keyboard hooks, no drivers. If a
security scan flags it, see [Security-QA.md](Security-QA.md).

### A key does nothing

**Symptom:** the transaction key does nothing, but the tray's Start
recording or Next transaction works.

**Check:**
1. Another program holds the key (ShareX, OBS itself, Snip & Sketch are
   common). At launch the capture app falls back to the Ctrl+Alt variant
   (a "Keys changed" toast) or tells that a key is not available; the bar
   and the tray always name the key actually registered. Change the key
   under Setup (analyst), Settings, and relaunch.
2. No tray icon at all means the app did not start: see the next item.

### No tray icon

Launch with `PDT_DEBUG=1` and read `boot.log`. Common causes: a second
instance already running (single-instance lock), a missing tray icon file,
antivirus blocking the executable, or a YAML syntax error in the file
`PDT_CONFIG` names (or in `quick-config.yaml`): the app stops at launch and
`boot.log` says `whenReady failed`.

### `PDT_CONFIG` is not picked up

**Symptom:** the request or the settings the file sets are the defaults.

**Check:**
1. `setx PDT_CONFIG ...` affects programs started afterwards, not a running
   one: quit the capture app and start it again.
2. Does the path exist? A missing file quietly falls back to the defaults.
3. Without `PDT_CONFIG`, the app reads the `quick-config.yaml` that the
   Recording setup of a version before 2.0.1 saved, if there is one. The
   analyst can write the request in the viewer instead (the document's
   Request), which the PDD prints.

### A recording shows as recovered

The app did not stop cleanly (a crash, a forced quit, a power loss), and the
next launch marked it recovered. The recording is usable; a transaction
left open stays open, and its elapsed time is not measured.

## Analysis side (the pipeline)

### "Not a project folder"

The folder must hold `manifest.json` and `events.jsonl` directly, not in a
subfolder (a project started from a video or from nothing has an empty
`events.jsonl`). The viewer says "Analysis could not start: this is not a
project folder (no manifest.json)." From a shell, a folder that does not
exist exits 1 with `[normalize] ERROR: <folder> is not a project folder`; a
folder without `events.jsonl` exits 1 with a traceback ending in
`FileNotFoundError: events.jsonl not found in <folder>` (the viewer adds:
"The events file is missing: was the project folder copied completely?").

### `annotations.json` cannot be read

The viewer shows a banner: the file cannot be read, nothing is saved until
it is fixed, and the backups it found, newest first. `normalize.py` exits 2
and writes nothing. To recover, click *Restore the newest backup* on the
banner: it names the newest backup that can be read and when it was saved,
asks first, keeps the unreadable file beside it as
`annotations.unreadable-<YYYYMMDD-HHMMSS>.json`, puts the backup in place
and opens the project again. Without the viewer (or when no backup can be
read), copy a good backup (`annotations.json.2` is the newest, `.5` the
oldest) over `annotations.json` by hand, and open the project again.

### "Dropped N malformed JSONL line(s)"

**Symptom:** `[normalize] WARNING: dropped N malformed JSONL line(s); see
warnings above`.

**Investigate:** `normalize.log` in the recording folder logs each dropped
line with its line number, the error and a snippet.

**Likely causes:**
- The capture app stopped mid-write (a crash, a power loss). One or two
  dropped lines at the end of a recording are harmless.
- The file was edited by hand. Never edit `events.jsonl`: marker fixes are
  made on the viewer's Timeline and stored in `annotations.json`.
- Disk pressure during the recording. Rare.

More than a handful of dropped lines makes the recording suspect: talk to
the SME.

### A check "could not run on this recording"

A stage of the analysis failed. `analysis.json` `stage_errors` names it,
and the Overview shows the sentence with the technical detail. Help,
Troubleshooting, **Re-analyze** runs the analysis again; your confirmed,
edited, added and hidden steps are kept. If it fails again, the analysis
log and `normalize.log` name the problem. The PDD reads no analysis stage,
so a failed stage never changes the document.

### The PDD export failed

`normalize.py` exits 3 with one line: `PDD export to <path> failed: <error>.
Nothing in the project was changed.` The run moves its outputs into the
project folder only when all of it succeeded, so a failed export leaves the
steps and the map as they were. The viewer shows that sentence and never
opens an earlier document; the traceback is in
`normalize.log`. Saving the exported file is a separate step: "the document
could not be saved" comes with the reason Windows gave, for example a file
of that name open in Word.

### The taxonomy YAML does not parse

The viewer passes the bundled `taxonomy.yaml`; an edited copy that breaks
shows "A YAML file has a syntax error: check its indentation." On a machine
with Python, `python -c "import yaml; yaml.safe_load(open(r'<taxonomy.yaml>'))"`
gives the line number. Typical causes: tab characters (YAML wants spaces),
an unquoted string starting with `*` or `&`, a regex backslash not doubled
inside double quotes.

### The step map is missing

The step map (`process_map_step.bpmn`) is built from the steps of the
marked runs: one run gives a plain sequence, two or more are drawn from the
step flow edges (the edges the viewer's live map draws). When it fails, the
analysis prints `[normalize] WARNING: step BPMN failed: <error>` and still
completes: the viewer's Map still draws the runs, Edit as the As-Is map
says the analysis drew no process map, and the PDD prints the map as a
table. Putting noisy apps among the Apps outside the process (the Steps
toolbar) makes the map smaller.

### A BPMN tool rejects the map

The step map is valid BPMN 2.0 with diagram interchange, but a tool may trip
on an element order or a namespace. That is a known swap point: see
[DEPLOY.md](DEPLOY.md#bpmn-export-pivot-adonis-swap-and-go).

## Viewer side

### Open project shows nothing

Open the recording folder (Open, *Open project...*): the one that holds
`manifest.json`. A zip made by the capture app has the recording folder as
its root, so after Explorer's Extract All the recording is the folder
inside the extracted one; choosing the extracted folder opens it too (lane
FX2). Any other folder without `manifest.json` says "The project did not
open: This folder is not a project: it has no manifest.json." with what to
open instead. The viewer has no developer tools to look further. Files that
did not survive the copy from the SME's machine are named in a warning on
the Overview (from `session-integrity.json`).

### A zip does not open as a hand-off

*Open a zip...* opens a zip that *Hand off...* made (one project folder
whose `annotations.json` lists a version, with that version's PDD beside
it) read only: nothing in it can change, and no analysis runs. Any other
zip of one project (the SME's recording, a whole project's zip) is
unzipped into a folder you name and opens for editing. A zip with no
project, or with several, is refused in one sentence.

### The analysis is stuck, or the steps and the map look out of date

While an analysis runs, the top bar says "Updating steps and map..." with
**Cancel**. A run that fails shows the analysis log; one that was stopped
from outside (for example `python.exe` ended in Task Manager) says
"Analysis stopped before it finished". Help, Troubleshooting,
**Re-analyze** runs it again and keeps your confirmed, edited, added and
hidden steps. Changed markers apply only through **Apply marker changes**
in the top bar.

### The Map is empty

The Map says why: no transactions are marked (right-click the Timeline
where each transaction starts, choose Start a transaction here, then
Apply marker changes), the project has no steps yet (add them in Steps),
the analysis has not run yet, or the transaction check could not run.

### The transcript does not line up

"The transcript is not synced to the recording yet": sync it on the
Timeline (pick a sentence, then click its moment). A transcript without its
own sync follows the attached video's sync. A transcript the importer cannot
read (exit code 2) has a layout it does not know; nothing is written.

## Catch-all

If none of the above match:

1. Check the log in the table at the top.
2. Reproduce in isolation: does it happen with a fresh recording, or only
   this one?
3. Note the exact action or command, the recording folder's shape (file
   names and sizes; never its contents, company recordings stay local), and
   the log lines. That is what an issue needs.
