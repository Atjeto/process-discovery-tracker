# Interaction Recorder — Feature Design

**Status:** Implemented — the recorder shipped; see [CAPTURE.md](architecture/CAPTURE.md) and [ADR-0001](adr/0001-click-recorder-sidecar-language.md)
**Date:** 2026-05-14
**Decisions of record:** [ADR-0001](adr/0001-click-recorder-sidecar-language.md)
**Tool-wide design:** [`process_discovery_tracker_design.md`](../../process_discovery_tracker_design.md)

## 1. Purpose

The tracker currently captures *what app the SME was in* (5s active-window polling) and *what they verbally described doing* (analyst-fired Start/End markers). It does not capture *what specific UI elements they interacted with*. This feature adds an interaction-recorder sidecar that subscribes to Windows UI Automation (UIA) events and emits structured `interaction` events into the existing `events.jsonl` stream.

Colloquially called "the click recorder" but actually broader — captures button invocations, selections, value changes, toggle changes, text changes, and focus moves. Anything UIA exposes as an automation event.

## 2. Scope

**In scope:**
- A C# sidecar process that subscribes to UIA events globally and emits NDJSON to stdout.
- A Node module (`capture/recorder.js`) that manages the sidecar's lifecycle, mirroring the `obs.js` pattern.
- A new `interaction` event type in `events.jsonl`, with a constructor in `events.js` and a schema entry in `shared/SCHEMA.md`.
- Integration with the existing session lifecycle (`createSession` / `closeSession`, pause / resume, crash recovery).
- Config for enabling, requiring, and auto-restart behavior.
- Build pipeline change to bundle the published C# .exe into the Electron artifact via `electron-builder`'s `extraResources`.

**Out of scope (this feature):**
- Mouse-coordinate capture, dead-click capture, drag/gesture distinction. See ADR-0001 §"What we lose, explicitly."
- Citrix-internal capture. UIA does not cross the remote-session boundary.
- Privacy / redaction / hashing. See ADR-0001 §"Context — scope of this tool."
- Normalization-side joining of interactions to cases. Belongs in the Python normalization service; will land alongside this feature but isn't part of the capture-side build.
- Viewer-side rendering of interactions. Separate feature; the viewer will gain an interaction lane in a follow-up.

## 3. Architecture

```
                   capture/main.js (Electron main)
                   ┌────────────────────────────────┐
                   │  startSession() →              │
                   │    spawnRecorder({sessionId}) ─┼──► child_process.spawn("recorder.exe")
                   │      stdin:  control NDJSON ───┼─────────────────┐
                   │      stdout: data NDJSON ──────┼─◄───────────────┤
                   │      stderr: log lines  ───────┼─◄───────────────┤
                   │                                │                 │
                   │  onEvent(ev) → tracker.fireInteraction(ev)       │
                   │  endSession() → stopRecorder() drain & SIGTERM   │
                   └────────────────────────────────┘                 │
                                                                       │
                                          ┌────────────────────────────┴───┐
                                          │  capture/recorder/recorder.exe │
                                          │  (.NET 8 self-contained)       │
                                          │   - Program.cs (stdio)         │
                                          │   - UiaSubscriber.cs (events)  │
                                          │   - StdioProtocol.cs (control) │
                                          └────────────────────────────────┘
```

The sidecar is a sibling subsystem of the existing `obs.js` integration. Its lifecycle is owned by `main.js`. It does not write to the events file directly — events flow back through Node, are validated, and appended to `events.jsonl` via the same single-writer path that activity / marker / system events use. This preserves the SCHEMA.md invariant that `events.jsonl` is a single-writer append-only stream.

### 3.1 Why a sidecar, not in-process

- **Crash isolation.** A misbehaving UIA event handler or a hung COM call doesn't take down Electron.
- **Language fit.** The cleanest UIA event API on Windows is `System.Windows.Automation` (per ADR-0001 §A1). Running it in-process from Electron would require Node→COM interop the team doesn't currently maintain.
- **Pattern precedent.** `obs.js` already establishes the sidecar pattern (separate process, lifecycle managed by `main.js`). Reusing the shape minimizes the design surface.

