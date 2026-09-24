# Deployment

How to get Process Discovery Tracker onto an SME's machine and an analyst's
machine, and how upgrades and rollbacks work. For how the zips are built,
see [BUILD-AND-DIST.md](BUILD-AND-DIST.md).

## SmartScreen / unsigned binaries

The release `.exe` files are **unsigned by design**
([ADR-0026](adr/0026-distribution-unsigned-and-services-boutique-scope.md):
PDT is the owner's IP and is not signed under the employer's certificate).
On first launch on a fresh machine, Windows SmartScreen may show "Windows
protected your PC": click **More info**, then **Run anyway**. This is
expected for an internal, unzip-and-run tool; there is no installer and
nothing is fetched at runtime. The prompt does not come back once Windows
has seen the file run.

## Capture (the SME's machine)

No admin rights, no installer, no PATH changes. OBS is optional.

1. Download `capture-vX.Y.Z.zip` from the [Releases page](../../../releases).
2. Unzip it where the SME prefers (`C:\Users\<user>\PDT\capture\` is the
   usual place).
3. Run `Process Discovery Tracker.exe`. The tray icon appears, and the first
   launch shows a short welcome.
4. Before the first real recording, run Setup (analyst), Readiness check in
   the tray menu (or `"Process Discovery Tracker.exe" --readiness`, which
   prints the summary and exits 0 ready, 2 not ready, 3 crashed). It checks
   free disk, starts the recorder, and shows how much the recorder sees of
   each open program; the report lands in `readiness-report.json` next to
   the recordings.
5. Optional set-up, all in the tray's Setup (analyst) menu: Recording setup
   (the project and the named runs), Settings (keys, OBS, screenshots, the
   storage limit, the idle end of the open run), Profile (who is recording).
   For a project-wide YAML instead, set `PDT_CONFIG` before launch (`setx
   PDT_CONFIG "C:\Users\<user>\PDT\config\project.yaml"`, which takes effect
   for programs started afterwards); Settings and Profile still layer on
   top. The keys are in [CAPTURE.md](architecture/CAPTURE.md#configuration).

Recordings land under
`%APPDATA%\process-discovery-tracker-capture\sessions\<project>\<timestamp>\`.
The capture app never writes to its install folder, so the install is read
only at runtime. The recorder is a large single-file .NET executable that
unpacks itself to `%TEMP%` on first run; on a nearly full C: drive it
records nothing, so set `DOTNET_BUNDLE_EXTRACT_BASE_DIR` to a folder on
another drive (the readiness check tests the drive it will use).

The SME hands the recording over with the end summary's **Make a zip for
the analyst** (a zip next to the folder; nothing is sent) or by copying the
folder.

### Video (optional)

OBS Studio is not needed. With OBS installed and its WebSocket server on,
the capture app records a video alongside and syncs it; set-up steps are in
[CAPTURE.md](architecture/CAPTURE.md#obs-video-optional). Without OBS, the
analyst can attach a recording of the call (a Teams recording, for example)
in the viewer.

### Browser-based processes (Chrome / Edge)

Most enterprise processes (Salesforce, ServiceNow, web-based ERPs) run in
Chrome or Edge. The recorder reads those interactions through Windows UI
Automation. Chromium browsers build their accessibility tree lazily: until
something asks for it, web content is invisible to UI Automation and the
recorder sees only the address bar.

The recorder wakes it up itself: it touches every Chromium window's
accessibility tree every second, so new windows and tabs are woken too.
Stock Chrome and Edge therefore work out of the box: no launch flag, no
extension, no admin rights.

If the SME sees the toast "Clicks and typing in Chrome are not being
recorded" during a recording, two fallbacks exist:

- **Per launch**: start the browser with `--force-renderer-accessibility`.
  Mostly a one-off diagnostic.
- **Registry policy** (managed machines, needs admin; survives browser
  updates):

  ```
  reg add "HKLM\Software\Policies\Google\Chrome" /v AccessibilityModeEnabled /t REG_DWORD /d 1 /f
  reg add "HKLM\Software\Policies\Microsoft\Edge" /v AccessibilityModeEnabled /t REG_DWORD /d 1 /f
  ```

The wake-up is described for engineers in
[CAPTURE.md](architecture/CAPTURE.md#the-c-recorder-sidecar-capturerecorder).

### Remote and virtualized apps (Citrix, RDP, VMware)

A program running inside a Citrix published app, an RDP session or a VMware
Horizon desktop is, from the local machine, a video stream: UI Automation on
the client sees only the remoting window, and the real controls are pixels
inside it. The recorder flags this: interactions from such a window carry
`framework: "remote"` and a low `confidence`. A recording that is mostly
`framework: "remote"` means the recorder ran on the wrong side.

**Run the capture app inside the remote session**, on the Citrix server, RDP
host or virtual desktop where the program runs, when its profile allows
unsigned Electron apps. Inside, the program's UI Automation tree is local and
rich again, exactly as on a physical machine.

Where that is not possible, run it locally and rely on the video: runs and
screenshots still record, the video shows the content, and the analyst
names the inner programs. The same holds for terminal and console windows
(`framework: "terminal"`) and for legacy controls with no UI Automation
support. The per-program `framework` and `confidence` tally
(`scripts/inspect-events.js`, structure only) shows which stretches need
the video.

## Viewer (the analyst's machine)

No prerequisites: Python is bundled in the zip, so there is no Python
install and no `pip install`.

1. Download `viewer-vX.Y.Z.zip` from the [Releases page](../../../releases).
2. Unzip it. **Pick a short destination path**: the bundled Python's deepest
   paths reach about 175 characters, and with Windows' 260-character limit,
   extracting into a deep folder (a OneDrive sync path, a long tree under
   `Documents\`) can make Explorer's Extract All (and PowerShell's
   `Expand-Archive`) fail part way with no error shown. Anything under about
   80 characters is safe; `C:\Tools\pdt\` or a folder directly under the
   user profile is fine.
3. Run `Process Discovery Viewer.exe` and click **Open project...** to open a
   recording folder (unzip a zip first).

The viewer analyzes a recording by itself when it opens without a current
analysis. It writes into the recording folder (`annotations.json` and its
backups, `stats.json`, `analysis.json`, `process_map_step.bpmn`,
`normalize.log`, `derived_maps/` for the edited maps, `transcript.json`
when a transcript is attached) but never changes `events.jsonl`, so
analyzing again is always safe. The viewer needs no capture install.

## Upgrades

The install is a folder. Upgrading is replacing that folder.

1. Quit the running app (tray Quit for capture, which stops a running
   recording first; close the window for the viewer).
2. Rename the existing folder to `<name>.old` (faster than deleting, and it
   allows an instant rollback).
3. Unzip the new release in its place.
4. Start the app again.

**What survives an upgrade:**

| State | Location | Notes |
|---|---|---|
| Recordings | `%APPDATA%\process-discovery-tracker-capture\sessions\` | Outside the install folder. |
| Capture settings | `%APPDATA%\process-discovery-tracker-capture\` (`user-config.json`, `quick-config.yaml`, `recording-bar.json`) | Settings, Profile, Recording setup, the bar's place. |
| Capture logs | `%APPDATA%\process-discovery-tracker-capture\` (`boot.log`, `app.log`) | Append-only. |
| The analyst's library | `%APPDATA%\process-discovery-tracker-viewer\pdt-library\` (`remembered-names.json`) | The remembered step names. A `processes.json` there (the saved processes, removed on 2026-09-24) is not read. |
| A project YAML | Wherever `PDT_CONFIG` points | Owned by the analyst, not the install. |

**What does not survive:** anything inside the unzipped folder: the bundled
Python, the recorder, the shipped `taxonomy.yaml` and app vocabularies.

## Rollback

The previous install sits next to the new one as `<name>.old`. Quit the
running app, move the new folder away, and rename `<name>.old` back. No
data migration is involved, because no runtime state lives in the install.

If `<name>.old` is gone, download the earlier `capture-vX.Y.Z.zip` or
`viewer-vX.Y.Z.zip` from the [Releases page](../../../releases) and unzip it.
Recording folders do not depend on the install: raw events never change, and
keys a release does not know are kept as they are.

## BPMN export pivot (Adonis swap-and-go)

The step map (`process_map_step.bpmn`) is BPMN 2.0 with diagram
interchange: pm4py's inductive miner (`mining.discover_inductive`) builds the
model from two or more runs, and `mining.export_bpmn` writes it with its own
pure-Python layout. The edited As-Is and To-Be copies are saved by the
viewer's BPMN editor (bpmn-js). The output is meant to import cleanly into a
BPMN tool such as Adonis, but **that compatibility is not load-bearing**: if
a tool rejects the file, the export is the place to change, not the design.

Options, in order of effort:

1. **Adjust the writer.** [mining.py](../normalization/mining.py)
   `export_bpmn` serializes the model; namespace or attribute changes often
   resolve a tool's quirks without touching the model.
2. **Add a post-processor.** An XSLT or Python pass over
   `process_map_step.bpmn`, run after `bpmn_observed.write_observed_bpmn` in
   [pipeline_stages.py](../normalization/pipeline_stages.py)
   (`_run_mining_exports`).
3. **Change the format.** Emit the tool's native format beside the BPMN
   file; the PDD prints a picture of the map, so nothing else depends on the
   file's shape.

In every case `events.jsonl` and `annotations.json` stay the durable
artifacts; the BPMN file is derived from them.

## Several SMEs

Each SME gets the capture zip and records on their own machine; each
recording folder reaches the analyst on its own (a zip or a copy). A shared
project YAML can go to every machine (`PDT_CONFIG`). There is no central
service: the recording folder is the only hand-off.

## Troubleshooting

If something goes wrong during an install or an upgrade, see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md).
