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
  the transaction in progress, the time recorded (the pauses left out; while
  paused, the pause's length beside Paused), Next transaction, Pause and
  Stop.
- **What it records.** The foreground window every 5 s, the clicks and
  typing through a C# UI Automation sidecar (password fields are never
  recorded), a start and an end marker per transaction, screenshots on an
  app switch, at a transaction's start and end, after a long idle stretch
  and by hand, and optionally an OBS video.
- **The end summary.** After Stop: where the recording is, its
  transactions and the time recorded (a pause said beside it), a warning
  when no transaction was marked, an optional name for the recording, and
  under it *Make a zip for the analyst* (nothing is sent from the app).
- **What the SME gives at the end.** The end summary also asks, each
  optional and in one line: What starts this work? What do you have when
  it is done? How often do you do it, and how long does one take? What
  goes differently sometimes, and what do you do then? It takes example
  files (an e-mail, a sheet, a form) with *Add an example file...* and
  *Remove*. The answers and the files are saved in the recording before
  the zip, so the analyst gets them with it (contract C24); nothing is
  asked during the recording.
- **Trustworthy recordings.** The sidecar is restarted a few times per
  recording and then reported dead; a silent recorder is flagged within
  minutes; a lost write, a program the recorder cannot see and failing
  screenshots each tell the SME; a crashed recording is recovered at the
  next launch.
- **Setup (analyst).** Settings (keys, OBS, screenshots, the storage limit,
  the idle end of a transaction), Profile (who is recording), a readiness
  check, the recordings on this computer and their deletion. An optional
  consent window. The request is written in the viewer (2.0.1); a
  recording setup saved by an earlier version is still read.

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
  step before. A customer's name in a window's title, or a ticket's subject
  in the link that opened it, is left out when the other transactions show
  other ones ("New order for …", "Open a record").
- **The analyst's work is kept.** Confirmed, edited, added and hidden steps
  survive every analysis; only the drafts are redrafted, and a hidden draft
  stays hidden. The raw recording is never changed.
- **Business system names.** Steps, maps and the PDD name the system a step
  happened in (SAP, Excel, Outlook, Salesforce for a Chrome window on
  Salesforce), from one rule list shared with the viewer; a browser window
  on a site no rule knows reads its site ("Order Desk"), not the browser.
  A system set by hand wins.
- **Statistics and observations.** Times per run and per step, the variants
  of the runs, the data typed again in another system, and the applications
  the recorder saw with less detail. A transaction's active time is the
  recorded foreground time inside it. A stretch the analyst left out of the
  analysis is left out of all of them, exactly its own time.
  A check that could not run says so, never shows zero.
- **The step map.** A BPMN 2.0 file of the transactions' steps
  (`process_map_step.bpmn`) that prints legibly: left to right, wrapped into
  rows, each task carrying its description, system and transaction count,
  the branches labelled "N of M transactions". It also carries the flow
  the analyst set on steps (a decision for a step that happens only under a
  condition, a loop back, a skip, an early end), the start named after the
  trigger, the main end after the result and each early end after its
  condition, plain tasks for the steps done in a system and manual tasks
  (the hand marker) for the steps done outside every system, the system of
  each task in a short label above it (or said once, "System: SAP", when
  every task is done in one system), a *Waste* note beside a step flagged
  as waste, each step's notes under it and its attachments as files under
  it, and a decision's paths leaving from its own corners. The labels are
  text a process manager changes in any BPMN tool; the map has no colours
  and no legend (2.0.1). Task names stay the step names, so a BPMN tool
  imports them clean.