## 4. Sidecar protocol

NDJSON over stdio. One JSON object per line, UTF-8, `\n`-terminated. The protocol is the load-bearing contract between Electron and the sidecar; the implementation language is opaque to Node.

### 4.1 Control plane — Electron → sidecar (stdin)

```json
{"cmd":"hello","session_id":"<uuid>","schema_version":1}
{"cmd":"pause"}
{"cmd":"resume"}
{"cmd":"shutdown"}
```

- `hello` is sent immediately after spawn. Sidecar acknowledges via a `ready` data-plane event.
- `pause` / `resume` flip an in-process flag; while paused, the sidecar drops events rather than emitting them.
- `shutdown` requests graceful exit. Sidecar should drain any in-flight events, flush stdout, exit 0 within `drainTimeoutMs` (default 1500). Electron sends SIGTERM if the timeout elapses.
- Parent closing stdin (e.g. Electron crash) is treated as an implicit shutdown — sidecar exits cleanly.

### 4.2 Data plane — sidecar → Electron (stdout)

```json
{"v":1,"type":"ready","ts":"2026-05-14T09:23:11.482Z"}

{"v":1,"type":"interaction","ts":"2026-05-14T09:23:14.215Z","data":{
  "kind":"invoked",
  "control_type":"Button",
  "automation_id":"btnSave",
  "name":"Save",
  "class_name":"WindowsForms10.BUTTON.app.0.378734a",
  "framework_id":"WinForm",
  "window_title":"Order Entry — SAP",
  "process_name":"saplogon.exe",
  "pid":12648
}}

{"v":1,"type":"warning","ts":"...","msg":"event-handler exception swallowed","detail":"..."}
```

- `v` is the schema version of the line, not the event. Bumped only on incompatible protocol changes.
- `ts` is the moment the UIA event fired, sourced from the sidecar's clock (same machine as Electron — no offset).
- The `data` block for `type: "interaction"` becomes the `data` of the eventual `events.jsonl` line after Electron-side validation strips `v` / `type` / `ts`.

### 4.3 Log plane — sidecar → Electron (stderr)

Free-form lines, captured via the existing `bootLog()` pattern in `main.js`. Used for sidecar-side diagnostics. Not parsed.

## 5. UIA event subscription

The sidecar subscribes to four event categories on `AutomationElement.RootElement` with `TreeScope.Subtree`. All callbacks fire on UIA worker threads; the sidecar serializes them onto a single writer task via a thread-safe queue (sketched in §6.2).

### 5.1 Events and payloads

| UIA event | `data.kind` | Triggers on | Extra payload fields |
|---|---|---|---|
| `InvokePattern.InvokedEvent` | `invoked` | Buttons, menu items, links activated (mouse or keyboard) | — |
| `SelectionItemPattern.ElementSelectedEvent` | `selection_changed` | Listbox/dropdown/tab selection | `selected_value`: text of the newly selected item |
| `TogglePattern.ToggleStateProperty` change | `toggle_changed` | Checkboxes, toggle buttons | `toggle_state`: `"on"` / `"off"` / `"indeterminate"` |
| `RangeValuePattern.ValueProperty` change | `value_changed` | Sliders, scrollbars, spinners | `value`: numeric |
| `ValuePattern.ValueProperty` change | `value_changed` | Text inputs (commit on focus loss, not per keystroke) | `value`: string, length-clamped to 256 chars |
| `TextPattern.TextChangedEvent` | `text_changed` | Multi-line text controls (notification only, no payload) | — |
| `AutomationFocusChangedEvent` | `focus_changed` | Focus moves between any controls | — |

Per-event fields, always present when resolvable from `AutomationElement.Current`:

- `control_type` — e.g. `"Button"`, `"Edit"`, `"ListItem"`
- `automation_id` — the developer-assigned ID (most useful for stable identification)
- `name` — the visible label
- `class_name` — Win32 class name (useful for app fingerprinting)
- `framework_id` — `"Win32"`, `"WinForm"`, `"WPF"`, `"DirectUI"`, `"XAML"`, etc.
- `window_title` — title of the owning top-level window
- `process_name` — owning process executable name
- `pid` — owning process PID

