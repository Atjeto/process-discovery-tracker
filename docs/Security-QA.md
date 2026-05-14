# Security Team Q&A

Single-page reference for corporate security review. Detailed rationale lives in [`SECURITY.md`](../SECURITY.md); this is the fast-track Q&A you can paste into the ticket.

## 1. Does the application send any data over the internet?

**No.** Zero internet egress at runtime. The only network call is a WebSocket to `ws://127.0.0.1:4455` for OBS Studio control, which is localhost-only. Enforced by `connect-src 'none'` in the CSP on every renderer window.

## 2. Does it listen on any port?

**No.** It is a client of OBS over WebSocket. No HTTP servers, no IPC over the network.

## 3. Auto-update or "phone home"?

**No update mechanism, no telemetry, no crash reporting.** Versions are upgraded by replacing the installed folder.

## 4. What privilege level does it run as?

**Standard user.** No admin elevation. No UAC prompt. Runs from the user's own folder (`%LOCALAPPDATA%` or wherever the recipient extracts the zip).

## 5. Does it inject into other processes, hook the keyboard, or load kernel drivers?

**None of those.** Foreground window polling uses `active-win`, which reads from public Win32 APIs (`GetForegroundWindow`). Idle detection uses Electron's `powerMonitor.getSystemIdleTime` (system input-timestamp delta), which does not install hooks.

## 6. Does it read keystrokes or clipboard content?

**No.** The capture stream contains application name, window title, and elapsed durations. No key events, no clipboard reads.

## 7. What does it write to disk?

- `%APPDATA%\process-discovery-tracker\sessions\<engagement>\<timestamp>\` - session folders containing `events.jsonl`, `manifest.json`, `config.yaml`, `screenshots/`, `obs/sync.json`.
- `%APPDATA%\process-discovery-tracker\boot.log` only when `PDT_DEBUG=1` is set explicitly.

Nothing else. No registry writes beyond Electron's standard "Launch on login" toggle (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`) when the user opts in via the tray menu.

## 8. How are screenshots captured?

Via Electron's built-in `desktopCapturer` API (Chromium internals). **No third-party screen-capture binaries** are bundled. Earlier versions used `screenshot-desktop` which ships a helper exe; we removed it for this reason.

## 9. What third-party binaries ship?

Inside `viewer/win-unpacked/`:
- `Process Discovery Viewer.exe` and standard Electron payload (chromium DLLs, ICU data, V8 snapshots).
- Bundled Python 3.11 embeddable (`resources/python/python.exe` plus stdlib + site-packages for PM4Py, pandas, numpy, networkx, pyyaml, matplotlib, scipy, lxml, pillow, cvxopt, graphviz Python bindings).

Inside `capture/win-unpacked/`:
- `Process Discovery Tracker.exe` and standard Electron payload.
- `node_modules/active-win` native binding (`.node` file; Node N-API addon, no bundled helper exe).

The CycloneDX 1.5 SBOM at `dist/SBOM.json` lists every component with version, license, and PURL.

## 10. Is the executable code-signed?

**Not in v1.** Production deployment should add an EV code-signing certificate to the build pipeline. Without it, Windows SmartScreen shows "Windows protected your PC" on first launch on a fresh machine.

## 11. Dependency vulnerabilities (npm audit)?

| Scope | Critical | High | Moderate | Low |
|---|---|---|---|---|
| Capture runtime (`--omit=dev`) | 0 | 0 | 0 | 0 |
| Viewer runtime (`--omit=dev`) | 0 | 0 | 0 | 0 |
| Build-time only (dev deps) | 0 | 11 | 0 | 2 |

Runtime is clean. Build-time advisories are in `electron-builder` / `electron-packager` tooling chains (`tar`, `cacache`, etc.) that execute only during `npm install` on the developer machine and **never ship to end users**. Reproducible via `npm audit --omit=dev` in `capture/` and `viewer/`.

## 12. What's the data classification?

Internal. Session folders may contain confidential on-screen content (via screenshots and OBS video). They are stored locally; the operator decides how to move them. Disk-at-rest encryption is delegated to BitLocker.

## 13. Retention policy?

