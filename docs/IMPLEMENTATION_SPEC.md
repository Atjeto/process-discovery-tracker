# Process Discovery Tracker - Implementation Spec

| Field | Value |
|---|---|
| Status | Ready to implement |
| Date | 2026-05-14 |
| Scope | Everything in `process_discovery_tracker_design.md` (v0.2), `interaction-recorder.md`, and `annotation-model.md` that is not yet built. |
| Audience | Claude Code session(s) executing the work. |
| Style | Imperative. What to build and how. No design rationale - the design docs hold that. |

## 0. Pre-flight

### 0.1 Environment

Required on the dev machine before any phase starts:

- Node 18+ and npm
- Python 3.10+ with pip
- .NET SDK 8.0+
- PowerShell 5+ (Windows)
- Git
- (For phase E) `python-docx` (added via requirements.txt)
- (For phase F) Internet access to download the sentence-transformers model once into the embeddable Python bundle

Verify before starting:

```powershell
node --version          # >= 18
python --version        # >= 3.10
dotnet --version        # >= 8.0
pwsh --version
```

### 0.2 Repo layout (current)

```
process-discovery-tracker/
  capture/                              # Electron tracker, shipped
  viewer/                               # Electron viewer + bundled Python in dist
  normalization/                        # Python pipeline
  shared/SCHEMA.md                      # Event + annotation schema
  docs/
    User-Guide.docx
    build-user-guide.js
    interaction-recorder.md             # design
    annotation-model.md                 # design
    adr/0001-click-recorder-sidecar-language.md
    Security-QA.md
    IMPLEMENTATION_SPEC.md              # this file
  scripts/
    build-distribution.ps1
    build-python-embeddable.ps1
    generate-sbom.js
    preflight.ps1
    prune-sessions.py
  SECURITY.md
  LICENSE
  README.md
```

### 0.3 What's already built (do not redo)

- Capture: tracker.js polling, marker stack, idle detection + auto-end, screenshots via Electron `desktopCapturer`, OBS lifecycle, per-session YAML config, session folder format, status window, operator panel, help window, sync markers, crash recovery, orphan detection.
- Normalization: case_assignment.py, classification.py, xes_export.py, mining.py (inductive/heuristics/DFG), stats_compute.py, normalize.py (CLI), apply_marker_edits (label/timestamp/delete).
- Viewer: session view with video-timeline sync, raw events table with filter, three annotation sub-tabs (notes, screenshots, markers with rename/adjust/delete), aggregate view with BPMN (bpmn-js) and DFG (cytoscape) drill-down, filter, date range, markdown report, taxonomy promotion, recent sessions, keyboard shortcuts, help modal.
- Security: CSP on every renderer, deny-all window open / will-navigate, path-traversal guards on session-folder IPC, dependency overrides (audit-clean runtime), SBOM generator, SECURITY.md, LICENSE, Security-QA.md, preflight gate.
- Build pipeline: electron-packager for both apps, python-embeddable bundler, distribution assembly script that ships docs + SBOM.

### 0.4 What this spec adds

Phases A through G, in implementation order:

- **A**: C# UIA interaction recorder sidecar + Node lifecycle + `interaction` event type.
- **B**: Step entity in annotations + auto-suggestion pass + step editor in viewer.
- **C**: Canonical step sets + matching layer in normalization + canonical authoring view.
- **D**: Phase entity + phase editor + phase rollup.
- **E**: Three-mode BPMN export (flow, step, phase) + PDD .docx export + step CSV.
- **F**: Local ML stack (sentence-transformer embeddings, HDBSCAN clustering, scikit-learn classifier, ONNX runtime) + `ml_suggestions.json` + viewer surfaces.
- **G**: Drift diagnostics + match rate trending + re-normalization workflow + drift indicators.

Each phase has acceptance gates. A phase is "done" when its acceptance test passes. Phases must be done in order: B depends on A, C depends on B, etc.

### 0.5 Conventions

- **Commit messages**: imperative subject line under 70 chars; body explains what changed and why-not (e.g. "use NDJSON over named pipes because Windows pipe semantics on Electron child spawn are unreliable"). No `Co-Authored-By` trailers - per the project's existing memory.
- **Branches**: one branch per phase. Merge to master via PR. Tag at the end of each phase (`v0.2.A`, `v0.2.B`, etc.).
- **Run preflight before every commit**: `powershell -ExecutionPolicy Bypass -File .\scripts\preflight.ps1`. Must show 0 runtime advisories on both apps.
- **No em-dashes or en-dashes in user-facing strings.** Code comments are not user-facing. The User Guide regeneration step at the end of phase G checks this.
- **File naming**: lowercase-with-hyphens for scripts, PascalCase for C# classes, snake_case for Python.
- **JSON field naming**: snake_case throughout. C# JsonSerializer must use `JsonNamingPolicy.SnakeCaseLower` or per-field `[JsonPropertyName]` attributes.

### 0.6 Build commands (consolidated)

```powershell
# Full distribution build (rebuilds Python embeddable if needed)
powershell -ExecutionPolicy Bypass -File .\scripts\build-distribution.ps1

# Distribution build skipping Python rebuild (faster iteration)
powershell -ExecutionPolicy Bypass -File .\scripts\build-distribution.ps1 -SkipPython

# Build only the C# recorder (phase A onwards)
cd capture
npm run build:recorder

# Build only the capture app
cd capture
npm run package

# Build only the viewer
cd viewer
npm run package

# Regenerate SBOM
node scripts/generate-sbom.js

# Regenerate User Guide .docx
node docs/build-user-guide.js

# Preflight audit
powershell -ExecutionPolicy Bypass -File .\scripts\preflight.ps1
```

---

## Phase A: Interaction Recorder

### A.1 Create the C# project

Create `capture/recorder/`. Files to add:

#### `capture/recorder/Recorder.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <UseWindowsForms>false</UseWindowsForms>
    <UseWPF>false</UseWPF>
    <PublishSingleFile>true</PublishSingleFile>
    <SelfContained>true</SelfContained>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <IncludeAllContentForSelfExtract>true</IncludeAllContentForSelfExtract>
    <DebugType>none</DebugType>
    <DebugSymbols>false</DebugSymbols>
    <InvariantGlobalization>true</InvariantGlobalization>
    <RootNamespace>Pdt.Recorder</RootNamespace>
    <AssemblyName>recorder</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="UIAutomationClient" />
    <Reference Include="UIAutomationTypes" />
  </ItemGroup>
</Project>
```

#### `capture/recorder/Program.cs`

```csharp
// Pdt.Recorder.Program - entry point.
// Sets up autoflushing stdout, reads control commands from stdin,
// owns the UiaSubscriber's lifecycle, and serializes interaction
// events to NDJSON via a single writer task.

using System.Collections.Concurrent;
using System.Text.Json;

namespace Pdt.Recorder;

public static class Program {
    public static async Task<int> Main(string[] args) {
        // Force autoflush so each NDJSON line is delivered immediately
        // when stdout is redirected to a pipe (Electron child spawn).
        var stdout = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
        Console.SetOut(stdout);
        var stderr = new StreamWriter(Console.OpenStandardError()) { AutoFlush = true };
        Console.SetError(stderr);

        var options = new JsonSerializerOptions {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        };

        var paused = 0;       // int for atomic Interlocked toggles
        var droppedTotal = 0L;
        var emittedTotal = 0L;
        var queue = new BlockingCollection<string>(boundedCapacity: 4096);

        var subscriber = new UiaSubscriber(options, evt => {
            if (Volatile.Read(ref paused) != 0) return;
            try {
                var line = JsonSerializer.Serialize(evt, options);
                if (!queue.TryAdd(line)) {
                    Interlocked.Increment(ref droppedTotal);
                }
            } catch (Exception e) {
                Console.Error.WriteLine($"serialize failed: {e.Message}");
            }
        });

        var writer = Task.Run(() => {
            foreach (var line in queue.GetConsumingEnumerable()) {
                Console.Out.WriteLine(line);
                Interlocked.Increment(ref emittedTotal);
            }
        });

        // stats every 30s
        var statsTimer = new System.Timers.Timer(30_000) { AutoReset = true };
        statsTimer.Elapsed += (_, __) => {
            var stats = new {
                v = 1, type = "stats",
                ts = DateTime.UtcNow.ToString("o"),
                data = new {
                    queued = queue.Count,
                    dropped_total = Interlocked.Read(ref droppedTotal),
                    emitted_total = Interlocked.Read(ref emittedTotal),
                }
            };
            try { Console.Out.WriteLine(JsonSerializer.Serialize(stats, options)); }
            catch { /* writer may have closed */ }
        };
        statsTimer.Start();

        Console.Out.WriteLine(JsonSerializer.Serialize(new {
            v = 1, type = "ready", ts = DateTime.UtcNow.ToString("o")
        }, options));

        subscriber.Start();

        // Control loop on stdin
        string? line;
        while ((line = await Console.In.ReadLineAsync()) != null) {
            try {
                using var doc = JsonDocument.Parse(line);
                if (!doc.RootElement.TryGetProperty("cmd", out var cmdEl)) continue;
                var cmd = cmdEl.GetString();
                switch (cmd) {
                    case "pause":    Interlocked.Exchange(ref paused, 1); break;
                    case "resume":   Interlocked.Exchange(ref paused, 0); break;
                    case "shutdown": goto done;
                }
            } catch (Exception e) {
                Console.Error.WriteLine($"bad control line: {e.Message}");
            }
        }

    done:
        statsTimer.Stop();
        subscriber.Stop();
        queue.CompleteAdding();
        try { writer.Wait(TimeSpan.FromMilliseconds(1500)); } catch { }
        return 0;
    }
}
```

#### `capture/recorder/UiaSubscriber.cs`

```csharp
// Subscribes to UIA Invoked / SelectionItemSelected / TextChanged /
// FocusChanged / PropertyChanged events on the desktop root with
// TreeScope.Subtree. Resolves per-element fields safely (any field
// that throws on access is omitted).

using System.Text.Json;
using System.Windows.Automation;

namespace Pdt.Recorder;

