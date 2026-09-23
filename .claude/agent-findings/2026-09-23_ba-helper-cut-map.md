# BA-helper cycle: cut map (read-only survey, 2026-09-23)

Produced by a read-only mapping agent against master 73f3bbf. All paths are
relative to the repo root. Line numbers are from that checkout and drift as lanes
land; grep the quoted anchors. UNSURE marks items the survey could not settle.

## Findings that constrain the order

1. `viewer/step-editor.js` (kept) imports from `vocab-match.js` (V2): L14
   `const { identityLine } = require("./vocab-match.js");` and L506. Move
   `identityLine`, `looksVolatileId`, `_asData` out of vocab-match.js first;
   step-editor.test.js L264-280 tests this rendering.
2. "Save as reference" depends on three cut features: steps-view.js L22
   `require("./identity-picker.js")` (V3 file), L1412 `anchorFromOverride(anno.case_anchor_override)`
   (P1), L1441-1447 `openCanonicalInTemplateTab(r)` (V3); L1433 `Ipc.newCanonicalFile`.
   (Coordinator decision AD-8: "Save as reference" is cut with the template engine and
   replaced later by "Save as this process".)
3. `normalization/analysis_automation.py` L36 `from analysis_roi import _resolve_inputs, _fraction_for`:
   move these helpers before deleting analysis_roi.py.
4. `pdd_export.py` L109 `from memo_export import build_memo_model, write_memo_into_docx`:
   memo_export.py can only be trimmed. The Overview "include in memo" checkbox writes
   `memo_selection`, which PDD section 1 reads: keep it.
5. `bpmn_observed.py` L174 `import mining`, L184-185 `mining.discover_inductive(...)` /
   `mining.export_bpmn(...)`: the kept step-level BPMN needs mining.py (trim only).
6. `capture/readiness.js` L268 `rec.snapshot(...)`: keep Snapshotter.cs and the
   `snapshot` command in Program.cs; only `pick` / WindowPicker.cs is discovery-only.
7. The Detail slider (V9) is the only switch between Steps readings: steps-view.js
   L261 `State.getGrain()`; "element" = flat editable list + Aligned reading; "screen"
   (default) = case tree / work items; analysis-view.js L477 `const canJudge = !regroup;`
   (the "Where the time goes" judgment editor exists only at element).
8. Compare Sessions (V1) holds the only map BPMN/SVG export UI (`#btn-export-map-svg`,
   `#btn-export-bpmn`, step/phase BPMN, `viewer:saveSvgFile`).
9. `$("#...")` calls with no null check that throw at startup if their HTML goes first:
   renderer.js L1034-1036, L1064, L1105, L1228; phases-view.js L57.
10. Vocab semantics stay in the pipeline: step_suggest.py L299 reads
    `vocab_semantics.completion`; facts.py L160 reads `vocab_semantics.carries_value`.
    Keep `app_vocab.semantics_from_entry`, `SEMANTIC_FIELDS`, the stamp at app_vocab.py L385.
11. `e2e/package.json` test = `node session-smoke.js && node vocab-smoke.js`; vocab-smoke is
    cut. overview-smoke and map-slim-smoke are not in CI.
12. No preload scripts; both apps use nodeIntegration. Viewer IPC wrappers: viewer/ipc.js;
    every viewer `ipcMain.handle` is in viewer/main.js.

## Viewer

### V1 Compare Sessions / aggregate
- Delete whole: views/aggregate-view.js; analysis-aggregate.js (+test); variant-divergence.js (+test);
  charts.js (renderer.js L21 import is dead); e2e/flywheel-smoke.js (mostly V1/P1).
- index.html: L32 tab; L543-767 `#view-aggregate` incl. `<template id="agg-map-panel-template">`
  L727-764; help L926, L941, L1065-1096, L1120 ("2"), L1135, L1161-1162, L1173-1174.
