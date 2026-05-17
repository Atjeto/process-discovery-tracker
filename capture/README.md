# Capture

Worker-side Electron tray app. Polls the foreground window every 5 s, records UI
interactions via a C# sidecar, fires marker events on hotkey / tray, drives OBS,
captures screenshots, and writes a per-session JSONL folder under `%APPDATA%`.

Architecture overview: [`docs/architecture/CAPTURE.md`](../docs/architecture/CAPTURE.md).

## Run

```
npm install
npm start    # launch the tray app
npm test     # run the unit suite (node:test)
```

The tray icon appears; right-click for the menu.

**Default hotkeys:**

- `Ctrl+Shift+S` — open the label picker for a Start marker.
- `Ctrl+Shift+E` — fire an End marker (closes the innermost open marker).
- `Ctrl+Shift+P` — take a manual screenshot.
- `Ctrl+Shift+Y` — fire a cross-machine sync marker.

Set `PDT_CONFIG=path\to\config.yaml` before launch for a per-session config, or
use the tray's "Set up a recording session" window (it writes `quick-config.yaml`
for the next launch). See `sample-config.yaml` for the schema.

## Output

Each session writes a self-contained folder:

```
%APPDATA%\process-discovery-tracker\sessions\<engagement>\<YYYYMMDD-HHMMSS>\
  events.jsonl       # one JSON event per line, append-only — the durable artifact
  manifest.json      # session metadata, status, OBS reference
  config.yaml        # snapshot of the config used
  screenshots/       # event-triggered captures
  obs/sync.json      # clock-sync data (when OBS was connected)
```

See [`../shared/SCHEMA.md`](../shared/SCHEMA.md) for the event envelope and
type-specific data shapes.

## Code map

`main.js` is the orchestration core. The v0.5.0 tech-debt remediation
([ADR-0005](../docs/adr/0005-capture-architecture-remediation.md)) extracted four
cross-cutting modules and the window HTML out of it.

| Path | Role |
|---|---|
| `main.js` | Electron main process — tray, hotkeys, session lifecycle, idle monitor, screenshot triggers, IPC handlers. |
| `boot-log.js` | `bootLog()` diagnostic log (opt-in via `PDT_DEBUG=1`). |
| `notify.js` | `notifyUser()` OS toast for failures the operator must see. |
| `session-storage.js` | Session disk-usage accounting; the delete / prune flows. |
| `window-manager.js` | Shared singleton-window helper. |
| `tracker.js` | The 5 s polling loop; event append; live counters. |
| `session.js` | Session-folder creation, `manifest.json` I/O, orphan recovery. |
| `events.js` | Event-envelope factories. |
| `config.js` | Loads + deep-merges per-session YAML over `DEFAULTS` (the single source of defaults). |
| `recorder.js` | Spawns / supervises the C# `recorder.exe` sidecar; liveness watchdog. |
| `obs.js` | OBS WebSocket integration. |
| `screenshots.js` | Desktop capture via `desktopCapturer`. |
| `log.js` | Per-session `capture.log` writer. |
| `*-window.js`, `operator-panel.js` | The tray windows; each loads its markup from `ui/<name>.html`. |
| `ui/` | The seven window HTML files. |
| `test/` | `node:test` unit suite (config, events, session, tracker, window-manager). |
| `recorder/` | The C# UI-Automation recorder sidecar — see [`docs/interaction-recorder.md`](../docs/interaction-recorder.md). |

## Debug

```
set PDT_DEBUG=1
npm start
```

Writes per-lifecycle lines to `%APPDATA%\process-discovery-tracker\boot.log`.
Stream a session's events live:

```
Get-Content "$env:APPDATA\process-discovery-tracker\sessions\default\<timestamp>\events.jsonl" -Wait
```