public sealed class UiaSubscriber {
    private readonly JsonSerializerOptions _opts;
    private readonly Action<object> _onEvent;
    private bool _started;

    public UiaSubscriber(JsonSerializerOptions opts, Action<object> onEvent) {
        _opts = opts;
        _onEvent = onEvent;
    }

    public void Start() {
        if (_started) return;
        _started = true;
        var root = AutomationElement.RootElement;

        Automation.AddAutomationEventHandler(
            InvokePattern.InvokedEvent, root, TreeScope.Subtree,
            (s, e) => Emit("invoked", (AutomationElement)s, null));

        Automation.AddAutomationEventHandler(
            SelectionItemPattern.ElementSelectedEvent, root, TreeScope.Subtree,
            (s, e) => Emit("selection_changed", (AutomationElement)s,
                ExtractSelectionPayload((AutomationElement)s)));

        Automation.AddAutomationFocusChangedEventHandler(
            (s, e) => Emit("focus_changed", (AutomationElement)s, null));

        // Property-changed events for Toggle/Value/RangeValue
        Automation.AddAutomationPropertyChangedEventHandler(
            root, TreeScope.Subtree,
            (s, e) => OnPropertyChanged((AutomationElement)s, e),
            TogglePattern.ToggleStateProperty,
            ValuePattern.ValueProperty,
            RangeValuePattern.ValueProperty);

        // TextChanged - notification only, no payload
        Automation.AddAutomationEventHandler(
            TextPattern.TextChangedEvent, root, TreeScope.Subtree,
            (s, e) => Emit("text_changed", (AutomationElement)s, null));
    }

    public void Stop() {
        if (!_started) return;
        try { Automation.RemoveAllEventHandlers(); } catch { }
        _started = false;
    }

    private void OnPropertyChanged(AutomationElement el, AutomationPropertyChangedEventArgs e) {
        if (e.Property == TogglePattern.ToggleStateProperty) {
            Emit("toggle_changed", el, new { toggle_state = e.NewValue?.ToString()?.ToLowerInvariant() });
        } else if (e.Property == ValuePattern.ValueProperty ||
                   e.Property == RangeValuePattern.ValueProperty) {
            var raw = e.NewValue?.ToString() ?? "";
            // Length-clamp text values; range values are short numerics
            var v = raw.Length > 256 ? raw.Substring(0, 256) : raw;
            Emit("value_changed", el, new { value = v });
        }
    }

    private object? ExtractSelectionPayload(AutomationElement el) {
        try { return new { selected_value = el.Current.Name }; }
        catch { return null; }
    }

    private void Emit(string kind, AutomationElement el, object? extra) {
        try {
            var data = new Dictionary<string, object?> { ["kind"] = kind };
            TrySet(data, "control_type", () => el.Current.ControlType?.ProgrammaticName?.Replace("ControlType.", ""));
            TrySet(data, "automation_id", () => el.Current.AutomationId);
            TrySet(data, "name", () => el.Current.Name);
            TrySet(data, "class_name", () => el.Current.ClassName);
            TrySet(data, "framework_id", () => el.Current.FrameworkId);
            TrySet(data, "window_title", () => GetTopWindowTitle(el));
            TrySet(data, "process_name", () => GetProcessName(el));
            TrySet(data, "pid", () => el.Current.ProcessId);
            if (extra is not null) {
                var json = JsonSerializer.SerializeToElement(extra, _opts);
                foreach (var prop in json.EnumerateObject()) {
                    data[prop.Name] = prop.Value.ValueKind switch {
                        JsonValueKind.String => prop.Value.GetString(),
                        JsonValueKind.Number => prop.Value.TryGetInt64(out var l) ? (object)l : prop.Value.GetDouble(),
                        JsonValueKind.True => true,
                        JsonValueKind.False => false,
                        JsonValueKind.Null => null,
                        _ => prop.Value.ToString(),
                    };
                }
            }
            _onEvent(new {
                v = 1, type = "interaction",
                ts = DateTime.UtcNow.ToString("o"),
                data,
            });
        } catch (Exception ex) {
            Console.Error.WriteLine($"emit failed: {ex.Message}");
        }
    }

    private static void TrySet<T>(IDictionary<string, object?> d, string key, Func<T> get) {
        try { var v = get(); if (v is not null) d[key] = v; } catch { }
    }

    private static string? GetTopWindowTitle(AutomationElement el) {
        var walker = TreeWalker.ControlViewWalker;
        var node = el;
        AutomationElement? top = null;
        while (node != null && node != AutomationElement.RootElement) {
            top = node;
            node = walker.GetParent(node);
        }
        return top?.Current.Name;
    }

    private static string? GetProcessName(AutomationElement el) {
        try {
            var pid = el.Current.ProcessId;
            using var p = System.Diagnostics.Process.GetProcessById(pid);
            return p.ProcessName + ".exe";
        } catch { return null; }
    }
}
```

### A.2 Build step

Add to `capture/package.json`:

```jsonc
"scripts": {
  // ...existing
  "build:recorder": "dotnet publish recorder/Recorder.csproj -c Release -o recorder/publish",
  "prepackage": "npm run build:recorder",
  "package": "electron-packager . \"Process Discovery Tracker\" --platform=win32 --arch=x64 --overwrite --out=dist --ignore=^/dist --ignore=^/dist-electron --ignore=^/recorder/(bin|obj|publish)? --extra-resource=tray-icon.png --extra-resource=recorder/publish"
}
```

Also update `build` block:

```jsonc
"files": [
  // ...existing
  "recorder/publish/**/*"
],
"extraResources": [
  { "from": "tray-icon.png", "to": "tray-icon.png" },
  { "from": "recorder/publish", "to": "recorder" }
]
```

Add `capture/recorder/.gitignore`:

```
bin/
obj/
publish/
```

### A.3 Node lifecycle module

Create `capture/recorder.js`:

```js
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const readline = require("node:readline");

function resolveRecorderPath() {
  const candidates = [
    process.env.PDT_RECORDER_PATH,
    path.join(process.resourcesPath || "", "recorder", "recorder.exe"),
    path.join(__dirname, "recorder", "publish", "recorder.exe"),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("recorder.exe not found in any candidate path");
}

function spawnRecorder({ sessionId, recorderPath, onEvent, onWarning, onStats, onExit, bootLog }) {
  const exe = recorderPath || resolveRecorderPath();
  const child = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch (_e) {
      if (onWarning) onWarning({ msg: "malformed sidecar line", detail: line.slice(0, 200) });
      return;
    }
    if (msg.v !== 1) {
      if (onWarning) onWarning({ msg: "unknown protocol version", detail: String(msg.v) });
      return;
    }
    if (msg.type === "interaction" && onEvent) onEvent(msg.data);
    else if (msg.type === "warning" && onWarning) onWarning(msg);
    else if (msg.type === "stats" && onStats) onStats(msg.data);
    else if (msg.type === "ready" && bootLog) bootLog("[recorder] ready");
  });

  const rlErr = readline.createInterface({ input: child.stderr });
  rlErr.on("line", (line) => bootLog && bootLog(`[recorder.stderr] ${line}`));

  child.on("exit", (code, signal) => onExit && onExit({ code, signal }));

  // Send hello
  child.stdin.write(JSON.stringify({ cmd: "hello", session_id: sessionId, schema_version: 1 }) + "\n");

  return {
    child,
    pause: () => child.stdin.write(JSON.stringify({ cmd: "pause" }) + "\n"),
    resume: () => child.stdin.write(JSON.stringify({ cmd: "resume" }) + "\n"),
    stop: (opts) => new Promise((resolve) => {
      const drainMs = (opts && opts.drainTimeoutMs) || 1500;
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      child.on("exit", finish);
      try { child.stdin.write(JSON.stringify({ cmd: "shutdown" }) + "\n"); } catch (_) {}
      setTimeout(() => {
        if (done) return;
        try { child.kill("SIGTERM"); } catch (_) {}
        setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} finish(); }, 500);
      }, drainMs);
    }),
  };
}

module.exports = { spawnRecorder, resolveRecorderPath };
```

### A.4 events.js: add `interactionEvent`

In `capture/events.js`, add after `systemEvent`:

```js
function interactionEvent(sessionId, data) {
  if (!data || typeof data.kind !== "string") {
    throw new Error("interactionEvent requires data.kind");
  }
  const allowed = new Set([
    "kind", "control_type", "automation_id", "name", "class_name",
    "framework_id", "window_title", "process_name", "pid",
    "selected_value", "toggle_state", "value",
  ]);
  const shaped = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowed.has(k) && v !== null && v !== undefined) shaped[k] = v;
  }
  return makeEvent("interaction", sessionId, shaped);
}

module.exports = { activityEvent, markerEvent, systemEvent, interactionEvent, nowIso };
```

### A.5 tracker.js: add `fireInteraction`

In `capture/tracker.js`:

- Add `let interactionCount = 0;` to the counter block.
- In `appendEvent(ev)`, add `if (ev.type === "interaction") interactionCount += 1;`.
- Add `fireInteraction(data)` to the returned object:

```js
function fireInteraction(data) {
  const ev = interactionEvent(sessionId, data);
  appendEvent(ev);
  return ev;
}
```

- Include `interactionCount` in `getStatus()`.

### A.6 capture/main.js: wire the recorder

Add module-level `let recorder = null;` and `let recorderRestartCount = 0;`.

In `startSession()`, after the OBS block and the tracker start:

```js
if (config.interactions && config.interactions.enabled) {
  await startRecorderForSession();
}
```

Add `startRecorderForSession()` near the OBS helpers:

```js
async function startRecorderForSession() {
  try {
    recorder = require("./recorder.js").spawnRecorder({
      sessionId: session.sessionId,
      onEvent: (data) => tracker.fireInteraction(data),
      onWarning: (w) => bootLog(`[recorder] ${w.msg || ""}: ${w.detail || ""}`),
      onStats: (s) => bootLog(`[recorder.stats] queued=${s.queued} dropped=${s.dropped_total} emitted=${s.emitted_total}`),
      onExit: (info) => handleRecorderExit(info),
      bootLog,
    });
    tracker.fireSystem("recorder_start");
    recorderRestartCount = 0;
  } catch (e) {
    bootLog(`recorder spawn failed: ${e && e.message}`);
    if (config.interactions.required) {
      dialog.showErrorBox(
        "Interaction recorder unavailable",
        `${e && e.message}\n\nPer session config the recorder is required.`
      );
      return false;
    }
  }
  return true;
}

