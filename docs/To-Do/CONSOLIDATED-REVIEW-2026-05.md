# Consolidated Review Register — 2026-05-29 (v0.19.0)

**This is the single go-to to-do** merging three parallel full-codebase review sessions.
The three source files are left **untouched** as references for sanity-checking this
consolidation — every entry below carries its **original ID(s)** so it can be traced back.

| Source file | Lens | Session tag | Raw count |
|-------------|------|-------------|-----------|
| `docs/security-review-session-findings.md` | Security (untrusted session-folder → RCE/disclosure) | **[SEC]** | 2 findings |
| `docs/CODE-REVIEW-2026-05.md` | Correctness · reuse · performance | **[CR]** | ~59 (H-1..7, M-1..31, L-1..23) |
| `docs/To-Do/tech-debt-findings.md` | Maintainability / tech debt | **[TD]** | 19 items + regression map |

### How this was consolidated
- **True duplicates** (same finding, ≥2 sessions) are merged into one row tagged **MERGED**, listing every source ID.
- **Related-but-distinct** findings (same file/theme, different mechanism or remediation) are kept separate and **cross-linked** so they get fixed together.
- **Conflicts** (one session "cleared" what another flagged) are called out explicitly — see *§7 Verdict reconciliation*.
- Severity is unified to **Critical / High / Medium / Low**; original severity + votes/confidence preserved inline.
- Nothing was dropped. Refuted/cleared items are retained in *§8* so they aren't re-opened.

> **Threat model (shared anchor):** a session folder is captured on a worker machine and
> physically moved to the analyst's viewer. Folder contents (`events.jsonl`,
> `annotations.json`, screenshots, video, config) are **untrusted input**. The viewer runs
> `nodeIntegration:true` / `contextIsolation:false`, so any renderer code-execution path is
> full RCE. Severity otherwise reflects the local single-analyst model.

---

## 1. Fix-first queue (merged, recommended order)

