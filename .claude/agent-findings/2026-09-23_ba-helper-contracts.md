# BA-helper cycle: shared contracts (2026-09-23)

The single source of truth for the data shapes the lanes of this cycle share.
Every lane brief points here. If a lane finds a contract here unworkable, it
STOPS on that item and reports; it never silently diverges. The docs lane moves
the final shapes into shared/SCHEMA.md and ADR-0029 at the end of the cycle.

Two implementation choices refine the plan's wording (plan section 6):

- AD-7: light vocab is a small **remembered-names store keyed by `draft_key`**
  (C4), not app_vocab YAML entries. Step-level names are not control-level
  vocabulary; one exact-key lookup is simpler and cannot drift. The app_vocab
  engine stays as support (shipped vocabs still enrich control names).
- AD-8: light template is a **saved-process store** matched in the viewer by
  `draft_key` overlap (C5). `canonical_match.py`, the Process Template editor and
  `viewer/canonical-author.js` are therefore not needed and are cut.

## C1. Drafted steps (pipeline output, `annotations.steps[]`, state `auto_suggested`)

Drafting rule (plan section 5, step 3): within one run (case), walk interactions in
time order; a step is a run of consecutive interactions on one screen, and it ends
at (a) a commit interaction: `kind == "invoked"` on a commit-type control
(`Button`, `SplitButton`, `MenuItem`, `Hyperlink`), or any interaction whose vocab
semantics carry `completion: true`, inclusive; or (b) the first interaction on a
different screen (exclusive); or (c) the end of the run. Tuning knobs, if any, live
in the existing `calibration` block and default to the rule as stated.

New/defined fields on every drafted step, in addition to the existing step entity:

| Field | Type | Meaning |
|---|---|---|
| `draft_key` | string | Value-free identity: `"<app>|<screen>|<commit>"`. `app` = process_name lowercased, `.exe` stripped. `screen` = the value-free screen label (vocab `screen_id` when present, else the shared screen-label rules applied to the window title). `commit` = `"<control_type>:<identity>"` of the commit interaction where identity is automation_id, else name, else class_name, else `"?"`; or the literal `"(visit)"` when the step did not end on a commit |
| `name_source` | string | `"remembered"` when the name is one the analyst gave before: from this session's analyst steps or from the remembered-names store (C4, lane LUX-P); else `"draft"` |
| `end_reason` | string | `"commit"`, `"screen_change"` or `"run_end"` |

Default draft name when not remembered: `"<Screen label>: <commit label>"`, or
`"<Screen label>"` for a `(visit)` step. Commit label = the interaction's
`meaningful_name` (vocab), else `name`, else `control_type`. Names never embed
typed values.

## C2. Step states

`auto_suggested` (draft), `manually_authored`, `edited`, plus the new
**`confirmed`**: the analyst accepted a draft unchanged. `confirmed` is preserved by
re-normalization exactly like `edited` and `manually_authored`. (`auto_matched`
disappears with canonical matching.)

## C3. Pattern run (`annotations.pattern_run`, viewer-written)

```json
"pattern_run": {
  "case_id": "<case_id of the run used as the pattern>",
  "confirmed_at": "ISO 8601 or null",
  "draft_fixes": { "merge": 0, "split": 0, "add": 0, "drop": 0 },
  "drafted_steps": 7
}
```

`drafted_steps` (added in L7a): the run's draft count at the moment it became the
pattern; the probe line's fallback N when stats lack `draft_summary`.

- Default pattern run: the first run by start time that has at least one step. The
  analyst can pick another run as the pattern.
- "Confirm run" converts that run's remaining `auto_suggested` steps to `confirmed`.
  A run is confirmed when all its non-hidden steps are in an analyst state
  (`confirmed`, `edited`, `manually_authored`).
- `draft_fixes` counts the boundary fixes made to the pattern run's drafts while
  confirming it (merge, split, add, drop; renames are not counted). This is the P1
  draft-quality probe instrument: a structure-only number the owner can report.
- The pipeline preserves this key verbatim and never regenerates it.

## C4. Remembered names (light vocab), analyst machine

File: `<viewer userData>/pdt-library/remembered-names.json`, written atomically
(temp file + rename) by the viewer.

```json
{ "version": 1,
  "names": { "<draft_key>": { "name": "Look up customer", "updated_at": "ISO 8601" } } }
```

- Written when the analyst renames a step that carries a `draft_key`. Removing a
  name ("forget") deletes the entry.
- Within a session, a rename also applies immediately to every still-draft step in
  the session with the same `draft_key`.
- Read by the pipeline at draft time through the CLI flag `--names <path>`
  (optional; absent or unreadable = no remembered names, and a warning on stderr).
  The viewer passes it on every Analyze.