- renderer.js: L34 import; L87-92 aggregate refit in activateTab; L751 `renderAggregate();`
  (theme onChange); exportArtifact L884, L890-893 (aggregate target), L897-920 (step/phase BPMN),
  L975 (step-csv); L989-992; L996-1010 `initAggregateView`; L1014-1017 `pdt:mapresized`;
  L1034-1036 (no null check); L1038-1062 map SVG; L1064-1103 aggregate markdown (no null check);
  L1228-1289 `#btn-export-promotions` (no null check); L1291-1304 `exportFirst`; L1360 key "2"; L1804.
  Kept code reaching in: L891-893 `(!forceSingle && State.getAggregateSessions().length) ? filteredAggregateSessions() : ...`
  inside the kept Session PDD export.
- main.js: L178-202 `viewer:openMultipleSessions`; L208-212 `viewer:loadMultipleSessions` (V6, V3 also);
  L214-238 `viewer:runNormalize` (aggregate only); L250-263 `viewer:saveSvgFile`.
- ipc.js L26-34, L38-41, L88-91, exports L257-258, L261; state.js aggregate state L91, L114-116,
  L256-258, L330-339, exports L353, L371-372; session-summary.js detectDurationOutliers L238-255;
  report-md.js buildAggregateReport L187-273; map-controller.js L269-270; dfg-viewer.js conformance/
  variant overlays (optional cleanup; guarded file, leave); layout-controls.js L97, L112-116;
  flow-view.js L296 (palette); styles.css L697-831 (shared with Session map, cut selectively),
  L981-993, L1509-1525, L2178-2188, L2287-2292.
- Tests: analysis-aggregate, variant-divergence, session-summary L216-229, report-md aggregate cases.

### V2 App Library workbench, semantics autofill, discovery, vocab-match.js
- Delete whole: views/vocab-view.js; vocab-match.js (after moving identityLine); vocab-match.test.js
  (move identityLine tests first); vocab-merge.test.js; e2e/workbench-smoke.js; e2e/vocab-smoke.js.
- index.html: L33 tab; L124 `#btn-save-vocab`; L147-156 prep CTA (C2); L837-882 `#view-vocabularies`;
  L1120 ("3"); L1140.
- renderer.js: L35-36; L98-100; L767-769 `addInteractionToVocab`; L800-879 `buildVocabFromSession`,
  `#btn-save-vocab`, `#btn-prep-bootstrap`; L1361 key "3"; L1534-1562 `initVocabView`; L1805.
- steps-view.js: L33-35, L1460; L735 callback; L1565-1605 `showInteractionVocabMenu`.
- step-editor.js: L14 (move); L308-325 right-click wiring.
- overview-view.js: L39; L407-414 "To say more" copy pointing to App Library; L444-455.
- main.js: delete L699-713 `viewer:saveAppVocab`, L763 `viewer:openVocabFile`, L779-798
  `viewer:deleteVocab`, L858-880 `viewer:newVocabFile`. `viewer:listAppVocabs` L715-761,
  `viewer:readVocab` L829-841, `viewer:writeVocab` L843-856, `appVocabDefaultDir` L678-697: cut unless a
  kept caller remains.
- ipc.js L153-208, exports L263-264; state.js vocabState L45-54, L113, L345; canonical-author.js;
  modals.js `pickerModal` L279-336; ui-copy-guard.test.js L67 ALLOW entry; styles.css L2431-2574.
- env `PDT_APP_VOCABULARIES` (Python app_vocab.py L63-68 kept).

### V3 Process Template editor
- Delete whole: views/template-view.js; views/identity-picker.js.
- index.html: L34-50 "More" menu; L769-835 `#view-canonical`; onboarding L168-173; help L925, L1033-1063.
- renderer.js: L37; L76-82; L93-97; L766; L1806; L1642 and L1887-1906 (V6).
- steps-view.js L32, L1459, L1441-1447; flow-view.js L294, L301 (palette), L437 `Ipc.openCanonicalFile()`.
- main.js L440-573 canonical handlers (`viewer:openCanonicalFile`, `viewer:saveCanonicalFile`,
  `viewer:newCanonicalFile`, `viewer:deleteCanonicalFile`, `viewer:listTemplateVersions`,
  `viewer:readTemplateFile`, `viewer:testCanonicalMatch`); ipc.js L48-51, L121-151; state.js
  canonicalState L36-42, L112, L343; canonical-author.js; styles.css L221-243, L2250-2286.
