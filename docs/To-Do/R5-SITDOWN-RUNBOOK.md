# R5 sit-down runbook — three real sessions to three timed memos

> **Superseded (2026-09-23) by [ADR-0029](../adr/0029-ba-helper-refocus.md):** the
> approachability-redesign surfaces this runbook ledgers (the memo export, the App
> Library workbench, Compare Sessions, and others) are cut or reworked. Its
> replacements are [P1-DRAFT-PROBE-RUNBOOK.md](P1-DRAFT-PROBE-RUNBOOK.md) and
> [P5-REAL-SESSION-GATE.md](P5-REAL-SESSION-GATE.md). Kept for history, not deleted.

This is the R5 instrument: the owner's keyboard protocol to extract empirical proof from three real captures. Closes R5 when three completed ledgers exist + the pruning pass executes.

## Preconditions (stop if any is unmet)

- Real capture recorded on the work laptop with markers fired per the capture guidance line.
- Session folder moved to the analyst machine.
- Viewer running from this branch's build.
- Timer at hand.

**Rule:** No real session available = stop and record why. Never substitute demo data — a demo cannot fail the way Tuesday fails.

## Per-session protocol (target: ≤ 45 minutes)

Fill in one row per session; stages exactly as listed.

| Stage | Started | Ended | Min | Friction notes |
|-------|---------|-------|-----|---|
| Open session + read Overview rail | | | | |
| Act 1 — name controls in the workbench (target ≤ 15 min) | | | | |
| Act 2 — mark cases / accept anchor | | | | |
| Act 3 — walk the story in Flow | | | | |
| Act 4 — judge top time sinks | | | | |
| Act 5 — include findings + export memo | | | | |
| **Total** | | | | |

Three rules:

- Follow the rail's suggested order but record every deviation and why — a deviation is data.
- Note every moment you feel lost or tired — that feeling is the R1 defect resurfacing. Name the surface that caused it.
- Do not fix the app mid-session. Log and continue.

## The border ledger (fill one per session)

A resident surface must produce a memo sentence, a recorded decision, or a capture instruction.

| Surface | Memo sentences | Decisions recorded | Capture instructions | Notes |
|---------|---|---|---|---|
| Next-act rail | | | | |
| Fact tiles | | | | |
| Findings feed | | | | |
| Where the time goes | | | | |
| Automation candidate cards | | | | |
| €-ROI (gated) | | | | |
| Steps case tree | | | | |
| Step/work-item detail | | | | |
| Flow timeline | | | | |
| Video | | | | |
| Map | | | | |
| App Library workbench | | | | |
| Compare (if ≥2 sessions) | | | | |
| Memo/PDD export | | | | |

## After the third session

1. Consolidate the three ledgers: count memo sentences, decisions, and capture instructions per surface across all three.
2. Any surface scoring 0/0/0 across all three is cut or demoted to a Machine drawer per APPROACHABILITY-REDESIGN §5 R5 (with its COHERENCE-AUDIT inverse).
3. File the kill list + timings in a new dated doc under `docs/To-Do/`.
4. Update CLAUDE.md's active direction and decide the release.

The suites are the floor; these three ledgers are the gate.

## Friction log format

Format: `HH:MM · surface · what happened · S/M/L`

Example lines (marked as examples):

- `15:34 · Flow timeline · timeline seeking got stuck after step 47 display, had to reload the view · M`
- `22:18 · App Library workbench · needed 8 minutes just to figure out which cell was the worklist vs. matched examples · L`
