# Capture

> The capture app: what the SME uses, how it records, and how to install,
> configure and support it. Depth:
> [`capture/README.md`](../../capture/README.md) (quick start),
> [`docs/interaction-recorder.md`](../interaction-recorder.md) (the recorder's
> design), [ADR-0001](../adr/0001-click-recorder-sidecar-language.md) (why a C#
> sidecar) and [ADR-0005](../adr/0005-capture-architecture-remediation.md)
> (the v0.5.0 module split).

## Purpose and runtime

The capture app runs on the SME's machine and records the SME performing a
business process a few times, one transaction each time
([ADR-0029](../adr/0029-ba-helper-refocus.md)). It is an **Electron** app that
lives in the tray, with a small recording bar and a few utility windows,
plus a separate **C# .NET 8 recorder sidecar** process for UI interactions.
Nothing is sent over a network: the recording stays on the machine until the
SME hands it to the analyst.

Output: one recording folder per recording, under the app's user data
folder:
`%APPDATA%\process-discovery-tracker-capture\sessions\<request code>\<YYYYMMDD-HHMMSS>\`
(file by file below, "The recording folder"; formats in
[SCHEMA.md](../../shared/SCHEMA.md)).

## What the SME sees

- **The tray icon.** While recording, a left click shows the recording bar
  again; otherwise a left click opens the menu. A right click always opens
  the menu. The tooltip and the menu's first line say the state: "Not
  recording", "Recording: Transaction 2", "Paused: between transactions".
- **The tray menu.** Not recording: Start recording (with its key), Open
  recordings folder, Show recording bar, Help, Setup (analyst), Quit.
  Recording: Next transaction, Start a named transaction (when named
  transactions are set up), End transaction (naming the open one), Take a
  screenshot, Pause or Resume recording, Stop recording, then the same
  items as above. Quit stops a running recording first, without the end
  summary.
- **The recording bar** (`recording-bar.js`), the SME's one window while
  recording. One small frameless strip, always on top: the state
  (Recording, Paused, Not recording), the transaction in progress
  ("Transaction 2", or "between transactions" after End transaction), the
  elapsed time (m:ss, h:mm:ss from an hour: the time recorded, the pauses
  left out; while paused, the pause's own length beside Paused, and the time
  paused in all in the bar's tooltip), Next transaction with its key,
  a caret with the named transactions when they are set up, Pause or
  Resume, and Stop with an inline confirm (Keep recording, Stop
  recording). A problem line appears under it only when clicks and
  typing are not being recorded. Made for recording during a Teams call: it
  appears without taking the keyboard focus, asks Windows to leave it out of
  screen captures (a shared screen, the OBS video and the recording's own
  screenshots show the work, not the bar), can be dragged anywhere by its
  text, and remembers its place (`userData/recording-bar.json`). With no
  place saved, or one on a monitor that is gone, it opens at the top centre
  of the main screen, over the title bars, clear of the buttons maximized
  programs keep at the bottom right. While the recorder is still starting
  (the first Start right after the app launched), the line under the row
  says "Starting the recorder...".
  It opens when a recording starts and closes when it stops; the tray's
  Hide recording bar and Show recording bar toggle it.
- **The welcome** (first launch only, flagged in
  `userData/welcome-shown.json`): three lines with the real transaction
  key, the first saying what a transaction is, then Start recording, Help
  and Close.
- **Help**: one screen for the SME: how to start, what a transaction is and
  how to start the next one, pause, stop, handing the recording over, what
  is recorded (password fields are not), where the recordings are, the
  other keys, the version. Everything for whoever installs or supports the
  app is in this document instead.
- **The end summary** (`end-summary-window.js`), the one screen after Stop:
  "Recording saved", the transactions and the duration in one line ("3
  transactions, 12:04", the time recorded; after a pause "(paused 0:04, not
  counted)"), a warning when no transaction was marked, an optional "Name
  this recording" (above the zip, so the zip carries it), the folder,
  **Make a zip for the analyst**, **Show the folder**, and Done. No counts of clicks, events or
  screenshots. One window per recording, so a summary still open from an
  earlier recording keeps its unsaved name.
- **Toasts**, only for something the SME should act on or tell the analyst:
  clicks and typing not recorded (in one program, in a browser, or at all),
  screenshots failing, the recording could not be saved to disk, keys that
  changed or are not available at launch, a recordings folder that cannot be
  written to, a declined consent. Each says what still works and what to do.

The SME reads "recording" and "transaction" (AD-29; the code and the data
keep "run"): "Recording", "Paused", "Not recording", "Transaction 2",
"between transactions". A transaction is one pass through the process, for
example one order or one ticket; the welcome and Help say so.
`capture-guidance.js` holds the words of the bar, the tray's status line
and the end summary, and that definition (`TRANSACTION_MEANS`), and they
never say "run", "session", "events", "interactions" or "Tracking".

## One start, one key per transaction

Every way of starting calls one rule (`recording-control.js`): the Start
recording button on the bar, the tray item, the welcome's button, the
transaction key and `pdt:startSession`. With nothing recording it starts
the recording and then Transaction 1; while recording it starts the next
transaction. So a recording without a transaction is not a state the SME
can reach by starting. A press that arrives while a start or a stop is
still in progress (the consent window open, OBS connecting, the recorder
draining) is absorbed, not queued.

- **Transactions never nest.** A new transaction first ends the open one
  (`tracker.startRun`, end reason `auto_close_for_sibling`). An unnamed one
  is labelled "Transaction N" ("Run N" in recordings made before 2.0.0; N
  counts every start in the recording) or, from the bar's caret or the
  tray's Start a named transaction, a named one from the Recording setup
  (`process_labels`).
- **End transaction** (the second key, or the tray) ends the open
  transaction without starting another; the bar then reads "between
  transactions". It never has to be pressed: stopping ends the open
  transaction by itself.
- **Pause** pauses the tracker and the recorder until Resume; the idle
  monitor skips while paused.
- **Idle.** After `auto_end_idle_minutes` (default 30) without mouse or
  keyboard input, the open transaction ends (end reason `auto_end_idle`, at
  most once per idle stretch) and the recording goes on. With
  `auto_end_on_idle: false` the transaction stays open through idle; the idle
  stretch is recorded either way.
- **Keys.** Three global keys (`hotkeys`): start recording, then the next
  transaction (default Ctrl+Shift+S); end transaction (Ctrl+Shift+E); take
  a screenshot (Ctrl+Shift+P). A key another program already holds falls
  back to its Ctrl+Alt variant at launch (a "Keys changed" toast) or is not
  registered ("Keys not available"). The bar, the welcome, Help and the
  tray name the keys actually registered, never the configured ones.

## What it records

| Source | Mechanism | Produces |
|---|---|---|
| Foreground window | `active-win` polled every 5 s | `activity` events |
| UI interactions | The C# UI Automation recorder sidecar | `interaction` events |
| Transactions (runs) | One start per transaction, End transaction, Stop, a long idle stretch | `marker` events (`start` / `end`) |
| Lifecycle | Start and stop, pause, idle, OBS, recorder health, dropped writes, programs the recorder cannot see | `system` events |
| Screen | Electron `desktopCapturer`: on an app switch, on another screen in the same program, when a transaction starts or ends, on resume after a long idle stretch, and by hand | screenshots |
| Video (optional) | OBS Studio over `ws://127.0.0.1:4455` | a video file and `obs/sync.json` |

