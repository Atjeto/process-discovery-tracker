# Capture

Worker-side Electron tracker. Polls foreground window every 5s, fires marker events on hotkey / tray, writes per-session JSONL to the user's APPDATA folder.

## Run

```
npm install
npm start
```

Tray icon appears. Right-click for menu.

**Hotkeys (default):**

- `Ctrl+Shift+S` -- open label picker for a Start marker. Type to filter the configured labels or type a free-form label and Enter to fire.
- `Ctrl+Shift+E` -- fire End marker for the innermost open marker.

## Output

Each session writes a self-contained folder:

```
%APPDATA%\process-discovery-tracker\sessions\<engagement>\<YYYYMMDD-HHMMSS>\
  events.jsonl       # one JSON event per line, append-only
  manifest.json      # session metadata
  screenshots/       # (empty in v0)
  obs/               # (empty in v0)
```

`events.jsonl` is the durable artifact. See [../shared/SCHEMA.md](../shared/SCHEMA.md) for the event envelope and type-specific data shapes.

## What's in v0

- Activity polling via `active-win` (5s cadence)
- Per-session JSONL output (append + OS-cached sync)
- Marker stream: Start (with label) / End (innermost) via hotkey and tray
- Marker stack tracked for status display (case IDs derived in normalization, per §5.2)
- Session lifecycle: `session_start` / `session_end` system events
- Pause / Resume with `paused` / `resumed` system events
- Orphan-session recovery at next launch (marks manifest `status: recovered`)
- Single-instance lock, boot.log diagnostic (set `PDT_DEBUG=1` to enable)

## What's not yet in (iteration 2+)

- OBS integration (obs-websocket, scene bootstrap, recording start/stop, timestamp offset capture)
- Screenshot capture (event-triggered per §3.4)
- Idle detection and auto-end (§3.3)
- Per-session YAML config loading (§6.2) -- config is hard-coded in `main.js` for v0
- Status window
- Launch-on-login toggle
- Tray icon -- ships with an empty tray for now; drop a `tray-icon.png` in this folder to enable

## Debug

```
set PDT_DEBUG=1
npm start
```

Writes per-lifecycle lines to `%APPDATA%\process-discovery-tracker\boot.log`.

Test a session from PowerShell:

```
Get-Content "$env:APPDATA\process-discovery-tracker\sessions\default\<timestamp>\events.jsonl" -Wait
```

Streams events as they land.

## Code map

| File | Role |
|---|---|
| `main.js` | Electron entry, tray, hotkeys, IPC, session lifecycle |
| `tracker.js` | Polling loop, event append, marker/system event API |
| `session.js` | Session folder creation, manifest read/write, orphan recovery |
| `events.js` | Event envelope helpers |