- Tests: canonical-author.test.js.

### V4 Copy-for-LLM, reviewed import, data posture
- Delete whole: llm-export.js (+test), posture.js (+test).
- overview-view.js L34-35, L92 `_postureControl()`, L95-108, L651-657, L668-698, L744-750; main.js
  L280-297 `viewer:saveTextFile`; ipc.js L98-103; index.html L868; ui-copy-guard.test.js L61-68;
  styles.css L1072-1090. localStorage `pdt.dataPosture`.
- e2e: overview-smoke 2 section-C4 checks; vocab-smoke.

### V5 Team taxonomy and classification-override UI
- index.html L123 `#btn-classify-activities`; flow-view.js L356-357, L979-999 (unclassified banner),
  L1258-1292 `classifyApp`, L1294-1402 `showClassifyManager`, L1436 "Classify this app..." item;
  main.js L1022-1050 `viewer:addClassificationOverride`, L1052-1093 `viewer:promoteTaxonomyRules`;
  ipc.js L70-79; styles.css L2694-2712. Engine (classification_overrides.py) waits for Q4.

### V6 Project layer
- Delete whole: project.js (+test).
- index.html L62-75, L94-100 `#recent-projects-block`, help L943-944; renderer.js L150 and L665
  `scheduleAutoSave();`, L1630-2073 project block, L1206/L1214, L1715 (kept Recent menu reads
  PdtProject), L1958; flow-view.js L30, L584-586 (`applyProjectDenylist(); maybeApplyStepTemplate();`
  in the kept session load), L589-678; main.js L921-981; ipc.js L222-242.
- Keep the `step_filters.ignored_processes` key.

### V7 Command palette
- Delete whole: command-palette.js (owns Ctrl+K).
- index.html L76 `#btn-cmdk-hint`, help L1126; renderer.js L24, L1564-1566; flow-view.js L21, L214-321
  (provider; L319-321 registerProvider); steps-view.js L20, L1462-1472; phases-view.js L18, L358-367;
  styles.css L1624-1686.

### V8 Phases view and phase UI
- Delete whole: views/phases-view.js, phase-editor.js, flags.js (only phases-view uses it).
- index.html L199-203 (`#phases-badge`), L395-435 `#session-layout-phases`, L338 `#btn-group-into-phase`,
  L455 map "phase" option, onboarding L174-180, help phase parts; renderer.js L28, L39, L177, L212-216,
  L563, L571 (`State.subscribe("phases", renderPhasesLevel)`), L584, L619, L695-700, L771-775, L793-795,
  L266, L336; flow-view.js L27, L553-557 (`renderPhasesLevel();` in loadSessionIntoView), L950-954;
  steps-view.js membership helpers L74-153 and calls (L925, L993, L1052, L1149, L1305), L1193,
  exports L1718-1720; state.js selectedPhaseId, phaseZoom, listFilters.phase; session.js L125, L167
  ("phases" topic); layout-controls.js L99, L128; theme.js L125-147 phasePalette; process-map-levels.js
  phase notch (guarded file); map-controller.js phase drill L181-211; session-summary.js L169;
  next-act-rail.js L63; step-editor.js L94 copy.
- Tests: steps-view-membership.test.js; theme.test.js L113-123; process-map-levels.test.js phase cases;
  session-smoke "level 'phases' renders".

### V9 Detail slider (ADR-0024 roll-up)
- index.html L214-223 (`#grain-control`, `#grain-slider`, `#grain-notch-lbl`), L204; renderer.js
  L132-171, L176, L484, L588-590; state.js L95-98, L266-271; steps-view.js L255-290, legends L408-417,
  L471-478; flow-view-timeline.js L438-468; analysis-view.js L40-74, L367-412, L440-478, L1273-1303;
  styles.css L1707-1734. Roll-up engine in process-map-levels.js (work-items.js L116 uses grainKey).
