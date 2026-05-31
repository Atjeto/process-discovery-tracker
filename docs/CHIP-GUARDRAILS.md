# Chip / agent guardrails — READ THIS FIRST

You are likely a fresh session with no memory. This project has been bitten repeatedly
by context-blind changes (a map regression, an ADR-number reuse, two chips fighting over
one branch). The defense is **guards that fail on regression even if you don't know the
codebase** — paired with the few invariants below. Honor both.

## Run these before EVERY commit (the commands are the contract)

```
python -m pytest normalization/test/        # pipeline + golden + ADR-registry + signature guards
viewer/python/python.exe normalization/golden_check.py   # session golden — pipeline output is pinned
cd viewer && npm test          # + cd capture && npm test
dotnet test capture/recorder/Recorder.Tests/Recorder.Tests.csproj
cd e2e && node session-smoke.js   # the REAL viewer — INCLUDES the map-connectivity pin
```

If any goes red, you broke something — fix it or revert; never commit red, never delete a
guard to make it pass.

## Hard invariants (each has a guard that fails if you break it)

1. **The process maps are a connected linear chain** — at the screen grain: **1
   weakly-connected component, 1 start, 1 reachable end.** *Guard: `e2e/session-smoke.js`
   "screen-grain Flow diagram is a connected chain".* **History:** this regressed once — a
   value-*laden* screen axis fanned each case into its own disconnected component (a
   tangle). The fix is the **value-free screen axis** (ADR-0024 §6a/6b). Do **not**
   reintroduce per-record / per-value keys into the grain roll-up (`viewer/process-map-levels.js`).
   If you aren't deliberately working on the map, **don't touch `process-map-levels.js`,
   `dfg-viewer.js`, or the grain roll-up at all.**
2. **Raw `events.jsonl` is immutable.** Every analyst edit is an `annotations.json` sidecar;
   re-normalization is non-destructive (preserves `manually_authored`/`edited`).
3. **Pipeline output is pinned by the session golden.** Unintended drift = a bug, not a
   `golden_check.py --update`. Only `--update` when you *intend* an output change, and say so
   in the commit.
4. **Suggest-don't-mutate.** Detectors/edits *propose*; the analyst accepts; the mined
   artifact and raw data stay intact (markers, anchors, Reference Maps all follow this).
5. **Step grain is a view-time roll-up (ADR-0024), never a destructive flip.** Do not flip
   `step_split_on_element` globally to "fix" over-segmentation.
6. **ADR number = `max(existing)+1`. Never reuse a number, never fill a gap.** Add your row to
   [`adr/README.md`](adr/README.md) in the same commit. *Guard: `normalization/test/test_adr_registry.py`.*
7. **Verify UI in the harness, not just unit tests.** Green units are NOT enough — that is this
   project's #1 recurring failure. Drive the real viewer (`e2e/session-smoke.js` or
   `../_pdt_verify/`), screenshot, read the PNGs back.

## Concurrency (we've collided before)

- **One distinct, explicitly-named branch off `master` per chip.** Never commit to `master`
  directly. Work in your own worktree.
- **Distinct ADR number** per concurrent chip (rule 6).
- If your task touches the **same layer** as another running chip, prefer **sequential**.
- Reconcile divergent branches in a verify-and-merge sweep — don't let them race.

## Discipline

- Branch convention, commit style (imperative, **no Co-Authored-By**), keep `CHANGELOG.md` +
  the matching doc current in the same commit — see [CONTRIBUTING.md](../CONTRIBUTING.md).
- If a precondition is unmet (no live app/login to drive, a decision only the owner can make),
  **STOP and report** — do not fabricate data or guess. Honest handoff beats a confident wrong.
