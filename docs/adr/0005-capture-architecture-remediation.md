# ADR-0005: Capture App Tech-Debt Remediation (C1-C8)

**Status:** Accepted — implemented, shipped in v0.5.0
**Date:** 2026-05-17
**Deciders:** Project owner

## Context

The capture app (`capture/`) had never had a structural pass — all of its history
was feature work, fixes, and release bumps. An audit
([CAPTURE-ARCHITECTURE-ISSUES.md](../CAPTURE-ARCHITECTURE-ISSUES.md)) catalogued
eight tech-debt items, C1-C8, each scored by `(Impact + Risk) x (6 - Effort)`:

- **C1** — zero automated tests (the Electron app and the C# recorder).
- **C2** — capture-time failures (OBS, recorder, screenshots) were silent unless
  `PDT_DEBUG=1` was set.
- **C3** — config defaults were defined in three places.
- **C4** — the recorder sidecar had no liveness check; a hung-but-alive process
  was invisible to the supervisor.
- **C5** — the window-singleton guard and the pause/resume logic were copy-pasted
  across the window modules.
- **C6** — `main.js` was a 1,578-line monolith.
- **C7** — four screenshot triggers with no rate-limiting.
- **C8** — every window built its UI as an inline `data:` HTML string.

The capture app is production-stable and ships to field machines as a packaged
Electron `.exe`. The audit's framing: C1 (no tests) and C2 (silent failures)
carried the most risk, while C6 (the monolith) — the most *visible* issue — was
mid-priority, being high-effort and not yet causing bugs. This is the capture
analogue of the viewer's [ADR-0003](./0003-viewer-architecture-refactor.md);
`CAPTURE-ARCHITECTURE-ISSUES.md` is the audit register, this ADR is the decision.

## Decision

**Remediate all eight items, lowest-risk-first, as behaviour-preserving changes,
and ship them together as v0.5.0.**

Constraints that shaped the approach:

- **Behaviour-preserving.** The capture app cannot be exercised in CI (it is a GUI
  Electron app); changes had to be verifiable by `node --check`, the new test
  suite, and review — so each item was a refactor, not a redesign.
- **No new runtime dependencies.** The locked-down corporate install footprint
  rules out adding packages; C1 used Node's built-in `node:test`.
- **C6 — decompose, do not tear down.** `main.js` keeps the session-lifecycle
  orchestration, the tray, and the IPC layer; only the cleanly-separable
  cross-cutting concerns (diagnostic logging, notifications, disk accounting,
  window management) were extracted. A full split into `session-controller` /
  `recorder-supervisor` / `obs-controller` was judged disproportionate and was
  deliberately not done.
- **C8 — generate, do not hand-transcribe.** Each window's HTML was extracted by
  running the existing builder, capturing its output, and writing it to a file;
  the builders were then rewritten to read the file. The new builders' output was
  verified byte-identical to the former inline strings, so C8 carried no
  rendering risk.

## Outcome

All eight items resolved — full mapping in the Resolution table of
[CAPTURE-ARCHITECTURE-ISSUES.md](../CAPTURE-ARCHITECTURE-ISSUES.md). In brief:

- `capture/test/` — 41 `node:test` tests over the pure-logic modules; `npm test`.
- `main.js` 1,578 → ~1,210 lines; four extracted modules — `boot-log.js`,
  `notify.js`, `session-storage.js`, `window-manager.js`.
- `capture/ui/` — seven extracted window `.html` files.
- Config single-sourced in `config.js`; recorder liveness watchdog; 2 s
  screenshot debounce; capture-failure desktop notifications.

Shipped in **v0.5.0**, 2026-05-17 (commits `48ad02a` C1-C7, `0a2b039` C8).

## Consequences

**Easier:**
- The pure-logic modules (`config`, `events`, `session`, `tracker`,
  `window-manager`) are unit-tested; regressions in them are now caught.
- A field operator sees a desktop notification when capture is degrading, rather
  than the failure being silent until the analyst finds the gap.
- `main.js` is meaningfully smaller, and the extracted modules can be reasoned
  about — and tested — in isolation.

**Costs / not done:**
- `main.js` is still the largest file (~1,210 lines) and still holds the session
  lifecycle, tray, and IPC. A deeper split was deliberately deferred — the audit
  rated it not-yet-urgent.
- End-to-end tests (OBS, recorder, and screenshot capture in a running app) were
  out of scope; the suite covers the pure-logic modules only.
- The C# recorder remains untested.

## Action Items

All complete, shipped in v0.5.0:

1. [x] C1 — `node:test` harness + tests for the pure-logic modules.
2. [x] C2 — surface capture-time failures to the operator.
3. [x] C3 — consolidate config defaults to `config.js`.
4. [x] C4 — recorder liveness watchdog.
5. [x] C5 — shared `window-manager`; single pause action.
6. [x] C6 — decompose `main.js` into focused modules.
7. [x] C7 — debounce screenshot triggers.
8. [x] C8 — extract window HTML into `ui/*.html`.