- session-smoke checks using the slider: "grain slider present", "grain roll-up", "ROI invariant",
  the "Where the time goes" editor checks, the two section-A3 checks, the connectivity check;
  workitems-smoke assumes the "screen" default; map-slim (a) asserts level "screen".

### V10 Suggested markers and anchor candidates UI
- index.html L272 `.lg-marker-suggested`, L320 `#anchor-candidates-panel`; flow-view-markers.js L7-10,
  L74-304, suggestion branches in renderMarkersList (L313, L324-336, L344-346, L353-385), L429-440,
  exports L536-541; flow-view-timeline.js L28, L712-745; flow-view.js L40, L549, L1912; renderer.js
  L41, L574, L372-389 (lock-message copy); overview-view.js L32, L110-158, L386-400, L719-722, L735;
  session.js ensureAnnoShape L143-149; refmap-ui.js L184-189 copy; styles.css L578-651, L1091-1105,
  L2795-2816.
- Kept code reaching in: flow-view-markers.js L313 inside the kept markers list; renderer.js L373
  (anchor_candidates count in the kept step-BPMN lock gate).
- e2e: overview-smoke "(d) marker-stripped ... anchor hero"; map-slim (e)/(e2) copy; flywheel (a).

### V11 Advanced map drawer and notation x level matrix
- index.html L444-457 `#session-map-level`, L486-499 `#map-expert-drawer`; renderer.js L261-298
  (`_sessionBpmnFile` activity/phase branches), L302-366 (`_sessionMapDataSource`), L413-426, L456-496,
  L498-552 `_wireMapExpertDrawer`, L178, L673-681; map-controller.js L150-227, L380-392, L423-470;
  process-map-levels.js buildAnnotationDfg levels L268-364.
- The kept reference-map e2e round trip clicks `#btn-expert-activity-bpmn` and checks
  `process_map.bpmn`; G-1 sets `#session-map-level`. renderer.js L1025-1029 `sourceBpmnPath` ->
  `_sessionBpmnFile` (Fork source); refmap-ui.js L136 `setMapCell(e.source.level || "activity")`;
  reference-maps.js L55.

### V12 ROI panel / Edit assumptions
- Delete whole: analysis-roi-view.test.js. analysis-view.js L8-9, L80-92, L179-181, L572-590,
  L692-920, L976-1113, L1247-1256, L1315 (`_roiSection(analysis.roi)` in renderEvidenceInto),
  export L1320; overview-view.js L402-406; styles.css L1464-1508. session-smoke ROI checks x2.

### V13 Memo export UI, HTML findings report, XES/CSV export UI
- Delete whole: report-html.js (+test).
- index.html L141 `#btn-export-findings`, L142 `#btn-session-md` (Markdown report), L186; renderer.js
  L23, L1161-1226, L174; overview-view.js L617-648 `_exportMemo`, L650-666, L742-743 (keep
  `_toggleMemoSelection` L304-319 and L367: memo_selection feeds PDD section 1); finding-cards.js L75-77;
  main.js L265-278 `viewer:saveHtmlFile`, L591 `memoOut`; ipc.js L93-96; python-runner.js L73,
  L109-113; modals.js checklistModal L198-278 (dead after V2+V13); flow-view-screenshots.js star toggle
  (`starred_screenshots` read only by report-html.js); styles.css L1255-1260, L1526-1544.
- e2e: overview-smoke "(e) memo export writes memo.md" and the C4 sealed check.

### V14 Next-act rail
- Delete whole: next-act-rail.js (+test). overview-view.js L37, L38 (buildWorkItems import used only by
  the rail), L39, L432-572, L726, L737, L753; styles.css L1126-1168. overview-smoke rail + 5 LANDS checks.

## Pipeline

### P1 anchor_suggest, marker_suggest, anchor-based case assignment
- Delete whole: anchor_suggest.py, marker_suggest.py, test_anchor_suggest(_fuzz).py,
  test_marker_suggest(_fuzz).py, test_anchor_cases.py.
