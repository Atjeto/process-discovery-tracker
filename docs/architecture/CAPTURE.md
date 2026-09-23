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
| Runs | The one **run hotkey**, pressed once per run; optional auto-end on idle | `marker` events (`start` / `end`) |
| Lifecycle | session start/end, idle, OBS, recorder health, dropped-batch loss | `system` events |
| Screen | Electron `desktopCapturer` (app-switch / marker / idle / manual) | screenshots |
| Video (optional) | OBS Studio over `ws://127.0.0.1:4455` | external recording + `obs/sync.json` |

**One-hotkey runs.** The scenario ([ADR-0029](../adr/0029-ba-helper-refocus.md))
is: the worker performs the business process a few times, bracketing each
run with one hotkey (`config.hotkeys.start_picker`, default
`Control+Shift+S`). Pressing it: starts the session if none is running;
ends whatever run is still open (`reason: "auto_close_for_sibling"`, so
runs never nest); and starts the next one, auto-named `"Run N"` (or a
configured task-shortcut label, `config.process_labels`, offered as named
buttons in the Live Session window and a tray submenu). A second hotkey,
`end_innermost` (default `Control+Shift+E`), ends the current run without
starting another (useful to end the last run before stopping), though it
does not have to be pressed: stopping the session ends any still-open run
by itself (see *Close-based stop* below). The guidance line on the
operator panel (`capture-guidance.js`) always names the real configured
key, never a hardcoded default, and reads "press &lt;key&gt; at the start
of each run" while recording.

Events are appended to `events.jsonl` through a small batching queue: high-volume
events (activity polls, interactions) flush on a 500 ms timer, while `marker` and
`system` events flush the whole pending queue immediately — so a case boundary or
lifecycle event is never left only in memory, and a clean shutdown drains the queue.
A crash therefore loses at most the activity/interaction events queued at that
moment (under 500 ms of low-stakes data). Each event carries a monotonic
`_seq` — its 0-based append ordinal — so normalization can resolve events that
share a millisecond timestamp into true order. Screenshot triggers are coalesced by
a 2-second leading-edge debounce, so coincident triggers (an app switch landing
with a marker fire) collapse to a single capture; a manual screenshot is never
suppressed.

## Module map (`capture/`)

`main.js` is the Electron main process and the app's orchestration core. The
v0.5.0 remediation ([ADR-0005](../adr/0005-capture-architecture-remediation.md))
extracted four cross-cutting modules out of it; it remains the largest file — it
holds the tray menu, global hotkeys, the session lifecycle, the idle monitor, the
screenshot triggers, and the `pdt:*` IPC handlers. The free-text label picker
that used to prompt the worker for a marker's name at fire time is gone
([ADR-0029](../adr/0029-ba-helper-refocus.md)): a run is named from a
configured task shortcut (`config.process_labels`) or auto-numbered
("Run N").

**Core / cross-cutting:**

