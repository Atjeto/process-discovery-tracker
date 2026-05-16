# Capture — Architecture Issues & Refactor Register

> This catalogues the technical debt in the capture app (`capture/`), with enough
> detail to scope a future remediation. It is *not itself* a refactor plan, and not a
> commitment to act — it is the audit, on the record.
>
> The capture app has never had a structural refactor: all of its history is feature
> work, fixes, and release bumps. Its sibling, the viewer, *has* been refactored — see
> [ARCHITECTURE-ISSUES.md](./ARCHITECTURE-ISSUES.md) and
> [ADR-0003](./adr/0003-viewer-architecture-refactor.md).

## How to read this

Each entry has an ID, a severity, the **blast radius** (what breaks / is hard because
of it), a **suggested direction** (not a committed solution), and a **priority score**.

- **Severity** — High = actively causes bugs or blocks change; Medium = real cost, not
  yet on fire; Low = friction.
- **IDs** — `C` = capture. (The viewer register uses `S` / `D` / `R`.)
- **Priority score** = `(Impact + Risk) x (6 - Effort)`, each factor rated 1-5. Entries
  are ordered by score, highest first.

The capture app is functionally solid. Its debt is not one giant fault like the
viewer's `renderer.js` — it is a spread of smaller ones. Note that the monolith
(**C6**), the issue that most resembles the viewer's **S1**, lands *mid-list*: it is
high-effort and only medium-risk, so tests (**C1**) and error visibility (**C2**)
return more per unit of work.

## Priority summary

| ID | Issue | Severity | Impact | Risk | Effort | Score |
|----|-------|----------|:------:|:----:|:------:|:-----:|
| C1 | Zero automated tests | High | 3 | 5 | 2 | 32 |
| C2 | Capture-time failures are silent | High | 2 | 4 | 2 | 24 |
| C3 | Config defaults — three sources of truth | Medium | 2 | 2 | 1 | 20 |
| C4 | Recorder sidecar — no health check | Medium | 1 | 4 | 3 | 15 |
| C5 | Duplicated logic across windows | Medium | 3 | 2 | 3 | 15 |
| C6 | `main.js` is a 1,578-line monolith | Medium | 4 | 3 | 4 | 14 |
| C7 | Screenshot triggers — no rate-limiting | Low | 1 | 2 | 2 | 12 |
| C8 | Inline HTML across seven window files | Low | 2 | 1 | 3 | 9 |

---

## Issues

### C1 — Zero automated tests — *High*

`Impact 3 · Risk 5 · Effort 2 · Score 32`

Neither the Electron app nor the C# recorder has any test. `capture/package.json` has
no `test` script (only `start`, `dev`, `build:recorder`, `prepackage`, `package`,
`dist`) and no test framework in its devDependencies; no test files exist anywhere
under `capture/`. The recorder sidecar — `recorder/Program.cs` (113 lines) and
`recorder/UiaSubscriber.cs` (260 lines) — is likewise untested.

- **Blast radius:** a production capture binary ships to field machines with no
  regression net. The pure-logic modules — `config.js` deep-merge, `events.js` event
  factories, `session.js` manifest I/O, `tracker.js` noise filtering — cannot be
  verified in isolation, so every change is hand-checked by running a session.
- **Direction:** add Node's built-in `node:test` runner (zero new dependency — which
  suits the locked-down install footprint) and a `test` script, starting with the
  pure-logic modules. The Effort rating covers that starting slice; end-to-end coverage
  of OBS, recorder, and screenshot capture is a larger, separate effort.

### C2 — Capture-time failures are silent — *High*

`Impact 2 · Risk 4 · Effort 2 · Score 24`

Failures in the capture-critical paths are written only to `boot.log`, and only when
the `PDT_DEBUG` environment variable is `1` — `bootLog()` is a no-op otherwise
(`main.js:61-72`). OBS, recorder, and screenshot errors all route through it, and
several catch blocks swallow exceptions entirely ("best-effort", e.g. `main.js:71`).
OBS setup failures in non-strict mode are logged and otherwise ignored
(`main.js:~537-584`).

- **Blast radius:** a field operator running a walkthrough gets no signal that the
  session is recording incompletely — OBS dropped, recorder dead, screenshots failing.
  The gap is discovered later, by the analyst, when the walkthrough can no longer be
  repeated.
- **Direction:** route capture-critical failures to the operator panel or an OS toast;
  keep `boot.log` for diagnostics.

### C3 — Config defaults have three sources of truth — *Medium*

`Impact 2 · Risk 2 · Effort 1 · Score 20`

The same defaults are defined in three places: the `DEFAULTS` object in `config.js`
(`~:7-59`), inline `|| 60` / `|| 30` fallbacks in `main.js` (`~:362-363`), and a
hardcoded `30` in `session-config-window.js` (`~:158`).

- **Blast radius:** changing a default in one place silently desyncs the others; the
  value a session actually uses depends on which code path set it.