- pipeline_stages.py L31-34, L45-48, L97-124 (keep marker mode L125-128), L163-223 `_run_suggestions`;
  normalize.py L84, L156-157; case_assignment.py docstring L1-12, anchor section L133-417 (keep L136
  `_parse_ts`, a fuzz test imports it); case_quality.py L39-70 and anchor mode L101-115; memo_export.py
  L200-221, L261-267 (reach the PDD); canonical templates with case_anchor become inert.
- Tests (partial): test_case_assignment_fuzz.py L35-42, L299-379; test_case_quality.py L75-111;
  test_memo_export.py L99, L107, L157; test_vocab_semantics.py L30, L210-282.
- Golden: unchanged (no case_anchor_override in the demo annotations).

### P2 pii_masking
- Delete whole: pii_masking.py, test_pii_masking.py, test_pii_masking_fuzz.py.
- normalize.py L40, L135-142, L150-152; optional: step_suggest.py L72-85, L445 (masked-token display),
  shared/process-label-patterns.json L9, shared/process-label-golden.json L31, findings.py L370-373.
- Golden unchanged (0 masked values in all 10 demo sessions, verified).

### P3 analysis_roi
- Delete whole: analysis_roi.py (after finding 3), test_analysis_roi.py.
- analysis.py L27, L64, L94-101; analysis_automation.py L31-36, L81-83; pdd_export.py L94, L627-710
  (`_write_roi`, `_fmt_money`); memo_export.py L268-271.
- Tests: test_analysis_automation.py about L195-215 (roi_inputs overrides); test_memo_export.py L155-175.
- After the cut the automatable fraction is always the 0.7 default.

### P4 memo_export, findings report, XES/CSV exports
- Delete whole: step_csv.py; (xes_export.py + test and csv_safe.py + test go with P6).
- normalize.py L5-13, L101, L169-171, L188-210, L224-226, L256-260 (`--memo-out`), L320;
  pipeline_stages.py L43, L356-377 `_run_event_log_export` (its `log` feeds P6 activity mining), L722-728;
  memo_export.py: keep `build_memo_model` L363-404 + helpers and `write_memo_into_docx` L465-555; cut
  `render_memo` L406-464, `render_memo_docx` L556-584, `write_memo` L585+, markdown-only helpers (check
  the call graph); python-runner.js L108; main.js L590-591.
- Tests: test_memo_export.py L66-194 use markdown render_memo (rewrite against the model).

### P5 Phase-level outputs
- Delete whole: bpmn_phase.py, test_bpmn_phase.py, test_reconcile_phase_membership.py.
- phase_reconcile.py: `_merge_phases` L23-33, `reconcile_phase_membership` L34-78 (keep
  `_compute_drift_markers` L79-111 unless canonical matching goes); normalize.py L51-53, L99, L215,
  L252-253 (`--phase-bpmn-out`), L318; pipeline_stages.py L53-55, L149, L249, L280-293, L308-313, L448
  `phase_count` (golden pins it), L514, L635-638, L706-720; canonical_match.py rollup_phases L346-378;
  bpmn_observed.py L40-53 (phase level); pdd_export.py L333-334, L444-487; step_suggest.py L714-715;
  analysis.py L43; python-runner.js L107; main.js L589.
- Tests (partial): test_phase_reconcile.py; test_canonical_match.py L108-120; test_canonical_match_fuzz.py;
  test_bpmn_observed.py L85-97; test_pdd_export.py L259-290; test_step_identity.py L35.
- bpmn_phase.py L11 imports from bpmn_step: cut bpmn_phase before touching bpmn_step.
- Golden: all 10 goldens have phase_count 0; removing the key needs a deliberate golden update.

### P6 Activity-level, per-case and heuristics mining cells (with XES/CSV)
- pipeline_stages.py L599-623 (DFG + aggregate BPMN), L641-670 (per-case); keep L624-634 (step BPMN).
- mining.py discover_heuristics L24-27, discover_dfg L30-33, dfg_to_dict L335+; golden_check.py L113,
  L119-133 pin the ACTIVITY-level dfg.json (every session's counts change if it goes; re-point the golden
  to the step-level map and --update in the same slice); main.js L362, L401 (`dfg` in the session payload).