| File | Role |
|---|---|
| `main.js` | Electron main process: tray menu, global hotkeys, session lifecycle, idle monitor, screenshot triggers, IPC handlers. |
| `boot-log.js` | `bootLog()` — diagnostic log, opt-in via the `PDT_DEBUG=1` environment variable. |
| `notify.js` | `notifyUser()` — native OS toast for failures the operator must see (recorder dead, OBS dropped, screenshots failing); also `trayIconImage()`. |
| `session-storage.js` | Session disk-usage accounting and the delete / prune-by-age flows. |
| `window-manager.js` | Shared singleton-window helper — `createWindowManager()` exposing `show` / `toggle` / `isOpen` / `get`, keyed per window. |
| `capture-guidance.js` | Pure module (no DOM/Electron/IPC): the operator panel's single status-driven guidance line ("Recording: press &lt;key&gt; at the start of each run.") from a `pdt:status` snapshot and the configured run hotkey. Injected into `ui/operator-panel.html`. |
| `tracker.js` | The 5-second active-window polling loop; run/marker bookkeeping (`startRun`, one-hotkey close-then-open, `endOpenRuns`), event-append, `_seq` stamping, live counters, dropped-batch loss accounting (`events_dropped`, RP-21), and uncaptured-app detection. |
| `session.js` | Session-folder creation, `manifest.json` I/O (fixed `purpose: "process"`), orphan detection / recovery. |
| `events.js` | Event-envelope factories — `activityEvent`, `markerEvent`, `systemEvent`, `interactionEvent`. |
| `config.js` | Loads + deep-merges per-session YAML over `DEFAULTS` — the single source of default values. |
| `user-config.js` | The persistent `userData/user-config.json` overlay (Settings / Profile / a `"once"` consent acknowledgement) shared by the top-level windows. |
| `recorder.js` | Spawns the C# `recorder.exe` sidecar (`spawnRecorder`); parses its NDJSON output; runs a stdout-quiet liveness watchdog; **`superviseRecorder`** owns per-session crash supervision (below). |
| `dead-man.js` | §E2 dead-man monitor (pure, injectable clock): no interaction event AND no `recorder_health` heartbeat for >2 min during an active session ⇒ main.js flips the tray to a warning icon, fires an OS notification, and lands a durable `recorder_silent` system event (`recorder_silent_end` on recovery). |
| `readiness.js` | §E1 pre-pilot readiness probe — free disk on the session target + the recorder's self-extract drive, recorder starts + UIA answers, per-running-app trust tier (rich/basic/minimal/wall) from a short snapshot probe of each visible window. Tray item **Run readiness check…** (idle-only) and the `--readiness` CLI both write `readiness-report.json` into the sessions base dir; CLI exit codes 0 ready / 2 not ready / 3 crashed. |
| `obs.js` | OBS WebSocket integration — scene bootstrap, start/stop recording, clock-offset sync. |
| `screenshots.js` | Desktop capture via `desktopCapturer`; multi-monitor handling. |
| `log.js` | Per-session `capture.log` writer. |

The worker close-out wizard (`self-annotation/`: observed-value questions,
`manifest.worker_review`) is gone ([ADR-0029](../adr/0029-ba-helper-refocus.md)):
session end now shows only the one-screen end summary (below), unauthored.

**Windows.** Each window module builds a `BrowserWindow` and loads its markup from
a sibling file in `capture/ui/` — the HTML was extracted from the JS modules in
v0.5.0 (C8):

| Module | `ui/` file | Window |
|---|---|---|
| `operator-panel.js` | `operator-panel.html` | The **Live Session** window, trimmed to the path: recording indicator, timer, open-marker stack, counters, recent-events feed, inline marker firing, named-run task shortcuts, the guidance line (`capture-guidance.js`), and the one-screen end summary. |
| `hotkey-overlay.js` | `hotkey-overlay.html` | Always-on-top click-through corner widget showing the primary hotkeys. |
| `settings-window.js` | `settings.html` | Top-level **Settings…** — persistent settings split by concern (Hotkeys / Video-OBS / Screenshots / Storage). Subsumes the former standalone OBS-settings dialog (v0.17.0). Writes the `userData/user-config.json` overlay. |
| `profile-window.js` | `profile.html` | Top-level **Profile…** — worker identity (id, display name, role, team), stamped onto every recording's manifest. Persists to the user-config overlay. |
| `session-config-window.js` | `session-config.html` | The slim **Session setup…** — per-engagement code/name and process labels only (shown when idle); identity and persistent settings moved to Profile/Settings in v0.17.0. |
| `welcome-window.js` | `welcome.html` | First-run onboarding (with a "Set up your profile" CTA). |
| `help-window.js` | `help-window.html` | Reopenable help. |
| `consent-window.js` | `consent.html` | Worker-consent gate (§11f) shown at session start when `config.consent.mode` is `"per_session"`/`"once"`; returns the decision over IPC and remembers a `"once"` acknowledgement in user-config. Pure record/decision logic is in the electron-free `consent.js`. Declining aborts the start; the decision is written to `manifest.consent`. The C# recorder is unchanged. |

`window-manager.js` keeps each of these to a single live instance.

**Other:**

| File | Role |
|---|---|
| `build-package.js` | Custom `electron-packager` wrapper for distribution builds. |
| `test/` | `node:test` suite over `config`, `events`, `session`, `tracker`, `consent`, and `window-manager`; run with `npm test`. |
| `ui/` | The extracted window HTML files (see the Windows table above). |
| `recorder/` | The C# recorder sidecar — see below. |

