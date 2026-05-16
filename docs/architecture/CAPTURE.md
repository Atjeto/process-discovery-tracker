# Capture

> Overview-level. Capture is production-stable; for depth see
> [`capture/README.md`](../../capture/README.md),
> [`docs/interaction-recorder.md`](../interaction-recorder.md), and
> [ADR-0001](../adr/0001-click-recorder-sidecar-language.md).

## Purpose & runtime

The Capture app runs on the **worker's** machine and records a session while they
perform a business process. It is an **Electron** app with no meaningful renderer
logic — it lives in the tray and in small utility windows — plus a separate
**C# .NET 8 recorder sidecar** process for UI interactions.

Output: one session folder under
`%APPDATA%\process-discovery-tracker\sessions\<engagement>\<YYYYMMDD-HHMMSS>\`
(see [DATA-MODEL.md](./DATA-MODEL.md)).

## What it records

| Source | Mechanism | Produces |
|---|---|---|
| Foreground window | `active-win` polled every 5 s | `activity` events |
| UI interactions | C# UI Automation recorder sidecar | `interaction` events |
| Process boundaries | Start/End hotkeys; auto-end on idle | `marker` events |
| Lifecycle | session start/end, idle, OBS, recorder health | `system` events |
| Screen | Electron `desktopCapturer` (app-switch / marker / idle / manual) | screenshots |
| Video (optional) | OBS Studio over `ws://127.0.0.1:4455` | external recording + `obs/sync.json` |

Events are appended to `events.jsonl` synchronously (per-event `appendFileSync`),
so a crash loses at most the in-flight event.

## Module map (`capture/`)

| File | Role |
|---|---|
| `main.js` | Electron main process — the bulk of the app: tray menu, global hotkeys, session lifecycle, idle monitor, label picker, IPC handlers. Large (~1,600 lines). |
| `tracker.js` | The 5-second active-window polling loop; event-append and live counters. |
| `session.js` | Session-folder creation, `manifest.json` I/O, orphan detection / recovery. |
| `events.js` | Event-envelope factories — `activityEvent`, `markerEvent`, `systemEvent`, `interactionEvent`. |
| `config.js` | Loads + deep-merges per-session YAML config over defaults. |
| `recorder.js` | Spawns and supervises the C# `recorder.exe` sidecar; parses its NDJSON output; auto-restarts on crash. |
| `obs.js` | OBS WebSocket integration — scene bootstrap, start/stop recording, clock-offset sync. |
| `screenshots.js` | Desktop capture via `desktopCapturer`; multi-monitor handling. |
| `log.js` | Per-session `capture.log` writer. |
| `status-window.js` | The **Live Session** window — recording indicator, timer, open-marker stack, counters, recent-events feed, quick actions. |
| `hotkey-overlay.js` | Always-on-top click-through corner widget showing the primary hotkeys. |
| `session-config-window.js` | Form to edit engagement / worker / idle / labels / OBS; saves `quick-config.yaml`. |
| `obs-settings-window.js` | OBS WebSocket URL + password dialog. |
| `welcome-window.js`, `help-window.js` | First-run onboarding and reopenable help. |
| `operator-panel.js` | Legacy operator panel (superseded by the Live Session window). |
| `build-package.js` | Custom `electron-packager` wrapper for distribution builds. |
| `recorder/` | The C# recorder sidecar — see below. |

## The C# recorder sidecar (`capture/recorder/`)

A separate single-file, self-contained `.NET 8` executable. It exists as its own
process (not Node) because UI Automation is a first-party Windows API best consumed
from .NET — see [ADR-0001](../adr/0001-click-recorder-sidecar-language.md).

- `Program.cs` — entry point; an **NDJSON control loop** over stdin/stdout.
  Electron sends `hello` / `pause` / `resume` / `shutdown`; the recorder emits
  `ready`, `interaction`, `stats`, and `warning` lines.
- `UiaSubscriber.cs` — subscribes to UI Automation events (invoke, selection,
  toggle, value), filters noise (drops `focus_changed` / `text_changed`, coalesces
  rapid `value_changed`, drops low-signal control types), and extracts fields
  safely (a property that throws is omitted, not nulled).

`recorder.js` resolves the executable (packaged `resources/recorder/`, source tree,
or auto-extracted `recorder.zip`), spawns it, and restarts it up to a configured
limit. Recorder death surfaces as a `recorder_died` / `recorder_dead_permanent`
`system` event and a native Windows toast.

## Session lifecycle

- **Start** — `session.js` creates the folder + `manifest.json` (`status: active`);
  `tracker.js` begins polling; the recorder sidecar and (if configured) OBS start.
  Firing the first marker auto-starts a session; an explicit green **Start** button
  also exists.
- **End** — polling, recorder, and OBS stop; `manifest.json` is updated
  (`status: closed`, `ended_at`).
- **Crash recovery** — on next launch, `session.js` finds sessions still marked
  `active` with no `ended_at`, marks them `recovered`; the normalization layer
  reconciles any markers left open.

## IPC surface

The tray/main process exposes `pdt:*` IPC handlers consumed by the utility windows:
`pdt:status`, `pdt:fireStart`, `pdt:fireEnd`, `pdt:fireSync`, `pdt:manualScreenshot`,
`pdt:startSession`, `pdt:endSession`, `pdt:togglePause`, `pdt:obsGet/Save/Test`,
`pdt:sessionConfigGet/Save`.

## Configuration

Per-session config is YAML, deep-merged over defaults in `config.js`. Keys cover
engagement/worker identity, `auto_end_idle_minutes`, `poll_interval_seconds`,
`process_labels` (Start-marker label list), `obs`, `hotkeys`, `screenshots`, and
`interactions`. Point the app at a file with `PDT_CONFIG`, or edit via the session
config window (which writes `quick-config.yaml` for the next launch).