function handleRecorderExit(info) {
  if (!tracker) return;
  tracker.fireSystem("recorder_died", {
    code: info.code, signal: info.signal, restart_count: recorderRestartCount,
  });
  recorder = null;
  if (
    config.interactions &&
    config.interactions.auto_restart &&
    recorderRestartCount < (config.interactions.max_restarts_per_session || 3)
  ) {
    recorderRestartCount += 1;
    setTimeout(() => startRecorderForSession(), 5000);
  } else {
    tracker.fireSystem("recorder_dead_permanent");
  }
}
```

In `endSession()`, before `tracker.stop()`:

```js
if (recorder) {
  tracker.fireSystem("recorder_stop");
  try { await recorder.stop({ drainTimeoutMs: 1500 }); } catch (_e) {}
  recorder = null;
}
```

In `pauseTracker()` / `resumeTracker()` (or wherever pause is invoked):

```js
if (recorder) { paused ? recorder.pause() : recorder.resume(); }
```

In `before-quit`, ensure `recorder.stop()` runs.

Status line in tray: include `recorder OFF` indicator when `recorder === null` mid-session.

### A.7 config.js: add `interactions` block

In `capture/config.js` `DEFAULTS`:

```js
interactions: {
  enabled: true,
  required: false,
  auto_restart: true,
  max_restarts_per_session: 3,
  exclude_processes: [],
},
```

In `capture/sample-config.yaml`:

```yaml
# Interaction recording (UIA event subscription via C# sidecar)
interactions:
  enabled: true
  required: false
  auto_restart: true
  max_restarts_per_session: 3
  exclude_processes: []
```

### A.8 SCHEMA.md: add `interaction` event type

In `shared/SCHEMA.md`, add after the `system` event section:

```markdown
### `interaction` data

Sourced from Windows UI Automation via the C# sidecar recorder. See `docs/interaction-recorder.md`.

| Field | Type | Notes |
|---|---|---|
| `kind` | string | `invoked` \| `selection_changed` \| `value_changed` \| `toggle_changed` \| `text_changed` \| `focus_changed` |
| `control_type` | string | e.g. `Button`, `Edit`, `ListItem` |
| `automation_id` | string | Developer-assigned ID |
| `name` | string | Visible label |
| `class_name` | string | Win32 class name |
| `framework_id` | string | `Win32`, `WinForm`, `WPF`, `XAML`, `Chrome`, others |
| `window_title` | string | Top-level window title |
| `process_name` | string | Owning process .exe name |
| `pid` | int | Owning process PID |
| `selected_value` | string | `selection_changed` only |
| `toggle_state` | string | `toggle_changed` only - `on` \| `off` \| `indeterminate` |
| `value` | string | `value_changed` only, length-clamped to 256 chars |

Fields are omitted (not nulled) when the underlying UIA property throws on access.
```

Add to the `system` kinds list: `recorder_start`, `recorder_stop`, `recorder_died`, `recorder_dead_permanent`.

Add to the kind-specific payloads table:

```markdown
| `recorder_start` / `recorder_stop` / `recorder_dead_permanent` | (empty) |
| `recorder_died` | `{ code, signal, restart_count }` |
```

### A.9 Status window + operator panel

Add to `capture/status-window.js` rendering:

- A "Recorder" pill showing one of: `off`, `on`, `paused`, `dead`.
- An `interactionCount` counter alongside event/marker/screenshot.

Wire from `pdt:status` IPC handler in main.js:

```js
recorder_state: recorder ? (paused ? "paused" : "on") : (config.interactions.enabled ? "off" : "disabled"),
interactionCount: lastStatus.interactionCount || 0,
```

Add to `capture/operator-panel.js` the same recorder pill in the header strip.

### A.10 Acceptance gate for phase A

```powershell
# Build
cd capture
npm run build:recorder
# verify dist
dir recorder\publish\recorder.exe

# Standalone smoke
.\recorder\publish\recorder.exe
# (in another window: click around in Notepad)
# verify NDJSON lines flow to stdout, including a `ready` event,
# `interaction` events, and `stats` every 30s

# Integrated smoke
cd ..
npm start
# (in tray: Start session)
# (click around)
# (End session)
# inspect events.jsonl in the session folder:
type "%APPDATA%\process-discovery-tracker\sessions\default\<timestamp>\events.jsonl" | findstr interaction
# should show at least 5 interaction events with non-empty `name` or `automation_id`

# Packaged smoke
npm run package
# the produced exe at dist\Process Discovery Tracker-win32-x64\
# should run and produce interactions identically
```

Gate passes when: `recorder.exe` builds; standalone produces NDJSON; integrated session produces `interaction` events in `events.jsonl`; packaged build includes `resources\recorder\recorder.exe`.

---

## Phase B: Step Entity + Auto-Suggestion + Step Editor

### B.1 annotations.json schema extension

Update `shared/SCHEMA.md` "Annotation file" section to include the full shape from `annotation-model.md` §3.4:

```json
{
  "version": 1,
  "session_id": "uuid",
  "steps": [],
  "phases": [],
  "annotations": [],
  "marker_edits": [],
  "notes": [],
  "matched_against": null,
  "last_modified": null,
  "last_modified_by": null
}
```

Existing `notes` and `marker_edits` arrays continue to work as before. New top-level keys `steps`, `phases`, `annotations`, `matched_against` are additive.

### B.2 Step entity shape

Per `annotation-model.md` §3.2. Authoritative shape in code:

```json
{
  "step_id": "uuid",
  "session_id": "uuid",
  "case_id": "uuid or null",
  "name": "string",
  "description": "string",
  "time_range": { "start": "iso", "end": "iso" },
  "evidence": {
    "interaction_event_ids": ["uuid"],
    "screenshot_refs": ["screenshots/file.jpg"],
    "video_timecode_range": [seconds_start, seconds_end],
    "manual_notes": "string"
  },
  "state": "auto_suggested|auto_matched|manually_authored|edited",
  "canonical_step_id": "uuid or null",
  "flags": {
    "conditional": false,
    "condition_text": null,
    "exception_path": false,
    "waste": false,
    "automation_candidate": false
  },
  "phase_id": "uuid or null"
}
```

### B.3 Auto-suggestion pass in normalization

Create `normalization/step_suggest.py`:

```python
"""Auto-suggest steps from interaction events when no canonical set
exists or no canonical match fires. See annotation-model.md §4.1.
"""

from __future__ import annotations
import uuid
from typing import Any
from datetime import datetime


