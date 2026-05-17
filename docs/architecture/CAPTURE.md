# Capture

> Overview-level. Capture is production-stable; for depth see
> [`capture/README.md`](../../capture/README.md),
> [`docs/interaction-recorder.md`](../interaction-recorder.md),
> [ADR-0001](../adr/0001-click-recorder-sidecar-language.md), and — for the v0.5.0
> tech-debt remediation — [ADR-0005](../adr/0005-capture-architecture-remediation.md).

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
| Process boundaries | Start/End hotkeys; optional auto-end on idle | `marker` events |
| Lifecycle | session start/end, idle, OBS, recorder health | `system` events |
| Screen | Electron `desktopCapturer` (app-switch / marker / idle / manual) | screenshots |
| Video (optional) | OBS Studio over `ws://127.0.0.1:4455` | external recording + `obs/sync.json` |

Events are appended to `events.jsonl` synchronously (per-event `appendFileSync`),
so a crash loses at most the in-flight event. Each event carries a monotonic
`_seq` — its 0-based append ordinal — so normalization can resolve events that
share a millisecond timestamp into true order. Screenshot triggers are coalesced by
a 2-second leading-edge debounce, so coincident triggers (an app switch landing
with a marker fire) collapse to a single capture; a manual screenshot is never
suppressed.

## Module map (`capture/`)

`main.js` is the Electron main process and the app's orchestration core. The
v0.5.0 remediation ([ADR-0005](../adr/0005-capture-architecture-remediation.md))
extracted four cross-cutting modules out of it; it is now ~1,210 lines (down from
~1,580) and still the largest file — it holds the tray menu, global hotkeys, the
session lifecycle, the idle monitor, the screenshot triggers, the label picker,
and the `pdt:*` IPC handlers.

**Core / cross-cutting:**

| File | Role |
|---|---|
| `main.js` | Electron main process — tray menu, global hotkeys, session lifecycle, idle monitor, screenshot triggers, label picker, IPC handlers. |
| `boot-log.js` | `bootLog()` — diagnostic log, opt-in via the `PDT_DEBUG=1` environment variable. |
| `notify.js` | `notifyUser()` — native OS toast for failures the operator must see (recorder dead, OBS dropped, screenshots failing); also `trayIconImage()`. |
| `session-storage.js` | Session disk-usage accounting and the delete / prune-by-age flows. |
| `window-manager.js` | Shared singleton-window helper — `createWindowManager()` exposing `show` / `toggle` / `isOpen` / `get`, keyed per window. |
| `tracker.js` | The 5-second active-window polling loop; event-append, `_seq` stamping, live counters, and uncaptured-app detection. |
| `session.js` | Session-folder creation, `manifest.json` I/O, orphan detection / recovery. |
| `events.js` | Event-envelope factories — `activityEvent`, `markerEvent`, `systemEvent`, `interactionEvent`. |
| `config.js` | Loads + deep-merges per-session YAML over `DEFAULTS` — the single source of default values. |
| `recorder.js` | Spawns and supervises the C# `recorder.exe` sidecar; parses its NDJSON output; auto-restarts on crash; runs a stdout-quiet liveness watchdog. |
| `obs.js` | OBS WebSocket integration — scene bootstrap, start/stop recording, clock-offset sync. |
| `screenshots.js` | Desktop capture via `desktopCapturer`; multi-monitor handling. |
| `log.js` | Per-session `capture.log` writer. |

**Windows.** Each window module builds a `BrowserWindow` and loads its markup from
a sibling file in `capture/ui/` — the HTML was extracted from the JS modules in
v0.5.0 (C8):

| Module | `ui/` file | Window |
|---|---|---|
| `operator-panel.js` | `operator-panel.html` | The **Live Session** window — recording indicator, timer, open-marker stack, counters, recent-events feed, inline marker firing, quick actions. |
| `status-window.js` | `status-window.html` | Legacy status window — superseded by the Live Session window; kept in the tray as a fallback. |
| `hotkey-overlay.js` | `hotkey-overlay.html` | Always-on-top click-through corner widget showing the primary hotkeys. |
| `session-config-window.js` | `session-config.html` | Form to edit engagement / worker / idle / labels / OBS; writes `quick-config.yaml`. |
| `obs-settings-window.js` | `obs-settings.html` | OBS WebSocket URL + password dialog. |
| `welcome-window.js` | `welcome.html` | First-run onboarding. |
| `help-window.js` | `help-window.html` | Reopenable help. |

`window-manager.js` keeps each of these to a single live instance.

**Other:**

| File | Role |
|---|---|
| `build-package.js` | Custom `electron-packager` wrapper for distribution builds. |
| `test/` | `node:test` suite — 59 tests over `config`, `events`, `session`, `tracker`, and `window-manager`; run with `npm test`. |
| `ui/` | The seven extracted window HTML files (see the Windows table above). |
| `recorder/` | The C# recorder sidecar — see below. |

## The C# recorder sidecar (`capture/recorder/`)

A separate single-file, self-contained `.NET 8` executable. It exists as its own
process (not Node) because UI Automation is a first-party Windows API best consumed
from .NET — see [ADR-0001](../adr/0001-click-recorder-sidecar-language.md).

- `Program.cs` — entry point; an **NDJSON control loop** over stdin/stdout.
  Electron sends `hello` / `pause` / `resume` / `shutdown` (the `hello` carries
  `verbose` and `debounce_ms`); the recorder emits `ready`, `interaction`,
  `stats`, and `warning` lines. The `stats` line carries throughput counters
  plus an `errors` count and a `last_error` snapshot.
- `UiaSubscriber.cs` — subscribes to UI Automation events (invoke, selection,
  toggle, value), filters noise (drops `focus_changed` / `text_changed`, coalesces
  rapid `value_changed` within a configurable debounce window, drops low-signal
  Win32 *and* Chromium internal-DOM control types), and extracts fields safely
  (a property that throws is omitted, not nulled). The first interaction per
  process carries a `coverage_hint` (`rich` / `basic` / `minimal`); a clamped
  256-char value is flagged `value_truncated`.

`recorder.js` resolves the executable (packaged `resources/recorder/`, source tree,
or auto-extracted `recorder.zip`), spawns it, and restarts it up to a configured
limit. It also runs a **liveness watchdog**: the sidecar emits a `stats` line every
30 s, so if its stdout falls silent for 90 s the process is presumed hung — it is
killed and recovered through the normal exit/restart path. Each `stats` line is
also written to `events.jsonl` as a `recorder_health` `system` event, so drops
and errors stay visible against the session timeline. Recorder death surfaces
as a `recorder_died` / `recorder_dead_permanent` `system` event and a native OS
notification.

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

Per-session config is YAML, deep-merged over the `DEFAULTS` object in `config.js`
— which, since v0.5.0 (C3), is the **single source** of default values. Keys cover
engagement/worker identity, `auto_end_idle_minutes` plus `auto_end_on_idle`
(set false to keep a session running through idle, for 8-hour passive
recordings), `poll_interval_seconds`,
`process_labels` (Start-marker label list), `obs`, `hotkeys`, `screenshots`, and
`interactions` (including `debounce_ms`, the recorder's `value_changed` coalescing
window, passed to the sidecar in the `hello` message). Point the app at a file
with `PDT_CONFIG`, or edit via the session config window (which writes
`quick-config.yaml` for the next launch).
