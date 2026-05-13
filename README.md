# Process Discovery Tracker

Internal tool for capturing and analyzing process discovery sessions. See [../process_discovery_tracker_design.md](../process_discovery_tracker_design.md) for the full design.

## Layout

| Folder | Role |
|---|---|
| `capture/` | Electron tracker that runs on the worker machine. Polls active window, fires marker events on hotkey/tray, writes per-session JSONL. Worker-side install. |
| `normalization/` | Python service that turns raw capture into XES + CSV. Runs on the analyst machine. Stub for now. |
| `viewer/` | Electron viewer for session and aggregate analysis. Runs on the analyst machine. Stub for now. |
| `shared/` | Cross-cutting docs: event schema, session package format. |

## Status

v0 — capture skeleton. You can start a session, fire start/end markers, and inspect the JSONL. No OBS integration, screenshots, idle detection, or viewer yet — those land in iteration 2+.

## Quick start (capture)

```
cd capture
npm install
npm start
```

Tray icon appears. Hotkeys:

- `Ctrl+Shift+S` opens a label picker to fire a Start marker
- `Ctrl+Shift+E` fires an End marker for the innermost open marker

Sessions land in `%APPDATA%\process-discovery-tracker\sessions\<engagement>\<timestamp>\`.

## Defaults picked from the design's open questions

These can be revisited; they are picked here to unblock the prototype:

- **Flush cadence** (§3.7.1): per-event append + fsync. JSONL is at its best when appended per-event; 5s poll cadence means I/O cost is trivial.
- **Open markers at crash** (§3.7.2): mark session `recovered` in the manifest at next launch; leave open markers in the stream for normalization to handle.
- **Case duration default** (§5.4): active duration (matches §3.3's "idle is not double-counted against the worker"). Wall-clock surfaces as a secondary metric in the viewer.
- **OBS scene bootstrap** (§6.4): programmatic creation on first connect. Not yet implemented.
- **Annotation re-norm** (§9.3): overrides applied during normalization, raw events immutable. Not yet implemented.
- **Analyst install topology** (§11.5): python-embeddable folder alongside the viewer. Not yet implemented.