Operator-managed via `scripts/prune-sessions.py`. Default: dry-run; pass `--apply` to delete. Recommend a retention SOP per engagement type (e.g., 90 days for walkthroughs, 30 days for shift reviews).

## 14. SBOM format?

CycloneDX 1.5 JSON at `dist/SBOM.json`. Regenerable via `node scripts/generate-sbom.js`. ~400 components covering both apps and the bundled Python.

## 15. Are there any insecure deserialization paths?

YAML loading uses `js-yaml` v4 (safe by default; the unsafe `!!js/*` schema was removed in 4.0) and Python's `yaml.safe_load`. JSON parsing is the standard `JSON.parse` / `json.loads`. No `eval`, no `pickle`, no `Function()` constructors.

## 16. What about XSS?

Every renderer window has a strict Content-Security-Policy with `connect-src 'none'`, `frame-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. All user-supplied strings (marker labels, notes, annotations) are HTML-escaped before injection. The label picker was the one historical gap; fixed in commit `1f66ff6`.

## 17. Electron security configuration?

Documented in [`SECURITY.md`](../SECURITY.md#electron-hardening). Summary:

- `webSecurity: true`, `allowRunningInsecureContent: false`, `experimentalFeatures: false`, `spellcheck: false` (no dictionary downloads).
- `setWindowOpenHandler` denies on every window.
- `will-navigate` is cancelled on every window.
- Help window runs fully sandboxed (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`).
- Interactive renderers use `nodeIntegration: true` to load `bpmn-js` and `cytoscape` via `require()`. CSP + deny handlers above provide defense in depth. A preload + contextBridge refactor is on the roadmap.

## 18. How are filesystem paths validated?

All session-folder paths are `path.resolve`'d to absolute paths and refused unless a `manifest.json` exists at the root. Subprocess calls (Python normalization) use `child_process.spawn(exe, [args])` with arguments as an array, never via a shell string.

## 19. Vulnerability reporting?

Internal: DM the automation team lead or open a private issue. Do not file a public ticket against the project repository. If the issue is critical and the tool is in active use, the affected engagement should pause until a fix lands.

## 20. Pre-merge / pre-commit checks?

`scripts/preflight.ps1` runs `npm audit --omit=dev` against both apps and fails on any high/critical advisory. Run it before commit and before tagging a release. The build script (`scripts/build-distribution.ps1`) regenerates the SBOM as part of every dist build.

## 21. Does the interaction recorder install kernel hooks or low-level keyboard hooks?

**No.** Uses Microsoft's in-box UI Automation event API (`AddAutomationEventHandler`, `AddAutomationPropertyChangedEventHandler`, `AddAutomationFocusChangedEventHandler`) from `UIAutomationCore.dll`. Same APIs accessibility tools (Narrator, NVDA) use. No `SetWindowsHookEx`, no `WH_KEYBOARD_LL`, no `WH_MOUSE_LL`, no DLL injection.

The recorder is a separate process (`recorder.exe`, .NET 8 self-contained, ~70 MB) spawned by the Electron main process. It communicates via NDJSON over stdio - one line per UIA event. The shape is documented in `shared/SCHEMA.md` under the `interaction` event type. Per-element fields that throw on UIA access are silently omitted (no privileged access required).

## 22. What does the ML layer do? Does it phone home?

**Embeddings + classifier inference, all local.** Sentence-transformer model (`sentence-transformers/all-MiniLM-L6-v2`, ~90 MB) bundled in the dist, loaded into ONNX runtime, runs on CPU. The classifier is trained locally against the team's own taxonomy rules; the trained `classifier.pkl` (~5 MB) lives in the dist as well.

No network calls at runtime. The model download happens once during `scripts/build-python-embeddable.ps1` (build-time, from the public sentence-transformers repo on Hugging Face); from then on, runtime inference is entirely local. ONNX Runtime is configured with `CPUExecutionProvider` only - no GPU, no cloud endpoints. See `SECURITY.md` "Bundled binaries and models" for the full list.

---

If your tooling needs anything else (specific format for SBOM, signed releases, evidence of unit tests, etc.), let the automation team know what to produce and we will add it.
