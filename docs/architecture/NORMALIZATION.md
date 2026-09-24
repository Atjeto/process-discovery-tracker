# Normalization

> Overview level. Field-level formats are in
> [`shared/SCHEMA.md`](../../shared/SCHEMA.md); the decisions behind the
> light version are in [ADR-0029](../adr/0029-ba-helper-refocus.md) and the
> data contracts (C1 to C19) it points to.

## Purpose and entry points

Normalization is the analyst-side Python pipeline. It turns a session folder
into runs, drafted steps, statistics and the analysis, writes the step-level
process map, and renders the PDD. The viewer runs it through
[`viewer/python-runner.js`](../../viewer/python-runner.js) with the bundled
Python; it also runs from a shell. There is no Analyze button: the viewer
runs the pipeline by itself when a session opens without a current analysis
(none, or one from an older pipeline), after Leave apps out and after a time
range is left out, inside Edit as the As-Is map, and before a PDD export
that prints the map from the runs when that map is missing or older than
the steps. Apply marker changes runs it on request; Help, Troubleshooting
has Re-analyze for a stuck state.

### `normalize.py` (contract C11)

```
python normalize.py <session_folder> [--taxonomy <taxonomy.yaml>] [--mine]
    [--pdd-out <path.docx>] [--pdd-map-image <path.png>] [--pdd-map-images <maps.json>]
    [--pdd-tobe-image <path.png>] [--names <remembered-names.json>]
```

| Flag | Effect |
|---|---|
| `--taxonomy` | Activity classification rules. Without it nothing is classified. The viewer always passes the bundled `taxonomy.yaml` (or `sample-taxonomy.yaml` when that is missing). |
| `--mine` | Also write `process_map_step.bpmn`, the step-level map. Every analysis the viewer runs passes it; its PDD export does not (it analyzes first when the map file is missing or older than the steps). |
| `--pdd-out` | Render the PDD to this `.docx` path. |
| `--pdd-map-image` | A picture of the As-Is map, printed as section 3.1. The viewer passes the edited As-Is copy when one is chosen, else the step map (`process_map_step.bpmn`) drawn off screen by bpmn-js. |
| `--pdd-map-images` | Contract C19: a manifest of the maps' pictures, `{"maps": [{"path": [<node>, ...], "png": "<file>"}]}` (a relative file is read from the manifest's folder). Path `[]` is the main map's picture and wins over `--pdd-map-image`; any other path is a sub-process's map, printed in its chapter. An entry whose file is missing is left out, and that map prints as a table; an unreadable manifest gives a warning and no pictures. The viewer renders one picture per numbered map. |
| `--pdd-tobe-image` | A picture of the To-Be map, printed as section 7.1. The viewer passes the copy chosen as To-Be. |
| `--names` | The remembered-names store (contract C4). A draft whose `draft_key` the session's own analyst steps do not name takes the store's name. A missing or unreadable file prints one warning and drafting goes on without it. The viewer passes it on every run when the store exists. |

Exit codes (contract C13): **0** success; **1** a usage error or a folder
that is not a project folder (an unexpected crash also exits 1, with a
traceback); **2** `annotations.json` exists but cannot be read, and nothing
was written, `normalize.log` included; **3** a requested export failed after
every analysis output was written. Errors are one stderr line starting
`[normalize] ERROR:`. The viewer treats any non-zero exit as a failure and
never opens a stale export.

Flags removed with their features: `--canonical`, `--phase-bpmn-out`,
`--step-csv-out`, `--memo-out`, `--bootstrap-vocab-out`, `--vocab-id`,
`--vocab-name`, `--bootstrap-vocabs-json` and `--step-bpmn-out`.

### `transcript_import.py` (contract C8)

```
python transcript_import.py <session_folder> <transcript_file>
```

