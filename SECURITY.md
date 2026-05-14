# Security Posture

This document describes the security model of the Process Discovery Tracker, the controls in place, the residual risks, and how to report vulnerabilities. It is the starting point for SSDLC review and corporate security teams.

## Threat model

| Aspect | Stance |
|---|---|
| **Audience** | Internal employees of the team's organization. Single-tenant, single-organization. |
| **Deployment** | Worker machines (capture) and analyst machines (viewer). Both are managed corporate Windows endpoints. |
| **Sessions** | Scheduled, bounded, with the worker's knowledge and consent. Not always-on, not surveillance. |
| **Adversaries we DO consider** | Accidental misconfiguration. Malformed input files (a corrupted events.jsonl, a hand-edited manifest.json, a hostile BPMN file). Compromised intermediate storage where session folders might transit. |
| **Adversaries we do NOT consider** | The user running the app (they have full filesystem access anyway). An attacker who has already root-equivalent access to the machine. |

## Data flows

```
+------------------+         +-----------------+         +-----------------+
| Worker Windows   |         | Transport       |         | Analyst Windows |
| (capture)        |         | (manual)        |         | (viewer +       |
|                  |         |                 |         |  bundled python)|
| - active-win poll|  files  | network share   |  files  | - normalize.py  |
| - OBS local WS   | =====>  | OneDrive / USB  | =====>  | - bpmn-js view  |
| - screenshots    |         | (your choice)   |         | - DFG render    |
| - JSONL writes   |         |                 |         |                 |
+------------------+         +-----------------+         +-----------------+
        |                                                       |
        v                                                       v
   %APPDATA%\process-discovery-tracker\sessions\           wherever the
                                                          analyst stores them
```

## Network behavior

| Component | Network egress |
|---|---|
| Capture app | **None to the internet.** WebSocket connection to OBS on `ws://127.0.0.1:4455` (localhost). No telemetry, no update checks, no crash reporting. |
| Viewer app | **None to the internet.** All assets local. No update checks, no telemetry, no remote font/CDN. |
| Normalization (Python) | **None.** Pure file IO. |
| Build scripts | Download `python-3.11.9-embed-amd64.zip` from python.org and `get-pip.py` from pypi.org during build only. Runtime has no network exposure. |

The CSP on every renderer window includes `connect-src 'none'` and `frame-src 'none'` to enforce this at the browser layer.

## Local-only listening ports

None. The capture app does not open any listening port; it is a WebSocket client of OBS, not a server.

## Data classification

| Data | Classification | Storage |
|---|---|---|
| Active-window app + title | Internal | Local JSONL, encrypted at rest if the machine uses BitLocker |
| Screenshots | Internal (may contain confidential content from on-screen apps) | Local JPEG files in the session folder |
| OBS video recording | Internal (full screen content) | Wherever OBS writes (configured by the team) |
| Analyst annotations | Internal | `annotations.json` alongside the session |
| Worker ID | Identifier from per-session config (e.g. AD username) | Stamped into manifest.json |

No data leaves the device unless the operator explicitly moves a session folder.

## Process behaviors

