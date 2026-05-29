# Security Review — Session Findings Summary

> Full-codebase audit (all three layers: Electron viewer + capture, Python
> normalization pipeline, C# recorder + build scripts). Produced for cross-session
> dedup against 2 other parallel reviews.
>
> **Threat model anchor:** a session folder (`events.jsonl`, `annotations.json`,
> screenshots, video, config) is captured on a worker machine and physically moved
> to an analyst machine, where the viewer parses, renders, and exports it — so the
> folder's contents are untrusted input. Compounding factor: the viewer runs with
> `nodeIntegration:true` / `contextIsolation:false`, so any renderer code-execution
> path is full RCE.

## Findings

| # | Severity | Conf | File:Line | Category | One-line |
|---|----------|------|-----------|----------|----------|
| 1 | **HIGH** | 8/10 | `viewer/main.js:196` (sink) ← `viewer/views/flow-view.js:3535`, callers `:2496` / `:3322` | Untrusted-path execution (click-to-RCE) | Event-controlled `data.path` from `events.jsonl` flows unsanitized into `shell.openPath`; clicking a screenshot launches an attacker-planted file from the session folder via Windows file association. |
| 2 | **MEDIUM** | 7/10 | `normalization/pdd_export.py:337` (sink) ← `screenshot_refs` from `annotations.json` | Path traversal (arbitrary image-file read) | `session_folder / ref` with no containment; pathlib honors absolute paths + `..`, so a malicious `screenshot_refs` embeds off-folder image files into the exported PDD. |

### Shared root cause
Both stem from the **same trust boundary**: the session folder
(`events.jsonl` / `annotations.json`) is untrusted input from the worker machine,
but two sinks consume folder-supplied path strings without containment / type
checks. If another session frames things by trust boundary, expect overlap here.

## Coverage / clean areas (what this session ruled out)

- **Electron config** — `webSecurity:true`, deny-all window handler, CSP present, no
  webview / remote module / auto-update. Clean.
- **Renderer XSS → RCE** — consistent `[&<>"']` escaping at all `innerHTML` sinks
  carrying worker data; HTML-report and SVG exporters escape labels; no `eval` /
  `new Function`. Clean (one cosmetic non-exploitable note: `viewer/bpmn-viewer.js:201`
  unescaped error message).
- **Python pipeline** — `yaml.safe_load` only; no pickle / eval / exec / shell; no
  untrusted XML parsing (no XXE); BPMN/XES generation auto-escapes. Clean apart from #2.
- **C# recorder** — no file I/O, no `Process.Start`, `System.Text.Json` with no
  polymorphic handling. Clean.
- **Build/release scripts** — no `Invoke-Expression`, no cert bypass; args from
  trusted CLI flags / repo paths. Clean.

## Explicitly NOT reported (likely false-positive candidates if another session raises them)

- `viewer/main.js:195` `shell.showItemInFolder` (`viewer:revealFile`) — only
  highlights in Explorer, no execution.
- `external_video.path` → `file://` `<video>` src (`flow-view.js:501`) — uncontained
  but media-decode only, not RCE. LOW.
- `pdd_export.py:223` `process_map_image` join — source is the analyst-controlled
  `--pdd-map-image` CLI flag, **not** session data → not a finding.
- Python-embeddable download in `scripts/build-python-embeddable.ps1` — HTTPS from
  hardcoded trusted hosts, no untrusted-input control.

## Diff note

This branch's working changes are **docs-only** (7 `.md` files). Neither finding
above is introduced by the current diff; both are pre-existing in committed code.
If the other two sessions reviewed only the diff, there should be no overlap on
new-code findings.

---

# Cross-Session Reconciliation

Compared against `docs/To-Do/tech-debt-findings.md` (maintainability lens).
**Verdict: near-zero hard overlap.** Neither security finding collides with a
tech-debt item on *finding + remediation*. One shared file, one shared theme, two
cross-validations.

## Overlap map

| Security finding | Tech-debt item | Relationship | Action |
|---|---|---|---|
| **Vuln 2** — path traversal `pdd_export.py:337` | **#16** — missing fuzzer for `pdd_export.py` | Same file, complementary. They flagged it as an unfuzzed untrusted-input parser but did not find the concrete bug; my traversal is exactly what that fuzzer would catch. | **Keep both**; cross-link — fix the sink (Vuln 2) *and* add the fuzzer (#16). |
| **Vuln 1** — `shell.openPath` click-to-RCE (`main.js:196` ← `flow-view.js:2496/3322/3535`) | *(none)* | Unique to security session. Their `flow-view.js` cites (1543/1637/1661/1699/2130-2701/2778) and `main.js` god-file never touch these lines. | **Keep**; no dedup. |
| nodeIntegration as RCE multiplier (drove the XSS audit; no XSS found) | **#15** — Electron `^33.2.0` past security support + `nodeIntegration:true` | Shared context, different treatment. | **Reassign — see below.** |

## Item to reassign: #15 (Electron EOL)

The only item needing a deliberate ownership call. Tech-debt **#15** is genuinely
security-relevant, but this security pass **excluded it by rule** — "outdated
third-party libraries" and "lack of hardening" are hard exclusions in the
security-review rubric, so the Electron-33 EOL / `nodeIntegration` hardening gap was
never raised as a security finding.

➡️ **On the consolidated security list, source #15 from the tech-debt session.** It
is absent from this report because it was scoped out, not because it is not a
security concern. Do not let it fall through the gap between sessions.

## Cross-validations (agreements — raise confidence)

- **C# recorder:** tech-debt cleared it as HEALTHY; this security pass independently
  found it clean (no file I/O, no `Process.Start`, no unsafe deserialization). Two
  lenses, same conclusion.
- **Predicted overlaps that did NOT materialize:** tech-debt predicted security
  collisions on **#1** (silent error swallowing), **#2** (unbounded loop), **#7**
  (manifest read-modify-write race). This security pass raised **none** of them —
  silent-swallow is not a vuln, the unbounded loop is DoS-class (excluded), the
  manifest race is a non-exploitable TOCTOU under this threat model. They remain
  **tech-debt-only**.

## Net for the consolidated master list

- **2 unique security findings** (Vuln 1 HIGH, Vuln 2 MEDIUM) — no merge.
- **1 file to cross-reference**: `pdd_export.py` (Vuln 2 ⇄ tech-debt #16).
- **1 item to reassign to security ownership**: tech-debt #15 (Electron EOL).
- **2 agreements** noted as resolved: C# recorder clean; the three predicted
  overlaps that did not overlap.
- **Still pending:** the third parallel session (correctness / bug-hunting) — this
  reconciliation covers security ⇄ tech-debt only.

## Detail — Vuln 1: Click-to-RCE via `shell.openPath`

- **Sink:** `viewer/main.js:196` — `ipcMain.handle("viewer:openExternal", (_e, p) => shell.openPath(p));`
- **Path to sink:** `flow-view.js:3535` `openScreenshot()` → `path.join(sessionFolder, relPath)`
  → `Ipc.openExternal(full)`, with `relPath` from session events:
  - `flow-view.js:2496` — `openScreenshot(ev.data.path)` (timeline camera dot)
  - `flow-view.js:3322` — `openScreenshot(s.data.path)` (screenshot thumbnail)
- **Why exploitable:** `data.path` is from `events.jsonl`; attacker controls both the
  path string and every file in the folder. No extension check, no containment, no
  confirmation. `shell.openPath` launches via Windows file association — executable
  types (`.exe`, `.bat`, `.cmd`, `.hta`, `.lnk`, `.scr`, `.js`/WSH) run as the analyst.
  (Note: the absolute-path variant does **not** work via Node `path.join` — it does
  not discard the base like `path.resolve`. The reliable vector is an attacker-planted
  file inside the folder, e.g. `screenshots/Invoice_scan.png.exe`, plus `..` traversal.)
- **Fix:** reject absolute paths and `..`; assert the resolved path stays under
  `sessionFolder/screenshots/`; verify image extension before `openExternal` — or
  render screenshots in-app instead of delegating to the OS shell.

## Detail — Vuln 2: Path traversal in PDD export

- **Sink:** `pdd_export.py:336-340`
  ```python
  for ref in (step.get("evidence", {}).get("screenshot_refs") or []):
      full = session_folder / ref
      if full.exists() and Inches is not None:
          doc.add_picture(str(full), width=Inches(4.5))
  ```
- **Why exploitable:** `ref` is from untrusted `annotations.json`. `pathlib` discards
  the base on an absolute right operand and preserves `..`, so `ref` can point outside
  the folder. `add_picture` bounds the read to image-decodable files, which are then
  embedded into the `.docx` PDD the analyst shares → off-folder info disclosure.
  Bounded impact + explicit-export trigger → MEDIUM.
- **Fix:** `full = (session_folder / ref).resolve()`, skip unless within
  `session_folder.resolve()`; reject absolute `ref`.
