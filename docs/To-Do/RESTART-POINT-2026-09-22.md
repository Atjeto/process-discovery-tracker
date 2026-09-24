# Restart point: 2026-09-22

> **What this is.** A dated recovery and restart baseline, written after roughly
> three months with no work on the project (last commit 2026-07-03). It records
> the exact state the rebuild starts from: the code identity, the plan-of-record
> status, a measured health baseline, a full code review, and which earlier audit
> items are still open. The owner intends to discuss a different approach before
> any work begins; this file is the fixed reference point for that discussion and
> for anything built afterwards.
>
> **Status:** snapshot, not a plan. Nothing here is a decision. Recommendations in
> section 7 are inputs to the discussion.
>
> **Produced by:** a read-only review session on 2026-09-22 (git history, docs,
> the surviving session transcript, local and CI test runs, two parallel read-only
> code-review lanes, coordinator verification of every critical and high finding).
> No code, test, or other doc was changed to produce it.

---

## 0. Identity of the restart point

| Item | Value |
|---|---|
| Branch | `master`, equal to `origin/master` |
| Commit | `8e14c95` "Release v1.5.0" (2026-07-03 22:10 +0200) |
| Tag | `v1.5.0` |
| Published | GitHub release "Process Discovery Tracker v1.5.0", marked Latest, 2026-07-03 20:22 UTC |
| Local packages | `dist/release/capture-v1.5.0.zip` (217,057,351 B), `dist/release/viewer-v1.5.0.zip` (210,175,579 B), built 2026-07-03 (gitignored, this machine only) |
| Untracked files | `AGENTS.md` only (see section 6) |
| Stashes | none |

**To return here:** `git switch -c <name> v1.5.0` (or `git checkout v1.5.0`). The
committed demo corpus and goldens at this commit reproduce the section 3 numbers.

---

## 1. How we got here

| Date | Event | Source |
|---|---|---|
| 2026-06-28 | v1.3.0 released (lab phases G+H, tech-debt fuzzers) | CHANGELOG, tags |
| 2026-07-01/02 | Design critique, disclosure pass; v1.4.0 released 2026-07-02 | CHANGELOG, `DESIGN-CRITIQUE-2026-07-01.md` |
| 2026-07-02/03 | Owner usability critique ("struggled for months to sit down and annotate"); approachability redesign planned and built as R1 to R4 by 7 sequential agents on `redesign-r1`; nav audit + fixes; deliverable audit; perf-ceiling note; real-data vitals STOP; skills-pack snapshot | git log `c9c6d27..8e14c95`, `.claude/agent-findings/2026-07-03_r-cycle-delegation.md` |
| 2026-07-03 | v1.5.0 released (fast-forward of `redesign-r1` into `master`) | reflog, tag |
| 2026-07-10 | Read-only feature value audit (every surface tagged keep / gate / demote / rewrite / delete / watch). Found no delete-now surface; produced an 8-item sharp list (section 5.2). Committed nothing | surviving session transcript |
| 2026-08-09 | `AGENTS.md` created (untracked; a Codex copy of CLAUDE.md) | file mtime |
| 2026-09-22 | This review | this file |

Session sources: the Claude desktop sessions for this project were "App design
critique and requirements" (last activity 2026-07-02), "App usability and
information overload review" (2026-07-02 to 2026-07-05), and "App feature audit and
value assessment" (2026-07-10). Only the 2026-07-10 transcript is still on disk;
the other two aged off, so that period was reconstructed from git, docs, and the
findings register. Sessions after 2026-07-03 produced no commits.

---

## 2. Plan-of-record status

The operational plan of record is
[APPROACHABILITY-REDESIGN-2026-07-03.md](APPROACHABILITY-REDESIGN-2026-07-03.md)
(NEXT-SESSION-SPEC.md defers to it).

| Phase | Status |
|---|---|
| R1 Subtract | Built (v1.5.0) |
| R2 Match workbench | Built (v1.5.0); its owner real-session gate never ran |
| R3 Case x screen work items (ADR-0028) | Built (v1.5.0); real-session gate never ran; see RP-01, the headline defect of this baseline |
| R4 Workflow spine (next-act rail) | Built (v1.5.0); real-session gate never ran |
| R5 Prove and prune | **Not started.** Needs three real captures, timed sit-downs, and the border ledger ([R5-SITDOWN-RUNBOOK.md](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/To-Do/R5-SITDOWN-RUNBOOK.md), on branch `product-edition`) |