Parses a Teams `.vtt` or `.docx` transcript into timestamped, speaker-tagged
segments with the standard library only, copies the original byte for byte
to `transcript/<original name>`, and writes `transcript.json` atomically. It
only reads `events.jsonl` and `annotations.json`. Exit codes: 0 imported (one
summary line on stdout); 1 bad arguments or not a project folder; 2 the
transcript is unreadable or its layout unsupported (nothing written); 3
`annotations.json` unreadable or the write failed (the previous transcript
is kept). `parse(path)` is the reusable entry point and writes nothing. The
viewer's Attach transcript runs this CLI with the same Python it uses for
`normalize.py`.

### `golden_check.py`

The session golden. It copies each of the 10 demo sessions in
`sessions/example-aggregate/` to a temp folder, runs `normalize.py --mine`
there, and compares a projection with `normalization/golden/`: stable
`stats.json` meta counts, the step count, the distinct `process_label` set,
and the step map's task names, its tasks counted by kind (user and manual
tasks, contract C18; none is left a plain task), and its start and end
events with the end's name. Gateway and flow counts are left out because
they move with the pm4py version; the viewer's e2e connectivity check pins
the map's shape instead. Run it with a Python that has the pipeline
dependencies (the bundled one); `--update` rewrites the goldens after an
intended output change only. Detail:
[normalization/golden/README.md](../../normalization/golden/README.md).

## Pipeline stages

`normalize()` in `normalize.py` is a thin orchestrator over the stage
helpers in `pipeline_stages.py`, in this order:

0. **Load.** `annotations.json` first: a file that exists but cannot be read
   stops the run before anything is written (exit 2). Then the manifest, and
   `events.jsonl` sorted by `(timestamp, _seq)`; malformed lines are counted
   and skipped. `manifest.source` says whether the session has a recording
   (below, "Sessions without a recording").
1. **Exclude self and ignored apps** (`process_filter.py`). PDT's own windows,
   the `exclude_processes` lists in the session's config snapshot
   (`interactions.exclude_processes`, or a top-level one) and the analyst's
   `step_filters` are dropped from the derived stream.
   `events.jsonl` is never rewritten; what was dropped is recorded in
   `annotations.process_exclusions`.
2. **Coalesce and marker edits** (`_run_coalesce`). Per-keystroke
   `value_changed` bursts on one control fold into one final-value event
   (`coalesce.py`); `annotations.marker_edits` (rename, re-time, delete,
   insert) are replayed onto the derived marker stream (`marker_edits.py`).
3. **Runs and vocabulary enrichment** (`_run_case_assignment`).
   `case_assignment.py` walks the markers. **Runs never nest:** a start that
   arrives while a run is open ends that run first, and the derived start
   marker records it as `ends_case_id` (no end marker is invented). An end
   closes the open run. Case ids are deterministic (contract C9). Every
   activity and interaction gets `case_ids`: empty, or the one open run. In a
   recording, case detection is markers only: no start marker, no runs. A
   session without a recording and without a start marker gets one implicit
   run instead (C16). App vocabularies then enrich matching interactions
   (`meaningful_name`, `screen_id`, `vocab_flags`, `vocab_semantics`), and
   `app_names` gives every executable in the recording a readable name.