- **Direction:** make `config.js` `DEFAULTS` the single source — remove the inline
  fallbacks, and have the session-config window read its defaults from `config.js`.

### C4 — Recorder sidecar has no health check — *Medium*

`Impact 1 · Risk 4 · Effort 3 · Score 15`

`recorder.js` (108 lines) supervises the C# recorder child process but detects its
state only through the process `exit` event. After `max` restarts (default 3),
`main.js` sets `recorderPermanentlyDead` (`main.js:103`; exit handler `~:829-857`) and
the session continues with no interaction capture. A process that hangs while still
alive — one that stops emitting events without exiting — is invisible to the supervisor.

- **Blast radius:** silent loss of the entire interaction stream mid-session. Compounds
  **C2** — nothing surfaces the loss to the operator.
- **Direction:** add a liveness check (a heartbeat, or a stdout-quiet timeout); surface
  permanent recorder death to the operator.

### C5 — Duplicated logic across windows — *Medium*

`Impact 3 · Risk 2 · Effort 3 · Score 15`

The pause/resume toggle is implemented three times — in the tray menu, in an IPC
handler, and in `operator-panel.js`. The window-singleton guard
(`if (win && !win.isDestroyed()) { ... } else { new BrowserWindow(...) }`) is
copy-pasted across all seven window modules. Small HTML-escaping helpers are repeated.

- **Blast radius:** a change to pause behaviour, or to window lifecycle, must be made
  in every copy. The copies have already drifted — per-window font sizes vary between
  11, 12, and 13px.
- **Direction:** a shared `window-manager` helper for the singleton lifecycle, and a
  single pause action that all three call sites invoke.

### C6 — `main.js` is a 1,578-line monolith — *Medium*

`Impact 4 · Risk 3 · Effort 4 · Score 14`

One file holds the tray menu, global hotkey registration, the full session lifecycle,
roughly a dozen IPC handlers, OBS coordination, recorder supervision, the idle monitor,
the screenshot triggers, and the label-picker modal. It carries more than twenty
module-level mutable globals (`main.js:87` onward). `buildMenu()` — about 190 lines
(`~:1274-1464`) — is rebuilt on every 5-second status tick.

- **Blast radius:** every capture feature edits this file; nothing in it is isolatable
  for a unit test. This is the same "fix one thing, another breaks" risk the viewer
  register names as **S1** — but at roughly a third of the 5,708-line scale that made
  S1 *High*, so: Medium — real cost, not yet on fire.
- **Direction:** when it warrants action, split along the seams the imports already
  imply — `session-controller`, `recorder-supervisor`, `obs-controller`, `tray`, and a
  shared `window-manager` (see **C5**). This is the capture analogue of viewer **S1**;
  it is not urgent.

### C7 — Screenshot triggers have no rate-limiting — *Low*

`Impact 1 · Risk 2 · Effort 2 · Score 12`

Four independent triggers — app-switch (fires every tick), marker start and marker end,
idle-resume, and manual — all call `fireScreenshot()` (`main.js:~312-335`) with no
coalescing or debounce.

- **Blast radius:** bursts of near-duplicate screenshots when triggers coincide. Disk
  usage and reviewer noise, not a correctness problem.
- **Direction:** debounce or coalesce calls within a short window.

### C8 — Inline HTML across seven window files — *Low*

`Impact 2 · Risk 1 · Effort 3 · Score 9`

Every window builds its UI as a `data:text/html` string inside a JavaScript template
literal — `operator-panel.js`, `status-window.js`, `welcome-window.js`,
`obs-settings-window.js`, `session-config-window.js`, `help-window.js`, and
`hotkey-overlay.js` — roughly 1,600 lines of HTML/CSS/JS in total.

- **Blast radius:** no editor tooling for the markup (no formatting, linting, or syntax
  help); styling drifts between windows. The viewer recently absorbed a full theme
  redesign — Capture's inline windows would each need hand-editing to match.
- **Direction:** extract to `.html` files, with a shared style block, if a capture UI
  refresh is ever scoped.

---

## Assessed and found healthy

Two debt categories were checked and need no action — recorded here so the audit reads
as complete.

- **Dependencies.** Electron is on `33.x` (a current major); the three runtime
  dependencies — `active-win` `^8`, `js-yaml` `^4`, `obs-websocket-js` `^5` — are all
  current and maintained. `package-lock.json` is committed, and `package.json`
  `overrides` pins known transitive packages (`tar`, `cacache`, `node-gyp`,
  `make-fetch-happen`, ...). The C# recorder has no NuGet dependencies. No dependency
  debt.
- **Documentation.** The capture app is documented by
  [architecture/CAPTURE.md](./architecture/CAPTURE.md), `capture/README.md`,
  [interaction-recorder.md](./interaction-recorder.md), and
  [ADR-0001](./adr/0001-click-recorder-sidecar-language.md). Coverage is adequate; the
  one gap was the absence of this issues register, which this document closes.

---

*Audit taken against `master` at v0.4.0 (commit `48583c6`). Line numbers are
approximate and prefixed `~`.*
