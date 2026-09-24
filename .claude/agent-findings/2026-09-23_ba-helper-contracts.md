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
  the Remembered names dialog's Rename renames the store and the session's drafts
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
  `when` (for example "Order rejected" from "the order is rejected": the analyst's words, trimmed,
  not rewritten). The analyst's notes on a step (`analyst_notes` with that `step_id`) become one
  `textAnnotation` per step, joined by an `association` to its task. Attachments on a step become
  a `dataObjectReference` named by the attachment's label, joined by a data association to its
  task. Each task gets a fill and stroke per system through the bpmn-js colour attributes
  (`bioc:fill`, `bioc:stroke`; ignored by other tools), from a fixed palette in system order,
  with one legend `textAnnotation` listing the systems. Steps added by hand are
  `bpmn:manualTask`, recorded steps `bpmn:userTask`. Task names stay the step names. Diagram
  interchange covers every new element and the layout keeps them clear of boxes and lines.
- **Illustrated map**: rendered by the viewer from the same data (the flow edges of C17, each
  step's name, system, the screenshot the PDD prints, its description or first note), one PNG.
  Export ▾ "Illustrated map (image)" saves it and opens Explorer; the PDD export passes it with
  `--pdd-illustrated-image <png>`, printed as the last appendix ("Appendix: illustrated map"),
  on its own landscape page, scaled to fit.
