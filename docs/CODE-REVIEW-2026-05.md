# Code Review Findings — 2026-05-29 (v0.19.0)

Full-codebase review across all three layers (Capture / Normalization / Viewer),
lenses: **correctness · reuse/simplification · performance**. Two passes:

- **Pass 1** — manual parallel fan-out (5 layer reviewers); HIGH findings hand-verified against source.
- **Pass 2** — multi-agent workflow: 16 area finders → cross-finder dedup → **perspective-diverse verification** (3 independent lenses, majority-of-3 gate). 49 unique findings, **45 confirmed / 4 refuted**.

Total: **~59 distinct confirmed issues**. No data-corruption-of-raw-events and no security holes found; the raw `events.jsonl` immutability invariant holds throughout. Severity reflects the local single-analyst threat model.

> Status legend: ☐ open. File:line are approximate (pre-fix snapshot). "Votes" = adversarial verification result (pass 2 only).

---

## 🔴 Fix-first queue (recommended order)

1. **Phase-membership desync helper** — fixes 4 bugs at once (M-1…M-3 + the Python re-merge M-4).
2. **Vocab `seen_count` data loss** (H-3).
3. **PDD drops unphased + renders hidden steps** (H-2, M-5/M-6).
4. **Canonical boundary spans truncate** (H-1).
5. **`idle_gap` signal mathematically unreachable** (H-4).
6. **`renameMarker` bypasses undo** (H-5).
7. **Swallowed flush of durability-critical events** (H-6).
8. **`auto_end_idle` re-fires every 5s** (H-7).
9. **`coalesce` crashes the pipeline on one bad timestamp** (M-7).
10. **`findOrphanedSessions` can leave the app with no tray** (M-15).

---

## 🔴 HIGH

| ID | Issue | File:line | Votes | Fix |
|----|-------|-----------|-------|-----|
| ☐ H-1 | `until_app_change`/`until_pause`/`until_field_change` canonical spans truncate — interior interactions that don't re-match the same step are lost or prematurely close the span (only `until_next_step` absorbs correctly). Masked by tests that give every interior event the same trigger. | normalization/canonical_match.py:206 | 3/3 | Mirror the `until_next_step` absorb-interleaved branch for the three modes; add interior-non-matching + different-step tests. |
| ☐ H-2 | **PDD silently drops every step not rolled into a phase** — once any phase exists, `_write_steps` walks only `phase.step_ids`, so unmatched and all analyst `manually_authored`/`edited` steps vanish from §3.5. | normalization/pdd_export.py:316 | 3/3 | After phases, render steps whose `step_id` is in no phase under "Unphased steps". |
| ☐ H-3 | **Saving an App Library vocab strips `seen_count`** (and any unmodeled field) from every interaction — permanent loss of bootstrapped frequency ranking; disables uncommon-tail fold. Runs on every edit and save. | viewer/views/vocab-view.js:213 | 3/3 | Clone the prior entry; overwrite only `signature`/`name`/`flags`. |
| ☐ H-4 | **`idle_gap` signal can never fire a suggestion alone** — `0.5*tanh(x) < 0.5` vs strict `< 0.5` gate, so the most common unbracketed boundary (a pause) is never suggested unless another signal coincides. | normalization/marker_suggest.py:405 | (pass 1, verified) | Raise weight above threshold or saturate idle to reach it; add a single-long-idle regression test. |
| ☐ H-5 | **`renameMarker` bypasses `persistAnnotations`/undo** — no undo entry for a rename, and the stale `_baseline` makes the *next* edit's Ctrl+Z also revert the rename. | viewer/views/flow-view.js:3766 | (pass 1, verified) | Route through `persistAnnotations(anno, 'rename marker', ["markers","timeline"])`. |
| ☐ H-6 | **`flushEvents` swallows write errors** (`catch {}`) — a failed `appendFileSync` silently drops durability-critical markers/system events while counters/UI report success. | capture/tracker.js:134 | (pass 1, verified) | On a caught error for a batch containing a marker/system event: log loudly + notify + re-queue. |
| ☐ H-7 | **`auto_end_idle` re-fires every 5s** with no guard for the whole idle stretch → hundreds of duplicate boundary system events. (Not ending the session is by-design; the re-fire is the bug.) | capture/main.js:280 | (pass 1, verified) | Gate behind an `autoEndedThisIdle` flag reset on `idle_end`. |

---

## 🟠 MEDIUM

### Phase-membership dual-representation desync (cluster)
Membership is stored twice — `phase.step_ids` **and** `step.phase_id` — with no single helper keeping them in sync.

