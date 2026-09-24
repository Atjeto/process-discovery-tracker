# Features

What the light version of the Process Discovery Tracker does, by component.
How each piece is built: the [architecture reference](architecture/OVERVIEW.md).
Per-release history: [CHANGELOG.md](../CHANGELOG.md). The product edition's
catalogue (v1.5.0) is on branch `product-edition`:
[FEATURES.md there](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/FEATURES.md).

Three components, joined by one session folder that is copied by hand:
**Capture** (the SME records), **the pipeline and the PDD** (the analysis),
and **the viewer** (the analyst's app). Nothing talks over a network and no
AI ships inside.

## Capture: the SME records

The SME's tray app; see [architecture/CAPTURE.md](architecture/CAPTURE.md).

- **One start.** The recording bar's button, the tray, the welcome and the
  transaction key (Ctrl+Shift+S) start the recording with Transaction 1;
  each later press starts the next transaction and ends the open one
  first, so transactions never nest. Ctrl+Shift+E ends a transaction,
  Ctrl+Shift+P takes a screenshot; a key another program holds falls back
  to Ctrl+Alt and the SME is told.
- **The recording bar.** A small strip that stays on top without taking the
  keyboard focus and stays out of shared screens and screenshots: the state,
  the transaction in progress, the elapsed time, Next transaction (with
  named transactions when they are set up), Pause and Stop.
- **What it records.** The foreground window every 5 s, the clicks and
  typing through a C# UI Automation sidecar (password fields are never
  recorded), a start and an end marker per transaction, screenshots on an
  app switch, at a transaction's start and end, after a long idle stretch
  and by hand, and optionally an OBS video.
- **The end summary.** After Stop: where the recording is, its
  transactions and length, a warning when no transaction was marked, and
  *Make a zip for the analyst* (nothing is sent from the app).
- **Trustworthy recordings.** The sidecar is restarted a few times per
  recording and then reported dead; a silent recorder is flagged within
  minutes; a lost write, a program the recorder cannot see and failing
  screenshots each tell the SME; a crashed recording is recovered at the
  next launch.
- **Setup (analyst).** Recording setup (the request and the named
  transactions), Settings (keys, OBS, screenshots, the storage limit, the
  idle end of a transaction), Profile (who is recording), a readiness
  check, the recordings on this computer and their deletion. An optional
  consent window.

## The pipeline and the PDD

The Python pipeline the viewer runs by itself; see
[architecture/NORMALIZATION.md](architecture/NORMALIZATION.md).

- **Runs from the markers.** One run per start marker, never nested; stable
  run ids, so the analyst's steps stay attached across analyses. A session
  without a recording gets one run covering it until runs are marked.
- **Drafted steps.** Each run's interactions become steps: one stretch on
  one screen, ending at the action that commits the work there (Save,
  Search, Submit) or where the work moves to another screen. A draft is named
  after its screen and that action, or with a name the analyst gave the same
  step before.
- **The analyst's work is kept.** Confirmed, edited, added and hidden steps
  survive every analysis; only the drafts are redrafted, and a hidden draft
  stays hidden. The raw recording is never changed.
- **Business system names.** Steps, maps and the PDD name the system a step
  happened in (SAP, Excel, Outlook, Salesforce for a Chrome window on
  Salesforce), from one rule list shared with the viewer; a system set by
  hand wins.
- **Statistics and observations.** Times per run and per step, the variants
  of the runs, the data typed again in another system, and how much of each
  application the recorder could see. A check that could not run says so,
  never shows zero.
- **The step map.** A BPMN 2.0 file of the transactions' steps
  (`process_map_step.bpmn`) that prints legibly: left to right, wrapped into
  rows, each task carrying its description, system and transaction count,
  the branches labelled "N of M transactions", the start and end named
  after the trigger and the result.
