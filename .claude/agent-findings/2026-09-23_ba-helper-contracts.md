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
| `name_source` | string | `"remembered"` when the name came from the remembered-names store (C4), else `"draft"` |
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
"document": { "title": "", "purpose": "", "scope": "", "contacts": "",
              "business_rules": "", "exceptions": "", "notes": "" }
```

Plain multi-line strings. The PDD renders each non-empty field in place of the
matching placeholder; empty fields keep today's placeholder. Survives re-export.

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

## C13. normalize.py exit codes (RP-04, RP-09)

| Code | Meaning |
|---|---|
| 0 | Success |
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
