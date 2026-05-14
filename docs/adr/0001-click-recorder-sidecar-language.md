# ADR-0001: Click recorder — capture mechanism and language

**Status:** Proposed (revised 2026-05-14)
**Date:** 2026-05-14
**Deciders:** Automation team lead, tracker maintainer

## Context

The Process Discovery Tracker captures activity (5s active-window polling), markers (analyst-fired Start/End), screenshots, and an OBS video reference. It does not capture *interaction* events — which UI element a worker invoked, with what metadata. The design doc parks "screen understanding / form-field recognition" at v3+ behind a vision-language model (§10), but a deterministic, structured alternative exists today via Windows UI Automation (UIA).

**Scope of this tool.** Local team tool used per project, on machines belonging to the automation team or to SMEs the team has rapport with. Not enterprise-deployed. Implications:

- **Privacy is not a design force.** Data is captured to a local folder, transferred manually by the analyst after the session, never traverses a network during capture. OBS is already recording the entire screen for the duration of the session — anything the UIA recorder captures is a strict subset of what's in the video. Redaction, hashing, consent UX, and per-tenant config are dead weight at this scale.
- **Sec-pass-through is the binding constraint.** "If sec flags it, we never use it." This dominates the language and mechanism choice. Delivery speed does not.
- **§11.5 install model still binds.** Single .exe alongside the existing Electron artifact, no admin install, no PyPI access at runtime.

The architectural shape — **sidecar process, NDJSON over stdio, lifecycle managed by `capture/main.js`** — is not in contention. It mirrors `obs.js`: a sibling subsystem spawned on session start, terminated on session end. The open decisions are (1) the **capture mechanism** and (2) the **implementation language**.

### Forces

- **AV / sec scan exposure is the load-bearing constraint.** Behavioural endpoint engines (Defender, CrowdStrike, SentinelOne) flag `SetWindowsHookEx` / `WH_MOUSE_LL` aggressively regardless of language. PyInstaller bundle shapes carry secondary heuristic risk. Anything we adopt must look like an accessibility / automation tool, not a recorder.
- **UIA fidelity floor.** All viable mechanisms call into `UIAutomationCore.dll`. What changes is *how* events arrive (push vs pull) and what shape the implementation takes — not what they can see inside a compliant app.
- **Citrix / RDP blindness.** No mechanism crosses the remote session boundary. Acknowledged as a permanent limitation host-side.
- **Team language stack.** Tracker is Node + Electron on capture, Python on analyst/normalization. C# is not currently owned; introducing it has a real (if bounded) maintenance cost.

## Decision

Two coupled decisions:

1. **Capture mechanism: UIA event subscription**, not a global mouse hook. Subscribe to `InvokedEvent`, `SelectionChangedEvent`, `PropertyChangedEvent` (Toggle/Value/RangeValue), `TextChangedEvent`, and `FocusChangedEvent` on the desktop root. No `SetWindowsHookEx`, no DLL injection, no system-wide mouse monitoring.
2. **Implementation: C# with `System.Windows.Automation`** (the first-party .NET UIA wrapper), optionally FlaUI as a convenience layer over the same APIs. Self-contained single-file `.exe` via `dotnet publish -r win-x64 --self-contained -p:PublishSingleFile=true`. Authenticode-sign with an internal cert if available.

Communicate with the Electron main process over NDJSON on stdin/stdout. The protocol is the load-bearing contract; the language remains reversible if a future constraint forces it.

## Capture mechanism options

### A. UIA event subscription (chosen)

Use `Automation.AddAutomationEventHandler` and `Automation.AddAutomationPropertyChangedEventHandler` to receive callbacks when controls are invoked, selected, toggled, value-changed, or focused. Same API used by `Inspect.exe`, `AccEvent.exe`, Narrator, NVDA — Microsoft's own accessibility surface.

**Why it passes sec easily:**
- No `SetWindowsHookEx`. Removes the single biggest behavioural-detection trigger.
- Only API calls are to `UIAutomationCore.dll`, signed by Microsoft, in-box on every Windows install. AV vendors classify this as accessibility, not surveillance.
- No DLL injection, no global keyboard/mouse hooks, no process attach.
- Bundle shape becomes "small .NET app that subscribes to in-box events" — same shape AV vendors specifically allow for screen readers.