4. **Step drafting** (`_run_step_segmentation`, contract C1). Within each
   run, `step_suggest.auto_suggest_steps` walks the interactions in time
   order. A step is a stretch on one screen of one app, ending (a) at a commit
   interaction, inclusive (`invoked` on a Button, SplitButton, MenuItem or
   Hyperlink, or a vocab entry with `completion: true`); (b) at the first
   interaction on another screen, exclusive; or (c) at the end of the run.
   Interactions outside every run are drafted the same way with
   `case_id: null`. Each draft carries `draft_key`, `name_source` and
   `end_reason`. A draft's name comes, in this order, from a step the analyst
   named in this session with the same key (`step_suggest.session_names`:
   typed names before accepted ones, the pattern run's first), from the
   remembered-names store (`--names`), else from the rule's default name;
   the first two give `name_source: "remembered"`. So names travel with the
   session folder. `draft_summary()` counts the fresh drafts for the P1 probe;
   `_merge_steps()` keeps every analyst-owned step (`confirmed`, `edited`,
   `manually_authored`, `hidden`), drops a fresh draft that overlaps one, lets
   a fresh draft inherit the `step_id` of the step it re-covers, and restamps
   `process_label` and `grain_keys` on every step. A draft that still
   carries a step flow key (`only_when` or `links`, contract C17) is the
   analyst's: it is kept as `edited`, so no analysis drafts the flow away;
   so is a draft that carries `sub_steps` (contract C19, a sub-process).
   A preserved step keeps its sub-steps as they are; each sub-step, at
   every depth, gets its `process_label` by the main level's rule (a
   drafted sub-step's `action_key` counts like a `draft_key`).
   `restamp_preserved_case_ids` (C9) moves a preserved step whose run no
   longer exists to the run that contains it in time, then gives every
   sub-step its parent's `case_id`. A group of steps (C19) is a preserved
   step whose span and evidence are its members', so the fresh drafts of
   the grouped interactions are dropped. The merged steps are written to
   `annotations.json` here. The statistics and the analysis read the main
   level only; the step map and the PDD read the sub-processes too
   (below).
5. **Classification** (`_run_classification`). Taxonomy rules
   (`classification.py`) plus any `classification_overrides` an older file
   carries, then two collapses: adjacent identical activity events, and one
   row per activity occurrence for the statistics. Classification is an
   internal engine with no editing UI (AD-16): drafting does not use it; the
   analysis stages do.
6. **Statistics** (`_run_stats`). `stats.json`: activity, run, step, variant,
   outlier and rework statistics plus `meta`, including
   `step_state_breakdown`, `draft_summary` and `app_names`. The step
   variants use every visible (not hidden) step; the step durations use the
   visible steps that have a time.
7. **Analysis** (`_run_analysis`). `analysis.json`: the measured blocks
   (`case_quality`, `facts`, `findings`) and the step-based estimates (waste,
   time study, segments, automation candidates, efficiency) over the visible
   steps that have a time ([ADR-0008](../adr/0008-build-the-analysis-layer.md),
   [ADR-0016](../adr/0016-segment-level-automation-candidacy.md)). A stage that
   fails writes its key as `null` and one entry in `stage_errors` (contract
   C12); the findings stage does not run when one of its inputs failed. In a
   session without a recording the measurements are `null` with no entry:
   nothing failed, nothing was recorded. The viewer's Overview reads two
   findings (the re-keyed data and the coverage caveat); the PDD prints none.
8. **Step map and PDD** (`_run_mining_exports`). With `--mine`,
   `bpmn_observed.py` writes `process_map_step.bpmn` from the visible steps
   that belong to a run (below). With `--pdd-out`, `pdd_export.write_pdd`
   renders the PDD; a failure raises after every analysis output is written
   (exit 3).

**Gone from the pipeline** ([ADR-0029](../adr/0029-ba-helper-refocus.md)):
the event-log export (`events.xes`, `events.csv`), the activity-level
`process_map.bpmn`, `dfg.json` and the per-case maps under `process_maps/`
(the viewer draws its map from the steps and no longer reads them); nested
runs; anchor-based case detection; suggested markers and anchor candidates;
canonical matching and drift markers; phases; PII masking; the EUR-ROI stage;
the PDD's findings section. Older session folders may still hold the removed
files; nothing reads them.

## The step map (`process_map_step.bpmn`, contracts C15, C17, C18, C19)

`bpmn_observed.write_observed_bpmn` builds one trace per run from the run's
visible steps, labelled by `process_label`, in the run's step order (time,
then `order` for the steps without a time), a step repeated back to back
counted once. One run is drawn as a plain sequence; two or more runs go
through pm4py's inductive miner (`mining.discover_inductive`). Steps
outside every run are left out.