- **The PDD (.docx).** The process written down for the SME, who
  confirms it, and for whoever asks about the process; archived per
  version. The developers work from the project in the viewer and the
  Technical details, so it holds no values, controls or recorded times.
  Tool-neutral, in the reader's order: document control (the request the
  analyst wrote, else the capture's; who recorded in full, "Maria Keller,
  sales assistant, Operations", from the capture profile's name, role and
  business unit, else the Windows login); purpose, scope, trigger, result and
  contacts; the As-Is map and the reference transaction's steps (each with
  its system, screen, "in N of M transactions", "Transaction 1 at 0:19",
  "Only when" its condition, its description, the fields it entered, one
  screenshot (the one chosen for the PDD, else its first) and its
  attachments, a waste flag, and where the process goes after it besides
  the next step), each step headed "Step 2: <name>" so its number never
  reads as a section's, under a line saying how many the analyst has not
  yet confirmed while any is a draft; variations in plain
  sentences (the lines the Steps level lists: extra, reordered, skipped and
  repeated steps, a conditional step not done, and a stretch left out of
  the analysis), business rules and exceptions; the systems used, each with
  the information entered in it (a workbook's cells as one entry); the
  volume and effort as the analyst writes it; improvement and automation
  scope with the re-keyed data (a value typed again in another system) and
  the To-Be map; notes; attachments (each name a link to its file where
  the files travel with the PDD). The analyst's fields survive every
  re-export; an empty field leaves a visible gap. Every PDD says which
  version it is: "Version 2, handed off <date> by <name>" when made for a
  hand-off, else "Working copy after version 2" (or "Working copy, not
  handed off yet"), with a Version history table once the project was
  handed off.
- **The Technical details (.xlsx).** For the developers, beside the project
  in the viewer: every recorded click, entry and choice of the reference transaction
  in the PDD's step order (Step 3, Step 3.2), with its control type,
  automation id, name, class name, how the recorder identified it and how
  far that can be trusted, the window, the program and the system; every
  field typed or chosen, with what was entered in each transaction (a
  password never recorded); the values typed again in another system (the
  PDD's re-keyed data); and each program's coverage, whether it ran on a
  remote or terminal surface, and its steps. Written with the standard
  library, it opens in Excel without a repair.
- **Meeting transcripts.** A Teams `.vtt` or `.docx` transcript is parsed
  into timed, speaker-tagged sentences; nothing interprets what was said.
  A project holds one per video (2.0.6, `--out transcript-2.json` and on).

## The viewer: the analyst's app

The analyst's Electron app, with its own Python; see
[architecture/VIEWER.md](architecture/VIEWER.md).

The viewer says *transaction* for one pass through the process and
*project* for what the analyst opens or starts.

**Starting**

- **New and Open.** The New menu starts a project **from a video** (one
  pick takes the videos and their Teams transcripts: the videos are copied
  into a new folder one after the other in the order of their names, each
  transcript is attached to the video whose name it shares, and the
  timeline follows them) or an **empty** one; the Open menu opens a project
  folder (the one the SME's capture app saved, or one made with New; the
  folder Windows' Extract All makes of the SME's zip opens the recording
  inside it), **a zip** (*Open a zip...*: the SME's zip or a *Whole
  project* zip is unzipped where you say and opens for editing, a hand-off
  opens read only) and the recent projects, named by their document title
  once it is written.
- **Drop to start.** The page shown while no project is open takes the
  same files dropped on it: a project folder, a zip, or videos with their
  transcripts.
- **The analysis runs by itself** when a folder opens without a current one
  and after the changes that need it, with one status line and Cancel. A
  run changes the project only when it finishes, so Cancel leaves the steps
  and the map as they were. The log shows only when a run fails.

**Overview**

- **The Checklist**: the acts that fit the project, each ticked once done
  and explained in its tooltip, with one button for the next act. A
  recording: mark the transactions, confirm the reference transaction
  (ticked without a click when none of its steps is a draft), review the
  other transactions (only those that differ), write the document, hand
  off. A project made from a video or from nothing: add the steps, write
  the steps (a name of its own and a description for each), review the
  other transactions (only with two or more), write the document, hand
  off. Once a version is handed off the line names it and its date. While
  the As-Is map the PDD prints was made before the steps changed, it adds
  *Check the As-Is map*. A project made from a video opens on the
  Timeline, where its steps are marked.
- **What a reader of the next version will miss**: once every act before
  the hand-off is done, or a version was handed off, one line under the
  Checklist ("A reader of the next version will miss 3 things") opens to
  what the PDD of the next version leaves out: the reference transaction's
  steps (at every level) that are still drafts, have no name of their own,
  no description, no picture or no system, decisions that do not say when,
  the empty document fields, an As-Is map made before the steps changed.
  Each line opens the place where it is fixed. Nothing shows while the list
  is empty, before then, or in a hand-off opened read only.
- **The project line**: who recorded it, the request (the one written in
  the document, else the capture's), its transactions, the reference
  transaction's steps, the video and the transcript with Attach, Replace
  and Remove (each taken out with its files in the folder, and back with
  Ctrl+Z; 2.0.6: *Add another* for a second video or transcript, and with
  several, how many and *Add*), and a warning only when one is needed.
- **The document** ("You write these. The PDD prints them."): twelve fields
  that print in their own places in the PDD (title, request, purpose,
  scope, trigger, result, contacts, business rules, exceptions, volume and
  effort, improvement and automation scope, notes). An empty field looks
  empty, and the heading counts the fields written, all but the request
  and the notes, which are optional ("3 of 10 written"), and, once one is,
  names the ones still empty.
  With it, the project's attachments and the transcript's sentences with
  *Add to* a field; a sentence said before the recording started reads
  "0:28 before". It lists the talk outside the transactions, or all of it
  while no transaction is marked (a project with one unmarked transaction).
- **What the SME gives at the end** (contract C24). The SME's answers to
  the end summary's four questions wait under Trigger, Result, Exceptions
  and Volume and effort ("The SME wrote: ...") with *Use* (writes the
  answer into the field, and the answer does not come back once the field
  is edited; a field that holds other text asks first; one Ctrl+Z gives
  back the old text and the answer) and *Dismiss* (hides it; Ctrl+Z brings
  it back), and the document's heading says how many wait ("The SME
  answered 4 questions: each waits under its field."); a field whose text
  is still the answer says it was written from it. A hand-off opened read
  only shows the answers as text ("The SME answered 4 questions."). The SME's example files become
  attachments of the whole project when the project first opens for
  editing, marked "From the SME" in Files and in the Overview's
  attachments; a file the SME added that did not come with the project is
  said once on the project line.

**Timeline**

- **One timeline** of the recording, its lanes in the order a process
  manager builds the process (lane LANES): the transactions, the steps (the
  tall lane: each name readable on its band on up to two lines, a band too
  narrow showing the step's number, a draft dashed, a one-click step too),
  the systems (an app among the apps outside the process hatched), the
  transcript, the videos, the screenshots (the recording's and the ones
  added at a moment), the notes and the idle stretches (off until chosen),
  on one clock (the time since the recording started), each lane named in a
  header column at its left (a key that looks like its marks, its name, a
  tooltip saying what it shows). A video project's timeline runs on its
  videos; a project with neither a recording nor a video says so, with
  *Attach video*. *Lanes* picks the lanes and says what the marks mean; one
  bar under the lanes shows the whole length, its box the part shown (drag
  it, or click a place); a double-click on a transaction shows only that
  transaction and *Show all* the whole length again. Under it, the *Raw
  events* drawer lists every event on the same clock.
- **The screen** (lane SCREEN): the video and the pane above, the timeline
  at the full width of the window below, always; nothing opens over it, and
  the page does not scroll. The video takes at most 58% of the width; two
  dividers share the height and the width. Expand gives the video 70% of
  the width, fullscreen the whole window above the timeline's row.
  Lane W2: a recording without a video shows its screen there, the
  screenshot taken last before the clock's moment with one line under it
  (its time and its step), following the clock (a click, a typed time, a
  mark, Left and Right); a click opens it in the gallery. While a
  transcript is placed, what is said shows under the picture, the speaker
  in bold, empty between two sentences; a click opens the Transcript tab at
  it.
- **The timeline's first row**, in the process manager's words: *Play*, the
  clock ("6:20 / 1:02:00"; a click types a time to go to), *Add step*,
  *Start transaction* or *End transaction* (one button, at the clock's
  moment), *Add note*, a message area (every message reads there while the
  Timeline shows, cut to one line, its whole text in its tooltip; at rest
  when the project was recorded and how long it is), *Lanes*, zoom out,
  *Show all*, zoom in. A selected stretch (Shift
  and a drag) shows its times and length there with *Leave out of the
  analysis* or *Not part of the process*, *Make it a transaction* and *Clear
  selection*. Every control is reached with Tab and worked with Enter or
  Space. Lane W2: the speed (*1x*, *1.5x*, *2x*) after the clock with a
  video, kept on this computer; I and O select a stretch by the keyboard,
  also while the video plays; after the row, Tab stops once on each lane
  with marks (Transactions, Steps, Transcript, Screenshots, Notes), the
  arrows go from mark to mark and Enter opens one; screenshots close
  together are one mark with their count.
- **The video above it**, attached and synced with two clicks and copied
  into the folder so it travels with it; *Remove video* takes it out with
  its copy, *Replace* takes out the copy it replaces, and Ctrl+Z brings
  either back; a click on the video plays or pauses it (it has no controls
  of its own: the row plays it).
- **Several videos on one timeline** (2.0.6, contract C23; the owner:
  "10th minute on the timeline is 10th minute on the timeline, regardless
  if there are 1 or 7 videos"). *Add video* takes one or more files; the
  Videos lane draws each as a band named after its file. In a project made
  from videos they run back to back, as in a video editor: one added goes
  after the last, and a trim, a replace or a remove of one moves the videos
  after it and everything marked on them (transactions, steps, notes and
  screenshots at a moment), refusing a trim that would cut a mark away. In a
  recording each is placed with its own sync and nothing else moves. A side
  of a band dragged trims it, and its right-click trims the start or the end
  at that moment, gives a side back, syncs (in a recording), replaces or
  removes it, or adds a video. The player plays the video that shows the
  playhead and goes on into the next one; the step panel plays each step
  from its own video. A transcript belongs to a video (Attach asks which)
  and moves with it; each has its own row with Sync, Replace and Remove.
  The PDD places each step on the timeline's clock, never in a video.
- **Transaction repair**: *Start a transaction here* and *End the
  transaction here* from a right-click; move, rename and delete them
  (lane PANE: on each transaction's header in the pane's Steps tab, *Starts
  at*, *Ends at*, *Rename*, *Delete transaction*; the Markers tab is gone);
  insert a transaction from a selected range. A transaction's band is drawn
  where its markers now are, and its start and its end drag (2.0.3). Every
  change applies by itself a moment later, in a recording too (D4): no
  button and no question; after a cancelled or failed run the top bar
  offers *Update the steps*.
- **Steps move on it** (2.0.3): the start and the end of a step whose time
  is the analyst's (one added on a video's timeline, or where nothing was
  recorded) drag, a step back to back with it giving way, and the step
  belongs to the transaction its start is in. A recorded step keeps its
  actions' time. A side dragged, and a transaction or a step started from a
  right-click, snaps to a step's start or the playhead a few pixels away
  (a step's side to the other sides too). Esc puts a side back; Ctrl+Z
  undoes a move. The same times are typed in Steps (see there).
- **A step's place in the process is its own** (2.0.5, contract C22; the
  owner's report: a correction the SME shows late in a video came after
  every step in between). A step band's right-click offers *Place after a
  step...*: a list of every transaction's steps, *First in* each, and the
  step comes right after the one chosen, in that one's transaction, while
  its band, its video and its time stay where it was shown; the band then
  carries an accent edge and a dotted foot, its tooltip saying where it is
  in the process, and the legend in *Lanes* explains the mark. *Back to its time* is
  the inverse.
- **Leave out of the analysis**: a selected stretch (a break, a detour)
  drafts no step and counts no time. The timeline shows it hatched through
  every lane (under the marks, which stay clickable), and a click on it
  where no mark is offers *Include again*; Ctrl+Z undoes either. A transaction
  with a stretch left out says so, in Steps and in the PDD, and the steps
  done in it are not read as skipped.
- **Not part of the process** (lane E): in a project made from a video or
  from nothing the same selected stretch (its card shows its duration only)
  is marked as not part of the process in one click, with no question and
  no analysis: a detour of a call. Hatched, its legend in those words,
  *Include again* and Ctrl+Z its inverse; the steps marked in it stay, and
  Steps, both maps and the PDD do not mention it.
- **Playing skips a marked stretch** (lane E), left out of the analysis or
  not part of the process, across the videos of the chain; a seek into it
  plays it. Selecting a stretch never starts the video.
- **The Transcript tab** (lane E), beside Screenshots and Markers: every
  transcript's sentences on the one clock, the speaker where it changes; a
  search that marks and counts ("3 of 340"), a speaker select; the
  sentence the video is at marked and kept in view while the video plays
  (not while the pointer is on the list or the search holds text); a click
  goes to the moment; after each sentence *Add step here* and *Copy to...*
  (one menu: the selected step's description, then the document's fields),
  shown on the row under the pointer, the focused row and the current row.
  A marked stretch is one row with *Include again*, and the step panel's
  *Said* leaves it out. Read only: read and searched only.
- **Starts here** (lane E, lane PANE), on the row of each step without a
  time in the pane's Steps tab, with a video: sets the start of that step to
  the moment the video shows; the step keeps its place in the process and
  takes the video's frame when it has no picture. The right-click menu's
  *"<step>" starts here* does it at the moment clicked.
- **The pane beside the video** (lane PANE): five tabs, *Steps (n)*,
  *Transcript*, *Screenshots (n)*, *Notes (n)*, *Files (n)*, real tabs to a
  screen reader; a project opens on Steps. Steps lists every step in the
  order of the process, the ones without a time too, grouped under each
  transaction's header in a recording (the reference first); each row says
  its number, name, system or *No system yet* with *no name yet* and *no
  description yet*, *Draft*, and when it starts; the row at the clock's
  moment says *now*. A row or a step's band opens the step in place with
  the Steps editor's own fields, *All steps*, *Previous*, *Next*, *Open in
  Steps*, in a recording *Also happens in* with *Go there*, and *Split...*,
  *Merge with next*, *Hide step*, *Delete*; Escape goes back to the list.
  *Paste notes...* above the list, *Add step* with no video and no
  recording, *Confirm transaction* and *Undo confirm* in a recording. Notes
  lists every note (*Add note*, *Edit*, *Delete*), Files every attached
  file (*Attach file...*, *Open*, *Remove*); a screenshot or a note clicked
  on the timeline opens its tab at it.
- **Notes at a moment**, and the screenshots in the pane and a gallery.

**Steps**

- **Times typed** (2.0.3): an open transaction shows *Starts at* and *Ends
  at* under its name, fields on the one clock to a tenth of a second where
  a time has one ("0:09.6"); a time typed moves its marker (an *Ends at*
  typed where it has none adds its End, emptied takes it out), and the
  steps follow it a moment later (D4). A step whose time is the
  analyst's shows its start and end as fields on its line of facts, and one
  added without a time a start field (its end waiting for it); the rules
  are the Timeline's drag's. Up and Down change a time by a second; a text
  that is no time, or a time out of range, is refused with the range it can
  take. Steps are marked one after another: each step added ends the step
  before it, and a transaction's end, or the next one's start, ends its last
  step; until then the newest is open ("to open", no length; fading out on
  the Timeline), as is a transaction with no end ("Ends at: open"). A step
  side joined to a transaction's side moves with it; a step deleted gives
  its time back to the step before it; an end emptied runs on to the next
  step or the transaction's end. In a project made from a video or from
  nothing, marker changes apply by themselves a moment later (no Apply
  button there); its one unmarked transaction shows both fields too.
- **Moving a step in the process** (2.0.5, contract C22): Alt+Up and
  Alt+Down (and *Move up*, *Move down* in the step menu) move any step one
  row, a step with a time in the process only, its band staying where it is
  on the Timeline; *Place after a step...* (the step menu, the Flow line)
  takes it further, into another transaction too, and *Back to its time*
  puts it where its time puts it. Its row and its Flow line read *Placed*.
  The map, the differences, the PDD and the Technical details read the same
  order. + Add step after a step with a time is placed right after it. A
  merge or a group joining a placed step with steps apart from it on the
  timeline is refused, and a step hidden or deleted leaves the steps placed
  after it where they were.
- **The transactions and their steps**, under one line that says what a
  transaction is; a row shows when its step starts, a transaction's head
  its time ("under 1s", "42s", "2m 07s"). Confirm the reference transaction
  after fixing its boundaries (merge, split, add, hide) and names; *Undo
  confirm*, beside the Confirmed badge, takes it back. A merge carries to
  the same drafts of the other transactions; a hidden draft can be hidden
  in every transaction.
- **The other transactions are reviewed, not confirmed**: each lists its
  extra, skipped, reordered and repeated steps against the reference
  transaction, and its head counts them; a step that happens only under a
  condition and was not done is said apart, as no difference (the PDD's
  4.1 lists the same lines). A step named like a step of the reference
  transaction is that step, whatever the recorder drafted (the map already
  draws them as one box).
- **The Steps page is an editor**: the toolbar acts on the selected step
  (*+ Add step*, *Split...*, *Merge with next*, *Hide step*, *Open as a
  sub-process* or *Open sub-process* and *Dissolve sub-process*, *Delete*
  on a step you added), or on the ticked steps once two or more are
  ticked. The list marks each transaction's differences from the reference
  on its rows (*Extra*, *Again*, *Moved*, a greyed *Skipped* or *Not done*
  row).
- **The selected step**, one column in the order of the work, each fact
  once: its name as the title, its state and its library code; one line of
  facts (the system, a field, then the screen, where the step is, how long
  it took, in how many transactions) with *Play* and *Show on timeline*;
  what you write (Description with what was said under it, each sentence
  under one step, with *Add*; the Flow line; Waste); the screenshots, the
  one the PDD prints marked; *Recorded* (the actions with the control each
  acted on, the scissors to split), open or closed as you last left it; the
  attachments and notes, and one row of adds. The step panel stays beside
  it. Everything saves as you go, and Ctrl+Z undoes it. A hand-off opened
  read only reads it as a record.
- **Step flow**: the Flow line reads "Always · then the next step" until
  the analyst sets *Only when...* (a condition: the map draws a decision
  with an "otherwise" path around the step) or *Go to...* (after the step,
  when a condition holds, back to an earlier step, on to a later one, or
  the end). A link to a step that is hidden or deleted is dropped, and the
  toast says so; Ctrl+Z brings both back.
- **Sub-processes**: a step can hold steps of its own, at any depth. *Open
  as a sub-process* gives a step one step per action recorded in it (a
  field typed, a click; named without the values typed; the cells of a
  sheet filled one after another are one step, "Fill in columns A to F"),
  in every transaction where it happens; a step with only one recorded
  action has none to open, and the step pane says so. *Group into a
  sub-process...* moves ticked steps, one after the other, into a new
  sub-process, and the same steps in every transaction too (it says first
  what it will group, and where). Its
  row's *▸ N sub-steps* opens it: a breadcrumb
  names the way down and goes back up, and the list shows one block per
  transaction that goes through it, compared with the reference
  transaction's. Every step verb works inside it (*Add step* at the video's
  playhead gives a sub-step its time), the flow stays inside it, Confirm
  transaction reaches every level, and *Dissolve sub-process* undoes it,
  each link back on the step it came from. The step panel, the Timeline's
  steps lane and the Map follow the level shown.
- **Steps by hand**: *+ Add step* without a time (moved with Alt+Up and
  Alt+Down), or *Add step* at the video's playhead. *Paste notes...* makes
  many at once: a line of the notes is a step (the text after its first
  colon its description), a line that starts with a document field's name
  goes to that field, as one undoable edit.
- **Step names**: a name given to a drafted step names the same drafted
  step (the same screen and button) in the project's other transactions at
  once. *Apps outside the process...* drops an application used during the
  call (Teams, Outlook) from the drafts.
- **The activity library** (contract C21): the step pane's name offers the
  activities of the step's system from the project's library (a step added
  by hand picks its system first); a pick sets the name, the system and,
  when the step has none, the description, and the title shows the
  activity's code. Any name can still be typed. A project keeps the
  library it started with (its `library.json`). Help, *Build the
  library...* (the owner's tool) reads projects and hand-off zips, lists
  their named steps by system with their screens and where they were
  found, shows the same screens named differently side by side, and saves
  the ticked ones as a new version of the library file.

**Map**

- **The map the PDD prints, first**: the process map drawn from the
  transactions' steps as BPMN (each task's system in a label above it, or
  said once when every task is done in one system; the decisions as
  gateways whose paths part at their corners; the notes and files under
  their steps), or the edited As-Is map once there is one, under one line
  that says which ("Process map (the PDD prints this map)", "As-Is map
  (edited; the PDD prints this map)"). It is linked: a task opens the step
  panel on its step, a file opens its attachment, a note shows its whole
  text; a system label is part of the picture and takes no click. After a
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
  change keeps nothing. An analysis never changes a copy. When the steps
  change after the As-Is copy was made, the Map's line and the Checklist say
  so, with *Copy again*: a new copy of the process map as it is now, kept at
  its first change, which then takes the old one's place in the PDD (a copy
  made before the step map had its systems, notes and attachments offers
  the same for them). *Delete* takes a copy out with its file, and Ctrl+Z
  brings both back.
- **Boxes moved by hand**: on how the transactions ran, a dragged box stays
  where it was put (per map, on this computer), and *Reset layout*, beside
  *Fit*, puts the boxes back.
- **A map per sub-process**: with a sub-process in the project, *Map:
  <name>* picks the map shown, the main process or any sub-process (each
  with its number, as the PDD numbers its chapter), and Steps shows the same
  level. The picture shows that sub-process's map (the As-Is map's when it
  has one, else the process map's, as the PDD prints it), and its own drill
  down moves the picker too. On how the transactions ran, a sub-process's
  box carries a +: a click opens the step panel, a double-click its map.

**Everywhere**

- **The step panel**: from a task of the map (or a box of how the
  transactions ran) or a Steps row (lane PANE: never on the Timeline, where
  a step opens in the pane beside the video), every occurrence
  of the step with its moment in a small video (a moment the video does not
  cover says so; a time under a second reads "under 1s"), its screenshots,
  what was said and its notes, its flow in one line when one is set, and
  the waste flag; its foot goes to the step in Steps, or on the Timeline.
  On the Map its head is the step's name, system and description as
  fields, saved as the editor saves them (lane E-1); on Steps, beside the
  editor, and in a project open read only, it is text. A step marked on the
  Timeline (S, *Add step*, *Add a step here*) opens in the pane beside the
  video:
  with the video paused the cursor is in its name, while it plays nothing
  takes the keys. A step marked where a video shows takes that frame as its
  screenshot, in the same undoable edit; a step a video covers that shows
  no screenshot offers *Use the video at m:ss*, here and in the editor.
  How the transactions ran fits again when the panel opens or closes
  beside it.
- **Saved as you go**: every change saves itself to the project folder, and
  the top bar says *Saved* (the time and the folder on hover), *Saving...*
  or *Not saved* with the reason.
- **Readable and keyboard safe**: labels at 4.5:1 in both themes, one focus ring, dialogs that keep Tab inside and give the focus back (Apps outside the process, the screenshot gallery and the map editor too), messages a screen reader hears, and an error that stays until it is dismissed.
- **Larger text, short tooltips, one name per act** (lane A-2): Ctrl+Plus, Ctrl+Minus and Ctrl+0 (and Ctrl with the mouse wheel) make the whole app larger, smaller or the usual size, in every window, kept on this computer; nothing a person reads is under 12 px; a tooltip is one short sentence, what a PM needs beyond it in Help; *Play*, *Show on timeline* and *Open in Steps* are the only names of their acts; a refused time or an emptied step name says why under its field until the field is edited again.
- **Export**: the PDD (with a picture of each sub-process's map in its
  chapter; its pictures leave the steps' notes out; with attached files,
  one zip holding the PDD and an *Attachments* folder its attachment names
  link to, so the files go with the document), the process map as an
  image (SVG, the map the Map shows first, of the level it shows, with the
  steps' notes) and as BPMN (one file with every map), the *Technical
  details (.xlsx)*, and the
  *Whole project (.zip)*: one zip of the whole folder, next to it, to hand
  the project to another analyst. The menu groups them under three
  headings: *For the developers and the archive* (*Hand off...*), *For
  another analyst* (*Whole project (.zip)*) and *Single files* (the rest).
  Where nothing was recorded, *Technical details (.xlsx)* writes no file
  and says so. A file is offered under the project's name (the
  document title once it is written: *Order to cash PDD.docx*, *Order to
  cash map.svg*), and every export opens its folder with the file selected.
- **Hand off to the developers**: *Export*, *Hand off...* (the Export
  menu's first group, and the Checklist's last act) asks what changed in
  this version and makes *<project> v2.zip* next to the project folder: the
  whole project (without the working file's backups and the analysis log),
  with the PDD, the Technical details (where something was recorded), the
  process map as a picture and as BPMN, and *Start here.txt* (what each
  file is) of version 2 at its root. The versions go up by one, the PDD lists them, and Ctrl+Z takes
  a version back (its zip stays). When the PDD of that version leaves
  something out, the dialog lists it first ("A reader of version 2 will
  miss:"), each line a link that cancels the hand-off and goes where it is
  fixed, and its button reads *Hand off anyway*: it never blocks.
- **A hand-off opened read only**: *Open a zip...* (the Open menu, and a
  button while no project is open) takes a hand-off zip; the app
  keeps its own copy and opens it read only: every level, the
  video, the transcript, the maps and the PDD it came with can be looked at
  and played, and nothing can change. Its project line reads "Version 2,
  handed off <date> by <name> · Read only". A newer version is a zip of its
  own, opened the same way.
- **Several projects at once**: *Open*, *Open in a new window...* (or the
  button beside a recent project) opens another project in a new window,
  and the one on screen stays open; starting the app again opens a new
  window too. Each window is named after its project. A project already
  open for editing in another window opens read only, its project line
  "Open in another window: read only here". Closing a window closes only
  its project.
- **Undo and redo** for every edit (Ctrl+Z and Ctrl+Y, or *Undo* and *Redo*
  in the top bar, shown greyed with nothing to undo or redo), a Help guide
  with Re-analyze, and a light and a dark theme.
- **The next act in the top bar**: on the Timeline, Steps and the Map, the
  Checklist's next act ("Next: write the steps (1 of 7)", with the
  Checklist's own count), which opens the Checklist with the keyboard on
  its button. Not in a read-only project.
- **An unreadable annotations file** is said in a banner, which is all the
  page shows (nothing that reads as an empty project), and nothing is saved
  over it; *Restore the newest backup* puts back the newest backup
  that can be read (it asks first, naming when it was saved) and keeps the
  unreadable file beside it.
