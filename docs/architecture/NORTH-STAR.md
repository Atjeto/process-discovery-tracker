# North Star — the target state for Process Discovery Tracker

**Date:** 2026-05-23 · **Status:** strategic target — a *design*, not a commitment or a schedule.
**Companion to:** [VALUE-CHAIN-REVIEW.md](./VALUE-CHAIN-REVIEW.md) (where meaning leaks),
[COHERENCE-AUDIT.md](./COHERENCE-AUDIT.md) (the discipline every feature passes), and the
[ADRs](../adr/). This document defines what "perfect" means so the work has something to be
measured against; it does not claim the tool is, or will be, there.

## What "perfect" means here

Not bug-free-forever (unreachable) and not feature-maximal (gold-plating). For *this* tool it is
a precise, bounded thing:

> **An analyst records a process once, curates *one* instance of the repeating work, and hands
> the client a trustworthy, *living* process document — with every transformation in between
> preserving meaning, every analyst action reversible, nothing shipped unseen, and the known
> blind spots flagged rather than failing silently.**

Everything below is measured against that sentence, *within* the binding constraints that define
the problem rather than represent a shortfall:

- **Sec-pass-through** — no `SetWindowsHookEx`, no injection, no PyInstaller shapes (ADR-0001).
- **Locked-down deployment** — no installer, no admin, no PyPI/npm at runtime; only the released
  `.exe` runs on the work laptop.
- **Manual hand-off, no network** — the session folder is the only integration seam (by design).
- **Mostly one-off processes** — each engagement is a different process, rarely re-recorded, so
  cross-session templates are the wrong tool (VALUE-CHAIN Decision 1).

A "perfect" state that ignored these would be a fantasy. The target is perfection *of this tool,
for this deployment.*

---

## The value chain at its best

The tool climbs a ladder: `raw events → classified activities → cases & steps → analyst meaning →
deliverable`. Perfect = no rung loses meaning. Per seam: the target, where it stands today, and the gap.

### Seam 1 — Capture → raw events (input fidelity)
- **Target.** Every session is a faithful, identifiable record: screenshots of the *work* (not the
  recorder), a named session, markers at the right moments, maximal UIA coverage, and any
  degradation **flagged at capture time** so the analyst knows before they rely on it.
- **Today.** Screenshots target the work window, sessions are named, coverage hints + uncaptured-app
  flags ship; the recorder is a clean no-hook UIA sidecar.
- **Gap.** The C# recorder has **zero automated tests** (ADR-0006); a record→assert harness would
  make recorder regressions visible. Per-app coverage is computed but under-surfaced.

### Seam 2 — Raw → classified activities (labels)
- **Target.** Every activity gets a meaningful label with **no hand-editing of YAML**; the map is
  never blank-by-default for a new deployment.
- **Today.** The recognition layer (ADR-0011) labels by platform signature on both sides; an in-app
  classify manager, reclassify-from-map, and team-taxonomy promotion ship; an unmatched activity
  falls back to a recognised-category label instead of "Unclassified".
- **Gap.** `taxonomy.yaml` still ships example rules for apps nobody in the target deployment runs,
  so a first run starts empty. Perfect ships **no misleading defaults** and a first-run "label your
  apps" prompt; recognition-led labels are the confident default.

### Seam 3 — Events → steps (segmentation) — *the headline*
- **Target.** The analyst curates **one** instance of a repeating case and it **propagates to all**
  (intra-session alignment); short one-off sessions get good-enough heuristic segmentation plus fast
  manual curation. The 308-fragment failure never recurs.
- **Today.** Anchor-based case detection ships, now keyed on a **recognised signature** (ADR-0012 #7)
  so it generalises across engagements; `process_label` collapses repeated work; a *first-cut*
  alignment engine (`step-alignment.js` + repeat badges) exists.
- **Gap.** The **full build is unbuilt** ([ADR-0015](../adr/0015-intra-session-repetition-alignment.md)):
  fuzzy / variant-aware alignment (the exception ticket), and the curate-once-apply-to-all editing
  loop, with the step map drawing its frequencies from the aligned instances. *This is the single
  biggest meaning-leak between here and the north star.*

### Seam 4 — Steps → analyst meaning (annotation)
- **Target.** Imposing meaning is fast *and* safe *and* it counts: every verb has a working inverse,
  every edit is reversible, and flags/names/phases reach the outputs.
- **Today.** Ergonomics ship (ADR-0010: colour-coding, click-to-split, context menu, layout); flags
  propagate to the report; **undo now actually reverts** (the snapshot-timing bug is fixed + tested).
- **Gap.** Curate-once-apply-to-all (shared with Seam 3 / ADR-0015); harden the `saveAnnotations`
  full-blob write against a stale-overwrite lost-update (currently mitigated only by a post-write
  reload).

### Seam 5 — Model → output (deliverable)
- **Target.** The deliverable is a **living projection** of the analyst's model — the PDD, report,
  and maps reflect current annotations/flags/names/phases, are diffable, and are obviously tied to
  the analyst's edits. The process map shows *their* process at the right level (phase default,
  step/activity drill).
- **Today.** The notation × level matrix, scoped drill-down, observed-flow Step/Phase BPMN, the HTML
  findings report and the PDD all ship; exports re-derive from current annotations each run.
