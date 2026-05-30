# ADR-0023: Recorder capture-confidence model + OCR last resort (§11e desktop-coverage hardening)

**Status:** Accepted — implemented 2026-05-30 (`capture/recorder/UiaSubscriber.cs`, `capture/recorder/OcrBridge.cs`, `capture/recorder/Program.cs`, the `interactions.ocr` config, the E8 fields in `shared/SCHEMA.md`, `Recorder.Tests`). Live validation against real Java/Qt/Citrix apps deferred (needs those apps).
**Date:** 2026-05-30
**Deciders:** Project owner, analyst (process-discovery lead)
**Related:** [ADR-0001](0001-click-recorder-sidecar-language.md) (the C# recorder sidecar this extends), [ADR-0011](0011-platform-recognition-layer.md) (the downstream *web-app* recognition layer, a separate axis), [PDT-ROADMAP-CODEBASE-FIT.md](../To-Do/PDT-ROADMAP-CODEBASE-FIT.md) §3/§6c (the Windows.Media.Ocr-not-Tesseract call + the auxiliary-engine pattern), Master Assessment §11e.

## Context

The recorder is **the moat** (Master Assessment §11/§12): structured UIA capture, on-device, no screenshots leaving the box. But coverage is **framework-bound** — WPF / WinForms / UWP / modern-Win32 / Electron expose rich UIA; Java needs the Java Access Bridge; Qt needs its a11y plugin; legacy custom controls, terminals, and Citrix/RDP expose little or nothing. Until this cycle the recorder reported the raw UIA `framework_id` and a coarse per-*app* `coverage_hint`, and silently produced thin captures on the hard frameworks with no signal to the analyst about *why*.

§11e is "desktop-coverage hardening": not 100% structured capture — **graceful, honest degradation**, all on-device. The enabling prerequisite (a `Recorder.Tests` xUnit project, the recorder's first automated tests) landed first, so the pure decision logic is now unit-testable on the one language the Python fuzzers don't reach.

## Decision

**Add a per-element capture-quality model to the recorder, ending in an opt-in OCR last resort, emitted as additive interaction fields that follow the existing `coverage_hint` precedent** (recorder emits → `events.js` allowlist passes → `events.jsonl` → documented in SCHEMA → surfaced in the structure-only `inspect-events.js`; consumed by the analyst, not the pipeline — so it cannot regress normalization). Five layers, each a pure static pinned by `Recorder.Tests` over a thin UIA-coupled seam:

1. **Framework detection (`framework`).** Normalize `(framework_id, class_name)` → a stable UI-toolkit taxonomy: `win32` / `winforms` / `wpf` / `winui` / `chromium` / `java` / `javafx` / `qt` / `remote` / `terminal` / `unknown`. The value-add is the toolkits that **misreport** their `framework_id`: Java (Swing/AWT) and Qt report `Win32`; Citrix/RDP wrap a foreign session. The window **class** is the reliable tell, so class signatures win over `framework_id`. The signatures matched are **platform-stable constants** (`SunAwt*`, `GlassWnd*`, `Qt…QWindow*`, `WindowsForms10.*`, `ConsoleWindowClass`, `wfica`/`TscShellContainerClass`/`RAIL_`) — the same category as the recorder's pre-existing `Chrome_WidgetWin_*` match, **not** app-specific automation_ids (the volatile, instance-bound values the prior cycle deleted as demo-fiction). Distinct from the recognition layer's *web-app* `framework` axis (chromium/ag-grid/office365), which is mined downstream from class names.
2. **Identity ladder (`identity_source`).** Which property gives the element a stable identity, descending: `automation_id` → `name` → `class_name` → `ocr` → `none`. Mirrors the spec's ladder (AutomationId → ControlType+Name+ancestry → local-region OCR).
3. **Per-element confidence (`confidence` ∈ [0,1]).** Blends the rung with the toolkit — a strong rung is still **capped at 0.30** on a `remote`/`terminal` surface, where a captured field is an unreliable proxy for the real pixel control. Honest degradation made legible: the analyst flags low-trust captures instead of silently trusting a thin one.
4. **Value recovery (`value_source`).** Generalizes the AG-Grid typed-value fix: a `value_changed` whose primary ValuePattern value is empty is recovered via `TextPattern.DocumentRange.GetText` (`value_source: "text_pattern"`), never overriding a real value, never on the common path. The managed `System.Windows.Automation` has no `LegacyIAccessiblePattern` (COM-only), so TextPattern is the managed recovery source — **no COM-interop dependency** added to the single-file build. Edit-element descent (hot-path tree walk) and clipboard scraping (privacy hazard) are deliberately out.
5. **OCR last resort (`ocr_text`, `identity_source: "ocr"`).** When an element has `identity_source == "none"`, capture its on-screen region and recover a text label.

### The OCR engine choice — Windows.Media.Ocr, not Tesseract

Per Fit-Analysis §3/§6c: the engine is **Windows.Media.Ocr**, a Win10+ **system API** — on-device, free, and adding **no bundle inflation** (it's a system component), where Tesseract is a multi-MB bundle for a cross-platform benefit that has no buyer (the recorder is irreducibly Windows-only: `net8.0-windows`, UIA, `win-x64` single-file). Wired as a thin C# bridge (`OcrBridge`) invoked **on demand**, never per event.

Constraints baked into the OCR decision:

- **Default-OFF, genuine last resort.** Gated by `ShouldOcr(identity_source=="none" && hasBounds && ocrEnabled)` — it never touches an element that already has any identity, and the whole path is skipped unless the session opts in (`interactions.ocr: true`, threaded through the `hello` message like `verbose`/`debounce_ms`). An ordinary capture pays nothing. Enabling it is worth it only on a known low-UIA app, trading latency on identityless elements for a recovered label (confidence ≈ 0.25 — weak, but better than nothing).
- **TFM moniker bump, not a runtime-floor change.** `Recorder.csproj` moves `net8.0-windows` → `net8.0-windows10.0.19041.0` to project the WinRT surface; the single-file self-contained `win-x64` publish was verified to still build and start. The only added managed dependency is `System.Drawing.Common` (first-party, over system GDI+) for the screen-region grab.
- **Testable core + deferred end-to-end.** `OcrBridge.RecognizePng` is pinned **headlessly** by rendering known text and asserting OCR recovers it; the live element → screen-capture → label flow needs a real low-UIA app and is deferred. `ocr_text` is captured **content** (like `value`/`window_title`), so the structure-only `inspect-events.js` never prints it.

## Consequences

- **The moat is now legible.** A `java`/`qt`/`remote`/`terminal` tally + a low mean confidence tells the analyst *where* and *why* coverage is thin (enable the Java Access Bridge; lean on the video backstop), instead of a silent thin capture. This is the honest-degradation contract §11e asked for.
- **Zero pipeline risk.** All fields are additive and consumed by the analyst (via `inspect-events.js`), not by normalization — the session-golden runs on pre-recorded `events.jsonl` and is unaffected. The recognition layer keys off `class_name`/`control_type` as before.
- **Bus-factor down on the crown jewel.** The decision logic (framework detection, ladder, confidence, recovery selection, OCR gating, the OCR engine itself) is now pinned by 24 `Recorder.Tests` cases — the fuzzer-equivalent discipline on the only language the Python fuzzers don't reach.
- **A new managed dependency + WinRT projection** on the recorder. Mitigated: default-off, system-component engine, verified single-file publish, bounded capture size.

## Coherence discipline ([COHERENCE-AUDIT](../architecture/COHERENCE-AUDIT.md))

- **Inverse / no dead fields.** These are capture-quality signals, not UI verbs, so the relevant discipline is "nothing emitted that nothing reads": every field surfaces in `inspect-events.js` (the analyst's structure-only surface) — except `ocr_text`, which is content and is deliberately *not* printed there but is the actionable label in `events.jsonl`. OCR is reversible by config (`interactions.ocr: false`); it writes nothing to raw events that a non-OCR run wouldn't, beyond the opt-in `ocr_text`.
- **Comprehension.** Every field's value domain + meaning is in `shared/SCHEMA.md`; the `framework`/`identity_source`/`confidence` axes are explicitly distinguished from the raw `framework_id` and the recognition layer's web-app `framework`.
- **Control-interaction.** The `ocr` flag rides the existing `hello` contract alongside `verbose`/`debounce_ms`; the config key sits with the other `interactions.*` knobs.
- **Real run.** The OCR engine is validated headlessly (rendered text round-trips); the production single-file recorder builds and emits `ready` under the bumped TFM. The live capture of identityless Java/Qt/Citrix controls is the deferred validation (needs those apps) — called out, not hidden.

## Deferred / owner-gated

- **Live framework + OCR validation** against real Java (Swing/AWT/JavaFX), Qt, Citrix/RDP, and terminal apps — does detection fire, does the OCR label help. Needs those apps driven through the real recorder (the §11a real-data step).
- **The `remote` signature set** is deliberately small (documented, high-confidence class names only); broaden it when validated against a live Citrix/RDP session.
- **The confidence rung scores** (0.95 / 0.70 / 0.40 / 0.25 / 0.10) and the 0.30 remote/terminal cap ship calibrated against intuition + the seed tests; tune against a real-capture corpus (the §11b calibration step).
