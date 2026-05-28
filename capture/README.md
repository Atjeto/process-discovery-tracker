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

Configuration is split by lifetime:

- **Settings…** (top-level tray entry) — persistent across sessions:
  Hotkeys / Video-OBS / Screenshots / Storage limits. Stored at
  `userData/user-config.json`.
- **Profile…** (top-level tray entry) — worker identity (id, name, role, team).
- **Session setup…** (tray, idle only) — per-engagement project code + task
  shortcuts. Stored at `userData/quick-config.yaml`.
- Or set `PDT_CONFIG=path\to\config.yaml` before launch for the full schema
  (see `sample-config.yaml`); Settings + Profile still layer on top.

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
| `user-config.js` | Persistent per-user overlay at `userData/user-config.json` (Profile + Settings); merged on top of the YAML at launch. |
| `recorder.js` | Spawns / supervises the C# `recorder.exe` sidecar; liveness watchdog; first-run async zip extractor. |
| `obs.js` | OBS WebSocket integration. |
| `screenshots.js` | Desktop capture via `desktopCapturer`. |
| `log.js` | Per-session `capture.log` writer. |
| `settings-window.js` / `profile-window.js` / `session-config-window.js` / `welcome-window.js` / `help-window.js` / `operator-panel.js` / `hotkey-overlay.js` | The tray windows; each loads its markup from `ui/<name>.html`. |
| `ui/` | The window HTML files. |
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