**The flow the analyst set (C17).** When the steps carry a condition
(`only_when`) or links (`links`) that change the map
(`step_flow.changes_map`: an edge with a label, or one no transaction
took), the map is drawn from the step flow edges instead of the chain or
the miner. `step_flow.flow_edges` is the rule the viewer's live map uses
too (`shared/flow-links-golden.json` pins both): the consecutive steps of
each transaction, a condition on the edge into its step with an
"otherwise" edge around it, a link from its step to the target or to the
end, one edge per pair of map nodes with its labels joined by " or ". An
exclusive gateway goes after a step with several ways out and before a
step with several ways in; each label (a condition, "otherwise", a link's
`when`) names its flow, cut after a whole word within 48 characters and
whole in the flow's documentation.

`mining.export_bpmn` writes valid BPMN 2.0 with diagram interchange and its
own pure-Python layout: left to right, wrapped into rows when one row would
print its labels below 8.5 pt on a landscape page, every flow routed around
the boxes, and every element and name placed clear of the boxes, the lines
and the other names. What a BPMN tool receives besides the shapes:

- **Tasks** named by the step names (the system stays out of the name, so
  an import into a BPMN tool stays clean). A task is a `manualTask` when
  every step it stands for was added by hand (manually authored, no
  recorded interaction), else a `userTask` (C18).
- Each task's `<bpmn:documentation>`: the step's analyst description (the
  pattern run's first), then one line "System, screen. In N of M
  transactions, T on average." (no run count for the implicit run, no time
  when no step of the task has one).
- **Events.** The start event is named from the first line of the
  document's `trigger` (unnamed while it is empty), the main end event from
  the first line of `result`, else "End". A link to the end from a step no
  transaction ended at gets an end event of its own, named by its `when`
  (cut like a flow name, whole in its documentation; the flow into it
  carries no name, so the `when` is said once). A link without a `when`,
  or from a step where a transaction ended, goes to the main end.
- **Branch names.** A branch leaving a gateway without a declared name says
  "N of M transactions", the transactions that took it (not counted in the
  implicit run of a session without a recording).