**Why R5 never started:** the only "real" captures on the dev box are two e2e
plumbing runs of about 25 seconds each
([REAL-DATA-VITALS-2026-07-03.md](REAL-DATA-VITALS-2026-07-03.md) stopped on them).
R5 needs owner-recorded sessions from the work laptop (real estate apps, 10 to 45
minutes, at least ~100 interactions, at least 2 cases, markers fired).

**CLAUDE.md is stale at this point:** its "START HERE" block still says v1.4.0 and
does not mention v1.5.0, the approachability redesign, or R5.

---

## 3. Health baseline (measured 2026-09-22)

### 3.1 Environment at measurement

| Tool | Version |
|---|---|
| Node | v24.14.1 |
| System Python (pytest) | 3.14.3; has pytest, lacks pandas/pm4py, so pipeline-importing tests skip |
| Bundled Python (`viewer/python`) | 3.11.9 |
| .NET | SDK 10.0.201 only (the .NET 8 SDK is gone); runtimes 8.0.19 and 10.0.5 present; the recorder (net8.0) still builds and tests with SDK 10 |
| Electron (both apps) | ^42.3.0 |
| playwright-core (e2e) | ^1.60.0 |

### 3.2 Local suites

| Gate | Command | Result |
|---|---|---|
| Viewer unit | `cd viewer && node --test` | 400 pass, 0 fail (89 s) |
| Capture unit | `cd capture && node --test` | 143 pass, 1 skip (playwright-driven recorder test), 0 fail |
| Pipeline pytest | `python -m pytest normalization/test/ -q` | 537 pass, **11 skip**; the skipped set is the pipeline-importing tests, including the 3 that fail on CI |
| Session golden | `viewer/python/python.exe normalization/golden_check.py` | 10/10 demo sessions OK |
| e2e session smoke | `cd e2e && node session-smoke.js` | **32/33**; 1 deterministic failure (CI-3), reproduced twice |
| C# recorder | `cd capture/recorder/Recorder.Tests && dotnet test` | 69 pass, 0 fail |

All runs left the working tree unchanged (verified against a pre-run `git status` snapshot).

### 3.3 CI on master (GitHub Actions, windows-latest, full pipeline deps)

CI has been red on every push since mid-June, unnoticed, because local runs skip
exactly the tests that fail there.

| Workflow | Last green | First red | At v1.5.0 |
|---|---|---|---|
| pytest | `2d57bd9` (v1.1.0, 2026-06-10) | `0a7b0cb` (v1.2.0 stamp, 2026-06-11) | 3 failed, 577 passed |
| JS syntax + unit | `b359b2c` (2026-06-09) | the push carrying `1795d14`/`dc6cda7` (Phase E, readiness probe, 2026-06-10) | capture tests 96-98 cancelled |
| e2e session smoke | `62020bf` (v1.4.0) | `8e14c95` (v1.5.0) | 30/33 |

Root causes (coordinator-verified):

- **CI-1 (pytest, stale tests).** Phase F2 (`a87b292`) reworded three PDD notes
  ("What the capture measured" became "What the recording measured"; the efficiency
  and case-based "withheld" notes were rephrased). `test_pdd_export.py:164`, `:368`,
  `:398` still assert the old wording. The gates themselves hold: the "not rendered"
  asserts in the same tests pass.