Any field that throws on access is omitted rather than nulled. The sidecar logs (stderr) the field name and exception class.

### 5.2 Event volume considerations

Focus changes fire on every tab navigation, every menu hover, every dialog open. A keyboard-driven user generates 5–15 focus events per second during active work. To keep `events.jsonl` size reasonable:

- Focus events are emitted but flagged `kind: "focus_changed"` for downstream coalescing during normalization (collapse runs of focus_changed events that don't carry an invocation in between).
- Capture-side does no coalescing — raw events stay raw, per the design's "events are immutable, meaning lives downstream" principle.

Expected rate during a walkthrough: 20–60 interaction events / minute steady-state, bursts to a few hundred during dense form-filling. Comfortably within the events.jsonl append budget.

## 6. Module changes

### 6.1 New: `capture/recorder/` (C# project)

```
capture/recorder/
  Recorder.csproj          # net8.0, references UIAutomationClient + UIAutomationTypes
  Program.cs               # Main(), stdio wiring, control loop
  UiaSubscriber.cs         # AddAutomationEventHandler / FocusChanged / PropertyChanged
  StdioProtocol.cs         # NDJSON read/write helpers, control command parsing
  publish/                 # .gitignored — populated by `dotnet publish`
```

Build command (run before `electron-builder`):

```
dotnet publish capture/recorder/Recorder.csproj \
  -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true \
  -p:IncludeAllContentForSelfExtract=true \
  -p:DebugType=none -p:DebugSymbols=false \
  -o capture/recorder/publish
```

Output: `capture/recorder/publish/recorder.exe`, ~60–80 MB self-contained single file.

### 6.2 Sidecar sketch (Program.cs)

```csharp
// Pseudocode — sketch only
static int Main(string[] args) {
    var queue = new BlockingCollection<string>(boundedCapacity: 4096);
    var paused = false;

    var subscriber = new UiaSubscriber(onEvent: evt => {
        if (paused) return;
        var line = JsonSerializer.Serialize(evt);
        if (!queue.TryAdd(line)) {
            // queue full — log to stderr, drop event
            Console.Error.WriteLine("queue full, dropping event");
        }
    });

    var writer = Task.Run(() => {
        foreach (var line in queue.GetConsumingEnumerable()) {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    });

    EmitReady();
    subscriber.Start();

    // Control loop on stdin
    string cmd;
    while ((cmd = Console.In.ReadLine()) != null) {
        var msg = JsonSerializer.Deserialize<ControlMsg>(cmd);
        switch (msg.Cmd) {
            case "pause":    paused = true;  break;
            case "resume":   paused = false; break;
            case "shutdown": goto done;
        }
    }

done:
    subscriber.Stop();
    queue.CompleteAdding();
    writer.Wait(TimeSpan.FromMilliseconds(1500));
    return 0;
}
```

Notes:
- `Console.Out` is wrapped to force autoflush; without this, lines can sit in the .NET buffer when the parent is reading them with no time pressure.
- `Console.In.ReadLine()` returning `null` (parent closed stdin) drops into the shutdown path — same behavior as receiving `shutdown` explicitly.
- All UIA event handlers run on UIA worker threads; the queue serializes them to a single writer to keep stdout writes ordered and atomic.

### 6.3 New: `capture/recorder.js` (Node sidecar manager)

Public API:

```js
const handle = await spawnRecorder({
  sessionId,            // for hello message + diagnostics
  recorderPath,         // resolved against process.resourcesPath in production
  onEvent,              // called with each {kind, ...data} object after validation
  onWarning,            // called with sidecar-emitted warnings, defaults to bootLog
  bootLog,              // for module-internal diagnostics
});

await pauseRecorder(handle);
await resumeRecorder(handle);
await stopRecorder(handle, { drainTimeoutMs: 1500 });
```

Internals:
- `child_process.spawn(recorderPath, [], { stdio: ["pipe", "pipe", "pipe"] })`.
- `readline.createInterface` on `child.stdout` → parse each line as JSON → if `type === "interaction"`, call `onEvent(parsed.data)` → if `type === "warning"`, call `onWarning(parsed)`.
- JSON parse errors are logged via `onWarning` and the line is dropped (don't crash on malformed sidecar output).
- Stderr is line-streamed to `bootLog` with a `[recorder]` prefix.
- `child.on("exit", (code, signal) => onExit({code, signal}))` — `main.js` decides whether to auto-restart.

### 6.4 Modified: `capture/main.js`

In `startSession()`, after the OBS block:

```js
if (config.interactions && config.interactions.enabled) {
  try {
    recorder = await spawnRecorder({
      sessionId: session.sessionId,
      recorderPath: resolveRecorderPath(),
      onEvent: (data) => tracker.fireInteraction(data),
      onWarning: (w) => bootLog(`[recorder] ${w.msg}: ${w.detail || ""}`),
      bootLog,
    });
    tracker.fireSystem("recorder_start");
  } catch (e) {
    bootLog(`recorder spawn failed: ${e && e.message}`);
    if (config.interactions.required) {
      dialog.showErrorBox(
        "Interaction recorder unavailable",
        `The interaction recorder could not start.\n\n${e && e.message}\n\n` +
          `Per session config, the recorder is required.`
      );
      return null;
    }
    // soft-fail: session continues without click capture
  }
}
```

In `endSession()`, mirroring `stopRecording(obs)`:

```js
if (recorder) {
  tracker.fireSystem("recorder_stop");
  try {
    await stopRecorder(recorder, { drainTimeoutMs: 1500 });
  } catch (e) {
    bootLog(`recorder stop failed: ${e && e.message}`);
  }
  recorder = null;
}
```

In `tracker.pause()` / `tracker.resume()` paths (tray menu + IPC handler), call `pauseRecorder(recorder)` / `resumeRecorder(recorder)` if the handle exists.

In the `before-quit` and `will-quit` paths, ensure `stopRecorder` runs before the app exits.

Module-scope variable:

```js
let recorder = null;
```

Path resolution helper:

```js
function resolveRecorderPath() {
  const candidates = [
    process.env.PDT_RECORDER_PATH,                                  // dev override
    path.join(process.resourcesPath || "", "recorder", "recorder.exe"), // packaged
    path.join(__dirname, "recorder", "publish", "recorder.exe"),    // dev tree
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("recorder.exe not found in any candidate path");
}
```

### 6.5 Modified: `capture/tracker.js`

Add `fireInteraction(data)`:

```js
function fireInteraction(data) {
  const ev = interactionEvent(sessionId, data);
  appendEvent(ev);
  return ev;
}
```

Extend `getStatus()` to include `interactionCount`:

```js
return {
  ...,
  interactionCount,    // bumped in appendEvent when ev.type === "interaction"
  ...
};
```

Bump `interactionCount` in `appendEvent`:

```js
if (ev.type === "interaction") interactionCount += 1;
```

Export `fireInteraction` from the returned object.

### 6.6 Modified: `capture/events.js`

Add an `interactionEvent` constructor that validates and shapes the sidecar payload:

```js
function interactionEvent(sessionId, data) {
  if (!data || typeof data.kind !== "string") {
    throw new Error("interactionEvent requires data.kind");
  }
  // shape: drop any fields the sidecar emitted that aren't in the schema
  const allowed = new Set([
    "kind", "control_type", "automation_id", "name", "class_name",
    "framework_id", "window_title", "process_name", "pid",
    "selected_value", "toggle_state", "value",
  ]);
  const shaped = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowed.has(k)) shaped[k] = v;
  }
  return makeEvent("interaction", sessionId, shaped);
}

module.exports = { activityEvent, markerEvent, systemEvent, interactionEvent, nowIso };
```

### 6.7 Modified: `capture/config.js`

Add to `DEFAULTS`:

```js
interactions: {
  enabled: true,
  required: false,
  auto_restart: true,
  max_restarts_per_session: 3,
  exclude_processes: [],   // process names to skip recording for
  verbose: false,          // forensic firehose: focus_changed / text_changed / per-keystroke value_changed
  debounce_ms: 750,        // value_changed coalescing window (ms), passed to the recorder in `hello`
},
```

### 6.8 Modified: `capture/sample-config.yaml`

Add documented block:

```yaml
# Interaction recording (§ interaction-recorder.md)
# Subscribes to Windows UI Automation events. No mouse hook; first-party
# Microsoft APIs only. See ADR-0001 for rationale.
interactions:
  enabled: true            # set false to disable for a given engagement
  required: false          # fail session start if the recorder can't spawn
  auto_restart: true       # respawn the sidecar if it dies mid-session
  max_restarts_per_session: 3
```

### 6.9 Modified: `shared/SCHEMA.md`

Add an `interaction` event type entry next to `activity` / `marker` / `system`:

````
### `interaction` data

```json
{
  "kind": "invoked" | "selection_changed" | "value_changed" |
          "toggle_changed" | "text_changed" | "focus_changed",
  "control_type": "Button",
  "automation_id": "btnSave",
  "name": "Save",
  "class_name": "...",
  "framework_id": "WinForm" | "WPF" | "Win32" | "DirectUI" | "XAML" | ...,
  "window_title": "Order Entry — SAP",
  "process_name": "saplogon.exe",
  "pid": 12648,
  // kind-specific:
  "selected_value": "..."     // selection_changed only
  "toggle_state": "on" | "off" | "indeterminate"  // toggle_changed only
  "value": "..."              // value_changed only
}
```

Captured from Windows UI Automation events (`Invoked`, `SelectionItemSelected`, property-changed on `ToggleState` / `RangeValue.Value` / `Value`, `TextChanged`, `FocusChanged`). No mouse coordinates — see ADR-0001.

Fields are omitted (not nulled) when the underlying UIA property throws on access.
````

Add to the `system` kinds list: `recorder_start`, `recorder_stop`, `recorder_died`.

Add to the kind-specific payloads table:

| Kind | Payload |
|---|---|
| `recorder_start` / `recorder_stop` | (empty) |
| `recorder_died` | `{ code, signal, restart_count }` |

### 6.10 Modified: `capture/package.json`

Add to `build.extraResources`:

```json
{
  "from": "recorder/publish/recorder.exe",
  "to": "recorder/recorder.exe"
}
```

Add an npm script that publishes the sidecar before packaging:

```json
"scripts": {
  "build:recorder": "dotnet publish recorder/Recorder.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeAllContentForSelfExtract=true -o recorder/publish",
  "dist": "npm run build:recorder && electron-builder --win --x64 --publish=never"
}
```

## 7. Lifecycle and failure modes

### 7.1 Normal flow

1. SME opens tray menu → Start session.
2. `main.js` `startSession()` runs: OBS (if configured) → `createSession()` → `spawnRecorder()` → `startTracker()`.
3. Sidecar emits `ready` event over stdout; Node logs it but doesn't surface to the user.
4. SME walks through their process; UIA events flow through the sidecar → Node → `tracker.fireInteraction` → `events.jsonl`.
5. SME fires End marker / End session → `endSession()` runs: `stopRecorder` (drain + SIGTERM) → `closeSession()`.

### 7.2 Pause / resume

1. SME hits Pause from tray menu.
2. `tracker.pause()` flips its flag; activity polling halts.
3. `main.js` sends `{"cmd":"pause"}` to sidecar over stdin.
4. Sidecar drops UIA events until `resume`.
5. `tracker.fireSystem("paused")` writes a system event so the gap is explicit in `events.jsonl`.

### 7.3 Sidecar crash mid-session

1. `child.on("exit", ...)` fires with non-zero code.
2. `tracker.fireSystem("recorder_died", {code, signal, restart_count})`.
3. If `config.interactions.auto_restart && restart_count < max_restarts_per_session`:
   - Wait 5s backoff.
   - Re-spawn. On success, `tracker.fireSystem("recorder_start")` again.
4. If retries exhausted, log and leave the session running without interaction capture. The session still completes; the analyst will see the gap in the normalized view.

### 7.4 Electron crash with sidecar running

- Sidecar detects stdin EOF, runs its shutdown path, exits 0.
- On next launch, the orphaned-session recovery in `session.js` finds the session and marks it `recovered`. Interaction events written before the crash are preserved.

### 7.5 Strict mode (`interactions.required: true`)

- Spawn failure during `startSession()` aborts the session creation with a dialog (mirrors `obs.required` behavior).
- Use for engagements where interaction capture is the primary point of the session.

## 8. Build and packaging

### 8.1 Dev loop

```
# one-time
dotnet tool install -g dotnet-script  # optional, for inline experimentation

# every change to the sidecar
cd capture
npm run build:recorder
npm run dev                            # electron .
```

`resolveRecorderPath()` finds `recorder/publish/recorder.exe` under `__dirname` so an unpackaged dev launch works without env vars.

### 8.2 Packaging

```
cd capture
npm run dist
```

The `build:recorder` step runs first, producing `recorder/publish/recorder.exe`. `electron-builder` copies it into the packaged app's `resources/recorder/recorder.exe` per the `extraResources` entry. In production, `resolveRecorderPath()` finds it via `process.resourcesPath`.

### 8.3 Signing (if available)

If the team has access to an internal authenticode cert, fold signing into the publish pipeline:

```
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 \
  /f cert.pfx /p $env:CERT_PWD recorder/publish/recorder.exe
```

Signing the recorder .exe (and ideally the Electron app .exe) closes most remaining heuristic distance with corp AV scanners. If signing is unavailable, ship unsigned and accept the small remaining risk — the no-hook posture from ADR-0001 is the primary defense.

## 9. Validation plan

Before integration:

1. **Sidecar standalone smoke test.** Run `recorder.exe` from a terminal, click around in Notepad / Chrome / Excel, confirm NDJSON events stream to stdout. Verify focus / invoke / value_changed events fire and contain the expected fields.
2. **Sec scan pass.** Submit the published `.exe` to the team's corporate sec scan (or run it through the team's normal endpoint protection on a clean machine). Go/no-go gate per ADR-0001 action item #8. If it flags, investigate the specific heuristic before integration.
3. **Coverage check.** Validate on the apps the team actually does walkthroughs against — at minimum Excel, Outlook, Chrome, one WinForms LOB app, one Citrix-fronted app. Document the Citrix coverage gap as expected.
4. **Lifecycle integration.** Wire `capture/recorder.js` and `main.js`, run a full session start → walkthrough → end. Confirm `events.jsonl` contains `recorder_start`, interaction events, `recorder_stop` in order, and no orphan child processes after exit.
5. **Crash recovery.** Kill the sidecar mid-session via Task Manager. Confirm `recorder_died` event, auto-restart fires, subsequent events resume cleanly.

## 10. Open items

- **Normalization-side join to cases.** Out of scope for this feature, but the Python normalization service needs an analogous step to the activity-event case stamping in §5.2 of the main design doc. Track separately.
- **Viewer surface for interactions.** Out of scope. Likely a thin lane on the session timeline, with element name on hover. Track separately.
- **`text_changed` payload.** Currently emit notification only (no content). If a future engagement specifically needs captured text values, revisit with the engagement's stakeholder — fields that hold passwords or PANs would need either an allow-list of safe controls or a length/regex filter. Don't add this speculatively.
- **Right-click context menus.** UIA fires `InvokedEvent` when a menu item is selected, but not on the right-click itself. If "user opened the context menu but cancelled" turns out to be a useful signal, revisit.
- **Cross-feature interaction with the existing `screenshots.on_app_switch` trigger.** Currently a screenshot fires on every foreground app change. With interaction events also flowing, the app-switch screenshot trigger may become redundant — leave alone for now, revisit during phase 4 sharpening.