**What gets captured:**
- Element invocations (buttons, menu items, links): `InvokedEvent`
- Selection changes (dropdowns, list selection): `SelectionChangedEvent`, `SelectionItemPattern`
- State changes (checkboxes, toggles, sliders): `PropertyChangedEvent` on `ToggleState`, `RangeValue`, `Value`
- Text input: `TextChangedEvent` (we'd capture the fact-of-edit, not the content; trivial to enrich if needed)
- Focus moves: `FocusChangedEvent` (useful for inferring task transitions even without explicit invocations)
- Per event: `control_type`, `automation_id`, `name`, `class_name`, `framework_id`, `window_title`, `process_name`, timestamp

### B. Low-level mouse hook + UIA `ElementFromPoint` (rejected)

Install `WH_MOUSE_LL`, on mousedown resolve the element under the cursor.

**Why rejected:**
- `SetWindowsHookEx` with low-level hooks is a primary AV behavioural signature. Every keylogger, every credential stealer, every screen scraper uses this syscall. Behavioural engines treat its presence as a strong signal independent of any other code.
- Bundling a Python interpreter via PyInstaller (the natural Python-side packaging) adds secondary heuristic risk on top.
- The "fail-fast soft-fail" recovery dance (1s deadlines, hook timeouts, sidecar restart on hook revocation) exists *because* the mechanism is awkward — UIA events have none of those failure modes.

This was the proposed approach in the prior revision of this ADR. The sec-pass-through reframe makes it untenable.

### C. VLM screen understanding (out of scope)

Design doc §10 v3+ parks vision-language-model-over-screenshots as a future direction. Distinct decision; not relevant to this ADR.

## Implementation options (assuming mechanism A)

### A1. C# with `System.Windows.Automation` / FlaUI (chosen)

Single self-contained `.exe` (~60–80 MB) containing the CLR, the UIA wrapper, and the event subscription logic.

| Dimension | Assessment |
|-----------|------------|
| Sec profile | Best — CLR bundle shape is recognised, no native interop beyond first-party UIA, signable |
| Complexity | Low — `System.Windows.Automation` is the canonical .NET wrapper for this exact use case |
| Bundle delta | ~60–80 MB self-contained |
| Team familiarity | New — but the surface area is small and the API is straightforward |
| Reversibility | Same NDJSON protocol means the language can be swapped later if needed |

### A2. Python with pywinauto event APIs

pywinauto exposes UIA events through its automation backend, packaged via PyInstaller.

**Why not:**
- PyInstaller bundle shape carries its own AV heuristic risk independent of what the bundle does — multi-percent false-positive rates on default scans.
- For an event-subscription-only recorder, the second-class status of pywinauto's event API (it's built for driving, events are bolted on) is more painful than for the rejected hook-based approach.
- The "stays in the team's language" argument was the decisive one in the prior revision. Under sec-pass-through as the binding force, it loses.

### A3. Node FFI to `UIAutomationCore.dll`

Direct COM interop from Electron's main process via `koffi` / `ffi-napi`.

**Why not:**
- No battle-tested Node binding to UIA event subscription. The team would be writing and maintaining the COM interop layer themselves.
- UIA events that arrive during a callback hang would now hang Electron's main process. The sidecar isolation that the rest of the architecture relies on goes away.
- The existing tracker has not needed FFI/COM; this introduces a new tooling axis.

### A4. PowerShell + `UIAutomationClient`

In-box `System.Windows.Automation` assemblies, no bundle at all.

**Why not:**
- Corporate execution policy (`Restricted`, `AllSigned`) routinely blocks ad-hoc scripts even when PowerShell is allowed. Signing internal PS scripts is its own process.
- Event-subscription bookkeeping in PowerShell is awkward (runspaces, event jobs, action blocks); the same C# code is half the lines.
- No structural advantage over A1 once C# is in play — PowerShell wraps the same .NET assemblies.

## Trade-off analysis

The first-order trade-off is **A (UIA events) vs B (mouse hook)**. Under enterprise sec-pass-through as the binding constraint, this is not close. The mouse hook installs a syscall whose presence is a standalone behavioural signal. UIA events route through Microsoft-signed, in-box accessibility APIs that endpoint engines specifically allow. The two options use the same underlying UIA library to extract the same per-element metadata; the only behavioural difference at runtime is whether a hook is installed.

The cost is dropping coordinate-level capture, dead-click detection, and a small slice of non-UIA-compliant apps. Quantified honestly:

- **Coordinates.** We lose `(x, y)`. For "what did the SME do during the walkthrough," element name + control type is the right grain. Coordinates are useful for replay, which is not in scope.
- **Dead-clicks** (clicking empty space, desktop, custom-drawn surface). No process-discovery signal; this is rounding error.
- **Apps with poor UIA implementation** (legacy DirectX-heavy, some Java AWT, heavily-skinned Qt). UIA events don't fire. But these are the same apps where mouse-hook + `ElementFromPoint` would return an empty element anyway — coordinates only, no structured data. The existing 5s active-window poll + screenshots still covers these apps at the same fidelity they'd have under the mouse-hook approach.
- **Drag operations and modifier-key combinations.** UIA captures the resulting state change, not the gesture. For process discovery this is usually equivalent — we care that a row was selected, not that it was selected via shift-click vs ctrl-click.