Events are appended to `events.jsonl` through a small batching queue:
activity polls and interactions flush on a 500 ms timer, while `marker` and
`system` events flush the whole pending queue at once, so a run boundary or
a lifecycle event is never left only in memory, and a clean stop drains the
queue. A crash therefore loses at most the activity and interaction events
queued at that moment (under 500 ms). Each event carries a monotonic `_seq`
(its 0-based append ordinal), so normalization can order events that share
a millisecond. Screenshot triggers are coalesced by a 2 second leading-edge
debounce, and nothing new starts while a capture is still being taken
(`screenshot-gate.js`), so coincident triggers (an app switch landing with
a run start) collapse to one capture; the first program of a recording is
not an app switch; a screenshot taken by hand is never suppressed. Another
window title in the same program (a web page, a form, a dialog, compared
without unread counts and the browser's name) is another screen and gets
a screenshot at the next 5 second poll (lane LF-SHOT): a web process lives
in one browser, and without it only the first step of each transaction had
a screenshot for the PDD. A screen shown for less than a poll can be
missed.

## Recording lifecycle

- **Start.** A pre-flight check (`validateConfig`) warns with a toast when
  the recordings folder cannot be written to, and the start goes on. When OBS
  is required (`obs.required`) it must connect first, or the start stops
  with a dialog. When a consent gate is configured, the consent window
  comes next; declining stops the start and nothing is created. Then
  `session.js` creates the folder and `manifest.json` (`status: active`), the
  config snapshot is written, the tracker starts polling, the display
  geometry is stamped on the manifest, the dead-man monitor is armed, and
  Transaction 1 starts; the recorder sidecar starts beside them, as soon as
  it is ready (with `interactions.required` the start waits for it). The
  app starts the recorder once at launch, in a worker thread, with nothing
  to record: Windows' check of the large single-file executable and its
  first unpacking happen then, not at the SME's first Start (it froze the
  app for 17 s once). Without `obs.required`, OBS connects in the
  background; without OBS the recording goes on without video and says
  nothing.