1. **[SEC Vuln 1] Click-to-RCE** via `shell.openPath` — only RCE found; untrusted screenshot path launches an attacker-planted file. **(Critical)**
2. **[CR H-6 = TD #1] Swallowed write of durability-critical events** — failed `appendFileSync` silently drops markers/system events. **(High, quick win)**
3. **[CR H-7 ⟂ TD #2] `auto_end_idle` re-fires every 5s** on an unbounded loop — hundreds of duplicate boundary events. **(High, quick win)**
4. **[CR cluster M-1..M-4] Phase-membership desync** — one shared helper fixes 4 bugs at once. **(Highest-leverage correctness fix.)**
5. **[CR H-3] Vocab `seen_count` data loss** — every App-Library save strips frequency ranking. **(High)**
6. **[CR H-2 + M-5/M-6, SEC Vuln 2, TD #16] PDD/`pdd_export.py` hotspot** — drops unphased steps, renders hidden steps, **+ path-traversal disclosure**, + no fuzzer. Fix as one block. **(High + Medium-sec)**
7. **[CR H-1] Canonical boundary spans truncate** (`until_*` modes lose interior interactions). **(High)**
8. **[CR H-4] `idle_gap` suggestion mathematically unreachable.** **(High)**
9. **[CR H-5] `renameMarker` bypasses undo** (and corrupts the next Ctrl+Z). **(High)**
10. **[CR M-7] `coalesce` crashes the whole pipeline on one bad timestamp.** **(Medium, but pipeline-fatal)**
11. **[CR M-20] `findOrphanedSessions` can launch the app with no tray.** **(Medium, startup-fatal)**
12. **[TD #15, owned by SEC] Electron 33 EOL + `nodeIntegration`** — schedule the bump (needs packaging re-verification). **(High-sec, infra)**

---

## 2. Cross-session merges & cross-links (the sanity-check map)

**Confirmed duplicates — merged to one entry:**

| Consolidated entry | Source IDs | Note |
|---|---|---|
| Swallowed durability-critical write (`tracker.js:134`) | **[CR H-6] = [TD #1a]** | Identical finding. CR has the sharper fix (log + notify + re-queue). **TD #1 is a 3-site cluster** — the other two sites (`obs.js` GetRecordStatus, `renderer.js:651`) are NOT in CR; preserved as TD #1b / TD #1c in §3 so the merge doesn't bury them. |
| Idle auto-end misbehaviour (`capture/main.js:280-285`) | **[CR H-7] ⟂ [TD #2]** | Same code region. CR = the *bug* (re-fires every 5s → dup events). TD = the *structural risk* (unbounded `while` on mutated state). One fix (guard flag + bounded loop) resolves both lenses. |

**Related-but-distinct — kept separate, cross-linked (fix together):**

| Theme | Source IDs | Why linked |
|---|---|---|
| **`pdd_export.py` / PDD deliverable** | [SEC Vuln 2] · [CR H-2, M-5, L-10] · [TD #16] | All target the same file. The TD-#16 fuzzer is exactly what would have caught SEC Vuln 2. |
| **Suggestion-detector module** | [CR H-4, M-9, M-10, L-5] · [TD #5] | TD #5's shared `suggestion_merge.py` (+ its latent `b>=a`/`b<a` bug) is the natural home to also fix the strand bugs (M-9/M-10) and template-anchor re-surface (L-5), all at `marker_suggest.py:504` / `anchor_suggest.py:321`. |
| **DFG/BPMN viewer singleton + the 900ms sleep** | [CR M-23, M-22, M-30] · [TD #4, #10] | TD #10 flags the `900ms` sleep as a magic number; CR M-23 explains it is a *symptom* of the shared module-singleton viewer. Instancing the viewers (M-23) removes the need for the sleep. TD #4 (map-wiring duplication) is adjacent. |
| **Background-OBS / session-lifecycle concurrency** | [CR M-18, M-19, M-25, M-26, M-27] · [TD #7] | TD #7 (manifest read-modify-write race) is the same concurrency family as CR's recorder-restart and OBS-teardown races. A single `updateManifest()` helper + lifecycle guard touches most of them. |
| **`normalize.normalize()` god function** | [TD #11] · [CR M-4, M-8] | M-4 (`_merge_phases` no reconcile) and M-8 (unbounded drift markers) live *inside* the 485-line function TD #11 wants to decompose. Decompose-and-fix together. |
| **Flow timeline god function** | [TD #12] · [CR M-12] | The dead click-to-seek snap (M-12, `flow-view.js:2688`) sits inside `renderTimeline()` (`:2130-2701`) that TD #12 wants to split into lane modules. |
| **Imperative view coupling** | [CR M-29] · [TD #9] | M-29 (Accept/Dismiss re-renders manually vs topics) and TD #9 (`btn.click()` as control flow) are the same anti-pattern in the view layer. |
| **Zoom/scroll state seams (regressed S4)** | [CR M-11, L-7] · [TD §ARCH-regression] | M-11/L-7 are concrete evidence of the `S4` "scattered timeline state" issue that `ARCHITECTURE-ISSUES.md` marked resolved (see §6). |

**Reassigned ownership:**

| Item | From → To | Reason |
|---|---|---|
| **Electron 33 EOL + `nodeIntegration` hardening** ([TD #15]) | TD → **SEC-owned** | Security pass excluded "outdated libs / hardening" *by rubric*, so it never appeared on the security list despite being the top security-relevant infra item. Do not let it fall in the gap. |

---

## 3. Consolidated register — Correctness & Security bugs

### 🔴 Critical

> **Severity re-rating:** SEC rated Vuln 1 **HIGH (8/10)**; this register elevates it to
> **Critical** because it is the only RCE found and the threat model makes it a full
> code-execution path. Editorial call — original severity preserved in the row below.

| ID(s) | Layer | Issue | File:line | Fix |
|---|---|---|---|---|
| **[SEC Vuln 1]** *(orig HIGH, 8/10 → Critical here)* | Viewer | Click-to-RCE: event-controlled `data.path` from `events.jsonl` → `shell.openPath` with no containment/extension check; clicking a screenshot launches an attacker-planted file via Windows file association. | `viewer/main.js:196` ← `flow-view.js:3535` (callers `:2496`, `:3322`) | Reject absolute paths + `..`; assert resolved path under `sessionFolder/screenshots/`; verify image extension — or render screenshots in-app. |

### 🔴 High

| ID(s) | Layer | Issue | File:line | Notes |
|---|---|---|---|---|
| **[NEW VIS-1]** *(field-reported; not in the 3 original sessions)* | Viewer | **Process map overlays the Raw Events / Analysis sections** on the Session view's Map level. `.session-layout-map` (and its `.map-panel`) carried `min-height:0` — the same flex-shrink trap explicitly removed from `.session-layout-stepsphases` (commit `1833fb5`); the 360px `.map-host` shrank below content and painted down over the `<details>` siblings. | `viewer/styles.css` `.session-layout-map` (~:919) | **FIXED this pass.** Removed `min-height:0` from the map layout + panel; details now flow below the map and the view scrolls. Verified live: `mapOverlapsRaw` false on all levels, 0 page errors. |
| **[CR H-6] = [TD #1a]** | Capture | `flushEvents` swallows write errors (`catch {}`) — failed `appendFileSync` silently drops durability-critical markers/system events while UI reports success. **MERGED.** | `capture/tracker.js:134` | Quick win. Fix: on caught error for a marker/system batch → log loudly + notify + re-queue. |
| **[TD #1b]** | Capture | OBS `GetRecordStatus`/`StopRecord` failures swallowed → `recording_path` stays `null`; analyst gets video the viewer can't locate, with nothing logged. (TD-only; not in CR.) | `capture/obs.js:108-136` | Add `bootLog` on the caught error; surface a recording-path-unknown warning. |
| **[TD #1c]** | Viewer | PDD process-map image embed dropped on a caught error with no log → exported PDD shows a placeholder map, no explanation. (TD-only; not in CR.) | `viewer/renderer.js:651` | Log on the catch; contrast `map-controller.js:226` which was deliberately changed to log+show. |
| **[CR H-7] ⟂ [TD #2]** | Capture | `auto_end_idle` re-fires every 5s (no per-idle guard) → hundreds of dup boundary events; loop is also an unbounded `while` on mutated shared state. **MERGED.** | `capture/main.js:280` (`:282-285`, `:1000-1002`) | Quick win. Gate behind `autoEndedThisIdle` flag reset on `idle_end`; make the loop bounded. |
| **[CR H-3]** | Viewer | Saving an App-Library vocab strips `seen_count` (+ any unmodeled field) from every interaction → permanent loss of frequency ranking. Runs on every save. | `viewer/views/vocab-view.js:213` | Clone prior entry; overwrite only `signature`/`name`/`flags`. |
| **[CR H-2]** (+M-6) | Norm | PDD silently drops every step not rolled into a phase (`_write_steps` walks only `phase.step_ids`) → unmatched + analyst-authored steps vanish from §3.5. | `normalization/pdd_export.py:316` | Render no-phase steps under "Unphased steps". *(See pdd hotspot.)* |
| **[CR H-1]** | Norm | `until_app_change`/`until_pause`/`until_field_change` canonical spans truncate — interior non-matching interactions lost or prematurely close the span. Masked by uniform-trigger tests. | `normalization/canonical_match.py:206` | Mirror `until_next_step` absorb-interleaved branch; add interior-non-matching tests. |
| **[CR H-4]** | Norm | `idle_gap` signal can never fire a suggestion alone — `0.5*tanh(x) < 0.5` vs strict `<0.5` gate → most common unbracketed boundary never suggested. | `normalization/marker_suggest.py:405` | Raise weight above threshold or saturate idle; add single-long-idle regression. *(See detector module link.)* |
| **[CR H-5]** | Viewer | `renameMarker` bypasses `persistAnnotations`/undo — no undo entry, and stale `_baseline` makes the *next* Ctrl+Z revert the rename. | `viewer/views/flow-view.js:3766` | Route through `persistAnnotations(anno,'rename marker',["markers","timeline"])`. |

### 🟠 Medium — Correctness

**Phase-membership dual-representation desync (cluster — one shared helper fixes all 4):**

| ID | Layer | Issue | File:line |
|---|---|---|---|
| **[CR M-1]** | Viewer | Deleting a step leaves its id dangling in `phase.step_ids`. | `viewer/views/steps-view.js:435` |
| **[CR M-2]** | Viewer | Split/add-at-playhead orphans the new half (gets `phase_id`, not added to `step_ids`). | `viewer/views/steps-view.js:487` |
| **[CR M-3]** | Viewer | Merging leaves dangling ids / can drop a step from a phase. | `viewer/views/steps-view.js:623` |
| **[CR M-4]** | Norm | `_merge_phases` preserves `phase.step_ids` verbatim, no reconcile vs regenerated steps. *(Inside TD #11 god fn.)* | `normalization/normalize.py:199` |

> **Fix all four:** shared `detachStepsFromPhases(anno, idSet)` (+ survivor substitution on merge) reused across viewer delete/split/merge, plus a bidirectional reconcile pass in Python after `_merge_steps`/`_merge_phases`.

**Other Medium — Correctness:**

| ID | Layer | Issue | File:line |
|---|---|---|---|
| **[CR M-5]** | Norm | PDD renders **hidden** (noise-suppressed) steps in §3.5 & exceptions. *(pdd hotspot.)* | `normalization/pdd_export.py:314` |
| **[CR M-7]** | Norm | `coalesce_typing_bursts` uses **strict** `parse_ts` on raw stream → one bad timestamp crashes the pipeline (only stage bypassing the lenient parser). | `normalization/coalesce.py:121` |
| **[CR M-8]** | Norm | Drift markers accumulate unboundedly per re-normalize (no dedup; `canonical_step_id` never refreshed) → bloat. *(Inside TD #11.)* | `normalization/normalize.py:517` |
| **[CR M-9]** | Norm | Dismissing a suggested **Start** strands its paired **End**. *(Detector module link.)* | `normalization/marker_suggest.py:504` |
| **[CR M-10]** | Norm/Viewer | Accepting only the **Start** strands the End on re-normalize. | `marker_suggest.py:504` + `flow-view.js:1853` |
| **[CR M-11]** | Viewer | Returning to Flow/Steps/Phases from Map/Analysis resets timeline zoom to 1×/scroll 0 (zoom-less levels report fake `zoom:1`). v0.18 Map regression. *(S4 regression, §6.)* | `viewer/renderer.js:151` |
| **[CR M-12]** | Viewer | Timeline click-to-seek snap is dead (early `break` → only snaps near session start). *(Inside TD #12 god fn.)* | `viewer/views/flow-view.js:2688` |
| **[CR M-13]** | Viewer | `runNormalize` parses summary with `lastIndexOf("{")` but Python pretty-prints → grabs inner brace → `summary` silently `null` (`clusters` also dead). | `viewer/python-runner.js:154` |
| **[CR M-14]** | Viewer | `listAppVocabs` W_OK gating hides shipped vocabs on a packaged (Program Files) install. | `viewer/main.js:552` |
| **[CR M-15]** | Viewer | `PDT_APP_VOCABULARIES` split on `/[;:]/` corrupts Windows drive-letter paths → override never works. | `viewer/main.js:560` |
| **[CR M-16]** | Viewer | Case-duration chart wall-clock overlay bar overflows the plot (secondary scaled by primary-only max). | `viewer/charts.js:43` |
| **[CR M-17]** | Viewer | Opening a bundled example dupes it in Recents; breaks × removal. | `viewer/views/flow-view.js:491` |
| **[CR M-18]** | Capture | Recorder restart counter reset on every respawn defeats `max_restarts_per_session` → crash-loops forever; `recorder_dead_permanent` never fires. *(OBS/lifecycle link.)* | `capture/main.js:826` |
| **[CR M-19]** | Capture | Crashed-recorder restart timer can spawn a 2nd recorder for a different session + leak the process. | `capture/main.js:870` |
| **[CR M-20]** | Capture | `findOrphanedSessions` unguarded `readdir` before tray exists → one unreadable folder → app launches with **no tray UI**. | `capture/session.js:90` |
| **[CR M-21]** | Build | SBOM hardcodes `0.1.0` (apps are 0.19.0) → wrong version to corporate security. | `scripts/generate-sbom.js:149` |
| **[CR M-25]** | Capture | Config-overlay parse error silently reverts ALL saved settings to defaults, no operator signal. | `capture/config.js` |
| **[CR M-26]** | Capture | Background OBS connect on rapid end/start can tear down a different session's client; `obs_recording_start` fires before `StartRecord` confirmed. *(Manifest-race link, TD #7.)* | `capture/main.js:735` |
| **[CR M-27]** | Capture | Liveness watchdog can SIGKILL a healthy-but-quiet recorder / race a clean shutdown into false `recorder_died`. | `capture/recorder.js:135` |
| **[CR M-28]** | Norm | `_ts_ms` parses zone-less timestamps as **local**, diverging from `_dt` UTC. *(Refines TD "timestamp healthy" — §7.)* | `normalization/classification.py:87` |
| **[CR M-29]** | Viewer | Suggested-marker/anchor Accept/Dismiss re-render manually instead of emitting topics → latent coupling. *(TD #9 link.)* | `viewer/views/flow-view.js:1853` |

### 🟠 Medium — Performance

| ID | Layer | Issue | File:line |
|---|---|---|---|
| **[CR M-22]** | Viewer | Rare-path slider destroys & re-fits the graph per drag tick (`cy.destroy()`+dagre+`cy.fit()`), losing pan/zoom. *(Singleton link.)* | `viewer/map-controller.js:354` |
| **[CR M-23]** | Viewer | Shared module-singleton DFG/BPMN viewer across both mounts → `fit`/`zoom`/`export` target whichever rendered last (the 900ms PDD-export sleep is the symptom). *(TD #10 link.)* | `viewer/dfg-viewer.js:17`, `bpmn-viewer.js:18` |
| **[CR M-24]** | Norm | `case_at` is O(events×segments) in anchor-mode stamping. | `normalization/case_assignment.py:366` |
| **[CR M-30]** | Viewer | Rare-path slider rebuilds the entire multi-session DFG on every input event. | `viewer/map-controller.js:355` |
| **[CR M-31]** | Norm | `segment_step` rescans the whole event stream per step (O(steps×events), reparses ts). | `normalization/analysis_common.py:175` |

### ⚪ Low

| ID | Layer | Issue | File:line |
|---|---|---|---|
| **[CR L-1]** | Norm | `step_stats`/`step_variants` group by display label, not `step_group_key` → diverges from time-study & map. | `normalization/stats_compute.py:282` |
| **[CR L-2]** | Norm | `drop_overlapping_auto_steps` skips overlap check for zero-duration fresh steps → dup auto step survives. *(Detector link.)* | `normalization/step_suggest.py:555` |
| **[CR L-3]** | Norm | `step_max_idle_ms` accepted but never used (dead knob). | `normalization/step_suggest.py:93` |
| **[CR L-4]** | Norm | Waste `va`/`nva`/`elapsed` rounded independently → drifts from sum invariant; efficiency ratios >1.0. | `normalization/analysis_waste.py:148` |
| **[CR L-5]** | Norm | Template sessions re-surface the template's own anchor field as a fresh candidate (suppression only checks override signature). *(Detector link, TD #5.)* | `normalization/anchor_suggest.py:321` |
| **[CR L-6]** | Norm | `coalesce` re-parses prev event's timestamp every iteration. | `normalization/coalesce.py:121` |
| **[CR L-7]** | Viewer | `+`/`-`/`0` zoom always drives the Flow timeline even on Steps/Phases/Map/Analysis. *(S4 regression.)* | `viewer/renderer.js:1040` |
| **[CR L-8]** | Viewer | `saveAnnotations`/`exportFile` throw to renderer instead of `{ok:false}` → unhandled rejections + undo `_baseline` advances past a failed write. *(Relates TD #1 un-awaited save.)* | `viewer/main.js:777` |
| **[CR L-9]** | Viewer | DFG layout localStorage cache grows unbounded + keys on empty-separator hash (collisions). | `viewer/dfg-viewer.js:33` |
| **[CR L-10]** | Viewer | DFG→SVG export drops edge frequency labels + buries arrowheads (PDD/Figma deliverable loses info). *(pdd hotspot.)* | `viewer/dfg-viewer.js:299` |
| **[CR L-11]** | Viewer | Event-filter rebuilds the entire uncapped event table per keystroke, no debounce. | `viewer/views/flow-view.js:3230` |
| **[CR L-12]** | Viewer | `loadSessionIntoView` adds a fresh `loadedmetadata` listener every load (leaks on persistent `#video`). | `viewer/views/flow-view.js:513` |
| **[CR L-13]** | Viewer | `deriveCases` assigns one Start label to every case within 5s, not closest → dup case labels. | `viewer/views/flow-view.js:99` |
| **[CR L-14]** | Viewer | `renderPhaseTimeline` dereferences `step.time_range.start/end` with no null guard. | `viewer/phase-editor.js:182` |
| **[CR L-15]** | Viewer | Activity-sparkline calls `filtered.find` twice per stat row (O(N²·M)). | `viewer/views/aggregate-view.js:507` |
| **[CR L-16]** | Viewer | `refreshTemplateVersions` sets compare defaults but never renders the initial diff. | `viewer/views/template-view.js:49` |
| **[CR L-17]** | Viewer | Command-palette Enter can fire a stale selection inside the 50ms debounce. | `viewer/command-palette.js:49` |
| **[CR L-18]** | Capture | App-switch "skip first screenshot" guard is dead → every session start fires an extra screenshot. | `capture/main.js:243` |
| **[CR L-19]** | Capture | Async `tick()` in flight during `stop()`/`pause()` can emit `uncaptured_app` after `session_end`. | `capture/tracker.js:195` |
| **[CR L-20]** | Capture | C# post-`CompleteAdding` `TryAdd` throws, mislogged as "serialize failed" (confirms a real shutdown drop window). | `capture/recorder/Program.cs:40` |
| **[CR L-21]** | Build | `count-cases.js` drops a case on corrupt timestamp (NaN), diverges from Python `parse_ts_or_epoch`. | `scripts/count-cases.js:44` |
| **[CR L-22]** | Build | `publish-release.ps1` writes notes with a UTF-8 BOM → stray char atop GitHub release. | `scripts/publish-release.ps1:103` |
| **[CR L-23]** | Various | Pass-1 cleanups bundle: stale `marker_suggest` docstring weights · `canonical_match` recompiles regexes per event · **`processLabel` JS non-global vs Python replace-all** (add `g` + multi-match golden — *refines TD healthy verdict, §7*) · `report-md` `fmtTs` throws on non-string · `_normalizeHandle` single-slot race · dead `run_count` in `coalesce.py` · duplicate sync-id construction (`main.js:1311/1624`). | various |

### Security — Medium

| ID | Layer | Issue | File:line | Fix |
|---|---|---|---|---|
| **[SEC Vuln 2]** (7/10) | Norm | Path traversal: `session_folder / ref` with no containment; `pathlib` honors absolute + `..` → malicious `screenshot_refs` embeds off-folder image files into the exported PDD. *(pdd hotspot; TD #16 fuzzer would catch it.)* | `normalization/pdd_export.py:337` | `(session_folder/ref).resolve()`, skip unless within `session_folder.resolve()`; reject absolute `ref`. |

---

## 4. Consolidated register — Tech-debt / structural (TD-owned)

These are maintainability items, not point-bugs. Scored by TD as `(Impact+Risk)×(6−Effort)`.

| ID | Score | Item | Location |
|---|---|---|---|
| **[TD #3]** | 10 | Remove dead/contradictory `electron-builder` devDep (build uses `@electron/packager`). *(Quick win.)* | `capture/package.json`, `viewer/package.json` |
| **[TD #4]** | 24 | Extract duplicated map-controller wiring + DFG/activity-stat merge. *(Links CR M-23.)* | `renderer.js:210-323,726-753` ↔ `aggregate-view.js:76-140,495-718` |
| **[TD #5]** | 24 | Extract shared `suggestion_merge.py` (merge fns + `signature()` + excluded-range parser). **Latent bug:** validity `b>=a` vs `b<a`. *(Home for CR M-9/M-10/L-5.)* | `marker_suggest.py`, `anchor_suggest.py:321`, `step_suggest.py:38-65` |
| **[TD #6]** | 24 | Remove module-global `_last*` cache (temporal coupling of map render to call order). | `viewer/views/aggregate-view.js:206-210` |
| **[TD #7]** | 24 | Single `updateManifest(folder, fn)` helper — fixes read-modify-write race across 4 sites. *(OBS/lifecycle family, CR M-18/19/25/26/27.)* | `capture/main.js:531-536,780-782,919-923`, `obs.js` |
| **[TD #11]** | 24 | Decompose `normalize.normalize()` (~485 lines, 16 swallow-and-continue `try/except`) into named stages. *(Houses CR M-4, M-8.)* | `normalization/normalize.py:347-832` |
| **[TD #15]** | 24 | **Electron `^33.2.0` past security-support window + `nodeIntegration:true`.** **→ SEC-owned** (see §2 reassignment). | `capture/package.json`, `viewer/package.json` |
| **[TD #16]** | 20 | Add fuzzers for parsing-heavy untrusted-input modules. *(`pdd_export` fuzzer catches SEC Vuln 2.)* | `classification.py`, `canonical_match.py`, `app_vocab.py`, `pdd_export.py` |
| **[TD #12]** | 18 | Split `flow-view.js` (3,794 L); extract `renderTimeline()` 8 inline lanes (`:2130-2701`) → `timeline/lanes/*` + `marker-edits.js`. *(Houses CR M-12; see §6 regression.)* | `viewer/views/flow-view.js` |
| **[TD #13]** | 18 | Extract the two embedded HTML docs + group 18 IPC handlers out of `capture/main.js` (1,742 L). | `capture/main.js:564-655,1082-1225` |
| **[TD #14]** | 18 | Split oversized render fns: `renderAggregate()`, `renderSessionSummary()`, `buildMenu()`. | `aggregate-view.js:445-804`, `flow-view.js:820-1040`, `main.js:1339-1532` |
| **[TD #8]** | 16 | Dedup the 3× inline context-menu builder (falls out of TD #12). | `flow-view.js:1661,2778`, `steps-view.js:1018` |
| **[TD #9]** | 16 | Replace `btn.click()`-as-control-flow with direct calls. *(Same anti-pattern as CR M-29.)* | `flow-view.js:1543,1637,1699`, `aggregate-view.js:1371`, `template-view.js:772` |
| **[TD #10]** | 16 | Name scattered timing magic numbers (`setTimeout(…,50)`×6, `900`, 500ms batch flush, BPMN filename map ×3). *(The 900 is CR M-23's symptom.)* | `map-controller.js`, `renderer.js:783`, `tracker.js:163` |
| **[TD #17]** | 16 | Bump bundled Python off stale 3.11.9 patch; add a resolved lockfile (deps are floor-only). | `scripts/build-python-embeddable.ps1`, `requirements.txt` |
| **[TD #18]** | 16 | ~12k LOC of viewer views/controllers + entire `capture/main.js` have zero unit coverage. Mitigate by unit-testing seams extracted during #11–#14. | `viewer/views/*`, `renderer.js`, `capture/main.js` |
| **[TD #19]** | 12 | Migrate unmaintained `dagre 0.8.5` → `@dagrejs/dagre`. | `viewer/package.json` |

---

## 5. Consolidated remediation plan (phased)

- **Phase A — Quick wins / safety (this sprint).** CR H-6(=TD #1), CR H-7(⟂TD #2), TD #3, CR M-21 (SBOM version), CR L-22 (BOM). Near-zero risk.
- **Phase B — Top correctness (next sprint).** The phase-membership helper (CR M-1..M-4), CR H-3 vocab, the **PDD hotspot block** (CR H-2/M-5/M-6 + SEC Vuln 2 + TD #16), CR H-1, CR H-4, CR H-5, CR M-7, CR M-20.
- **Phase C — Security infra (scheduled, needs packaging re-verify).** SEC Vuln 1 (RCE), TD #15 (Electron bump), TD #17 (Python pin/lock).
- **Phase D — Dedup & decouple.** TD #4, #5 (+ CR M-9/M-10/L-5), #6, #7 (+ OBS/lifecycle CR M-18/19/25/26/27), #8, #9 (+CR M-29), #10. The DFG-singleton fix (CR M-23) lands here and removes the 900ms sleep.
- **Phase E — God-file epics (opportunistic).** TD #11 (+CR M-4/M-8), #12 (+CR M-12), #13, #14, with #18 (unit-test the extracted seams). Enforce composition discipline (file/function length cap) — see §6.
- **Phase F — Long tail.** Remaining Medium-perf + Low items, batched by file.

> **Sequencing rule (from TD):** dedup (D) before god-file splits (E) — dedup removes code that would otherwise be moved twice.

### Cross-cutting themes (carried from CR — use for prioritization)

1. **Phase-membership dual-representation desync** (CR M-1..M-4) — one helper fixes 4 bugs.
2. **PDD/deliverable surface is the most bug-dense** (CR H-2, M-5, L-10, M-21 + SEC Vuln 2) — directly undercuts "analyst-deliverable first."
3. **Packaged / Windows-only bugs invisible to green tests** (CR M-14, M-15, M-21, L-21, L-22) — only bite the shipped artifact. Aligns with CLAUDE.md's "validate the packaged app" rule; these will pass every unit suite.
4. **v0.18 Map-level extraction left state seams** (CR M-11, M-23) — see the S4 regression in §6.
5. **Capture data-loss / lifecycle edges** (CR H-3, H-6, H-7, M-18, M-20, L-19 + TD #1b/#1c).

---

## 6. Architecture regression context (from TD vs `ARCHITECTURE-ISSUES.md`)

`docs/ARCHITECTURE-ISSUES.md` is a **RESOLVED** register from the May viewer refactor
(ADR-0003/0004). TD's comparison shows the closed structural debt **partially re-accreted** —
relevant because several CR bugs live in exactly the re-grown code:

| Old ID | Claimed fix | Now | Live bugs in that code |
|---|---|---|---|
| **S1** | renderer.js → ~1,200 L | `flow-view.js` re-grew to **3,794 L** | CR H-5, M-12, M-17, L-11/12/13 |
| **S3** | `renderTimeline()` → lane plugins (was 432 L) | now **570 L**, lanes inline again | CR M-12 (dead snap) |
| **S8** | lane-plugin contract | lanes accreting inline | — |
| **S4** | view-state → `state.js` | module-global cache (TD #6) | CR M-11, L-7 (zoom desync) |
| **S7** | `Pdt*` globals → CommonJS | cyclic `require()` (`steps-view.js:278`) | — |

**Implication:** TD #12 must enforce a **composition discipline** (lint cap on file/function
length, or lanes physically under `timeline/lanes/`) or the debt returns a third time.
S2 (shared `timeline-core.js`), S5, S6 are confirmed **still resolved** — leave them.

---

## 7. Verdict reconciliation (where sessions disagreed — resolve here)

- **TD cleared "timestamp handling" as healthy** (consolidated in `_dt.py`, golden-pinned). **CR found 3 real exceptions** to that verdict: M-7 (`coalesce` bypasses the lenient parser), M-28 (`classification._ts_ms` parses zone-less as local), and L-23's `processLabel` JS-non-global edge. → **The `_dt` core is healthy; specific call-sites diverge from it.** Fix the call-sites (CR), keep the core.
- **TD cleared `process_label` Py↔JS as "well-controlled"** (shared JSON + golden). **CR L-23** found the JS uses non-global `replace` vs Python replace-all — safe only while rules are `$`-anchored. → **Data contract is sound; add a `g` flag + a multi-match golden case** so the implementation can't drift.
- **TD predicted security overlap on #1/#2/#7; SEC raised none.** SEC confirmed: silent-swallow isn't a vuln, the unbounded loop is DoS-class (excluded), the manifest race is non-exploitable TOCTOU. → These stay **TD/CR-owned, not security**.
- **C# recorder:** TD cleared it HEALTHY; SEC independently found it clean (no file I/O, no `Process.Start`, no unsafe deserialization). Two lenses agree → **leave it** (only CR L-20, a cosmetic mislog, remains).

---

## 8. Cleared / refuted — do NOT re-open

**Refuted by CR (with reason):**
- "Project save captures zoom/scroll but never restores" — covered by per-session localStorage (`persistTimelineForCurrent`).
- "Rare-slider clamp updates thumb not state" — by-design; `dropRareEdges` clamps internally.
- "C# writer no guard around `Console.Out.WriteLine`" — mitigated by the 90s parent-side liveness watchdog.
- "C# shutdown drains only 1500ms → burst discarded" — pipe writes sub-ms/line; 4096 queue drains well under 1500ms.

**Cleared by SEC (likely false-positives if re-raised):**
- `viewer/main.js:195` `shell.showItemInFolder` — highlights only, no execution.
- `external_video.path` → `file://` `<video>` — media-decode only, not RCE (LOW).
- `pdd_export.py:223` `process_map_image` — source is analyst-controlled `--pdd-map-image` CLI flag, not session data.
- Python-embeddable download — HTTPS from hardcoded trusted hosts.
- Electron config (`webSecurity:true`, deny-all window handler, CSP, no webview/remote/auto-update) — clean.
- Renderer XSS→RCE — consistent escaping at all `innerHTML` sinks; no `eval`/`new Function` (one cosmetic note: `bpmn-viewer.js:201` unescaped error message, non-exploitable).

**Cleared by TD (do not re-flag as new debt):** `process_label` data contract (golden-pinned), `_dt` timestamp core, C# recorder factoring, `tracker.js` factoring (except H-6), no TODO/FIXME debt. *(See §7 for the call-site caveats CR added.)*

---

## 9. Coverage map & open gaps

| Area | Security | Code review | Tech debt |
|---|:--:|:--:|:--:|
| Viewer (Electron) | ✓ (XSS/RCE) | ✓✓ | ✓✓ |
| Capture (Electron) | ✓ | ✓✓ | ✓ |
| Normalization (Python) | ✓ | ✓✓ | ✓ |
| C# recorder | ✓ | ✓ | ✓ (cleared) |
| Build/release scripts | ✓ | ✓ | partial |
| **Design system / UI visual** (D1-D3, R1-R4 in `ARCHITECTURE-ISSUES.md`) | ✗ | ✗ | ✗ |

**Open gap:** no session covered the **design-system / visual** lens (palette, contrast, UI
clarity). `ARCHITECTURE-ISSUES.md` says D1-D3/R1-R4 were superseded by ADR-0004, but **none of
the three sessions verified the running UI's visuals**. If that matters, it needs a 4th pass.

---

## 10. Provenance / sanity-check notes

- Source files are **unmodified** — diff this register against them to verify nothing was lost.
- Every entry preserves its original ID; merged entries list all source IDs.
- **Counts to reconcile** *(corrected after the verify pass)*:
  - **SEC = 2** vulns (+ reconciliation notes → §7/§8).
  - **CR = 61 ID rows** (H-1..7 = 7, M-1..31 = 31, L-1..23 = 23). Note: **M-6 is a pointer to
    H-2** (not a distinct finding) and **L-23 bundles ~7 pass-1 cleanups**, which is why CR's
    own prose says "~59 distinct."
  - **TD = 19** items — but **TD #1 is a 3-site cluster** (1a tracker / 1b obs / 1c renderer),
    so it contributes 3 line items, not 1.
  - **True collisions:** only **CR H-6 = TD #1a** is a strict duplicate (−1). **CR H-7 ⟂ TD #2**
    is *complementary* (a behavioral bug + a structural risk in the same code) — fixed together
    but arguably two items, so the distinct count is **~80 line items ±1** depending on how you
    count that pair and the L-23 bundle. The point of this register is completeness, not a
    single tidy integer.
  - **Verify-pass fixes applied (2026-05-29):** restored TD #1b (`obs.js` GetRecordStatus) and
    TD #1c (`renderer.js:651`) that the initial merge had buried; fixed a dangling "C-2"
    reference in §2; annotated the Vuln 1 HIGH→Critical re-rating.
- CR Pass-2 method note: a transient usage-limit dropped ~half the verifiers on first run;
  resumed run recovered the full 45/4 confirmed/refuted split (workflow `wf_a12fa3fc-693`).
