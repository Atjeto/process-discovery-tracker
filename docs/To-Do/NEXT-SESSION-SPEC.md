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

Last release **v0.17.1** (2026-05-28, doc-only follow-up to v0.17.0 same-day).
v0.17.0 closed the **productization cycle** — PDD restructured to a standard RPA
Process Definition Document with an embedded process map, segment-level
automation candidacy ([ADR-0016](../adr/0016-segment-level-automation-candidacy.md)),
the Compare-Sessions Analysis panel + single-session Waste-by-step decluttered,
capture tray IA split by lifetime (Settings / Profile / Session setup), ~5 s
session-start freeze gone, Chromium web-content reaches the recorder out of the
box, seeded fuzzers + parse_ts consolidation + a process_label Python↔JS golden
pin the normalization pipeline. v0.17.1 is the doc catch-up.

Direction: **productization toward a small internal rollout, analyst-deliverable
first**; bar = "as polished as it can be." Internal-rollout phase begins now.

---

## 2. Queued backlog (next work)

The big-ticket items from the v0.16.x – v0.17.0 cycle (segment-level automation,
group-Waste-by-step, parse_ts consolidation, broader doc-coverage audit) all
landed. What's left:

1. **Full in-view single-session map.** Embed the interactive map *inside* the
   Session view instead of routing through Compare-Sessions. Bigger build: the
   map UI (level/notation controls, drill-scope, rare-path slider, `#map-level` /
   `#dfg-host` / `.panel-tab` DOM) is tightly coupled to
   `views/aggregate-view.js` state + element IDs — needs a careful
   refactor-for-reuse + full level×notation×theme harness check. The one-click
   "View map" shipped in v0.17.0 is the low-risk interim.

2. **Small follow-ups noticed during the v0.17.0 release prep:**
   - **CHANGELOG header-integrity guard.** Commit `114edfa` accidentally deleted
     the `## [0.16.3]` section header, rolling its content into `[Unreleased]`
     where it would have shipped under v0.17.0 if the bump-time audit hadn't
     caught it. A pre-commit hook that warns when an entry under `[Unreleased]`
     looks structurally identical to the content above an existing released
     section prevents recurrence. Cheap, low priority.
   - **MAX_PATH brittleness on Shell-extract.** The viewer zip's deepest path is
     ~175 chars (PM4Py inductive-variant filenames). Reasonable extract
     destinations are fine; deeply-nested ones silently fail. v0.17.1's
     [DEPLOY.md](../DEPLOY.md) carries the "extract to a short path" note;
     a follow-up could permanently shave the longest unused PM4Py paths from
     `viewer/python/`.
   - **Lockfile drift.** `viewer/package-lock.json` lagged four minor versions
     before the v0.17.0 prep noticed. v0.17.1's [BUILD-AND-DIST.md](../BUILD-AND-DIST.md)
     adds a release-checklist note; a future pre-commit hook could automate the
     check.

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