- **The PDD (.docx).** Tool-neutral, in the reader's order: document
  control; purpose, scope, trigger, result and contacts; the As-Is map and
  the reference transaction's steps (each with its system, screen, average
  time, "in N of M transactions", "Transaction 1 at 0:19", its
  description, the fields it entered, its screenshots and attachments, a
  waste flag); variations, business rules and exceptions; one data table;
  applications and time; improvement and automation scope with the To-Be
  map; notes; attachments. The analyst's fields survive every re-export;
  an empty field leaves a visible gap.
- **Meeting transcripts.** A Teams `.vtt` or `.docx` transcript is parsed
  into timed, speaker-tagged sentences; nothing interprets what was said.

## The viewer: the analyst's app

The analyst's Electron app, with its own Python; see
[architecture/VIEWER.md](architecture/VIEWER.md).

**Starting**

- **Open a recording folder**, or start a project **from a video** (the
  video is copied into a new folder and the timeline follows it) or **from
  nothing**. Recent recordings are named by their document title once it
  is written.
- **The analysis runs by itself** when a folder opens without a current one
  and after the changes that need it, with one status line and Cancel. The
  log shows only when a run fails.

**Overview**

- **What is left**: the stages (runs, reference run, other runs, document,
  PDD), each shown done or not, with one button for the next act.
- **The recording line**: who recorded it, its runs, the reference run's
  steps, the video and the transcript with Attach, and a warning only when
  one is needed.
- **The document**: ten fields that print in their own places in the PDD
  (title, purpose, scope, trigger, result, contacts, business rules,
  exceptions, improvement and automation scope, notes), the session's
  attachments, and the transcript's sentences with *Add to* a field.
- **Observations**: data typed twice, per field; where the time goes, per
  step and per system.

**Timeline**

- **One timeline** of the recording: runs, activity by system, idle,
  screenshots, the steps, the transcript and notes, on one clock (the time
  since the recording started). A video project's timeline runs on its video.
- **The video beside it**, attached and synced with two clicks and copied
  into the folder so it travels with it; a small playback bar.
- **Run repair**: insert, move, rename and delete run markers, shown at once
  as pending until *Apply marker changes*; insert a run from a selected
  range, or exclude a range from the analysis.
- **Notes at a moment**, and the screenshots in a side panel and a gallery.

**Steps**

- **The runs and their steps.** Confirm the reference run after fixing its
  boundaries (merge, split, add, hide) and names; *Reopen run* takes it back.
  A merge carries to the same drafts of the other runs; a hidden draft can
  be hidden in every run.
- **The other runs are reviewed, not confirmed**: each lists its extra,
  skipped and reordered steps against the reference run.
- **The step pane**: a fact line led by the system, Name, System, the fields
  typed, Description (with what was said during the step), Waste, Watch and
  Hide; screenshots (a video frame, a pasted image or a file, and the one
  the PDD prints), notes and attachments. Everything saves as you go, and
  Ctrl+Z undoes it.
- **Steps by hand**: *+ Add step* without a time (moved with Alt+Up and
  Alt+Down), or *+ Step* at the video's playhead.
- **Saved names and saved processes**: a name given once names the same
  drafted step in every later recording; *Save as this process* lets a later
  recording be compared with the confirmed reference run. *Leave apps out*
  drops an application from the drafts.

**Map**

- **The process map** drawn from the runs' steps, left to right, each box
  naming its system, the arrows weighted by the time along them (hover one
  for how often the runs took it and its times, in words).
- **Edit as the As-Is map**: an editable BPMN copy for the PDD (and a To-Be
  copy); the chosen As-Is map shows first. An analysis never changes a copy.

**Everywhere**

- **The step panel**: from a map box, a timeline step band or a Steps row,
  every occurrence of the step with its moment in a small video, its
  screenshots, what was said and its notes.
- **Export**: the PDD, the process map as an image (SVG) and as BPMN.
- **Undo and redo** for every edit, a Help guide with Re-analyze, and a light
  and a dark theme.