- **A colour per system** (C18): each task's fill and stroke, written as
  bpmn-js's `bioc:fill` and `bioc:stroke` (other tools ignore them), from a
  palette of nine named colours in the order the systems are first used
  (the reference transaction first: the PDD's order). A tenth system and
  later keep the default look. One text annotation, `TextAnnotation_legend`,
  lists them: "Colour by system", then one line per system ("SAP: orange",
  "no colour" past the palette). It sits inside the map where there is
  room, else beside or under it.
- **Notes** (C18): the analyst's notes on a task's steps (`analyst_notes`
  with a `step_id`) are one text annotation above the task, joined by an
  association: one note per line, the text cut after a whole word within 90
  characters, whole in the annotation's documentation. A note on a moment
  is on no task.
- **Attachments** (C18): each file attached to a task's steps is a data
  object under it (`DataObjectReference_<attachment id>`, named by the
  label, else the file name, documented with `attachments/<file>`), joined
  by a data input association.
- A step name on several tasks (a transaction that comes back to a step)
  shows its notes and files on the first.

**Sub-processes (C19).** `sub_process_maps.map_tree` lists the project's
maps, the rule `shared/sub-process-maps-golden.json` pins for this module
and the viewer: the main map from one trace per transaction; below it,
consecutive visible steps with one map node are one visit, a visit of a
sub-process node (a step that carries `sub_steps`) gives one trace, its
visible sub-steps, and a sub-process's map is drawn from every visit of its
node at its level; each map has a path of nodes and a number (the step
number through the reference transaction, "2", "2.4", or none). Every map
is a plane of the one file (`bpmn_observed._sub_process_planes`, written by
`mining.export_bpmn`, one `_Plane` per map, recursively):

- A sub-process node is a collapsed `bpmn:subProcess` in its parent's map,
  in place of the task: task sized, its shape `isExpanded="false"`, named
  by its node, documented, coloured and joined to its notes and files like
  a task. It holds its map's model, drawn in a `bpmndi:BPMNDiagram` of its
  own whose plane's `bpmnElement` is the sub-process. A node on several
  tasks is a sub-process on each; the first holds the map.
- The map is chosen as the main one from its own traces (the flow edges
  when the flow set on its steps changes the map, a chain for one trace,
  else the miner); a sub-process with no steps is a start joined to an end.
  Its start and main end are unnamed, its early ends named from their
  `when`. Its counts ("In N of M transactions", the branch names) are over
  the transactions that ran the sub-process, not its visits.
- Notes, attachments and colours as above on every plane. Each plane has
  its own legend of the systems drawn in it; a system keeps one colour
  across the file (the main map's systems take the first colours).
- The main plane keeps its ids, so a file without a sub-process is written
  byte for byte as before. Every id inside a sub-plane starts with
  `Sub<n>_`, n the map's place in `map_tree`'s list, so the ids are unique
  in the file.

It is the file Edit as the As-Is map copies (a reference map, ADR-0019),
the map the PDD prints when no As-Is copy is chosen, and the picture
Export's Process map (image) saves then; the viewer draws each with bpmn-js.
The pipeline never touches a copy.

## The PDD (`pdd_export.py`)

A `.docx` a process manager can hand over: tool-neutral (any automation
technology, or none), built around the reference run (the confirmed pattern
run, contract C3), with a grid on every table and a page of its own for each
map picture (landscape when the picture is wide, as large as the page
allows). Hidden steps never appear. The analyst's document fields (C6,
`annotations.document`) fill their places and survive re-export; an empty
field prints a "[To be completed: ...]" gap, and only those fields leave
gaps. The sections, in the reader's order:

1. **Document control.** The process (the document title), the project
   folder, when it was recorded and by whom (the SME's profile name, else
   the Windows login), the transactions recorded, whether a video is
   attached, the request when one was set (AD-30), the date generated,
   "Draft".
2. **Purpose and scope.** 2.1 Purpose, 2.2 Scope, 2.3 Trigger, 2.4 Result,
   2.5 Key contacts.
3. **As-Is process.** 3.1 the As-Is map: the picture passed with
   `--pdd-map-image`, else the map from the runs as a table (each step and
   the steps that followed it, with the number of runs) and a line naming
   `process_map_step.bpmn`. 3.2 the steps of the reference run: first the
   systems the process runs through, then one heading per step with its
   context line, "Only when ..." when the step has a condition (C17), its
   description (C7: the analyst's text; a draft's generated narration is
   left out), the fields it entered, its attachments, its screenshots, the
   waste flag, and one line per link: "Then goes back to step N, <name>,
   when ...", "Then goes on to step N ...", "Then skips to step N ..." or
   "The process ends here when ...". A step whose map node is a
   sub-process (C19) ends with "Sub-process: see 3.<k>.". After 3.2, one
   section per sub-process map with a number, depth first: "3.<k>
   Sub-process <number>: <name>", its map on a page of its own (its picture
   from `--pdd-map-images`, alternative text "As-Is process map,
   sub-process <number>", else the table 3.1 falls back to, counted over
   the transactions that ran it), then the steps of the reference
   transaction's first visit, numbered "<number>.<i>" and printed like
   3.2's, a link numbered as the chapter numbers it and an end reading
   "The sub-process ends here ...". A group of steps (C19) prints its name,
   its line, its condition, its description when written, its attachments,
   its flow and the pointer, but not the fields or the screenshots its
   chapter prints.
4. **Variations, rules and exceptions** (sections 4 to 9 read the main
   level only). 4.1 how each other run differed
   from the reference run (extra steps with their system, where and in how
   many runs; skipped steps; a different order; steps repeated within a
   run), aligned by draft key, merge key, else label: the rule the viewer's
   differences view uses, pinned by `shared/run-differences-golden.json`.
   4.2 Business rules, 4.3 Exceptions (application errors included).