- **Stop** (single-flight: the bar and the tray at once stop it only once).
  The recorder stops and drains its last values; OBS stops; a screenshot
  still being taken lands (3 s at most); the tracker
  ends the open run (`endOpenRuns`) before `session_end`; `manifest.json`
  gets `status: closed` and `ended_at`; `session-integrity.json` is written
  last, so the viewer can tell an incomplete copy. The bar closes and the
  end summary opens (not on Quit, and not when a failed start is torn down).
- **Crash recovery.** At the next launch, `session.js` marks every recording
  still `active` with no `ended_at` as `recovered`. A transaction left open
  stays open in `events.jsonl`; the pipeline treats it as running to the
  end of the recording, and its elapsed time is not measured.

## Handing the recording over

The end summary's **Make a zip for the analyst** writes a zip named after
the recording (the name typed above the button, made safe for Windows; the
time stamp `<YYYYMMDD-HHMMSS>.zip` when there is none, or beside the name
when another recording's zip has it; `recording-zip.js`) next to the
recording folder (`zip-folder.js`: plain
PKZIP with UTF-8 names, the folder as the zip's root, already compressed
files such as screenshots and videos stored as they are, written to a
`.partial` file and renamed at the end) and shows it selected in Explorer.
Nothing is sent: the SME attaches the zip to an email or a Teams message by
hand, or copies the folder. A recording over 4 GB, or with more than 65,535
files and folders, cannot be zipped (the summary says so; copy the folder
instead). A recording still running cannot be zipped. A zip made again
replaces the recording's earlier one, whatever it was named (a zip is the
recording's when its first entry is the recording folder). Deleting a
recording under Setup (analyst) deletes its zip too.

## The recording folder

| File | What |
|---|---|
| `events.jsonl` | The raw event stream, append-only |
| `manifest.json` | Recording metadata: ids, the request (code and name), start and end, status, the optional name, the config snapshot, consent, the OBS video's path, the displays |
| `config.yaml` | The configuration the recording used |
| `screenshots/` | The screenshots (`_d<displayId>` suffix per display when `screenshots.display` is `all`) |
| `obs/sync.json` | The OBS video's clock offset, when OBS recorded |
| `session-integrity.json` | Every file's name and size, written at Stop, and again when the recording is named |

The OBS video itself lands where OBS's Settings, Output, Recording Path
says, outside the recording folder; `manifest.json` records its absolute
path. The analyst can also attach a video of the call in the viewer.

## Module map (`capture/`)

`main.js` is the Electron main process and the orchestration core: the tray
menu, the global keys, the recording lifecycle, the idle monitor, the
screenshot triggers and the `pdt:*` IPC handlers. The v0.5.0 remediation
([ADR-0005](../adr/0005-capture-architecture-remediation.md)) extracted the
cross-cutting modules out of it.

| File | Role |
|---|---|
| `main.js` | The main process (above). |
| `recording-control.js` | The one start (pure, injectable): starts the recording with Transaction 1, or the next transaction; absorbs presses during a start or a stop. |
| `capture-guidance.js` | Pure module: the words of the recording bar (`barModel`), the tray's status line and the end summary (`summaryModel`), from one status snapshot; what a transaction is (`TRANSACTION_MEANS`, for the welcome and Help); and the program names in toasts. |
| `tracker.js` | The 5 second active-window polling loop; runs (`startRun` ends the open run first, `endOpenRuns`); event append with `_seq`; the write queue and dropped-batch accounting (RP-21); programs the recorder cannot see (`uncaptured_app`). |
| `session.js` | Recording folder creation, `manifest.json` I/O (`updateManifest` is one read-modify-write), orphan recovery, the integrity file, the optional name, `isRecordingFolder` (the end summary acts only on a real recording folder), `removeSessionFolder` (the folder and its zip). |
| `zip-folder.js` | One recording folder as one zip next to it; local only (`node:fs`, `node:zlib`). The viewer keeps a copy that must stay the same. |
| `recording-zip.js` | Which zips are a recording's (read from the zip's first entry) and the zip's name: the recording's name, else its time stamp. |
| `browser-watchdog.js` | Pure: when to tell the SME that clicks and typing in a browser are not being recorded (below). |
| `screenshot-gate.js` | Pure: when a screenshot trigger takes a screenshot (above). |
| `session-storage.js` | The recordings' sizes (a zip next to a folder counts) and the delete flows under Setup (analyst). |
| `events.js` | Event-envelope factories. |
| `config.js` | Loads and deep-merges the YAML over `DEFAULTS`, the one source of default values; the pre-flight check. |
| `user-config.js` | The persistent `userData/user-config.json` overlay (Settings, Profile, a remembered "once" consent), merged over the YAML at launch. |
| `recorder.js` | Spawns the C# `recorder.exe` sidecar, parses its NDJSON, runs the stdout-quiet watchdog, and `superviseRecorder` restarts it per recording (below); `warmUpRecorder` starts it once at launch in a worker thread. |
| `dead-man.js` | The dead-man monitor (pure, injectable clock): no interaction and no recorder heartbeat for over 2 minutes means the recorder went silent (below). |
| `readiness.js` | The readiness check: free disk on the recordings folder and on the drive the recorder extracts to, the recorder starts and answers, and how much it sees of each open program (rich, basic, minimal, wall). Setup (analyst), Readiness check (only while nothing records), or the `--readiness` command line; both write `readiness-report.json` next to the recordings. Exit codes: 0 ready, 2 not ready, 3 crashed. |
| `obs.js` | OBS WebSocket: scene set-up, start and stop recording, the clock offset. |
| `screenshots.js` | Screen capture with `desktopCapturer`, across monitors. |
| `notify.js` | `notifyUser()` (the OS toast) and the tray icons, the warning one included. |
| `window-manager.js` | Keeps each utility window to one instance. |
| `json-for-script.js` | Serializes a value safely into a window's inline `<script>` (a run name or a path can never break out of it). |
| `boot-log.js` | `bootLog()`: the launch and lifecycle log, `userData/boot.log`, on with `PDT_DEBUG=1`. |
| `log.js` | `appLogger()`: the always-on `userData/app.log` (OBS connection, config saves). Its per-recording logger is not called, so no recording folder holds a log. |

