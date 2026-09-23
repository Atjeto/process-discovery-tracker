# Data model

> **Authoritative on-disk reference:** [`shared/SCHEMA.md`](../../shared/SCHEMA.md).
> This doc is the working summary: the session folder, the raw stream, the
> annotation model, the analyst's library on their own machine, and how the
> viewer holds a session in memory.

## The session folder

One recording is one self-contained folder. The capture app creates it on
the SME's machine (under its user data folder, in
`sessions/<engagement_id>/<YYYYMMDD-HHMMSS>/`); it is then copied to the
analyst's machine.

```
events.jsonl            raw event stream: append-only, never edited       capture
manifest.json           session metadata, status, consent, OBS reference  capture
config.yaml             the session's configuration snapshot              capture
screenshots/            event-triggered screenshots                       capture
obs/sync.json           tracker to OBS clock offset (OBS runs only)       capture
session-integrity.json  every file's name and size, written at the end    capture
capture.log             the capture app's per-session log                 capture
annotations.json        the analyst sidecar                               viewer and pipeline
annotations.json.2..5   rotating backups, newest first                    viewer
derived_maps/           forked, editable BPMN maps                        viewer
stats.json              statistics, the runs, draft_summary               pipeline
analysis.json           facts, findings, analysis, stage_errors           pipeline
process_map_step.bpmn   the step-level map, the Fork source (--mine)      pipeline
normalize.log           the pipeline's log                                pipeline
transcript/             an imported transcript file, byte for byte        transcript_import.py
transcript.json         its parsed segments and sync offset               transcript_import.py, viewer
```

The viewer never writes `transcript.json` itself except to set its
`offset_ms` on Sync and to delete it on Remove transcript; attaching one runs
`transcript_import.py`.

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
| `marker` | the run hotkey and the Live Session window | `marker_type` (`start` / `end`), `label`, `reason` |
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
  step whose run disappeared moves to the run that contains it in time.
- Every activity and interaction gets `case_ids`: `[]` outside any run, or
  the one open run's id.
- A session with no markers has no runs. A missed marker is added by hand in
  the viewer (a `marker_edits` insert).

## annotations.json: the analyst sidecar

`events.jsonl` is never changed. Every analyst decision lives in
`annotations.json`, which the pipeline reads before it drafts, so the work
survives every re-analysis.

| Key | Written by | Holds |
|---|---|---|
| `steps[]` | pipeline (drafts), viewer (analyst edits) | The step entities (below) |
| `pattern_run` | viewer | The run confirmed as the reference, and the draft-fix counts (contract C3) |
| `document` | viewer | The PDD's document sections: title, purpose, scope, contacts, business rules, exceptions, notes (C6) |
| `marker_edits[]` | viewer | Rename, re-time, delete or insert a run marker; replayed on a derived stream, the raw marker stays |
| `reference_maps[]` | viewer | Forked, editable maps and which one the PDD uses as As-Is or To-Be; the `.bpmn` files live in `derived_maps/` |
| `external_video` | viewer | The attached video: `{ path, offset_ms, attached_at }` |
| `step_filters` | viewer | Apps (and window titles) left out of the analysis |
| `excluded_ranges[]` | viewer | Time spans left out of drafting and statistics |
| `memo_selection[]` | viewer | Which findings the PDD's section 1 prints (empty: the top findings) |
| `analysis_overrides[]` | viewer | The analyst's corrections to the waste and automation estimates |
| `notes[]` | viewer | Timestamped notes; the PDD does not print them |
| `process_exclusions` | pipeline | What the self and ignored-app filter dropped; regenerated every run |
| `calibration` | nobody (hand-edited only) | Two tuning knobs; absent means the defaults |
| `classification_overrides[]` | nobody now | Applied when an older file carries them; classification has no editing UI (AD-16) |
| `version`, `session_id`, `last_modified` | both | Bookkeeping |

Keys of cut features (`phases`, `group_annotations`, `roi_inputs`, the anchor
and suggestion keys, and others, contract C10) round-trip verbatim: nothing
reads, rewrites or deletes them. SCHEMA.md lists them.

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
| `confirmed` | Confirm run, on a draft left unchanged | Yes |
| `edited` | the analyst changed a draft (rename, merge, split) | Yes |
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
processes. A step added by hand carries none of them. Drafts outside every run have `case_id: null`;
the map and the step BPMN leave them out.

## The analyst's library

Two small stores live on the analyst's machine, outside any session folder,
in `<viewer userData>/pdt-library/`:

| File | Holds | Read by |
|---|---|---|
| `remembered-names.json` | A name per `draft_key`, written on every rename of a drafted step and by the Remembered names dialog (rename, forget) | the pipeline (`--names`, on every analysis the viewer runs) and the viewer |
| `processes.json` | Saved processes: a confirmed pattern run's steps (`draft_key` or `draft_keys`, name, description, waste), written by "Save as this process" | the viewer only, to compare a session that has no confirmed pattern run with the closest saved process |

Both follow the annotation rules: a file that cannot be read is never
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
- Renames and "Save as this process" also write the library stores above,
  through their own IPC calls.

## Conventions

IDs are opaque strings (RFC 4122 UUIDs; a run id is a `uuid5`); timestamps are
ISO 8601 with milliseconds in UTC; text files are UTF-8 without a byte order
mark; durations are milliseconds unless the field name ends in `_s`. Field
by field: [`shared/SCHEMA.md`](../../shared/SCHEMA.md).