- **Gap.** The PDD **"living projection" is undefined** — it needs a concrete owner definition
  (regenerate-on-view? embed the model in the viewer? a queryable projection?) before it is
  buildable. BPMN drill-scoping is decided-deferred (ADR-0013 #6): the miner is PM4Py (Python), so a
  scoped subtree can't be re-mined live in JS.

---

## Cross-cutting qualities perfect requires

Features alone don't reach the north star. Four qualities cut across every seam.

- **Correctness & trust.** No silent corruption or lost work; every data-integrity path
  (save / undo / re-normalize) is bullet-proof **and unit-covered**. *Today:* re-normalize is
  non-destructive and undo is fixed — but the undo bug existed precisely because that path had no
  test. *Target:* the data-integrity paths are covered, and a periodic correctness audit is routine.
- **Verification.** Nothing ships un-eyeballed. *Today:* the `_pdt_verify` Playwright harness lives
  in a scratch dir **outside the repo**, there is **no CI**, and UI bugs have repeatedly slipped past
  green unit tests — the project's recurring failure mode. *Target:* the harness is a first-class,
  committed **e2e suite**; GitHub Actions runs `node --check` + units + e2e and **gates merge**; the
  COHERENCE-AUDIT four-point discipline is enforced by CI, so "shipped unverified UI" is
  structurally impossible.
- **Deployment & trust-on-the-machine.** *Today:* the `.exe`s are **unsigned** (SmartScreen warns on
  a fresh machine); the recognition-JSON + Python bundling is verified in *config* but the packaged
  app has **never been smoke-tested on the locked-down laptop**. *Target:* signed binaries (EV cert),
  a real field smoke on the deployment machine, and a documented sec-scan pass.
- **Maintainability.** No "keep these two in sync by hand" traps; ADRs current; docs match code.
  *Today:* docs are freshly audited, but `process_label` is duplicated as **two regexes** (Python +
  JS) that must agree, and `capture/main.js` is back to ~1,532 lines. *Target:* a single source for
  `process_label` (shared, like the recognition table), and the capture monolith finished off.

---

## The honest ceiling — limits perfect *accepts*

"Perfect" here means handling these **gracefully and visibly**, not eliminating them:

- **Citrix / RDP is invisible to UIA** — permanent; OBS video covers it, and the gap is flagged.
- **AG-Grid cells are identityless** — per-cell granularity is unrecoverable, so the grid is one
  coarse step (documented, not silently wrong).
- **One-off processes** — cross-session canonical templates earn nothing; intra-session alignment is
  the right answer, not a workaround.
- **Manual hand-off, no telemetry** — a deliberate security posture, not a missing feature.
- **Heuristics need real data** — `process_label` stripping, the rare-path default, and the
  waste/automation classifiers are honest heuristics. Perfect is a **calibration loop** against the
  owner's real captures, not a cleverer guess made blind.

---

## Path to the north star (ordered by leverage)

1. **Make the failure mode impossible first.** Commit the `_pdt_verify` harness as a real e2e suite +
   add CI (`node --check`, units, e2e gating merge). Everything else depends on being able to ship
   *verified*; this is the highest-leverage move and unblocks confident work on the rest.
2. **Build ADR-0015 intra-session alignment** (Seam 3) — the biggest functional meaning-leak. Needs a
   design pass on the fuzzy-alignment algorithm and the curate-propagate UX (owner-steered), then the
   build, verified in the harness.
3. **Define + build the living-projection deliverable** (Seam 5) — *blocked on an owner definition*;
   get that first, then build.
4. **Stand up the calibration loop** (Seams 2–3 heuristics) — *blocked on real captures*; calibrate
   `process_label`, the rare-path default, and the classifiers against them.
5. **Harden the rest:** cover the data-integrity paths, single-source `process_label`, finish the
   capture decomposition, add the recorder test harness.
6. **Earn trust on the machine:** sign the binaries, run the packaged-app field smoke + sec scan on
   the locked-down laptop.

Items 1, 2, 5 are buildable now (1 and 5 need no owner input; 2 needs design direction). Items 3, 4, 6
are gated on the owner's definition, data, or hardware — the same three external dependencies that
bound every "make it perfect" attempt.

## The gap in one view

| Dimension | Distance from north star | Unblocked by |
|---|---|---|
| Capture fidelity | Small — recorder tests + coverage surfacing | Me |
| Classification | Small — drop misleading defaults, first-run prompt | Me |
| **Segmentation (alignment)** | **Large — the headline build** | Me + owner design steer |
| Annotation | Small — undo fixed; lost-update hardening | Me |
| Deliverable (living projection) | Medium — **undefined** | Owner definition |
| Correctness coverage | Small — test the data paths | Me |
| Verification / CI | Medium — harness→committed e2e + CI | Me |
| Deployment / signing | Medium — cert + field smoke | Owner / procurement / laptop |
| Calibration | Medium — needs real captures | Owner data |
| Inherent limits | Zero — accepted, handled, flagged | (n/a) |

**Bottom line.** The tool is much of the way there: capture, classification, the map, the analysis
layer, and a now-trustworthy annotation loop all work. The distance to the north star is **one large
buildable feature (alignment), one structural investment (verified-by-CI), a handful of small
hardening tasks, and three things only the owner can unblock.** "Perfect" is not a state to be
certified — but it is, written down here, a direction to be measured against.
