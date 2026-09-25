# Data model

> **Authoritative on-disk reference:** [`shared/SCHEMA.md`](../../shared/SCHEMA.md).
> This doc is the working summary: the session folder, the raw stream, the
> annotation model, the analyst's library on their own machine, and how the
> viewer holds a session in memory.
>
> The apps say *transaction* for a run and *project* for a session (AD-29);
> the data, and this summary, keep run, case and session.

## The session folder

One recording is one self-contained folder. The capture app creates it on
the SME's machine (under its user data folder, in
`sessions/<engagement_id>/<YYYYMMDD-HHMMSS>/`); it then reaches the
analyst's machine as a copy of the folder, or as the zip the capture app's
end summary makes next to it (the folder is the zip's root).

```
events.jsonl            raw event stream: append-only, never edited       capture
manifest.json           session metadata, status, consent, OBS reference  capture
config.yaml             the session's configuration snapshot              capture
screenshots/            event-triggered screenshots                       capture
obs/sync.json           tracker to OBS clock offset (OBS runs only)       capture
session-integrity.json  every file's name and size, written at the end    capture
annotations.json        the analyst sidecar                               viewer and pipeline
annotations.json.2..5   rotating backups, newest first                    viewer
derived_maps/           the editable As-Is and To-Be map copies           viewer
screenshots/analyst/    screenshots the analyst adds by hand (C16)        viewer
attachments/            files the analyst attaches (C16)                  viewer
video/                  an attached video, copied into the folder         viewer
stats.json              statistics, the runs, draft_summary               pipeline
analysis.json           the transaction check, the PDD's rows             pipeline
process_map_step.bpmn   the step-level map (--mine)                       pipeline
normalize.log           the pipeline's log                                pipeline
transcript/             an imported transcript file, byte for byte        transcript_import.py
transcript.json         its parsed segments and sync offset               transcript_import.py, viewer
```

The viewer never writes `transcript.json` itself except to set its
`offset_ms` on Sync and to delete it on Remove transcript; attaching one runs
`transcript_import.py`.

A session can also start from a video or from nothing (`manifest.source`
`"video"` or `"blank"`, contract C16): a folder with `manifest.json`, an
empty `events.jsonl` and `annotations.json`, none of the capture files. The
viewer makes them (its New menu) and writes everything the analyst adds
(screenshots, notes, attachments, a step's system); the pipeline analyzes
such sessions and reads those keys.

Older folders, the committed demo sessions included, may also hold
`events.xes`, `events.csv`, `dfg.json`, `process_map.bpmn` and
`process_maps/`. The pipeline no longer writes them and the viewer does not
read them (`viewer/retired-map-files.test.js` guards that).

## events.jsonl: the raw stream

Every line is one JSON object with a fixed envelope; only `data` varies by
`type`:

```json
{ "event_id": "uuid", "type": "...", "timestamp": "ISO 8601 ms UTC",
  "session_id": "uuid", "data": { }, "_seq": 0 }
```

| `type` | Produced by | `data` carries |
|---|---|---|
| `activity` | foreground-window polling (every 5 s) | `app`, `title`, `pid`, `duration_ms`, `bounds` |
| `marker` | the transaction key, the recording bar and the tray (Next transaction, a named transaction, End transaction), stopping the recording, a long idle stretch | `marker_type` (`start` / `end`), `label`, `reason` |
| `system` | session lifecycle | `kind` (`session_start`, `idle_start`, `screenshot`, `recorder_died`, `events_dropped`, ...) plus a kind-specific payload |
| `interaction` | the C# UI Automation recorder | `kind`, `control_type`, `automation_id`, `name`, `window_title`, `process_name`, `value` (never a password), capture-confidence fields |

**Runs are not in the raw stream.** Capture writes markers but no case ids.
The pipeline derives the runs:

- A `start` marker opens a run. **Runs never nest:** a start that arrives
  while a run is open ends that run first. The capture app's hotkey already
  writes an `end` with `reason: "auto_close_for_sibling"` before the next
  `start`; for a stream without it (a start inserted in the viewer, say) the
  pipeline ends the open run at the new start and records it on the derived
  start marker as `ends_case_id`.
- An `end` marker ends the open run; an `end` with no open run is ignored.
- A run's `case_id` is deterministic: `uuid5` of the session id and the start
  marker's event id (contract C9). Re-analyzing the same recording gives the
  same ids, so the analyst's steps stay attached to their runs; a preserved
  step whose run disappeared moves to the run that holds its start (lane
  FX1: even when it runs on past that run's end), and in a project without
  a recording a step without a time joins the first run.
- Every activity and interaction gets `case_ids`: `[]` outside any run, or
  the one open run's id.
- A recording with no markers has no runs. A missed marker is added by hand
  in the viewer (a `marker_edits` insert).
- A session without a recording (C16) that has no start marker has one
  implicit run covering the whole session, so steps can be added at once; a
  start marker inserted by hand replaces it.

## annotations.json: the analyst sidecar

`events.jsonl` is never changed. Every analyst decision lives in
`annotations.json`, which the pipeline reads before it drafts, so the work
survives every re-analysis.

| Key | Written by | Holds |
|---|---|---|
| `steps[]` | pipeline (drafts), viewer (analyst edits) | The step entities (below) |
| `pattern_run` | viewer | The run confirmed as the reference, and the draft-fix counts (contract C3) |
| `document` | viewer | The PDD's document fields: title, purpose, scope, trigger, result, contacts, business rules, exceptions, improvement, notes (C6) |
| `marker_edits[]` | viewer | Rename, re-time, delete or insert a run marker; replayed on a derived stream, the raw marker stays |
| `reference_maps[]` | viewer | The editable map copies and which one the PDD uses as As-Is or To-Be; the `.bpmn` files live in `derived_maps/` |
| `external_video` | viewer | The attached video: `{ path, offset_ms, attached_at }` |
| `step_filters` | viewer | Apps (and window titles) left out of the analysis |
| `excluded_ranges[]` | viewer | Time spans left out of drafting and statistics |
| `analyst_screenshots[]`, `analyst_notes[]`, `attachments[]` | viewer | What the analyst adds by hand (C16): screenshots, notes pinned to a step or a moment, attached files. The PDD prints the screenshots and lists the attachments; its text leaves the notes out, and the step map shows a step's notes and files beside its task (C18) |
| `notes[]` | nobody now | The product edition's timestamped Flow notes; both writers seed it empty and round-trip old entries |
| `analysis_overrides[]` | nobody now | Corrections to the waste and automation estimates; applied when an older file carries them |
| `process_exclusions` | pipeline | What the self and ignored-app filter dropped; regenerated every run |
| `calibration` | nobody (hand-edited only) | Two tuning knobs; absent means the defaults |
| `classification_overrides[]` | nobody now | Applied when an older file carries them; classification has no editing UI (AD-16) |
| `version`, `session_id`, `last_modified` | both | Bookkeeping |

Keys of cut features (`phases`, `group_annotations`, `roi_inputs`,
`memo_selection`, the anchor and suggestion keys, and others, contract C10)
round-trip verbatim: nothing reads, rewrites or deletes them. SCHEMA.md
lists them.

**Safe writes.** Both writers replace `annotations.json` atomically: a temp
file in the same folder, then a rename. Before each save the viewer copies
the current file into `annotations.json.2` (newest) through `.5` (oldest).
A file that exists but cannot be read is reported, naming the backups, and
never overwritten: the viewer refuses to save or analyze, and `normalize.py`
exits 2 without writing anything.

### Steps and their states

| State | Set by | Survives re-analysis |
|---|---|---|
| `auto_suggested` | the drafting rule | No: replaced by the next drafts |
| `confirmed` | Confirm transaction, on a draft left unchanged | Yes |
| `edited` | the analyst changed a draft (rename, merge, split, its flow) | Yes |
| `manually_authored` | the analyst added a step | Yes |
| `hidden` | the analyst hid a step | Yes, so a hidden draft never comes back |

A fresh draft that overlaps an analyst-owned step is dropped; one that
re-covers a previous draft's interactions inherits its `step_id`. Every
step also carries a value-free `process_label` (its grouping key) and
`grain_keys` (`element`, `screen`, `app`), both recomputed on every run.

A drafted step carries its identity: `draft_key`
(`"<app>|<screen>|<commit>"`), `name_source` (`remembered` or `draft`) and
`end_reason` (`commit`, `screen_change`, `run_end`). A merge or a split drops
those. A merge of drafted steps then keeps `draft_keys`, the members' keys in
order, so the merge still matches the same drafts in other runs and in saved
processes. A step added by hand carries none of them. Drafts outside every
run have `case_id: null`; the map and the step BPMN leave them out.

A draft is named, in this order, by a step the analyst named in this session
with the same `draft_key`, then by the remembered-names store below, then by
the drafting rule. The session's own names come first, so they travel with
the folder: the same session drafts the same names on another machine.

Contract C16 adds keys a step may carry: `system` (set by the analyst; wins
over the derived system), `order` (for a step without a time,
`time_range: null`), `pdd_screenshot` (the one screenshot the PDD prints)
and `hidden_screenshots` (recorder screenshots taken off the step). The
viewer writes them; the pipeline reads them.

Contract C17 adds the flow the analyst sets on a step: `only_when` (the
step happens only under this condition) and `links` (`[{ to, when }]`, to
a step id or `"end"`: a loop back, a skip ahead or an early end). A draft
that carries either stays `edited` through every analysis. The viewer's
live map and the step map draw the same edges from them
(`shared/flow-links-golden.json` pins both).

## The analyst's library

A small store lives on the analyst's machine, outside any session folder,
in `<viewer userData>/pdt-library/`:

| File | Holds | Read by |
|---|---|---|
| `remembered-names.json` | A name per `draft_key`, written on every rename of a drafted step and by the Remembered step names dialog in the Steps toolbar (rename, forget) | the pipeline (`--names`, on every analysis the viewer runs, after the session's own names) and the viewer |

The saved processes (`processes.json`, contract C5) left the app on
2026-09-24 (owner: a process is recorded once); a file left there is not
read.

It follows the annotation rules: a file that cannot be read is never
replaced, and writes go through a temp file and a rename.

## In-memory model (viewer)

`loadSessionIntoView(folder)` (`viewer/views/flow-view.js`) asks the main
process for the session over IPC (`viewer:loadSession`); `loadSessionData`
in [`viewer/main.js`](../../viewer/main.js) builds the object and the
renderer keeps it in `viewer/state.js` (`State.getSession()`):

| Field | Source | Notes |
|---|---|---|
| `sessionFolder` | | Resolved absolute path; the key for undo and saves |
| `manifest` | `manifest.json` | Required: a folder without it is refused |
| `events` | `events.jsonl` | Parsed and sorted by timestamp; a malformed line is skipped |
| `stats`, `analysis` | `stats.json`, `analysis.json` | `null` until the session is analyzed |
| `annotations` | `annotations.json` | `null` when absent or unreadable |
| `annotationsError` | | Set when `annotations.json` cannot be read; shown as a banner naming the file and its backups |
| `obsSync` | `obs/sync.json` | |
| `recordingPath`, `recordingAvailable` | `annotations.external_video` or `manifest.obs` | An attached video wins over the OBS recording |
| `externalVideoOffsetMs` | `annotations.external_video.offset_ms` | Video t=0 is `manifest.started_at` plus this offset |
| `integrity` | `session-integrity.json` | `{ missing: [...] }`: files that did not survive the copy |
| `transcript`, `transcriptError` | `transcript.json` | The parsed transcript, or `null`; a file that exists but cannot be used is reported in one line and otherwise ignored |

Every surface places transcript sentences through `viewer/transcript-model.js`,
the one implementation of the time rule in SCHEMA.md (contract C8).

### The edit round trip

```
edit -> persistAnnotations(annotations, label, topics)          (session.js)
     -> saveAnnotationsWithUndo: one write at a time
        -> IPC viewer:saveAnnotations -> annotations-store.js writeAnnotationsFile
           (refuse an unreadable file, copy the current one into the backups,
            write a temp file, rename it over annotations.json)
     -> State.emit(topic) for each touched topic; subscribed views re-render in place
```

- A failed save shows an error toast; the change stays on screen and is
  saved with the next successful save.
- Undo and redo are in memory only: annotation snapshots, at most 50, pinned
  to the session folder and cleared when another session opens.
- Only an analysis (the pipeline) re-reads the folder; edits never reload it.
- Renames, and the Remembered step names dialog's Rename and Forget, also
  write the library store above, through their own IPC calls.

## Conventions

IDs are opaque strings (RFC 4122 UUIDs; a run id is a `uuid5`); timestamps are
ISO 8601 with milliseconds in UTC; text files are UTF-8 without a byte order
mark; durations are milliseconds unless the field name ends in `_s`. Field
by field: [`shared/SCHEMA.md`](../../shared/SCHEMA.md).