- `--step-bpmn-out` / bpmn_step.py: no viewer caller (UNSURE).

### P7 Vocab discovery/bootstrap paths and team taxonomy
- Delete whole: discover_vocab.py, test_discover_autofill.py, viewer/recorder-snapshot.js (+test).
- normalize.py L39, L261-304 (`--bootstrap-vocab-out`, `--vocab-id`, `--vocab-name`,
  `--bootstrap-vocabs-json`); app_vocab.py L28 (`import signature_pick`), L133-215 autofill (UNSURE:
  `derive_completion` might help drafting), L455-937 bootstrap and snapshot, `to_yaml` L938+ (UNSURE);
  classification.py `upsert_taxonomy_rules` L29-65 (tests only); python-runner.js L74, L86-91, L174-259;
  main.js L31-32, L616-648 `viewer:bootstrapAppVocab`, L655-676 `viewer:bootstrapVocabsFromSession`,
  L765-774 `viewer:pickWindow`, L800-827 `viewer:discoverFromWindow`; ipc.js L53-56, L185-203.
- Tests (partial): test_signature_pick.py L218-296, L312-399; test_app_vocab.py L179-315;
  test_app_vocab_fuzz.py about L160-260; test_vocab_semantics.py L104-167; test_classification.py L250-290.
- Keep the C# `snapshot` command (readiness).

## Capture (lane L2 owns these)

- C1 sync markers: main.js L1532-1540 (`pdt:fireSync`), L1888-1896, L1907-1909; config.js L39;
  sample-config.yaml L36; operator-panel.html/js, settings.html, help-window.html; viewer index.html
  L1170-1171 (help text). Nothing reads `sync_marker` events.
- C2 vocab-prep sessions: main.js L704-883 range, L1173, L1185, L1581-1584; session.js L17, L43-48;
  viewer index.html L147-156, flow-view.js L788-806, renderer.js L869-879 (viewer side is L1's).
- C3 close-out wizard: capture/self-annotation/ (wizard.js, wizard-window.js, wizard-window.html + tests;
  observe.js/persist.js UNSURE); main.js L138, L1091-1099, L1179-1198, L1645-1648; the operator-panel
  `pdt:sessionSummary` (L1160-1170) is a likely base for the replacement.

## e2e (at 73f3bbf)

- session-smoke (CI, 33 checks). Cut with their features: "level 'phases' renders" (V8), "grain slider
  present", "grain roll-up", "ROI invariant", "read-only at coarse detail" (V9/V12), "ROI section gate"
  (V12), "grain falls back on Process diagram" (V11/V9). The reference-map checks depend on the fork
  source (V11/P6).
- overview-smoke (not in CI): cut the rail + 5 LANDS checks (V14), both C4 checks (V4), "(e) memo.md"
  (V13), "(d) anchor hero" (V10/P1).
- map-slim-smoke (not in CI): (d1)(d2)(d3) are V11/P6; (e)/(e2) copy mentions the anchor.

## Golden (normalization/golden_check.py)

Runs `normalize.py <temp copy> --mine` on the 10 demo sessions and pins stats meta (raw_event_count,
dropped_jsonl_lines, collapsed_activity_count, interaction_count, matched_interactions, match_rate,
case_count, marker_edits_applied, step_count, step_state_breakdown, drift_count, phase_count,
app_vocabulary_matches), the step count and distinct process_labels, and the activity-level dfg.json
node/edge/start/end counts. P1, P2: no change. P5: only if phase_count is removed. P6: every session.

## CI (.github/workflows)

e2e.yml: Node 20, Python 3.12, pip install requirements, viewer npm ci, e2e npm ci, `npm test`.
js.yml: `node scripts/check-js-syntax.js`, viewer and capture `npm test`. pytest.yml: Python 3.12,
requirements + pytest, `pytest test/ -v` in normalization (includes golden + ADR registry). The ADR
registry test requires registry rows not marked as gaps to have files.
