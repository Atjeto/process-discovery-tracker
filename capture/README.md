# Capture

The SME's tray app. It records a business process while the SME performs it
a few times, one run each time: the foreground window every 5 s, the UI
interactions through a C# sidecar, a marker at the start and end of each
run, screenshots, and optionally an OBS video. Each recording is one folder
under `%APPDATA%\process-discovery-tracker-capture\sessions\`. Nothing is
sent over a network.

Architecture, behaviour, configuration and support:
[docs/architecture/CAPTURE.md](../docs/architecture/CAPTURE.md).

## Run

```
npm install
npm start    # launch the tray app
npm test     # the unit suite (node:test)
```

The recorder sidecar needs the .NET 8 SDK to build: `npm run build:recorder`
(tests: `dotnet test recorder/Recorder.Tests/Recorder.Tests.csproj`).

## Use

The tray icon appears; click it for the menu. Start recording (the button,
the tray item or the run key) starts the recording with Run 1 and opens a
small recording bar: Next run, Pause and Stop. Stop opens the end summary,
which can make a zip of the recording for the analyst (next to the folder;
nothing is sent).

Default keys:

- `Ctrl+Shift+S`: start recording, then the next run (the open run ends
  first; runs never nest).
- `Ctrl+Shift+E`: end the current run without starting another.
- `Ctrl+Shift+P`: take a screenshot.

Setup for the analyst or IT sits in the tray's Setup (analyst) menu:
Recording setup (the project and the named runs,
`userData/quick-config.yaml`), Settings (keys, OBS, screenshots, the storage
limit, the idle end of the open run, `userData/user-config.json`), Profile
(who is recording), the readiness check, and the recordings on this
computer. Or set `PDT_CONFIG=path\to\config.yaml` before launch for the
whole schema (`sample-config.yaml`); Settings and Profile still layer on
top.

## Output

```
%APPDATA%\process-discovery-tracker-capture\sessions\<project>\<YYYYMMDD-HHMMSS>\
  events.jsonl            one JSON event per line, append-only
  manifest.json           recording metadata, status, consent, the OBS video's path
  config.yaml             the configuration used
  screenshots/            the screenshots
  obs/sync.json           the video's clock offset (when OBS recorded)
  session-integrity.json  every file's name and size, written at Stop
```

Formats: [shared/SCHEMA.md](../shared/SCHEMA.md).

## Code map

`main.js` is the orchestration core. The full module and window tables are
in [CAPTURE.md](../docs/architecture/CAPTURE.md#module-map-capture).

| Path | Role |
|---|---|
| `main.js` | Electron main process: tray, keys, recording lifecycle, idle monitor, screenshot triggers, IPC. |
| `recording-control.js` | The one start: the recording with Run 1, then the next run. |
| `capture-guidance.js` | Every word on the bar, the tray's status line and the end summary. |
| `tracker.js` | The 5 s poll, runs, event append, the write queue. |
| `session.js` | Recording folders and `manifest.json`. |
| `zip-folder.js` | The zip for the analyst. |
| `recorder.js`, `dead-man.js` | The C# sidecar's supervision and the silent-recorder alarm. |
| `config.js`, `user-config.js` | Defaults, the YAML, the Settings and Profile overlay. |
| `recording-bar.js`, `end-summary-window.js`, `welcome-window.js`, `help-window.js`, `consent-window.js`, `settings-window.js`, `profile-window.js`, `session-config-window.js` | The windows; each loads its markup from `ui/<name>.html`. |
| `test/` | The `node:test` suite. |
| `recorder/` | The C# UI Automation recorder: see [docs/interaction-recorder.md](../docs/interaction-recorder.md). |

## Debug

```
set PDT_DEBUG=1
npm start
```

Writes launch and lifecycle lines to
`%APPDATA%\process-discovery-tracker-capture\boot.log` (`app.log` next to it
is always on). Watch a recording's events live:

```
Get-Content "$env:APPDATA\process-discovery-tracker-capture\sessions\default\<timestamp>\events.jsonl" -Wait
```