**Windows.** Each window module builds a `BrowserWindow` and loads its
markup from `capture/ui/`; `ui/tokens.js` inlines the fonts and type tokens
shared with the viewer.

| Module | `ui/` file | Window |
|---|---|---|
| `recording-bar.js` | `recording-bar.html` | The recording bar (above). |
| `end-summary-window.js` | `end-summary.html` | The end summary (above). |
| `welcome-window.js` | `welcome.html` | The first-launch welcome. |
| `help-window.js` | `help-window.html` | Help, one screen, static and sandboxed. |
| `consent-window.js` | `consent.html` | The consent gate (below). The pure decision and record logic is in `consent.js`. |
| `settings-window.js` | `settings.html` | Setup (analyst), Settings: keys, OBS, screenshots, the storage limit and the idle end of the open transaction. |
| `profile-window.js` | `profile.html` | Setup (analyst), Profile: who is recording. |
| `session-config-window.js` | `session-config.html` | Setup (analyst), Recording setup: the request (code and name) and the named transactions. |

**Other:** `build-package.js` (the `electron-packager` wrapper for
releases), `test/` (the `node:test` suite: `npm test`), `recorder/` (the C#
sidecar, below).

## IPC surface

The main process answers these `pdt:*` channels from the windows:

| Channel | Used by | Does |
|---|---|---|
| `pdt:status` | recording bar | The status snapshot plus the bar's view model |
| `pdt:fireStart` | recording bar | The one start (a named transaction's label optional) |
| `pdt:namedRunMenu` | recording bar | Pops up the named transactions under the caret |
| `pdt:togglePause` | recording bar | Pause or Resume |
| `pdt:endSession` | recording bar | Stop (the end summary follows) |
| `pdt:barResize` | recording bar | The bar's height follows its content (a problem line) |
| `pdt:fireEnd` | drivers | End transaction |
| `pdt:startSession` | drivers | The one start; returns the folder |
| `pdt:showFolder` | end summary | Explorer with the recording folder selected |
| `pdt:zipFolder` | end summary | Make a zip for the analyst: `{ ok, zipName, size }` or `{ ok: false, error }` |
| `pdt:setSessionLabel` | end summary | The optional name, on the manifest |
| `pdt:welcomeAction` | welcome | `start` (the one start), `help`, `bar` |
| `pdt:consentDecision` | consent window | The SME's decision |
| `pdt:obsTest` | Settings | Test OBS connection |
| `pdt:settingsGet`, `pdt:settingsSave` | Settings | The Settings slices |
| `pdt:profileGet`, `pdt:profileSave` | Profile | Who is recording |
| `pdt:sessionConfigGet`, `pdt:sessionConfigSave` | Recording setup | `userData/quick-config.yaml` |

The end summary's channels act only on a recording folder under the
recordings folder (`session.isRecordingFolder`). Gone: `pdt:manualScreenshot`
(a screenshot by hand is the key or the tray item), `pdt:sessionSummary`
(the end summary is its own window), `pdt:fireSync` (cross-machine sync
markers are cut).

## Configuration

Settings come in layers, each merged over the one before:

1. `DEFAULTS` in `config.js`, the one source of default values (except
   `storage_warn_gb`, read with an inline fallback of 50).
2. A YAML file: `PDT_CONFIG=path\to\config.yaml` set before launch (the whole
   schema: `capture/sample-config.yaml`), else `userData/quick-config.yaml`,
   written by Setup (analyst), Recording setup (the request code and name,
   the named transactions; offered only while nothing records, read at
   the next launch).
3. `userData/user-config.json`: Setup (analyst), Settings (keys, OBS,
   screenshots, the storage limit, the idle end of the open transaction)
   and Profile (id, display name, role, team, stamped on every manifest).
   Saved settings apply at once, except keys, which register at the next
   launch.

| Key | Default | Purpose |
|---|---|---|
| `engagement_id`, `engagement_name` | `"default"`, `"Default engagement"` | The request code and name (Recording setup's Request, AD-30), stamped on the manifest; the code is the folder above the recordings. |
| `worker` | the Windows login | Who is recording: `id`, `name`, `role`, `bu` (team). |
| `process_labels` | `[]` | The named transactions: the caret next to Next transaction on the bar, and the tray's Start a named transaction. |
| `auto_end_idle_minutes` | `30` | Inactivity that ends the open transaction. |
| `auto_end_on_idle` | `true` | `false` keeps the transaction open through idle (all-day recordings); idle is recorded either way. |
| `poll_interval_seconds` | `5` | Not read: the active-window poll is fixed at 5 s (`tracker.js`). |
| `idle_threshold_seconds` | `60` | OS idle time before an `idle_start` is recorded. |
| `storage_warn_gb` | `50` | Setup (analyst) flags the recordings on this computer when their total size is above it. |
| `hotkeys.start_picker`, `.end_innermost`, `.manual_screenshot` | `Control+Shift+S`, `Control+Shift+E`, `Control+Shift+P` | Start recording, then the next transaction; End transaction; Take a screenshot. |
| `screenshots.enabled`, `.quality`, `.on_app_switch`, `.on_screen_change`, `.on_marker_fire`, `.on_idle_resume_minutes`, `.display` | `true`, `60`, `true`, `true`, `true`, `5`, `"active"` | The screenshot triggers, JPEG quality, and the monitor: `active` (the display with the focused window), `primary`, or `all` (one screenshot per display). |
| `obs.required`, `.websocket_url`, `.websocket_password`, `.scene_name`, `.auto_create_scene` | `false`, `ws://127.0.0.1:4455`, none, the default scene named in `config.js`, `true` | OBS (below). |
| `consent.mode`, `.version`, `.text` | `"off"`, `2`, the default text | The consent gate (below). |
| `interactions.enabled`, `.required`, `.auto_restart`, `.max_restarts_per_session` | `true`, `false`, `true`, `3` | The recorder sidecar's lifecycle. |
| `interactions.exclude_processes` | `[]` | More programs to leave out, applied by the pipeline on its derived stream (PDT's own windows are always left out). |
| `interactions.verbose` | `false` | The forensic firehose: `focus_changed`, `text_changed`, a `value_changed` per keystroke (three to five times the events). |
| `interactions.debounce_ms` | `750` | The recorder's `value_changed` coalescing window, sent in `hello`. |
| `interactions.ocr` | `false` | The OCR last rung (below). Off by default; turn on only for a program known to expose little to UI Automation. |
| `taxonomy_version` | `"v0"` | Stamped into the config snapshot; nothing reads it. |

**Consent** (`consent.js`, `consent-window.js`). Off by default: the
manifest records `{ required: false, granted: null, mode: "off" }` and the
recording starts. `per_session` asks at every start; `once` asks once per
worker and consent version (remembered in `user-config.json`). Declining
stops the start. The default text says what is recorded, that what is typed
into password fields is not, and that nothing is sent over the network; it
is version 2, because version 1 promised that card numbers were left out,
which the recorder does not do. A `once` acknowledgement of version 1 is
asked again.

## OBS video (optional)

OBS Studio is optional. SME laptops usually have none, and the analyst can
attach a video of the call in the viewer instead; without OBS the recording
goes on without video and says nothing. With OBS running, a recording
starts an OBS recording and Stop ends it, and `obs/sync.json` lets the
viewer line the video up with the events.

1. Install OBS Studio (version 28 or later).
2. In OBS, open Tools, WebSocket Server Settings, and tick Enable WebSocket
   server; leave the port at 4455. Authentication can stay off on an
   internal machine; with a password, enter it under Setup (analyst),
   Settings, Video / OBS (or `obs.websocket_password`).
3. Leave OBS running (minimized is fine). The capture app creates the
   configured scene (`obs.scene_name`) the first time, with a clock overlay
   that helps check the sync.

The connection is localhost only. Test OBS connection in Settings runs the
same handshake and shows the error. With `obs.required: true` a start fails
with a dialog when OBS cannot be reached; the default `false` records
without video.

## Reliability

The capture app runs unattended on a machine the analyst does not control,
so several behaviors exist to make a recording trustworthy rather than
silently thin or lost:

- **Per-recording recorder supervision (RP-20).** `recorder.superviseRecorder`
  owns one restart budget per recording: on a crash (a non-zero or signalled
  exit, or a spawn failure) it starts the sidecar again after 5 s, at most
  `interactions.max_restarts_per_session` (default 3) times. A successful
  restart never refills the budget, so a crash-looping recorder reaches
  `recorder_dead_permanent` and a toast instead of restarting forever.
- **Spawn errors (RP-22).** `recorder.js` listens for the child's `error`
  event as well as `exit`, so a spawn failure (a blocked path, an execution
  policy) goes through the same restart path as a crash.
- **Close-based stop (RP-23).** `stop()` waits for the child's `close`
  event, which fires only after its output has drained, so the last typed
  values the sidecar flushes on shutdown are never lost.
- **Liveness watchdog.** The sidecar writes a `stats` line every 30 s, also
  recorded as a `recorder_health` system event. When its output stays
  silent for 90 s it is presumed hung, killed and restarted.
- **Dead-man monitor.** During a recording with interactions on, no
  interaction and no heartbeat for over 2 minutes fires one
  `recorder_silent` system event, turns the tray icon amber, shows a toast
  and a problem line on the bar; `recorder_silent_end` marks the recovery.
  (The watchdog watches the process; the dead-man watches the signal.)
- **Dropped writes (RP-21).** Markers and system events are written at once
  and retried on failure (a "could not be saved to disk" toast). A failed
  batch of activity and interaction events is dropped rather than retried;
  the loss is recorded as one durable `events_dropped` system event ahead
  of the next event, and the SME sees one toast per loss stretch.
- **Programs the recorder cannot see.** A program in front for a sustained
  stretch with no interaction from it (often one running as administrator,
  or one with no UI Automation) gets one `uncaptured_app` system event and
  a toast. A browser in front, with the SME's mouse or keyboard in use, for
  30 s in all, from which nothing has been recorded in this recording (no
  interaction, and no typing the recorder has seen but not written yet),
  gets one toast per recording (`browser-watchdog.js`); time paused, idle,
  or while the recorder is starting does not count, and Resume starts the
  count again. Transactions and screenshots still record.

## The C# recorder sidecar (`capture/recorder/`)

A separate single-file, self-contained .NET 8 executable. It is its own
process (not Node) because UI Automation is a first-party Windows API best
used from .NET ([ADR-0001](../adr/0001-click-recorder-sidecar-language.md)).

- `Program.cs`: the entry point, an **NDJSON control loop** over stdin and
  stdout. The capture app sends `hello`, `pause`, `resume`, `snapshot` and
  `shutdown` (`hello` carries `verbose`, `debounce_ms`, `ocr` and
  `host_process`, the capture app's own executable, so the recorder never
  records PDT's own windows); the recorder answers with `ready`,
  `interaction`, `stats`, `activity` and `warning` lines. A `stats` line
  carries throughput counters plus an `errors` count and a `last_error`
  snapshot. An `activity` line (`process_name`, at most every 2 s per
  program) says the recorder has seen typing it has not written yet; the
  capture app counts it for its browser check and never writes it.
- **The `snapshot` command** ([ADR-0025](../adr/0025-in-app-vocabulary-discovery.md),
  narrowed by [ADR-0029](../adr/0029-ba-helper-refocus.md)).
  `{cmd:"snapshot", target:"foreground"|<hwnd>, passes:2}` walks the target
  window's UIA subtree once per pass and streams every identifiable control
  as a `snapshot_control` line, then a `snapshot_done` per pass. The walk is
  bounded (about 2000 controls), skips pure decoration, and wakes a
  Chromium renderer's accessibility tree first. The lines are never written
  to `events.jsonl`. The viewer's "Discover from window" that sent it is
  cut, so nothing sends it now; the recorder still answers. The traversal
  (`SnapshotWalker` over the `ISnapshotElement` seam) is unit-tested with a
  synthetic tree in `Recorder.Tests`. See `Snapshotter.cs`.
- `UiaSubscriber.cs` subscribes to UI Automation events (invoke, selection,
  toggle, value, and the focus), filters noise (writes no `focus_changed`
  and `text_changed`, coalesces rapid `value_changed` within the debounce
  window, drops low-signal Win32 and Chromium internal control types), and
  reads fields safely (a property that throws is omitted, not nulled). The
  handlers are added under a UI Automation cache request, so an event
  arrives with its element's type, id, name, class, framework, process and
  password flag already fetched: a button whose click changes the page is
  gone a few milliseconds later, and its click keeps its name. The focus is
  read on a thread of its own, since UI Automation calls every handler on
  one thread in turn. The
  first interaction written per process carries a `coverage_hint` (`rich`,
  `basic`, `minimal`); a value clamped at 256 characters is flagged
  `value_truncated`; `toggle_state` is `on`, `off` or `indeterminate`.
- **What the user acted on** (`IntentGate.cs`, lane LF-SME). A value change
  is written when its field has the keyboard focus, had it within 2 s, or
  holds the focused element (a combo box around its edit or its open list);
  a toggle or a selection on the same terms, or inside a focused list,
  tree, table or tab strip, or under the mouse pointer (a click that moves
  no focus, like the Office ribbon's Bold); every invoke is written. So a
  screen filling its fields as it loads, the Office ribbon echoing the
  selected cell, File Explorer's navigation pane refreshing (it names the
  user's folders) and a desktop icon selected behind the windows are left
  out. A program that never reports the focus below its window keeps what
  it reports while it is in front (never the Windows shell). Also: a click
  first writes the values still waiting in the debounce window, so the
  order is the user's; an empty value is not written (an empty web input
  reads back as U+FFFC); a choice in a drop-down list is written once, as
  the combo box's `value_changed`; the browser's address bar (Chromium's
  `OmniboxViewViews`) is written once per address, never its keystrokes; a
  popup without a title (a drop-down list, a context menu) takes the title
  of the window in front of the same program.
- **Framework detection (section 11e).** Every interaction carries a
  normalized `framework` (`win32`, `winforms`, `wpf`, `winui`, `chromium`,
  `java`, `javafx`, `qt`, `remote`, `terminal`, `unknown`), derived in
  `UiaSubscriber.DetectFramework` from the raw `framework_id` and the window
  `class_name`. Java (Swing, AWT) and Qt windows report `Win32`, and a Citrix
  or RDP host wraps a foreign session, so the window class (`SunAwtFrame`,
  `Qt...QWindowIcon`, `wfica32`, `ConsoleWindowClass`) wins over
  `framework_id`. A `java` or `qt` tally tells the analyst to enable the Java
  Access Bridge or the Qt accessibility plugin; a `remote` or `terminal`
  tally says UI Automation will be thin there (see "Citrix and remote
  desktops" below). This is distinct from the recognition layer's web-app
  `framework` axis (`chromium`, `ag-grid`, `office365`), mined downstream in
  `recognition.py` and `recognition.js`.
- **Identity ladder and confidence (section 11e).** Each interaction carries
  `identity_source`, the rung that gave the element a stable identity
  (`automation_id`, then `name`, then `class_name`, then `none`), and a
  `confidence` in `[0,1]` (`UiaSubscriber.ResolveIdentitySource`,
  `ComputeConfidence`). Confidence blends the rung with the `framework`: a
  strong rung is still capped at `0.30` on a `remote` or `terminal` surface,
  where the captured field is an unreliable proxy for the real control. A
  `none` rung at low confidence is the element the OCR last rung
  ([ADR-0023](../adr/0023-recorder-capture-confidence.md)) targets.
- **Value recovery (section 11e).** A `value_changed` whose UIA ValuePattern
  value comes through empty (a rich-text or document control that exposes
  its text through `TextPattern`) is recovered through
  `TextPattern.DocumentRange.GetText` (`UiaSubscriber.RecoverValue`,
  `TryReadTextValue`) and flagged `value_source: "text_pattern"`. It never
  overrides a real value, is length-bounded, and adds no UIA reads on the
  common path. Descending into edit elements and reading the clipboard are
  deliberately not done.
- **Password redaction at capture (security).** Before any of the above, a
  `value_changed` on a control UIA flags `IsPassword`
  (`UiaSubscriber.IsSecretValueElement`, `ShouldRedactValue`) is redacted:
  the recorder omits the `value`, sets `value_redacted: true`, and skips the
  `TextPattern` and OCR recovery for that element. The plaintext secret never
  reaches `events.jsonl`. This is the only redaction: nothing is masked
  downstream ([ADR-0029](../adr/0029-ba-helper-refocus.md) D7). See
  [SECURITY.md](../../SECURITY.md).
- **OCR last rung (section 11e, off by default).** When an element exposes
  no structured identity (`identity_source` `none`) and the recording opted
  in (`interactions.ocr: true`), the recorder captures the element's region
  and reads a label with `Windows.Media.Ocr`, a Windows 10+ system API (on
  the device, no bundle growth, not Tesseract; see
  [ADR-0023](../adr/0023-recorder-capture-confidence.md)). The label rides as
  `ocr_text` and lifts the rung to `ocr` (confidence about 0.25). `OcrBridge`
  has a testable core (`RecognizePng`) and the production
  `RecognizeScreenRegion`. `ocr_text` is captured content, so the
  structure-only `inspect-events.js` never prints it.
- **Chromium accessibility wake-up.** Chrome, Edge and Electron apps build
  their UIA accessibility tree lazily: without an outside query, web content
  fires no UIA events and the recorder sees only the browser's own controls.
  `UiaSubscriber.Start()` therefore runs a 1 s background timer that walks
  every top-level window whose `ClassName` begins with `Chrome_` or whose
  `FrameworkId` is `Chrome`, reads its name and type, and descends to the
  web content root. Asking is what switches Chrome's accessibility on for
  that window, the same mechanism screen readers rely on. With it, a stock
  Chrome shows its labelled form fields and typed values as interactions,
  which matters because most enterprise processes (Salesforce, ServiceNow,
  web ERPs) run in a browser.

`recorder.js` finds the executable (the packaged `resources/recorder/`, the
source tree, or an auto-extracted `recorder.zip`; the first launch extracts
it in the background), starts it, and restarts it per the supervision rules
above. Each crash is recorded as a `recorder_died` system event; when the
restart budget is spent, `recorder_dead_permanent` and a toast follow.

## Citrix and remote desktops

The foreground-window poll (`active-win`) sees the Citrix client, not the
program inside it, and UI Automation on the client sees only the remote
window (`framework: "remote"`, low confidence). Run the capture app inside
the Citrix session, RDP host or virtual desktop when its profile allows
unsigned Electron apps: inside, the program's UI Automation tree is local
and rich again. Otherwise run it on the local machine: the recording shows
one Citrix Workspace band for the whole time, the video (if any) still shows
the content, transactions are marked with the transaction key as usual, and
the analyst names the inner programs. Check this on a representative
machine before relying on it. More in [DEPLOY.md](../DEPLOY.md).

## Storage

Setup (analyst) shows the recordings on this computer (their number and
total size, flagged above `storage_warn_gb`), Recent recordings (Show in
folder, Delete) and Delete recordings older than 30, 90 or 365 days; the
running recording is never offered for deletion, and a deleted recording
takes its zip with it. On a machine with Python,
`scripts/prune-sessions.py --root "%APPDATA%\process-discovery-tracker-capture\sessions" --older-than 90`
lists the recording folders older than 90 days and `--apply` deletes them
(`--keep-recovered` skips recovered recordings); it leaves zips alone. Pass
`--root`: the script's default folder is not the capture app's.

## Troubleshooting

- **A key does nothing.** Another program may hold it. Launch with
  `PDT_DEBUG=1` and read `%APPDATA%\process-discovery-tracker-capture\boot.log`
  for the `hotkeys:` line; change the key under Setup (analyst), Settings,
  and relaunch. The bar and the tray work without keys.
- **OBS does not connect.** OBS must be running with its WebSocket server on
  (port 4455), and the password set in Settings when OBS asks for one.
  Settings, Test OBS connection shows the error; `app.log` records it too.
- **No tray icon.** Launch with `PDT_DEBUG=1` and read the boot log. Common
  causes: a second instance already running (single-instance lock), a
  missing tray icon file, antivirus blocking the executable, a YAML syntax
  error in the config file (the boot log says `whenReady failed`).
- **A recording shows as recovered.** The app did not stop cleanly (a crash,
  a forced quit, a power loss); the next launch marks it recovered. A
  transaction left open stays open in `events.jsonl`; the pipeline treats
  it as running to the end of the recording.
- **Clicks and typing in Chrome or Edge are not recorded.** The recorder
  wakes Chromium's accessibility tree itself; when a managed browser still
  shows nothing, closing and reopening the browser can help, or IT can
  enable the browser's `AccessibilityModeEnabled` policy (commands in
  [DEPLOY.md](../DEPLOY.md)). The SME's toast only says to keep going and
  tell the analyst.
- **Clicks and typing in another program are not recorded.** It may run as
  administrator, or expose no UI Automation; transactions and screenshots still
  record, and the readiness check (Setup (analyst)) shows how much the
  recorder sees per program before a recording.
- **The recorder never starts.** See [TROUBLESHOOTING.md](../TROUBLESHOOTING.md)
  ("The recorder does not start").
