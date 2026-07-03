---
name: windows-environment
description: Use before running tests, shell commands, background tasks, or builds on this machine (Windows 11, harness inside the Claude desktop app), and whenever a file read, test run, or command result looks wrong, hangs, or contradicts what the owner says is true. This machine lies in specific documented ways; consult this BEFORE concluding that data is missing, tests are broken, or a path is empty. Also use when briefing subagents that will run tests or touch files outside the repo.
---

# Windows environment: the documented ways this machine lies

Every entry below cost real hours. They are point-in-time
observations, so verify one still holds before leaning hard on it,
but never conclude "the data is gone" or "tests are broken" without
checking the matching entry here first.

## Your file reads can be virtualized (the MSIX shadow)

The harness runs inside the Claude desktop app's MSIX package, so
Windows VIRTUALIZES %APPDATA% for it. Documented case: reads of
C:\Users\rasha\AppData\Roaming\motif-desktop-tracker\motif-desktop.json
were silently redirected to a stale per-package shadow under
AppData\Local\Packages\Claude_*\LocalCache\Roaming. The shadow read
as empty and frozen while the real file held 2343 events across 86
hours; the mismatch produced a long false "data is lost" detour.
Directory listings merge real and shadow, so the folder looks
normal; opening the file returns the ghost. Writes hit the shadow
too, so you cannot fix or archive the real file yourself.

Rules:

- Never trust your own read of %APPDATA% paths for this app's data.
- To inspect for real: the owner pastes the content, or copies the
  file somewhere non-virtualized like D:\ and you read that.
- Generalize it: when your read contradicts the owner's account of a
  file, suspect redirection or staleness of YOUR read first
  (grounded-claims: the instrument is part of the system).

## Tests: per-file, foreground, never polled

- Run tests as: npx vitest run <file> --no-coverage, foreground.
- The FULL suite's reporter hangs on shutdown on Windows: every test
  file reports green, then the process never exits. The hang is the
  reporter, not the tests. Do not "fix" the tests, do not wait it
  out, and do not put full-suite runs in subagent briefs; spell out
  per-file commands instead.
- Never run tests with run_in_background, and never poll background
  output with until-grep / tail -f loops; on this shell they hang
  and have wasted entire sessions. If a poll returns empty twice,
  the approach is dead; there is no third attempt.
- Suspected pre-existing failure: git stash; run the file; git stash
  pop. Fails on clean main means pre-existing; note it and move on
  unless asked to fix it.
- A test that "rotted" with no related change: check for an unpinned
  fixture clock before anything else (test-integrity has the pin
  pattern).

## Shells

- PowerShell here is 5.1: no && or || chaining, mangles quoted args
  to native commands, UTF-16 default file encoding. Use it for
  Windows-specific tooling only.
- Commit-message files written from PowerShell can carry a BOM that
  lands PERMANENTLY in the commit subject (documented: a subject
  rendering as "﻿Add R5…"). Write message files from Bash (heredoc)
  or ASCII; after any `git commit -F`, verify the subject with
  `git log --oneline -1`.
- Multiple Claude sessions can share one checkout: a concurrent
  session's commits can land on YOUR branch mid-task (documented,
  2026-07-03), and permission contexts differ between an orchestrator
  and its subagents (an action denied to one ran fine for the other).
  Check for live sessions before shared-tree git mutations; prefer
  worktrees (.claude/worktrees/ is the local convention) when
  concurrency is likely; attribute every commit before merging.
- Repo-relative work runs in the Bash tool, with an explicit
  cd "<repo>" prefix when driving repo-relative scripts; a drifted
  working directory has broken runs before.
- Paths contain spaces ("D:\Game Development\..."): quote them,
  every time.
- Background shells you start, you end: track them and kill or
  confirm completion before the turn ends. Orphaned shells are a
  documented owner correction.

## The desktop tracker (companion Electron app)

- What runs is desktop-tracker\dist\Motif Desktop Tracker-win32-x64\
  via the HKCU Run autostart key; npm run package rebuilds IN PLACE,
  so packaging IS deploying. There is no separate copy to swap.
- The folder at the D:\ root named "...OLD-pre-W11 DO-NOT-RUN" is a
  parked stale build that once overwrote real data with old-format
  events. Never launch it; never clean it up without the owner.
- To verify a build is current, grep its resources/app.asar for the
  four markers: schemaVersion, title-drop, getIdleSeconds,
  RUN_CAP_MS. Folder dates lie; markers do not.
- Its data lands in %APPDATA%\motif-desktop-tracker\
  motif-desktop.json, which you cannot truthfully read (MSIX shadow
  above).

## The process-discovery-tracker repo (D:\Game Development\Process Mining\)

- TWO Pythons, opposite gaps: the bundled `viewer/python/python.exe`
  runs the pipeline (pm4py, pandas) but cannot run pytest; the system
  Python runs pytest but lacks the pipeline deps, so normalize-importing
  tests SKIP silently ("N passed, M skipped" — the M are the pipeline
  tests). Never read a bare pass count as green there
  (verified-completion has the skip-coverage rule); the golden check
  runs on the bundled interpreter: `viewer/python/python.exe
  normalization/golden_check.py`.
- The viewer RE-ANALYZES the committed demo session on every launch —
  any eyeball run dirties `sessions/example-aggregate/`. Use a temp
  copy (e2e's `freshenSession()`) or the documented revert pair; never
  stage that path. Full drive recipe + DOM handles:
  docs/CHIP-GUARDRAILS.md (grep it fresh; it shipped wrong handles
  once).
- Company captures never enter an assistant context: structure-only
  peeks via scripts/inspect-events.js / count-cases.js.

## When a command fails

Do not re-run it unchanged hoping the machine behaves differently;
it does not. Same command plus same failure twice is the ceiling;
the next attempt must change the hypothesis, the tool, or the plan
(debugging-discipline: dead ends stay dead).