- **Name precedence at draft time (F1, lane LUX-P).** Names travel with the
  session folder: a draft takes, in this order, (1) the name the analyst gave to
  a step with the same `draft_key` in this session's `annotations.steps`, states
  `edited` or `manually_authored` (a typed name), then `confirmed` (an accepted
  name); hidden steps name nothing; within each, a single step's `draft_key`
  names its key before a merged step names each key of its `draft_keys`, and
  among steps of one key the pattern run's comes first, then time order
  (`step_suggest.session_names`); (2) the remembered-names store's name
  (`--names`); (3) its drafted name. (1) and (2) both give
  `name_source: "remembered"`. So the same session analyzed or exported on another
  machine drafts the same names, and a rename in run 2 still names runs 3 to N
  after re-analysis when run 1 was confirmed under the drafted name. Viewer note:
  the Rename of the Remembered step names dialog (Saved names... until lane CL)
  renames the store and the session's drafts
  but not its edited or confirmed steps of that key, so the next analysis gives
  those drafts the session's name back (lane V to align).
- **Groupings key on identity, not on names.** The repeats (motif and bounce
  detection, section 4.1's repeated steps) and the automation groupings (segment
  signatures) key on `step_suggest.step_identity`: `draft:<draft_key>`,
  `merge:<JSON draft_keys>`, else `label:<process_label>` for a step with no draft
  identity (the differences' alignment key, C3 and the shared golden). Finding and
  segment ids hash the identities, so their ids changed once with this lane.

## C5. Saved processes (light template), analyst machine

File: `<viewer userData>/pdt-library/processes.json`, written atomically by the viewer.

```json
{ "version": 1,
  "processes": [ {
      "id": "proc-<uuid>", "name": "Incident logging", "saved_at": "ISO 8601",
      "source_session_id": "<session_id>",
      "steps": [ { "draft_key": "...", "name": "...", "description": "...", "waste": false } ]
  } ] }
```

- "Save as this process" writes the confirmed pattern run's non-hidden steps in
  time order.
- On session open, if the session has no confirmed pattern run, the viewer picks the
  saved process with the highest overlap of distinct `draft_key`s (Jaccard, minimum
  0.5) and uses it as the comparison pattern, with a visible, reversible line
  ("Compared with saved process X", with a way to stop comparing).
- The pipeline never reads this file.
- Removed from the app on 2026-09-24 (owner: a process is recorded once; comparing recordings is the product line). The store format above is kept here so it can come back.

## C6. Document sections (`annotations.document`, viewer-written; AD-2)

```json
"document": { "title": "", "purpose": "", "scope": "", "trigger": "", "result": "",
              "contacts": "", "business_rules": "", "exceptions": "",
              "improvement": "", "notes": "" }
```

Plain multi-line strings. The PDD renders each non-empty field in place of the
matching placeholder; empty fields keep today's placeholder. Survives re-export.

Lane LUX-P added `trigger` (what starts the process), `result` (what it has
produced when it ends) and `improvement` (printed as "Improvement and automation
scope"; it replaces the old 5.1 In scope and 5.2 Out of scope gaps). Where each
field prints: `title` as the document's title and Document control's Process;
2.1 `purpose`, 2.2 `scope`, 2.3 `trigger`, 2.4 `result`, 2.5 `contacts`;
4.2 `business_rules`; 4.3 `exceptions` (it now also holds the application errors:
the old 6.4 is gone); 7 `improvement`; 8 `notes` (only when written, no gap). A
"[To be completed: ...]" gap is printed only for these eight fields (all but
`title` and `notes`), so every gap is one the analyst can close in the app once
the viewer has an input for it (trigger, result and improvement: viewer lane).
The step-level BPMN names its start event from the first line of `trigger` and
its end event from the first line of `result` (C15).

## C7. Step notes

The step editor's "Description" writes the step's `description`. The PDD uses
`description` as the step's text in the detailed steps.

## C8. Transcript (P6)

Session folder: the original file is copied to `transcript/<original name>` and a
parsed, derived `transcript.json` is written next to `annotations.json`:

```json
{ "version": 1, "source_file": "transcript/meeting.vtt", "format": "vtt",
  "clock": "video",
  "offset_ms": null,
  "segments": [ { "id": "t0001", "start_s": 12.34, "end_s": 15.0,
                  "speaker": "Ana", "text": "now I look up the customer" } ] }
```

- Parser: Python standard library only (`.vtt` text; `.docx` via zipfile + XML),
  so tests run on any Python.
- `clock: "video"`: segment wall time = session start + `external_video.offset_ms`
  + `start_s`. `clock: "own"` (no video): `offset_ms` maps transcript t=0 to wall
  time, set by matching one sentence to one moment.
- Viewer time rule (L11b; refines the two clock bullets above): a sentence's wall
  time is `started_at + offset + start_s`, where offset is `transcript.offset_ms`
  when it is a number (the analyst synced it), else the attached external video's
  `offset_ms` (D2: the transcript shares the meeting video's clock, so a video
  re-sync moves it too), else the transcript is not synced and nothing is placed.
  For both clocks `offset_ms` is relative to `manifest.started_at`, the reference
  the video offset uses. `clock` is informational. Sync (pick a sentence, click the
  timeline moment) writes `offset_ms` into transcript.json; re-import resets it to
  null. Remove transcript deletes transcript.json only; `transcript/<original>`
  stays.
- Pulling a sentence appends it to a step's `description` or to a C6 document field;
  the analyst can edit it afterwards.
- CLI (built in L11a, `normalization/transcript_import.py`):
  `python transcript_import.py <session_folder> <transcript_file>`. Exit 0 = imported
  (one summary line on stdout, UTF-8); 1 = bad arguments or not a session folder;
  2 = transcript unreadable or its layout unsupported (nothing written); 3 =
  annotations.json unreadable or the output write failed (the previous transcript
  is kept). Errors are one stderr line starting `[transcript] ERROR:`.
  `transcript_import.parse(path)` returns `{"format", "segments"}` and raises
  `TranscriptError` without writing anything.
- Supported layouts (no real Teams file was available; owner to confirm with one):
  WebVTT with `<v Name>` voice tags and padded or unpadded timings (confident);
  WebVTT Graph-export variants (confident for Graph exports); Word "timing, speaker,
  text" paragraphs (confident up to 2023); Word "Name 0:03" then text (least
  certain).

## C9. Case identity (RP-01)

Marker cases get deterministic ids: `uuid5(<fixed namespace>, "<session_id>:<start
marker event_id>")` (synthetic inserted markers use their `insert-<edit_id>` event
id). On re-normalization, a preserved analyst step whose `case_id` is not among the
current case ids is restamped by time containment (the run whose span contains the
step's time range); a step contained by no run gets `case_id: null`.

## C10. Legacy keys

Re-normalization keeps round-tripping every annotations.json key it does not own
(including keys of cut features: `group_annotations`, `phases`, `memo_selection`,
`roi_inputs`, `self_annotations`, anchor and suggestion keys). The viewer ignores
keys of cut features. Old annotations.json files load without error.

## C12. Stage failures (`analysis.json.stage_errors`; RP-10)

```json
"stage_errors": [ { "stage": "facts", "error": "KeyError: 'duration_ms'" } ]
```

- Absent or empty when every analysis stage ran. When a stage fails, its output
  key is `null` (never an empty list or zeros), and one entry names the stage.
- Every renderer (Overview, PDD) shows a failed stage as "this check could not run
  on this recording", never as a measured negative ("nothing stood out", zeros).
  Since lane LUX-P the PDD reads no analysis stage (its findings section is cut),
  so a failed stage changes nothing in it.

## C13. normalize.py exit codes (RP-04, RP-09)

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Usage error, not a session folder, or an unexpected crash |
| 2 | annotations.json exists but cannot be parsed; nothing was written. The message names the file and the viewer's backups (annotations.json.2 to .5) |
| 3 | A requested export (for example `--pdd-out`) failed; the analysis outputs were written, the export was not |

Errors go to stderr as one line starting with `[normalize] ERROR:`. The viewer
treats any non-zero exit as a failure and never opens a stale export file.

## C11. CLI surface after the cycle (`normalization/normalize.py`)

Kept: `session_folder`, `--taxonomy` (until Q4), `--mine`, `--pdd-out`,
`--pdd-map-image`, `--pdd-tobe-image`. Added: `--names <path>` (C4, lane L6).
Removed with their features (L3, L4): `--canonical`, `--phase-bpmn-out`,
`--step-csv-out`, `--memo-out`, `--bootstrap-vocab-out`, `--vocab-id`,
`--vocab-name`, `--bootstrap-vocabs-json`, and `--step-bpmn-out` (it only ever
rendered a template's steps; the step-level map BPMN the viewer exports is
`process_map_step.bpmn`, written by `--mine`).
The transcript parser has its own entry point (C8), not a normalize.py flag.

## C14. One vocabulary of systems (`shared/system-names.json`; AD-28, lane LUX-P)

One list, read by Python (`normalization/app_names.py`) and by the viewer, turns an
application and a window title into the business system the work happened in.

```json
{ "_README": "...", "version": 1,
  "rules": [ { "process": ["chrome", "msedge"], "title": "\bSalesforce\b", "system": "Salesforce" },
             { "process": ["sapgui", "saplogon"], "system": "SAP" } ] }
```

- The rules are ordered; the first match wins. A rule matches when the application
  (process name lowercased, `.exe` stripped) is in `process` and, when the rule has
  a `title`, that regular expression finds a match in the window title, ignoring
  case (plain patterns only: they run in Python and JavaScript).
- A rule without `title` also names the application itself: `build_app_names` (so
  stats.json `meta.app_names`) takes it first, before a vocabulary's name, a window
  title word or the capitalized executable name.
- `app_names.system_name(process, title, app_names)`: the first matching rule's
  system, else the application's readable name (`display_name`). The PDD, the step
  BPMN's documentation and the findings name systems through it; the viewer applies
  the same rules (legend, step fact line, map boxes: lane V2).
- The demo's five applications resolve to Salesforce (Chrome on Salesforce), SAP,
  Excel, Outlook and Notepad (pinned by `test_app_names.py`).

## C15. The PDD's inputs and the step map file (lane LUX-P)

- `--pdd-map-image <png>`: the picture of the As-Is map. The viewer passes the
  edited As-Is copy when one is chosen (`RefmapUI.renderPddMaps`), else today the
  live map's cytoscape PNG, and only when the Map level was drawn in this viewer
  session (`dfg-viewer.exportPng` returns null otherwise); that PNG is one long
  row (2734 x 238 px on the demo, labels at about 5 pt on a landscape page).
  **Viewer half (V1):** when no As-Is copy is chosen, pass a bpmn-js render of
  `process_map_step.bpmn` (the same `renderEntryToPng` path the copy uses, read
  from the session folder), so the map from the runs prints like the copy.
  The pipeline cannot draw the image itself (no renderer in the bundled Python).
  Without an image the PDD still fills 3.1: the map from the runs as a table (each
  step and the steps that followed it, with the number of runs), plus a line naming
  `process_map_step.bpmn` when the folder has it.
- A map image gets a page of its own, landscape when it is wider than tall, as
  large as the page allows; the picture's alternative text is "As-Is process map"
  or "To-Be process map" (the e2e smokes read it).
- The PDD prints no analysis finding (its former section 1 is cut). analysis.json
  keeps `pdd_findings` and annotations keep `memo_selection` exactly as before
  (C10) until the viewer lane removes the "include in PDD" boxes.
- `process_map_step.bpmn` (written by `--mine`, the Fork source): valid BPMN 2.0
  with diagram interchange, laid out left to right and wrapped into rows when one
  row would print its labels below 8.5 pt on a landscape page (rows end where the
  fewest flows cross), every flow routed around the boxes. Each task carries
  `<bpmn:documentation>`: the step's analyst description (the pattern run's first),
  then "System, screen. In N of M runs, T on average."; the start and end events
  are named from the first line of `document.trigger` and `document.result`
  (unnamed while empty); each flow leaving a branching gateway is named
  "N of M runs" (the runs whose steps take it, by replaying each run through the
  model) with a `BPMNLabel` position. The viewer's live map is unchanged.

## C16. Analyst-added content and sessions without a recording (AD-25, AD-27; lanes V3-P and V3-V)

Everything the analyst adds lives in the session folder, so it travels with it.

- **Session kinds.** `manifest.json` gains `source`: `"recorder"` (absent means recorder),
  `"video"` or `"blank"`. The viewer creates video and blank sessions: a new folder with
  `manifest.json` (`session_id` a uuid, `started_at`: for video the moment the analyst
  says the video starts, default the file's creation time; for blank the creation
  time), an empty `events.jsonl`, and `annotations.json` (for video, `external_video`
  with the path relative to the folder and `offset_ms: 0`).
- **Runs.** Video and blank sessions with no run markers have one implicit run covering
  the whole session, so the analyst can add steps at once. Markers inserted by hand
  (`marker_edits`, synthetic `insert-<edit_id>` events) replace it, exactly as in a
  recorder session. Settled by V3-P: "no run markers" means no start marker in the
  derived stream (an end marker alone opens no run, so it does not remove the implicit
  run). The implicit run's `case_id` is `uuid5(<C9 namespace>, "<session_id>:implicit-run")`;
  it is open (no end), starts at `manifest.started_at`, and its `stats.json` `case_stats`
  row carries `implicit: true` (label, end_ts, wall_clock_ms, end_reason and active_ms
  null); `analysis.case_quality.mode` is `"implicit"`. It contains every step: a
  preserved step whose `case_id` is not a current run (null included) joins it, a step
  without a time too. When start markers replace it, preserved steps move by time
  containment (C9), and a step without a time then belongs to no run.
- **Steps without times.** A hand-added step may have `time_range: null` (blank
  sessions, or a step added without a playhead). Such steps order by `order` (an
  integer, set by the viewer, unique within the run); a step with a time orders by
  time. Every pipeline stage, the map and the PDD accept both. Settled by V3-P: within
  a run, the steps with a time come first in time order, then the steps without one in
  `order`, then any step with neither (list order). A step without a time has no
  duration: the timed figures leave it out (step_stats, the step-based analysis, the
  PDD's times, the map's average time) and nothing prints a time for it. A time range
  the viewer writes is read as measured.
- **System of a hand-added step.** `step.system` (string), set by the analyst. For a
  recorded step the system is derived (C14); an explicit `step.system` wins.
- **Screenshots added by hand.** Files go to `screenshots/analyst/<id>.<png|jpg>`;
  `annotations.analyst_screenshots[]`: `{id, file, step_id | null, at | null (ISO
  time), source: "video_frame" | "paste" | "file", added_at}`. Per step,
  `step.pdd_screenshot` names the one the PDD prints (a recorder screenshot path or an
  analyst screenshot id; absent means the current rule), and
  `step.hidden_screenshots[]` lists recorder screenshots taken off the step (raw
  files are never deleted). Settled by V3-P: `file` is the file name only (the
  pipeline reads `screenshots/analyst/` plus its last part); the current rule prints
  the step's `screenshot_refs` minus the hidden ones, then the analyst screenshots
  whose `step_id` is the step; a `pdd_screenshot` that names no file in the folder, or
  a hidden one, counts as absent.
- **Notes.** `annotations.analyst_notes[]`: `{id, text, step_id | null, at | null (ISO
  time), added_at}`. A note shows where its step or moment shows (the step pane, the
  timeline, the panel). Notes are context in the viewer, not printed in the PDD (the
  document's own Notes field is). Key changed by V3-P from `notes`: `annotations.notes`
  already holds the product edition's Flow notes (`{id, type: "note", timestamp,
  video_offset_s, text}`), both writers seed it as `[]`, and the v1.5.0 viewer reads
  `timestamp` on every entry, so it round-trips untouched (C10) under its own name.
- **Attachments.** Files go to `attachments/<name>` (a numeric suffix when the name
  exists); `annotations.attachments[]`: `{id, file, label, step_id | null, added_at}`.
  The PDD lists them (label and file name) in one short section, and a step's
  attachments by label under that step. Nothing is embedded. Settled by V3-P: `file`
  is the file name only; the section is the last one ("8. Attachments", or "9." after
  "8. Notes"); an empty label prints the file name.
- **Nothing recorded.** Settled by V3-P: in a video or blank session each run's
  `case_stats.active_ms` is null, and `analysis.json` writes the step-based block,
  `facts`, `findings` and `pdd_findings` as null with no `stage_errors` entry (nothing
  failed; C12's null with an entry still means "could not run"); `case_quality` still
  counts the runs, coverage null. The PDD says "Runs were not marked in this session"
  for the implicit run, "Runs recorded: Not marked", "Recorded: Nothing recorded" for
  a blank session, and points at the video time in a video session.
- **Removal.** Removing a screenshot, note or attachment the analyst added deletes its
  entry and its copied file; recorder screenshots are only hidden.

## C17. Step flow: conditions and links set on steps (owner 2026-09-24; lanes F-P and F-V)

The analyst sets the process flow while adding or reviewing steps, not afterwards in the
map editor. The default after a step is always the next step in its transaction.

- **Keys on a step** (any state; a draft touched this way becomes `edited`):
  `only_when` (string or absent): the step happens only under this condition.
  `links` (array or absent): `[{ "to": <step_id> | "end", "when": <string> }]`: after this
  step, when the condition holds, the process goes to that step (earlier: a loop back;
  later: a skip ahead) or ends. A link never points at its own step.
- **Edges** (the same rule for the viewer's live map and the pipeline's step BPMN; pinned
  by `shared/flow-links-golden.json`, which both sides test):
  1. Observed edges: consecutive steps of each transaction, plus start to the first step and
     the last step to end. `observed: true`.
  2. A step S with `only_when`: every edge entering S from its previous step (in each
     transaction where S appears; start when S is first) carries the condition as its
     label, and a skip edge from that previous step to the step after S (end when S is
     last) is added with the label "otherwise".
  3. A link on S adds an edge S to the target (end for "end") labelled with its `when`.
  4. Edges are keyed by (from node, to node) after the map's usual node rule; a declared
     edge that coincides with an observed one is one edge, observed, carrying the declared
     label. The same declaration from several transactions is one edge. Different labels on
     one edge are joined with " or " in step order.
  Settled by F-P (five golden cases added, the " or " order among them): consecutive steps
  with one node are one visit, so "previous step" and "the step after" are the neighbouring
  visits; a path around a step that sits between two visits of one node is not drawn (it
  would join them into one visit); a condition holds for its step's node in every
  transaction where that node appears; a hidden step draws nothing, and a link to it, to
  its own step or to no step is ignored; a link without a `when` is an edge with no label.
  The pipeline's function is
  `normalization/step_flow.py` `flow_edges`; the step BPMN is drawn from its edges only
  when they differ from the observed ones (`changes_map`), else it stays the chain or the
  mined model. Re-normalization keeps a draft that carries either key as `edited`.
- **Where it shows**: the step pane (a Flow line: "Always · then the next step", "Only
  when…", "Go to…" with a dropdown of the transaction's steps in order plus End), the
  live map (labels on the lines), the step BPMN and its image (exclusive gateways, the
  labels as flow names), and the PDD under the step ("Only when …", "Then goes back to
  step N, <name>, when …", "Then skips to step N … when …", "The process ends here when
  …"; F-P: a link to the very next step reads "Then goes on to step N …", since nothing is
  skipped, and a link without a `when` ends at the step's name).
- **Removal**: a link whose target step is hidden or removed is dropped (the viewer says so
  once); Undo restores both.

## C18. Richer maps (AD-32; lanes M-P and M-V)

- **Step BPMN** (process_map_step.bpmn, so also the As-Is copy made from it and the PDD's map
  image): end events named by outcome: the main end takes the first line of
  `document.result` (else "End"); each C17 link to "end" gets its own end event named from its
  `when` (the analyst's words, trimmed, not rewritten: "the order is rejected" names its end
  "the order is rejected"; M-P corrected the earlier example, which rewrote them). The analyst's
  notes on a step (`analyst_notes` with that `step_id`) become one
  `textAnnotation` per step, joined by an `association` to its task. Attachments on a step become
  a `dataObjectReference` named by the attachment's label, joined by a data association to its
  task. Each task gets a fill and stroke per system through the bpmn-js colour attributes
  (`bioc:fill`, `bioc:stroke`; ignored by other tools), from a fixed palette in system order,
  with one legend `textAnnotation` listing the systems. Steps added by hand are
  `bpmn:manualTask`, recorded steps `bpmn:userTask`. Task names stay the step names. Diagram
  interchange covers every new element and the layout keeps them clear of boxes and lines.
  Settled by M-P (`bpmn_observed._map_extras`, `mining.export_bpmn`): a task is a manual task when
  every step it stands for is manually authored with no recorded interaction, else a user task;
  its system is the one its documentation names (the reference transaction's step first). Only an
  edge to the end that no transaction took is split into its own ends, one per `when` (its
  "otherwise" part stays on the main end); an end the transactions reached stays the main end, and
  a link without a `when` ends there too. An early end is named like a flow (cut after a whole word
  within 48 characters, whole in its documentation). The flow into an early end carries no name,
  so the end event says the `when` once (coordinator's call; a BPMN rendering rule only: the live
  map keeps its label on the line into its one End, and C17 and flow-links-golden.json do not
  change). Notes: the
  step's notes in order, one line each, cut at 90 characters, whole in the annotation's
  documentation; a note on a moment is on no task; a label on several tasks (a chain that comes
  back to a step) shows its notes and files on the first. Attachments: `DataObjectReference_<id>`
  and `DataObject_<id>` (the attachment id, so the viewer opens the file), named by the label else
  the file name, documented with `attachments/<file>`; each joined by a
  `bpmn:dataInputAssociation` inside the task (source the reference, target a placeholder
  property, as bpmn-js writes it). Palette in system order (the PDD's order of the systems): blue,
  orange, green, purple, red, teal, pink, yellow, grey (light fills, dark strokes; bpmn-js writes
  the task's name in its stroke colour, 6.9:1 or more on the fill); a tenth system and later keep
  the default look and read "no colour" in the legend, `TextAnnotation_legend`, whose first line
  is "Colour by system". Layout: a note
  above its task level with its left side, the association rising into the bracket's hook; the data
  objects under it; the events' names placed 3 px under them (an end event's circle reaches 2 px
  past its box); the legend inside the map where there is room, else beside or under it,
  whichever prints larger. The mined map keeps each branch name's fixed place unless something
  drawn is there.
- Amended by lane CL (owner's review 2026-09-24: "Each one of these steps in the map have a little
  person in the corner, but no context as to why"): a step done in a system (recorded, or added by
  hand with its system set) is a plain `bpmn:task`; a task is a `bpmn:manualTask` (the hand
  marker, BPMN's "done outside any system") when every step it stands for was added by hand with no
  recorded interaction and no system (none set, none derived); a sub-process is neither (C19). No
  task is a `bpmn:userTask` any more. The legend (`TextAnnotation_legend`) ends with the line
  "Hand icon: done outside the systems" when its plane has a manual task; a plane with manual tasks
  and no system has a legend of that one line. Sub-process planes follow the same rule. An As-Is
  copy made earlier keeps its user tasks and still links (`asis-links.js` matches any task kind);
  the viewer tells a copy made before C18 by the absence of a user or manual task, the legend and
  a task's colour (`reference-maps.js` `predatesRichMap`). The session golden pins the new kinds
  (every task of the demo a `task`; `userTask` and `manualTask` 0).
- **The As-Is map in the viewer is interactive** (the illustrated map was dropped: the links
  replace it): the chosen As-Is copy renders with bpmn-js, not as a flat image, and a click on a
  task opens the step panel for the step it stands for (matched by the map's node rule on the
  task name, as the live map does); a data object opens its attachment; a text annotation shows
  its note. Editing stays in the editor.

## C19. Sub-processes (AD-33; lanes SUB-P and SUB-V)

One project holds one main map plus one map per sub-process, at any depth: the coordinator's
design, approved by the owner on 2026-09-24 ("I like your suggestion on how to do it. Do that.").
The team splits a process into several maps today (sub-processes, parts of a process). There is
no separate image file per map (the owner's remark about images described today's practice).

- **Data.** `step.sub_steps` (an array, possibly empty; absent means a plain step): the step's
  sub-steps, each the same shape as a step, recursively. A step is a sub-process when it carries
  the key. `annotations.steps` stays the main level, so every reader that does not look for
  `sub_steps` sees the main level only, as the 2.0.0 build does (the grounding pass counted about
  20 such readers). A sub-step's `case_id` is its parent's. Links (C17) stay inside one level:
  a sub-step's `to` is a step of its own `sub_steps` list or `"end"`, which ends the sub-process
  only.
  - **A step opened as a sub-process** keeps everything it had and gets `sub_steps`; a draft
    becomes `edited` (the viewer does it, and the pipeline promotes any `auto_suggested` step
    carrying `sub_steps` to `edited`, next to the `declares_flow` rule, so a re-analysis never
    replaces it).
  - **A group** (made by Group into a sub-process): `{step_id (new), name, group: true, state:
    "manually_authored", case_id, time_range (from the first member's start to the last member's
    end, null when no member has a time), order (only when time_range is null: the first
    member's), evidence (the members' interaction_event_ids and screenshot_refs, in order),
    system (the members' one system when they share one), description (empty), sub_steps (the
    members, moved unchanged, hidden ones included)}`. A group carries no `draft_key` or
    `draft_keys` (session names would spread its name to ungrouped drafts); its map node follows
    the main rule (process_label, else the label of its name). Its span and evidence make the next
    analysis drop fresh drafts of the grouped interactions (`drop_overlapping_auto_steps`).
  - **A drafted sub-step** (one per recorded action, see the verbs): the step shape plus
    `action_key` (`"<app>|<screen>|enter:<field>"` or `"<app>|<screen>|click:<control>"`; app and
    screen from the parent's `draft_key` when it has one, else from the action's event) and
    `name_source: "action"` (or `"remembered"`), state `auto_suggested`, no `draft_key` (the
    click on the commit would repeat the parent's key and cross C4 and `--names`). Its name is
    value free (C1): "Enter <field>" for a value typed or chosen, else the Interactions list's
    phrase for the event without any value ("Click Save order"). Its `description` is the phrase
    with the value (Entered "SKU-4471" into Product code.). `time_range` runs from the action's
    first event to the next action's first event (the last action ends at its own last event);
    `evidence` holds the action's event ids and the parent's screenshots taken in that span.
- **Maps** (pinned by `shared/sub-process-maps-golden.json`: `viewer/sub-process-maps.js`
  `mapTree` and `normalization/sub_process_maps.py` `map_tree`, both tested against it). The
  golden's `about` is the rule: the main map has one trace per transaction; below it, consecutive
  visible steps with one node are one visit, and each visit of a sub-process node gives one trace
  (the visible `sub_steps` of its steps); a sub-process map is drawn from the traces of every
  visit of its node at its level, in transaction order, by the C17 edge rule; a hidden step drops
  with its subtree; a map's `path` is the list of nodes from the main map down; its `number` is
  the hierarchical step number through the reference transaction's first trace at each level
  ("2", "2.4"), null when the node is not there (then it gets no PDD chapter); maps are listed
  depth first, the reference transaction first. The map node rule is the main one at every level,
  with `action_key` counting like `draft_key` (the node of a drafted sub-step is its name), on both
  sides with a unit test each.
- **The verbs (viewer).** Every verb applies at the level shown and saves at once; Undo restores
  the whole snapshot, as today.
  - *Open as a sub-process* (the step pane, on a step without `sub_steps`): every visible
    occurrence of the step's node at this level, in every transaction, that has no `sub_steps`
    gets them: one drafted sub-step per recorded action in its `evidence.interaction_event_ids`
    (consecutive events on one field are one action; the kinds the step's Interactions list and
    FIELDS TYPED skip are skipped: focus changes, unnamed controls, empty values), or `[]` when it
    has no recorded action (a step added by hand, a video or empty project). Remembered names win
    (C4 file, key `"action|" + action_key`). Then the Steps level opens the new level. Running it
    again drafts only the occurrences still without `sub_steps`.
  - *Group into a sub-process...* (Steps, when the ticked steps are consecutive visible steps of
    one transaction at this level, two or more; asks for a name): the ticked steps, with any hidden
    steps between them, move into a new group in their place. In every transaction, each other
    stretch of consecutive visible steps whose nodes are all among the ticked steps' nodes becomes
    an occurrence of the same group, so every step of those kinds sits inside the group everywhere.
    Links: a link from outside to a grouped step points at its group; a grouped step's link that
    leaves the group (to a step outside it, or to End) moves to the group; links among members stay.
  - *Add step* inside a sub-process adds a sub-step to the open visit, as at the main level.
  - *Dissolve sub-process* (the step pane of a sub-process, and beside the breadcrumb inside one),
    in every transaction, every occurrence of the node at that level: a group is replaced by its
    sub-steps in place (a link to the group points at its first sub-step; a sub-step's link to End
    points at the step that followed the group, End when it was last; the group's own links move to
    its last sub-step and its Only when to its first; content on the group moves to its first
    sub-step); an opened step loses its `sub_steps`, and the analyst's screenshots, notes and
    attachments on them move to the step. One confirm names what goes (sub-step descriptions and
    flow) when there is any.
  - *Rename*: renaming a sub-process renames every occurrence of its node at that level, whatever
    their state, so the node and its map stay one. Renaming a drafted sub-step renames the
    session's drafted sub-steps with the same `action_key` and is remembered under
    `"action|" + action_key`; a rename of a draft reaches drafts of its key at every level (C4).
  - *Confirm transaction* confirms the reference transaction's drafts at every level, and the
    transaction reads confirmed only when no level holds a draft; *Undo confirm* (it read *Reopen
    transaction* until lane CL) reverses every level. The draft-fix counter (the P1 probe) counts the main level only.
  - *Merge*, *Split* and adding a moment to a step are unavailable on a step that is a
    sub-process, with the reason in one line (dissolve it first, or work on its sub-steps
    inside). Hide hides the subtree with its step. Remove on a group removes its sub-steps too
    (the confirm names how many, and points at Dissolve to keep them).
  - The C17 repairs (a link to a hidden or removed step) run per level.
- **Where it shows (viewer).** Steps and Map share one current level (`State.mapPath`, a path of
  nodes, `[]` the main map).
  - *Steps*: inside a sub-process a breadcrumb names the way down (the main map by the process
    name the document gives, else "Main process"; each crumb goes up). A sub-process row carries a
    "▸ N sub-steps" button that opens its level (a double-click keeps renaming, as on every row). Inside, the list has one block per visit
    ("Transaction 2", "Transaction 2, again"), the reference transaction's block marked as at the
    main level, with the same row facts (steps, time, differences against the reference visit).
    The step pane is the same at every level; Go to lists the visit's steps plus End.
  - *Map*: when the project has a sub-process, a picker ("Map: <name>") lists every map depth
    first, indented, each with its number. The live map draws the chosen level from its traces; a
    sub-process box carries a "+" mark, a click opens the panel (with *Open sub-process*), a
    double-click opens its map. The As-Is canvas shows the chosen level's plane
    (`canvas.setRootElement` on the sub-process's plane, matched by the path of names) when the
    copy has it, else the live map of that level with one line saying the As-Is copy has no map
    for it; bpmn-js's own drill down keeps the picker in step.
  - *Panel*: the occurrences of a node at its level across all visits; a sub-process's panel has
    *Open sub-process*.
  - *Timeline*: the steps lane shows the current level (inside a sub-process, its sub-steps in
    each visit) and its name says which ("Steps in <name>").
  - *As-Is links*: a click on a collapsed sub-process opens its panel; a task in a sub-plane links
    to that level's node.
  - *Help*: one short paragraph on sub-processes and the flow verbs.
- **The step BPMN (pipeline).** Every map of `map_tree` is a plane of the one
  `process_map_step.bpmn`: a sub-process node is a `bpmn:subProcess`, collapsed (its shape in the
  parent plane `isExpanded="false"`, task sized), named by its node and documented like a task,
  holding that map's model, drawn in its own `bpmndi:BPMNDiagram` whose plane's `bpmnElement` is
  the sub-process. A plane's model is chosen as the main one is (the flow model when
  `changes_map`, a chain for one trace, else the miner) from its own traces. Ids inside a
  sub-plane carry a prefix unique in the file; the main plane keeps today's ids. A sub-process's
  start and end are unnamed, except its early ends (named from their `when`, C18). Notes,
  attachments and colours as C18 on every plane; each plane has its own legend of the systems
  drawn in it, a system keeps one colour across the file. Counts on a sub-plane are over the
  transactions that ran the sub-process. A sub-process with no steps is a plane holding a start
  joined to an end. The session golden does not change (the demo has no sub-process).
- **The PDD.** 3.2 prints the main steps as today; a step that is a sub-process adds "Sub-process:
  see 3.<k>." After 3.2, one section per map with a number, depth first: "3.<k> Sub-process
  <number>: <name>", its map on a page of its own (its image, else the flow table 3.1 falls back
  to), then the steps of the reference transaction's first visit, numbered "<number>.<i>" and
  printed like 3.2's (with their own pointers to deeper chapters). A group's block has its name,
  its description when written, its time, its flow lines and the pointer, no screenshot (its
  chapter has them). Sections 4 to 9 keep their numbers and read the main level only. Analyst
  content by `step_id` resolves at every level. New input `--pdd-map-images <manifest.json>`:
  `{"maps": [{"path": [<node>, ...], "png": "<file>"}]}`; `--pdd-map-image` stays for the main
  map, and a manifest entry with path `[]` wins over it. The viewer renders one PNG per numbered
  map for the PDD (the chosen As-Is copy's plane when it has one, else the step BPMN's plane;
  `saveSVG` serializes the active root) and passes the manifest.
- **Exports.** *Process map (image)* saves the map the Map level shows (the main map unless another
  is chosen); *Process map (BPMN)* saves the one file with every plane. Exports analyze first when
  annotations.json is newer than `process_map_step.bpmn`, as *Edit as the As-Is map* does.
- **Out.** Lanes; one sub-process reused across projects; a separate image file per map;
  differences, data and times below the main level in the PDD; sub-steps in saved processes (C5
  stays flat); merge, split and adding a moment on a sub-process; the draft-fix counter below the
  main level; sub-steps drafted from events outside the step's evidence.

- **Amended by lane MV (2026-09-24)**, for C15, C18 and C19: the Map opens on the map the PDD
  prints, the chosen As-Is copy else `process_map_step.bpmn`, drawn by bpmn-js and linked like
  the As-Is view (`viewer/map-view.js` decides). The live map is the second view (*Show how the
  transactions ran*). At a level the copy has no plane for, the step map's plane shows with one
  line saying so. A stale step map is analyzed once when the Map needs it. *Edit* keeps a copy
  only from its first change.
