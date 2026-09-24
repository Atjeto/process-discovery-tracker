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
  application the recorder could see; the rows the PDD prints in its
  sections 5 and 6, written into `analysis.json` for the viewer's Overview.
  A stretch the analyst left out of the analysis is left out of all of them.
  A check that could not run says so, never shows zero.
- **The step map.** A BPMN 2.0 file of the transactions' steps
  (`process_map_step.bpmn`) that prints legibly: left to right, wrapped into
  rows, each task carrying its description, system and transaction count,
  the branches labelled "N of M transactions". It also carries the flow
  the analyst set on steps (a decision for a step that happens only under a
  condition, a loop back, a skip, an early end), the start named after the
  trigger, the main end after the result and each early end after its
  condition, plain tasks for the steps done in a system and manual tasks
  (the hand marker) for the steps done outside every system, each step's
  notes beside it, its attachments as files under it, and a colour per
  system with a legend that also says what the hand means. Task names stay
  the step names, so a BPMN tool imports them clean.
- **The PDD (.docx).** Tool-neutral, in the reader's order: document
  control; purpose, scope, trigger, result and contacts; the As-Is map and
  the reference transaction's steps (each with its system, screen, average
  time, "in N of M transactions", "Transaction 1 at 0:19", "Only when" its
  condition, its description, the fields it entered, its screenshots and
  attachments, a waste flag, and where the process goes after it besides
  the next step); variations (a transaction with a stretch left out of the
  analysis says so, and the steps done in it are not read as skipped),
  business rules and exceptions; one data
  table; applications and time; improvement and automation scope with the
  To-Be map; notes; attachments. The analyst's fields survive every
  re-export; an empty field leaves a visible gap.
- **Meeting transcripts.** A Teams `.vtt` or `.docx` transcript is parsed
  into timed, speaker-tagged sentences; nothing interprets what was said.

## The viewer: the analyst's app

The analyst's Electron app, with its own Python; see
[architecture/VIEWER.md](architecture/VIEWER.md).

The viewer says *transaction* for one pass through the process and
*project* for what the analyst opens or starts.

**Starting**

- **New and Open.** The New menu starts a project **from a video** (the
  video is copied into a new folder and the timeline follows it) or an
  **empty** one; the Open menu opens a project folder (the one the SME's
  capture app saved, or one made with New) and the recent projects, named
  by their document title once it is written.
- **The analysis runs by itself** when a folder opens without a current one
  and after the changes that need it, with one status line and Cancel. The
  log shows only when a run fails.

**Overview**

- **The Checklist**: the five acts (mark the transactions, confirm the
  reference transaction, review the other transactions, write the
  document, export the PDD), each ticked once done and explained in its
  tooltip, with one button for the next act.
- **The project line**: who recorded it, its transactions, the reference
  transaction's steps, the video and the transcript with Attach, Replace
  and Remove (each taken out with its files in the folder, and back with
  Ctrl+Z), and a warning only when one is needed.
- **The document** ("You write these. The PDD prints them."): ten fields
  that print in their own places in the PDD (title, purpose, scope,
  trigger, result, contacts, business rules, exceptions, improvement and
  automation scope, notes). An empty field looks empty, and the heading
  counts the fields written and, once one is, names the ones still empty.
  With it, the project's attachments and the transcript's sentences with
  *Add to* a field; a sentence said before the recording started reads
  "0:28 before".