- **CI-2 (JS, test-only race).** `capture/readiness.js:297-302` `withTimeout` calls
  `unref()` on its only timer; the ready:false fake in
  `capture/test/readiness.test.js:80-93` holds no handle, so on CI the event loop
  drains before the 50 ms timeout fires ("Promise resolution is still pending but
  the event loop has already resolved"), cancelling tests 96-98. The shipped app is
  unaffected (the real recorder child keeps the loop alive).
- **CI-3 (e2e, real UI defect).** "reference map: Edit -> Save -> reload round-trips
  the edit" fails because the Raw events drawer's `<summary>`
  (`details.event-table-host`) intercepts clicks on the reference-map gallery's
  Edit button (`#refmap-list [data-rm-act="edit"]`); Playwright retried for 30 s. A
  saved reference map cannot be reopened for editing at the smoke's viewport. The
  drawer layout was changed by the 2026-07-03 nav-audit fix (`4d4dca3`).
- **CI-4 (e2e, timing flakes).** The other two v1.5.0 CI e2e failures ("Where the
  time goes" row expand, finding-card Confirm) pass locally.

### 3.4 Dependencies and platform

- **npm audit, runtime deps.** `js-yaml` 4.0.0-4.3.1 high (quadratic DoS via merge
  keys) is a direct dependency of both apps; fix is non-major. The capture app also
  has 1 critical (`tar`), 2 more high (`brace-expansion`, `ip-address`) and 5
  moderate advisories, all through `active-win`'s install-time build chain
  (node-gyp, cacache, make-fetch-happen); clearing them needs `active-win` 7.7.2, a
  major bump. Dev-only: `@xmldom/xmldom` high advisories via
  `@electron/packager` > `plist`. e2e: 0.
- **.NET 8 support ends in November 2026** (the recorder's target framework).

---

## 4. Code review

**Method.** Two read-only review lanes (model claude-opus-5-5 each): lane A
`viewer/` + `e2e/`; lane B `normalization/` + `shared/` + `capture/` + `scripts/`.
Both read the July diff (`911da9a..8e14c95`) in depth and swept the rest. The
coordinator then re-verified every critical and high finding against the code.

**Legend.** **V** = verified by the coordinator against the code on 2026-09-22.
**R** = reviewer-confirmed (code path traced or reproduced by probe).
**P** = plausible (reasoning only, not reproduced). IDs are stable references for
later discussion.

### 4.1 Critical and high

| ID | Sev | Ev | Location | Defect and failure scenario |
|---|---|---|---|---|
| RP-01 | critical | V | `normalization/case_assignment.py:53` | Marker-mode cases get a fresh `uuid4` on every normalize run. Work-item annotations (`group_annotations`) are keyed by `(case_id, screen_key)` and nothing remaps them. Analyze re-runs normalize, and so do memo and PDD export (`viewer/views/overview-view.js` `_exportMemo`, `viewer/renderer.js` PDD path). So analyst work-item names vanish from the memo, the PDD, and the viewer after any re-analyze or export, leaving orphans. Preserved edited/manual steps keep their old `case_id` (`step_suggest.py:753-767` restamps only `process_label` and `grain_keys`) and show up as a ghost case. Anchor mode is stable (`uuid5`, `:268`). This is the v1.5.0 headline feature (R3) losing data, and R5's act 5 (export the memo) would hit it on the first sit-down. |
| RP-02 | high | V | `viewer/process-map-levels.js:197-199`, node keying in `buildAnnotationDfg` (about `:331`), fed by `viewer/renderer.js:408-410` | Map nodes are keyed by display label, and at the default screen grain the label is the work-item name when one exists. Naming one case's visit splits that screen into two nodes (two starts, half-weight edges); two different screens given the same name merge. Breaks "one logical screen = one node"; the e2e connectivity pin cannot see it (demo sessions have no `group_annotations`). |
| RP-03 | high | V | `normalization/pdd_export.py:459-461` | The work-item branch returns before the phases block (`:463-480`), so phase names and descriptions disappear from the PDD for any session with cases, annotated or not. The comment at `:457-458` claims a `grain_keys` condition that is not checked. The deliverable audit's "byte-identical without annotations" holds for the memo, not the PDD. No test covers phases together with cases. |
| RP-04 | high | V | `normalization/session_io.py:104-118`; `viewer/main.js:991-1020`, `:412-415`, `:905-909`, `:1036-1040` | annotations.json is fragile on both sides. Python returns `{}` on a parse error with no message and writes non-atomically. The viewer renames the file into its backup rotation, then writes the new one non-atomically; about 30 of 46 save call sites have no catch; a corrupt file is treated as absent and two other writers overwrite it with a near-empty object. Cancel during analysis (`python-runner.js:128-133`) can truncate the file; the next Analyze silently rebuilds from nothing (manual steps, phases, group annotations, memo selection, ROI inputs). Only recovery: copying back `annotations.json.2` to `.5`. |
| RP-05 | high | V | `viewer/views/template-view.js:163` | A Process Template's `version` is concatenated into `innerHTML` unescaped. With `nodeIntegration: true` and CSP `script-src 'self' 'unsafe-inline'` (`viewer/index.html:5`), opening a crafted template YAML runs code. |

### 4.2 Medium

Deliverables and exports:

| ID | Ev | Location | Defect |
|---|---|---|---|
| RP-06 | R | `pdd_export.py:426-440`, `memo_export.py:332-346` | Work items the analyst hid are still rendered in PDD section 4.5 and, if named, in the memo (and PDD section 1). |
| RP-07 | R (sleep part P) | `capture/tracker.js:257-272`, `facts.py:258-270`, `memo_export.py:105-125`, `:283` | The memo's "Active time" is foreground time including idle and sleep (runs never close on idle, no suspend/resume handling), printed next to "Idle time" as if disjoint. |
| RP-08 | R | `findings.py:349-351` | The re-keyed-value finding prints the raw typed value into the memo and PDD section 1; only PII-named fields are masked, so a customer name or ID typed in two apps appears verbatim. |
| RP-09 | R | `normalize.py:209-210`, `pipeline_stages.py:688-689`, `overview-view.js:635-645` | A failed memo/PDD export logs a WARNING and exits 0; the viewer reports success and opens the previous `memo.docx`. |
| RP-10 | R | `pipeline_stages.py:556-568`, `memo_export.py:160-170` | A pipeline stage failure is rendered as a measured negative: findings stage throws gives "Nothing stood out"; facts stage throws gives zeros under "Every number above was measured". The `provisional` flag (`:528`) is read by nothing. |

Steps and work items:

| ID | Ev | Location | Defect |
|---|---|---|---|
| RP-11 | R, spot-checked V | `viewer/views/steps-view.js:590` | The work-item Name box is pre-filled with the automatic label, so any Save stores it as an analyst name; `memo_export.py:336` then treats the item as named. |
| RP-12 | R | `viewer/renderer.js:1363-1382`, `steps-view.js:548` | In the case tree, clicking a work item invisibly selects its first fragment; the single-key shortcuts (m, s, Alt+arrows) then mutate that fragment. A merge can reach into another screen or case and reassign interactions. |
| RP-13 | R | `steps-view.js:269-283`, `:352`, `renderCaseTree` `:469-497` | Arrivals ("Open in Steps", Flow jumps, returning to Steps) do nothing at the default grain; the leftover reveal flag later causes an unrequested scroll. The e2e pin tests only the element grain. |
| RP-14 | R | `steps-view.js:271`, `:481` | The case tree is built from the filtered step list while the filter controls are hidden; filters are never reset, even across sessions; can falsely show "This session isn't split into cases yet". |

Next-act rail:

| ID | Ev | Location | Defect |
|---|---|---|---|
| RP-15 | R, spot-checked V | `viewer/next-act-rail.js:56-57`, `:63` | Act 3 ("Walk the story") checks boolean fields the viewer never writes (`manually_authored === true`, array `flags`); real edits use `state: "edited"` / `"manually_authored"` and object flags, so real work is ignored. The unit test uses the unreal shape. |
| RP-16 | R | `vocab-match.js:486-499`, `next-act-rail.js:113`, `overview-view.js:532` | Act 1 ("Name what the recorder saw") is effectively uncompletable: it counts controls in apps no vocabulary covers and controls with no usable identity; the count is cached per folder and never refreshes after naming and re-analyzing. |

Viewer / pipeline mirrors:

| ID | Ev | Location | Defect |
|---|---|---|---|
| RP-17 | R | `viewer/vocab-match.js:134-140` | Vocabulary regexes valid only in Python (`(?i)`, `(?P<name>...)`) fail to compile in JS and silently count as non-matching; the workbench shows every rule dead while the pipeline matches. |
| RP-18 | R | `step_suggest.py:814-836` vs `process-map-levels.js:82-90` | The shared screen-label rules behave differently on non-ASCII titles (Python `\b`/`\d` are Unicode, JS ASCII; JS `\s` matches U+FEFF). 7 of 54 probe titles differ, so names set in the viewer do not reach the exports and PDD headings print record numbers. Goldens have no non-ASCII rows. |

Vocab and capture:

| ID | Ev | Location | Defect |
|---|---|---|---|
| RP-19 | R | `viewer/views/vocab-view.js:1451`, `:1522`, `:1526` | Cancelling "Discard unsaved changes?" makes `selectVocab` return silently; callers ("Start from a recording", "Add to App Library") continue with the old dirty vocabulary. |
| RP-20 | R, spot-checked V | `capture/main.js:1006` | The recorder restart counter resets on every successful spawn, including auto-restarts, so the 3-restart cap is never reached and `recorder_dead_permanent` never fires; a crash-looping recorder restarts every ~5 s all session. |
| RP-21 | R | `capture/tracker.js:168-172` | A failed write batch with no marker or system event drops its interactions with only a boot.log line (no counter, no notice, no durable gap event). |

### 4.3 Low

| ID | Ev | Location | Defect |
|---|---|---|---|
| RP-22 | R | `capture/recorder.js:104-158` | No `'error'` listener on the recorder child: a spawn failure produces no `recorder_died` and no restart, while events.jsonl already records `recorder_start`. |
| RP-23 | P | `capture/recorder.js:200-211`, `main.js:1105-1174` | `stop()` resolves on `'exit'`, not `'close'`; final piped values can be dropped after `tracker = null`. |
| RP-24 | P | `capture/recorder/UiaSubscriber.cs:286-300` | Typed-value debounce race: a value can land on a removed entry; `Timer.Change` on a disposed timer may throw inside a UIA callback. |
| RP-25 | R | `normalization/analysis_roi.py:268-293` | `negative_net_count` is computed and never read; PDD section 5.4 can show negative rows while the total silently sums only positives. |
| RP-26 | R | memo_export.py:160-185, findings.py:307 | Repetition findings are tier 2 but shown ungated and unlabeled in the memo, even with no cases. |
| RP-27 | P | `scripts/inspect-events.js:73`, `:97` | The "structure-only" script prints `automation_id` tallies and samples; web DOM ids can embed record ids (data-governance risk). |
| RP-28 | R | `viewer/vocab-match.js:546-576` | The suggested screen regex over-fits sequential record numbers (INC0010010/11 yields a prefix that INC0010020 does not match). |
| RP-29 | R | `steps-view.js:517`, `work-items.js:159-160` | "Hide" on a work item only dims it; it stays in counts, durations, map and timeline, contrary to its button text. |
| RP-30 | R | `vocab-view.js:808` vs `:821-823` | Named or ignored candidates reappear after "Show N more". |
| RP-31 | R | `overview-view.js:545` | If the unnamed-control count fails it becomes 0, so act 1 reads as done. |
| RP-32 | R | `viewer/main.js:843-855` | `viewer:writeVocab` writes non-atomically despite its comment. |
| RP-33 | R | `viewer/session.js:158` | A non-array `group_annotations` makes `.push` throw silently inside a click handler. |
| RP-34 | P | `viewer/views/flow-view.js:159` | Case id unescaped in an `<option value>`; needs a crafted annotations file. |
| RP-35 | R | `viewer/vocab-match.js:395-396` | Comment claims the raw event stream is PII-masked; the viewer loads raw events.jsonl, so workbench example values are raw. |
| RP-36 | R | `e2e/*.js` | `electron.launch` passes no `--user-data-dir`, so smokes share the dev profile's localStorage and overwrite the owner's data-posture setting. |

### 4.4 Seams (cross-layer contract risks)

- `screen_key` also changes when an App Vocabulary starts matching (the key prefers
  `screen_id`, `step_suggest.py:149-153`) or when the shared screen rules change;
  `shared/SCHEMA.md:274` claims it is stable across re-analyze. Same orphaning class
  as RP-01. `next-act-rail.js:58` counts orphaned annotations as analyst work.
- `SCHEMA.md:276-277` and ADR-0028 sections 2 and 4 say normalization and exports
  never read `group_annotations`; stale since `a23dfcc`. `SCHEMA.md:1076` says every
  `case_id` is a v4 UUID; anchor ids are uuid5.
- The memo's variant count uses `step_variants` (`memo_export.py:237`); PDD section
  6.1 uses `trace_variants` (`pdd_export.py:722`).
- Nested markers: `analysis_segments` uses the innermost case (`cids[0]`); steps,
  stats and XES use the outermost (`cids[-1]`).
- Python `work_items` sorts timestamps as strings, JS parses dates; equivalent only
  while all timestamps are fixed-width `toISOString`.
- Python `work_items.screen_key` falls back to `"scr:(screen)"` without `grain_keys`
  (`work_items.py:38`); JS falls back to the step's interactions. On sessions
  analyzed before `grain_keys` existed, viewer names never reach the exports.
- YAML dialects: js-yaml (1.2) vs PyYAML (1.1) disagree on unquoted `yes/no/on/off`
  in hand-written vocabularies.
- `appVocabDefaultDir` (`viewer/main.js:678-697`) requires the shipped vocab folder
  to be writable; on a read-only install the viewer lists no shipped vocabularies
  while the pipeline loads them.
- `find_group_annotation`: Python treats `case_id: ""` as None; JS does not.
- Export-success contract: Python exits 0 on a failed export and the viewer trusts
  `r.ok` (RP-09).

### 4.5 Leads not investigated

- `manifest.json` is written non-atomically (`capture/session.js:57`, `:87`) and
  `load_manifest` raises on bad JSON.
- The dead-man monitor treats a stats heartbeat as alive; a recorder whose UIA
  subscribe failed at hello (`Program.cs:122-124`) heartbeats with zero interactions.
- `pii_masking` masks `selected_value` but not `name`, which the recorder can set to
  the same text; window titles are never masked and reach PDD headings and step names.
- Interactions queued before a pause are appended after the `paused` event.
- Under persistent disk-full the critical-event retry queue grows without bound and
  toasts every 500 ms.
- The anchor-case guard dropping a short "sliver" case leaves its interactions caseless.
- The Overview stays interactive during Export memo / Analyze; edits made meanwhile
  are probably lost on the reload that follows.
- The rail's "Judge the time sinks" opens a module whose judgment editor is
  read-only at the default screen grain.
- `renderer.js` onReanalyze polling gives up after 2 s if the confirm dialog is open,
  or after 60 s.
- dfg-viewer edge ids `${source}__${target}` can collide on labels containing `__`.
- `_wiSelected` / `_wiExpandedCases` are never reset when a new session loads.

### 4.6 Checked and sound

- `load_events`: bad bytes replaced, non-object lines dropped and counted, deterministic sort.
- Screenshot references are contained to the session folder in both exports.
- Recorder redacts password fields and suppresses OCR on them; PDT's own windows are filtered.
- Recorder exits when stdin closes (cannot orphan); readline buffers partial lines; 90 s watchdog.
- Marker and system events flush synchronously and are re-queued on failure.
- ROI realism factors clamped, no invented wage, observed-count floor flagged.
- HTML escaping in the July surfaces (workbench, case tree, rail, finding cards,
  modals, LLM import checklist) is consistent; the scan found only RP-05 and RP-34.
- Python spawn uses an argument array, no shell, absolute session path.
- `openExternal` / `openDiagram` validate paths; deny-all window-open handler;
  will-navigate guard; CSP `connect-src 'none'`.
- `work-items.js` grouping matches ADR-0028 and its Python twin on ASCII inputs;
  `vocab-match` core semantics match `app_vocab.py` for Python-compatible patterns.
- The 2026-07-03 nav-audit fixes hold (rail App Library button, side-by-side toggle,
  map node selection).

---

## 5. Earlier audits: what is still open

### 5.1 [DELIVERABLE-AUDIT-2026-07-03](DELIVERABLE-AUDIT-2026-07-03.md) top gaps

No normalization code changed after that audit.

| # | Status | Location | Note |
|---|---|---|---|
| 1 | OPEN | `pdd_export.py:641-707` | Full ROI table and "Estimated total" render whenever candidates exist; `needs_input` only adds a note. The viewer gates the whole section. |
| 2 | OPEN | `findings.py:266`, `pdd_export.py:550-592` | Findings 3-5 duplicate the section 5.3 candidates. |
| 3 | OPEN | `findings.py:85-95`, `pdd_export.py:592`, `:744`, `:761` | Raw process tokens in business prose; only ".exe" stripped. |
| 4 | OPEN | `pdd_export.py:739-745` | Single-occurrence "variations" listed with no frequency floor. |
| 5 | OPEN | `pdd_export.py:362-383` | Two overlapping time tables. |
| 6 | OPEN | `pdd_export.py:377`, `:383` | Median column at tiny N. |
| 7 | OPEN (premise partly wrong) | `memo_export.py:231` vs `pdd_export.py:323` | The memo already labels wall clock; the PDD mixes `active_ms or wall_clock_ms` case by case. |
| 8 | OPEN | `memo_export.py:121-122` | Re-typed values and repeated sequences merged in one cell. |
| 9 | OPEN | `memo_export.py:111-113`, `findings.py:217`, `facts.py:291` | Per-hour rate with no minimum-span guard. |
| 10 | OPEN | `pdd_export.py:489-490` | Fragment heading is the raw `step.name`. |

### 5.2 Feature value audit 2026-07-10 (sharp list)

| # | Item | Status |
|---|---|---|
| 1 | PDD section 5.4 ROI leak | OPEN (5.1 #1) |
| 2 | Overview tiles: "168.4/h" extrapolation; "RE-TYPED VALUE" count over a different subtitle | OPEN (`overview-view.js:193`, `:206-208`) |
| 3 | "Where the time went" vs "Where the time goes" on one page | OPEN; correction: "went" lives in the `#session-summary` panel (`flow-view.js:894`), open by default, not a hero; "goes" is Overview evidence (`analysis-view.js:566`) |
| 4 | Aligned reading two notches from default | OPEN by design (`steps-view.js:269`, `:286`, `:299`; default grain "screen", `state.js:98`) |
| 5 | Compare findings never fired on real data | Unchanged (no real multi-session corpus) |
| 6 | Shipped vocabs cover the probe estate, not the lab estate | Unchanged |
| 7 | HTML findings report never audited | Unchanged (not audited here either) |
| 8 | e2e residue in the recents list | Not re-checked; related: RP-36 |

### 5.3 [tech-debt-findings.md](tech-debt-findings.md) remaining items

| # | Status |
|---|---|
| 4 | Present: DFG edge-merge duplicated (`renderer.js:1090-1095`, `aggregate-view.js:785-811`) |
| 6 | Present: module-level `_last*` caches (`aggregate-view.js:292-296`, `:927`) |
| 8 | Present and grown to 5 copies (`flow-view-timeline.js:292`, `flow-view.js:1415`, `:1618`, `steps-view.js:1575`, `:1621`) |
| 9 | Present: `.click()` as control flow (`flow-view.js:293-308`, `aggregate-view.js:888`, `:1620`, `flow-view-video.js:128`, `:158`) |
| 10 | Present: bare `500` (`tracker.js:167`, `:198`); `setTimeout(_refit, 50)` six times in `map-controller.js` |
| 17 | Present: embeddable defaults to 3.11.9; `requirements.txt` has floors only, no lock |

---

## 6. Repo hygiene at the restart point

- **Worktrees (merged, clean, left in place):** `D:\Game Development\Process Mining\pdt-wt-v0200`
  (branch `docs-and-release-v0.20.0`) and `.claude/worktrees/confident-diffie-f9d0b7`
  (detached at `dc3bf53`; branch `claude/confident-diffie-f9d0b7`). Both contain
  junctions (`node_modules` in each app, and `viewer/python` in the second) that
  likely point into the main checkout; unlink the junctions before any removal.
- **Branches:** `docs-and-release-v0.20.0`, `claude/confident-diffie-f9d0b7`, and
  `viewer-refactor` are merged into master. `project-vision-ai-ml` (the parked ML
  edition, 5 commits ahead) is intentionally unmerged.
- **`AGENTS.md` (untracked, 2026-08-09):** a find-and-replace of CLAUDE.md for Codex;
  the replace rewrote real paths into nonexistent ones (`.Codex/agent-findings/`,
  `docs/Codex-skills/`, `~/.Codex/skills/`). Not committable as is.
- **Stale docs:** CLAUDE.md "START HERE" (v1.4.0, no R5), its documentation map
  ("ADRs 0001-0015"), SCHEMA.md and ADR-0028 per section 4.4.

---

## 7. What this points to (inputs to the discussion, not decisions)

1. **The app is not at a clean baseline for new work.** CI has been red since
   2026-06-11; the v1.5.0 headline feature loses analyst names on every re-analyze
   and export (RP-01); the map and PDD have correctness defects (RP-02, RP-03);
   annotation persistence can silently wipe manual work (RP-04); one code-execution
   sink exists (RP-05).
2. **Candidate fix-first scope** (before R5 or any new direction): RP-01 through
   RP-05; CI-1 through CI-3; the `js-yaml` bump. RP-06 to RP-10 are deliverable-
   honesty items that belong with whatever deliverable the new approach keeps.
3. **Triage against the new direction first.** Several findings live in surfaces the
   new approach may replace (the rail, the case tree, the workbench, the exports).
   Fixing them before the direction is settled may be wasted work; the persistence,
   case-identity, security, and CI items (RP-01, RP-04, RP-05, CI-1 to CI-3) hold
   under almost any direction.
4. **R5 remains blocked on owner-recorded real captures** regardless of the above.
5. **Open owner decisions:** refresh CLAUDE.md "START HERE"; delete or fix
   `AGENTS.md`; remove the two leftover worktrees; whether to commit this file and
   tag the restart point.
