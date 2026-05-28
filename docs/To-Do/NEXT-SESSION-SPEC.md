# Next-Session Spec — plan of record

**Updated:** 2026-05-28 · **Branch:** `master` · **Status:** plan of record.

Self-contained hand-off — read top to bottom; assumes no memory of the prior
session. Earlier specs live in git history and [Archive/](Archive/).

---

## 0. Verify UI changes in the harness — proactively, not as an offer

This project's recurring failure is shipping UI that was never eyeballed. A
Playwright harness drives the **real** viewer and screenshots it, so a headless
agent CAN see the UI. Use it to confirm every UI change before claiming it done.

- **Where:** `_pdt_verify/` (a dir *outside* the repo; `playwright-core` installed
  there, not a repo dependency) — `driver.js` plus per-task scratch drivers.
- **How:** `_electron.launch` runs the viewer's own Electron with
  `--session=<analyzed folder>` (see `main.js parseInitialSessionArg`), drives the
  page, writes `*.png` to read back. It logs `PAGE ERROR:` on any console error.
- **A loadable session:** re-analyze a bundled example —
  `viewer/python/python.exe normalization/normalize.py sessions/example-aggregate/sess-2026-0514-0900 --mine`.
  **`example-aggregate` is committed demo data — do NOT commit the regenerated files**
  (`git checkout -- ...` + `git clean -f ...` that folder when done).
- **Tests:** system Python with pytest (`python -m pytest normalization/test/`);
  the bundled `viewer/python` has the runtime deps (pm4py, python-docx) but no
  pytest, so use it for direct/`--mine` runs. Viewer: `npm test` in `viewer/`.

---

## 1. Where we are

Last release **v0.18.0** (2026-05-28) — adds the in-view Session-view Map level
as a 5th entry in the level switcher (Flow / Steps / Phases / **Map** /
Analysis), retiring the v0.17.0 "View map" one-click into Compare-Sessions. The
interactive process-map UI is now a reusable controller (`viewer/map-controller.js`)
shared by both surfaces; aggregate-view.js shrunk by 208 lines, no regression in
Compare-Sessions. Also a build-pipeline hardening pass (`preflight.ps1` gates
CHANGELOG header integrity + lockfile sync; `build-distribution.ps1` retries
electron-packager on the Defender / Search-indexer temp-dir race).

v0.17.0 (same cycle) closed the **productization cycle** — PDD restructured to
a standard RPA Process Definition Document with an embedded process map,
segment-level automation candidacy
([ADR-0016](../adr/0016-segment-level-automation-candidacy.md)), the
Compare-Sessions Analysis panel + single-session Waste-by-step decluttered,
capture tray IA split by lifetime (Settings / Profile / Session setup), ~5 s
session-start freeze gone, Chromium web-content reaches the recorder out of the
box, seeded fuzzers + parse_ts consolidation + a process_label Python↔JS golden
pin the normalization pipeline. v0.17.1 was the same-day doc catch-up.

Direction: **productization toward a small internal rollout, analyst-deliverable
first**; bar = "as polished as it can be." Internal-rollout phase begins now.

---

## 2. Queued backlog (next work)

All five feature-sized items from the v0.16.x – v0.18.0 cycle have landed —
segment-level automation, group-Waste-by-step, parse_ts consolidation, the
doc-coverage audit, and the in-view Map level. What's left in the
codebase-side backlog is small follow-ups noticed during the recent release
prep:

1. **CHANGELOG header-integrity pre-commit hook.** v0.18.0's
   `scripts/preflight.ps1` already gates this at build time (and
   `build-distribution.ps1` runs preflight as step 0). A `core.hooksPath`
   pre-commit hook would catch the regression at commit time instead of
   build time — better feedback loop, but the current build-time gate is
   sufficient. Cheap, low priority.

2. **MAX_PATH brittleness on Shell-extract.** The viewer zip's deepest path is
   ~175 chars (PM4Py inductive-variant filenames). Reasonable extract
   destinations are fine; deeply-nested ones silently fail. v0.17.1's
   [DEPLOY.md](../DEPLOY.md) carries the "extract to a short path" note as
   user-facing mitigation; a follow-up could permanently shave the longest
   unused PM4Py paths from `viewer/python/`. Bigger refactor than it sounds —
   the slim script needs to know which PM4Py modules our pipeline actually
   uses.

3. **Code-signing scaffolding.** The company has an internal self-sign
   certificate. The codebase needs ~30 lines in `build-distribution.ps1`:
   a `-CertThumbprint` parameter + `signtool sign` invocations after each
   `.exe` is produced (`recorder.exe`,
   `Process Discovery Tracker.exe`, `Process Discovery Viewer.exe`). Worth
   doing before the internal-rollout phase widens — eliminates the "Windows
   protected your PC" SmartScreen prompt on fresh laptops (assuming IT has
   distributed the internal root cert in the Trust Store, which corp-managed
   environments usually do).

---

## 3. Owner-blocked / calibration (cannot be done headless)

- **Calibration on real captures** — `process_label` value-stripping, the
  rare-path cutoff, the fuzzy "same step" thresholds. Needs more representative
  real captures (owner-side). Fuzzing proves robustness, NOT calibration.
- **Released-`.exe` smoke** on the locked-down work laptop: the packaged app's
  recognition-JSON load + the recorder's single-monitor screenshot occlusion.
- **PDD "living projection"** — still undefined; needs a concrete owner definition.

---

## 4. Environment & conventions

- **Two machines:** dev box (node / python / git / .NET) vs. the locked-down work
  laptop (released `.exe` only — never suggest installs there).
- **Company captures stay local.** Use `scripts/inspect-events.js` /
  `scripts/count-cases.js`; never read a real `events.jsonl` into the assistant.
- **Validate via the packaged app *and* the §0 harness**, not just green tests —
  UI bugs are invisible to the unit suites.
- **Commit style:** imperative subject; **no Co-Authored-By trailer**; quote-safe
  body. Branch `master`; `gh` authed as `Atjeto`. For `.ps1`, scope-set
  `RemoteSigned`, not `-ExecutionPolicy Bypass`.