The second-order trade-off, language within mechanism A, is **C# vs Python**. Without the PyInstaller bundle shape being scrutinized alongside a mouse hook, Python's AV risk is smaller but not zero. C# with `System.Windows.Automation` is the first-party, recognized shape — the path of lowest sec friction. The team taking on .NET is a real cost; the recorder's surface is small enough that this cost is bounded.

## What we keep, explicitly

- Per UIA event: control type, automation id, name (the visible label — "Save", "Submit Order"), class name, framework id, parent window title, owning process name, ISO timestamp.
- Coverage of any app that implements UIA cooperatively, which is the vast majority of modern Win32, WPF, WinForms, UWP, and modern web (browsers expose page content via UIA).
- Causal ordering against the existing activity/marker/screenshot stream — same `events.jsonl`, same envelope.

## What we lose, explicitly

- Mouse coordinates and the geometry of where clicks land.
- Dead-clicks and clicks on non-UIA surfaces (custom-drawn apps, Citrix-internal everything — though Citrix is lost either way).
- Gesture distinction (shift-click vs ctrl-click vs plain click) — UIA reports the resulting state change, not the gesture.
- Mouse-wheel scroll events.

## Consequences

**Easier:**
- Sec scan pass-through. No mouse hook means no behavioural-engine flag for the most-flagged Windows syscall. CLR bundle shape is well-recognised. Authenticode signing closes most remaining heuristic distance.
- No hook-timeout failure modes, no resolver thread, no 1s deadlines, no auto-restart-on-hook-revocation logic. The sidecar becomes substantially simpler.
- First-party Microsoft accessibility API surface — the same APIs that ship in every Windows accessibility tool. Documented, stable, predictable.
- Symmetric install posture: two .exes side-by-side (Electron + recorder), same as adding any other resource.

**Harder:**
- C# enters the supported language set. Bounded by the recorder's small surface, but real.
- .NET SDK becomes a dev-machine prereq (~1 GB). Worker machines unaffected.
- Some apps that don't implement UIA properly contribute no interaction events. Same apps that the mouse-hook approach would have captured as element-less coordinate events — but at least those carried a timestamp signal. Mitigation: the 5s active-window poll still records that the app was foreground.

**Revisit when:**
- A specific engagement is bottlenecked on one web app and DOM-level fidelity (form values, network events, CSS selector path) becomes a real requirement. Add a Playwright-based per-app recorder *alongside* the UIA one; the NDJSON contract accommodates a second sidecar.
- Citrix-internal capture becomes a real requirement. Host-side has no answer; this would require either VLM (design doc §10 v3+) or a recorder running inside the Citrix VDA. Distinct architectural decision.
- Linux/macOS workers ever enter scope. UIA is Windows-only; the contract carries to AT-SPI (Linux) and NSAccessibility (macOS) but each needs its own sidecar.

## Action items

1. [ ] Scaffold `capture/recorder/` as a C# console project: `dotnet new console`, reference `UIAutomationClient` + `UIAutomationTypes` (or add FlaUI), subscribe to `InvokedEvent` / `SelectionChangedEvent` / `PropertyChangedEvent` / `FocusChangedEvent` on the desktop root, emit `{"v":1,"type":"interaction","data":{...}}` NDJSON to stdout.
2. [ ] Configure `dotnet publish -r win-x64 --self-contained -p:PublishSingleFile=true -p:IncludeAllContentForSelfExtract=true`. Wire the output `.exe` into `electron-builder`'s `extraResources` in `capture/package.json`.
3. [ ] Confirm whether an internal authenticode signing path exists. If yes, fold signing into the publish pipeline; if no, ship unsigned and accept the small remaining heuristic risk.
4. [ ] Add `capture/recorder.js` Node module: `spawnRecorder` / `stopRecorder` / `pauseRecorder` / `resumeRecorder`, mirroring `obs.js`'s lifecycle shape. Spawn after `createSession` succeeds, terminate before `closeSession`.
5. [ ] Add `interaction` event type to `shared/SCHEMA.md` and a constructor in `capture/events.js`. New `system` kinds: `recorder_start`, `recorder_stop`, `recorder_died`.
6. [ ] Add `interactions` config block (`enabled`, `required`, `auto_restart`) to `capture/config.js` defaults and `sample-config.yaml`. Default `enabled: true` (no privacy gate at this scope).
7. [ ] Validate on a representative app mix before committing — at minimum: Excel, Outlook, Chrome, one WinForms LOB app, one Citrix-fronted app. Confirm UIA events fire as expected and document the coverage gap on the Citrix case.
8. [ ] Run the published `.exe` through a clean corporate-image sec scan as a go/no-go before integration. If it flags, investigate the specific heuristic and address it (sign the binary, adjust the assembly manifest, etc.) before falling back to any other approach.