5. **Data.** One table: every field entered, with its system and screen, its
   step, an example value and a Re-keyed mark; below it, one sentence per
   field whose value is typed in one system and typed again in another in
   the same run, with the number of runs that did it.
6. **Applications and time.** 6.1 each run's steps, active time and elapsed
   time, with a line saying the runs were recorded as a walkthrough, so the
   times show the recording, not the usual handling time. 6.2 per system:
   its screens, its steps and its time per run.
7. **Improvement and automation scope.** The analyst's field; 7.1 the To-Be
   map picture when one was passed.
8. **Notes**, only when written.
9. **Attachments** (numbered 8 without notes), only when the analyst
   attached files: each file's label and name. Nothing is embedded; the
   files stay in the session folder's `attachments/`.

**The step context line** under each step heading: system and screen, the
average time, "in N of M transactions", and where it is in the recording
("Transaction 1 at 0:19", the time since the recording started, plus the
video time when the video's start is known; in a video session, the video
time). Each part is left out when it is unknown; a step without a time
prints no time, never a zero.

**Screenshots.** A step prints the screenshot the analyst chose for the PDD
(`step.pdd_screenshot`), else all of its screenshots (its recorder
screenshots, then the ones the analyst added to it), never one taken off the
step (`step.hidden_screenshots`). A path outside the session folder is never
embedded.

The PDD prints no analysis finding and reads no analysis stage, so a failed
stage changes nothing in it. The notes the analyst pins to steps and moments
(`annotations.analyst_notes`) are context in the viewer: the PDD's text
leaves them out, while its picture of the step map shows a step's notes
beside its task (above).

## System names (`shared/system-names.json`, contract C14)

One ordered rule list turns an application (its process name, lowercase,
without `.exe`) and a window title into the business system the work
happened in: SAP, Excel, Outlook, and for a browser window the web system
its title names (Salesforce, ServiceNow, Jira, Zendesk). The first matching
rule wins; a rule without a title pattern also names the application itself.
`app_names.py` reads it:

- `build_app_names` gives each executable a readable name for `stats.json`
  `meta.app_names`: a rule without a title first, then a vocabulary's name,
  then a window-title segment that names the executable, then the
  capitalized executable name. Never an invented product name.
- `system_name(app, title, names)` names the system of one application and
  window title: the first matching rule, else the readable name.

The PDD and the step map name systems through `step_context.py`, which also
derives a step's value-free screen from its window title and prefers a
vocabulary's screen name when it contains the title's screen. A system the
analyst set on a step (`step.system`, C16) wins. The viewer applies the same
rules from the same file (`viewer/system-names.js`).

## Sessions without a recording (contract C16)

A session can also start from a video or from nothing: `manifest.source` is
`"video"` or `"blank"` (absent means `"recorder"`), with an empty
`events.jsonl`. The viewer creates them ("New project from a video..." and
"New empty project..." in the New menu). `session_io.has_recording` tells
the stages apart:

- **The implicit run.** While the derived stream has no start marker, the
  session has one open run covering it all (`case_assignment.add_implicit_run`,
  `case_id` `uuid5(<C9 namespace>, "<session_id>:implicit-run")`), and every
  step belongs to it. `stats.json` marks its row `implicit: true`;
  `analysis.case_quality.mode` is `"implicit"`. A start marker inserted by
  hand replaces it, exactly as in a recording.
- **Steps without a time.** A step the analyst added may have
  `time_range: null` and an `order`. Every stage orders a run's steps by
  time, then by `order`; the timed figures leave such steps out, and nothing
  prints a time for them.
