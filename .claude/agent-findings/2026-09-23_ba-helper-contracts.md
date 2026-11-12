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
  `viewer/canonical-author.js` are therefore not needed and are cut. (Lane CL
  removed the saved-process store from the app on 2026-09-24: see C5.)

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
- Amended by lane FX1 (2026-09-25): the default pattern run is the first run by start that
  has at least one visible step, on both sides (a run whose every step is hidden is passed
  over; `viewer/runs-model.js` defaultPatternRun and `pdd_export._Session._pick_pattern`,
  pinned by the `reference_cases` of `shared/run-differences-golden.json`). The Steps level
  and the PDD's 4.1 compare the runs by one rule, pinned by the same golden: a pattern step
  a run lacks that carries `only_when` (C17) reads "Not done: <name> (only when
  <condition>)." and is no difference; a step a run does more often than the pattern run,
  at least twice, reads "Repeated: <name>, <n> times." and is one; the pattern run is
  compared with nothing. Steps that start at one moment keep their list order on both
  sides (the viewer no longer breaks the tie by step_id).
- Amended by lane CC (2026-09-25): a stretch of a run left out of the analysis
  (`annotations.excluded_ranges`, each range cut to the run's span) drafts no step, so
  the differences say it once, first ("Part of this transaction was left out of the
  analysis (1:10 to 1:45).", the times since the recording started), and the pattern
  steps inside the stretch (after the pattern position of the nearest run step before
  it that the pattern has, before that of the nearest one after it) are not Skipped.
  One rule on both sides, pinned by the golden's cases with `excluded_ranges`
  (`viewer/run-differences.js` `leftOutStretches`, `pdd_export.py` `left_out`). The left-out
  line is no difference.

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
  renamed the store and the session's drafts
  but not its edited or confirmed steps of that key, so the next analysis gave
  those drafts the session's name back. Settled by lane V2: the dialog's Rename
  renames the store, every draft of the key and every other step of the key that
  carries the old name, at every level (`runs-model.js` `renameSavedName`), and Forget
  gives those steps their drafted name back (`forgetSavedName`), so the session's own
  names never bring the old one back.
- **Amended by lane FX2 (2026-09-25).** An undo or a redo of a rename or a forget puts
  the store's entry for the key back as it was before or after (the undo entry keeps
  both; `viewer:restoreStepName`, `names-store.js` `restoreName`). A drafted sub-step
  (C19) takes its name, in this order, from the project's own sub-steps with its
  `action_key` (typed names before accepted ones, the reference transaction's first,
  then time order; hidden ones name nothing: `sub-process-verbs.js`
  `projectActionNames`, F1's rule), then from the store under `"action|" + action_key`,
  then its drafted name, so Open as a sub-process drafts the same names on another
  computer.
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
"document": { "title": "", "request": "", "purpose": "", "scope": "", "trigger": "",
              "result": "", "contacts": "", "business_rules": "", "exceptions": "",
              "effort": "", "improvement": "", "notes": "" }
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

2.0.1 (2026-09-26, the PDD for its readers: the SME who confirms it and
whoever asks) added `effort`, printed as 6 Volume and effort: how often the
process is done and how long one takes, as the analyst states it. The
document prints no recorded time (the recording is a walkthrough with
explanations). A gap is now printed for nine fields.

Amended by 2.0.1 (2026-09-27): the request moved from the capture app to the
viewer. An optional `request` (label "Request", one line, the question
"Which request is this for? Its name and code") prints in the PDD's Document
control Request row; while it is empty the row prints the capture's request
from the manifest as before (AD-30), so it leaves no gap. Like `notes` it is
not counted in the Overview's "N of 10 written". The Overview's project line
and its tooltip show it (`session-summary.js` `documentRequest`), else the
capture's (`requestOf`). A transcript sentence is never added to it.

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
  stays. Amended by lane CC (2026-09-25): Remove transcript takes `transcript.json`
  and every file in `transcript/` out of the folder, parked under
  `<userData>/pdt-removed/` (`viewer:removeTranscript`), and its Undo puts them back
  (`viewer:restoreTranscript`; a file of the same name attached since is kept).
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
Amended by lane FX1 (2026-09-25, report 3 F1): the run that holds the step's start, even
when the step runs on past that run's end (a Start marked later inside it); a step whose
start no run holds gets `case_id: null`. The viewer's runForRange (a step it creates) uses
the same rule.

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
| 3 | A requested export (for example `--pdd-out`) failed; the export was not written. Amended by lane FX1: nothing in the project was changed either |

Errors go to stderr as one line starting with `[normalize] ERROR:`. The viewer
treats any non-zero exit as a failure and never opens a stale export file.

Amended by lane FX1 (2026-09-25, report 3 F4): a run changes the project only when it
succeeds. Every output (`annotations.json`, `stats.json`, `analysis.json`,
`process_map_step.bpmn`) is staged as `<name>.pdt-staged` and moved into place together as
the run's very last act (`session_io.Staging`); a run that fails removes what it staged,
and a run the viewer's Cancel kills moves nothing (the viewer's `staged-outputs.js` and the
next run remove what it staged). So Cancel leaves the steps and the map as they were.

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
- Amended by 2.0.1 (2026-09-27): a site rule (`"site": true` with a `drop` list of the
  browsers' own names), after the web systems' title rules and before the browsers' own
  names, names a browser window on a site no rule names by the site its title ends with:
  the title split at a spaced hyphen, a pipe, an en or em dash or "::", a last segment
  naming the browser dropped (compared without zero-width spaces), an ending "and N more
  pages" cut, then the last segment ("Order Desk"). It names nothing when fewer than two
  segments are left (a lone "New Tab" stays Google Chrome) or when the shared value rules
  would change the segment (a value, not a name), and the next rule applies. Both sides
  implement it (`app_names.site_name`, `viewer/system-names.js` `siteName`); the step's
  screen then leaves the site out ("Customer lookup"). The file's `program_names` maps the
  name Windows gives a program, which the capture app records for the window in front
  ("Google Chrome", "Microsoft Excel"; the recorder writes "chrome.exe"), to the application
  a rule knows ("chrome", "excel"), in both `app_key` and `appKey`: the live walk found the
  Timeline's bands and legend reading "Google Chrome" and "Microsoft Excel" while the steps
  read "Order Desk" and "Excel".

## C15. The PDD's inputs and the step map file (lane LUX-P)

- `--pdd-map-image <png>`: the picture of the As-Is map. The viewer passes the
  edited As-Is copy when one is chosen (`RefmapUI.renderPddMaps`), else today the
  live map's cytoscape PNG, and only when the Map level was drawn in this viewer
  session (`dfg-viewer.exportPng` returns null otherwise); that PNG is one long
  row (2734 x 238 px on the demo, labels at about 5 pt on a landscape page).
  **Viewer half (V1):** when no As-Is copy is chosen, pass a bpmn-js render of
  `process_map_step.bpmn` (the same `renderEntryToPng` path the copy uses, read
  from the session folder), so the map from the runs prints like the copy.
  Settled by V1: the cytoscape PNG is no longer passed (`dfg-viewer.exportPng` was
  removed as unused by lane FX1). Amended by lane FX2 (2026-09-25): the pictures the
  viewer draws for the PDD leave the steps' notes out (`refmap-ui.js` drops each
  step's note annotation and its line from the drawing; the file is not touched),
  since notes stay in the app; the Map, Export's map image and the BPMN file keep
  them.
  The pipeline cannot draw the image itself (no renderer in the bundled Python).
  Without an image the PDD still fills 3.1: the map from the runs as a table (each
  step and the steps that followed it, with the number of runs), plus a line naming
  `process_map_step.bpmn` when the folder has it.
- A map image gets a page of its own, landscape when it is wider than tall, as
  large as the page allows; the picture's alternative text is "As-Is process map"
  or "To-Be process map" (the e2e smokes read it).
- The PDD prints no analysis finding (its former section 1 is cut). analysis.json
  keeps `pdd_findings` and annotations keep `memo_selection` exactly as before
  (C10) until the viewer lane removes the "include in PDD" boxes. Amended by lane FX1
  (2026-09-25): the boxes went with lane V1, so `pdd_findings` is cut, with the facts,
  the findings and the step-based estimates nothing read; `memo_selection` still
  round-trips (C10). `analysis.json` `format` is 4, and the one check the Overview shows,
  the apps the recorder saw with less detail, is its own key, `coverage_caveat`.
- Amended by lane CC (2026-09-25): `analysis.json` carries the rows the PDD prints in
  its sections 5 and 6, `pdd_data` and `pdd_time`, computed by the functions the PDD
  prints them with (`pdd_export.pdd_rows`: `data_section`, `time_section`), and the
  Overview shows them as they are (one source; `shared/pdd-rows-golden.json`). With
  them, `steps_signature` (`normalization/steps_signature.py`), the signature of the
  steps they were measured from; the viewer takes the same one
  (`viewer/rows-freshness.js`, both pinned by `shared/steps-signature-golden.json`) and
  analyzes again as the Overview opens when the two differ. A failure writes the key
  `null` with one `stage_errors` entry (`pdd_rows`, `steps_signature`). `format` became
  3 then (4 since lane FX1). Lane N-P (AD-29) made the step map's words
  "transactions": a task's documentation reads "In N of M transactions", a branch
  "N of M transactions".
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
  containment (C9), and a step without a time then belongs to no run. Amended by lane
  FX1 (2026-09-25, report 3 F1): a timed step moves to the run that holds its start (C9 as
  amended), and a step without a time joins the first run (by start, then case id), in a
  session without a recording; none falls outside the transactions, where no act brings a
  step without a time back.
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
  counts the runs, coverage null. (Lane FX1 cut those keys; `coverage_caveat` is null
  there.) The PDD says "One transaction (not marked)" for the implicit run
  (Document control's "Transactions recorded" and sections 3.2, 4.1 and 6.1, the
  viewer's words; lane FX3), "Recorded: Nothing recorded" for a blank session, and
  points at the video time in a video session.
- **Removal.** Removing a screenshot, note or attachment the analyst added deletes its
  entry and its copied file; recorder screenshots are only hidden. Settled by V3-V: a
  removed file waits in `<userData>/pdt-removed/` for its Undo, which brings it back
  (the folder is emptied when the viewer starts). Amended by lane CC (2026-09-25): Remove
  video and Replace take the video's copy in `video/` out the same way, and an edited
  map's file in `derived_maps/` leaves with its row; an Undo that names a file again
  brings it back. Amended by lane FX2 (2026-09-25): a screenshot, an attachment or a
  video is refused before anything is copied into the folder while the project's
  analysis runs (the entry's save would be refused, leaving an unlisted file); a Split,
  a Merge or + Step of steps the analyst added gives steps the analyst added
  (`manually_authored`, `analyst-content.js` `derivedState`); the implicit run reads
  "One transaction (not marked)" everywhere in the viewer (`AC.IMPLICIT_TRANSACTION`).
- **The video's start.** Settled by V3-V: a video project's `started_at` is the video
  file's creation time, else its modified time (`new-project.js` `startedAtOf`); the
  analyst is not asked (the "moment the analyst says" above was not built: nothing
  shows a video project's time of day).

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
  Amended by lane FX1 (2026-09-25, report 2 item 3): a stretch of a transaction left out of
  the analysis (`excluded_ranges` cut to its span) cuts its trace: no edge joins the step
  before it to the step after it, no start edge runs into the first step after a stretch
  that opens the transaction, and no end edge leaves the last step before one that closes
  it; a step next to a cut has no previous step (or none after it) there. A stretch falls
  among the steps as the differences place it (before a step that starts after it starts;
  a step without a time is after it). The golden's cases with `excluded_ranges` pin it;
  the step BPMN is drawn from the cut edges when the cuts change the map.
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
- Amended by lane FX3 (2026-09-25): a task a visible step of which is flagged as waste
  (`flags.waste`) gets a text annotation "Waste" above it (`TextAnnotation_waste_<k>`,
  documented "Flagged as waste: this step should not be needed.", joined by
  `Association_waste_<k>`), in its notes' place or right of its notes, and the legend
  ends with "Waste: a step that should not be needed" when its plane has one. The PDD's
  pictures keep it. Lane FX2 marks the same steps on the live map: a dashed border and
  a last line "Waste".
- Amended by 2.0.1 (2026-09-27): the system a task is done in is said in words, not in
  a colour (no BPMN editor could change a colour, so an edited map kept the wrong ones).
  `process_map_step.bpmn` has no `bioc:fill` or `bioc:stroke` and no legend
  (`TextAnnotation_legend` and its lines "Colour by system", "Hand icon: done outside the
  systems" and "Waste: a step that should not be needed" are gone), and
  `write_observed_bpmn` no longer takes the library's application order (C21's colour
  order is void). Each task done in a system gets a short text annotation above it naming
  the system (`TextAnnotation_system_<k>`, joined by `Association_system_<k>`; with the
  `Sub<n>_` prefix in a sub-process's plane). When every task of a plane that is done in a
  system is done in the same one, the plane says it once instead: one text annotation
  "System: <name>" joined to nothing (`TextAnnotation_system`, placed where the legend
  was), and no task gets a label. A manual task keeps the hand marker and gets no label.
  The notes moved under the task (`TextAnnotation_<n>`, the association falling from the
  task's bottom); the files sit under it, right of its note when it has one; the Waste
  mark sits right of the system label. A collapsed sub-process is 16 px taller than a
  task, so its name keeps clear of the + marker. A flow that turns up or down leaves or
  enters a gateway at its top or bottom corner, one flow a corner (they ran together out of
  its right corner, so a skip hid under the main line); the map keeps its merge gateways
  (the owner's house style). In the viewer a system label is part of the
  picture: a click does nothing (`asis-links.js` `isSystemLabel`), the PDD's pictures
  keep it (only the steps' notes are left out), and `reference-maps.js`
  `predatesRichMap` counts it as a mark of a copy made after C18.
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
  `saveSVG` serializes the active root) and passes the manifest. Amended by lane FX1
  (2026-09-25, report 2 item 9, report 3 F10): a step's heading reads "Step 2: <name>" and a
  sub-step's "Step 3.2: <name>", and a pointer reads "Sub-process: see section 3.<k>.", so a
  step's number never reads as a section's (flow lines already say "step 3.2").
- **Exports.** *Process map (image)* saves the map the Map level shows (the main map unless another
  is chosen); *Process map (BPMN)* saves the one file with every plane. Exports analyze first when
  annotations.json is newer than `process_map_step.bpmn`, as *Edit as the As-Is map* does.
- **Out.** Lanes; one sub-process reused across projects; a separate image file per map;
  differences, data and times below the main level in the PDD; sub-steps in saved processes (C5
  stays flat); merge, split and adding a moment on a sub-process; the draft-fix counter below the
  main level; sub-steps drafted from events outside the step's evidence.
- **Settled by lanes SUB-P, SUB-V1 and SUB-V2 (2026-09-24).** Nodes are ordered by their first
  visit at a level, with or without `sub_steps` (golden case 13); a chapter prints the reference
  transaction's first non-empty trace; every printed step whose node has a chapter carries the
  pointer; a sub-step's context line counts over the transactions that ran the sub-process; an
  unreadable `--pdd-map-images` manifest warns and falls back to tables. A drafted sub-step's name
  is the imperative of the Interactions phrase ("Click Save order", "Enter Product code"); Group
  groups every maximal stretch of the ticked kinds, single steps included; the main level keeps
  its confirmed rule and the levels below read confirmed only without drafts; Dissolve asks only
  when an analyst description or flow would go; steps that start within one second keep their
  list order below the main level. On the Map, *Open sub-process* opens its map, choosing a map
  lets go of a Steps selection at another level, maps without a number show in the picker
  without one, and the BPMN export analyzes first when the step map is older than the steps.
  Later lanes changed two of these: the Timeline draws a zero-length step (lane FX2), and an
  exported sub-process picture is named after the project, "<project> map of sub-process
  <number>.svg" (lane FX3).
- **Amended by lane FX2 (2026-09-25).** Group remembers where each link it moves came from, so
  Dissolve gives it back: a link taken from a member onto the group carries `lifted_from` (the
  member's step id; every member's when two carried the same link, kept once), and a link from
  outside pointed at the group instead of a member carries `pointed_to` (that member's id). On
  Dissolve, a link with `pointed_to` goes back to that member and a link with `lifted_from` back
  to those members (else, as before, to the first or the last sub-step); both keys are then
  dropped, and so is `pointed_to` when the analyst sends the link elsewhere
  (`step-flow.js` `setLinkTarget`). Readers of the flow read `to` and `when` only (C17). Group
  into a sub-process says before it acts how many steps it groups and where the same steps are
  grouped too (`sub-process-verbs.js` `groupPromptText`). + Step at a moment a sub-process holds
  goes into it, at any depth: the sub-step that holds the moment is split there, else a new
  sub-step starts at it, so a sub-step gets a time as a main-level step does (`momentPlace`).
- **Amended by 2.0.1 (2026-09-27).** *Open as a sub-process* folds the cells of one sheet
  filled one after another (two or more actions on `DataItem` controls named by a cell
  address, on one screen) into one sub-step named by the columns: "Fill in columns A to F"
  ("Fill in column B" for one column), `action_key` `"<app>|<screen>|cells:A-F"`,
  description "Entered 20 cells, A2 to F5." (`sub-process-verbs.js` `cellOf`); a single
  cell stays "Enter B7". A spreadsheet is filled cell by cell, and a sub-step per cell made
  a chapter of twenty "Enter A2" headings. On a recorded step that would draft fewer than
  two sub-steps the verb is disabled in the step pane with its reason ("This step has one
  recorded action (a sheet's cells filled one after another count as one), so it has no
  steps of its own to open.") and left out of the step menu; a step added by hand still
  opens, with `[]`.

- **Amended by lane MV (2026-09-24)**, for C15, C18 and C19: the Map opens on the map the PDD
  prints, the chosen As-Is copy else `process_map_step.bpmn`, drawn by bpmn-js and linked like
  the As-Is view (`viewer/map-view.js` decides). The live map is the second view (*Show how the
  transactions ran*). At a level the copy has no plane for, the step map's plane shows with one
  line saying so. A stale step map is analyzed once when the Map needs it. *Edit* keeps a copy
  only from its first change.
- **Amended by lane FX2 (2026-09-25)**, for ADR-0019's edited copies: a new copy's
  `reference_maps` row keeps `forked_from_steps`, the signature of the maps the steps drew when
  it was made (`viewer/asis-freshness.js` `stepsMapSignature`: every map of `mapTree`, its boxes
  and its lines by the live map's rule, each box's notes, files, system, hand marker, sub-process
  and waste mark, and the first lines of the Trigger and the Result; a duplicate keeps its
  source's). A copy is stale when the steps draw another map (`copyStale`; a copy made before
  falls back to `forked_from_sig`, then `forked_from_hash`). While the chosen As-Is copy is
  stale, the Map's header line says so with *Copy again*, and the Overview's Checklist lists
  *Check the As-Is map* before the export. *Copy again* (the header, or a gallery row) makes a
  new copy of the process map as it is now, named and kinded like the stale one, kept at its
  first change like Edit's (leaving the editor without one keeps nothing), and then gives it the
  stale copy's PDD role; the stale copy stays.

## C20. Hand-off versions, the read-only open and the Technical details (lane HV)

The owner, 2026-09-25: "my concern is that dev gets a project, starts building from it, PM updates
the project, Dev doesn't know and voila, a discrepancy. Devs should not add anything at this
stage." And: "sync via one drive is possible, yes. But unreliable. DO NOT OVER COMPLICATE. We are
making a tool, not an enterprise app or a product." So a project is handed to the developers as
numbered versions, every copy says which version it is, and a developer opens a version read only.
No sync, no locks, no roles, no comparison. On the developers' Solution Design Document (written
outside the app): the recording already holds technical data a developer needs, so a generated
Technical details workbook goes with every version.

- **Data.** `annotations.handoffs` (viewer-written, oldest first): `[{ version, handed_off_at, by,
  note }]`. `version` a whole number from 1, the next one more than the highest; `handed_off_at`
  ISO 8601 UTC (its date, the first ten characters, is what every document prints); `by` the
  Windows user (`os.userInfo().username`); `note` what changed, one line, never empty (the first
  hand-off's dialog is filled with "First hand-off"). An entry without a whole version of 1 or more
  is ignored; of two entries with one version the later counts. The pipeline never writes the key
  and round-trips it.
- **Hand off...** (Export menu, `viewer/views/handoff-ui.js`). One dialog, "What changed in this
  version?" (OK waits for a note). The entry is added as one undoable edit ("Hand off version N
  (the zip file stays)"); Ctrl+Z takes it back and the zip stays where it is. Then the PDD and the
  Technical details are made for the version by the PDD export's own path (the analysis first when
  the step map is older than the steps, the map pictures drawn off screen, one run with
  `--pdd-out`, `--tech-out` and `--handoff N`), and the main process writes `<project> v<N>.zip`
  next to the project folder (`viewer:exportHandoffZip`, `viewer/handoff-zip.js`): the folder as
  the Whole project zip holds it (zip-folder.js, the capture app's copy, unchanged), then at the
  zip's root `<project> v<N> PDD.docx` and `<project> v<N> Technical details.xlsx`, appended to the
  zip it wrote, built as `.building` and renamed when complete. `<project>` is the name the
  Overview shows (`session-summary.js displayName`: the document title, else `manifest.label`,
  else the request, else the folder's name), without the characters Windows refuses, at most 60
  characters. A zip is never written over another (`" (2)"` and on). Explorer opens at the zip. A
  hand-off that does not finish (the run or the zip failed) takes its entry back at once
  (`session.js takeBackLastEdit`, or an edit of its own when another edit came after it), so no
  version is recorded without its zip. Refused while the project's analysis runs, beside another
  zip of the project, and in a hand-off opened read only.
- **Every document says its version** (`normalization/handoff_versions.py`). The PDD's Document
  control row "Version" (it read "Draft") and the Technical details' About sheet read "Version N,
  handed off <date> by <name>" when made for hand-off N (`--handoff N`, an entry the project
  holds), else "Working copy after version N" (the highest), else "Working copy, not handed off
  yet". Once the project was handed off, the PDD adds a "Version history" table under Document
  control: Version, Date, By, What changed, one row per entry, oldest first. The viewer's
  read-only line is the same words before " · Read only" (`viewer/handoff.js handedOffLine`).
- **The read-only open.** *Open a hand-off (.zip)...* takes a hand-off zip (the Open menu, and a
  button on the page shown while no project is open; a file dialog for zips, since Windows' folder
  dialog, the one Open project... shows, lists folders only; `viewer:loadSession` sees a `.zip`
  file). It is a hand-off when its root holds one project folder (a `manifest.json`) whose
  `annotations.json` lists at least one version, and beside it `<project> v<N> PDD.docx` and
  `<project> v<N> Technical details.xlsx`, N the version it lists last (the Whole project zip of a
  project handed off before holds neither: a working copy, never shown as a version); any other
  zip is refused with a sentence saying to unzip it first. Its content is extracted, as
  the zip holds it, into `<userData>/handoffs/<project> v<N>/` (`viewer/handoff-open.js`: streamed,
  every file's size and CRC checked; an entry outside the folder, an encrypted entry or another
  compression refused; written into a temporary folder renamed only when complete) with
  `.pdt-handoff.json` beside the project (`{ session_id, version, handed_off_at, zip, pdd, tech,
  opened_at }`). The same zip opens the same folder again; another hand-off of the same version
  gets `<project> v<N> (2)/`; a newer version is a folder of its own and just opens (nothing
  compares). Every folder under `<userData>/handoffs` opens read only, and so does a hand-off
  unzipped by hand (Windows' Extract All, then Open project on the folder it makes: a project
  folder beside which lie `<project> v<N> PDD.docx` and `<project> v<N> Technical details.xlsx`
  for the version its `annotations.json` lists last) (`isReadOnlyProject`, `session.readOnly`):
  - everything can be looked at and played: every level, the step panel, the video, the
    transcript, the maps as they came (no analysis: the Map draws the step map it came with), and
    the PDD and the Technical details it came with (Export, *PDD of this version*, *Technical
    details of this version*, opened in their programs);
  - nothing can change: the page carries `.app.read-only` and `styles.css`, beside the
    unreadable-annotations page's rules (lane FX2), hides every editing control on every level; the
    step pane's and the document's fields are read only; the shortcuts that edit, the double-click
    rename and the editing items of the right-click menus do nothing; opening a transaction records
    nothing; no analysis starts; `session.js` refuses every annotations write (so no Undo entry is
    recorded) and the main process refuses every write into the folder (`_refuseReadOnly` in each
    handler that writes a project folder or runs the analysis; a unit test reads `main.js` and
    fails on a writer without it);
  - the Overview's project line opens with "Version N, handed off <date> by <name> · Read only"
    (`#ov-handoff`, what changed in its tooltip), the Checklist is not drawn, the top bar's save
    state reads *Read only*, and the Recent list names the entry "<name> · version N, read only".
- **The Technical details** (`normalization/tech_details.py`, `--tech-out <file.xlsx>`, its own
  Export item *Technical details (.xlsx)*, and in every hand-off zip). Written with the standard
  library (`xlsx_writer.py`: zipfile, inline strings and numbers, a bold header row on a light grey
  fill through a two-format `styles.xml`, the header frozen, fixed column widths; the bundled
  Python has no spreadsheet library and none is added). It reads what the PDD reads, through
  `pdd_export`'s session, so its numbers, fields and re-keying are the PDD's. Sheets, in order:
  - *About*: the project, the version line, the reference transaction, one line on each sheet and
    on the recorder's words (identity source, confidence, coverage);
  - *Steps and controls*: one row per recorded interaction of the reference transaction (the steps
    3.2 prints; a hidden step, and a hidden sub-step's interactions, left out), in step order:
    Step (the PDD's number: "Step 3", and "Step 3.2" for a sub-step of the chapter's first visit),
    Step name, Action (Click, Type, Select, Toggle, Focus), Value (a password field "(not recorded:
    secret field)"), Control type, Automation id, Name, Class name, Identity source, Confidence (a
    number), Window title, Program (`process_name`), System (the step's own system first, else
    `shared/system-names.json`);
  - *Data fields*: one row per field typed or chosen in a step (the PDD's data table's key: the
    field and the step's alignment key), Field, Automation id, Control type, System and screen,
    Step, then one column per transaction (the PDD's names for them) with what was entered there
    (several values joined with "; "), and "Outside the transactions" when such a step entered a
    field ("Value" alone without marked transactions);
  - *Re-keyed values*: `pdd_export.rekey_pairs`, the PDD's own rule (5, Re-keyed data): Source
    system, Source field, Target system, Target field, Values (the values so typed again), and
    Transactions ("2 of 3");
  - *Applications*: one row per program and system the recorded interactions ran in: Program,
    System, Coverage (the recorder's `coverage_hint`: rich, basic, minimal, else "Not recorded"),
    Remote or terminal (`capture_detail`'s rule: an interaction through a remote or terminal
    framework; "Not recorded" when the recording has no framework), Steps (the process's distinct
    steps with an interaction there).
- **CLI.** `normalize.py --tech-out <file.xlsx>` writes the workbook; `--handoff <N>` makes the PDD
  and the workbook for version N (a value below 1 is a usage error, exit 1). A failed workbook is
  a failed export (exit 3): the run commits nothing. The viewer passes `--tech-out` for Export,
  Technical details (.xlsx) and a hand-off, and `--handoff` only for a hand-off.
- **Tests.** `test_handoff_versions.py` (the line in its three states, the PDD's row and table),
  `test_tech_details.py` (the parts parse with ElementTree, each sheet's header and rows on a
  fixture and on the demo through the pipeline, the CLI's refusals), `viewer/handoff.test.js`,
  `viewer/handoff-zip.test.js` (the zip read back independently, the open and its refusals),
  `viewer/read-only.test.js` (no write path: the renderer, every main-process writer, the save
  state, the take-back), and `e2e/handoff-smoke.js`.
- **Out.** Sync (OneDrive or otherwise), locks, roles, a comparison of versions, a developer's
  notes or edits, removing the folders under `handoffs/` from the app, signing a zip.

## C21. The activity library (owner 2026-09-25; lanes LIB-P and LIB-V)

Keep it simple: a tool, not a product.

- **The app's library:** one file, `library/activities.json` (repo root; in the packaged viewer
  `resources/library/activities.json`). Swapping the library means replacing that file. Format:
  `{ "format": 1, "version": "<text>", "applications": [ { "name": <system name as
  system-names.json gives it>, "activities": [ { "id", "name", "code"?, "description"?,
  "screens": [ [<draft_key>, ...], ... ] } ] } ] }`. The application order was the colour
  order until 2.0.1 (2026-09-27) took the colours off the map; nothing reads it since.
  An activity's `screens` lists one or more runs of screens (one draft_key each, in order); a
  name-only activity (added by hand steps) has no screens. The shipped file: the known systems
  as applications, no activities.
- **A project keeps the library it started with:** the first analysis copies the app's library
  into the project folder as `library.json`; from then on the pipeline and the viewer use the
  project's copy only. A newer app library never changes an existing project. `analysis.json`
  records `library_version`.
- **Drafting:** after the C1 drafts are made (and drafts overlapping the analyst's steps are
  dropped), a run of consecutive drafts whose draft_keys equal an activity's screens (repeats of
  one screen count once, the longest run wins) becomes one draft named from the activity:
  `name_source: "library"`, `library_activity: <id>`, `draft_keys` the run. Drafts that match
  nothing are unchanged. An empty library changes nothing (the session golden proves it).
- **Remembered step names (C4) are removed:** the store, its dialog and `--names`. A rename still
  names the project's other drafts of that key (the session's own names).
- **The picker:** the step pane's name offers the project library's activities of the step's
  application (pick the application first for a step added by hand); picking sets the name, the
  system, `library_activity`, and uses the activity's description when the step has none. Typing
  any name stays possible.
- **Where it shows:** the map (same names; until 2.0.1 one colour per application in library
  order, since then each task's system in words, C18), the PDD
  (the code on the step's context line, the activity's description when the PM wrote none), the
  Technical details (activity and code columns).
- **The Library builder** (Help, *Build the library...*; the owner's tool): reads project folders
  and hand-off zips (annotations and manifest only), lists the named steps by application with
  their screens, how often and in which projects; the same screens named differently show side by
  side; the owner ticks, fixes names, codes and descriptions, and saves a library file (a new
  version). A name that already exists in the application adds its screens to that activity.

## C22. A step's place in the process (owner 2026-11-04; 2.0.5)

The owner: "What if the user listens to video, and at the second half of the video a step was
corrected or a condition added to something that was shown in the first half? If you annotate on
the timeline, the step will appear AFTER all the steps in between. There needs to be a way to
decouple steps, but have them remain on the position on the timeline."

- **Data:** `step.placed_after`, optional, viewer-written: the `step_id` of the step it comes after
  in its transaction's process, or `"start"`. Its `time_range` stays where it was shown (band,
  video, length, pointer). Re-normalization keeps it on every preserved step, and a draft that
  carries it is kept as `edited`.
- **The order** of one list of steps (`viewer/step-order.js` processOrder, `step_context`
  process_order; pinned by `shared/step-order-golden.json`): C16's base order (time, `order`,
  list order); a placement holds when it names `"start"` or a visible step of the same list and
  transaction, not itself, without a loop; the steps placed first, then each other step in the
  base order, each followed by the steps placed after it (base order, depth first). A hidden step
  is never one a step comes after, so the order reads the same with or without the hidden steps.
  Every reader takes it: Steps, the live map (process-map-levels), the sub-process maps, the
  differences, the step BPMN (step_flow), the PDD, the statistics' step_variants, the Technical
  details. `shared/flow-links-golden.json` has two cases with a placed step.
- **Stretches left out** (lane FX1): a placed step counts where the step its place hangs from does
  (placeMoments, place_starts; the steps placed first before every stretch).
- **Transaction:** a placed step belongs to the transaction of the step it comes after; the viewer
  keeps it, and `step_suggest._follow_placement_case` holds it after the C9 restamp.
- **The verbs** (viewer): Move up and Move down (Alt+Up, Alt+Down; the step menu) on every step,
  two steps without a time still swapping their `order`; *Place after a step...* (the step menu in
  Steps and on the Timeline, the Flow line; a list of every transaction's steps, *First in
  Transaction N*), which may move the step into another transaction; *Back to its time*, the
  inverse, to where its time puts it in the transaction its start is in. Each is one undoable edit;
  the edits write the fewest placements (deriveOrder) and keep each anchor's one follower; a step
  hidden, deleted, merged or grouped hands its followers over (keepOrder); + Add step after a step
  with a time is placed right after it. Merge and Group refuse a placed step apart on the timeline.
- **Marks:** *Placed* on the row and in the Flow line (with *Back to its time*), the band's accent
  edge and dotted foot on the Timeline with its tooltip line, the legend's *placed elsewhere in the
  process*. Only a step with a time carries them.

## C23. Videos chained on one timeline (owner 2026-11-04; 2.0.6)

The owner: "can editor support multiple videos chaining together on a timeline, for whatever
reason?" Then: "Placement same as any video editing software. Back to back. [...] Step line in
PDD, we don't tie anything to video time, but to the timeline line. Timeline is the core. 10th
minute on the timeline is 10th minute on the timeline, regardless if there are 1 or 7 videos on
the timeline." Agreed with the consequence that trimming or removing an earlier video moves the
later videos and their marks.

- **Data:** `annotations.external_videos`, a list of clips `{ id, path, offset_ms, in_ms, out_ms,
  length_ms, attached_at }` (SCHEMA): `offset_ms` places the file's 0 on the clock, `in_ms` and
  `out_ms` trim it, `length_ms` is its measured length. A project of 2.0.5 has one
  `external_video`, read as a chain of one (`viewer/video-chain.js` clipsOf,
  `step_context.video_clips`, the same order); the viewer's first edit of the chain writes the
  list and drops the old key.
- **The clock** is the project's, whatever video shows it: every time the viewer gives or takes
  (the playhead, a step at the playhead, a marker moved to it, a frame's moment) is a moment on
  the clock. The player shows one clip at a time: a seek picks the clip that shows the moment,
  playing on past a clip's end goes on with the next one when it starts there, a trimmed part is
  never shown. The playback bar and the arrow keys move on the chain.
- **Back to back** (a project made from videos, no recording): a video added goes after the last;
  a trim, a replace or a remove that changes a clip's length moves the clips after it and
  everything marked on them (steps at every level, start and end each; inserted markers, their
  change waiting like a marker moved by hand and applied by itself; notes and screenshots at a
  moment; stretches left out). A trim or a replace that would cut away a mark is refused, naming
  it; a step that only runs into the part cut away ends where it starts. Remove takes what was
  marked on the clip, after a question naming it. **In a recording** each clip is placed by its
  sync (two clicks) and an edit of one moves nothing else.
- **Transcripts:** one per video, `transcript.json`, `transcript-2.json` and on, each with
  `video_id` and its offset counted from its video's 0 (rule 0 of SCHEMA's time rule), so it moves
  with its video. Before the chain moves, a transcript placed without a video is tied to the video
  showing its first sentence with an offset that keeps it in place (outside the undo: nothing
  moves). Attach asks which video when there are two or more.
- **The PDD** reads the clock only: "Transaction 1 at 0:19", "0:19 into the recording", and in a
  project made from videos "at 1:00" in the implicit run; never a time in a video file. Document
  control's Video row says "2 videos" when there are several.
- **The verbs** (viewer): Add video (the Overview's project line, the Videos lane, the no-video
  band; several files at once, in the order picked), Sync video (recordings), Replace video (keeps
  the clip's place and trim; *Find the video...* for a clip whose file is not found keeps its sync),
  Trim (a side of a clip dragged on the Videos lane, or *Trim the start here*, *Trim the end here*,
  *Give its start back*, *Give its end back* on its right-click), Remove video. Each is one undoable
  edit; an undo of the chain reloads the project, and analyzes it again when the transactions
  moved with the videos (`session.js` revertFollowUp).
- **Marks:** the Videos lane (one band per clip named after its file; a trimmed side drawn thicker,
  a clip whose file is not found hatched), its row in the Lanes menu, its name at the left.

## C24. What the SME gives at the end (owner 2026-11-12: "just build"; lane C)

The design: the canvas https://claude.ai/artifact/2ZPLq57Raj4GgRGkf7rxkh (plan section 5.2, C1, C2, B5;
C4, a note typed from the recording bar, is cut: typing during a recording interrupts the work being
recorded, and question 4 asks the why at the end).

- **Written by the capture app** (`capture/`), on the recording's `manifest.json`, by the end summary,
  as the recording's name is (`pdt:setSessionLabel`): saved on leaving a field, before the zip and on
  Done, so the zip carries them.
  - `sme_answers` *(object, optional)*: `{ "trigger": string, "result": string, "effort": string,
    "exceptions": string }`. Each value is the SME's one line, trimmed; a key whose answer is empty is
    left out; the object is left out when all four are empty. The questions, in the end summary, in
    this order: *What starts this work?* (`trigger`), *What do you have when it is done?* (`result`),
    *How often do you do it, and how long does one take?* (`effort`), *What goes differently
    sometimes, and what do you do then?* (`exceptions`). Each at most 300 characters.
  - `sme_files` *(array, optional)*: `[{ "file": "Order 10900.msg", "label": "Order 10900.msg",
    "added_at": "ISO 8601" }]`. *Add an example file...* copies each picked file into the
    recording's `attachments/` folder (the folder analyst attachments use, C16), a numeric suffix
    when the name exists (" (2)" before the extension); `file` is the name in that folder, `label`
    the picked file's own name. *Remove* deletes the copy and the entry. At most 20 files, each at
    most 50 MB; a bigger file is refused with its reason on the window.
- **Read by the viewer** (`viewer/`):
  - The Overview shows, under the document field of each key, while the field's text is not the
    answer and the key is not dismissed: "The SME wrote: <answer>" with *Use* (writes the answer
    into the field, the field's own undoable save) and *Dismiss* (adds the key to
    `annotations.sme_answers_dismissed`, an array of keys, one undoable edit). The Overview's
    summary line says "The SME answered N questions: each waits under its field." while one waits.
  - `sme_files` become attachments of the whole project: when an editable project opens and an
    entry's `file` is in `attachments/` and in no `annotations.attachments` entry, it is added as
    `{ id, file, label, step_id: null, added_at, from: "sme" }` in one save (not on the undo
    stack: it is what the recording brought). The Files tab and the Overview's attachments say
    "From the SME" on them. From then on they are attachments like any other (the PDD lists them,
    they travel in its zip and in a hand-off).
- **Read by the pipeline** (`normalization/pdd_export.py`, B5): Document control's *Recorded by*
  reads the capture profile's `worker.name`, then `worker.role`, then `worker.bu`, joined by ", "
  (each only when set): "Maria Keller, sales assistant, Operations"; without a name, the `worker.id`
  as today. The pipeline does not read `sme_answers` or `sme_files`.
- Round trip: the viewer never writes `manifest.json`'s `sme_answers` or `sme_files`.
- **As built (2026-11-12):** *Use* also adds the key to `sme_answers_dismissed`, in the same
  undoable edit as the field, so an answer used and then edited does not come back; the viewer
  keeps `annotations.sme_files_adopted` (the file names it added), so a file the analyst removes
  is not added again. Both keys are in `shared/SCHEMA.md`.

## C25. Who does a step, and what the automation takes (owner 2026-11-12: "just build"; plan D7, D8)

The team's notation (plan section 8, fact 5): a box is a step; an icon in its corner says manual or
automated work; a label on top names the application; a label at the bottom names the role or the
employee. No lanes. The map already puts the application above the box (C18); this contract gives
the corner icon its meaning and adds the label under the box.

- **`step.automation`** *(string, optional; viewer-written)*: one of `"undecided"` (also: the key
  absent), `"automated"` (the automation does it), `"person"` (it stays with a person),
  `"not_needed"` (no longer needed: today's Waste). It takes the place of the step editor's Waste
  tick: one choice, *Automation* in the step editor, with the four options read as
  "Not decided yet", "The automation does it", "Stays with a person", "No longer needed".
  - `flags.waste` stays in step with it, so every reader of waste keeps working: setting
    `"not_needed"` sets `flags.waste: true`; any other value sets it `false`. A step with
    `flags.waste: true` and no `automation` (an older project, or a vocab's default) reads as
    `"not_needed"`.
  - A draft that gets a choice becomes `edited` (as the flow does, C17).
  - Sub-steps carry it the same way.
- **`step.done_by`** *(string, optional; viewer-written)*: a role or an employee, one line, at most
  80 characters. Without one, the step is done by the recording's role: `manifest.config.worker.role`
  (else nobody is named). *Done by* in the step editor, a text field with the default as its
  placeholder ("Sales assistant (from the recording)"); a typed value wins; emptied, the default
  comes back.
- **The step map** (`process_map_step.bpmn`, `normalization` C18): a task's kind follows its
  automation: `"automated"` a `bpmn:serviceTask` (the gear), `"person"` a `bpmn:manualTask` (the
  hand), `"undecided"` and `"not_needed"` a plain `bpmn:task`. The old rule (a step outside every
  system is a manual task) goes: the hand now means only "stays with a person". Under each task a
  short text annotation names who does it (`TextAnnotation_doneby_<k>`), unless every task of the map
  is done by the same one: the map then says it once ("Done by: Sales assistant",
  `TextAnnotation_doneby`, joined to nothing), as the system label does. A step's notes stay under
  its task, below the Done by label.
- **The live map** (how the transactions ran, `process-map-levels.js`): no change.
- **The PDD** (`pdd_export.py`): a step's context line gains who does it ("SAP, Order entry · done
  by Sales assistant · in 3 of 4 transactions · Transaction 1 at 0:19"); section 7, Improvement and
  automation scope, lists the steps by choice under four headings ("The automation does it", "Stays
  with a person", "No longer needed", "Not decided yet"), each heading only when it holds a step;
  the waste mark the PDD prints today reads from `"not_needed"`.
- **The Technical details** (`tech_details.py`): a column *Automation* and a column *Done by* on the
  reference transaction's steps sheet.
- The viewer's Steps rows and the Timeline's pane rows show nothing new; the choice and Done by are
  in the step editor (Steps and the step opened in the Timeline's pane), the readiness list
  (`readiness.js`) counts no new miss.

## C26. The information a step uses (owner 2026-11-12: "just build"; plan D6)

Why: a project made from a video or from nothing has no recorded fields, so the developers get no
data list from it. The analyst now writes, per step, what the step uses or enters; a recorded step
shows its recorded fields in the same list.

- **`step.information`** *(array, optional; viewer-written)*: `[{ "name": "Customer number",
  "example": "10482", "goes_to": "SAP, Create sales order: Sold-to party" }]`. `name` is required
  (one line, at most 80 characters); `example` and `goes_to` are optional (one line, at most 120
  each). Order is the analyst's. An entry whose `name` is empty is not kept. Sub-steps carry it the
  same way. A draft that gets an entry becomes `edited` (as the flow does, C17).
- **The step editor** (Steps, and the step opened in the Timeline's pane): a section
  *Information* after Description: first the recorded fields of the step (read only, from the
  step's recorded actions, as the Technical details already reads them: the field's name, the value
  typed as its example, the system and screen as where it goes), marked "Recorded"; then the
  analyst's entries, each a row of three fields (*Information*, *Example*, *Where it goes*) with
  *Remove*; then *Add information*. Each add, change or remove is one undoable edit. Read only: the
  same rows as text, no acts. A step with neither shows the section with *Add information* only.
- **The PDD** (`pdd_export.py`), which holds no values: section 5, *Systems and information used*,
  lists under each system the names of the information entered in it, the analyst's entries
  included (an entry's system is its step's; a step with no system is listed under "Not in a
  system"); an example is never printed. Under a step in 3.2, one line "Information: Customer
  number, Order lines." (the names, the recorded and the typed, once each).
- **The Technical details** (`tech_details.py`): a sheet *Information*, one row per entry and per
  recorded field of the reference transaction's printed steps: Step (its number and name), Information,
  Example, Where it goes, From ("Typed by the analyst" or "Recorded"). The workbook is written, and
  zipped in a hand-off, whenever it holds a row: a project without a recording that has typed
  information now gets one (plan B7's "done when").
- The pipeline never writes `step.information` and round-trips it untouched.