## The C# recorder sidecar (`capture/recorder/`)

A separate single-file, self-contained `.NET 8` executable. It exists as its own
process (not Node) because UI Automation is a first-party Windows API best consumed
from .NET — see [ADR-0001](../adr/0001-click-recorder-sidecar-language.md).

- `Program.cs` — entry point; an **NDJSON control loop** over stdin/stdout.
  Electron sends `hello` / `pause` / `resume` / `snapshot` / `shutdown` (the
  `hello` carries `verbose`, `debounce_ms`, `ocr`, and `host_process` — the
  capture app's own exe, so the recorder never records PDT's own windows as
  interactions); the recorder emits
  `ready`, `interaction`, `stats`, and `warning` lines. The `stats` line carries
  throughput counters plus an `errors` count and a `last_error` snapshot.
- **The `snapshot` command (§11e / [ADR-0025](../adr/0025-in-app-vocabulary-discovery.md), narrowed by [ADR-0029](../adr/0029-ba-helper-refocus.md)).**
  `{cmd:"snapshot", target:"foreground"|<hwnd>, passes:2}` walks the target
  window's UIA subtree **once per pass** (reusing the same `ControlView` walk
  and the ADR-0023 identity/framework/confidence ladder) and streams **every
  identifiable control** as a `snapshot_control` line, then a `snapshot_done`
  per pass, instead of waiting for interaction events. The walk is bounded
  (~2000 controls), skips pure decoration (no `automation_id`/`name`/
  `class_name`), and wakes a Chromium renderer's lazily-built accessibility
  tree first (a browser window is UIA-dark until queried). These lines are
  **transient**: never written to `events.jsonl`. Before ADR-0029 two
  passes ≥1s apart let the analyst-side volatility picker
  (`normalization/signature_pick.py`) diff the controls for the viewer's App
  Library "Discover from window" flow; that flow and the picker are cut
  (light vocab, a remembered-names store keyed by a drafted step's
  `draft_key`, replaced it), so the recorder still answers a `snapshot`
  command the same way but nothing in the current viewer sends one. The
  pure traversal (`SnapshotWalker` over the `ISnapshotElement` seam) is
  unit-tested with a synthetic tree in `Recorder.Tests`; the live
  `AutomationElement` adapter is the thin UIA seam. See `Snapshotter.cs`.
- `UiaSubscriber.cs` — subscribes to UI Automation events (invoke, selection,
  toggle, value), filters noise (drops `focus_changed` / `text_changed`, coalesces
  rapid `value_changed` within a configurable debounce window, drops low-signal
  Win32 *and* Chromium internal-DOM control types), and extracts fields safely
  (a property that throws is omitted, not nulled). The first interaction per
  process carries a `coverage_hint` (`rich` / `basic` / `minimal`); a clamped
  256-char value is flagged `value_truncated`.