def parse_ts(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def auto_suggest_steps(
    events: list[dict[str, Any]],
    *,
    step_split_idle_ms: int = 3000,
    step_max_interactions: int = 12,
    step_min_interactions: int = 2,
    step_max_idle_ms: int = 5000,
    session_id: str = "",
) -> list[dict[str, Any]]:
    """Walk interaction events in time order within each case. Produce
    auto_suggested steps per the algorithm in annotation-model.md §4.1.
    """
    # Group by top-level case (first case_id in case_ids list, or None)
    by_case: dict[str | None, list[dict[str, Any]]] = {}
    for ev in events:
        if ev.get("type") != "interaction":
            continue
        cids = ev.get("data", {}).get("case_ids") or []
        top = cids[-1] if cids else None
        by_case.setdefault(top, []).append(ev)

    steps: list[dict[str, Any]] = []
    for case_id, case_events in by_case.items():
        case_events.sort(key=lambda e: e["timestamp"])
        candidate: list[dict[str, Any]] = []
        last_ts: datetime | None = None
        last_window: str | None = None
        last_process: str | None = None

        def flush():
            if len(candidate) < step_min_interactions:
                candidate.clear()
                return
            first = parse_ts(candidate[0]["timestamp"])
            last = parse_ts(candidate[-1]["timestamp"])
            steps.append({
                "step_id": str(uuid.uuid4()),
                "session_id": session_id,
                "case_id": case_id,
                "name": _default_step_name(candidate),
                "description": "",
                "time_range": {
                    "start": candidate[0]["timestamp"],
                    "end": candidate[-1]["timestamp"],
                },
                "evidence": {
                    "interaction_event_ids": [ev["event_id"] for ev in candidate],
                    "screenshot_refs": [],
                    "video_timecode_range": None,
                    "manual_notes": "",
                },
                "state": "auto_suggested",
                "canonical_step_id": None,
                "flags": {
                    "conditional": False, "condition_text": None,
                    "exception_path": False, "waste": False,
                    "automation_candidate": False,
                },
                "phase_id": None,
            })
            candidate.clear()

        for ev in case_events:
            data = ev["data"]
            ts = parse_ts(ev["timestamp"])
            window = data.get("window_title") or ""
            proc = data.get("process_name") or ""
            split = False
            if candidate:
                gap_ms = (ts - last_ts).total_seconds() * 1000
                if gap_ms > step_split_idle_ms: split = True
                elif window != last_window: split = True
                elif proc != last_process: split = True
                elif len(candidate) >= step_max_interactions: split = True
            if split:
                flush()
            candidate.append(ev)
            last_ts = ts
            last_window = window
            last_process = proc
        flush()

    return steps


def _default_step_name(interactions: list[dict[str, Any]]) -> str:
    last = interactions[-1]["data"]
    window = last.get("window_title") or ""
    if last.get("kind") == "invoked" and last.get("name"):
        return f"{window}: {last['name']}".strip(": ")
    # build a brief summary
    kinds = [i["data"].get("kind") for i in interactions]
    if all(k == "value_changed" for k in kinds):
        return f"{window}: Fill {len(interactions)} fields"
    return f"{window}: {len(interactions)} actions"
```

### B.4 Integrate into normalize.py

In `normalization/normalize.py`, after the case-stamping step and before classification (or after, either works):

```python
from step_suggest import auto_suggest_steps

# ... after case_ids are stamped ...

# Step auto-suggestion: only fires when no canonical set is in use.
# Canonical matching (phase C) will overwrite or supplement this.
existing_anno = load_annotations(session_folder)
canonical_in_use = bool(existing_anno.get("matched_against", {}).get("canonical_process_id"))
if not canonical_in_use:
    auto_steps = auto_suggest_steps(
        edited,  # event list after marker edits applied
        session_id=manifest.get("session_id", ""),
    )
    # Merge with any analyst-authored steps in the existing annotations
    merged_steps = _merge_steps(existing_anno.get("steps", []), auto_steps)
    existing_anno["steps"] = merged_steps
    existing_anno["version"] = 1
    existing_anno["session_id"] = manifest.get("session_id", "")
    write_annotations(session_folder, existing_anno)
```

Add `load_annotations` and `write_annotations` helpers, and `_merge_steps`:

```python
def write_annotations(session_folder: Path, anno: dict) -> None:
    anno["last_modified"] = datetime.now(timezone.utc).isoformat()
    with open(session_folder / "annotations.json", "w", encoding="utf-8") as f:
        json.dump(anno, f, indent=2)


def _merge_steps(existing: list, fresh: list) -> list:
    """Preserve manually_authored and edited steps. Replace auto_*
    steps with the latest fresh suggestions only if their case has any
    fresh suggestions (otherwise leave the prior auto_suggested in place
    so the analyst doesn't lose context on a partial re-run)."""
    by_state = {"manually_authored": [], "edited": []}
    for s in existing:
        st = s.get("state")
        if st in by_state:
            by_state[st].append(s)
    return by_state["manually_authored"] + by_state["edited"] + fresh
```

### B.5 stats.json: emit step counts

Add to `normalize.py` meta block:

```python
"step_count": len(merged_steps),
"step_state_breakdown": {
    "auto_suggested": sum(1 for s in merged_steps if s["state"] == "auto_suggested"),
    "auto_matched":   sum(1 for s in merged_steps if s["state"] == "auto_matched"),
    "manually_authored": sum(1 for s in merged_steps if s["state"] == "manually_authored"),
    "edited":         sum(1 for s in merged_steps if s["state"] == "edited"),
},
```

### B.6 Viewer: level switcher

In `viewer/index.html`, add to the session view header above the timeline:

```html
<div class="level-switcher">
  <button class="level-btn active" data-level="flow">Flow</button>
  <button class="level-btn" data-level="steps">Steps</button>
  <button class="level-btn" data-level="phases">Phases</button>
</div>
```

In `viewer/renderer.js`, wire the buttons to call `setLevel(name)` which:

- Hides/shows the appropriate timeline layer
- Hides/shows the annotation panel for the current level
- Updates the legend

### B.7 Viewer: step editor

Create `viewer/step-editor.js`:

```js
"use strict";

(function () {
  function renderStepList(host, steps, selectedId, onSelect) {
    host.innerHTML = "";
    if (!steps.length) {
      host.innerHTML = '<p class="hint">No steps yet. Run normalization or right-click the timeline to add a manual step.</p>';
      return;
    }
    for (const s of steps) {
      const row = document.createElement("div");
      row.className = "step-row" + (s.step_id === selectedId ? " selected" : "");
      row.dataset.stepId = s.step_id;
      row.innerHTML = `
        <span class="state-icon state-${escapeAttr(s.state)}" title="${s.state}"></span>
        <span class="step-name">${escapeHtml(s.name)}</span>
        <span class="step-time">${formatTimeRange(s.time_range)}</span>
      `;
      row.addEventListener("click", () => onSelect(s.step_id));
      host.appendChild(row);
    }
  }

  function renderStepDetail(host, step, callbacks) {
    if (!step) {
      host.innerHTML = '<p class="hint">Select a step to edit.</p>';
      return;
    }
    host.innerHTML = `
      <label>Name <input type="text" id="step-name" value="${escapeAttr(step.name)}"></label>
      <label>Description <textarea id="step-desc">${escapeHtml(step.description || "")}</textarea></label>
      <div class="flags">
        <label><input type="checkbox" id="flag-conditional" ${step.flags.conditional ? "checked" : ""}> Conditional</label>
        <label><input type="checkbox" id="flag-exception" ${step.flags.exception_path ? "checked" : ""}> Exception path</label>
        <label><input type="checkbox" id="flag-waste" ${step.flags.waste ? "checked" : ""}> Waste</label>
        <label><input type="checkbox" id="flag-auto" ${step.flags.automation_candidate ? "checked" : ""}> Automation candidate</label>
      </div>
      <div class="evidence">
        <p>${step.evidence.interaction_event_ids.length} interactions</p>
        <p>${(step.evidence.screenshot_refs || []).length} screenshots</p>
      </div>
      <div class="actions">
        <button id="btn-step-save" class="primary">Save</button>
        <button id="btn-step-delete" class="danger">Delete</button>
      </div>`;
    document.getElementById("btn-step-save").addEventListener("click", () => {
      callbacks.onSave({
        ...step,
        name: document.getElementById("step-name").value.trim(),
        description: document.getElementById("step-desc").value.trim(),
        flags: {
          ...step.flags,
          conditional: document.getElementById("flag-conditional").checked,
          exception_path: document.getElementById("flag-exception").checked,
          waste: document.getElementById("flag-waste").checked,
          automation_candidate: document.getElementById("flag-auto").checked,
        },
        state: step.state === "manually_authored" ? "manually_authored" : "edited",
      });
    });
    document.getElementById("btn-step-delete").addEventListener("click", () =>
      callbacks.onDelete(step.step_id));
  }

  function renderStepTimeline(host, steps, interactions, span) {
    // Color-stable palette per step name within session
    // Draw blocks for each step, ticks for interactions inside
    // (full implementation - dimensions match flow-level timeline)
  }

  function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
  function escapeAttr(s) { return escapeHtml(s); }
  function formatTimeRange(tr) {
    return `${tr.start.slice(11,19)} - ${tr.end.slice(11,19)}`;
  }

  window.PdtSteps = { renderStepList, renderStepDetail, renderStepTimeline };
})();
```

In `viewer/index.html` add `<script src="step-editor.js"></script>` before renderer.js.

In `viewer/renderer.js`, add IPC integration:

```js
async function saveStep(updatedStep) {
  if (!currentSession) return;
  const anno = currentSession.annotations || { steps: [], phases: [], notes: [], marker_edits: [] };
  anno.steps = anno.steps || [];
  const idx = anno.steps.findIndex(s => s.step_id === updatedStep.step_id);
  if (idx >= 0) anno.steps[idx] = updatedStep;
  else anno.steps.push(updatedStep);
  await ipcRenderer.invoke("viewer:saveAnnotations", {
    sessionFolder: currentSession.sessionFolder,
    annotations: anno,
  });
  currentSession.annotations = anno;
  renderStepsView();
}

async function deleteStep(stepId) {
  if (!currentSession) return;
  if (!confirm("Delete this step?")) return;
  const anno = currentSession.annotations || { steps: [] };
  anno.steps = (anno.steps || []).filter(s => s.step_id !== stepId);
  await ipcRenderer.invoke("viewer:saveAnnotations", {
    sessionFolder: currentSession.sessionFolder,
    annotations: anno,
  });
  currentSession.annotations = anno;
  renderStepsView();
}
```

Add right-click handler on the steps timeline for "Split here" / "Add manual step" / "Merge with next."

Add keyboard handlers per `annotation-model.md` §6.2: `Tab` accept name, `Enter` commit edit, `J`/`K` navigate, `M` merge, `S` split, `N` add manual.

### B.8 Acceptance gate for phase B

```powershell
# Run normalization against a captured session with interaction events
cd dist\viewer\resources\python
.\python.exe ..\normalization\normalize.py "<session_folder>" --taxonomy ..\normalization\sample-taxonomy.yaml

# Inspect annotations.json
type "<session_folder>\annotations.json"
# Should contain a `steps` array with at least one auto_suggested step

# Open the viewer, load the session, switch to Steps level
# - Step list populates on the left
# - Click a step, edit name, save - state changes to "edited"
# - Right-click timeline, add manual step - state is "manually_authored"
# - Delete a step - persists across reload
```

Gate passes when: normalization produces steps; viewer renders the list and detail; edits persist to annotations.json; manual steps can be added; J/K/Tab/Enter/M/S/N shortcuts work.

---

## Phase C: Canonical Step Sets + Matching Layer

### C.1 Canonical YAML location and shape

Conventionally lives in a Git repo separate from this tool, but for v1 store under `normalization/canonical/` for the default path.

`normalization/canonical/sample-customer-onboarding-v3.yaml` (example only - real canonical sets are team-authored):

```yaml
canonical_process:
  id: "customer-onboarding-v3"
  name: "Customer Onboarding"
  version: 7
  owners: ["tooling-lead@team"]

  phases:
    - phase_id: "validate"
      name: "Validate customer"
      step_ids: ["check-crm", "credit-check", "kyc-verify"]

  steps:
    - step_id: "check-crm"
      name: "Check existing customer record"
      description: "..."
      match:
        - process_name: "chrome.exe"
          window_title_regex: ".*Salesforce.*Search.*"
          interaction:
            control_type: "Edit"
            automation_id: "searchInput"
          end_when:
            interaction:
              control_type: "Button"
              name: "Search"
    # ...
```

### C.2 Matching layer

Create `normalization/canonical_match.py`:

```python
"""Match captured interactions against a canonical step set. Produces
auto_matched steps per annotation-model.md §3.5.
"""

from __future__ import annotations
import re
import uuid
from typing import Any
import yaml


def load_canonical(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f).get("canonical_process", {})


def _interaction_matches(rule: dict, ev: dict) -> bool:
    """Check whether one match rule fires on a single interaction event."""
    data = ev.get("data", {})
    pn = rule.get("process_name")
    if pn and data.get("process_name") != pn:
        return False
    wtr = rule.get("window_title_regex")
    if wtr and not re.search(wtr, data.get("window_title") or ""):
        return False
    irule = rule.get("interaction")
    if irule:
        for k in ("control_type", "automation_id", "name"):
            if k in irule and data.get(k) != irule[k]:
                return False
    return True


def match_canonical(
    events: list[dict[str, Any]],
    canonical: dict[str, Any],
    *,
    session_id: str = "",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Walk interaction events in time order. Assign each to the first
    canonical step whose match rules fire. Group contiguous interactions
    sharing the same canonical_step_id into one step. Honors `end_when`
    when present to close a step explicitly.

    Returns (steps, unmatched_interactions).
    """
    cstep_defs = {s["step_id"]: s for s in canonical.get("steps", [])}
    order = [s["step_id"] for s in canonical.get("steps", [])]

    # Sort interactions in time order, keep only those with case_ids
    interactions = [
        e for e in events
        if e.get("type") == "interaction"
    ]
    interactions.sort(key=lambda e: e["timestamp"])

    steps: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    open_step = None  # { step_id, canonical_step_id, events, end_when_rule }

    def close_open():
        nonlocal open_step
        if not open_step or not open_step["events"]:
            open_step = None
            return
        evs = open_step["events"]
        cdef = cstep_defs[open_step["canonical_step_id"]]
        cids = evs[0]["data"].get("case_ids") or []
        steps.append({
            "step_id": str(uuid.uuid4()),
            "session_id": session_id,
            "case_id": (cids[-1] if cids else None),
            "name": cdef.get("name") or open_step["canonical_step_id"],
            "description": cdef.get("description", ""),
            "time_range": {
                "start": evs[0]["timestamp"],
                "end": evs[-1]["timestamp"],
            },
            "evidence": {
                "interaction_event_ids": [e["event_id"] for e in evs],
                "screenshot_refs": [],
                "video_timecode_range": None,
                "manual_notes": "",
            },
            "state": "auto_matched",
            "canonical_step_id": open_step["canonical_step_id"],
            "flags": {
                "conditional": False, "condition_text": None,
                "exception_path": False, "waste": False,
                "automation_candidate": False,
            },
            "phase_id": None,
        })
        open_step = None

    for ev in interactions:
        # Did the open step's end_when fire?
        if open_step and open_step.get("end_when_rule") and _interaction_matches(
            open_step["end_when_rule"], ev
        ):
            open_step["events"].append(ev)
            close_open()
            continue

        # Find canonical step
        matched_step_id = None
        matched_rule = None
        end_when = None
        for sid in order:
            for rule in cstep_defs[sid].get("match", []):
                if _interaction_matches(rule, ev):
                    matched_step_id = sid
                    matched_rule = rule
                    end_when = rule.get("end_when")
                    break
            if matched_step_id:
                break

        if matched_step_id is None:
            unmatched.append(ev)
            continue

        if open_step and open_step["canonical_step_id"] == matched_step_id:
            open_step["events"].append(ev)
        else:
            close_open()
            open_step = {
                "step_id": str(uuid.uuid4()),
                "canonical_step_id": matched_step_id,
                "events": [ev],
                "end_when_rule": end_when,
            }
    close_open()

    return steps, unmatched
```

### C.3 Wire into normalize.py

Replace the step-suggestion branch:

```python
canonical_path = args.canonical or None  # CLI flag added next
canonical = None
if canonical_path:
    from canonical_match import load_canonical
    canonical = load_canonical(canonical_path)
    existing_anno["matched_against"] = {
        "canonical_process_id": canonical.get("id"),
        "canonical_version": canonical.get("version"),
    }

if canonical:
    from canonical_match import match_canonical
    matched_steps, unmatched_interactions = match_canonical(
        edited, canonical, session_id=manifest.get("session_id", "")
    )
    if unmatched_interactions:
        # Fall back to auto-suggestion over unmatched interactions
        fallback = auto_suggest_steps(
            unmatched_interactions,
            session_id=manifest.get("session_id", ""),
        )
        merged_steps = _merge_steps(
            existing_anno.get("steps", []),
            matched_steps + fallback
        )
    else:
        merged_steps = _merge_steps(existing_anno.get("steps", []), matched_steps)
else:
    auto_steps = auto_suggest_steps(edited, session_id=manifest.get("session_id", ""))
    merged_steps = _merge_steps(existing_anno.get("steps", []), auto_steps)

existing_anno["steps"] = merged_steps
```

Add CLI argument:

```python
parser.add_argument("--canonical", type=str, default=None,
                    help="Path to canonical step set YAML.")
```

### C.4 Drift detection

Add to `_merge_steps` logic: when a step's `canonical_step_id` differs in `existing` vs `fresh` (analyst-edited step now maps to a different canonical step), emit a `drift_marker` entry into a new top-level array `existing_anno["drift_markers"]`:

```python
{
  "marker_id": "uuid",
  "kind": "canonical_drift",
  "step_id": "<existing_step_id>",
  "previous_canonical_step_id": "<old>",
  "new_canonical_step_id": "<new>",
  "ts": "iso"
}
```

Viewer surfaces these in the step editor with a "Drift detected" indicator (see G).

### C.5 Canonical authoring view

Create `viewer/canonical-author.html` (or fold into index.html as a third tab next to Session and Aggregate).

Recommended: third top-level tab `Canonical`. Layout:

```html
<section class="view" id="view-canonical">
  <div class="actions-bar">
    <button id="btn-open-canonical">Open canonical YAML...</button>
    <button id="btn-save-canonical" disabled>Save changes</button>
    <button id="btn-promote-from-exemplar" disabled>Promote selected steps from exemplar</button>
    <span class="flex-spacer"></span>
    <span class="meta" id="canonical-meta"></span>
  </div>
  <div class="canonical-grid">
    <div class="panel">
      <h3>Canonical steps</h3>
      <div id="canonical-step-list"></div>
    </div>
    <div class="panel">
      <h3>Step rules (YAML)</h3>
      <textarea id="canonical-yaml" spellcheck="false"></textarea>
    </div>
    <div class="panel">
      <h3>Exemplar session</h3>
      <button id="btn-load-exemplar">Load exemplar session...</button>
      <div id="exemplar-events"></div>
      <p class="meta" id="exemplar-match-rate"></p>
    </div>
  </div>
</section>
```

Add to `viewer/main.js`:

```js
ipcMain.handle("viewer:openCanonicalFile", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Open canonical YAML",
    properties: ["openFile"],
    filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return { path: r.filePaths[0], content: fs.readFileSync(r.filePaths[0], "utf-8") };
});

ipcMain.handle("viewer:saveCanonicalFile", (_e, { path: p, content }) => {
  fs.writeFileSync(p, content, "utf-8");
  return { path: p };
});

ipcMain.handle("viewer:testCanonicalMatch", async (_e, { canonicalPath, sessionFolder }) => {
  // Spawn normalize.py with --canonical against the exemplar session,
  // capture the match summary from stats.json, return.
  // (Implementation: same spawn pattern as runNormalize.)
});
```

Add IPC dispatchers and the `Canonical` tab in renderer.js mirroring the session/aggregate patterns.

### C.6 Aggregate view: step-level mode

In `viewer/index.html`, add a level switcher to the aggregate view:

```html
<div class="agg-level-switcher">
  <button class="agg-level-btn active" data-level="flow">Flow</button>
  <button class="agg-level-btn" data-level="steps">Steps</button>
  <button class="agg-level-btn" data-level="phases">Phases</button>
</div>
```

When `steps` is active:

- Show a canonical step map (constructed from the canonical YAML's step order, not mined). Each node is a canonical step.
- Click a node: show source cases. Drill: open session view at that step.
- Per-step statistics panel: duration distribution, frequency, waste rate, automation-candidate rate.
- "Drift diagnostic" panel showing match rate across loaded sessions for this canonical version.

The step-level aggregate only enables when all loaded sessions are matched against the same `matched_against.canonical_process_id`. Otherwise, show a warning.

### C.7 Acceptance gate for phase C

```powershell
# Author a small canonical YAML, e.g. normalization/canonical/test-process.yaml
# Capture two sessions of the same process.
# Run normalization with --canonical:
.\python.exe normalize.py "<session_folder_1>" --canonical canonical\test-process.yaml --mine
.\python.exe normalize.py "<session_folder_2>" --canonical canonical\test-process.yaml --mine

# Verify annotations.json contains:
# - matched_against.canonical_process_id and canonical_version
# - steps with state == "auto_matched"
# - non-empty drift_markers if a step was previously edited

# Open the viewer, load both sessions in Aggregate, switch to Steps level
# - Step-level map renders
# - Click a step: source cases listed
# - Drill into one: session view opens at that step's time range
# - "Match rate" indicator shows percentage
```

Gate passes when: canonical matching produces `auto_matched` steps; viewer renders the step-level aggregate; drift markers fire when canonical changes.

---

## Phase D: Phase Entity

### D.1 Phase entity shape

Per `annotation-model.md` §3.3.

```json
{
  "phase_id": "uuid",
  "session_id": "uuid",
  "case_id": "uuid",
  "name": "Validate customer",
  "description": "",
  "step_ids": ["uuid", "uuid"],
  "state": "manually_authored|auto_matched|edited",
  "canonical_phase_id": "uuid or null"
}
```

Phases have no `time_range` of their own - the viewer derives it from the union of contained steps.

### D.2 Phase rollup from canonical

Extend `canonical_match.py`:

```python
def rollup_phases(
    canonical: dict,
    steps: list[dict],
    session_id: str = "",
) -> list[dict]:
    """For each canonical phase definition, build a phase containing the
    matched steps whose canonical_step_id is in the phase's step_ids list.
    """
    cphases = canonical.get("phases", []) or []
    phases = []
    for cp in cphases:
        target_step_ids = set(cp.get("step_ids", []))
        contained = [
            s for s in steps
            if s.get("canonical_step_id") in target_step_ids
        ]
        if not contained:
            continue
        phases.append({
            "phase_id": str(uuid.uuid4()),
            "session_id": session_id,
            "case_id": contained[0].get("case_id"),
            "name": cp.get("name") or cp.get("phase_id"),
            "description": cp.get("description", ""),
            "step_ids": [s["step_id"] for s in contained],
            "state": "auto_matched",
            "canonical_phase_id": cp.get("phase_id"),
        })
    return phases
```

In `normalize.py`, after canonical step matching:

```python
if canonical:
    auto_phases = rollup_phases(canonical, matched_steps,
                                 session_id=manifest.get("session_id", ""))
    existing_anno["phases"] = _merge_phases(existing_anno.get("phases", []), auto_phases)
```

`_merge_phases` mirrors `_merge_steps` - preserve manually_authored and edited phases.

Set `step.phase_id` for every step that's contained in a phase.

### D.3 Phase editor in viewer

Add to `viewer/step-editor.js` (or create `viewer/phase-editor.js`):

```js
function renderPhaseList(host, phases, selectedId, onSelect) { /* mirrors step list */ }
function renderPhaseDetail(host, phase, steps, callbacks) {
  // editable name, description, ordered list of contained steps (draggable),
  // "Remove from phase" per step, save / delete buttons
}
function renderPhaseTimeline(host, phases, steps, span) {
  // bands spanning contained steps' time_range union, color by phase name
}
```

Wire `Phases` level to render these.

### D.4 Drag interactions for phases

Per `annotation-model.md` §6.3:

- Drag-select multiple steps in Steps level: "Group into phase" button appears in the action bar; clicking creates a new phase with those steps and prompts for a name.
- Drag a step row in the phase detail panel from one phase's list to another.
- Right-click a phase boundary on the timeline: "Split phase here" creates two phases at the boundary.

### D.5 Aggregate phase-level mode

When `phases` level is active in aggregate view:

- Phase-level map: nodes are phases (from the canonical_phase definitions across loaded sessions).
- Edges show inter-phase transitions and frequencies.
- Per-phase duration distribution.
- Drill: click a phase → step-level aggregate filtered to that phase's steps.

### D.6 Acceptance gate for phase D

```powershell
# Canonical YAML with phases (e.g. phases: [{phase_id: validate, step_ids: [...]}])
.\python.exe normalize.py "<session>" --canonical canonical\test-process.yaml --mine

# Inspect annotations.json
# - phases array populated, each with step_ids
# - steps have phase_id set when contained

# Viewer:
# - Phases level shows bands across step ranges
# - Phase editor allows reorder, rename, remove step
# - Manual phase: drag-select steps in Steps level, "Group into phase"
# - Aggregate Phases mode renders the phase-level map
```

Gate passes when: phase rollup happens during canonical matching; phase editor allows authoring; aggregate phase view renders.

---

## Phase E: Three-Mode BPMN Export + PDD Export

### E.1 Step-level BPMN

Create `normalization/bpmn_step.py`:

```python
"""Construct a step-level BPMN from a canonical step set + matched
session data. Each canonical step becomes a task; ordering from
canonical step_ids list; frequencies and average durations annotate
the tasks.
"""

from __future__ import annotations
from typing import Any
import xml.etree.ElementTree as ET


def step_bpmn_from_canonical(canonical: dict, sessions: list[dict]) -> str:
    """Returns BPMN 2.0 XML string. sessions is a list of {steps:[...]}."""
    bpmn_ns = "http://www.omg.org/spec/BPMN/20100524/MODEL"
    di_ns = "http://www.omg.org/spec/BPMN/20100524/DI"
    dc_ns = "http://www.omg.org/spec/DD/20100524/DC"
    ET.register_namespace("", bpmn_ns)
    ET.register_namespace("bpmndi", di_ns)
    ET.register_namespace("dc", dc_ns)

    defs = ET.Element(f"{{{bpmn_ns}}}definitions", {
        "id": "Definitions_1",
        "targetNamespace": "http://process-discovery-tracker/canonical",
    })
    process = ET.SubElement(defs, f"{{{bpmn_ns}}}process", {"id": "Process_1", "isExecutable": "false"})

    # Aggregate per-step stats across sessions
    step_stats = {}  # canonical_step_id -> { count, total_duration_ms }
    for sess in sessions:
        for s in sess.get("steps", []):
            cid = s.get("canonical_step_id")
            if not cid: continue
            entry = step_stats.setdefault(cid, {"count": 0, "total_ms": 0})
            entry["count"] += 1
            start = _parse(s["time_range"]["start"])
            end = _parse(s["time_range"]["end"])
            entry["total_ms"] += int((end - start).total_seconds() * 1000)

    # Build flowing tasks per canonical step
    start_event = ET.SubElement(process, f"{{{bpmn_ns}}}startEvent", {"id": "StartEvent_1"})
    prev_id = "StartEvent_1"
    for cstep in canonical.get("steps", []):
        sid = cstep["step_id"]
        stats = step_stats.get(sid, {"count": 0, "total_ms": 0})
        avg_ms = stats["total_ms"] // stats["count"] if stats["count"] else 0
        task = ET.SubElement(process, f"{{{bpmn_ns}}}task", {
            "id": f"Task_{sid}",
            "name": f"{cstep['name']} (n={stats['count']}, avg={_fmt_ms(avg_ms)})",
        })
        flow = ET.SubElement(process, f"{{{bpmn_ns}}}sequenceFlow", {
            "id": f"Flow_{prev_id}_{sid}",
            "sourceRef": prev_id, "targetRef": f"Task_{sid}",
        })
        prev_id = f"Task_{sid}"
    end_event = ET.SubElement(process, f"{{{bpmn_ns}}}endEvent", {"id": "EndEvent_1"})
    ET.SubElement(process, f"{{{bpmn_ns}}}sequenceFlow", {
        "id": "Flow_to_end", "sourceRef": prev_id, "targetRef": "EndEvent_1",
    })

    return ET.tostring(defs, encoding="unicode", xml_declaration=True)


def _parse(ts):
    from datetime import datetime
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))

def _fmt_ms(ms):
    if ms < 1000: return f"{ms}ms"
    s = ms // 1000
    if s < 60: return f"{s}s"
    return f"{s // 60}m{s % 60}s"
```

### E.2 Phase-level BPMN (collapsible sub-processes)

Create `normalization/bpmn_phase.py`:

```python
"""Phase-level BPMN: each canonical phase is a sub-process containing
its constituent steps as tasks. BPMN sub-processes render collapsible
in Adonis.
"""

def phase_bpmn_from_canonical(canonical: dict, sessions: list[dict]) -> str:
    # similar structure to step_bpmn_from_canonical but wraps tasks in
    # <subProcess> elements per phase.
    # ...
```

Pre-validate against Adonis early in this phase: run a sample export through Adonis to confirm the collapsible sub-process behavior. If Adonis doesn't honor collapsibility, ship two separate exports.

### E.3 PDD .docx export

Create `normalization/pdd_export.py`:

```python
"""Generate a Process Definition Document .docx from a session +
canonical step set. Uses python-docx. Mirrors the team's existing
PDD format.
"""

from __future__ import annotations
from pathlib import Path
from docx import Document
from docx.shared import Pt, Inches


def write_pdd(
    out_path: Path,
    *,
    session_folder: Path,
    canonical: dict | None,
    annotations: dict,
    stats: dict,
    manifest: dict,
) -> None:
    doc = Document()
    doc.add_heading("Process Definition Document", level=0)
    eng = manifest.get("engagement_id") or "Engagement"
    doc.add_paragraph(f"Engagement: {eng}")
    doc.add_paragraph(f"Worker: {manifest.get('config', {}).get('worker', {}).get('id', '-')}")
    doc.add_paragraph(f"Captured: {manifest.get('started_at', '-')}")

    if canonical:
        doc.add_heading(f"Process: {canonical.get('name', '-')}", level=1)
        doc.add_paragraph(f"Canonical version: {canonical.get('version', '-')}")

    # Phase-by-phase narrative
    for phase in annotations.get("phases", []):
        doc.add_heading(phase["name"], level=2)
        if phase.get("description"):
            doc.add_paragraph(phase["description"])
        contained_steps = [s for s in annotations.get("steps", [])
                           if s["step_id"] in phase.get("step_ids", [])]
        for step in contained_steps:
            doc.add_heading(step["name"], level=3)
            if step.get("description"):
                doc.add_paragraph(step["description"])
            for ref in step["evidence"].get("screenshot_refs", []):
                full = session_folder / ref
                if full.exists():
                    doc.add_picture(str(full), width=Inches(4.5))
            flags = [k for k, v in step.get("flags", {}).items() if v is True]
            if flags:
                doc.add_paragraph(f"Flags: {', '.join(flags)}").italic = True

    # Statistics table
    if stats and stats.get("activity_stats"):
        doc.add_heading("Activity statistics", level=1)
        table = doc.add_table(rows=1, cols=4)
        hdr = table.rows[0].cells
        hdr[0].text = "Activity"; hdr[1].text = "Frequency"; hdr[2].text = "Total time"; hdr[3].text = "Median"
        for row in stats["activity_stats"][:25]:
            r = table.add_row().cells
            r[0].text = str(row["activity_label"])
            r[1].text = str(row["frequency"])
            r[2].text = _fmt_ms(row.get("total_duration_ms", 0))
            r[3].text = _fmt_ms(row.get("median_ms", 0))

    doc.save(str(out_path))


def _fmt_ms(ms):
    if ms is None: return "-"
    s = ms / 1000
    if s < 60: return f"{s:.1f}s"
    return f"{int(s // 60)}m {int(s % 60)}s"
```

Add to `normalization/requirements.txt`:

```
python-docx>=1.1.0
```

Add CLI flags to `normalize.py`:

```python
parser.add_argument("--pdd-out", type=str, default=None,
                    help="Write PDD .docx to this path.")
parser.add_argument("--step-bpmn-out", type=str, default=None)
parser.add_argument("--phase-bpmn-out", type=str, default=None)
```

### E.4 Step CSV export

Create `normalization/step_csv.py`:

```python
import pandas as pd

def export_step_csv(out_path, annotations, sessions=None):
    rows = []
    for s in annotations.get("steps", []):
        rows.append({
            "step_id": s["step_id"],
            "name": s["name"],
            "state": s["state"],
            "canonical_step_id": s.get("canonical_step_id"),
            "case_id": s.get("case_id"),
            "phase_id": s.get("phase_id"),
            "start": s["time_range"]["start"],
            "end": s["time_range"]["end"],
            "interaction_count": len(s["evidence"].get("interaction_event_ids", [])),
            "waste": s.get("flags", {}).get("waste", False),
            "automation_candidate": s.get("flags", {}).get("automation_candidate", False),
        })
    pd.DataFrame(rows).to_csv(out_path, index=False)
```

### E.5 Viewer integration

Add buttons to aggregate view actions-bar:

```html
<button id="btn-export-bpmn-step">Step BPMN</button>
<button id="btn-export-bpmn-phase">Phase BPMN</button>
<button id="btn-export-pdd">PDD (.docx)</button>
<button id="btn-export-step-csv">Step CSV</button>
```

Each button invokes a corresponding normalize.py call via the existing `runNormalize` IPC pattern, with the new CLI flags. Result file is offered via Save dialog.

### E.6 Acceptance gate for phase E

```powershell
.\python.exe normalize.py "<session>" --canonical canonical\test.yaml --mine --pdd-out out\session.docx --step-bpmn-out out\step.bpmn --phase-bpmn-out out\phase.bpmn

# Verify:
# - out\session.docx opens in Word with phases as H2, steps as H3, screenshots inlined
# - out\step.bpmn imports into Adonis as a task chain
# - out\phase.bpmn imports into Adonis as collapsible sub-processes (CONFIRM in Adonis)
# - Viewer Aggregate buttons produce the same files via the UI
```

Gate passes when: PDD generates valid .docx; step BPMN imports into Adonis; phase BPMN sub-processes render correctly in Adonis (or, if not, two separate exports ship). User Guide regenerated.

---

## Phase F: ML Layer

### F.1 Add ML dependencies

In `normalization/requirements.txt`:

```
sentence-transformers>=2.6,<3.0
onnxruntime>=1.17,<2.0
hdbscan>=0.8.33
scikit-learn>=1.4,<2.0
```

Re-run `scripts/build-python-embeddable.ps1` to refresh `viewer/python/`. Verify total dist size before committing.

### F.2 Embedding pipeline

Create `normalization/ml/embeddings.py`:

```python
"""Sentence-transformer embeddings for (app, window_title, name) triples.
Exports the model to ONNX once at first run; loads ONNX for inference.
"""

from __future__ import annotations
from pathlib import Path
import numpy as np
import onnxruntime as ort

_session: ort.InferenceSession | None = None
_tokenizer = None

MODEL_DIR = Path(__file__).resolve().parent.parent / "ml_models" / "all-MiniLM-L6-v2"


def _ensure_loaded():
    global _session, _tokenizer
    if _session is not None:
        return
    onnx_path = MODEL_DIR / "model.onnx"
    if not onnx_path.exists():
        _export_onnx()
    _session = ort.InferenceSession(
        str(onnx_path),
        providers=["CPUExecutionProvider"],
    )
    from transformers import AutoTokenizer
    _tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR))


def _export_onnx():
    """One-time: export the sentence-transformer model to ONNX. Called
    automatically on first use if the .onnx is missing."""
    from sentence_transformers import SentenceTransformer
    import torch
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    m = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    m.save(str(MODEL_DIR))
    sample = m.tokenize(["sample"])
    torch.onnx.export(
        m._first_module().auto_model,
        (sample["input_ids"], sample["attention_mask"]),
        str(MODEL_DIR / "model.onnx"),
        input_names=["input_ids", "attention_mask"],
        output_names=["last_hidden_state"],
        dynamic_axes={"input_ids": {0: "batch", 1: "seq"},
                      "attention_mask": {0: "batch", 1: "seq"}},
        opset_version=17,
    )


def embed(texts: list[str]) -> np.ndarray:
    """Return (N, 384) array of normalized embeddings."""
    _ensure_loaded()
    enc = _tokenizer(texts, padding=True, truncation=True, max_length=128,
                     return_tensors="np")
    out = _session.run(None, {
        "input_ids": enc["input_ids"].astype(np.int64),
        "attention_mask": enc["attention_mask"].astype(np.int64),
    })[0]
    # Mean pool with attention mask
    mask = enc["attention_mask"][:, :, None].astype(np.float32)
    summed = (out * mask).sum(axis=1)
    counts = mask.sum(axis=1).clip(min=1)
    mean = summed / counts
    norms = np.linalg.norm(mean, axis=1, keepdims=True).clip(min=1e-9)
    return mean / norms


def event_text(ev: dict) -> str:
    """Canonical text representation of an event for embedding."""
    d = ev.get("data", {})
    app = d.get("app") or d.get("process_name") or ""
    title = d.get("title") or d.get("window_title") or ""
    name = d.get("name") or ""
    label = d.get("activity_label") or ""
    return " | ".join(filter(None, [app, title, name, label]))
```

### F.3 Classifier

Create `normalization/ml/classifier.py`:

```python
"""Per-team classifier trained on the central taxonomy's existing rules.
Predicts activity_label for events that no regex rule matched.
"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import joblib
import numpy as np
import yaml

from .embeddings import embed

CLASSIFIER_PATH = Path(__file__).resolve().parent.parent / "ml_models" / "classifier.pkl"


def train_from_taxonomy(taxonomy_path: str, sample_events: list[dict] | None = None) -> None:
    """Train a logistic-regression classifier on (event_text -> label)
    pairs synthesized from the taxonomy rules. Saves to CLASSIFIER_PATH.
    """
    with open(taxonomy_path) as f:
        tax = yaml.safe_load(f)
    rules = tax.get("rules", [])
    texts = []
    labels = []
    for rule in rules:
        m = rule.get("match", {})
        # Synthesize a few text variants per rule
        app = m.get("app", "")
        title_re = m.get("title_regex", "")
        # Strip regex metacharacters to a representative string
        rep = title_re.replace(".*", " ").strip()
        texts.append(f"{app} | {rep}")
        labels.append(rule.get("label"))
    # Optional: augment with sample_events that the analyst has confirmed
    if sample_events:
        for ev in sample_events:
            if ev.get("data", {}).get("activity_label"):
                texts.append(_event_to_text(ev))
                labels.append(ev["data"]["activity_label"])

    X = embed(texts)
    from sklearn.linear_model import LogisticRegression
    clf = LogisticRegression(max_iter=1000, multi_class="multinomial")
    clf.fit(X, labels)
    CLASSIFIER_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(clf, str(CLASSIFIER_PATH))


def predict(texts: list[str], min_confidence: float = 0.55) -> list[tuple[str | None, float]]:
    """Return [(label_or_None, confidence)] for each text. Below
    min_confidence the label is None (caller surfaces as suggestion)."""
    if not CLASSIFIER_PATH.exists():
        return [(None, 0.0)] * len(texts)
    clf = joblib.load(str(CLASSIFIER_PATH))
    X = embed(texts)
    probs = clf.predict_proba(X)
    out = []
    for row in probs:
        i = int(np.argmax(row))
        c = float(row[i])
        out.append((clf.classes_[i] if c >= min_confidence else None, c))
    return out


def _event_to_text(ev): return f"{ev['data'].get('app', '')} | {ev['data'].get('title', '')}"
```

### F.4 Cluster uncovered events

Create `normalization/ml/cluster.py`:

```python
"""Cluster uncovered events for batch labeling using HDBSCAN over
embeddings.
"""

from __future__ import annotations
import hdbscan
import numpy as np
from .embeddings import embed, event_text


def cluster_uncovered(events: list[dict], min_cluster_size: int = 5) -> list[dict]:
    """Return list of clusters: [{ cluster_id, event_ids, sample_text }]."""
    if not events:
        return []
    texts = [event_text(e) for e in events]
    X = embed(texts)
    clusterer = hdbscan.HDBSCAN(min_cluster_size=min_cluster_size, metric="euclidean")
    labels = clusterer.fit_predict(X)
    clusters = {}
    for ev, label in zip(events, labels):
        if label == -1:
            continue
        clusters.setdefault(int(label), []).append(ev)
    out = []
    for cid, evs in clusters.items():
        out.append({
            "cluster_id": cid,
            "event_ids": [e["event_id"] for e in evs],
            "sample_text": event_text(evs[0]),
            "count": len(evs),
        })
    return out
```

### F.5 Wire ML into normalize.py

After classification, before step matching:

```python
# ML pass 1: auto-classify uncovered events
try:
    from ml.classifier import predict as ml_predict
    uncovered = [
        e for e in classified
        if e.get("type") == "activity" and
        (e["data"].get("activity_label") or "").startswith("Unclassified")
    ]
    if uncovered:
        texts = [f"{e['data'].get('app','')} | {e['data'].get('title','')}" for e in uncovered]
        preds = ml_predict(texts, min_confidence=0.55)
        ml_suggestions = []
        for ev, (label, conf) in zip(uncovered, preds):
            if label is not None:
                ml_suggestions.append({
                    "kind": "classification",
                    "event_id": ev["event_id"],
                    "suggested_label": label,
                    "confidence": conf,
                })
        if ml_suggestions:
            _write_ml_suggestions(session_folder, ml_suggestions)
except Exception as e:
    print(f"[normalize] ML pass skipped: {e}")
```

`_write_ml_suggestions` writes to `<session_folder>/ml_suggestions.json`:

```python
def _write_ml_suggestions(session_folder, suggestions):
    out = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "suggestions": suggestions,
    }
    with open(session_folder / "ml_suggestions.json", "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
```

### F.6 Viewer surface for ML suggestions

Add a `ML suggestions` sub-tab in the session view's annotation panel:

```html
<button class="anno-tab" data-anno="ml">ML suggestions <span class="badge" id="ml-badge">0</span></button>
```

Renderer reads `ml_suggestions.json` and renders accept/reject buttons per suggestion. Accept invokes `viewer:promoteTaxonomyRule` (existing) and applies the label.

Add a cluster review modal for batch labeling: opens when the analyst clicks "Cluster review" from the aggregate view, shows clusters with sample event from each, applies one label across all events in the cluster.

### F.7 Classifier retraining hook

Add a CLI command `normalize.py --retrain-classifier`:

```python
if args.retrain_classifier:
    from ml.classifier import train_from_taxonomy
    if not args.taxonomy:
        print("ERROR: --taxonomy required for --retrain-classifier", file=sys.stderr)
        sys.exit(2)
    train_from_taxonomy(args.taxonomy)
    print("Classifier retrained.")
    return
```

Add a viewer button "Retrain classifier" in the Aggregate view actions bar that invokes this.

### F.8 Failure modes

Per `process_discovery_tracker_design updated.md` §10.8:

- ML pass wrapped in `try/except`. On failure, log a warning and continue with rule-based output.
- Per-session ML budget: hard timeout of 5 minutes via a subprocess wrapper (kill on overrun).
- Missing model files: fall back to no-ML normalization, surface a single "ML disabled" log line.

### F.9 Acceptance gate for phase F

```powershell
# One-time classifier training
.\python.exe normalize.py --retrain-classifier --taxonomy normalization\sample-taxonomy.yaml

# Normalize a session
.\python.exe normalize.py "<session>" --taxonomy normalization\sample-taxonomy.yaml --mine

# Verify ml_suggestions.json appears in the session folder with
# at least one suggestion (assuming some events are Unclassified)

# Open the viewer, load the session, switch to ML suggestions sub-tab
# - Suggestions render with confidence scores
# - Accept a suggestion: event re-labels, optionally promotes a new rule
# - Reject: suggestion is removed; classifier next retrain weight on that pattern decreases (out of scope for v1 - mark with a future ticket)

# Aggregate view: "Cluster review" opens the cluster modal with HDBSCAN groups
```

Gate passes when: classifier trains; predictions appear in `ml_suggestions.json`; viewer surfaces them; ML failures don't break the rule-based pipeline.

---

## Phase G: Drift + Polish

### G.1 Drift diagnostic panel

In aggregate view, add a "Drift" sub-tab:

- Match rate over time (line chart, last 90 days of sessions for the loaded canonical).
- Unmatched interaction density per session (sortable table).
- Manual step density per session.
- Canonical version spread (pie chart or bar).

Pull data from each loaded session's `stats.json` meta block (extend the meta to include `match_rate` and `unmatched_interaction_count`).

### G.2 Drift indicators

When a session has a `drift_markers` array (from C.4), the session view shows a "Drift detected" indicator on the affected step rows. Clicking opens a diff modal showing previous vs new canonical assignment.

Aggregate "Drift" sub-tab badges sessions with non-empty `drift_markers`.

### G.3 Re-normalization workflow

Aggregate view: "Re-normalize all to latest canonical" button. Walks every loaded session, runs normalize.py against the current canonical YAML, collects drift markers, surfaces summary modal: "X sessions had drift; review now?"

Acceptance: passes when re-normalize updates auto-matched assignments and produces drift markers without touching edited/manually_authored steps.

### G.4 Version spread alert

When the analyst loads sessions in aggregate spanning multiple canonical versions, show a banner:

```html
<div class="alert">
  Loaded sessions span 3 canonical versions (v5, v6, v7). Statistics may be inconsistent.
  <button id="btn-renormalize-to-latest">Re-normalize all to v7</button>
</div>
```

### G.5 User-Guide updates

Update `docs/build-user-guide.js`:

- Add chapter on Interaction Recording (phase A).
- Add chapter on Steps and Phases (phases B, C, D).
- Add chapter on Exports including PDD and three-mode BPMN.
- Add chapter on ML Suggestions (phase F).
- Update prerequisite list with .NET SDK 8.

Re-run `node docs/build-user-guide.js`. Verify zero em/en-dashes.

### G.6 SECURITY.md update

Add a row to "Process behaviors":

```markdown
| Interaction recording | Subscribes to Windows UI Automation events via the in-box `UIAutomationCore.dll`. Same API used by Narrator, NVDA, Inspect.exe. No `SetWindowsHookEx`, no DLL injection, no keyboard / mouse hooks. C# sidecar runs as a separate process, NDJSON over stdio to the Electron main process. |
```

Update §11 with the recorder.exe and ML models in the bundle:

```markdown
- `recorder/recorder.exe` (~70 MB, .NET 8 self-contained, UIA event subscriber)
- `ml_models/all-MiniLM-L6-v2/` (~90 MB, sentence-transformer embeddings)
- `ml_models/classifier.pkl` (~5 MB, per-team classifier)
```

### G.7 Security-QA update

Add Q to `docs/Security-QA.md`:

```markdown
## 21. Does the interaction recorder install kernel hooks or low-level keyboard hooks?

**No.** Uses Microsoft's in-box UI Automation event API (`AddAutomationEventHandler`, `AddAutomationPropertyChangedEventHandler`, `AddAutomationFocusChangedEventHandler`) from `UIAutomationCore.dll`. Same APIs accessibility tools (Narrator, NVDA) use. No `SetWindowsHookEx`, no `WH_KEYBOARD_LL`, no `WH_MOUSE_LL`, no DLL injection.

## 22. What does the ML layer do? Does it phone home?

**Embeddings + classifier inference, all local.** Sentence-transformer model bundled in the dist, loaded into ONNX runtime, runs on CPU. No network calls. The classifier is trained locally against the team's own taxonomy rules. See `SECURITY.md` §11.
```

### G.8 SBOM regeneration

After all dep changes (Python ML libs, C# recorder via .NET): `node scripts/generate-sbom.js`. Verify CycloneDX output, commit.

### G.9 Distribution rebuild

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-distribution.ps1
```

Verify:
- `dist/capture/win-unpacked/resources/recorder/recorder.exe` present, runs standalone.
- `dist/viewer/win-unpacked/resources/python/Lib/site-packages/sentence_transformers` present.
- `dist/viewer/win-unpacked/resources/normalization/ml/` present.
- `dist/SBOM.json` lists the new dependencies.
- `dist/SECURITY.md`, `dist/Security-QA.md`, `dist/User-Guide.docx` reflect updates.

### G.10 Acceptance gate for phase G

```powershell
# End-to-end against two captured sessions
# 1. Edit a step in session 1 (state=edited)
# 2. Bump the canonical YAML version (change a match rule)
# 3. Re-normalize both sessions against the new canonical
# 4. Viewer aggregate "Drift" sub-tab:
#    - Match rate trend shows the drop
#    - Session 1's edited step shows "Drift detected"
#    - Session 2 (no edits) gets silently re-matched
# 5. "Re-normalize all to latest" button works
# 6. Version-spread banner appears when loading mixed versions

powershell -ExecutionPolicy Bypass -File .\scripts\preflight.ps1
# Must show 0 critical/high runtime advisories.

node scripts/generate-sbom.js
# Must produce dist/SBOM.json without error.

powershell -ExecutionPolicy Bypass -File .\scripts\build-distribution.ps1
# Must produce dist/capture and dist/viewer with all artifacts.
```

Gate passes when: drift workflow round-trips; preflight clean; build clean.

---

## Cross-cutting

### CC.1 Schema versioning

Bump `annotations.json.version` to `1` (was unversioned in v1). Add a migration step in the normalization pipeline that reads any annotations file without `version` and upgrades it in place.

The interaction event envelope `v: 1` is set by the C# sidecar and validated in `recorder.js`. Mismatch logs a warning and drops the line.

### CC.2 Backwards compatibility

All annotation fields added in phases B-G are optional. Existing sessions without `steps`, `phases`, `matched_against`, `drift_markers`, or `ml_suggestions.json` continue to work and render flow-level only.

### CC.3 Test fixtures

Create `normalization/test/fixtures/` (or `__tests__/fixtures/`) containing:

- A 50-event sample session with markers + interactions
- A canonical YAML that should match ~80% of those interactions
- Expected outputs (XES, CSV, stats.json, annotations.json) for regression testing

Add `normalization/test/test_step_suggest.py` and `test_canonical_match.py` with pytest cases. Run `pytest normalization/test/` in CI / pre-release.

### CC.4 Release tags

After each phase:

```
git tag v0.2.A   # after phase A
git tag v0.2.B   # after phase B
...
git tag v0.2.G   # after phase G - this is v0.2.0 release
```

### CC.5 Final checklist before tagging v0.2.0

- [ ] All seven phases' acceptance gates pass
- [ ] `npm audit --omit=dev` shows 0 critical/high on both apps
- [ ] `scripts/preflight.ps1` exits 0
- [ ] `dist/SBOM.json` regenerated, valid CycloneDX 1.5
- [ ] `docs/User-Guide.docx` regenerated, zero em/en-dashes
- [ ] `SECURITY.md` updated to mention recorder + ML
- [ ] `docs/Security-QA.md` Q21 + Q22 present
- [ ] `dist/` rebuilds cleanly via `scripts/build-distribution.ps1`
- [ ] Manual smoke: capture a real session including interactions, normalize with a canonical, render in viewer at all three levels, export PDD + step BPMN + phase BPMN, confirm Adonis imports the BPMN files
- [ ] README.md updated with new features in the "UI / UX in this pass" section
- [ ] CHANGELOG.md or release notes drafted

---

## Notes for the implementing session

- Do not skip the preflight gate before any commit. The audit-clean status is the security baseline. If a new dep introduces a runtime advisory, add an `override` to `package.json` (existing pattern) or pick a different dep.
- Use `electron-packager` (not electron-builder) for both apps. The build-distribution.ps1 script already does this.
- Robocopy, not PowerShell `Copy-Item -Recurse`, for any operation that touches deeply-nested pm4py `__pycache__` paths. The build script already does this.
- The Python embeddable's `python311._pth` must be written without a UTF-8 BOM. The bundler script handles this. Don't manually edit the .pth file with Notepad.
- C# `JsonSerializer` must use snake_case naming policy. Default PascalCase will break the protocol contract.
- `Console.Out.AutoFlush` must be on in the C# sidecar. Default block buffering on pipe-redirected stdout will hold lines indefinitely.
- For any operation that takes >2 minutes, run with `run_in_background: true`. The Python embeddable build, npm install with ML deps, ONNX export, and electron-packager all qualify.
- When the design docs disagree with this spec, the design docs win on intent; this spec wins on file paths, function signatures, and command strings. The design docs were not edited to keep this spec self-contained.