- **Observations** ("Measured from the recording. The PDD prints them in
  sections 5 and 6."): *Data*, every field entered with its system, its
  step and an example value, and the *Re-keyed data* (a value typed again
  in another system); *Applications and time*, the time of each
  transaction and each system's screens, steps and time per transaction.
  They are the PDD's own rows, from the same analysis, so the two say one
  fact in the same words; they are measured again with each analysis and
  each PDD export.

**Timeline**

- **One timeline** of the recording: transactions, activity by system,
  idle, screenshots, the steps, the transcript and notes, on one clock (the
  time since the recording started), each lane named in a header column at
  its left (a key that looks like its marks, its name, a tooltip saying
  what it shows). A video project's timeline runs on its video.
- **The video beside it**, attached and synced with two clicks and copied
  into the folder so it travels with it; *Remove video* takes it out with
  its copy, *Replace* takes out the copy it replaces, and Ctrl+Z brings
  either back; a small playback bar.
- **Transaction repair**: *Start a transaction here* and *End the
  transaction here* from a right-click; move, rename and delete markers,
  shown at once as pending until *Apply marker changes*; insert a
  transaction from a selected range.
- **Leave out of the analysis**: a selected stretch (a break, a detour)
  drafts no step and counts no time. The timeline shows it hatched, and a
  click on it offers *Include again*; Ctrl+Z undoes either. A transaction
  with a stretch left out says so, in Steps and in the PDD, and the steps
  done in it are not read as skipped.
- **Notes at a moment**, and the screenshots in a side panel and a gallery.

**Steps**

- **The transactions and their steps**, under one line that says what a
  transaction is. Confirm the reference transaction after fixing its
  boundaries (merge, split, add, hide) and names; *Undo confirm*, beside
  the Confirmed badge, takes it back. A merge carries to the same drafts of the other
  transactions; a hidden draft can be hidden in every transaction.
- **The other transactions are reviewed, not confirmed**: each lists its
  extra, skipped and reordered steps against the reference transaction.
- **The step pane**: a fact line led by the system, Name, System, the fields
  typed, Description (with what was said during the step), the Flow line,
  Waste, Watch and Hide; screenshots (a video frame, a pasted image or a
  file, and the one the PDD prints), notes and attachments. Everything
  saves as you go, and Ctrl+Z undoes it.
- **Step flow**: the Flow line reads "Always · then the next step" until
  the analyst sets *Only when...* (a condition: the map draws a decision
  with an "otherwise" path around the step) or *Go to...* (after the step,
  when a condition holds, back to an earlier step, on to a later one, or
  the end). A link to a step that is hidden or deleted is dropped, and the
  toast says so; Ctrl+Z brings both back.
- **Sub-processes**: a step can hold steps of its own, at any depth. *Open
  as a sub-process* gives a step one step per action recorded in it (a
  field typed, a click; named without the values typed), in every
  transaction where it happens; *Group into a sub-process...* moves ticked
  steps, one after the other, into a new sub-process, and the same steps in
  every transaction too. Its row's *▸ N sub-steps* opens it: a breadcrumb
  names the way down and goes back up, and the list shows one block per
  transaction that goes through it, compared with the reference
  transaction's. Every step verb works inside it, the flow stays inside it,
  Confirm transaction reaches every level, and *Dissolve sub-process* undoes
  it. The step panel, the Timeline's steps lane and the Map follow the level
  shown.
- **Steps by hand**: *+ Add step* without a time (moved with Alt+Up and
  Alt+Down), or *+ Step* at the video's playhead.
- **Remembered step names**: a name given once names the same drafted step
  (the same screen and button) in every project; the Steps toolbar's
  *Remembered step names...* renames or forgets one. *Apps outside the
  process...* drops an application used during the call (Teams, Outlook)
  from the drafts.

**Map**

- **The map the PDD prints, first**: the process map drawn from the
  transactions' steps as BPMN (each system in its colour with a legend, the
  decisions as gateways, the notes and files beside their steps), or the
  edited As-Is map once there is one, under one line that says which
  ("Process map (the PDD prints this map)", "As-Is map (edited; the PDD
  prints this map)"). It is linked: a task opens the step panel on its
  step, a file opens its attachment, a note shows its whole text. After a
  change to the steps the Map updates the process map first, once, keeping
  the picture meanwhile; one line says why when it cannot be drawn.
- **How the transactions ran**, one click away (and back): the same steps
  left to right from a Start to an End circle, each box naming its system,
  the arrows weighted by the time along them (hover one for how often the
  transactions took it and its times, in words). The flow set in Steps shows
  too: the conditions on their lines, and a dashed line for a path no
  transaction took.
- **Edit as the As-Is map**: an editable BPMN copy for the PDD (and a To-Be
  copy), kept once something is changed in it: leaving the editor without a
  change keeps nothing. An analysis never changes a copy; a copy made before
  the step map had its colours, notes and attachments offers *Copy again*
  for them. *Delete* takes a copy out with its file, and Ctrl+Z brings both
  back.
- **Boxes moved by hand**: on how the transactions ran, a dragged box stays
  where it was put (per map, on this computer), and *Reset layout*, beside
  fit, puts the boxes back.
- **A map per sub-process**: with a sub-process in the project, *Map:
  <name>* picks the map shown, the main process or any sub-process (each
  with its number, as the PDD numbers its chapter), and Steps shows the same
  level. The picture shows that sub-process's map (the As-Is map's when it
  has one, else the process map's, as the PDD prints it), and its own drill
  down moves the picker too. On how the transactions ran, a sub-process's
  box carries a +: a click opens the step panel, a double-click its map.

**Everywhere**

- **The step panel**: from a task of the map (or a box of how the
  transactions ran), a timeline step band or a Steps row, every occurrence of the step with its moment in a small
  video, its screenshots, what was said and its notes, and its flow in one
  line when one is set.
- **Saved as you go**: every change saves itself to the project folder, and
  the top bar says *Saved* (the time and the folder on hover), *Saving...*
  or *Not saved* with the reason.
- **Export**: the PDD (with a picture of each sub-process's map in its
  chapter), the process map as an image (SVG, the picture the PDD prints and
  the Map shows first, of the level the Map shows) and as BPMN (one file
  with every map), and the
  *Whole project (.zip)*: one zip of the folder, next to it, to hand the
  project to someone. Every export opens its folder with the file selected.
- **Undo and redo** for every edit, a Help guide with Re-analyze, and a light
  and a dark theme.
- **An unreadable annotations file** is said in a banner, and nothing is
  saved over it; *Restore the newest backup* puts back the newest backup
  that can be read (it asks first, naming when it was saved) and keeps the
  unreadable file beside it.