- **Framework detection (§11e).** Every interaction also carries a normalized
  `framework` — `win32` / `winforms` / `wpf` / `winui` / `chromium` / `java` /
  `javafx` / `qt` / `remote` / `terminal` / `unknown` — re-derived in
  `UiaSubscriber.DetectFramework` from the raw `framework_id` **and** the window
  `class_name`. The point is the toolkits that *misreport* their UIA
  `framework_id`: Java (Swing/AWT) and Qt windows report `Win32`, and a Citrix/RDP
  host wraps a foreign session — the window class (`SunAwtFrame`, `Qt…QWindowIcon`,
  `wfica32`, `ConsoleWindowClass`) is the reliable tell, so class signatures win
  over `framework_id`. This is *desktop-coverage hardening*: a `java`/`qt` tally
  tells the analyst to enable the Java Access Bridge / Qt a11y plugin, and a
  `remote`/`terminal` tally says structured UIA will be thin there so the
  run-inside-the-session rule + the local video backstop carry it (operational
  rules in [DEPLOY.md](../DEPLOY.md#remote--virtualized-apps-citrix--rdp--vmware--11e)).
  It is distinct from the recognition layer's *web-app*
  `framework` axis (`chromium` / `ag-grid` / `office365`), which is mined from
  class-name signatures downstream in `recognition.py` / `recognition.js`.
- **Identity ladder + per-element confidence (§11e).** Each interaction also
  carries `identity_source` — the rung of the identity ladder that gave the
  element a stable identity (`automation_id` → `name` → `class_name` → `none`,
  descending reliability) — and a `confidence` score in `[0,1]`
  (`UiaSubscriber.ResolveIdentitySource` / `ComputeConfidence`). Confidence blends
  the rung with the detected `framework`: a strong rung is still capped at `0.30`
  on a `remote`/`terminal` surface, where the captured field is an unreliable
  proxy for the real (pixel) control. This is the *honest-degradation* signal — it
  lets the analyst flag low-trust captures rather than silently trusting a thin
  one, and a `none` rung at low confidence is precisely the element the OCR
  last-resort bridge ([ADR-0023](../adr/0023-recorder-capture-confidence.md))
  targets.
- **Value recovery (§11e).** A `value_changed` whose primary UIA ValuePattern
  value comes through empty — a rich-text or document control that signals the
  change but exposes its text through `TextPattern`, not `ValuePattern` — is
  recovered via `TextPattern.DocumentRange.GetText` (`UiaSubscriber.RecoverValue` /
  `TryReadTextValue`), generalizing the AG-Grid typed-value fix. The recovery is
  flagged with `value_source: "text_pattern"` so it's transparent, never overrides
  a real primary value, is length-bounded, and adds no UIA reads on the common
  (non-empty) path. `RecoverValue` takes the source label as a parameter so the OCR
  last rung reuses it unchanged (`value_source: "ocr"`). *Edit-element descent* and
  *clipboard* recovery are deliberately **not** done — descent would walk the tree
  on the interaction hot path, and clipboard scraping is a privacy hazard at odds
  with the air-gapped, structured-only moat.
- **Secret redaction at capture (security).** Before any of the above runs, a
  `value_changed` on a control UIA-flagged `IsPassword` (`UiaSubscriber.IsSecretValueElement`
  / `ShouldRedactValue`) is redacted: the recorder omits the `value`, sets
  `value_redacted: true`, and **skips** the `TextPattern` recovery and the OCR rung
  for that element (`ShouldOcr`'s `isSecret` gate). Windows already blanks a password
  field's `ValuePattern` value; without this gate the recovery rungs would actively
  reconstruct it. The plaintext secret therefore never reaches the immutable
  `events.jsonl` — the analyst-side `pii_masking` layer is only a second net over the
  derived stream. See [SECURITY.md](../../SECURITY.md).
- **OCR last rung (§11e, default-off).** The bottom of the identity ladder: when an
  element exposes **no** structured identity (`identity_source == "none"`) on a
  session that opted in (`interactions.ocr: true`), the recorder captures the
  element's on-screen region and recovers a text label via `Windows.Media.Ocr` — a
  Win10+ **system API** (on-device, free, no bundle inflation, *not* Tesseract; see
  [ADR-0023](../adr/0023-recorder-capture-confidence.md)). The label rides as
  `ocr_text` and lifts the rung to `ocr` (confidence ≈ 0.25). `OcrBridge` exposes a
  testable core (`RecognizePng`, pinned headlessly by rendering known text) and the
  production `RecognizeScreenRegion` (GDI+ capture → core; its live end-to-end is
  validated against real low-UIA apps later). It is **off by default** — the
  screen-capture + OCR cost never touches an ordinary capture, and is only worth
  enabling for a known low-UIA app (legacy custom controls, un-bridged Java/Qt).
  `ocr_text` is captured content, so the structure-only `inspect-events.js` never
  prints it.
- **Chromium accessibility wake-up.** Chrome / Edge / Electron-based apps build
  their UIA accessibility tree **lazily** — without an external query, web
  content fires no UIA events and the recorder sees only the omnibox / native
  browser chrome. `UiaSubscriber.Start()` therefore kicks off a background
  `Timer` (1 s period) whose only job is to walk every top-level window whose
  `ClassName` begins with `Chrome_` or whose `FrameworkId` is `Chrome`, read
  its `Name` / `ControlType` / `LocalizedControlType`, and descend to find a
  `ControlType.Document` (the web-content root) and read its `Name`. The act of
  asking is what flips Chrome into accessibility-on mode for that window — the
  same mechanism NVDA / Narrator / inspect.exe rely on. Without this poller, a
  stock user-launched Chrome captures only browser-chrome events; with it, the
  recorder sees the labelled HTML form fields (`Customer name:`, `E-mail
  address:`) and the typed values as `value_changed` interactions. This is
  important because most modern enterprise processes (Salesforce, ServiceNow,
  web-based ERPs) run in Chrome.

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

- **Start** — a pre-flight `validateConfig()` first warns the operator if the
  engagement ID is unset or the session folder is unwritable, with a
  Start-anyway prompt. Then `session.js` creates the folder + `manifest.json`
  (`status: active`); `tracker.js` begins polling; the recorder sidecar and
  (if configured) OBS start. Firing the first marker auto-starts a session; an
  explicit green **Start** button also exists.
- **End**: polling stops; the tracker ends any run still open
  (`endOpenRuns()`, no explicit End-run hotkey needed for the last one)
  before firing `session_end`, so a run is never left dangling by a worker
  who just closes the session; the recorder and OBS stop; `manifest.json`
  is updated (`status: closed`, `ended_at`); a `session-integrity.json`
  file manifest is written so the viewer can detect an incomplete copy;
  and the Live Session window shows the **one-screen end summary**
  (`showEndSummary`: runs, duration, interactions, screenshots) with an
  optional field to label the session. The worker close-out wizard's
  observed-value questions are gone ([ADR-0029](../adr/0029-ba-helper-refocus.md));
  the end summary is the only thing the worker sees at session end, and it
  asks nothing.
- **Crash recovery** — on next launch, `session.js` finds sessions still marked
  `active` with no `ended_at`, marks them `recovered`; the normalization layer
  reconciles any markers left open.

App-vocabulary prep sessions (a separate `"app_prep"` session `purpose`,
filed under `engagement_id: "vocab-prep"`, to bootstrap an App Vocabulary
from a throwaway walkthrough) are gone with the in-app vocabulary discovery
flow they fed. `manifest.json.purpose` is now always `"process"`; there is
no `startAppPrepSession()` and no `manifest.prep_app`.

## Reliability

Capture runs unattended on a machine the analyst does not control, so
several behaviors exist purely to make a recording trustworthy rather than
silently thin or lost:

- **Per-session recorder supervision (RP-20).** `recorder.superviseRecorder`
  owns one restart budget per session: it spawns the sidecar, and on a
  crash (non-zero/signalled exit, or a spawn failure) re-spawns it after a
  delay, up to `interactions.max_restarts_per_session` (default 3) times.
  A successful re-spawn never refills the budget (before this fix, `main.js`
  reset the restart count on every successful spawn, including
  auto-restarts), so the cap was never reached and a crash-looping recorder
  restarted forever with no `recorder_dead_permanent` ever firing.
- **Dropped-batch accounting (RP-21).** `tracker.js`'s write queue flushes
  markers and system events synchronously (durability-critical) but defers
  activity/interaction events on a 500 ms timer. If a deferred flush fails
  and the batch held no critical event, the batch is dropped rather than
  retried. The loss is folded into a pending record and queued as a
  durable `events_dropped` system event ahead of the next event, instead of
  only a `boot.log` line. `getStatus().droppedEventCount` and
  `writeErrorCount` surface the running totals to the tray/status window.
- **Spawn-error handling (RP-22).** `recorder.js` listens for the child
  process's `'error'` event, not just `'exit'`: a spawn failure (a blocked
  path, an execution policy) used to be an uncaught exception with no
  `recorder_died` and no restart, while `events.jsonl` already recorded
  `recorder_start`. It now reports through the same exit/restart path as a
  crash.
- **Close-based stop (RP-23).** `recorder.js`'s `stop()` waits for the
  child's `'close'` event, not `'exit'`: `'close'` fires only after the
  stdio streams have fully drained, so the last typed values the sidecar
  flushes on shutdown are never dropped by the caller moving on too early.
- **Liveness watchdog.** The sidecar emits a `stats` line every 30 s
  regardless of UI activity; if stdout falls silent past 90 s the sidecar
  is presumed hung, killed, and recovered through the normal restart path
  (distinct from §E2's dead-man monitor, which watches for silence on the
  *interaction* signal during an active session, not the process's own
  liveness).

## IPC surface

The tray/main process exposes `pdt:*` IPC handlers consumed by the utility
windows: `pdt:status`, `pdt:fireStart`, `pdt:fireEnd`, `pdt:setSessionLabel`,
`pdt:manualScreenshot`, `pdt:startSession`, `pdt:endSession`,
`pdt:togglePause`, `pdt:obsTest`, `pdt:sessionConfigGet/Save`,
`pdt:profileGet/Save`, `pdt:settingsGet/Save`, `pdt:welcomeAction`.
`pdt:fireSync` (cross-machine sync markers) is gone with the feature
([ADR-0029](../adr/0029-ba-helper-refocus.md)).

## Configuration

Per-session config is YAML, deep-merged over the `DEFAULTS` object in `config.js`
— which, since v0.5.0 (C3), is the **single source** of default values (one
exception: `storage_warn_gb` is read in `main.js` with an inline `|| 50` fallback,
not from `DEFAULTS`). Point the app at a file with `PDT_CONFIG`, or edit via the
session config window (which writes `quick-config.yaml` for the next launch). A
hotkey whose binding is already held by another app falls back to its `Ctrl+Alt+`
variant at registration.

| Key | Default | Purpose |
|---|---|---|
| `engagement_id` / `engagement_name` / `worker` | `"default"` / … | Identity stamped on the session + manifest. |
| `auto_end_idle_minutes` | `30` | Idle span that auto-ends the session (when `auto_end_on_idle`). |
| `auto_end_on_idle` | `true` | Set `false` to keep a session running through idle — 8-hour passive recordings. |
| `poll_interval_seconds` | `5` | Active-window poll cadence. |
| `idle_threshold_seconds` | `60` | OS-idle threshold before an `idle_start` is logged. |
| `taxonomy_version` | `"v0"` | Taxonomy generation stamped into `stats.json.meta`. |
| `storage_warn_gb` | `50` | Total stored-sessions size that triggers a cleanup-reminder toast (read in `main.js`). |
| `process_labels` | `[]` | Task-shortcut names: shown as named-run buttons in the Live Session window and a "Start a named run" tray submenu, each starting a run with that name via the one run hotkey instead of an auto-numbered "Run N". |
| `obs` / `hotkeys` | … | OBS WebSocket config + the three global-hotkey bindings (`start_picker` / `end_innermost` / `manual_screenshot`; the cross-machine sync-marker hotkey is gone with the feature). |
| `screenshots.enabled` / `.quality` / `.on_app_switch` / `.on_marker_fire` / `.on_idle_resume_minutes` / `.display` | `true` / `60` / `true` / `true` / `5` / `"active"` | Screenshot triggers, JPEG quality, and multi-monitor selection (`active` / `primary` / `all`). |
| `interactions.enabled` / `.required` / `.auto_restart` / `.max_restarts_per_session` | `true` / `false` / `true` / `3` | Recorder-sidecar lifecycle. |
| `interactions.exclude_processes` | `[]` | Extra process names (exe, `.exe`-insensitive) to drop from the analysis. Applied by normalization (`process_filter`) on the derived stream — unioned with PDT's own self-exclusion and the analyst's `step_filters.ignored_processes` / `ignored_window_titles`. (PDT's own windows are excluded automatically; this is for additional apps.) |
| `interactions.verbose` | `false` | Forensic firehose — emit `focus_changed` / `text_changed` / per-keystroke `value_changed` (~3–5× events). |
| `interactions.debounce_ms` | `750` | The recorder's `value_changed` coalescing window, passed to the sidecar in `hello`. |
| `interactions.ocr` | `false` | §11e OCR last resort. When `true`, an identityless element's on-screen region is captured and OCR'd (`Windows.Media.Ocr`) for a `ocr_text` label. Off by default; enable only for a known low-UIA app. Passed to the sidecar in `hello`. |