| ID | Issue | File:line | Votes |
|----|-------|-----------|-------|
| ☐ M-1 | **Deleting** a step leaves its id dangling in `phase.step_ids` (inflated count, stale persisted; `deletePhase` does the inverse cleanup, delete doesn't). | viewer/views/steps-view.js:435 | 3/3 |
| ☐ M-2 | **Split**/add-at-playhead orphans the new half: gets `phase_id` but isn't added to `step_ids` → shows in phase map, missing from phase list/count. | viewer/views/steps-view.js:487 | 3/3 |
| ☐ M-3 | **Merging** leaves dangling ids and can drop a step from a phase entirely (survivor keeps only `first`'s `phase_id`). | viewer/views/steps-view.js:623 | 3/3 |
| ☐ M-4 | Python re-merge: `_merge_phases` preserves `phase.step_ids` verbatim with no reconciliation against the regenerated step set. | normalization/normalize.py:199 | (pass 1) |

**Fix all four:** one shared `detachStepsFromPhases(anno, idSet)` (+ survivor substitution on merge), reused across viewer delete/split/merge and a bidirectional reconcile pass in Python after `_merge_steps`/`_merge_phases`.

### Other MEDIUM

| ID | Issue | File:line | Votes |
|----|-------|-----------|-------|
| ☐ M-5 | PDD renders **hidden** (suppressed-as-noise) steps in §3.5 & exceptions — every other consumer filters `state==='hidden'`. | normalization/pdd_export.py:314 | 3/3 |
| ☐ M-6 | — (see H-2; the unphased-step drop) | | |
| ☐ M-7 | `coalesce_typing_bursts` uses **strict** `parse_ts` on the *raw* stream (stage 1a) → one non-ISO/empty timestamp crashes the whole pipeline; the only stage that bypasses the lenient parser. | normalization/coalesce.py:121 | 3/3 |
| ☐ M-8 | **Drift markers accumulate unboundedly** on every canonical re-normalize (no dedup; preserved step's `canonical_step_id` never refreshed) → inflated `drift_count`, annotations.json bloat. | normalization/normalize.py:517 | 3/3 |
| ☐ M-9 | Dismissing a suggested **Start** strands its paired **End** (mirror of Accept-strands-End, different path; untested). | normalization/marker_suggest.py:504 | 3/3 |
| ☐ M-10 | Accepting only the **Start** of a suggested pair strands the End on re-normalize. | normalization/marker_suggest.py:504 + viewer/views/flow-view.js:1853 | (pass 1) |
| ☐ M-11 | Returning to Flow/Steps/Phases **from Map or Analysis resets timeline zoom to 1× / scroll 0** — zoom-less levels report a fake `zoom:1` that clobbers the destination. (v0.18 Map-level regression.) | viewer/renderer.js:151 | 3/3 |
| ☐ M-12 | Timeline **click-to-seek snap is dead** — early-`break` collapses to fire on event #2; only snaps within ~500ms of session start. | viewer/views/flow-view.js:2688 | 3/3 |
| ☐ M-13 | `runNormalize` parses summary with `lastIndexOf("{")` but `normalize.py` pretty-prints nested JSON → grabs inner `outputs` brace → `summary` silently `null`. (`clusters` field also dead.) | viewer/python-runner.js:154 | 3/3 |
| ☐ M-14 | **`listAppVocabs` W_OK gating hides shipped vocabs on a packaged (Program Files) install** — UI reports zero vocabularies though Python loads them. | viewer/main.js:552 | 3/3 |
| ☐ M-15 | `PDT_APP_VOCABULARIES` split on `/[;:]/` **corrupts Windows drive-letter paths** → the documented override never works. | viewer/main.js:560 | 3/3 |
| ☐ M-16 | Case-duration chart **wall-clock overlay bar overflows** the plot (secondary scaled by primary-only `max`; wall-clock ≥ active). | viewer/charts.js:43 | 3/3 |
| ☐ M-17 | Opening a **bundled example dupes it in Recents** (stored as recent + re-emitted as live example); also breaks × removal. | viewer/views/flow-view.js:491 | 3/3 |
| ☐ M-18 | **Recorder restart counter reset on every respawn defeats `max_restarts_per_session`** → crash-looping recorder restarts forever; `recorder_dead_permanent` never fires. | capture/main.js:826 | 3/3 |
| ☐ M-19 | **Crashed-recorder restart timer can spawn a 2nd recorder for a different session** and leak the process (5s timer guards only `!tracker`). | capture/main.js:870 | 3/3 |
| ☐ M-20 | **`findOrphanedSessions` unguarded `readdir` runs before the tray exists** → one unreadable engagement folder throws and the app launches with **no tray UI**. | capture/session.js:90 | 3/3 |
| ☐ M-21 | **SBOM hardcodes `0.1.0`** (apps are 0.19.0) — ships to corporate security as the authoritative bill of materials with the wrong product version. | scripts/generate-sbom.js:149 | 3/3 |
| ☐ M-22 | Rare-path slider **destroys & re-fits** the graph per drag tick (full `cy.destroy()` + dagre + `cy.fit()`), losing pan/zoom — contradicts its own comment. | viewer/map-controller.js:354 | 3/3 |
| ☐ M-23 | **Shared module-singleton DFG/BPMN viewer** across both map mounts — `fit`/`zoom`/`export` target whichever surface rendered last (the 900ms PDD-export sleep is a symptom). | viewer/dfg-viewer.js:17, viewer/bpmn-viewer.js:18 | (pass 1) |
| ☐ M-24 | `case_at` is **O(events × segments)** in anchor-mode stamping (marker-mode is single-pass). | normalization/case_assignment.py:366 | (pass 1) |
| ☐ M-25 | Config overlay parse error **silently reverts ALL saved settings** (hotkeys, OBS pw, profile) to defaults, no operator signal. | capture/config.js | (pass 1) |
| ☐ M-26 | Background OBS connect on rapid end/start can **tear down a different session's** live client; strict-path `obs_recording_start` fires before `StartRecord` confirmed. | capture/main.js:735 | (pass 1) |
| ☐ M-27 | Liveness watchdog can SIGKILL a healthy-but-quiet recorder / race a clean shutdown into a false `recorder_died`. | capture/recorder.js:135 | (pass 1) |
| ☐ M-28 | `_ts_ms` parses zone-less timestamps as **local** time, diverging from `_dt`'s UTC normalization. | normalization/classification.py:87 | (pass 1) |
| ☐ M-29 | Suggested-marker/anchor Accept/Dismiss handlers re-render manually instead of emitting topics → latent coupling for any future `markers`/`timeline` subscriber. | viewer/views/flow-view.js:1853 | (pass 1) |
| ☐ M-30 | Rare-path slider rebuilds the **entire multi-session annotation DFG** on every input event (not just on scope change). | viewer/map-controller.js:355 | 3/3 (perf) |
| ☐ M-31 | `segment_step` rescans the whole event stream per step (**O(steps × events)**, reparsing timestamps). | normalization/analysis_common.py:175 | (pass 1, perf) |

---

## ⚪ LOW

| ID | Issue | File:line | Votes |
|----|-------|-----------|-------|
| ☐ L-1 | `step_stats`/`step_variants` group by **display label**, not `step_group_key` → over-merge/fragment differently from time-study & map. | normalization/stats_compute.py:282 | 3/3 |
| ☐ L-2 | `drop_overlapping_auto_steps` skips the overlap check for **zero-duration** fresh steps → duplicate auto step survives inside an analyst-owned span (§I37). | normalization/step_suggest.py:555 | 3/3 |
| ☐ L-3 | `step_max_idle_ms` parameter accepted but **never used** (dead knob). | normalization/step_suggest.py:93 | 3/3 |
| ☐ L-4 | Waste `va`/`nva`/`elapsed` rounded **independently** → can drift 1ms from the sum invariant; accumulates into efficiency ratios >1.0. | normalization/analysis_waste.py:148 | 2/3 |
| ☐ L-5 | Template-driven sessions **re-surface the template's own anchor field** as a fresh candidate (suppression only checks the override signature). | normalization/anchor_suggest.py:321 | 3/3 |
| ☐ L-6 | `coalesce` re-parses the previous event's timestamp every iteration (parses each twice on a long burst). | normalization/coalesce.py:121 | 2/3 (perf) |
| ☐ L-7 | `+`/`-`/`0` keyboard zoom always drives the **Flow** timeline even on Steps/Phases/Map/Analysis → silent zoom desync + wasted off-screen render. | viewer/renderer.js:1040 | 3/3 |
| ☐ L-8 | `saveAnnotations` & `exportFile` **throw to the renderer** instead of `{ok:false}` → unhandled rejections + undo `_baseline` advances past a write that never persisted. | viewer/main.js:777 | 3/3 |
| ☐ L-9 | DFG layout localStorage cache **grows unbounded** and keys on an **empty-separator hash** (`['ab','c']`≡`['a','bc']`) → wrong saved positions restored. | viewer/dfg-viewer.js:33 | 2/3 |
| ☐ L-10 | Hand-rolled DFG→SVG export **drops edge frequency labels** and buries arrowheads under nodes (PDD/Figma deliverable loses the frequency info). | viewer/dfg-viewer.js:299 | 3/3 |
| ☐ L-11 | Event-filter input **rebuilds the entire uncapped event table per keystroke** with no debounce (marker filter is debounced). | viewer/views/flow-view.js:3230 | 3/3 (perf) |
| ☐ L-12 | `loadSessionIntoView` adds a fresh anonymous `loadedmetadata` listener **every load** (leaks on the persistent `#video`). | viewer/views/flow-view.js:513 | 3/3 |
| ☐ L-13 | `deriveCases` assigns one Start label to **every** case within 5s, not the closest → duplicate case labels. | viewer/views/flow-view.js:99 | 3/3 |
| ☐ L-14 | `renderPhaseTimeline` dereferences `step.time_range.start/end` with **no null guard** (sibling step timeline guards it) → one bad step aborts the phases mini-timeline. | viewer/phase-editor.js:182 | 3/3 |
| ☐ L-15 | Activity-sparkline bucketing calls `filtered.find` **twice per stat row** (O(N²·M)). | viewer/views/aggregate-view.js:507 | 3/3 (perf) |
| ☐ L-16 | `refreshTemplateVersions` sets compare defaults but **never renders the initial diff** (programmatic `.value` doesn't fire `change`). | viewer/views/template-view.js:49 | 3/3 |
| ☐ L-17 | Command-palette Enter can fire a **stale selection** inside the 50ms input debounce. | viewer/command-palette.js:49 | 2/3 |
| ☐ L-18 | App-switch **"skip first screenshot" guard is dead** (checks the value it just assigned) → every session start fires an extra screenshot. | capture/main.js:243 | 3/3 |
| ☐ L-19 | Async `tick()` in flight during `stop()`/`pause()` can emit `uncaptured_app` **after `session_end`** (and rebuild a stray `currentRun`). | capture/tracker.js:195 | 2/3 |
| ☐ L-20 | C# post-`CompleteAdding` `TryAdd` throws and is **mislogged as "serialize failed"** — misleading during shutdown investigations (confirms a real shutdown drop window). | capture/recorder/Program.cs:40 | 3/3 |
| ☐ L-21 | `count-cases.js` **drops a case on a corrupt timestamp** (NaN), diverging from the Python (`parse_ts_or_epoch` → 1970) it mirrors. | scripts/count-cases.js:44 | 3/3 |
| ☐ L-22 | `publish-release.ps1` writes release notes with a **UTF-8 BOM** → stray char atop the GitHub release body. | scripts/publish-release.ps1:103 | 3/3 |
| ☐ L-23 | (pass 1 cleanups) stale `marker_suggest` docstring weights · `canonical_match` recompiles regexes per event · `processLabel` JS non-global vs Python replace-all (safe only while rules are `$`-anchored — add `g` flag + multi-match golden) · `report-md` `fmtTs` throws on non-string · `_normalizeHandle` single-slot race · dead `run_count` in `coalesce.py` · duplicate sync-id construction. | various | (pass 1) |

---

## ✅ Refuted (recorded for the record)

| Claim | Why refuted |
|-------|-------------|
| Project save captures timeline zoom/scroll but `applyProject` never restores it | Covered by separate per-session localStorage timeline persistence (`persistTimelineForCurrent`). |
| Rare-slider clamp updates thumb but not `rareCutoff` state | By-design; `dropRareEdges` clamps internally. |
| C# writer has no guard around `Console.Out.WriteLine` → silent total data loss | Mitigated by the parent-side 90s liveness watchdog (`recorder.js`): a wedged writer goes quiet → killed & restarted. |
| C# shutdown drains queue only 1500ms → burst discarded | Pipe writes are sub-ms/line; the bounded 4096 queue drains well under 1500ms in practice. |

---

## Cross-cutting themes

1. **Phase-membership dual-representation desync** (4 sites) — highest-leverage single fix.
2. **PDD/deliverable surface is the most bug-dense** (H-2, M-5, L-10, M-21) — directly undercuts "analyst-deliverable first".
3. **Packaged / Windows-only bugs invisible to green tests** (M-14, M-15, M-21, L-21, L-22) — only bite the shipped artifact ("validate the packaged app").
4. **v0.18 Map-level extraction left state seams** (M-11, M-23).
5. **Capture data-loss / lifecycle edges** (H-3, H-6, H-7, M-18, M-20, L-19).

## Method note
Pass-2 verification had transient infra failures on the first run (a usage limit during the Verify phase dropped ~half the verifiers); the run was **resumed** (cached finders + good verifiers, only failed verifiers re-run), recovering the full 45/4 split. The Find phase was unaffected. Workflow run id: `wf_a12fa3fc-693`.