| Behavior | Detail |
|---|---|
| Foreground window polling | Reads window title + app name via `active-win` every 5 seconds. Does NOT read keyboard input or process memory. |
| Idle detection | Uses Electron's `powerMonitor.getSystemIdleTime` (system input timestamp delta). Does NOT install keyboard or mouse hooks. |
| Screenshots | Uses Electron's built-in `desktopCapturer` API. Does NOT use bundled helper executables. No third-party screen-capture binaries shipped. |
| Global hotkeys | Registered via Electron `globalShortcut`. Default Ctrl+Shift+S/E/P/Y. Configurable. |
| OBS control | JSON-RPC over WebSocket to `127.0.0.1:4455` only. Authenticatable. |
| Interaction recording | Subscribes to Windows UI Automation events via the in-box `UIAutomationCore.dll`. Same API used by Narrator, NVDA, Inspect.exe. No `SetWindowsHookEx`, no DLL injection, no keyboard / mouse hooks. C# sidecar runs as a separate process, NDJSON over stdio to the Electron main process. |
| Process injection | None. |
| DLL hooking | None. |
| Driver loading | None. |
| Privilege escalation | None. The app runs at the user's normal privilege level. |
| Persistence | "Launch on login" is an opt-in checkbox via `app.setLoginItemSettings`. Standard Electron API; no registry tampering. |
| Tray | Standard `Tray` API. |
| File writes | Only under `%APPDATA%\process-discovery-tracker\` and explicit user-picked session folders. |

## Electron hardening

| Setting | Value | Rationale |
|---|---|---|
| `webSecurity` | `true` (default) | Same-origin policy enforced. |
| `allowRunningInsecureContent` | `false` (explicit) | Reject mixed content. |
| `experimentalFeatures` | `false` (explicit) | No experimental Chromium features. |
| `spellcheck` | `false` (explicit) | Avoid downloading spell-check dictionaries. |
| `setWindowOpenHandler` | `deny` on every window | Prevent any `window.open` from succeeding. |
| `will-navigate` | Cancelled on every window | Prevent in-page navigation away from loaded HTML. |
| `Content-Security-Policy` | strict, `connect-src 'none'` | Defense in depth: no network from renderer. |
| `nodeIntegration` | `true` only on first-party-loaded HTML | Renderer scripts use `require()` for bpmn-js, cytoscape, and IPC. CSP and the deny-handlers above mitigate residual risk. |
| `contextIsolation` | `true` in the help window (sandboxed), `false` in interactive renderers | Help is sandboxed; others trade isolation for `require()` access to local libs. |
| `sandbox` | `true` in the help window | The strictest mode where it's compatible with our pattern. |

Improving the interactive renderers to fully sandboxed `preload + contextBridge` is on the roadmap; it is a substantial refactor and was not part of v1. The CSP plus deny-handlers cover the high-impact cases.

## Input validation

| Source | Treatment |
|---|---|
| `events.jsonl` per-line JSON | Parsed with `JSON.parse` inside a try/catch; malformed lines silently dropped. |
| `manifest.json` | `JSON.parse`. Path fields are not used to compose filesystem paths (the session folder root is the only filesystem anchor); `obs.recording_path` is only used as a value for `<video src="file://...">` after `fs.existsSync` confirms the file. |
| `annotations.json` | `JSON.parse`, malformed file silently produces empty annotations. Writes are gated on the target being a real session folder (`manifest.json` exists). |
| Taxonomy + session YAML | `js-yaml` v4 (safe by default; the unsafe `!!js/*` tags were removed in 4.0) on the JS side; `yaml.safe_load` on the Python side. |
| User-typed marker labels | HTML-escaped before being injected via `innerHTML` in the label picker, status window, operator panel, viewer marker list, and timeline. |
| Session folders | Resolved to an absolute path; refused if a `manifest.json` is not present (prevents accidental writes / reads outside legitimate session folders). |
| Subprocess args | Python is spawned via `child_process.spawn(executable, [args...])` with arguments as an array, never via a shell string. |

## Cryptographic primitives

| Use | Library |
|---|---|
| Event IDs, session IDs | `crypto.randomUUID()` (Node built-in, CSPRNG-backed). |
| Sync marker IDs | `crypto.randomBytes(3)` (Node built-in). |
| No password handling, no key derivation, no encryption-at-rest in the app. | Disk-at-rest protection is delegated to the OS (BitLocker). |

## Dependencies

Direct runtime dependencies are deliberately small and widely used:

### capture
- `active-win` (foreground window polling, native binding)
- `js-yaml` (YAML parsing, safe by default in v4)
- `obs-websocket-js` (OBS JSON-RPC client)
- `electron` (Chromium + Node runtime)

### viewer
- `bpmn-js` (BPMN diagram rendering)
- `cytoscape` + `cytoscape-dagre` + `dagre` (DFG graph layout)
- `electron`

### normalization (Python)
- `pm4py`
- `pandas`
- `pyyaml`
- `networkx`
- (transitively) numpy, scipy, matplotlib, lxml, graphviz Python bindings

An SBOM is generated via `scripts/generate-sbom.js` and lands at `dist/SBOM.json`. It is a valid CycloneDX 1.5 document covering every npm package under capture/ and viewer/ node_modules plus every Python package in the embeddable bundle (~390 components in v1).

### `npm audit` status

Runtime dependency audit results as of v1:

| App | Runtime advisories | Notes |
|---|---|---|
| capture (production) | 0 critical, 0 high, 0 moderate, 0 low | After `overrides` for `tar`, `cacache`, `node-gyp`, `make-fetch-happen`, `http-proxy-agent`, `@tootallnate/once` (all transitive build-toolchain dependencies of `active-win`'s prebuild step). The overrides force these to current safe versions; none of them execute at app runtime, only during `npm install`. |
| viewer (production) | 0 critical, 0 high, 0 moderate, 0 low | Clean out of the box. |

Build-time advisories (dev dependencies, never shipped):

| App | Build-only advisories |
|---|---|
| capture | 1 high (transitive of electron-packager / electron-builder tooling). Does not ship in the .exe. |
| viewer | 10 high, 2 low (same root cause: electron-builder + winCodeSign cache extraction libraries). Do not ship in the .exe. |

Run `npm audit --omit=dev` in each app folder to reproduce the runtime numbers.

## Bundled binaries

The shipped `dist/` for v0.2 includes:

- `recorder/recorder.exe` (~70 MB, .NET 8 self-contained, UIA event subscriber - source under `capture/recorder/`)

The recorder uses only Microsoft's in-box UI Automation API. No network calls.

The earlier v0.2 plan included an optional local ML stack (sentence-transformer embeddings + classifier). It was dropped after design review: the per-team App Vocabulary layer (see `docs/adr/0002-app-vocabularies.md`) covers the same naming-uncovered-events use case deterministically, without the ~500 MB of Python deps or the first-run model download.

## Code signing

The Windows binaries in `dist/` are **not** code-signed in v1. Production deployment should add an EV code-signing certificate to the build pipeline. The recipient will otherwise see a SmartScreen warning on first launch. See `docs/User-Guide.docx` for the recipient-side workflow.

## Reporting a vulnerability

Internal tool, internal reporting:

1. Open a private issue or DM the automation team lead.
2. Do not file a public ticket against the project repository.

If a critical fix is required while the tool is in active use across an engagement, the engagement should be paused until the fix ships.

## Compliance posture

| Concern | Status |
|---|---|
| OWASP Top 10 (Web) | N/A in the traditional web sense (no server, no auth, no session cookies). The relevant items (XSS, deserialization, path traversal) are addressed above. |
| GDPR / privacy | Worker consent is part of the design (scheduled, bounded sessions with the worker's knowledge). No data leaves the device. Retention is operator-managed via `scripts/prune-sessions.py`. |
| SOX / audit | Sessions are immutable post-capture; annotations are additive sidecars. Manifest carries a status and recovery flag. Re-normalization is reproducible from raw events plus taxonomy version. |
| Internal SSDLC checks | See "Input validation", "Network behavior", and "Electron hardening" above. |