- **Nothing recorded.** Each run's `active_ms` is `null`; the step-based
  block, `facts`, `findings` and `pdd_findings` are `null` with no
  `stage_errors` entry; `case_quality` still counts the runs, coverage
  `null`. The PDD says the runs were not marked (implicit run) or that
  nothing was recorded (blank session), and points at the video time in a
  video session.

What the analyst adds lives in the session folder and travels with it: the
screenshots added by hand (`screenshots/analyst/`,
`annotations.analyst_screenshots`), the attachments (`attachments/`,
`annotations.attachments`), the notes (`annotations.analyst_notes`) and a
step's `system`, `pdd_screenshot`, `hidden_screenshots` and `order`. The
pipeline reads them and never writes them; the viewer writes them. Shapes:
SCHEMA.md.

## Module map (`normalization/`)

| File | Role |
|---|---|
| `normalize.py` | CLI entry point and the thin orchestrator; re-exports the names older callers import from it. |
| `pipeline_stages.py` | The `_run_*` stage helpers and `_init_existing_anno`, which keeps the analyst's blocks and never seeds or rewrites the keys of cut features (contract C10). Heavy optional imports (analysis, pm4py, the PDD) stay inside the stage that needs them. |
| `session_io.py` | `load_events`, `load_manifest`, `load_annotations` (raises `AnnotationsUnreadable`), `write_annotations` and `write_json_atomic` (temp file, then `os.replace`), the screenshot hash pass, and `session_source` / `has_recording` (C16). |
| `pipeline_config.py` | Per-session settings from `annotations.json`: the ignored apps, the excluded ranges, and the calibration block (only `coalesce_idle_ms` and `filter_browser_chrome` still apply; the old segmenter's keys are read and ignored). |
| `process_filter.py` | Drops PDT's own windows and the excluded apps and window titles from the derived stream. |
| `coalesce.py` | Folds typing bursts into one final-value event. |
| `marker_edits.py` | Replays the analyst's marker edits onto a derived stream; an insert becomes a synthetic marker with event id `insert-<edit_id>`. |
| `case_assignment.py` | Marker-based runs (never nested), deterministic case ids, `case_ids` stamping, the implicit run (C16). |
| `app_vocab.py` | Loads the shipped vocabularies (`app_vocabularies/*.yaml`, plus any folder in `PDT_APP_VOCABULARIES`) and enriches matching interactions. `regex_guard.py` refuses authored title patterns that could backtrack catastrophically. |
| `app_names.py` | Readable application names and business system names from `shared/system-names.json` (above). |
| `step_context.py` | Where and when a step happened, in the reader's words: its system and screen, its duration (none without a time), the step order (time, then `order`), the recording clock ("0:19") and the video start. Read by the PDD and the step map. |
| `recognition.py` | The platform recognition layer (below). |
| `step_suggest.py` | The drafting rule, `session_names()`, `load_remembered_names()`, `draft_summary()`, `_merge_steps()`, `restamp_preserved_case_ids()`, `step_identity()` (the alignment and grouping key), and the value-free `process_label` and `screen_label` from the shared rule files. |
| `classification.py`, `classification_overrides.py` | Taxonomy classification and the override replay; internal only. |
| `stats_compute.py` | Builds the `stats.json` statistics; step statistics group by `process_label`. |
| `case_quality.py`, `motifs.py`, `facts.py`, `findings.py` | The measured blocks of `analysis.json`: run coverage, repeated sequences, direct measurements, and the findings detectors with their evidence. |
| `analysis*.py` | The step-based estimates: waste, time study, segments, automation candidates (ranked by `instance_count x mean_elapsed_ms x 0.7`), efficiency. |
| `mining.py` | pm4py's inductive miner and the pure-Python BPMN writer and layout (`export_bpmn`: task kinds, colours, notes, data objects and the legend placed with the rest; one `_Plane` per map, a sub-process's map written inside its collapsed `bpmn:subProcess` and drawn in a diagram of its own, C19); only the step map uses it. |
| `bpmn_observed.py` | The step map from the runs' visible steps: the chain, the mined model or the step flow edges, with its documentation, event and branch names, early ends, what C18 adds beside the tasks (`_map_extras`), and a plane per sub-process (`_sub_process_planes`, C19). |
| `step_flow.py` | The step flow of contract C17, pure (no pm4py): `flow_edges` (the rule the viewer's map shares, pinned by `shared/flow-links-golden.json`), `changes_map`, `declares_flow`, and a step's `condition_of`, `links_of` and `node_of` (the map node: a drafted step, `draft_key`, or a drafted sub-step, `action_key`, is its name). |
| `sub_process_maps.py` | Contract C19, pure (no pm4py): `map_tree`, the maps a project holds (the main one, then one per sub-process, depth first), each with its path of nodes, its number and the traces it is drawn from, pinned with the viewer by `shared/sub-process-maps-golden.json`. The step map's planes and the PDD's chapters read it. |
| `pdd_export.py` | The PDD (above). |
| `memo_export.py` | What is left of the findings memo: `run_rows` (the runs the PDD's tables read), the "could not run" wording, and `pdd_findings` (still written to `analysis.json`; nothing reads it). No memo document is written. |
| `transcript_import.py` | The transcript parser and its CLI (above). |
| `golden_check.py` | The session golden (above). |
| `_dt.py`, `log_setup.py` | One ISO 8601 timestamp parser for every module; the rolling `normalize.log`. |

Deleted with their features ([ADR-0029](../adr/0029-ba-helper-refocus.md)):
`xes_export.py`, `csv_safe.py`, `marker_suggest.py`, `anchor_suggest.py`,
`canonical_match.py`, `phase_reconcile.py`, `discover_vocab.py`,
`signature_pick.py`, `pii_masking.py`, `analysis_roi.py`, `step_csv.py`,
`bpmn_step.py` and `bpmn_phase.py`.

## Vocabularies, remembered names and saved processes

**App vocabularies** (`normalization/app_vocabularies/*.yaml`, rationale in
[ADR-0002](../adr/0002-app-vocabularies.md)) still load and match as before:
they give interactions a `meaningful_name`, a `screen_id` and default flags.
Nothing in the app edits or discovers vocabulary entries anymore
([ADR-0025](../adr/0025-in-app-vocabulary-discovery.md) is superseded).

Two lighter mechanisms replace the workbenches, both owned by the viewer
(contracts C4 and C5):

- **Remembered names**: a store keyed by `draft_key`. The pipeline reads it
  through `--names` at draft time, after the session's own names, so a step
  named once arrives named in every later session.
- **Saved processes**: confirmed pattern runs the viewer compares a new
  session with, by `draft_key` overlap. `normalize.py` never reads this store.

Both shapes are in [SCHEMA.md](../../shared/SCHEMA.md).

## Recognition layer

`recognition.py` gives an interaction a semantic category (`form_field`,
`grid_cell`, `primary_action`, `browser_chrome`, and others) from documented
platform and framework signatures (UIA control types, Chromium, Bootstrap,
AG-Grid, SharePoint, Office), not from one app's opaque selectors. The
signature table is `shared/recognition-patterns.json`, loaded by this module
and by `viewer/recognition.js`, so both classify alike. It feeds the
browser-chrome filter before drafting and the classification fallback.
Rationale: [ADR-0011](../adr/0011-platform-recognition-layer.md).

## Outputs

Written into the session folder: `stats.json`, `analysis.json`, the updated
`annotations.json`, `process_map_step.bpmn` (with `--mine`) and
`normalize.log`. The PDD goes to the `--pdd-out` path. `transcript_import.py`
writes `transcript.json` and the `transcript/` copy. Re-running is
non-destructive; `stats.json.meta.normalization_run_at` tells a consumer when
the outputs were made. Field-level detail:
[SCHEMA.md](../../shared/SCHEMA.md), "Post-normalization artifacts".
