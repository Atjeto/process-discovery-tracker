# Changelog

All notable changes to the Process Discovery Tracker. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Write down the information each step uses or enters** (contract C26,
  plan D6). The step editor has an *Information* section after the
  Description: first the fields the recorder saw in the step, read only and
  marked *Recorded* (the field, the value typed as its example, the system
  and screen as where it goes), then your own lines, each *Information*,
  *Example* and *Where it goes*, with *Remove*, and *Add information*. A
  field saves when it is left or on Enter, Escape puts it back, a line whose
  name is emptied goes and says so, and Ctrl+Z takes any change back. The
  PDD names the information and never an example: under each system in
  section 5 (a step with no system under *Not in a system*, which read *No
  system set*), and one line under each step, "Information: Customer
  number, Order lines.", in place of "Fields: ...". The Technical details
  have an *Information* sheet with every line and every recorded field,
  its example, where it goes and where it comes from, so a project made
  from a video or from nothing now gets the workbook, and its hand-off zip
  holds it, once a step lists information. A hand-off opened read only
  shows the rows as text.
- **The step panel opens on Steps in a project without a video.** On the
  step editor's line of facts, *in 3 of 4 transactions* (when the step
  happened in two transactions or more) is a link that opens the step
  panel at the step, one row per transaction: in a window narrower than
  1440 pixels in place of the list (Escape gives the list back and the
  focus to the link), from 1440 pixels beside the editor. A project without
  a video has no *Play*, so this was the step panel's missing door there.
- **Say what the automation does with each step, and who does it**
  (contract C25, plan D7 and D8). The step editor's *Automation* choice,
  under the Flow line where the Waste tick was: *Not decided yet*, *The automation does it*,
  *Stays with a person* or *No longer needed* (what the waste flag was:
  Steps and the step panel tag such a step *No longer needed*, and the
  maps still mark it *Waste*).
  *Done by*, after the system on the step's line, names a role or a
  person; left empty, it is the role the recording was made under. The
  process map puts a gear in the corner of a box the automation does and
  a hand in the corner of a box that stays with a person, and writes who
  does each step under its box (once for the map when one role does every
  step). The PDD's context line says who does the step ("done by Sales
  assistant"), its improvement and automation scope lists the steps under
  the four choices, and the Technical details have an Automation and a
  Done by column. A hand-off opened read only shows both as text. The step
  menu's *Flag as waste* reads *Mark as no longer needed*. The PDD lists
  the steps under the four choices in its improvement and automation
  scope only once a choice is made, and a step of 3.2 no longer needed
  carries no second mark under it (*Flagged as waste* is gone; a sub-step
  of a chapter, which that list does not hold, says *No longer needed.*).
  The Steps toolbar's *Flagged: N waste* count is gone: the rows carry
  the tag and the PDD lists the steps.
- **The SME answers four short questions and adds example files when a
  recording stops** (contract C24, lane C). The capture app's end summary
  asks, each optional and in one line: what starts this work, what you
  have when it is done, how often you do it and how long one takes, and
  what goes differently sometimes; and it takes example files (an e-mail,
  a sheet, a form) with *Add an example file...* and *Remove*. Both are
  saved in the recording before the zip, so the analyst gets them with it:
  the answers on the manifest, the files in `attachments/`. At most 20
  files of 50 MB each; a refused file is named with its reason. Nothing is
  asked during the recording.
- **Every control of the capture app's windows shows a focus ring** when
  reached by the keyboard.
- **What the SME gives at the end reaches the document** (contract C24,
  lane C). The answers the SME gives in the capture app's end summary wait
  under Trigger, Result, Exceptions and Volume and effort on the Overview:
  "The SME wrote: ..." with *Use* (writes it into the field, and it does
  not come back once the field is edited; a field that holds other text
  asks "Replace what the field holds with the SME's answer?" first) and
  *Dismiss* (Ctrl+Z brings it back), and the
  document's heading says "The SME answered 4 questions: each waits under
  its field." A hand-off opened read only shows them as text. The SME's
  example files become attachments of the whole project when it first
  opens for editing, marked "From the SME" in Files and on the Overview, so
  the PDD lists them and they travel in its zip and a hand-off; a file
  that did not come with the project is said once.
- **The PDD names who recorded in full.** Document control's *Recorded by*
  reads the capture profile's name, role and business unit ("Maria Keller,
  sales assistant, Operations"); without a name, the Windows login as
  before.
- **The Timeline as the workspace: the timeline at the bottom, the video
  and the pane above it.** The timeline takes the full width of the window,
  always, and nothing opens over it or beside it; the video (at most 58% of
  the width) and the pane share the height above it, and the page does not
  scroll: the pane's lists scroll in the pane, the lanes under the
  timeline's first row. Two dividers share the height and the width; the
  sizes the old layout stored are not read. At 1366x768 the video is 778
  wide, the pane 552 x 440 and the timeline 1366 x 272. Fullscreen gives
  the video the whole window above the timeline's row, which stays.
- **The timeline's first row.** One row holds how to play and how to mark:
  *Play*, the clock ("6:20 / 1:02:00": a click types a time and goes there),
  *Add step*, *Start transaction* or *End transaction* (one button: it reads
  *End transaction* while the moment is inside a transaction whose end is
  not marked yet), *Add note*, a message area, *Lanes*, zoom out, *Show
  all*, zoom in. The marking buttons act at the
  clock's moment, as the right-click's acts do there; without a moment they
  say why they cannot be clicked, and a project opened read only does not
  show them. While the video plays, *Start transaction* (and the
  right-click's *Start a transaction here*) starts the transaction at once
  with no name and no question; *Rename*, on its header beside the video,
  names it afterwards. Every control is reached with Tab, worked with Enter or Space,
  and has a name a screen reader reads; a click on one leaves Space playing
  the video. In a recording without a video the words read "the
  recording".
- **Messages read in the row.** On the Timeline a message reads in the
  row's message area, one line, cut with an ellipsis and whole in its
  tooltip, and never covers the lanes or the pane (an area too narrow to
  read paints nothing, the message still announced); at rest the area says
  when the project was recorded and how long it is. Adding a step says
  where it starts: "Step added at 6:20."
- **A selected stretch acts in the row.** A Shift-drag shows the stretch
  in the row ("0:40 to 1:10 · 30s") with *Leave out of the analysis* or
  *Not part of the process*, *Make it a transaction* and *Clear selection*,
  in place of the marking buttons; the card that counted events, markers,
  screenshots and systems over the lanes is gone. Escape clears it.

- **The pane beside the video on the Timeline.** One pane with a tab for
  each kind of thing the project holds: *Steps (n)*, *Transcript*,
  *Screenshots (n)*, *Notes (n)* and *Files (n)*, real tabs to a screen
  reader (Left and Right move between them), kept while the window lives; a
  project opens on Steps. The Steps tab lists every step in the order of the
  process, the steps without a time too, grouped under each transaction's
  header in a recording (the reference first); a row says its number, name,
  system (or *No system yet*, then *no name yet* and *no description yet*
  where they apply), *Draft* on a draft and when it starts, and the row at
  the clock's moment says *now*. A step without a time has *Starts here* on
  its row (the toolbar's *"<step>" starts here* left; the right-click entry
  stays). A row, or a step's band on the timeline, opens the step in place,
  drawn and saved by the Steps editor's own code, with *All steps*,
  *Previous*, *Next*, "Step 3 of 7", *Open in Steps*, in a recording *Also
  happens in* with *Go there*, and Steps' *Split...*, *Merge with next*,
  *Hide step* and *Delete* under it; Escape goes back to the list. A step
  marked with S, + Step, a right-click or *Add step here* opens there too.
  Notes lists every note with its moment, *Edit* and *Delete*, and *Add
  note*; Files every attached file with *Open* and *Remove*, and *Attach
  file...*. A click on a screenshot or a note on the timeline opens its tab
  at it. A transaction's header carries its name, *Reference*, *Starts at*
  and *Ends at*, *Rename* and *Delete transaction*, and why the capture app
  ended it when it did so by itself: the **Markers tab is gone**. The step
  panel no longer opens on the Timeline, so the timeline keeps its width
  with a step open; on the Map and on Steps it opens as before.
- **The next act and Undo in the top bar.** On the Timeline, Steps and the
  Map the top bar names the Checklist's next act ("Next: write the steps (1
  of 7)", the count the Checklist keeps); a click opens the Overview with
  the keyboard on the Checklist's button for it. *Undo* and *Redo* beside
  it do what Ctrl+Z and Ctrl+Y do, on every level, and stay greyed while
  there is nothing to undo or redo. None of the three shows in a project
  opened read only, and Undo and Redo give way to the map editor's own keys
  while it is open. The bar keeps one line down to 1024 px: the next act's
  text is cut with an ellipsis (whole in its tooltip), and below 1100 px the
  levels drop their glyphs.
- **Open a zip.** *Open a hand-off (.zip)...* is now *Open a zip...* (the
  Open menu and the page shown while no project is open) and takes any zip
  of one project: the zip the SME's capture app made, or a *Whole project*
  zip, is unzipped into a folder you name (beside the zip by default, named
  after the zip) and opens for editing, analyzed by
  itself; a hand-off still opens read only. The top bar shows how far the
  unzipping is, with Cancel, and a failed or cancelled one leaves no folder.
  A folder that is there and not empty is refused. No more Extract All.
- **Videos and transcripts in one pick.** *New project from a video...*
  takes several files at once: the videos go one after the other in the
  order of their names, and each Teams transcript is attached to the video
  whose name it shares (else to the videos in order), placed with no sync.
  A transcript that cannot be read, or has no video left, is named in one
  line and the project opens anyway.
- **Drop to start.** The page shown while no project is open takes a
  project folder, a zip, or videos with their transcripts dropped on it,
  each ending where its menu act ends. A file dropped anywhere else no
  longer takes the window away from the app.
- **Paste notes.** Steps has *Paste notes...* beside *+ Add step*: paste
  the notes you wrote in Notepad or Teams and each line becomes a step (the
  text after its first colon its description, an indented line added to
  the one above, list marks and numbers dropped), and a line that starts
  with a document field's name (*Trigger:*, *Volume:*) goes to that field,
  after what it holds. The line under the box says what it will make; it
  is one undoable edit.
- **The transcript beside the video.** The Timeline's side panel has a
  third tab, *Transcript*: what was said, every transcript of the project on
  the one clock, with its time and the speaker where it changes. A search
  finds a word as you type, marks it and counts it ("3 of 340"); with
  several speakers a select reads one of them. The sentence the video is at
  is marked and stays in view while the video plays, unless the pointer is
  on the list or the search holds text. A click on a sentence goes to that
  moment (a paused video stays paused). After each sentence, *Add step
  here* adds a step that starts where it is said (as + Step does there), and
  *Copy to...* opens one menu, *Copy this sentence to*: the description of
  the selected step, then the document's fields. The two show on the row
  under the pointer, the focused row and the row the video is at, and keep
  their place on the others. A transcript not placed yet says so with *Sync...*; read only, the
  list is read and searched, and nothing is added. A ninety minute call is
  thousands of sentences: the list is built once and filtered by hiding.
- **Not part of the process.** In a project made from a video or from
  nothing, a stretch selected on the Timeline (a Shift-drag) is marked as
  not part of the process in one click: a detour of the call. Its
  selection shows only its duration. It is the same mark as a
  recording's *Leave out of the analysis* (`excluded_ranges`): hatched, its
  legend in the project's words, *Include again* and Ctrl+Z its inverse.
  It asks nothing and analyzes nothing, and the steps marked in it stay:
  Steps, both maps and the PDD do not mention it (in a project without a
  recording no stretch cuts a transaction's trace).
- **Playing skips a stretch marked as not part of the process**, in both
  kinds of project (a recording's stretch left out of the analysis too),
  across the videos of the chain; a seek into one plays it, so it can still
  be watched. The Transcript tab lists one row in place of what was said in
  it, with *Include again*, and the step panel's and the step editor's
  *Said* lists leave it out.
- **Selecting a stretch no longer starts the video.** The click that ends
  a Shift-drag on the Timeline used to seek there and play.
- **"<step>" starts here.** Beside *+ Step*, the button names the step
  whose start it sets to the moment the video shows: the selected step
  when its time is the analyst's to set, else the first step without a
  time. The step runs until
  the next one starts (the rules of a step marked there), keeps its place
  in the process, and takes the video's frame when it has no picture; then
  the next step without a time is selected, so steps written first each get
  their moment in two acts. The Timeline's right-click menu offers the same
  at the moment clicked. One undoable edit.
- **The timeline's lanes in the order of the work, the steps readable.**
  From the top, each lane only when the project has such things: the time,
  *Transactions*, *Steps*, *Systems* (a recording), *Transcript*, *Videos*,
  *Screenshots*, *Notes* and *Idle* (a recording; a lane of its own now, off
  until chosen in *Lanes*). The Steps lane is the tall one: a step's band
  shows its name inside it on up to two lines in 12 px text, cut with an
  ellipsis; a band too narrow for its name shows the step's number, the one
  the Steps tab beside the video shows, and its tooltip the name. No band
  covers another: a band is drawn at most up to the start of the next step
  of its transaction, and at least 2 px wide; one left too narrow for its
  number is named by its tooltip and listed beside the video. A draft is
  drawn dashed; the open step still fades out, a placed step keeps its mark
  and the selected one its outline. *Lanes* lists the lanes in the same
  order, *Systems* among them. The Steps lane's name says what a click does
  now: "Steps: each step in the order of the process; click one to open it
  beside the video."
- **One bar of the whole length under the lanes.** It always shows the whole
  timeline, and the part the lanes show is a box on it: drag the box to move
  along the timeline, click elsewhere on the bar to go there, or, with the
  bar focused, press Left or Right. At *Show all* the box fills the bar. The
  playhead shows on it as a thin line. A screen reader reads it as a
  scrollbar of the lanes, with how far along the view is.
- **A double-click on a transaction shows only that transaction.** The
  lanes zoom to its span with a little room on each side, and the clock
  stays where it is; *Show all* shows the whole length again. A single click
  still goes to its start, and its tooltip says "Double-click: show only
  this transaction."
- **A right-click on a video's band marks there too.** Its menu starts
  with what a right-click on the timeline offers at that moment (*Add a
  step here*, *Start a transaction here*, *Add note here...*), then the
  video's own entries under its name.
- **The screen of a recording without a video.** Where the video would be,
  a recording without one shows the screenshot taken last at or before the
  clock's moment, as large as the pane allows, with one line under it
  ("Screenshot at 1:42 · Enter the order"); before the first screenshot the
  line says so, and a screenshot whose file is not in the project names the
  file in its place. It follows the clock: a click on the timeline, a typed
  time, a mark of a lane, and Left and Right (5 seconds, with Shift 10), as
  they move a video. A click on the picture opens it in the gallery. The line
  above it, "No video in this project.", keeps *Attach video...*; a
  recording with no screenshot keeps the slim band.
- **The speed.** The timeline's row has *1x*, *1.5x* and *2x* after the
  clock while a video is attached ("How fast the video plays"). It holds
  across the videos of a chain and the projects opened in the window, and is
  kept on this computer.
- **What is said, under the video.** While a transcript is placed on the
  clock, a band under the video (or the screen of a recording without one)
  shows the sentence being said: the speaker in bold, then the sentence, on
  at most two lines, the whole of it in the tooltip; empty between two
  sentences, keeping its height, and never over the picture. It is the
  Transcript tab's sentence at this moment, so a stretch set aside shows
  nothing. A click opens the Transcript tab at that sentence.
- **I and O select a stretch.** On the Timeline, I puts the start of a
  stretch at the clock's moment and O its end, also while the video plays:
  with both, the stretch is selected as a Shift-drag selects it, the row
  showing its times and its acts; O first, or O before the start, gives the
  pair the right way round. Until O comes the start is a thin line on the
  timeline, "Start of a stretch", and the row says "Stretch starts at 0:40.";
  Escape clears it. Neither key asks anything or takes the focus. I and O at
  one moment say "A stretch needs a start and an end at two moments."
- **Each lane is one Tab stop.** After the row's controls, Tab stops once on
  each lane with marks among Transactions, Steps, Transcript, Screenshots and
  Notes, on the mark at the clock's moment (else the next one, else the
  first). Left and Right go to the previous and the next mark, Home and End
  to the first and the last, the timeline scrolling to show it; Enter does
  what a click on the mark does. The mark shows the focus ring, offset from
  it; a screen reader reads each lane as a list named after the lane and
  each mark by its tooltip's first line. A press of the mouse on a mark does
  not take the focus, so the arrow keys go on moving the video.
- **Screenshots close together are one mark.** On the Screenshots lane,
  screenshots whose marks would cover each other at this zoom are one mark
  with their count, "3 screenshots from 1:40 to 1:46. Click: show the first
  in the Screenshots tab."; zooming in splits it as the room allows.
- **Make everything larger.** Ctrl+Plus (or Ctrl+=), Ctrl+Minus and Ctrl+0
  make the whole app larger, smaller, or the usual size, in steps from 80% to
  200%, and Ctrl with the mouse wheel does the same (over a map it still
  zooms the map). The message area says "Zoom 125%."; every window shows the
  same size, and this computer keeps it for the next start. The Timeline's
  own +, - and 0 still zoom the timeline. At 125% on a 1366x768 screen every
  level holds; at 150% a level may scroll; at 175% and 200% the Timeline's
  row and the top bar take two lines, and every menu taller than the window
  scrolls. The video and the pane beside it stay side by side on a narrow
  window, where they used to stack over the timeline.
- **A refused entry says why beside its field.** When a typed time is
  refused (a step's start or end, a transaction's *Starts at* or *Ends at*,
  the clock in the Timeline's row) or a step's name is emptied, the reason
  stays under the field, in red, until you change the field; the field's
  edge turns red and a screen reader reads the reason with it. The message
  says it too, as before.

### Changed

- **The Timeline's dividers move both ways** (the owner: "a divider in
  between that is adjustable"). The line between the video and the pane
  follows a drag to either side, from the video's least width (240 px, or
  what the video's buttons need) to the pane's least width (360 px): the
  video is no longer held under 58% of the stage or its height at 16:9,
  which made a drag to the right do nothing. The picture stays whole in
  its pane, black bars where it is narrower. Both dividers, the other
  between the stage and the timeline, are a line with a grip seen at rest,
  are reached with Tab (Left and Right, or Up and Down, move them 24 px,
  96 px with Shift; Home and End go to the ends), and a double-click or
  Enter puts the usual size back. The sizes are remembered on this
  computer, and a size kept from a wider window gives way to a narrower
  one.
- **The hand on the process map means "stays with a person"** (contract
  C25). A step added by hand with no system is a plain box now, not a box
  with the hand: the hand and the gear say what the automation does.
- **Steps gives the step editor its room on a laptop** (plan D2). On Steps
  the step panel keeps only what the editor beside it lacks: the step's
  video and one row per time the step happened, each with its transaction,
  its moment and its play; the name, system, description, flow, waste,
  screenshots, what was said and notes are the editor's alone. From 1440
  px of window width it stands beside the editor as before; on a narrower
  window (the app's zoom counts) selecting a step opens nothing, and
  *Play* on the step's line opens the panel in place of the list of
  transactions and plays the step there, so the editor keeps its width
  (at 1366 px, 719 px where it had 524). Escape or the panel's close gives
  the list back and the focus to *Play*. A frame of the video for a step
  without a time opens the panel at the video's start. On the Map the
  panel is as it was.
- **The project's video and transcript are rows of their own** (plan D5).
  Under the Overview's project line, *Video* and *Transcript* each read
  what they hold (the file's name, "2 videos", "No transcript") and carry
  their acts named with their object: *Attach a video...*, *Replace the
  video...*, *Remove the video*, *Add a video...*, and the same for the
  transcript, so two *Replace* never stand side by side. A project opened
  read only shows the rows without acts.
- **Nothing a person reads is under 12 px.** About 125 places that were 8
  to 11 px are 12 px now, the Timeline's lane names, ticks, transaction and
  system labels among them; only the clock times in the mono face (a step's
  start on its row, a sentence's time, a screenshot's stamp) stay at 11 px.
  The lane names keep their column, a little less spaced.
- **Short tooltips.** Every tooltip is one short sentence on what the click
  does; what the long ones also said is in Help (the Map section now says
  how to move and zoom a map, that the PDD does not print how the
  transactions ran, and what *Copy again* gives) or already was.
- **One name per act.** *Play* plays a step everywhere (the Steps row menu
  read *Watch*, the Timeline's step menu *Select + seek here*); *Open in
  Steps* goes to Steps (the Timeline's menu read *Jump to step here*); a
  transaction's band offers *Go to its start* and *Go to its end*; the Raw
  events table's acts are *Go there* and *Add step here*; the Transcript
  lane's links say what they act on: *Sync the transcript...*, *Replace the
  transcript...*, *Remove the transcript*. Help's *Markers* section is
  *Transactions*, "Transactions on the timeline", and Help, the guide and the
  messages no longer say "playhead" or "marker". The video pane's header
  reads SCREEN while it shows a recording's screenshots.
- **Three more dialogs keep the keyboard.** *Apps outside the process*, the
  screenshot gallery and the map editor keep Tab and Shift+Tab inside and
  give the focus back to the button that opened them; Escape closes the
  apps dialog too.
- **The map's warning reads.** When a map file has parts that cannot be
  read, the note over the map is dark text on the card with an amber edge
  (it was light text on amber, 3.30:1), and says so in plain words.

- **The gallery owns its keys.** While the screenshot gallery is open,
  Space, Left, Right and Escape are its own: the video and the clock do not
  move behind it.
- **Raw events open on a small window.** With *Raw events* open at 1024x720
  the video and the pane above the timeline give way to the room left;
  before, they lay over the timeline's row.
- **A change to the transactions reaches the steps by itself, in a
  recording too.** A transaction added, moved, ended, renamed or deleted (on
  the timeline, in its header's *Starts at*, *Ends at*, *Rename* and *Delete
  transaction*, or in Steps) is in Steps a moment later, as in a project
  made from a video: nothing to click, no question, and no message when it
  worked; the top bar says "Updating steps and map..." with *Cancel* while
  it runs. It waits while a dialog is open, a key was pressed a moment ago,
  a side is dragged or a field holds unsaved typing, and a change made while
  it runs is saved and runs it again. The confirmed, edited, added and hidden
  steps are kept, a renamed or described draft too; the step selected, the
  step opened beside the video, the transaction open in Steps, the pane's
  scroll and the clock stay where they were. After *Cancel*, or a run that
  failed, the top bar offers *Update the steps* ("Updates the transactions,
  their steps and the map with your latest changes."), and the next change
  runs it again too. Ctrl+Z of a change that was already applied runs it
  again by itself. The messages say what happened: "Transaction started at
  0:05.", "Transaction ended at 0:20.", "Transaction made from 0:40 to 1:10
  · 30s.", "Transaction moved to 0:05." ("Transaction's end moved to
  0:20."), "Transaction renamed.", "Transaction deleted."; the Overview's
  fixes read *Remove this end* and "Done", and its lines "has no end" and
  "The end at 0:30 has no open transaction to end."
- **A stretch set aside is hatched through every lane.** A stretch left out
  of the analysis, or not part of the process, is hatched from the
  Transactions lane down to the last lane, under the marks, so a step or a
  transaction on it still opens on a click; its label shows once, at its
  top. A click on the hatch where no mark is still offers *Include again*
  and *Go to its start*. An app outside the process stays hatched on the
  Systems lane only.
- **What the marks mean is in the Lanes menu.** The legend row under the
  timeline is gone: *Lanes* lists, under the lanes, "What the marks mean"
  for the marks drawn now (the systems' colours, idle, "dashed: a draft
  step", a screenshot, a note, the hatch in the project's words, a step
  placed elsewhere in the process). The menu opens
  above its button when there is more room there and stays inside the
  window. Its button's tooltip: "Choose which lanes the timeline shows, and
  see what its marks mean".
- **Gone from the Timeline:** the *Transaction:* select (it dimmed the other
  transactions and changed nothing else; a double-click on a transaction
  shows only it), the minimap above the lanes and the lanes' own horizontal
  scrollbar (the bar of the whole length takes their place; the wheel,
  Shift and the wheel, and the zoom keys still move and zoom), and the
  legend row. A marker change not applied yet that the Transactions lane
  cannot show is drawn through the lanes, and a project made from a video
  no longer has an empty low row where a recording has its Systems.

- **One set of play controls.** The playback bar at the foot of the window
  is gone (it showed on every level and played a video only the Timeline
  shows), and the video has no controls of its own: the timeline's row
  plays it, a click on the video plays or pauses it, and Space, Left and
  Right (Shift for 10 s) work as before. The video's corner no longer shows
  the video's own time (the row's clock says the moment, on the one clock);
  it says "loading…" while a video loads. While a video is synced, its own
  controls show for the first click. Old labels changed: *+ Step* is *Add
  step*, *Insert transaction from selection* is *Make it a transaction*,
  *Reset zoom* is *Show all*, and *Lanes* lost its arrow. The Raw events
  drawer is one line under the timeline; opened, its table shows above
  that line.

- **The Overview's transcript list is never empty** in a project with one
  unmarked transaction: it lists everything that was said, and says so.

- **A Checklist that fits the project.** A project made from a video or
  from nothing is no longer asked to confirm a reference transaction it
  never drafted: its acts are *Add the steps* (its button marks them on the
  Timeline when there is a video, else in Steps), *Write the steps* (a name
  of its own and a description for each step; the line says how many are
  left, and its button opens Steps on the first of them), *Review the other
  transactions* only when it has two or more, *Write the document* and
  *Hand off*. A recording keeps *Mark the transactions*, *Confirm the
  reference transaction* and *Review the other transactions*, but nothing
  to confirm is nothing owed (a reference transaction with no drafted step
  is ticked without a click), and only the transactions that differ from
  the reference transaction are asked to be opened.
- **Confirm only where there is something to confirm.** In Steps, a
  reference transaction with no drafted step shows no *Confirm
  transaction* and no draft status, and Ctrl+Enter does nothing there.
- **A project made from a video opens on the Timeline**, where its steps
  are marked.
- **Hand off is the last act.** The Checklist ends with *Hand off*
  (*Export the PDD* left it; the PDD alone stays in the Export menu): once
  every act before it is done its one button is *Hand off...*, and after a
  hand-off the line reads "Version N was handed off on <date>. Hand off
  again after a change."
- **The Export menu names the deliverable first**: *For the developers and
  the archive* (*Hand off...*), *For another analyst* (*Whole project
  (.zip)*), *Single files* (the PDD, the Technical details, the map as an
  image and as BPMN).
- **One zip a reader can use without the viewer.** A hand-off zip now
  carries, beside the PDD and the Technical details, the process map as a
  picture (`<project> v<N> map.svg`) and as BPMN 2.0 (`<project> v<N>
  map.bpmn`), and *Start here.txt*, which says what each file is and how to
  open the zip read only in the viewer. Its project folder leaves out the
  working file's backups and the analysis log. *Whole project (.zip)* is
  unchanged: the whole folder. A hand-off zip made before opens read only
  as before.
- **A PDD without recorder wording** for a project made from a video or from nothing: Document control leaves out *Recorded by* and *Transactions recorded* where there is nothing to say, section 3.2 and section 4 no longer speak of one unmarked transaction (section 4 reads *Rules and exceptions*), and section 5 lists each system with the steps done in it instead of *Information entered: none*.
- **No empty Technical details.** Where nothing was recorded the workbook is not written, and a hand-off zip goes out without it.
- **What a reader will miss, before the hand-off.** *Hand off...* lists what the PDD of the version leaves out ("A reader of version 2 will miss:"): the reference transaction's steps that are still drafts, have no name of their own, no description, no picture or no system, decisions that do not say when, empty document fields and an As-Is map made before the steps changed. Each line is a link that cancels the hand-off and opens the place where it is fixed; the button then reads *Hand off anyway*, so nothing is blocked. Once every act before the hand-off is done, or after a version was handed off, the same list opens from one line under the Checklist ("A reader of the next version will miss 3 things").
- **Name and describe a step where the video is.** On the Timeline and the
  Map the step panel's head is the step's name, its system and its
  description as fields, saved as the editor saves them (a rename names the
  same drafted step in the other transactions, the library's activities are
  offered, Ctrl+Z takes it back). Enter or Escape in the name leaves it, so
  S and Space answer again. On Steps the editor beside it stays the place to
  write, and the panel's head stays as it was.
- **A step marked on the Timeline opens in the step panel.** After S,
  *+ Step* or *Add a step here*, the panel shows the new step. With the
  video paused the cursor is in its name, its text selected, so typing names
  it; while the video plays nothing takes the focus, so the next S marks
  the next step. A new step marked inside the step before it no longer
  takes that step's description.
- **A step marked on a video takes its picture by itself.** The frame of
  the video at that moment is the step's screenshot, in the same edit as
  the step: one Ctrl+Z takes both away, the file too. Where the frame
  cannot be read the step is added without one. A step a video covers that
  shows no screenshot offers *Use the video at m:ss* in the editor and in
  the panel: one click takes that frame. A step deleted takes its added
  screenshots with it, and a step merged into another hands them over.
- **No Reference badge on a lone transaction.** A project of one
  transaction has nothing it is the reference among, so Steps leaves the
  badge out there.
- **Every label readable, in both themes.** The light theme's filled buttons and the level shown are a darker amber now (`--accent-fill`, the colour of the links), so their label reads at 5.25:1 instead of 3.34:1; the amber stays on borders, marks and icons. No text is drawn in the faintest grey any more (*Transaction:*, the count of *Edited maps*, *No edited maps yet.*, the playback bar's key hint, the menus' headings): muted text is the muted grey, and the darker grey where it sits on a fill (a selected row's time, a key hint). Every text field, text area and list has a visible edge.
- **One focus mark.** Every control the keyboard reaches shows the same 2 px slate ring; a text field shows it while you type in it. Link acts (*Replace*, *Remove*, *Only when...*) take a click across 24 px of height, with no row moved.
- **Dialogs keep the keyboard.** The prompts (*+ Add step*, *Hand off...*), the confirmations, *Place after a step...*, Help and the library builder are announced as dialogs; Tab and Shift+Tab stay inside them, and closing one gives the focus back to the button that opened it. Help takes the focus when it opens, on its section shown.
- **Messages are announced and an error stays while you read it.** The message line at the bottom is read out by a screen reader (an error at once). An error stays until you dismiss it (its cross, or Escape), a newer message replaces it, or you click or press a key elsewhere once it has been up 3.5 s; other messages keep their timing. A message never blocks a click on the page under it.
- **Names and state.** The glyph buttons say what they do (*Help*, *Close*, *Zoom in*, *Switch to the dark theme*), the New, Open, Export and Lanes buttons say whether their menu is open, the level shown is marked as the current page, and every page of the viewer and the capture app says it is in English. The recording bar tells a screen reader its state and transaction when they change (never its clock each second), and its problem line is an alert; the capture windows' text fields have a visible edge.

### Removed

- ***Apply N marker changes*** in the top bar, its question ("Update the
  drafts of the changed transactions?"), and *Apply marker changes* with
  "Not applied yet" (or "Updates in a moment") beside a transaction's
  *Starts at* and *Ends at*: a change applies by itself.
- **The dashed band and the "(pending)" line of a change not applied yet**
  on the timeline, the dashed time field in Steps, and the Lanes menu's
  entry "a change not applied yet": a transaction is drawn as it is.

## [2.0.6] (2026-11-04): several videos on one timeline

### Added

- **Several videos on one timeline** (the owner: "10th minute on the
  timeline is 10th minute on the timeline, regardless if there are 1 or 7
  videos"). *Add video* (the Overview's project line, *Add another* once one
  is there; the Timeline's new Videos lane) takes one or more files. In a
  project made from videos they run back to back, as in a video editor: a
  video added goes after the last one. In a recording each video is placed
  with its own sync (two clicks).
- **The Videos lane**: one band per video, named after its file, where it
  is on the timeline. Drag a side to trim it, or right-click it: *Trim the
  start here*, *Trim the end here*, *Give its start back*, *Give its end
  back*, *Sync video...* (in a recording), *Replace video...*, *Remove
  video*, *Add a video...*. Each is one change Ctrl+Z takes back.
- **What is marked moves with its video**: in a project made from videos, a
  trim, a replace or a remove of one video moves the videos after it and
  everything marked on them (transactions, steps, notes and screenshots at
  a moment), so a step stays on what it shows. A trim that would cut a mark
  away is refused and says what is there. Removing a video takes what was
  marked on it, after a question that names it.
- **A transcript per video**: a project with several videos asks which
  video a transcript is of (*Add another* on the project line for the
  next). Its sentences are placed from that video's start and move with
  it; each transcript has its own row on the Timeline with *Sync...*,
  *Replace...* and *Remove*.

### Changed

- **The player plays the video that shows the playhead**: a click on the
  timeline, a band or a step shows that moment in the video that covers it,
  and playing on past a video's end goes on with the next one. The
  playback bar, its skips and the arrow keys move across the videos; the
  step panel plays each step from its own video.
- **The PDD places each step on the timeline's clock** ("Transaction 1 at
  0:19"), never at a time in a video, and in a project made from videos
  "at 1:00" outside the transactions; Document control says how many
  videos there are.
- **A project of 2.0.5 opens as it was**: its one video is the first of the
  chain; the first change to the videos saves them in the new form.

## [2.0.5] (2026-11-04): a step's place in the process, apart from its time

### Changed

- **A step's place in the process is its own** (the owner's report: late
  in a video the SME corrects a step shown earlier, or adds a condition to
  it; marked there, the step came after every step in between). Right-click
  its band on the Timeline, or its row in Steps, and choose *Place after a
  step...*: it comes right after the step you pick, in that step's
  transaction, while its band, its video and its time stay where it was
  said. The map, the differences between transactions, the PDD and the
  Technical details follow the same order. Its row and its Flow line read
  *Placed*, its band carries a mark the legend explains, and *Back to its
  time* puts it where its time puts it again.
- **Alt+Up and Alt+Down move any step** (and *Move up* and *Move down* in
  its menu): a step with a time moves in the process only, its band staying
  where it is on the Timeline; moved back to where its time puts it, it is
  no longer placed. Two steps without a time swap places as before.
- **+ Add step comes right after the selected step**, as Help says, also
  when that step has a time (it came after every step with a time).
- **What was placed keeps its place**: a step hidden, deleted, merged or
  grouped leaves the steps placed after it where they were, and a step
  split keeps its two parts together. A merge or a group that would join a
  placed step and steps apart from it on the Timeline is refused, with the
  reason: a step has one stretch of time.
- **What was said under a step** is bounded by the step before it on the
  Timeline, and the live map's lines weigh a placed step by its own time.
- **Help: *Put a step where it belongs in the process***, a new everyday
  task (and in the How-to guide), and *Placed* in the glossary.

## [2.0.4] (2026-09-28): steps marked one after another

### Changed

- **Steps are marked one after another** (the owner's reports: "the
  duration is endless", then "you always add steps sequentially"). Each
  step added ends the step before it, and *End the transaction here*, or
  the next transaction's start, ends its last step. Until then the newest
  step is open: it reads *open* in Steps and in the step panel, with no
  length, and fades out on the Timeline instead of running solid to the end
  of the video. A transaction with no end reads *Ends at: open*.
- **Every right-click on the Timeline marks there**, on a step's or a
  transaction's band too: *Add a step here* and *End the transaction here*
  are on the band that runs on over where the next mark goes, with the
  band's own items (*Open in Steps*, *Delete step*, *Jump to start*) under
  its name.
- **What was marked together moves together**: a transaction's start or
  end typed or dragged takes the step that starts or ends there along, so a
  corrected start never leaves the first step outside the transaction.
  Taking an End out lets its last step run on again. A step you delete
  gives its time back to the step before it, and a step's end emptied in
  Steps goes back to where the next step starts or its transaction ends.
- **Help: *Mark a video as you watch it***, a new everyday task (and in the
  How-to guide).
- **A project made from a video or from nothing applies its marker changes
  itself**, a moment after the change: a transaction added, moved or ended
  is in Steps with both of its times without clicking *Apply marker
  changes*. It waits while a dialog is open or something is being typed,
  and a change saved meanwhile goes first. A recording keeps *Apply marker
  changes*, because it drafts the recorder's steps again. An undo of a
  marker change there applies too.
- **The one unmarked transaction of a new project shows *Starts at* and
  *Ends at***: typing its start marks it; typing its end marks it from the
  start of the video. A step added without a time shows its end field
  beside its start (the end waits for the start).
- **A transaction that runs to the end gets an end handle on the
  Timeline**: dragging it adds its End.
- **The step selected stays selected** when the project comes back from an
  analysis.

## [2.0.3] (2026-09-28): transactions and steps moved and timed

### Changed

- **Transactions and steps move on the Timeline** (a process manager's
  report: a transaction started a few pixels after the step it was meant to
  hold, the step stayed outside it, and nothing could be moved). Drag the
  start or the end of a transaction's band, or of a step whose time is yours
  (a step added on a video's Timeline, or where nothing was recorded; a
  step back to back with it gives way). A step then belongs to the
  transaction its start is in; a transaction moved is drawn dashed where it
  now is until *Apply marker changes*, and a marker moved several times is
  one change to apply. A side dragged, and *Start a transaction here*, *End
  the transaction here* and *Add a step here*, snap to a step's start or the
  playhead a few pixels away (a step's side to the other sides too). The
  time shows while dragging; Esc puts the side back, Ctrl+Z undoes a move.
- **Times typed in Steps**: an open transaction shows *Starts at* and
  *Ends at* under its name, and a step whose time is yours shows its start
  and end on the line under its name (a step added without a time: *no time
  yet: starts at*). Type a time the way the timeline shows it (*0:09*,
  *1:05.5*; the fields show tenths where a time has them, so two moments a
  second apart never read the same) and press Enter; Up and Down change it
  by a second. A transaction's change shows dashed, with *Apply marker
  changes* right beside it; an empty *Ends at* takes its End out. A time
  that cannot be taken is refused with the range it can take.
- **Apply marker changes asks first only while a step is a draft**: in a
  project made from a video or from nothing there is none, so it applies at
  once.
- **Outside the transactions** says how to bring a step in.
- **The System field's list arrow** sits beside the system's name, never
  over it, and Enter saves the system and leaves the field.

## [2.0.2] (2026-09-28): the start page and the step panel's flow line

### Changed

- **The page shown while no project is open** offers *New project from a
  video* and *New empty project* beside *Open project* and *Open a
  hand-off*; the demo project is a link under them.
- **The step panel's flow line wraps** in a narrow panel instead of ending
  in an ellipsis.

## [2.0.1] (2026-09-28): the PDD for its readers, and maps a PM can keep

The PDD is the process written down for the SME, who confirms it, and for
whoever asks about the process being automated; it is archived per
version. The developers work from the project (a read-only hand-off) and
the Technical details, so the PDD no longer prints what they read there.
The map names the system of each step in words a process manager can
change, and the SME's app loses its setup.

### Changed

- **The PDD's section 5 is *Systems and information used***: each system
  the process uses, with the information entered in it, named for the
  reader (a workbook's cells read as one entry, "cells A2 to F5 of
  orders.xlsx"); no values. It replaces the Data table (every field with
  its screen, step, example value and re-keyed mark), which the Technical
  details keeps with every value.
- **Section 6 is *Volume and effort***, as you write it: a new document
  field on the Overview ("How often is the process done, and how long does
  one take?"). The PDD prints no recorded time any more, in section 6 or
  under a step: the recording is a walkthrough with explanations, not the
  usual handling time. The app still shows the recorded times.
- **The re-keyed data** (a value typed again in another system) is said
  under section 7, *Improvement and automation scope*.
- **Section 4.1 reads in plain sentences**, for example "Check the stock is
  done after Save order, in 1 of 3 transactions." and "Send the
  confirmation is not done here (it is done in 2 of 3 transactions)."
- **The Overview opens at once.** Its *Observations* (a copy of the PDD's
  sections 5 and 6) are gone, and with them the analysis that ran as the
  Overview opened after a change of the steps and stopped when you typed.
- **The map names each step's system above its box**, as a short text
  annotation you change by typing in the map editor or any BPMN tool; a
  map whose steps are all done in one system says it once ("System: SAP").
  The colours and their legend are gone: no editor could change a colour,
  so an edited map kept the wrong ones. A step's notes now sit under its
  box.
- **A decision's paths part at the diamond**: each leaves from its own
  corner, so a skipped step no longer hides under the main line. A
  sub-process box is a little taller, so the + marker never covers its
  name.
- **A web application is named by its site**: a browser window on a site
  no rule knows reads its site ("Order Desk"), not "Google Chrome", on the
  Timeline as in the steps, the map and the PDD; the Timeline says "Excel"
  where it said "Microsoft Excel".
- **A step you name like a step of the reference transaction is that
  step** in the differences and in the PDD, whatever the recorder drafted.
- **A sheet's cells are one sub-step**: *Open as a sub-process* gives
  "Fill in columns A to F" for the cells filled one after another, and says
  so when a step has only one recorded action to open.
- **The request is written in the viewer**: an optional *Request* field in
  the Document, printed in the PDD's Document control and on the project
  line.
- **One way to say a time**: a Steps row shows when its step starts (0:06),
  and every duration reads one way, in the app and in the map's BPMN:
  "under 1s", "42s", "2m 17s" or "1h 04m" (never "0s", "28.9s" or "414ms",
  and never "2:17", which reads as a moment). How the transactions ran fits
  again when the step panel opens beside it.
- **The PDD says who still has to confirm**: "The analyst has not yet
  confirmed 2 of these 4 steps."
- **The demo project ships with the app**: *Open*, *Open the demo
  project* (also on the page shown while no project is open) opens a fresh
  copy of a finished project in *Documents\PDT demo*: four orders recorded
  live in the Order Desk web app and an Excel tracking sheet, with its
  video and transcript synced, names from an activity library, the flow
  (Only when, a loop, an early end, a choice), a sub-process, a step added
  by hand, waste, notes, attachments, an app outside the process, a stretch
  left out, the document, an As-Is and a To-Be map and a hand-off.
- **Steps on the Timeline**: right-click the timeline, *Add a step here*;
  right-click a step's band to delete it (a recorded step is hidden), as
  in Steps. A step clicked on the Timeline is the one Steps opens on.
- **Split where you choose**: the step pane lists a step's recorded
  actions, each with its scissors; Split no longer cuts at the midpoint.
  After *Merge with next* the place where the two steps met is marked, so
  moving the line between two steps is a merge and one click.
- **Decision** replaces *Go to*: after a step, the process goes back to an
  earlier step, ahead to a later one, to a step another transaction did
  (the other side of a choice) or to the end, the targets grouped that way.
  The Flow line names the next step ("Then: Save order"), and *Only when*
  says it is for a step some transactions skip.
- **An As-Is map drawn in colours** (before the system labels) says so on
  the Map and in the Checklist, with *Copy again*.
- **Easier to read on a small screen**: the pane and section titles and a
  transaction's step count and time are a size larger, and *Dissolve
  sub-process* is a button in the breadcrumb, as in the Steps toolbar.
- **The Steps page is an editor** (the owner's review): the toolbar acts
  on the selected step (*Split...*, *Merge with next*, *Hide step*, the
  sub-process verbs, *Delete*), or on the ticked steps. The selected step
  reads in one column, in the order of the work: its name as the title
  with its state and library code, one line of facts (the system, which
  you change there, the screen, where, how long, in how many transactions,
  *Play* and *Show on timeline*), what you write (Description with what was
  said under it, Flow, Waste), the screenshots, *Recorded* (the actions
  with the control each acted on, and the scissors), open or closed as you
  last left it, and what is attached. The step panel stays beside it. The
  fact line, the fields typed, the colour code of the actions and the
  dividers are gone, and a transaction's differences are marked on its
  rows (*Extra*, *Again*, *Moved*, a greyed *Skipped* row) in place of a
  list above them.
- **Accessibility**: link text and field edges pass WCAG AA contrast in the
  light theme, fields show a clear focus ring, the scissors and play
  buttons have names, and a row's tick works from the keyboard.
- **What was said shows under one step**: a sentence belongs to the step
  during which it starts, or to the next one within 10 seconds, never
  past the step before, in the step pane and the step panel.
- **The attachments go with the PDD**: the PDD of a project with attached
  files exports as one zip, the PDD and an *Attachments* folder, and each
  attachment's name in the PDD opens its file. A hand-off's PDD links to
  the files in the project folder beside it in the zip.

### Removed

- `analysis.json` `pdd_data`, `pdd_time` and `steps_signature` (format 5:
  a project analyzed by 2.0.0 is analyzed again once as it opens), and the
  goldens that pinned them (`shared/pdd-rows-golden.json`,
  `shared/steps-signature-golden.json`).
- **The capture app's Recording setup and its named transactions**: the
  SME's app keeps Start, Next transaction, Pause, Stop, the summary and the
  zip; Settings and Profile stay for the analyst or IT. A recording setup
  saved by 2.0.0 is still read.

## [2.0.0] (2026-09-26): the BA-helper refocus

The app is refocused
from a product for a buyer into a tool for the owner's own work as a
process manager / business analyst: an SME records a process a few times,
one transaction each time, the analyst confirms the recorder's drafted
steps for one transaction, and the app gives a process map and a
tool-neutral PDD. The complete prior product is preserved on the
`product-edition` branch, tagged `product-edition-v1.5.0`, not deleted.
Full rationale and the complete list of what changed:
[ADR-0029](docs/adr/0029-ba-helper-refocus.md) and the plan's
implementation notes
([BA-HELPER-PLAN-2026-09-22.md](docs/To-Do/BA-HELPER-PLAN-2026-09-22.md)).

### Added

- **The recorder drafts a recording's steps**, one step per screen visit
  ending at its commit action (a button, menu command, or link); the
  analyst confirms one transaction instead of authoring every step by
  hand, then reviews how the other transactions differ.
- **Names travel with the project**: naming a drafted step names the same
  drafted steps (the same control and screen) in the project's other
  transactions at once, and every later analysis of the project drafts
  them with that name, on any machine.
- **The activity library** (contract C21): the app ships one library of
  named activities per system (`library/activities.json`), and a project
  keeps the one it started with (`library.json`, copied by its first
  analysis). The step pane's name offers the activities of the step's
  system: a pick sets the name, the system and, when the step has none, the
  description, and the fact line shows the activity's code; any name can
  still be typed. Help, *Build the library...*, the owner's tool, reads
  projects and hand-off zips, lists their named steps by system (the same
  screens named differently side by side), and saves the ticked ones as a
  new version of the library.
- **Differences between transactions**: every transaction other than the
  reference transaction lists how it differs from it (a skipped step, an
  extra step, a different order, a step done more often), or says it has
  none; a step that happens only under a condition and was not done is said
  apart, as no difference. The PDD's differences section uses the same rule.
- **Fixes carry across transactions**: merging drafted steps in the
  reference transaction repeats the merge on the same drafts in every
  other transaction (one undo), and a draft hidden in the reference
  transaction can be hidden in all of them at once.
- **Undo confirm**, the inverse of Confirm transaction: the confirmed steps
  become drafts again.
- **Step flow**: a step can say when it happens and where the process goes
  after it. *Only when...* in the step pane gives the step a condition: the
  map draws a decision, with the condition on the way into the step and an
  "otherwise" path around it. *Go to...* adds a link: after the step, when
  its condition holds, the process goes back to an earlier step, on to a
  later one, or ends. The dropdown lists the transaction's steps in order
  and "End the process", and each link reads where it goes ("Goes back to
  step 2, Check the customer, when the details are missing"). A link to a
  step that is hidden or deleted is dropped and the toast says so; Ctrl+Z
  brings both back. The map shows the decisions, loops and early ends, and
  the PDD prints the flow under each step.
- **The Overview is the home**: a Checklist of the five acts (mark the
  transactions, confirm the reference transaction, review the other
  transactions, write the document, export the PDD) ticks each one done
  (the export never: the app keeps no record of it), says in a tooltip what
  it means, and has one button for the next; it shrinks to one line once
  only the export is left. The project line says
  who recorded it, its transactions and the reference transaction's steps;
  Recent names a project by its document title.
- **Document fields**: the Overview's document panel edits the title,
  purpose, scope, trigger, result, key contacts, business rules,
  exceptions, improvement and automation scope, and notes. Each prints in
  its own place in the PDD, survives a re-export, and can be undone. The
  panel says who fills it ("You write these. The PDD prints them."), an
  empty field looks empty, and its heading names the fields still to
  write.
- **Meeting transcript**: attach a Teams `.vtt` or `.docx` transcript. Its
  sentences show on a Transcript lane on the Timeline, under "Said during
  this step" in the step pane, and beside the document fields; one sentence
  and one click on the timeline sync it (a synced video syncs it too). A
  sentence can be added to a step's description or, with "Add to", to a
  document field; one said before the recording started reads "0:28
  before". Nothing in the app interprets what was said.
- **Business system names**: the PDD and the step map name the system a
  step happened in (SAP, Excel, Outlook, and Salesforce for a Chrome window
  on Salesforce) from one shared rule list instead of an executable name
  like `EXCEL.EXE`. The viewer uses the same list: the timeline's bands and
  legend, the step pane, the Observations, the step panel, and the map,
  where each box names its system under the step's name. A system set by
  hand on a step wins.
- **The step panel**: a click on a map box (a task of the As-Is map too) or
  on a step band on the Timeline, or a step selected in Steps, opens one
  panel beside it: the step's system and description, its flow when one is
  set, "in N of M transactions, about 8s each", and every occurrence with
  its moment ("Transaction 1 · 0:39 into the recording · took 8s"), played
  in the panel's own small video, with its screenshots and what was said.
  Watch in the step pane
  plays the step there, beside the steps.
- **The video travels with the project folder**: attaching a video copies
  it into the folder and stores where it is relative to the folder, so
  whoever receives the folder has the video too. A video the folder names
  but no longer finds keeps its sync when it is attached again.
- **Projects without a recording**: the New menu starts a project from a
  video (the video is copied into a new folder and the Timeline runs on its
  length) or an empty one. Such a project is one transaction until the
  Timeline marks where each one starts (an empty project has a timeline
  once a video is attached, and its Steps list says so), and the map and
  the PDD work as for a recording.
- **Steps added by hand**: "+ Add step" adds a step without a time after
  the selected step (Alt+Up and Alt+Down move it); on the Timeline, "+ Step"
  adds one at the video's playhead. The step pane's System field says which
  system a step happens in.
- **Screenshots added by hand**: a frame of the video, a pasted image
  (Ctrl+V in the step pane) or an image file. "Use in PDD" picks the one
  screenshot the PDD prints under the step; "Remove" takes a recorded
  screenshot off the step (the recording keeps it) or deletes one you
  added. Ctrl+Z brings it back.
- **Attachments**: any file (an example email, an input spreadsheet, an
  SOP) attached to the project on the Overview, or to a step in the step
  pane, is copied into the project folder and opens from the app; the PDD
  lists the attachments, and a step's under that step.
- **Notes**: a note on a step (the step pane) or at a moment (right-click
  the Timeline, "Add note here"), shown in the step pane, the step panel
  and a Notes lane on the Timeline. The PDD leaves notes out, in its text
  and in its map pictures; the Map and Export's map image and BPMN file
  show a step's notes beside it.
- **Saved as you go**: every change saves itself to the project folder, and
  one quiet word in the top bar says so: *Saved* (pointing at it shows the
  time and the folder), *Saving...* while a long write lasts, or *Not
  saved* in the error colour, with what was not saved and why, until a
  later save succeeds. Edits in the map editor report the same way.
- **Whole project (.zip)**: Export makes one zip of the project folder,
  next to it, to hand the project to someone: the recording, the analyst's
  work, the video, the transcript, screenshots, attachments and edited
  maps. An earlier zip is never replaced (the next one is "Order call
  (2).zip"), and extracting it gives the folder back.
- **The recording bar**: a small strip replaces the capture app's Live
  Session window and hotkey overlay. It shows the transaction in progress
  and the elapsed time, with Next transaction, Pause and Stop, and a
  problem line only when clicks and typing are not being recorded. It
  takes no keyboard focus, stays out of screen captures and shared
  screens, and remembers its place.
- **One way to start**: the recording bar's button, the tray, the welcome
  and the transaction key all start the recording with Transaction 1; each
  later press starts the next transaction, ending the open one first.
  Stopping ends the last transaction by itself.
- **An end summary with a zip for the analyst**: after Stop, one screen
  says where the recording is saved and how many transactions it has,
  warns when no transaction was marked, and can make a zip of the recording
  next to its folder for the SME to send by hand (nothing is sent from the
  app).
- **A durable record of dropped events**: a write batch that could not be
  saved is now counted and recorded on the recording's timeline instead of
  only appearing in a local log file.
- **Sub-processes** (contract C19): a project holds one main map plus one
  map per sub-process, at any depth.
  - *Open as a sub-process* turns a step's recorded actions (each field
    typed, each click) into sub-steps, in every transaction.
  - *Group into a sub-process* gathers consecutive steps under a new step.
  - Sub-steps can also be added by hand. *Dissolve* undoes either.
  - Steps shows a breadcrumb and one block per visit, and the Map a picker
    of every map.
  - The As-Is copy shows each sub-process's own plane.
  - The step BPMN carries collapsed sub-processes, and the PDD prints a
    chapter per sub-process with its map and its steps (3.3 onwards).
- **A divider between the transactions and the selected step**: drag it to
  resize the Steps level's two panes; double-click resets it.
- **The step panel explains itself**: a line says how often the step
  happened and in which transactions. Each row reads "Transaction 1 · 0:39
  into the recording · took 8s". The Timeline has a header column with each
  lane's name and key.
- **The Map shows the map the PDD prints**:
  - It opens on the step map (or the chosen As-Is copy), drawn and linked like
    the As-Is view; *Show how the transactions ran* switches to the live map.
  - Opening the editor and leaving it without a change keeps no copy.
  - Ctrl+Z and Ctrl+Y undo and redo map edits inside the editor.
- **Every feature complete or cut** (the feature audit of 2026-09-24):
  - A stretch left out of the analysis shows on the Timeline, hatched, and a
    click offers *Include again*; Ctrl+Z undoes either. A transaction with a
    stretch left out says so, in Steps and in the PDD, and the steps done in
    it are not read as skipped; its time is not counted.
  - *Remove video*, on the project line and beside Sync video, takes the
    video out with its copy in the folder; *Replace* takes out the copy it
    replaces. Attach, Replace, Sync and Remove are each undoable.
  - Deleting an edited map deletes its file, and removing the transcript
    deletes its original too; Ctrl+Z brings the files back.
  - *Reset layout*, beside fit on how the transactions ran, puts boxes
    moved by hand back.
  - *Restore the newest backup*, on the banner of an unreadable
    annotations file, puts back the newest readable backup and keeps the
    unreadable file beside it.
  - The Overview's Data and Applications and time are as new as the steps:
    opened after a change of the steps, it measures them again, saying
    "From the last analysis; refreshing" meanwhile. Typing in the document
    stops that; the next opening measures them.
- **Hand-offs to the developers**: *Export*, *Hand off...* asks what changed
  and makes "Order entry v2.zip" next to the project folder: the whole
  project, with the PDD and the Technical details of that version. Each
  hand-off gets the next number; every PDD says which version it is
  ("Version 2, handed off" with the date and who, or "Working copy after
  version 2") over a table of every version and what changed. Ctrl+Z takes
  a version back, and its zip stays.
- **A hand-off opens read only**: *Open a hand-off (.zip)...* opens the zip
  on a developer's computer: every level, the video, the transcript, the
  maps and the PDD and Technical details it came with can be looked at and
  played, and nothing can change. A hand-off unzipped by hand opens read
  only too. A newer version is a zip of its own.
- **Several projects at once**: *Open in a new window...* in the Open menu,
  or the button beside a recent project, opens another project in a new
  window while the one on screen stays open, and starting the app again
  opens a new window of the running app (two copies of the app on one
  profile lost the second one's recent projects and settings, and could
  take the first one's removed files waiting for an Undo). A project already
  open for editing in another window opens read only, its project line
  "Open in another window: read only here". Each window is named after its
  project; closing one closes only its project.
- **Technical details (.xlsx)**: a workbook for the developers' design
  document, in every hand-off and on its own in Export: every click, entry
  and choice of the reference transaction with the control it acted on,
  every field with what was entered in each transaction, the values typed
  again in another system, and the programs.
- **The As-Is map says when the steps changed after it**: the Map and the
  Checklist say so, and *Copy again* makes a fresh copy of the process map,
  which takes the old copy's place in the PDD once you change something in
  it.
- **A How-to guide for process managers**: `docs/HOW-TO.md`, short and led
  by one order-to-cash example (start a project, the first hour, everyday
  tasks, the hand-off, where things are kept, the library, the messages
  that need an act, a glossary). Help opens on it as *Getting started*, in
  the same words, and `docs/PDT-How-to.docx`, made from it by
  `scripts/make-howto-docx.py`, is the Word copy the build puts in `dist/`
  to hand out.

### Changed

- **One word for each thing**: the apps say *transaction* for one pass
  through the process (a run in 1.5.0) and *project* for what the analyst
  opens or starts (a recording or session in 1.5.0). The capture app's
  project code and name are now the request code and name, and the PDD's
  Document control prints them as the Request. Help and the Steps list say
  what a transaction is where it first appears. Data keys, CLI flags and
  file names keep the old words.
- **The PDD is a document a process manager can hand over**: tool-neutral
  and in the reader's order (document control; purpose and scope with the
  trigger and the result; the As-Is map and the reference transaction's
  steps; variations, rules and exceptions; the data; applications and
  time; improvement and automation scope; notes; attachments). Each step
  says its system and screen, its average time, in how many transactions
  it happened, where it is in the recording ("Transaction 1 at 0:19") and
  the flow the analyst set on it ("Only when the customer is new.", "Then
  goes back to step 2, Check the customer, when the details are missing.").
  One data table marks the values typed again in another system; tables
  have a grid; each map gets a page of its own, landscape when it is wide.
  The analyst's fields survive a re-export.
- **The analysis runs by itself**: a project is analyzed when it opens
  without a current analysis, after Apps outside the process and after a
  time range is left out or included again, as the Overview opens after a
  change of the steps, when the Map's picture is older than the steps, when
  making the As-Is map, and before a PDD export, a map export or a hand-off.
  An analysis changes the project only when it finishes, so Cancel leaves
  the steps and the map as they were. One line
  in the top bar says so, with Cancel; the log shows only when an analysis
  fails.
  Apply marker changes stays deliberate, and Help, Troubleshooting has
  Re-analyze.
- **One top bar and no More menu**: New and Open are two menus; the video
  and transcript actions sit on the project line, Apps outside the process
  in the Steps toolbar. Flow is now called the Timeline.
- **Observations instead of findings** on the Overview, measured from the
  recording, and one source with the PDD: *Data* and *Applications and
  time* are the rows the PDD prints in its sections 5 and 6, under its
  headings: each analysis writes them into `analysis.json` with the PDD's
  own functions, and a PDD export analyzes first, so the two say one fact in
  the same words. Projects analyzed before are analyzed again as they open.
- **Attaching a video goes straight into syncing it**: pause at a moment
  you recognize, then click the same moment on the timeline.
- **Only the reference transaction is confirmed**: the other transactions
  are reviewed, not confirmed. The Checklist ticks them once each was
  opened in Steps, and says how many differ from the reference
  transaction.
- **A step pane that leads with the system**: its fact line reads
  "Salesforce · Account lookup · 6s · ends at Search · Transaction 1 at
  0:19"; it lists the fields typed in the step; the name, the system, the
  description and the flow save as you go (no Save button, and Ctrl+Z
  undoes each change); waste is a tag; the drafted narration is a hint, no
  longer prefilled as the description.
- **One clock**: the timeline, the markers, the screenshots, the transcript
  rows, the step pane and the panel show the time since the recording
  started (0:39), the same pointer the PDD prints. The time of day shows
  only in the timeline's summary.
- **The As-Is map, linked**: once an As-Is copy is chosen for the PDD, the
  Map shows it in place of the process map, read only and drawn as the PDD
  prints it, with Edit. It is as linked as the map from the transactions:
  a task opens the step panel on
  its step (or says that no step has its name), a file opens its
  attachment, and a note shows its whole text.
- **Case identity is stable across re-analysis**: a confirmed or edited
  step no longer loses its place after a re-analyze.
- **A failed export or analysis stage is reported honestly**: the viewer
  no longer opens a stale document after a failed export, and a stage
  that could not run says so instead of rendering as a measured zero.
- **Every export opens its folder**: once the PDD, a map image, a BPMN file
  or the project zip is saved, Explorer opens with the file selected, and
  the toast names it.
- **The recorder sidecar is supervised per recording**: a crash-looping
  recorder now reaches its restart limit and reports itself dead instead
  of restarting forever unnoticed; a spawn failure is now reported and
  retried the same way a crash is.
- **One process map**: one map built from the transactions' steps, from a
  single transaction on. The Map shows it as the PDD prints it; how the
  transactions ran, one click away, draws it left to right between a Start
  and an End circle, where a condition set in Steps labels its line and a
  path set in Steps that no transaction took is dashed. "Edit as the As-Is map"
  copies it into the map editor as the PDD's As-Is map, analyzing first so
  the copy carries the current step names. The PDD prints the edited As-Is
  copy when there is one, else the map from the transactions, and Export's
  Process map (image) saves that same picture from any level. The BPMN file
  behind it covers the transactions only, ends in a real end event, wraps
  into rows to print legibly, and carries each step's description, system
  and transaction count; its start and end are named after the trigger and
  the result.
- **An edited map is out of date only when the process changed**: every
  analysis writes the map file anew, in another order, so every As-Is or
  To-Be copy used to read as changed. A copy now compares the process the
  map draws (its steps, events, paths, notes and files), not the file's
  bytes; a copy made before keeps the old comparison.
- **A richer map**: the BPMN file draws a decision for a step that happens
  only under a condition, names each early end after its condition, draws
  a step done in a system as a plain task and one done outside every system
  as a manual task (the hand, explained in the legend),
  shows a step's notes beside it and its attached files under it, and gives
  each system a colour, with a legend. Task names stay the step names, so a
  BPMN tool imports them clean. An As-Is copy made before offers Copy again
  to get them.
- **Less on every screen** (the UI clarity audit): the step detail shows
  one fact line that ends with why the draft ends where it does, then the
  description and the step's screenshots; chips show only where a step
  differs from its transaction; Screenshots is the Timeline's default tab;
  Open lists Open project and the recent projects, and New the two ways to
  start one.
- **The capture app speaks the SME's words**: Recording, Paused,
  Transaction 2, Next transaction, Stop recording; setup items sit in one
  Setup (analyst) menu, where the storage size is flagged instead of a
  toast after every recording; the noise toasts are gone and Help fits one
  screen.
- **The consent text says what is really left out**: only what is typed
  into password fields (consent text version 2, so a remembered consent to
  the old text is asked again).
- **Drafts are hidden, not deleted**, so an analysis cannot bring them
  back; steps added by hand can still be deleted.
- **Transactions never nest**: a start that arrives while a transaction is
  open ends that transaction first, the way the capture app's transaction
  key does. A start inserted in the viewer used to nest every later
  transaction inside the open one.
- **The Overview fits small screens**: it stays usable at 1366x768 and
  1024x768 instead of being squeezed out by the Session summary, and
  right-click menus stay inside the window.
- **Analyst work is safer on disk**: an `annotations.json` that cannot be
  read is reported, with its backups, and never overwritten; every save
  goes through a temporary file first.
- **The edited maps' words**: the Reference maps gallery is now Edited maps,
  and Re-fork is *Copy again*.
- **Fixes from the validation pass** (2026-09-25):
  - Data and outputs: marking transactions in a project made from a video
    or from nothing keeps its steps; Transaction 1 has its active time; a
    stretch left out no longer draws a path nobody took; the PDD's steps
    read "Step 3.1", apart from its section numbers; the request prints
    with its code; the Raw events use the one clock.
  - The viewer's joins: Dissolve gives each Go to back to the step that
    carried it;
    steps you added stay Added through split and merge; nothing is copied
    into the project while it is analyzed; an unreadable annotations file
    shows only its banner; the step panel says when the video does not
    cover a moment; added frames, apps left out and one-click steps show on
    the Timeline; waste shows in the panel and on the map; sub-steps take
    the project's own names first; Group says what it will do; the folder
    Extract All makes opens the recording inside it; the PDD's map pictures
    leave the notes out.
  - Wording and polish: Help gains a Map section; a control that cannot
    act is hidden or says why; a step with no system reads "No system
    set"; Escape closes the menus; an unmarked project reads "One
    transaction (not marked)" everywhere, the PDD included; exports are
    named after the project; the capture bar shows Pause and leaves it out
    of the time, and the name field sits above Make a zip.
- **Real recordings read as the work, not the recorder's noise** (lane
  LF-PIPE, from ten recordings of live apps). The analysis leaves out what
  the user did not do: a web page's empty fields as it renders, a
  dropdown's choice reported twice, the Office ribbon mirroring the
  selected cell, Excel's formula list, the desktop behind the windows, a
  click with no identity, an address on the way to a page. A click that
  lost its window takes it from its page, so no step is named "(screen)"
  in a made-up system "App". A web page's title loses the browser's
  name and its record numbers, and a value in it (a customer's name) is
  left out when the same screen shows other values in other
  transactions, so identical orders draw one path; a link named by the
  ticket or account it opens reads "Open a record" (or the words the
  names share) when the transactions opened different ones. A ribbon
  change the user made (Word's Bold, a Font Size typed) stays. The step
  map draws exclusive gateways only, never parallel ones for work done
  one step after another. Every screenshot, the SME's own included, belongs to
  the step it was taken in or before; the PDD prints one per step. A
  password reads "Password typed (hidden)", never "Cleared Password".
  Calculator, Character Map, Paint and File Explorer read by their names;
  the thin-capture warning counts an app's actions with an id; a map box
  no longer repeats a system its step's name already says.
- **The recorder writes what the SME did, in the order it was done** (lane
  LF-SME, from ten recordings of live apps):
  - What the SME did is told from what a program does by itself: a value
    in the field with the keyboard focus, a toggle or a selection there or
    under the mouse pointer, and every click on a button or link are the
    SME's. A screen filling its fields as it loads and the Office ribbon
    echoing the selected cell are written marked ("user_acted": false), and
    the analysis and the viewer leave them out of the steps: a program the
    rule misjudges loses nothing from the recording, and a changed rule
    with Re-analyze brings it back. Only File Explorer's navigation pane
    refreshing (it named the owner's folders) and a desktop icon selected
    behind the windows are never written. Excel's formula AutoComplete list
    is left out by the analysis.
  - A value typed just before a click is written before the click; an empty
    field is no longer a typed value; a drop-down choice is written once,
    as the drop-down's value; the browser's address bar once per address; a
    check box reads on or off; a click on a button that changes the page
    keeps the button's name and program (read as the click happens).
  - A password entry keeps its "redacted" flag (it read "Cleared
    Password" downstream); the password itself was and is never written.
  - The capture app: the first Start after an install no longer freezes it
    (the recorder is started once at launch, and the bar says "Starting
    the recorder..." if it is not ready yet); the bar opens at the top
    centre, clear of the buttons maximized programs keep at the bottom
    right; the "not being recorded" warning for a browser waits for 30 s
    of use with nothing recorded, so typing and Resume no longer raise it;
    the zip is named after the recording; the first screenshot is saved
    once; the integrity file stays true after the recording is named.
  - A screenshot of every new screen: another page or window title in the
    same program gets one at the next 5 s poll (Settings, "Capture when
    the screen changes"), so a process done in one browser has a picture
    under each step of the PDD, not only under the first step of each
    transaction. Such a screenshot is kept only while its window is still
    in front once the grab is done, so a page left meanwhile never shows
    under the step before.
  - The recorder takes the screenshots, in its own process: Electron's
    screen capture held the capture app for about 0.4 s a shot (longer with
    more screens), so the bar froze and a transaction key pressed meanwhile
    was stamped late, the freeze SMEs knew from the screenshot key. The
    recorder copies the one screen the SME works on in about 50 ms, the
    right one on a scaled screen too; the bar no longer blinks at each
    screenshot. The old way remains the fallback.
  - The packaged apps carry their scoped runtime packages. The packager
    dropped folders such as node_modules/@mapbox, so the packaged capture
    app never saw the foreground window (no time in each application, an
    active time of 0s in the PDD, no app-switch screenshots, no warning
    for a program it could not record) and the packaged viewer lost
    dagre for the live map. Both filters are pinned by unit tests.
  - A recording without a single foreground row (every recording of the
    packaged capture app before this fix) prints its active time as "Not
    recorded" in the PDD, not 0s.
  - A click that changes the page, when it is the first thing done on that
    page, reads as done on it (the window the capture app saw in front),
    not on the page before ("New order" on the saved order's page).

### Removed

Preserved in full on the `product-edition` branch.

- **Case detection from anything other than the transaction markers.**
  Suggested markers and anchor-candidate detection (for a recording with no
  fired markers) are cut; a missed marker is now added by hand ("Start a
  transaction here" on the Timeline).
- **Canonical step sets, the Process Template workbench and saved
  processes**: a process is recorded once, and comparing recordings is the
  product line.
- **The in-app vocabulary discovery workbench** ("Discover from window"
  and the App Library match workbench), replaced by the activity library
  (above); the shipped application vocabularies still enrich control
  names as before.
- **Remembered step names** (the store on the analyst's computer, its
  dialog in the Steps toolbar and `normalize.py --names`): the activity
  library names steps across projects now, and a project's own names still
  name its drafts.
- **Structural PII masking and the data-posture setting.** For internal
  use, real example values make a better PDD; password redaction at
  capture time is unchanged.
- **The in-app EUR-ROI module and the PDD's ROI table.** The business-case
  formula now lives in the owner's own project-management tool; PDT
  exports the measured inputs it needs in a later release.
- **Phases**, the phase-level process map, and the map's detail (grain)
  slider and notation-by-level matrix.
- **Activity-level process maps and the event-log exports**: the pipeline
  no longer writes `dfg.json`, the activity-level `process_map.bpmn`, the
  per-case maps, or the XES and CSV event logs.
- **Compare Sessions**, the case-by-screen work-item view, cross-machine
  sync markers, app-vocabulary prep sessions, the worker close-out
  wizard's observed-value questions, and the per-marker label picker.
- **Team taxonomy, the 1.x project files (a saved workspace that pointed
  at sessions; a project is now the folder itself), the command palette,
  and "Copy for LLM."** No AI ships inside the product.
- **The standalone findings memo document and the HTML findings report**,
  and later the PDD's findings section with the "include in PDD" ticks:
  the PDD prints no findings.
- **The analysis layer nothing read**: the facts, the findings, and the
  waste, time study, segment, automation and efficiency estimates.
  `analysis.json` keeps the transaction check, the note on apps recorded
  with less detail and the PDD's rows; projects analyzed before are
  analyzed again as they open.
- **The Analyze button and the More menu** (the analysis runs by itself,
  above).
- **Clutter the UI clarity audit found**: the fact tiles and the Session
  summary panel, the shortcuts overlay, the Steps mini-timeline, the Flow
  Notes tab, the rare-path slider, the zoom readouts, the lanes nobody
  read, the marker filter, tier chips, duplicate totals, the
  business-required split editor, the automation Confirm and Dismiss
  buttons, Scope to playhead, and an edited map's type select (one *Use in
  PDD as* choice instead).
- **The capture app's Live Session window and hotkey overlay** (replaced by
  the recording bar), with their counters and event feed, and the
  interaction count in the end summary.
- **The raw events' *+ to step*** (Split, Merge and + Add step set a step's
  boundaries) and the "may change between recordings" marker on an
  interaction's identity line (a project is recorded once).
- **The example sessions in the viewer release**, and the old
  `User-Guide.docx` in the build output: the in-app Help is the guide.

## [1.5.0] - 2026-07-03 — approachability redesign

The largest usability cycle since 1.0. Trigger: the owner "struggled for months
to sit down and annotate" real recordings — every panel was honest, tested, and
documented, yet the sum was "unapproachable, scary, tiring just to look at."
This release adds a **use gate** on top of the Honesty Redesign's tier gates (a
resident surface must, on a real session, earn its place by producing a memo
sentence, a recorded decision, or a capture instruction —
[docs/To-Do/APPROACHABILITY-REDESIGN-2026-07-03.md](docs/To-Do/APPROACHABILITY-REDESIGN-2026-07-03.md))
and rebuilds the surfaces that failed it.

Almost entirely viewer-side; the one pipeline change is additive (exports read
the new `group_annotations`), the session golden is unchanged, and old
`annotations.json` loads unmodified. **The redesign's phase gates close on an
owner real-session sit-down (the R5 runbook), not on the green suites — that
validation is still pending; this build is its instrument.**

### Added — R3: case×screen work items ([ADR-0028](docs/adr/0028-case-screen-work-items.md))

- **The Steps view leads with a case tree** built on a new analyst-facing unit:
  the **case-scoped screen visit** — the fragments a worker produced on one
  screen within one case, merged across app bounces (non-consecutive), so a real
  hour folds to memory-sized items instead of a ~500-row wall. Computed at
  **view time** on the ADR-0024 grain ladder; raw steps are never destroyed and
  the element-grain list stays one notch away.
- **Group-level annotation** — a new additive `group_annotations[]` keyed
  `{case_id, screen_key}` carries a name / note / waste / hidden per work item,
  flowing down to member fragments at render and into the exports. Written by the
  viewer, preserved-not-consumed by re-normalization (verified: an unknown
  additive key survives `--mine`).

### Added — R4: the workflow spine

- **A next-act rail on Overview** turns the app from a set of nouns (views) into
  a sequence of verbs: it derives, from the session's own data, the one most
  valuable next act (name controls → mark cases → walk the story → judge the top
  time sinks → assemble the memo) and highlights exactly one. Advisory counts are
  labelled advisory; nothing auto-runs.
- **The Analysis tab is retired** — its surviving modules (Where the time goes,
  automation candidates, the gated €-ROI) move into Overview's evidence layer,
  below the findings feed, keeping their collapse-persistence.
- **Templates return as a byproduct verb** ("Save as reference for this
  process…") plus an offer line when a loaded session matches a saved template.
- **Capture guidance line** — a single status-driven line on the operator panel
  ("Recording — fire a marker when a new case starts", with the real hotkey).

### Added — R5: the sit-down runbook

- **[R5-SITDOWN-RUNBOOK.md](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/To-Do/R5-SITDOWN-RUNBOOK.md)**
  (now on branch `product-edition`), the
  owner-run instrument that closes the redesign: three real sessions → three
  timed 2-page memos → a border ledger that cuts any surface producing no memo
  sentence, decision, or capture instruction. The suites are the floor; the
  ledgers are the gate.

### Changed — R1: subtract to what earns residence

- **Analysis gutted to the modules that earn their pixels.** "Process
  efficiency" and "Waste by screen" removed as resident modules (the waste
  judgment relocates into a "Where the time goes" row expansion); the €-ROI
  section is gated **as a whole** on analyst-entered volume (below it, one
  sentence + an "Edit assumptions…" CTA — no table of zeros, no assumption
  rendered as a per-row AUTO% column); automation candidates render as finding
  cards (Confirm/Dismiss preserved), not a ranked table.
- **Compare restacked to lead with difference, not merge.** Divergence findings
  → aligned reading → side-by-side are resident; the merged charts, the 80-row
  variants table, the pooled outlier/rework tables, and the aggregate-analysis
  block move behind one **EXPLORATION** Machine drawer; exports collapse to one
  menu; the merged map renders resident only under template conformance.
- **Flow timeline defaults to two lanes** (apps + cases/playhead); markers,
  screenshots, and steps lanes are opt-in.
- **Step detail is triage-first** — name / waste / hide resident, everything else
  behind one "More" disclosure that resets to collapsed on each selection.
- **Templates demoted** out of the primary nav (reachable via "More"); resident
  tab hotkeys renumbered 1/2/3.

### Added — R2: the App Library match workbench

- **The App Library is now a match workbench (§5 R2).** With a session loaded,
  selecting a vocabulary opens — by default — the match workbench for that
  (session × vocab): the analyst looks at what the recording *captured*, points,
  and names; signatures are **derived, never typed**. Three evidence lists
  computed from the session's captured interactions — **matched** (distinct named
  controls, expand-in-place to the evidence: windows seen in, example values, the
  rule signature), **unnamed** (the worklist, ordered by occurrence, each with a
  single "Name…" act reusing the G-8 add-from-interaction derivation), and **dead
  rules** (vocab entries that matched nothing this recording — the "is my selector
  wrong?" state). A resident coverage header ("N of M captured controls named ·
  X% of interactions"), a screens split with a suggested `window_title_regex`
  diffed from the observed title variants (volatile token → wildcard), and the
  existing non-destructive re-analyze CTA (never auto-run).
- **The blank-form rule/YAML editor demoted to a Machine drawer.** No capability
  removed — hand-editing the four signature inputs and the YAML still lives one
  disclosure down (`▸ MACHINE LAYER: rule editor`).
- **New advisory matcher `viewer/vocab-match.js`** mirrors
  `normalization/app_vocab.py` matching semantics (scope: case-insensitive
  `process_name` + `window_title_regex`; signature: exact-field-equality with
  most-specific-wins). It is viewer-side and **advisory** — the pipeline stays
  ground truth; a re-analyze reconciles. Unit-tested (`vocab-match.test.js`);
  pinned end-to-end by `e2e/workbench-smoke.js` and the re-pointed
  `e2e/vocab-smoke.js`.

### Changed — App Library and Steps: one identity, one name, no jumps

- **App Library (post-R2 UX pass).** Naming happens **in the clicked row** — the
  old jump-to-bottom scroll is gone; every row shows one composed **identity
  line** (`ControlType · "identity" · window`, with a volatility marker) plus one
  name field, and the four raw signature inputs survive only behind a per-row
  "Raw match rule" disclosure in the Machine drawer. "Discover from window" and
  prep recordings now yield **triaged candidates** (interactive control types,
  capped, nothing preselected) into the one unnamed worklist — naming is the
  review; the per-row "reviewed" ticks and "Approve all" are removed.
- **Steps (UX pass).** Per-row ↑/↓ move buttons removed (reorder → right-click
  menu + Alt+Arrow); truncated step names now carry the **full name** in their
  tooltip (audited across every truncating label on the surface); the interaction
  evidence in step detail renders through the same **identity line** as the App
  Library. Returning from "Jump to in Flow" now reveals the still-selected step.

### Fixed: the navigation contract ([NAV-AUDIT-2026-07-03](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/To-Do/NAV-AUDIT-2026-07-03.md), on branch `product-edition`)

A read-only audit of every navigation edge against a five-law contract (one click
semantic; arrivals reveal / returns restore; disclosure is local; scale degrades
honestly; what you write, you can find), then the confirmed fixes:

- **The Overview rail's App Library button** navigated nowhere (a `TypeError`
  swallowed by an empty catch) — fixed, and the overview smoke now asserts every
  rail act **lands**, not merely exists.
- **Map nodes were inert at the default notch** — a click now selects the node and
  shows its info; the shortcuts legend was corrected to match.
- **A steps-lane click silently switched views** — now it selects + seeks and
  stays on Flow; the view change is a labelled "Open in Steps" verb.
- **Side-by-side compare had no inverse** (couldn't be closed) — now a true toggle
  with a Close control.
- **Two drawers shrank their siblings / moved their own toggle on open** (map
  Advanced views −47px, Raw events −24px) — both now grow the page downward with
  zero toggle movement.
- **~60 case labels overlapped into noise** on multi-hour timelines — labels now
  render only where they fit (full label on hover, all back on zoom-in).

### Changed — exports render at the work-item grain ([ADR-0028](docs/adr/0028-case-screen-work-items.md) §4)

- The memo and PDD now render analyst-written work-item names (and their notes /
  waste flags) wherever they enumerate a case's work, via a Python twin of the
  viewer's grouping that reuses the shared screen-label rules. Output is
  byte-identical when no `group_annotations` exist.

### Documentation

- Read-only analyses committed alongside the code: the deliverable (memo/PDD)
  use-gate audit
  ([DELIVERABLE-AUDIT-2026-07-03.md](docs/To-Do/DELIVERABLE-AUDIT-2026-07-03.md)),
  the measured performance ceiling (linear to ~3,840 steps / 14.85 h with no
  virtualization needed —
  [PERF-CEILING-2026-07-03.md](docs/To-Do/PERF-CEILING-2026-07-03.md)), and a
  structure-only real-data vitals report.
- The compiled cross-session operating knowledge now lives in a global skills
  pack; a frozen snapshot is committed under `docs/claude-skills/`.

## [1.4.0] - 2026-07-02

Presentation / disclosure pass over the viewer from the 2026-07-01 design
critique: default surfaces are calmer and business-readable, with the fuller
analytical + technical detail one click behind an expand or a named drawer. All
changes stay inside the Honesty Redesign (Memo / Evidence / Machine + tier
gates) and follow the new presentation ruleset in
[docs/architecture/DISCLOSURE-MODEL.md](docs/architecture/DISCLOSURE-MODEL.md).
Viewer-only — no capture, pipeline, schema, or session-data changes.

### Changed — disclosure pass (design critique 2026-07-01)

Polish where default viewer surfaces rendered zero-information or duplicated
content that read as a measured result. All changes stay inside the Honesty
Redesign (Memo / Evidence / Machine + tier gates) and follow the presentation
ruleset in [docs/architecture/DISCLOSURE-MODEL.md](docs/architecture/DISCLOSURE-MODEL.md).
Item numbers are from [DESIGN-CRITIQUE-2026-07-01.md](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/To-Do/DESIGN-CRITIQUE-2026-07-01.md)
(on branch `product-edition`).

- **Flow view — collapse the video stage when no recording is linked (item 1).**
  The tall black "No recording linked" box becomes a slim one-line band (keeping
  a "Link recording…" affordance) and the freed space goes to the timeline +
  notes. Unchanged when a recording is linked.
- **Analysis — gate "Waste by screen/step" like Process efficiency (item 2).**
  Until at least one step type has a business-required judgment, the value/waste
  bars are withheld behind a call-to-action instead of a wall of all-green bars
  that read as a measured "all value-add"; each row shows a neutral measured-time
  chip. Bars render as before once any judgment exists.
- **Analysis — floor the €-ROI hero (item 3).** Below 1 h/yr expected saving, the
  hero figure is replaced by a plain sentence ("Under an hour a year at observed
  volume — more recorded instances would size this"); the per-candidate table
  stays.
- **Overview — de-duplicate and re-altitude the findings feed (items 4, 5).** The
  "how this was measured" methodology sentence renders once per detector group
  (behind an ⓘ) instead of under every card; each finding card is now resident
  claim + tier chip + "include in memo", with the evidence numbers, screenshot
  chip and "Show on timeline" one click behind an expand-in-place chevron. The
  screenshot reference renders as a "★ screenshot" chip that opens the image
  (reusing the security-hardened open path), not a raw path string.
- **Analysis — print each automation-candidate chain once (item 6).** The step
  chain is shown once (with "+N more" truncation); the row title is a short app +
  size descriptor, and the ROI table uses a shortened first→last form with the
  full chain on hover.
- **Overview — merge the duplicate case-state chips (item 8).** "Case analysis
  on/locked" folds into the case-quality badge as its subtitle instead of a second
  chip stating the same fact.
- **Session view — demote the resident session chip row (item 9).** The static
  EVENTS / STATUS / VIDEO / ANALYZED / VOCABS chips fold into the collapsed Session
  summary band (chip row when expanded, summary-line text when collapsed), freeing
  the toolbar row; the dynamic pending-edits chip stays visible.
- **Analysis — collapsible modules with per-analyst persistence (item 21).** Every
  Analysis section wears a uniform header (title + one-line takeaway + chevron);
  the takeaway renders even when collapsed. Collapse state persists per analyst in
  `localStorage` (`pdt.analysis.*`, same pattern as `pdt.theme`). A tier gate
  always wins — a gated module keeps its call-to-action even when expanded.

### Tests

- `e2e/session-smoke.js` — added pins for the collapsed no-recording video band,
  the withheld Waste bars behind a CTA, the €-ROI floor sentence, and Analysis
  module collapse persistence across a re-render; updated the €-ROI total read to
  accept the floor sentence.
- `e2e/overview-smoke.js` — updated the badge pin for the item-8 merge (subtitle,
  no separate chip) and added pins for methodology-once-per-detector-group and the
  finding-card expand-in-place + screenshot chip.

### Changed — disclosure pass, second sweep (items 10–20)

Continues the same disclosure pass. Item 7 was investigated and **skipped** (see
below) — an honest skip beats a hack; every other item in this sweep landed.

- **Template + App Library — compress the prose landings (item 10).** Both views
  led with 2–3 paragraphs before the first control. Each is now a one-sentence
  definition + the primary actions, with the original wording (unchanged) moved
  behind a collapsed `▸ How this works` disclosure (native `<details>`, same
  mechanism as the Machine-layer drawers).
- **Compare — tighten the empty state and make its pointer a real button (item
  11).** The cross-session findings panel's two-paragraph precondition-not-met
  message is now one resident sentence + a `▸ Why these sessions don't compare
  yet` disclosure holding the mechanics. "See each session's Overview" is now an
  actual `<button>` (mirroring the map's `data-map-cta` pattern) that switches to
  the Session tab, loads the first loaded session, and lands on its Overview
  level — reuses the existing `onDrillToSession` injection (extended with an
  optional `{ level }`), not a new mechanism.
- **Map toolbar — give the active notation tab an accent state (item 12).** CSS
  only: `.panel-tab.active` now uses the accent fill + accent-text color (the
  same treatment `.view-mode-btn.active` already uses) instead of a `--bg-1` on
  `--bg-3` combination that read as *disabled*. Both themes.
- **Steps mini-timeline — silence clipped one-letter chip fragments (item 13).**
  Below ~40px a step block hides its label entirely (via the same
  `container-type: inline-size` + `@container` technique `.tl-activity` already
  used) instead of showing an unreadable "S.." fragment; the block's native
  tooltip (`title`) still carries the full name, and the label reappears once
  zooming widens the block. CSS only — no JS width measurement needed.
- **Overview — fix the mixed fact tile's grammar (item 14).** "1 RE-TYPED VALUES"
  now reads "1 Re-typed value" (correct singular/plural). Kept as one tile rather
  than splitting to 7 (the row is tuned for 6 across the 980px-wide Overview
  column; a 7th tile would either crowd or wrap unevenly) — the tooltip now
  spells out that the subtitle's repeated-sequence count is a separate
  measurement, not a qualifier on the headline number.
- **One name for the detail control everywhere (item 15).** The one remaining
  "Grain slider" mention (the Steps view-mode help text) is now "Detail slider",
  matching the toolbar label ("Detail:") and the rest of the app's copy. No code
  identifiers, ADR references, or docs prose were touched — rendered strings
  only.
- **Template — plain-disabled "Delete template" on the empty view (item 16).**
  `button.danger:disabled` now falls back to the same neutral look as every
  other disabled control; the destructive red fill returns only once the button
  is enabled (a template is loaded).
- **App Library — collapse the raw signature block per interaction row (item
  17).** `CONTROL_TYPE` / `CLASS_NAME` / `AUTOMATION_ID` / `NAME (RAW)` /
  `WINDOW_TITLE_REGEX` now live behind a per-row `▸ Match signature` disclosure;
  `MEANINGFUL NAME` and the semantics strip stay resident. A **discovered** row
  (identity_source/confidence present) auto-opens the disclosure so the §C2
  review checklist stays fully usable without an extra click; a hand-added row
  (`+ Add interaction`) starts collapsed. The `[data-sig]` inputs are unchanged
  and still reachable regardless of DOM nesting — `e2e/vocab-smoke.js` verifies
  both states plus that discovery/save/collectAndMark are unaffected.
- **App Library — overflow the toolbar (item 18).** "Reload list" and "Open YAML
  in editor" (Machine-layer verbs) moved into a new "⋯ More" popup menu, reusing
  the existing dropdown-menu mechanism (`wireDropdownMenu`, the same one behind
  the session toolbar's "⋯ More"). The five primary actions (New vocabulary /
  Start from a recording… / Discover from window… / Copy for AI review… / Import
  suggestions…) stay resident; the two posture-gated Copy-for-AI buttons anchor
  on a new `#vocab-llm-anchor` marker instead of `#btn-vocab-reload` (which moved
  into the popup) — their ids and sealed-posture removal logic are unchanged.
- **Hide "Scope to playhead" on Overview (item 19).** The link is orphaned chrome
  on the one level with no visible playhead; it now hides there (set once at
  boot and on every `applyLevel` switch) and stays visible on every level with a
  timeline (Flow, Steps, Phases, Map, Analysis).
- **Ellipsize the timeline app labels (item 20).** `.tl-act-app` (and its
  sibling `.tl-act-title`) now carry `min-width: 0` — the real bug was a classic
  flex-column sizing default (`min-width: auto`) that kept the label's own box
  wider than the activity band regardless of `overflow`/`text-overflow`; the box
  now correctly shrinks to the band and ellipsizes its text instead of
  overflowing.
- **Skipped — item 7, un-vocabed labels on Analysis rows.** Detection of "this
  came from no vocabulary match" IS available (an interaction's `meaningful_name`
  is absent, e.g. a raw `va01` token survives), but the existing "Add to App
  Library…" flow (`addInteractionFromStep`) operates on ONE interaction's
  signature, while an Analysis "Where the time goes" row (`.ts-row`) is an
  aggregate across every instance of a `process_label` group — potentially many
  distinct interactions/controls across many step instances, with no single
  canonical signature to hand the flow without inventing new
  pick-a-representative-interaction logic. Picking one arbitrarily risks
  silently misnaming the wrong control — the opposite of this codebase's
  suggest-don't-mutate / honest-confidence discipline (ADR-0023). Skipped rather
  than hacked; map nodes were already excluded from this item's scope.

### Tests (second sweep)

- `e2e/flywheel-smoke.js` — added pins for item 11: the Compare empty state
  renders one sentence + the "Why these sessions don't compare yet" disclosure +
  a real `<button>` CTA, and that the CTA switches to the Session tab and lands
  on Overview.
- `e2e/vocab-smoke.js` — added pins for item 17: a discovered row's signature
  disclosure is auto-open with all 5 signature inputs present; a hand-added row's
  disclosure starts collapsed with the same inputs reachable.
- `e2e/session-smoke.js` — added pins for item 19 ("Scope to playhead" hidden on
  Overview, visible on Flow) and item 20 (no `.tl-act-app` label ever escapes its
  band; where text is truncated it is via `text-overflow: ellipsis`, not raw
  overflow — deliberately NOT the usual `scrollWidth > clientWidth` clipping
  probe, since that comparison is true by design whenever ellipsis legitimately
  elides a label).

## [1.3.0] - 2026-06-28

Bundles the arrival-session feature work (**Phase H**) and the real-session
hardening (**Phase G**) accumulated since v1.2.0, plus an internal robustness
pass (untrusted-input parser fuzzers + a capture manifest-race fix).

### Phase H — arrival-session reframe + vocab-friction killers

The first real session arrived as a folder from a remote worker — no
vocabularies for the recorded apps, no access to the live apps, one
recording. Every vocab assist assumed the analyst sat in front of the live
applications. Phase H makes reading a received recording need **zero**
vocabulary / CLI / discovery work, and turns vocabulary building from a
prerequisite into a one-click asset for *repeat* recordings. Ground truth:
[docs/To-Do/real-session-findings.md → G-6/7/8](docs/To-Do/real-session-findings.md);
phase record in [docs/LAB-PHASE-SPEC.md → Phase H](docs/LAB-PHASE-SPEC.md).

### Changed (Phase H)

- **G-6 — The arrival session is the primary workflow; reframe.** The
  Copy-for-AI export now leads with `candidate_rows` (the recording's own
  un-named controls/screens — the apps that most need naming help) as the
  PRIMARY payload, with the loaded-vocab skeletons moved last as the
  secondary, already-started payload (`viewer/llm-export.js`; header +
  instructions reworded to match). Vocabulary-building copy across the App
  Library tab, its empty state, and the "Save to App Library" action is
  repositioned as "worth doing when you'll record this process again —
  never needed just to read a recording."

### Added (Phase H)

- **G-7 — One-click "Start from a recording" (App Library).** A new App
  Library button reads every control a saved recording touched and writes
  one starter vocabulary *per observed app* (scope inferred from
  `process_name` + the window-title pattern), then opens the chosen app's
  skeleton in the review checklist — every control pre-listed, names blank.
  Defaults to the open session; otherwise asks for a recording folder. No
  terminal: the existing `--bootstrap-vocab-out` machinery is reused via a
  new `normalize.py --bootstrap-vocabs-json` (self-exclusion applied) and
  the established Python-runner IPC. Suggest-don't-mutate: nothing saves
  until the analyst presses Save. (`normalization/app_vocab.py`
  `bootstrap_per_app_from_session`, `viewer/views/vocab-view.js`,
  `viewer/main.js`, `viewer/python-runner.js`, `viewer/modals.js`
  `pickerModal`.)
- **G-8 — Right-click "Add to App Library…" from a step.** In Workshop →
  Steps, right-clicking an interaction in the step detail offers to add its
  element signature (control_type + automation_id/name/class_name) to a
  chosen-or-new vocabulary, with the row name prefilled from the step name —
  killing the hand-copying of identifiers. Suggest-don't-mutate; nothing
  auto-saves. (`viewer/step-editor.js`, `viewer/views/steps-view.js`,
  `viewer/views/vocab-view.js` `addInteractionFromStep`.)
- **e2e** — `e2e/vocab-smoke.js` extended (29 checks): the
  "Start from a recording" button produces a review checklist with rows,
  and the Steps right-click "Add to App Library…" adds a prefilled row;
  new-button + picker labels are pinned non-clipped.

### Phase G — real-session hardening

Hardening from the owner's first real 1.5-hour company session (capture
v0.9.0 on the worker machine) — ground truth in
[docs/To-Do/real-session-findings.md](docs/To-Do/real-session-findings.md);
phase record in [docs/LAB-PHASE-SPEC.md → Phase G](docs/LAB-PHASE-SPEC.md).

### Fixed (Phase G)

- **G-1 — Fork map works from the default map state.** The Map opens on
  the Flow diagram at the screen detail level (no Process-diagram file);
  Fork silently did nothing there on a real session. It now self-drives
  to the step-level Process diagram (the supported post-§B2 source),
  forks it, and opens the editor; when no Process-diagram source exists
  it fails LOUD with a plain-language toast. New e2e pin in
  `e2e/session-smoke.js`: fork from the DEFAULT map state must create a
  copy AND open the editor (the old refmap checks pre-selected a
  still-rendered cell, which is why they stayed green).
- **G-2 — Tier-1 facts never render a confident zero on an old capture.**
  Capture v0.9.0 emits no activity events, so active time / top apps /
  switches / longest stretch all showed 0 while idle and span were right.
  `facts.py` now falls back to an interaction-derived estimate (gap-capped
  dwell from `process_name` + timestamps) and stamps the additive
  `facts.app_time_source` (`activity` / `interactions` / `none`); the
  Overview fact strip and the memo label estimates and render
  "not available from this recording" when there is no signal at all.
  New pytest fixture mimics the v0.9.0 event shape.
- **G-3 — Case analysis needs at least 2 cases.** `case_quality.
  tier2_unlocked` now also requires `case_count >= 2` (the real session
  unlocked it on ONE marked case at 0.999 coverage); the Overview badge
  ("1 case marked — case comparisons need at least 2"), the step-map lock
  note, the memo's case section and both "to say more" boxes say why.
- **G-4 — Step-label hygiene on real data.** "(split N)" suffixes no
  longer stack (split/merge strip them; a shared `pre_rules` scrubber in
  `process-label-patterns.json` keeps them out of the grouping key in
  both Python and JS); bare "Enter `<value>`" names collapse to
  "Enter a value" for value-LIKE tails only (numbers, junk "null",
  masked tokens, quoted text); PII-masked tokens render as
  "(masked value)" instead of `«password#…»`; merged step names dedupe
  and cap; the Copy-for-AI export aggregates zero-duration step groups
  into one tail row; self-exclusion now also drops windows browsing the
  capture install folder (`capture-vX.Y.Z` in any window title — the
  worker exploring the tool's own folder in Explorer).

### Changed (Phase G)

- **G-5 — Copy for AI review export v2.** Row keys are namespaced
  `<vocab_id>|<row_key>` so two apps' identical signatures can't collide
  (import tolerates bare v1 keys and routes other-vocab rows aside with a
  plain message); the export adds `candidate_rows` — the session's top
  controls/screens in apps NO vocabulary covers (derived labels only) —
  so the round-trip helps exactly where the naming gap is; and an in-band
  `review_note` tells the reviewer window-title-derived labels can carry
  business names, so labels deserve the same read as values.

### Hardened (internal — no behaviour change on valid data)

- **Robustness fuzzers** for the untrusted-input parsers (`app_vocab`,
  `canonical_match`, `classification`, and `pdd_export`'s pure helpers) —
  found + fixed ~20 crash-on-corrupt-input gaps: a malformed Process Template /
  vocab YAML, an odd-shape capture event, or a hand-edited annotations / analysis
  block would have raised an `AttributeError`/`TypeError` instead of degrading.
  Pipeline output is byte-stable on valid data (golden 10/10).
- **Capture manifest race** closed — the read-modify-write is centralised into
  one atomic `session.updateManifest(folder, fn)`, so a background OBS write
  can't clobber the concurrent display-geometry write (a lost update).

## [1.2.0] - 2026-06-11

Lab Phase F — business-user language + typography
([docs/LAB-PHASE-SPEC.md → Phase F](docs/LAB-PHASE-SPEC.md)), answering
the owner's v1.1.0 walk-through feedback
([docs/To-Do/ui-copy-feedback.md](docs/To-Do/ui-copy-feedback.md)).

### Changed (Phase F)

- **Typography unified** (§F1) — capture windows adopt the viewer's
  design-system font stack (Plus Jakarta Sans / JetBrains Mono) via a
  shared token block (`capture/ui/tokens.js`, fonts inlined as `data:`
  URIs); the wizard window joins the common window mechanism; stat tiles
  and overline labels normalize to one scale, now documented in
  [DESIGN-SYSTEM.md](docs/architecture/DESIGN-SYSTEM.md).
- **Every user-facing string rewritten for business users** (§F2) — the
  Expert drawer becomes *Advanced views*; the App Library checklist row
  gets the owner-calibrated labels ("'Done' action" / "Workers type data
  here" / "Identifies the ticket/order"); Overview, Analysis gates, map
  lock notes, Compare empty states, the memo + PDD templated sentences,
  the worker wizard questions, the readiness report, and the dead-man
  notification all drop the internal vocabulary (Tier 1/2, unsegmented,
  anchor in worker copy, heuristic, posture, motif, grain notch,
  off-contract); *Copy for LLM* becomes *Copy for AI review*; the Grain
  slider is labelled *Detail*.

### Added (Phase F)

- **UI copy guard** (§F3) — `viewer/ui-copy-guard.test.js` fails the
  viewer suite when banned vocabulary re-enters viewer or capture
  user-facing string literals; the banned list + approved replacements
  and the register rules live in DESIGN-SYSTEM.md → *UI copy style
  guide*, registered as invariant #8 in
  [CHIP-GUARDRAILS.md](docs/CHIP-GUARDRAILS.md).

## [1.1.0] - 2026-06-10

The honesty redesign — lab-phase Phases A–E
([docs/LAB-PHASE-SPEC.md](docs/LAB-PHASE-SPEC.md)): confidence-tiered
output (measured facts always; case-based analysis gated on real case
quality; projections only on analyst inputs), the anchor-first Overview
default screen, the findings memo as primary deliverable, slimmed honest
maps, vocab semantics + discovery autofill, the consultant-side
Copy-for-LLM round-trip behind the sealed/reviewable/open data-posture
setting, cross-session divergence findings + the template flywheel, and
the capture-side field kit. Clean edition — no ML / no LLM at runtime,
permanent posture. (Phase A shipped the Overview/findings/memo base;
phase detail below.)

### Added (Phase E — capture-side field kit, worker-facing)

- **Readiness check** (§E1) — new `capture/readiness.js` + tray item *Run
  readiness check…* (idle-only) + a `--readiness` CLI on the capture app.
  Probes: free disk on the session target **and** on the recorder's
  self-extract drive (honors `DOTNET_BUNDLE_EXTRACT_BASE_DIR`; the
  full-disk → 0-events silent failure class), the recorder sidecar starts
  and reports `ready`, UI Automation answers, and a per-running-app **trust
  tier** — rich / basic / minimal / wall — scored from a short UIA snapshot
  probe of each visible top-level window using the same §11e
  `identity_source` / `confidence` / `framework` semantics as captured
  interactions (wall = nothing identifiable or a remote/terminal surface).
  Writes `readiness-report.json` into the sessions base dir + a human
  summary (dialog on the tray path, stdout on the CLI; exit 0 ready /
  2 not ready / 3 crashed). `recorder.js` gained an additive `onReady`
  callback for the positive start confirmation.
- **Dead-man alert** (§E2) — new `capture/dead-man.js` (pure state machine,
  injectable clock, unit-tested by faking the gap): during an active session
  with interactions enabled, **no interaction event AND no `recorder_health`
  heartbeat for >2 minutes** flips the tray icon to a warning state (amber
  badge composed from the base icon — no new asset), fires a critical OS
  notification ("Recorder silent — check capture"), tags the tray status
  line `recorder SILENT`, and lands a durable `recorder_silent` system event
  in `events.jsonl` (`recorder_silent_end` with the true signal-to-signal
  gap on recovery; both documented in `shared/SCHEMA.md`). One alert per
  silence stretch; re-arms on recovery. Deliberately also fires when the
  recorder never spawned in non-required mode — interactions were expected
  and none will come.
- **Worker close-out wizard** (§E3) — `capture/self-annotation/` ported from
  the `project-vision-ai-ml` branch (wizard.js + wizard-window.html +
  wizard.test.js; heuristic-templated, deterministic, **no LLM**) and
  extended for the clean edition: new `observe.js` derives **measured**
  facts straight from `events.jsonl` at session end (longest focus stretch,
  most-repeated interaction, heaviest app-switch pair, values re-keyed into
  ≥2 controls, markers, per-app time) since no pipeline has touched the
  session yet, and `generateQuestions` consumes them via a
  `capture_observations` input (the ML branch's analyst-shaped sources keep
  their ported precedence). ≤5 observed-value questions at session end;
  answers append to `annotations.json` **`self_annotations[]`**
  (`manually_authored: true`, additive key documented in `shared/SCHEMA.md`;
  the pipeline round-trips it untouched). Then the **worker review
  handover**: a read-only summary (facts + the steps they marked, or where
  the time went when marker-less) with an explicit **Submit session** that
  stamps **`manifest.worker_review`** — worker agency as the consent
  feature; closing without the button withholds the stamp. Both writes go
  through the electron-free `persist.js`, which re-refreshes
  `session-integrity.json` so the late files stay declared to the viewer's
  completeness check. Skipped for `app_prep` sessions and the quit /
  failed-start teardown paths; the tray's old "Session ended" dialog yields
  to the wizard instead of stacking on it.

### Added (Phase D — multi-session truth: divergence, Compare reframe, flywheel)

- **`variant_divergence` detector** (§D1) — new `viewer/variant-divergence.js`:
  given ≥ 2 loaded sessions of the **same process** (same Process Template id
  or the same accepted case anchor — the identities coalesce, so an
  anchor-accepted session pairs with a template-matched one), and **Tier-2
  case quality on every participant**, it aligns the per-case step-label
  sequences on the aligned-reading consensus backbone (the same
  Needleman-Wunsch engine as the Steps view) and emits comparative findings
  into an **aggregate-level `findings[]`** (additive, in-memory Compare
  payload — nothing is written into session folders): *"Worker A completes a
  case in N steps (median X active, c cases); worker B in M (median Y); first
  divergence at step Z — A includes it in a/cA cases, B in b/cB."* Workers
  collapsing to one id (the single-operator lab corpus) fall back to
  per-session units. Claims stay comparative/factual; the confidence note
  names the renamed-step failure mode. Same finding shape as
  `analysis.findings[]`.
- **Compare surface reframe** (§D2) — the Compare grid now leads with
  **Cross-session findings** (the divergence feed, rendered by the same
  finding-card component as the Overview — extracted to
  `viewer/finding-cards.js` so the two feeds cannot drift) and the **Aligned
  reading** (the pooled consensus backbone with per-worker/session hit counts
  + off-backbone exceptions, read-only with a pointer to the Steps view for
  curation), with the merged process map **demoted below** them. Below the
  precondition the findings panel shows the honest replace-pattern note, not
  silence. The Markdown report (all loaded sessions) now opens with the same
  cross-session findings the panel showed.
- **Template flywheel** (§D3) — "Export as Process Template" carries the
  session's **accepted case anchor** into `canonical_process.case_anchor`
  (new `anchorFromOverride`, the JS twin of `coerce_anchor_override`: audit
  fields stripped), so the **next session of the same process arrives
  self-segmented** (anchor inherited via template, no per-session Accept) and
  auto-matched. Fixed on the way: the Match-Process-Template flow saved the
  pre-normalize in-memory annotations AFTER the pipeline wrote the matched
  ones, clobbering the freshly auto-matched steps (total loss on a raw
  session) — it now reloads first, then stamps `template_path`.
- **Machine-layer drawer** (§D3) — the Template view's raw YAML editor and
  the version-compare panel (which lived on the Compare tab) collapse into
  one labelled `<details>` drawer at the bottom of the Template view; the
  explainer now leads with the byproduct path (curate → Steps → Export as
  Process Template). Hand-authoring (`+ New Process Template`) stays, demoted
  from primary styling.
- **Auto-phase suggestion out of the default flow** (§D3, a §1 cargo-cult
  cut) — the Phases view's heuristic "Suggest groupings..." button renders
  only behind a config flag (new `viewer/flags.js`, `pdt.flag.autoPhaseSuggest`,
  default off). Phases come from the Process Template or the analyst's own
  grouping by default; sessions whose annotations already carry phases render
  them unchanged.
- **`e2e/flywheel-smoke.js`** (§D4) — the Phase D merge gate: curates a
  marker-stripped demo session through the REAL viewer (anchor hero Accept →
  re-analyze → ✓ Anchor badge), exports the template via the Steps toolbar
  (asserts the YAML carries `case_anchor` + match-ruled steps), matches a raw
  second session against it through the UI (asserts **inherited** anchor
  segmentation — no `case_anchor_override` in its annotations — Tier 2, ≥ 1
  `auto_matched` step), then loads the pair in Compare and asserts ≥ 1
  `variant_divergence` card, aligned-reading backbone rows, the map demoted
  below the findings, and zero page errors.

### Added (Phase C — vocab semantics, discovery autofill, Copy-for-LLM, posture)

- **Vocab record semantics** (§C1) — six optional, additive fields on every
  App-Vocabulary interaction entry: `verb` (enter/select/click/submit/toggle/
  open), `object`, `means`, `completion`, `case_id_source`, `carries_value`.
  The loader tolerates absence (all 10 shipped vocabs stay valid untouched —
  pinned by a loader round-trip suite); matched interactions carry the entry's
  semantics as an additive `data.vocab_semantics`. Three consumers:
  `completion: true` ends a step in `step_suggest` (an explicit boundary hint
  beside the word heuristic); `case_id_source: true` adds a small
  `anchor_suggest` scoring **bonus** (+0.08, clamped — never a gate, and never
  enough to create a candidate that fails the structural minimums);
  `carries_value: true` admits the field's typed values into
  `facts.rekey_details` at a relaxed minimum length, and rekey rows now name
  the vocab fields involved (`fields`, threaded into the finding evidence).
- **Discovery autofill + review checklist** (§C2) — `bootstrap_from_snapshot`
  (Discover from window) and `bootstrap_from_session` pre-fill the derivable
  semantics on every row (verb from control type × observed event kind,
  completion-candidates for Save/Submit/Send/OK buttons, carries_value for
  value-holding roles; `object`/`means` are never guessed) plus the existing
  screen grouping — and the App Library editor renders discovered rows as a
  **checklist**: a semantics strip per row, a per-row "reviewed" tick
  (in-session aid, stripped on save), a `reviewed n / m discovered` progress
  count, and **Approve all**. The human pass is review, not authoring.
- **"Copy for LLM" + reviewed import** (§C3 — authoring-time, consultant-side;
  the runtime stays no-LLM/no-network) — buttons on the App Library and the
  Overview export bar build **one human-readable JSON from the derived stream
  only**: vocab skeleton rows (signatures + auto-semantics + value-free window
  titles + a stable `row_key`), the fact strip, the findings (screenshot refs
  and event/step id lists stripped; re-keyed values replaced by
  join-preserving `value-N` tokens in the evidence AND inside the claim
  sentence), and value-free step groups. The artifact opens in a line-by-line
  review modal (Copy to clipboard / Save to file via a new generic
  `viewer:saveTextFile` sink) — the app itself sends nothing. The import path
  parses the LLM's `{suggestions: {row_key: {name/object/means}}}` reply into
  a per-row approval checklist (with a select-all master toggle, a new opt-in
  on the shared `checklistModal`); only ticked rows apply, only to the
  human/LLM columns, and the vocabulary still needs an explicit Save.
- **Data posture** (§C4) — `data_posture: sealed | reviewable | open`
  (new `viewer/posture.js`, persisted in viewer user-config at
  `pdt.dataPosture`, default `reviewable`), displayed and settable on the
  Overview header line. **`sealed` removes every Copy-for-LLM button from the
  DOM** (not hidden/disabled — the egress promise is enforced by code,
  mirroring the empty-allowlist egress guard), live on change via a posture
  bus. Pinned by `e2e/vocab-smoke.js` (§C2 checklist + §C3 export + §C4
  sealed) and two new `e2e/overview-smoke.js` checks.

### Added (Phase B)

- **"Where the time goes" instance strip** (§B1) — the Analysis level's
  time-study stats table is replaced by one row per step group (name, N,
  total) with **one clickable dot per observed instance** on a shared
  duration axis; a dot jumps the Flow timeline to that instance. The A5
  small-N gate relocates: summary statistics (mean/stdev/percentiles) render
  as a per-row line only at ≥ 10 instances. Render change only.
- **Time-weighted Flow diagram** (§B2) — `buildAnnotationDfg` edges gain an
  additive `total_ms` (entering source group → entering target group, summed
  per traversal); the default screen-grain session map (and the aggregate
  grain ladder) weighs edge thickness/labels by accumulated transition
  **time**, with the traversal count one hover away in a new edge tooltip.
  Count weighting stays for the taxonomy DFG and as the honest fallback when
  no time was measurable.
- **Step-BPMN Tier-2 lock** (§B2) — the element/step-grain observed Process
  diagram renders only when `analysis.case_quality.tier2_unlocked`; locked,
  the host shows the replace-pattern line (why + anchor-candidate count + a
  "Review on Overview" CTA) instead of a case-flow diagram.
- **Expert drawer** (§B2) — the off-contract map cells (activity-taxonomy
  level in both notations = the inductive-miner BPMN; per-case BPMN files)
  leave the default notation×level matrix into a collapsed, labelled
  `<details>` under the map. Files + CLI flags unchanged.
- **PDD findings-first** (§B3) — `pdd_export` §1 is now the findings memo
  content, rendered from the same `build_memo_model()` (findings +
  `memo_selection`) as the memo exports — one source of truth; the long-form
  body renumbers behind it (2 control · 3 introduction · 4 As-Is ·
  5 automation · 6 exceptions). Honesty parity: the efficiency ratio gates
  on an analyst `bnva_ms` override; cycle times (4.4) and path variants (6.1)
  gate on `tier2_unlocked` with the replace-pattern note.
- **Word memo** (§B4) — `--memo-out` is repeatable and renders by extension:
  `.docx` produces the Word memo with the starred evidence screenshots
  embedded inline (same path-containment check as the PDD); the Overview
  export button writes `memo.docx` + `memo.md` in one run.
- **Short repetition labels** (§B4) — repetition findings render
  `app — first 2 steps … (+N more)` capped ~60 chars in claims/memo/PDD; the
  full segment label stays in the finding's evidence (additive `short_label`).
- **`e2e/map-slim-smoke.js`** (§B5) — the Phase B merge gate: time-weighted
  default map, tooltip count, unlocked step BPMN on the marked demo, the
  locked replace-pattern + working CTA on a marker-stripped copy, Expert
  drawer cells, zero page errors.

---

Phase A of the honesty redesign ([docs/LAB-PHASE-SPEC.md](docs/LAB-PHASE-SPEC.md)):
the pipeline grows three additive Tier-1 blocks in `analysis.json`, a findings
memo export, and the viewer gets a new default **Overview** level that leads
with measured claims.

### Added

- **`analysis.case_quality`** (§A1, `normalization/case_quality.py`) — the
  Tier-2 gatekeeper: how cases were derived (`markers` / `anchor` /
  `unsegmented`), case count, interaction coverage, and the single
  `tier2_unlocked` flag (mode != unsegmented AND coverage ≥ 0.7) that gates
  every case-based surface.
- **`analysis.facts`** (§A2, `normalization/facts.py`) — Tier-1 measured
  facts, no heuristics: active/idle time, top apps with share, app-switch
  cadence, longest unbroken focus, values re-keyed across 2+ apps, repeated
  step-sequence count. Computed even for a step-less session, so
  `analysis.json` now writes whenever the pipeline runs.
- **`analysis.findings[]`** (§A3, `normalization/findings.py`) — a detector
  library (screen_time_sink, fragmentation, waiting, repetition,
  backtracking, rekey_transfer, coverage_caveat) emitting comparative/factual
  claims with evidence (numbers + step/event ids + screenshot refs) and a
  per-finding confidence note. Detectors fire only when their preconditions
  hold; each is best-effort.
- **`normalization/motifs.py`** (§A3) — the sequence-motif miner ported as-is
  from the parked ML branch (stdlib), plus A→B→A bounce detection and a
  maximal-motif filter so the repeated-sequence count isn't inflated by
  overlapping sub-windows.
- **`--memo-out <path.md>` memo export** (§A4, `normalization/memo_export.py`)
  — a ~2-page findings memo: fact strip, selected findings with evidence and
  starred screenshot refs, a Tier-2 section that renders only when
  `case_quality` unlocks it (one honest line otherwise), and a "to say more"
  box enumerating the missing inputs. Templated sentences + measured numbers
  only.
- **Viewer: Overview level** (§A5, `viewer/views/overview-view.js`) — a new
  first entry in the view-mode bar and the **default level on session load**:
  case-quality badge (✓ Markers / ✓ Anchor / ⚠ Unsegmented + a Tier-2
  lock chip) → anchor hero (unsegmented sessions only; Accept/Dismiss reuse
  the existing flow-view-markers wiring) → 6-tile fact strip → findings feed
  (claim + evidence + "Show on timeline" + an "include in memo" checkbox
  persisted to the additive `annotations.memo_selection[]`) → "to say more"
  box → memo export button (`--memo-out` through the normalize IPC, then
  reveal). Guarded by the new `e2e/overview-smoke.js` gate (both badge
  states, fact tiles, memo export, zero page errors, clip check).

### Changed

- **Honesty gates on existing surfaces** (§A5, surgical): the Analysis
  view's process-efficiency ratio (and the session-summary Efficiency tile)
  are **withheld until an analyst sets any `bnva_ms` override** — while
  business-required defaults to 0 the ratio is an artifact, not a
  measurement; the section states why and how to enable it. The time-study
  table renders distribution columns (mean/stdev/P50/P95) **only when a
  step type reaches 10 instances** (and only at the element grain, where
  they exist in the data); below that it shows instances + total + range.
- `analysis.json` is now written for **step-less** sessions too (the Tier-1
  blocks need no steps); the classic step-grained blocks stay empty there.

## [0.22.2] - 2026-06-01

A fix-only patch from stress-testing "Discover from window" against the two
hardest Chromium targets (live Spotify desktop + Discord). The C# recorder
captures both well (Discord 99.8% named, emoji intact) — the gaps were downstream
in the discovery pipeline.

### Fixed

- **Non-ASCII control names are no longer corrupted (mojibake).** The viewer pipes
  the snapshot to `discover_vocab.py` over stdin as UTF-8, but Python defaults
  stdin to the Windows ANSI codepage (cp1252), so emoji channel names and the "•"
  separator arrived as mojibake ("â€¢"). `discover_vocab.py` now decodes stdin as
  UTF-8 explicitly (raw-buffer decode), and the spawn sets `PYTHONUTF8=1` as
  defense-in-depth. Verified end-to-end on live Discord: 19 emoji names preserved,
  0 mojibake. Pinned by a cp1252-stdin regression test.
- **"Discover from window" no longer fails on a slow/large window.** A big Chromium
  a11y tree (Discord) walks at ~35 ms/node, so two passes exceeded the 30 s budget
  and discovery failed outright ("snapshot timed out … 1/2 passes"), discarding a
  *completed* first pass. The budget is now 60 s (room for two passes — Discord's
  finish in ~40 s), and on timeout a completed pass is **used** rather than thrown
  away (honest degrade to single-pass / pattern-based volatility). The capture
  confirm dialog drops the misleading "~2s" estimate.

### Notes

- **Discovery quality on rich web/Electron apps is actually good — the editor's
  ranking hides it.** Live probes: Spotify desktop 96% usable signatures (876
  name-keyed of 1,169), Discord 99.8% named. But the frequency-first ordering
  floats over-merged hashed-class buckets and repeated decorative text to the top,
  burying the useful named controls. A discovery ranking + noise-filter pass is the
  recommended next step (deliberately **not** in this patch).

## [0.22.1] - 2026-06-01

A fix-only patch. "Discover from window" ([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md))
worked from a dev tree but failed on a deployed/packaged viewer with **"recorder.exe
not found"** — the viewer doesn't bundle the recorder (it's a capture-app binary),
and the resolver had no path to a deployed capture install. Caught by running the
packaged viewer as it would run on a destination PC.

### Fixed

- **"Discover from window" now finds the recorder on a destination PC.** The
  packaged viewer ships without `recorder.exe` by design (it lives in the capture
  app), so a viewer-only machine hit "recorder.exe not found." The resolver
  (`recorder-snapshot.js`) now probes a **sibling capture app folder**: with the
  `viewer/` and `capture/` release folders extracted side by side, the viewer finds
  `…/capture/resources/publish/recorder.exe` (it also scans other sibling app
  folders, so a renamed pair still pairs up). `PDT_RECORDER_PATH` still overrides,
  and the dev tree still resolves via the repo's `capture/`. The error message now
  names the deploy fix. Pinned by `recorder-snapshot.test.js` (dev / sibling /
  renamed-sibling / dedup / readdir-failure layouts).

### Deploy note

- **Discovery needs the capture app deployed alongside the viewer.** Extract both
  `viewer/` and `capture/` from their release zips into the same parent folder.
  Everything else in the viewer (analysis, normalization, PDD export) is standalone;
  *only* "Discover from window" reaches into the sibling capture for its recorder.

## [0.22.0] - 2026-06-01

App Library "Discover from window" ([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md))
becomes legible and lossless. A real-run discovery of a browser-hosted web app
(Spotify in Chrome) surfaced that the editor was silently *erasing* the one kind
of signature such apps produce, and that a discovered row carried no context to
name it by. Both fixed; discovery now enriches each row with the context the UIA
walk already captured.

### Fixed

- **`class_name`-keyed signatures are no longer dropped on Save (data loss).** A
  control with no stable id and no accessible name is keyed by the picker on its
  `class_name` (ADR-0023 confidence 0.4). The App Library editor modelled only
  `control_type` / `automation_id` / `name` / `window_title_regex`, so a
  `{class_name: …}` signature rendered as a blank **"(unset signature)"** *and was
  rewritten to `{}` the moment you saved* — captured, shown blank, erased.
  `class_name` is now a first-class, editable signature field that survives the
  round-trip (`vocab-view.js`); `canonical-author.js::vocabSignatureKey` gained the
  `cn` branch Python's `_snapshot_sig_key` already had, so re-discovery dedups it
  instead of re-adding duplicates.
- **`PDT_APP_VOCABULARIES` was broken on Windows.** The viewer split the extra-dirs
  list on `/[;:]/`, shredding drive-letter paths (`D:\…`) at the colon. It now
  splits on `path.delimiter`, matching Python's `os.pathsep`.

### Added

- **Annotator context on every discovered row ([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md)).**
  Discovery captures far more than the signature keys on; the surplus used to be
  discarded at `bootstrap_from_snapshot`. Each entry now carries — as discovery-meta
  (shown in the editor, stripped on save, like `confidence` / `identity_source`) —
  the UIA **role**, the **framework**, a value-free on-screen **region** (a 3×3
  bucket from the control's bounds), the tree **ancestry**, and an honest
  **weak-signature note**. A row reads "button · bottom-left · chromium · under
  Window › Pane — weak, keyed on class_name" instead of a contextless blank.
- **Over-merge transparency.** A generic `class_name` with no label collapses
  genuinely *distinct* controls under one `seen_count` — a "×5" that hides five
  different buttons. The merged members are now kept and listed per row
  (`bootstrap_from_snapshot` `_members`), so the analyst can see what a weak bucket
  actually contains and split a wrong merge.
- **`e2e/vocab-smoke.js`** — a new in-repo gate that drives the REAL viewer App
  Library: asserts the enriched row renders legibly (no clipped labels) and that
  the `class_name` signature survives Save. Wired into the e2e `test` script
  alongside `session-smoke.js`.

## [0.21.0] - 2026-06-01

A coherence + capability cycle on top of 0.20.1: the process maps and Compare
panels became real drill-downs, the per-step flag model was corrected, and the App
Library gained delete + a point-and-click "Discover from window".

### Added

- **Delete an App Library vocabulary.** Each entry in the App Library list now has
  a delete (✕) affordance (reveals on row hover / when selected) with a confirm —
  the inverse of "+ New" / "Discover", which was missing. Analyzed sessions keep
  their results; only future analyses stop using the deleted vocab. Guarded
  (`viewer:deleteVocab`): refuses anything that isn't a `.yaml/.yml` inside a known
  App Library dir.

### Changed

- **"Discover from window" is now point-and-click ([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md)).**
  The old flow snapshotted the *foreground* window — but clicking the "Snapshot"
  button made the viewer itself the foreground, so it grabbed the wrong window (a
  misclick/misread trap). Now: **"Point to a window…" → the recorder enters standby
  → you click the target window → a confirmation shows which window you picked →
  only then is it snapshotted.** New recorder `pick` command (`WindowPicker.cs`,
  polls for the next click, resolves the top-level window under the cursor) +
  `pickWindow()` / `viewer:pickWindow`; discovery then snapshots that specific HWND
  (the recorder already accepted an HWND target). Esc or a 35s timeout cancels.

- **Compare-Sessions panels are now drill-downs, not just bars.** The Activity-
  frequency and Case-duration bars highlighted on hover but did nothing on click
  (a dead affordance). Now: clicking an **activity** filters the whole Compare
  surface to it (`#agg-filter`; inverse = clear the box); clicking a **case** opens
  its source session in the Session view and seeks the Flow timeline to where the
  case begins. The hover/cursor affordance is shown **only** on bars that are
  actually clickable (`renderBarChart` `onBarClick`), so non-interactive charts no
  longer advertise a click they can't honour.
- **Per-step flags reduced to `waste` ([ADR-0027](docs/adr/0027-retire-per-step-path-flags.md)).**
  The step detail dropped the `Conditional`, `Exception path`, and `Automation
  candidate` checkboxes — a single step is not a path or a segment, so those never
  had a coherent per-step meaning. The concepts are sourced where they belong:
  automation candidacy from coherent segments (ADR-0016), exceptions/variations
  from the observed trace variants, conditionality from the map's branch
  frequency. **`waste` stays** (a genuine per-step value-add judgment that feeds
  the efficiency analysis). PDD **§5 "Exceptions & variations" is re-sourced from
  `stats.trace_variants` + rework loops** instead of the retired flags. Legacy
  `annotations.json` keys are ignored, not migrated; golden-neutral.

### Removed

- **Activity/Case panel sparklines.** The tiny 10-bucket time-distribution
  histograms next to each bar carried no actionable insight (just decoration) and
  had no legend — removed.

## [0.20.1] - 2026-05-31

A UI-polish + accessibility patch on top of 0.20.0 — no new capability.

### Changed

- **UI density pass (viewer + capture).** Reduced always-on chrome without
  removing any capability: the viewer merges the session facts into the actions
  bar (one row, was two), relocates the mined-BPMN status into the Map panel
  header, compacts the VOCABS pill (full app list → tooltip), tucks the
  destructive Hide/Delete step actions behind a `⋯` overflow (Split/Merge stay
  visible), groups the Compare export menu, and makes per-view help dismissible.
  Capture consolidates the tray's parallel Quick-start submenus into one carrying
  a "Nest under current" checkbox, and caps the operator-panel saved-label
  quick-pick height (scrolls) so a long list can't push the live controls off.

### Fixed

- **Capture dialogs pin their action footer.** Profile and Session-setup now
  scroll their content inside a `.scroll` region with the hint + **Save/Cancel**
  footer pinned (consistent with Settings) — the action buttons are always visible
  without scrolling, even on a short window.
- **Muted-label contrast now clears WCAG AA**, per the design system's own
  ≥4.5:1 intent. The viewer light-theme `--fg-3` (muted labels) was **3.03:1** on
  `--bg` — below AA for small text; darkened `#9a8e7e → #786c5a` (≈4.84:1, still a
  warm taupe). The capture windows' `--fg-3` was a no-margin **4.5:1**; nudged
  `#807E78 → #8E8C82` (≈5.4:1). Dark themes already passed and are unchanged.

### Docs

- A concrete in-repo recipe for launching/driving the viewer for UI validation
  (the `e2e/` harness, no out-of-repo deps) + the DOM-handle map, in
  CHIP-GUARDRAILS.md — so a fresh chipped session can validate UI without
  rediscovering how.

## [0.20.0] - 2026-05-31

The big push toward a small internal rollout — a deliverable-first cycle that
hardened the foundation, landed the commercial closer, and made the recorder and
vocabularies real against probed apps. **Foundation (Wave 0):** an in-repo e2e
merge gate (the real viewer, asserts + exit codes), a session golden over all 10
demo sessions, a calibration config surface, the `normalize()` and `flow-view.js`
god-file splits, a Node-side egress guard, the first `Recorder.Tests` C# suite,
and an ADR-registry CI guard ([CHIP-GUARDRAILS.md](docs/CHIP-GUARDRAILS.md)).
**Commercial closer:** the €-ROI layer (`analysis_roi.py` → Session Analysis panel
+ PDD §4.4) projects each automation candidate into a conservative/expected/
optimistic savings band, with candidates ranked by priority. **Real capture &
vocab:** recorder capture-confidence ([ADR-0023](docs/adr/0023-recorder-capture-confidence.md)
— honest degradation on hard frameworks), probed App Vocabularies (Office /
ServiceNow / Salesforce / Jira / Zendesk) and point-and-learn discovery
([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md)). **Analyst surface:**
the view-time grain slider ([ADR-0024](docs/adr/0024-step-grain-as-view-time-rollup.md)),
Reference Maps ([ADR-0019](docs/adr/0019-reference-maps.md)), and the
map-readability fixes (value-free screen axis + dagre left-to-right, pinned by the
e2e connectivity check). **Privacy & platform:** structural PII masking + a capture
consent gate (§11f); Electron 33 → 42 and `dagre → @dagrejs/dagre` (0 npm-audit
advisories); click-to-RCE hardening on the screenshot-open path. Distribution stays
**unsigned by design**, and scope is fixed as a services boutique
([ADR-0026](docs/adr/0026-distribution-unsigned-and-services-boutique-scope.md)).

### Added

- **Reference Maps — decoupled, fully-editable BPMN copies of a mined map ([ADR-0019](docs/adr/0019-reference-maps.md)).**
  From the Process diagram, **⑂ Fork map** snapshots the current cell into a
  standalone `.bpmn` the analyst edits with the full bpmn-js palette — a **one-way
  leaf** the pipeline never re-mines, merges, or regenerates. Copies live in a
  per-session **Reference maps** gallery (`derived_maps/<map_id>.bpmn` + an
  `annotations.json reference_maps[]` row), are typed **As-Is / To-Be / Reference**,
  and carry visible provenance (forked-from cell + date, "hand-edited, not updated
  by analysis") with a **drift** chip + **Re-fork** when the source map later changes.
  A selected **To-Be** map embeds in the PDD's new **§4.5 Proposed to-be process**
  (captioned as analyst-authored, not mined); a selected **As-Is** copy can override
  the mined As-Is image. "What you see is what you fork" (the laid-out live view is
  snapshotted, not the raw mined file); the editor skips auto-layout to honour the
  hand-positioning. Every verb (fork / rename / kind / PDD-role / delete) is
  Ctrl+Z-able, and the copies survive re-analyze untouched. Reuses the vendored
  bpmn-js modeler (palette un-hidden off `.map-host`), the existing `saveXML`-to-path
  persistence, and the existing PDD image bridge (`exportSvg` → off-screen PNG raster
  → `--pdd-tobe-image`). See [SCHEMA](shared/SCHEMA.md) §`reference_maps`.
- **Step grain is a view-time roll-up — one grain slider across Flow / Steps / Map ([ADR-0024](docs/adr/0024-step-grain-as-view-time-rollup.md)).**
  Segmentation stays at the finest grain; how far steps consolidate is now a
  reversible **view** control, not a destructive normalize-time flip. A node/step
  at the chosen notch is a run of consecutive steps within a case sharing that
  notch's key, over the UI-containment ladder `element ⊂ screen ⊂ app ⊂ phase ⊂
  case`. Default resting notch = **screen** ("one step per screen"). Sliding back
  undoes it with zero data mutation; raw `events.jsonl` is untouched.
  - **P1 — containment keys on steps.** Every step now carries `grain_keys`
    (`{element, screen, app}`) resolved from its interactions at analyze time
    (`step_suggest.step_grain_keys`): `element` = the field typed into, `screen`
    = the vocab `screen_id` else `window_title`, `app` = `process_name`. The
    `phase` / `case` notches read the step's existing `phase_id` / `case_id`.
    Stamped on auto, canonical-matched, and preserved steps alike; a
    hand-authored step gets `(element/screen/app)` placeholders the viewer
    refines at view time. Additive — the golden projection is unchanged. See
    [SCHEMA](shared/SCHEMA.md).
  - **P2 — view-time roll-up engine.** `process-map-levels.rollUpSteps(steps,
    notch)` folds a session's steps into one group per run of consecutive
    (per-case) steps sharing the notch's key; `element` is identity (every step
    shown — the fine count is reproduced exactly), `screen`/`app`/`phase`/`case`
    consolidate. `buildAnnotationDfg` is generalised from "same `process_label`"
    to "same key at the chosen notch" (back-compatible: `step`/`phase` unchanged).
    A view-time `resolveStepGrainKeys` fallback derives the keys from events for
    sessions analyzed before `grain_keys` existed. No re-normalization on a notch
    change. Verified on real captures — the `element` notch reproduces the fine
    counts exactly (Outlook 9, Excel 8, demo 64) and `screen` consolidates
    sensibly (3, 4, 19); the demo's coarse end is ~15 at the `app` notch.
  - **P3 — one grain slider across Flow / Steps / Map.** A single **Grain**
    slider in the Session view-mode bar (notches element/screen/app/phase/case,
    default **screen**) sets a shared `State.grain`. The Steps list rolls up to
    the notch — one row per consecutive run, with a fold count, read-oriented
    (click a group to edit its first member; slide to `element` to edit every
    step). The Map's level selector is folded into the same ladder and synced
    with the slider (the old Activity level stays as a taxonomy escape hatch);
    the Flow diagram (DFG) rolls up live, and the Process diagram (BPMN) — mined
    only at the Element/Phase grains — falls back to the Flow diagram for
    screen/app/case rather than rendering a dead host. No re-normalization on a
    notch change; sliding back restores the detail. e2e (`session-smoke.js`)
    pins the slider, the element↔screen consolidation (demo 64↔19), and the
    €-ROI total holding invariant across notches.
  - **P4 — €-ROI total is provably notch-invariant.** The grain is a *view*
    control, so it never re-runs the pipeline: the €-ROI is computed once from
    event-stream segments (ADR-0016) and the slider can't move it. This is the
    load-bearing reason the roll-up is view-time rather than a normalize-time
    flip — re-segmenting *would* move the total (demo 0.01→0.02 h/yr), so grain
    must not re-segment. The step-grained itemisation (Steps, Map) follows the
    notch; the segment-grained ROI/automation list sits above the step grain and
    stays put, with the total invariant either way. New `analysis_roi` tests pin
    that the total is a pure, order-insensitive sum over candidates (re-itemising
    or re-ranking can't move it); the Analysis panel states the invariance.
  - **P6 — grain reaches every view (deferred follow-ups).** The
    **Compare-Sessions** map gains the same grain ladder (its level select →
    element/screen/app/phase/case + Activity, synced to `State.grain`, BPMN→Flow
    fallback for screen/app/case). The **Analysis** Time study + Waste-by-step
    re-itemise by the current notch at view time (the €-ROI headline total stays
    invariant), and the **Flow** timeline's step lane rolls up to the notch — so
    the single grain control drives Flow / Steps / Map / Analysis and Compare.

### Fixed

- **Process maps now lay out left-to-right instead of as a radial hub / scrambled
  diagram — `dagre` was never actually wired up.** Both renderers were written to
  re-lay-out with `dagre` (the comments say "dagre is a global loaded in
  index.html"), but it never was: `index.html` loaded `cytoscape-dagre` but not a
  `dagre` global, and nothing assigned `window.dagre`. So the **Flow diagram (DFG)**
  silently fell back to cytoscape's `breadthfirst` — a **radial hub** that turns
  any flow with a busy node (SAP) into an unreadable star — and the **Process
  diagram (BPMN)** `applyDagreLayout` returned early and rendered the mined file's
  weak coordinates (`end` stranded mid-flow, edges crossing). This affected *every*
  session, not the demo I'd been spot-checking. Fix: `dfg-viewer.js` requests the
  `dagre` layout whenever the (already-bundled) `cytoscape-dagre` extension is
  registered, and `bpmn-viewer.js` `require("@dagrejs/dagre")` directly. Result —
  Flow + Process diagrams render as clean left-to-right layered flows at every
  grain (screen/app DFG: radial star → LR chain; activity BPMN: `end` now rightmost).
  `e2e/session-smoke.js` gains a **layout-readability pin** (the screen-grain DFG
  must read left-to-right — source leftmost, sink rightmost, wider-than-tall —
  catching a silent fall back to the radial layout). NOTE: validated on the demo;
  the layout engine is topology-agnostic so it carries to taxonomy/real captures,
  but those should still be eyeballed.

- **Element-grain step maps no longer fan out per record because of a numbered
  window-title prefix ([ADR-0024](docs/adr/0024-step-grain-as-view-time-rollup.md) §6a).**
  A step's auto-name is `"{window-title app prefix}: {action}"`; for browser apps
  the window title carries the record id in the prefix (`Create INC0010010 |
  Incident | ServiceNow`), so the value-free `process_label` still differed per
  case and the element-grain map split into per-record combs. The window-title
  prefix (`step_suggest._short_app`) now passes through a value-free strip
  (`screen_label`) that removes embedded record numbers / id tokens — sharing the
  rules with the viewer's `screenType` via the new
  **`shared/screen-label-patterns.json`** (single source, no hand-synced regex;
  the id rule is uppercase-led so codes that ARE the name, e.g. SAP `va01`,
  survive). Real ServiceNow element grain: **44 → 18 nodes, 3 → 1 sink**. Golden-
  neutral (the demo window titles carry the app name before the first separator,
  so the strip is a no-op there — verified).

- **One logical screen is now one screen-grain node, even when the vocab only
  partially matches a form ([ADR-0024](docs/adr/0024-step-grain-as-view-time-rollup.md) §6b).**
  An App Vocabulary assigns a value-free `screen_id` (e.g. `incident`, `compose`)
  only to interactions whose *control* matched a vocab signature; an interaction
  on the same form whose control isn't in the vocab got no `screen_id` and fell
  back to the raw `window_title`. So a step with no vocab-matched control split off
  as a distinct per-case screen node (`incident` *and* `Create INC0010010 |
  Incident | ServiceNow`), and the screen-grain map showed a duplicate-screen
  loop. `app_vocab.enrich_events` now tags every in-scope interaction with the
  screen whose `window_title_regex` matches (`_screen_by_window`), independent of a
  control match — so one form is one screen. It is a *screen tag only*, not a name
  match, so it does **not** inflate the vocab match-rate / coverage. Verified on
  the real ServiceNow capture: 7 window-title screen variants → **1 `incident`
  node**. Golden-neutral (step naming uses the window-title app prefix, not
  `screen_id`); new `test_app_vocab` test.

- **Process diagram (BPMN) steps now lay out in execution order — a loop/redo
  gateway no longer scrambles the diagram.** The pure-Python BPMNDI layout
  (`mining._layout`) ranked nodes by longest-path over the *raw* edge set, so a
  single back-edge from an inductive-miner loop/redo gateway (e.g. `SAP: Create
  sales order → <upstream gateway>`) inflated the rank of everything past the
  loop. The mined step/phase **and activity** Process diagrams rendered with steps
  **out of execution order** (`Outlook: Send` left of `Outlook: Enter To`) and the
  end event **stranded mid-flow**. Ranking now runs over the **acyclic forward
  edge set** (`mining._forward_edges` strips DFS back-edges before ranking; the
  back-edges are still *drawn*, only the column assignment ignores them), so the
  linear spine stays ordered left→right with the start leftmost and end rightmost.
  The Flow diagram (DFG) was already correctly ordered — this was a Process-diagram
  layout bug only, pre-existing and independent of ADR-0024. Verified in the viewer
  on the demo single-session and 10-session aggregate step BPMN; golden-neutral
  (the golden projection never read BPMN DI); pinned by a new `test_bpmn_observed`
  cycle test.

- **The default (screen-grain) Flow diagram no longer fans out into a per-case
  hairball ([ADR-0024](docs/adr/0024-step-grain-as-view-time-rollup.md) regression).**
  The screen grain key resolved to the raw `window_title`, which routinely embeds
  the case value ("Salesforce - Order #10900", "Outlook - Order #10852
  confirmation"). Grouping on the raw title made the *same* logical screen a
  *distinct* node per case, so the default Flow diagram (DFG) and Step/Screen maps
  rendered as a tangle of orphaned per-order nodes instead of a clean linear chain
  — the 10-session demo aggregate at the screen notch had **76 nodes / 35 distinct
  end-nodes**. The screen axis now groups **value-free** (`process-map-levels.screenType`),
  stripping embedded record numbers / id tokens the same way `process_label`
  strips step values — so one "Salesforce - Order" screen collapses to one node
  across every case while genuinely-different screens ("Account lookup" vs "Credit
  check") stay apart. Demo aggregate screen-grain map: **76 → 6 nodes, 35 → 1 end
  node**, a single connected chain. Pure presentation — applied at view time, raw
  `grain_keys` untouched (detail is never destroyed), no re-normalization, no
  golden change. The fix lands inside `grainKey`/`grainLabel`, so the Map, the
  Steps list, and the Analysis "Waste by screen" itemisation all inherit it.
  `e2e/session-smoke.js` gains a **map-connectivity pin** (the screen-grain DFG
  must be one component with one start and one end); short transaction codes like
  `va01` are preserved (the digit-run threshold is 3+).

- **In-app vocabulary discovery: "point-and-learn" ([ADR-0025](docs/adr/0025-in-app-vocabulary-discovery.md), [build spec](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/To-Do/SELF-SERVICE-VOCAB-DISCOVERY-SPEC.md) on branch `product-edition`).**
  Turns the manual real-value UIA probing ([REAL-VALUE-TESTING.md](docs/REAL-VALUE-TESTING.md))
  into a shipped, on-device, self-service feature: the analyst points at a
  prepared window and gets a named-able, stable-signature App Vocabulary
  skeleton (no dev box, no off-box agent, nothing leaves the machine).
  - **P1 — recorder `snapshot` command.** A new stdio command alongside
    `hello`/`pause`/`resume`/`shutdown`: `{cmd:"snapshot", target:"foreground"|<hwnd>, passes:2}`
    walks the target window's UIA subtree once per pass and streams every
    identifiable control as a `snapshot_control` line (`control_type` /
    `automation_id` / `name` / `class_name` / `framework_id` plus ADR-0023's
    `framework` / `identity_source` / `confidence` / `bounds`, with `depth` /
    `role` / `pass`), then a `snapshot_done` per pass. Two passes ≥1s apart let
    the picker diff for volatile ids; capped at ~2000 controls; wakes a
    Chromium renderer's lazily-built a11y tree first. Transient — never written
    to `events.jsonl`. The pure traversal (`SnapshotWalker` over an
    `ISnapshotElement` seam) is pinned by new `Recorder.Tests`; the production
    single-file recorder build stays green.
  - **P2 — the volatility-diff signature picker (the clever core).** New
    `normalization/signature_pick.py` joins the two-pass snapshot's controls by
    a *stability-independent* key (role + label + ancestry + bounds bucket —
    never the candidate id), marks an `automation_id` **volatile** when it
    changed across passes *or* matches a per-render pattern (`^input-\d+$`,
    `^combobox-(input|button)-\d+$`, bare GUID, …), then picks the most-stable
    identity down the ADR-0023 ladder, **skipping volatile fields** — turning the
    analyst's "which id is real?" guess into a measured fact.
    `app_vocab.bootstrap_from_snapshot` builds a named-able skeleton over the
    full control set (name pre-filled from the label, screens grouped by window
    title, each entry carrying the picked `identity_source` / `confidence` /
    `volatile_aids`). The **ground-truth test** (`test_signature_pick.py`)
    validates the picker against the committed hand-probed vocabs: it KEEPS the
    stable ids (Office `FileSave`, ServiceNow `incident.short_description`,
    Outlook `4117`, Jira `summary-field`) and **DEMOTES** Salesforce `input-378`
    / Zendesk auto-ids to the accessible label. Pure-Python; the session-golden
    is unchanged (discovery is purely additive).
  - **P3 — App Library "Discover from window".** A new button on the App Library
    tab: point at a prepared app window and the viewer spawns the recorder for a
    two-pass snapshot (`recorder-snapshot.js`), runs the picker +
    `bootstrap_from_snapshot` via the bundled Python
    (`normalization/discover_vocab.py`), and loads a stable-signature skeleton
    into the editor. Each discovered interaction shows **why** its signature was
    picked — the `identity_source` rung + ADR-0023 confidence, and the rejected
    volatile id(s) (the legend). **Re-discovery merges** into the selected vocab:
    new controls are added, analyst-named ones preserved (never overwritten),
    screens merged additively, a tuned scope left intact. Entirely on-device —
    the recorder snapshots locally, nothing is written until Save, and
    discovery-provenance fields are stripped from the persisted YAML. End-to-end
    verified against a live window (snapshot → discover → skeleton).

- **Recorder desktop-coverage hardening (§11e, [ADR-0023](docs/adr/0023-recorder-capture-confidence.md)).**
  The C# recorder now reports per-element capture quality so the moat degrades
  *honestly* instead of silently producing thin captures on hard frameworks.
  Every interaction gains four additive signal fields (following the
  `coverage_hint` precedent — emitted, allowlisted, schema'd, surfaced in the
  structure-only `scripts/inspect-events.js`, consumed by the analyst not the
  pipeline):
  - `framework` — a **normalized UI-toolkit** detection
    (`win32`/`winforms`/`wpf`/`winui`/`chromium`/`java`/`javafx`/`qt`/`remote`/
    `terminal`/`unknown`) re-derived from `framework_id` **+** the window class,
    so toolkits that misreport their `framework_id` (Java/Qt report `Win32`;
    Citrix/RDP wrap a foreign session) are recognised by their platform-stable
    window class. Distinct from the recognition layer's web-app `framework` axis.
  - `identity_source` — the **identity-ladder rung**
    (`automation_id` → `name` → `class_name` → `ocr` → `none`).
  - `confidence` — **per-element capture confidence** in `[0,1]`, blending the
    rung with the toolkit (capped at `0.30` on `remote`/`terminal` surfaces).
  - `value_source` — flags a value **recovered** off the primary ValuePattern
    path via `TextPattern` (`text_pattern`), generalizing the AG-Grid fix.
  - **OCR last resort** (`ocr_text`, default-off via `interactions.ocr`): an
    identityless element's on-screen region is captured and labelled via
    `Windows.Media.Ocr` — a Win10+ **system API** (on-device, no bundle
    inflation; not Tesseract). A genuine last resort, gated to
    `identity_source == "none"`.
  - **Deployment rules** ([DEPLOY.md](docs/DEPLOY.md)): run the recorder
    *inside* a Citrix/RDP session (a `framework: "remote"` capture means you're
    on the wrong side of the glass), and lean on the **local video backstop**
    where structured capture can't reach.
  - The recorder's decision logic is pinned by the new `Recorder.Tests`
    (framework detection, identity ladder, confidence, value recovery, OCR
    gating, and a headless OCR-engine round-trip). The single-file build moved to
    TFM `net8.0-windows10.0.19041.0` for the WinRT surface (publish + startup
    verified). Live validation against real Java/Qt/Citrix apps is deferred.
- **Pre-built App Vocabularies (§11d, no-LLM bootstrap).** Ships a curated
  starter set under `normalization/app_vocabularies/` — `salesforce.yaml`,
  `sap-gui.yaml`, `excel.yaml`, `outlook.yaml`, and a browser-chrome
  `chrome.yaml` — bootstrapped from the committed `example-aggregate` demo via
  `normalize.py --bootstrap-vocab-out` and curated (meaningful names, screens,
  flags). Signatures are on `control_type` + `automation_id` + `name` (never CSS
  selectors). A new `app_vocabularies/README.md` documents the set and how to
  author your own; the old `sample-salesforce` / `sample-outlook` worked
  examples are replaced. Verified by re-normalizing the demo: the four desktop
  apps enrich at 100% coverage (114 interactions named). As part of the
  predicted-vs-actual diff this exposed that the recorder reports the exe name
  with inconsistent casing (`chrome.exe` but `EXCEL.EXE` / `SAPGUI.exe`), so
  **vocab `scope.process_name` matching is now case-insensitive** (a vocab no
  longer silently misses the app it targets).
- **Capture-side worker consent gate (§11f).** A consent window
  (`capture/consent-window.js` + `ui/consent.html`, mirroring the existing
  `*-window.js` modules) can be shown at session start, and every
  `manifest.json` now carries a `consent` record. Configurable via
  `config.consent.mode`: `"off"` (default — no prompt, records
  `required: false`, preserving the prior start flow), `"per_session"` (prompt
  every start), or `"once"` (prompt once per worker + `version`, remembered in
  user-config). Declining **aborts the session start** — no folder is created.
  The C# recorder is unchanged. Pure record/decision logic lives in the
  electron-free `capture/consent.js` (unit-tested); the window's IPC round-trip
  and HTML escaping were verified in a real-run harness check.
- **Structural PII masking (§11f).** A new normalization stage
  (`normalization/pii_masking.py`) redacts sensitive UIA field **values** —
  password, SSN, card, CVV, PIN, secret/token, IBAN, routing/account number,
  matched by the field's tokenized name · automation_id · control_type — in the
  **derived** event stream only. Raw `events.jsonl` is never rewritten; masking
  applies to the in-memory copy that feeds events.csv / events.xes / stats /
  steps / analysis / maps. Each value is replaced by a one-way, join-preserving
  token `«category#hash»` (`sha256(session_id + ":" + value)[:8]`), so process
  mining still distinguishes distinct secrets while the original is
  unrecoverable. Privacy by default; the analyst-owned `pii_masking_config`
  can disable it or add custom rules, and the rule-set that ran is recorded in
  the additive `pii_masking` annotations key. Pinned by deterministic unit tests
  and a seeded property-based fuzzer (immutability + no-leak + join-preservation
  invariants).
- **Automation-candidate ranking (§11f).** `analysis_automation.score_automation`
  now scores each candidate by automation priority — `instance_count × mean
  elapsed time × automatable fraction` (the same fraction the €-ROI layer resolves
  from `roi_inputs`, per-segment override aware) — and stamps a 1-based `rank` on
  the multi-instance candidates (single-instance rows get `rank: null`,
  `rank_score: 0`). The order feeds both the `roi` band and the PDD focus list, and
  surfaces as a `#` column in the viewer's Automation-candidates table and a Rank
  column in PDD §4.3. The previous instance-count-first ordering buried a
  rare-but-long segment beneath a frequent-but-trivial one.
- **€-ROI panel in the Session-view Analysis level (§11c — the commercial closer).**
  The Python ROI core (`analysis_roi.py`) already projected each multi-instance
  automation candidate into a conservative/expected/optimistic savings band; the
  viewer now renders it. The new "Return on automation (€-ROI)" section shows the
  band per candidate (hours/yr while no labour rate is set, € net/yr once one is),
  the expected-band session totals, and a band-encoding legend mapping each column
  to its realism multiplier. An **Edit assumptions…** form captures the session-level
  `roi_inputs` (loaded €/hr, currency, annual volume, build cost, amortization,
  automatable share, realism factors) and a per-row **tune** form captures per-segment
  overrides; both persist through the existing annotations + undo path
  (`saveAnnotationsWithUndo`) and trigger a re-analyze so the € recomputes in place.
  Honours the no-fabricated-wage rule — monetary figures stay withheld until a rate
  is supplied. No schema change (`roi_inputs` / `roi` were already in SCHEMA).

### Security

- **Click-to-RCE hardening on the screenshot-open path.** The `viewer:openExternal`
  IPC handler (the `shell.openPath` sink) now rejects absolute paths, `..`
  traversal, and non-image extensions, and confirms the resolved path stays under
  the active session's `screenshots/` directory before opening — closing a path
  where an attacker-planted file in a moved session folder could launch via Windows
  file association. The renderer's `openScreenshot()` adds matching defense-in-depth.
- **PDD export screenshot containment.** `screenshot_refs` from `annotations.json`
  are now resolved and skipped unless they stay within the session folder; absolute
  refs are rejected — closing an off-folder image-read / information-disclosure path.

### Fixed

- **Process map no longer overlays the Raw Events / Analysis sections** on the
  Session view's Map level. `.session-layout-map` carried the `min-height:0`
  flex-shrink trap already removed from the Steps/Phases layouts, so the map host
  painted down over the collapsible panels that follow it; the details now flow
  below the map and the view scrolls.
- **Captured marker/system events are no longer silently lost** on a failed
  `events.jsonl` write — the batch is logged, surfaced, and re-queued for retry.
- **Idle auto-end fires once per idle stretch** instead of re-firing every 5 s and
  emitting hundreds of duplicate boundary events; marker-close loops are now bounded.
- **OBS status failures are logged** and a missing recording path is surfaced
  (previously a failed `GetRecordStatus`/`StopRecord` was swallowed, leaving video
  the viewer could not locate).
- **One unreadable engagement folder no longer prevents the tray from launching**
  (`findOrphanedSessions` reads are guarded).
- **Canonical step spans absorb interleaved interior events** for the
  `until_app_change` / `until_pause` / `until_field_change` boundary modes instead
  of truncating the span on a non-matching interior interaction.
- **A long idle gap alone can now surface a suggested marker** (the idle-gap signal
  was mathematically below its own suggestion gate).
- **A malformed timestamp no longer crashes the pipeline** —
  `coalesce_typing_bursts` uses the lenient parser like the rest of the pipeline.
- **Phase membership stays consistent** (`phase.step_ids` ↔ `step.phase_id`) across
  step delete / split / merge, plus a Python reconcile pass after re-merge.
- **PDD renders steps that are not in any phase** (under "Unphased steps") and no
  longer renders hidden, noise-suppressed steps.
- **Saving an App-Library vocab preserves `seen_count`** and other unmodeled fields
  (they were being stripped on every save, losing the bootstrapped frequency rank).
- **Renaming a marker now goes through the undo stack** (it bypassed undo and made
  the next Ctrl+Z revert the rename).
- **PDD process-map embed failures are logged** instead of silently producing a
  placeholder map.

### Changed

- **Electron 33 → 42** in both the capture and viewer apps, returning to the
  supported-release window (Electron 33 no longer receives Chromium/V8 security
  backports). Unit suites stay green and the viewer boots/renders (BPMN, DFG,
  charts) under 42 with zero page errors; the packaged build still needs a
  real-run validation pass on the locked-down laptop before release.
- **Removed the unused `electron-builder` dev-dependency** (plus its `dist` script
  and `build` block) from both apps — distribution is via `@electron/packager`
  (`build-package.js`), not electron-builder. This clears every `npm audit`
  advisory (11 → 0; they were all in electron-builder's transitive tree).
- **Replaced the unmaintained `dagre` 0.8.5 with the maintained `@dagrejs/dagre`**
  fork, via `cytoscape-dagre` 2.5 → 3.0 (which bundles the fork). Dropped the now-
  redundant standalone `dagre` `<script>` tag from `index.html`. DFG layout
  verified unchanged in the harness (nodes positioned, 0 page errors).

### Tests

- **Golden corpus widened from 1 to all 10 `example-aggregate` sessions**
  (partial §11a). `golden_check.py` `REFERENCE_SESSIONS` now pins the whole
  committed demo set (order-to-cash at varying case volumes); each is
  re-normalized on its pre-recorded `events.jsonl` and diffed against a
  committed projection golden — **no recorder and no Electron in CI**. A new
  `corpus/README.md` sketches the narrow/bounded/wide tier roadmap and records
  that the demo set is the de-facto narrow tier and that live-recorder-in-CI is
  out of scope (needs a self-hosted desktop runner).

## [0.19.0] - 2026-05-29

**Phase 0 of the ML integration recommendation — non-ML, classical-statistics
support for unbracketed sessions.** Two complementary detectors close the
"worker forgot to fire markers, no Process Template configured" failure
mode that was the recurring cause of one-big-default-case sessions. Both
honour the suggest-don't-mutate invariant: detection lives in
`annotations.json`; the analyst Accepts or Dismisses; raw `events.jsonl`
is untouched. Zero new pip dependencies.

### Added

- **Suggested markers ([ADR-0017](docs/adr/0017-suggested-markers.md)).**
  A hand-rolled change-point detector (`normalization/marker_suggest.py`,
  ~420 lines, pandas + stdlib) walks the uncased stretches of the event
  stream and surfaces candidate Start/End boundaries on four heuristic
  signals — idle gap, return to a "home" app, transaction-ID-like value
  typed, app-cluster boundary (hand-rolled Union-Find over a Markov
  adjacency graph). Each suggestion gets a stable 12-char blake2b
  signature over `(marker_type, ts bucketed to 5 s, before_app,
  after_app, reason)` so dismiss and accept survive re-normalize.
  Candidates render as **dashed `.tl-marker.tl-suggested` bars** on the
  Flow timeline (with a new "suggested marker" chip in the legend strip)
  and as `.marker-row.suggested` rows in the markers side-panel with
  Accept (`✓`) / Dismiss (`✕`) buttons. Accept queues a real
  `marker_edits[]` `op:"insert"` with a `derived_from_signature` link
  for audit; the next normalize sees the link and drops the now-handled
  suggestion. Dismiss writes the signature to
  `marker_suggestions_dismissed[]`, suppressed on every future run.
  Both reversible via Ctrl+Z.
- **Anchor candidates ([ADR-0018](docs/adr/0018-anchor-candidates.md)).**
  A pattern-mining detector (`normalization/anchor_suggest.py`, stdlib
  only) ranks fields that look like case anchors. For each candidate
  `(automation_id, name)` field, the detector **simulates** what
  `case_assignment.detect_cases_from_anchors` would produce with that
  field as the anchor, then scores the resulting case structure on four
  signals — coverage, balance (1 − CV of case sizes), label diversity,
  focus (right-sized handful of cases). Top 5 surface as an
  **"Anchor candidates" panel** above the markers list. Accept writes
  a session-level `case_anchor_override` into `annotations.json`;
  `normalize.py` consults it BEFORE the marker-mode fallback so the next
  Analyze stamps cases by the chosen field. Dismiss writes to
  `anchor_candidates_dismissed[]`; Clear is the inverse of Accept.
  Precedence: **Process Template `case_anchor` > session-level override
  > markers** — the engagement contract still wins when both exist.
- **`marker_suggestions[]`, `marker_suggestions_dismissed[]`,
  `anchor_candidates[]`, `anchor_candidates_dismissed[]`, and
  `case_anchor_override`** as new additive top-level blocks on
  `annotations.json`; all documented in
  [shared/SCHEMA.md](shared/SCHEMA.md).
- **A `derived_from_signature` field on `marker_edits[]` `op:"insert"`
  entries** for accepted marker suggestions — provides a human-readable
  audit trail and is what the merge consults on re-normalize to suppress
  the accepted candidate.
- **`scripts/preflight.ps1` and `build-distribution.ps1` integrity gates
  unchanged.** No build-pipeline changes this cycle.

### Tests

- 36 new deterministic regression scenarios (19 marker + 17 anchor)
  pinning behaviour on hand-built fixtures.
- 10 seeded property-based fuzzer regimes (5 marker + 5 anchor) covering
  **~19,000 randomised inputs**. The headline anchor invariant: every
  emitted `anchor_config` round-trips through the production
  `case_assignment.detect_cases_from_anchors` and produces ≥ 2 cases —
  guaranteeing every candidate is actionable. The marker fuzzer pins
  the four guards (excluded_range, inside existing case, near a real
  Start, sub-`min_case_interactions` slivers) and the merge's
  idempotence under dismiss + accept.
- Full Python suite: **277 passing, 3 skipped** (1 mine for pandas, 2
  pre-existing). Viewer node:test suite: **194 passing**.

### Verified

End-to-end via the project's `_pdt_verify` Playwright harness against a
markers-stripped fixture (`sessions/_fixtures/sess-unbracketed-fixture`).
The unbracketed session correctly produces 6 paired Start/End suggested
markers (labelled with the typed customer IDs the worker would otherwise
have to bracket by hand) and 3 anchor candidates with `customer-id-field`
ranked first at score 0.935 (98.8 % coverage, CV 0.034). Accept the
anchor → 3 cases stamped via override on the next normalize; Clear
restores the unbracketed state; Accept a marker → real op:insert in
`marker_edits[]` with the derived_from_signature link. Zero console
errors throughout. Control on the cleanly-bracketed
`sess-2026-0515-1255` produces 0 suggested markers (correct — no missing
boundaries), 3 anchor candidates (informational), no regression.

## [0.18.1] - 2026-05-28

Same-day follow-up to v0.18.0 — four real-user issues that surfaced
immediately after the in-view Map level shipped.

### Fixed

- **Session-view Map level was silently never rendering.** v0.18.0 added
  `"map"` to `LEVEL_RENDERERS` and to the layouts that `applyLevel` swaps
  in/out, but forgot to add it to `MODE_VIEWPORT` — the table the
  viewport-transfer code uses to carry zoom + scroll across mode switches.
  When the user clicked Map from any other level (Flow / Steps / Phases
  / Analysis), `applyLevel("map")` called `_viewportApplyToMode("map",
  snap)` which early-returned on `if (!m) return` because
  `MODE_VIEWPORT["map"]` was undefined — **silently skipping
  `m.render()` and therefore skipping `renderMapLevel` entirely**. The
  panel chrome (notation tabs, level dropdown) was visible because
  `applyLevel` had already swapped `display:""` on the layout, but the
  BPMN / DFG host stayed empty forever — no diagram, not even the
  empty-state message (the controller's render was the thing that would
  have set it). On the very first session load (`--session=<path>` from
  launch) the code path is different and the controller renders, which
  is why the harness never caught this and v0.18.0 shipped broken. Fix:
  add a `MODE_VIEWPORT.map` entry with no-op zoom accessors (analogous
  to Analysis) and `render: renderMapLevel`. Verified by reproducing the
  empty host in the harness (`bpmnHostInnerHTMLStart: ""`,
  `zoomWrapDisplay: "none"`), then confirming the host now contains a
  populated `<div class="bjs-container">` with the activity-BPMN
  diagram after the fix.
- **The map-controller's BPMN render no longer swallows exceptions
  silently.** Defensive cleanup: any future bpmn-js failure now logs
  to console and shows a fallback in the host with the file path,
  error message, and a hint to re-run Analyze with "Build process map"
  checked. Turns "Map is mysteriously empty" into "Map says exactly
  why" if any future failure mode does land an exception.

### Added

- **PDD export from the Session view.** v0.18.0 added the in-view Map level
  but left the **PDD (`.docx`) export Compare-Sessions-only** — to generate
  a PDD for a single session the analyst had to switch tabs, re-pick the
  folder, and re-load it as a one-element aggregate. The Session view's
  Export menu now has a `PDD (.docx)` entry that pre-renders the Map
  level's Flow diagram (so the PDD's As-Is process map section embeds
  *this* session's diagram, not whatever was last on Compare-Sessions),
  then runs the shared export path with a new `{singleSession:true}`
  option that forces the target to `State.getSession()` instead of
  defaulting to aggregate sessions when those are also loaded.
- **Clickable waste-type chips on the Analysis view's Waste-by-step list.**
  The `motion` / `rework` / etc. chips on each row were `<span>`s that
  looked like buttons but only bubbled the click up to the row's "adjust
  business-required time" handler — surprising and unhelpful. They are now
  `<button class="waste-tag-btn">` with their own click handler that
  **filters the Waste-by-step list to step types tagged with that waste
  type** (click `motion` → list narrows to motion-tagged rows; click the
  same chip again, or the new "show all ✕" indicator chip, to clear).
  `stopPropagation` keeps the adjust modal from opening on a chip click.

### Changed

- **Session-view Map empty-state messages mention the "Build process map"
  checkbox** (`#cb-mine` in the ⋯ More menu). v0.18.0's messages told the
  analyst to "click Analyze session" without explaining that the Map files
  are only produced when the checkbox is on — so an analyst who'd
  unchecked it once would re-run Analyze repeatedly and see no map. The
  activity-DFG empty message also now explains the taxonomy dependency
  (the activity DFG comes from taxonomy-classified events; Step / Phase
  Flow uses the analyst's annotations and needs no taxonomy).
- **`exportArtifact(kind, callOpts)`** in `viewer/renderer.js` takes an
  optional `callOpts.singleSession` to force a single-session target.
  Without the flag, behaviour is unchanged (Compare-Sessions filtered
  sessions take priority over the current session).

## [0.18.0] - 2026-05-28

The in-view single-session Map level. The interactive process map (notation ×
level × drill-scope × rare-path cutoff) used to live only in
Compare-Sessions; this cycle adds it as a 5th level inside the Session view,
alongside Flow / Steps / Phases / Analysis. The v0.17.0 "View map" one-click
that routed through Compare-Sessions retires — the Map level supersedes it.
The map UI is now a reusable controller (`viewer/map-controller.js`) shared
by both surfaces. Build-pipeline guards added against three failure modes the
recent release prep tripped over.

### Added

- **Map level in the Session view.** Click "Map" in the level switcher
  (Flow / Steps / Phases / **Map** / Analysis) to open the interactive process
  map for the current session: Process diagram (BPMN) or Flow diagram (DFG)
  at Activity / Step / Phase level, with zoom, drill-down (click a phase to
  scope to its steps, click a step to scope to its activities), and the
  rare-path slider for thinning a long flow's tail. Clicking an
  activity-level node seeks the Flow timeline to that event and switches to
  the Flow level. Same notation × level matrix as Compare-Sessions, bound to
  a single-session data source. Verified in the `_pdt_verify` harness across
  all 2 × 3 × 2 = 12 notation × level × theme combinations + a
  Compare-Sessions regression check (`viewer/index.html`, `viewer/renderer.js`,
  `viewer/styles.css`, `viewer/map-controller.js`).

### Changed

- **The process map UI is now a reusable controller**
  (`viewer/map-controller.js`). The cross-cutting state (notation, level,
  drill scope, rare-path cutoff) and the wiring of the tab / level pill /
  zoom / slider / scope chip used to be tangled with `aggregate-view.js`'s
  multi-session lifecycle and hardcoded DOM IDs (`#bpmn-host`, `#dfg-host`,
  `#map-level`, etc.); pulled into a `createMapController(config)` factory
  that takes DOM nodes + a `dataSource` callback so both Compare-Sessions
  (multi-session merged map) and the new Session-view Map level
  (single-session map) share the same UI. Net: aggregate-view.js shrinks
  by 208 lines; no user-visible behaviour change in Compare-Sessions.
- **`scripts/preflight.ps1` now gates CHANGELOG header integrity and lockfile
  version sync** in addition to the existing npm-audit check. The CHANGELOG
  check fails if any `## [X.Y.Z]` header that was present at the latest git
  tag has disappeared from `CHANGELOG.md` — catches the regression where
  `114edfa` accidentally absorbed the `[0.16.3]` section into `[Unreleased]`,
  where it would have shipped under v0.17.0 if the bump-time audit hadn't
  noticed. The lockfile check fails if `package.json`'s `version` doesn't
  match `package-lock.json`'s root `version` — catches lockfile drift like
  the four-version lag `viewer/package-lock.json` had before the v0.17.0
  prep. Both new checks use a head + regex (not `ConvertFrom-Json`, which in
  PS 5.1 trips on the empty-string keys npm v3+ lockfiles use in
  `"packages": {"": {...}}`).
- **`scripts/build-distribution.ps1`** now runs `preflight.ps1` as step 0 (so
  the three sanity checks gate every release build, not just commits), and
  wraps the electron-packager `npm run package` step in a 3-attempt retry
  with `$env:TEMP\electron-packager\` cleanup between attempts. Defender /
  Search-indexer scanning the staging dir mid-copy occasionally makes
  electron-packager die with `ENOENT` on a freshly-written asset (verified
  against `bpmn-js/dist/assets/bpmn-font/font/bpmn.svg` during the v0.17.1
  build).

### Removed

- **The v0.17.0 "View map" one-click interim** — `#btn-view-map` in the
  Session view's process-map status bar — is gone. It was the low-risk path
  to the interactive map before this cycle's in-view Map level shipped;
  the level switcher now goes straight there.

## [0.17.1] - 2026-05-28

Doc-only follow-up to v0.17.0 (same-day). The `.exe` binaries are functionally
identical — the running code is unchanged. What catches up: the README, the
backlog spec, a couple of release-process ops notes, and the active-branch
guidance.

### Changed

- **README leads with "What's new in v0.17.0".** It had been tops at v0.15.0 —
  ten versions behind reality. Now lists the v0.16.x – v0.17.0 highlights:
  segment-level automation candidacy, the PDD restructure, one-click "View map",
  decluttered Analysis, capture polish (Settings/Profile IA + the freeze fix +
  the Chromium fix), intra-session repetition alignment, and pipeline hardening.
- **`docs/To-Do/NEXT-SESSION-SPEC.md` backlog refreshed.** The four big items
  from the v0.16.x – v0.17.0 cycle (segment-level automation, group-Waste-by-step,
  parse_ts consolidation, broader doc-coverage audit) all landed; the only
  remaining feature-sized item is the in-view single-session map (the one-click
  "View map" shipped in v0.17.0 is the low-risk interim). Three small follow-ups
  noticed during the release prep are queued.
- **Active-branch guidance flipped from `viewer-refactor` → `master`.** The
  long-running `viewer-refactor` refactor branch was merged into `master` at
  v0.17.0 (clean fast-forward); `viewer-refactor` is preserved on origin at the
  same commit but is no longer used for active work. `CLAUDE.md` +
  `docs/To-Do/NEXT-SESSION-SPEC.md` updated to point new sessions at `master`.
- **`docs/SPEC-DEFERRED.md` superseded notice** strengthened — the doc was
  written at v0.2.0 and many items have since shipped without being marked.
  Readers are pointed at `NEXT-SESSION-SPEC.md` for the live backlog.
- **`docs/DOC-COVERAGE-AUDIT.md`** — stale `Branch: viewer-refactor` reference
  in the header reframed to note the branch was merged into `master` at v0.17.0.

### Added

- **`docs/DEPLOY.md`: MAX_PATH extraction note.** The viewer zip's deepest paths
  reach ~175 chars (PM4Py inductive-variant filenames), and a deeply-nested
  extract destination (an indexed OneDrive sync path, a long project tree) can
  push past Windows' 260-char MAX_PATH and cause Shell "Extract All" / PowerShell
  `Expand-Archive` to silently fail mid-rollback. The new bullet on the analyst
  install step calls out an extract destination under ~80 chars as safe.
- **`docs/BUILD-AND-DIST.md`: Release checklist section.** Captures the
  lockfile-bump reminder (`viewer/package-lock.json` had lagged four minor
  versions before the v0.17.0 prep noticed — `npm install` in each app dir
  after a version bump propagates it into the lockfile), plus the bump → build →
  push → publish sequence, and the order constraint that `gh release create`
  tags the remote default-branch HEAD at the moment it runs (so push before
  publish, and land any post-release docs cleanup after publish).

## [0.17.0] - 2026-05-28

The productization-toward-internal-rollout cycle. The analyst-deliverable loop
— process map + step/phase breakdown + PDD/report — has been polished to a
real-world bar: the PDD now follows a standard RPA Process Definition Document
structure with an embedded process map, a single session reaches the
interactive map in one click, and the cross-session Analysis panel +
single-session Waste-by-step list are decluttered to signal-only. The analysis
model is reframed from per-click candidates to coherent automatable segments
([ADR-0016](docs/adr/0016-segment-level-automation-candidacy.md)). Capture is
hardened for the field laptop: the ~5 s session-start freeze is gone, the
Settings / Profile / Session-setup tray IA is split by lifetime, Chromium
web-content reaches the recorder out of the box, and a family of seeded
property-based fuzzers + a `process_label` Python↔JS golden + a `parse_ts`
consistency sweep pin the normalization pipeline against corrupt or
hand-edited logs.

### Added

- **Settings and Profile become top-level tray entries with a real persistence
  layer.** Configuration was buried under "Help & config → Set up a recording
  session" and conflated three concerns: worker identity, persistent settings,
  and per-session inputs. The capture tray now has three discoverable surfaces
  split by lifetime — **Settings…** (Hotkeys, Video/OBS, Screenshots, Storage &
  recording limits — persistent across sessions), **Profile…** (worker identity:
  id, display name, role, team — stamped onto every recording's manifest), and
  **Session setup…** (engagement code/name and process labels — per-engagement,
  shown only when idle). Persistence is a new partial-config overlay at
  `userData/user-config.json` that's deep-merged ON TOP of the YAML config at
  launch, so the YAML supplies session-level shape and the UI-edited slices win
  for what they own. The first-run welcome gets a "Set up your profile" CTA so a
  fresh operator hits identity setup before recording. The legacy standalone
  `obs-settings.json` is migrated into the overlay automatically on first load
  (`capture/user-config.js`, `capture/settings-window.js`,
  `capture/profile-window.js`, `capture/ui/settings.html`, `capture/ui/profile.html`,
  `capture/main.js`, `capture/config.js`, `capture/ui/welcome.html`).
- **"View map" — one-click access to a single session's process map.** The
  interactive map (zoom/pan, Activity/Step/Phase × Flow/BPMN) lived only in the
  Compare-Sessions view, so an analyst working one session had to go there and
  re-pick the folder. The Session view's process-map status bar now has a "View
  map" action that opens the current session in that view directly — also the
  path to getting the map into the PDD (`viewer/index.html`, `viewer/renderer.js`,
  `viewer/views/aggregate-view.js`).
- **The PDD (.docx) now follows a standard RPA Process Definition Document
  structure.** The flagship stakeholder deliverable previously jumped from a
  three-line title block into the step-by-step body. It now mirrors the outline
  of a real PDD (modelled on the document UiPath Task Capture generates from a
  recording): document control, an introduction (purpose / objectives / key
  contacts), an As-Is process description (overview, an **applications-used**
  table, a process-map placeholder, statistics with a "where the time went"
  breakdown, the detailed steps, input data), an **automation assessment** with
  a scored automation-candidates table, and an **exceptions & variations**
  section. Sections are auto-filled where the pipeline has the data and carry
  explicit "[To be completed]" placeholders for the analyst-judgement parts
  (purpose, scope, exception handling), so the document reads as a structured
  PDD rather than a data dump. When exporting from the viewer, the currently-
  rendered Flow map is rasterised and embedded as the As-Is process map
  (section 3.3) (`normalization/pdd_export.py`, `viewer/dfg-viewer.js`,
  `viewer/renderer.js`, `viewer/python-runner.js`).
- **Toast: browser foreground without UIA events.** A belt-and-braces safety
  net for the rare case where the wake-up poller still can't surface a Chromium
  window's AXTree (managed Chrome with accessibility policy disabled,
  AppContainer-restricted builds). When a browser process (`chrome.exe` /
  `msedge.exe` / `brave.exe` / others) is foreground for 8 s and zero
  interactions have reached the tracker from a browser, a once-per-session
  toast tells the analyst the session is rolling but the browser is opaque to
  UIA, with a pointer to the registry-policy fallback in `docs/DEPLOY.md`
  (`capture/main.js`).
- **Smoke test for the wake-up.** `capture/test/wake-up.smoke.test.js` +
  `_pdt_verify/real-capture-test/wake-up-smoke.js`: launches a stock Chromium,
  types into a local form, asserts the recorder emits ≥ 2 web-content
  `value_changed` events with `framework_id="Chrome"` and recognisable form
  labels. Skipped cleanly when Playwright isn't installed so the capture test
  suite still passes on a checkout without Playwright.

### Changed

- **Automation candidacy is reported at the coherent-segment grain, not per
  atomic step ([ADR-0016](docs/adr/0016-segment-level-automation-candidacy.md)).** The previous design ranked individual logical
  steps as automation candidates — a per-click table that read as "automate
  this Search button, this Submit, this Open record" in isolation. That framing
  is misleading: a human–robot–human pipeline (worker fills the form, robot
  clicks Search, worker copies the result) is worse than fully manual. The unit
  of automation an analyst can actually scope is a *coherent stretch of work*
  the robot could take end-to-end. The analysis layer now detects **segments**
  — contiguous runs of interactions inside one case that share the same app,
  bounded by app/case switches or a 30 s idle gap — and scores candidacy by
  pooling segments with the same `(app, ordered step labels)` signature. A row
  is "salesforce — Search → Copy → Paste, 4 instances across cases, total
  2 m 14 s, mean 33.5 s"; sub-5 s single-step segments are dropped because they
  cannot be automation units on their own. PDD §4 renders the segment table
  plus a short narrative summary instead of the 60-row per-click grid; §3.5
  no longer surfaces the per-step "Automation candidate" flag. The Analysis
  view and the Compare-Sessions automation panel render the same segment
  shape, and confirm/dismiss is now keyed by `segment_signature` in
  `analysis_overrides[]` rather than `step_id`. `analysis.json.meta.heuristic_version`
  is bumped to **2**; a new `analysis.json.segments` array exposes the raw
  segments for the viewer. The change does not retire the App-Vocab
  `flags.automation_candidate` per step — it is still a valid signal — but
  the analysis/PDD/findings-report rendering paths no longer surface it
  (`normalization/analysis_segments.py`, `normalization/analysis_automation.py`,
  `normalization/analysis.py`, `normalization/pdd_export.py`,
  `viewer/views/analysis-view.js`, `viewer/views/aggregate-view.js`,
  `viewer/analysis-aggregate.js`, `viewer/report-html.js`, `viewer/report-md.js`,
  `shared/SCHEMA.md`).
- **The Compare-Sessions Analysis panel is far less cluttered.** The cross-session
  time study rendered every step in a fixed 9-column table — including the ~26
  instant (0 ms) micro-steps and columns that were all-zero or always "1" — and the
  automation-candidates table showed a full grid of "—" whenever a step lacked the
  2+ sessions needed to score it. Now the time study is sorted by time and lists
  only steps with a measured duration (with a "+N instant steps" note), and each
  column appears only when it carries signal (Sessions / Min-Max / Waiting /
  Switching show just when non-trivial — a single session collapses to Step /
  Instances / Mean / Active); the automation table collapses to a one-line note
  when nothing is scoreable yet. Also fixes a stray "Heuristic IE findings" typo in
  the panel caption (`viewer/views/aggregate-view.js`, `viewer/index.html`,
  `viewer/styles.css`).
- **The single-session "Waste by step" list is decluttered too.** It rendered one
  bar per step instance (64 for a 4-case session), most of them instant 0 ms
  micro-steps with empty bars. It now sorts by waste then duration — so the
  wasteful and time-heavy steps surface first — and tucks the instant steps
  behind an "N instant steps" expander; every row stays editable
  (`viewer/views/analysis-view.js`, `viewer/styles.css`).
- **Group single-session "Waste by step" rows by step type with aggregate
  VA/NVA; "adjust" propagates across instances.** A 4-case capture still
  produced one row per instance (4× "Search — CUST-XXX", 4× "Save order —
  Express"…) — the analyst was reading the same step type repeated. Rows are
  now rolled up by `process_label` (the value-free step-type key the process
  map and stats already group on), aggregating va_ms / bnva_ms / nva_ms across
  every instance, with an "N×" instance badge and the existing nva-then-total
  sort. The 64-row demo session collapses to 17 step-type rows (8 with a
  measured duration + 9 instant). Editing one with "adjust" writes the
  override keyed by `process_label` instead of `step_id`, so it propagates to
  every instance of that step type ("this step type is actually waste"); a
  more-specific per-step_id override still wins on conflicts. The
  normalization side (`analysis_waste.classify_waste`) reads the new scope
  through `analysis_common.overrides_by_process_label` and stamps
  `process_label` onto each waste entry so the merge is identical in Python
  and JS (`viewer/views/analysis-view.js`, `viewer/styles.css`,
  `normalization/analysis_waste.py`, `normalization/analysis_common.py`).
- **The capture tray's legacy status window and standalone OBS-settings window
  are gone.** `status-window.js` + `ui/status-window.html` were the kept-for-one-
  release fallback before the Live Session window subsumed their counters, recent
  events, and quick actions; `obs-settings-window.js` + `ui/obs-settings.html` are
  subsumed by the new Settings window's Video/OBS section. The "Help & config"
  submenu collapses to just "Help" — config no longer lives there, since Settings
  and Profile are top-level. The capture README + help-window doc reflect the new
  IA, and `package.json`'s build files list is updated (it was both stale —
  referenced the deleted `status-window.js` — and incomplete: missed several JS
  modules) (`capture/main.js`, `capture/package.json`, `capture/ui/help-window.html`,
  `capture/README.md`, `capture/operator-panel.js`).
- **Consolidate the eight `parse_ts` copies into one shared helper.** Each
  pipeline module (`analysis_common`, `bpmn_observed`, `canonical_match`,
  `case_assignment`, `coalesce`, `stats_compute`, `step_suggest`, `xes_export`)
  carried its own near-duplicate ISO-8601 parser — the same surface, three
  fallback semantics (raise / `None` / epoch). The behaviour now lives in
  `normalization/_dt.py` as three named modes (`parse_ts`, `parse_ts_or_none`,
  `parse_ts_or_epoch`); each module re-exports the right one so no caller
  changes. Removes the drift surface that produced the recent tz-naive bug in
  the first place; the family-wide guard (`test_parse_ts_consistency.py`) now
  also covers the shared helper directly.

### Fixed

- **Chromium web-content interactions now reach the recorder out of the box.**
  The C# UIA recorder previously relied on Chrome's accessibility tree being
  already enabled — which Chrome only does lazily, after an external
  accessibility tool queries it. On a stock user-launched Chrome this meant the
  recorder captured only the omnibox / browser chrome and was silent on the web
  content the user was actually working in. A real Salesforce / ServiceNow /
  web-ERP session would produce a session log that contained next to nothing
  analytical, even though the recorder appeared healthy. `UiaSubscriber.Start()`
  now (a) does a **synchronous wake on Start** so any Chromium window already
  up has its AXTree built before the first event of interest could fire, then
  (b) runs a **ramped background poller** — 250 ms ticks for the first 5 s
  (catches windows opened after session start), settling to 1 s after that. The
  targeted query uses a cached `OrCondition` over the Chromium family of window
  classes (`Chrome_WidgetWin_0..3`, `ApplicationFrameWindow`) plus
  `FrameworkId == "Chrome"` so it covers Chrome, Edge, Brave, Electron-host
  apps, and Win11 Chromium variants without an every-second top-level-window
  walk. With the fix, a real httpbin.org form-fill on a plain Chromium produces
  16 real interactions with labelled inputs (`Customer name:`, `E-mail
  address:`) and the typed values, identical to forcing
  `--force-renderer-accessibility`. Edge (`msedge.exe`) is observed identically.
  A `capture/test/wake-up.smoke.test.js` smoke test guards the wake-up against
  silent regression (`capture/recorder/UiaSubscriber.cs`,
  `docs/architecture/CAPTURE.md`, `docs/DEPLOY.md`).
- **`recorder_died` event no longer fires on clean shutdowns.** The exit
  handler used to emit `recorder_died` on every recorder process exit —
  including the normal end-of-session shutdown, where the tracker has just sent
  `recorder_stop` and the C# process exits with code 0. Every session log
  carried a misleading "recorder_died" entry. The handler now treats
  `code === 0 && !signal` as a clean shutdown and skips both the
  `recorder_died` emission and the auto-restart path. The `recorder_died`
  event keeps its documented "the recorder crashed" semantics from the schema
  (`capture/main.js`).
- **`case_assignment._explicit_field_matches` no longer crashes on a malformed
  anchor template.** A template that put a dict under `case_anchor.field` (a
  misreading of the schema — `field` is the property NAME, not a match spec)
  used to take the whole normalize run down with
  `TypeError: unhashable type: 'dict'`. The function now warns and treats the
  bad input as no-match so a single typo doesn't lose the rest of the analysis
  (`normalization/case_assignment.py`).
- **Starting a capture session is instant — no more ~5s freeze when OBS isn't
  running.** `startSession()` awaited a best-effort `setupOBS()` on the critical
  path, so a missing or idle OBS held up the start by the OBS WebSocket
  connect-timeout (~5 seconds, every time). Best-effort OBS now connects in the
  background after the session folder + tracker + recorder are already live; if
  and when OBS connects, `attachObsRecording()` wires the video-sync record into
  the running session and fires the `obs_recording_start` system event. Strict
  mode (`config.obs.required = true`) is unchanged — it still awaits up front so
  a forced-OBS failure tears down before any session folder is created. Verified
  by the new `_pdt_verify/capture-smoke.js` Playwright driver: `pdt:startSession`
  resolves in 625–685 ms with OBS unreachable (`capture/main.js`).
- **Two blocking modals on the session-start path replaced with non-blocking
  toasts.** A `validateConfig` warning ("Engagement ID is still 'default'") used
  to halt with a `Start anyway / Cancel` dialog, and the once-only "recording
  without OBS video" hint was a full `dialog.showMessageBox`. Both are now
  `notifyUser()` toasts — starting always proceeds; the once-only hint keeps its
  `userData/obs-hint-shown.json` flag and surfaces only the first time best-effort
  OBS fails (`capture/main.js`).
- **First-session `recorder.zip` extraction no longer freezes the start.** The
  >100 MB `recorder.zip` was synchronously extracted via `spawnSync("tar", …)`
  inside `resolveRecorderPath` the first time a session started — a multi-second
  freeze on first capture after install. `recorder.js` now exposes an async
  `ensureRecorderExtracted()` that runs during `app.whenReady()`, shows a
  "Preparing interaction recorder" notification while it runs, and resolves to a
  no-op when `recorder.exe` is already on disk. The sync extraction remains as a
  safety fallback but is no longer reached on the normal session-start path
  (`capture/recorder.js`, `capture/main.js`).
- **Analysis no longer crashes on a corrupt log record whose `data` is null or
  not an object.** A truncated or hand-edited `events.jsonl` line carrying
  `"data": null` (or a non-dict `data`) aborted the whole run with an
  `AttributeError` / mapping `TypeError` during case detection and stamping — the
  timestamp path already degraded to a fallback, but the `data` path did not.
  Every `data` access in `normalization/case_assignment.py` now treats a missing
  or non-dict payload as empty (the record is preserved and left uncased), so a
  single bad line degrades instead of failing the session. Found by a new seeded
  property-based fuzzer over the case-assignment pipeline
  (`normalization/test/test_case_assignment_fuzz.py`).
- **Statistics no longer crash on a corrupt duration or case timestamp.** A
  hand-edited `events.jsonl` could carry a non-numeric `duration_ms` or a
  non-ISO case timestamp (the load-time shape coercion guarantees `data` is a
  dict, but not its value types). `activity_stats` / `case_stats` then crashed on
  `sum()` / timestamp parsing — taking down the whole statistics step that feeds
  the PDD tables, the findings report, and the Analysis view. Such values now
  degrade to 0 / an unknown duration. Found by a new seeded fuzzer over
  `stats_compute` (`normalization/test/test_stats_compute_fuzz.py`).
- **Step suggestion no longer crashes on a corrupt log — a non-string field or a
  mixed-timezone timestamp.** Two reachable crashes in the segmentation path,
  surfaced by a new seeded fuzzer over `auto_suggest_steps`: the shared
  recognition classifier ran `.lower()` / substring matching on `class_name` /
  `control_type` and threw if a hand-edited record made one a non-string
  (`recognition.py` + `viewer/recognition.js` now coerce, keeping the Python/JS
  pair in lock-step); and `step_suggest.parse_ts` returned a naive datetime for a
  zone-less timestamp but tz-aware for the rest, so a case mixing them died with
  "can't subtract offset-naive and offset-aware" — it now normalizes to UTC.
- **The same timezone normalization now applies to every `parse_ts` copy across
  the pipeline.** A zone-less timestamp parsed naive in `analysis_common`,
  `bpmn_observed`, `canonical_match`, `case_assignment`, `coalesce`,
  `stats_compute`, and `xes_export` too — the same latent crash, reachable
  wherever those compare or subtract timestamps. All eight copies now return a
  tz-aware datetime; a family-wide guard (`test_parse_ts_consistency.py`) keeps
  them from drifting apart again.
- **A single-case observed BPMN renders as the path it actually took, not a
  mined model.** `write_observed_bpmn` ran the lone case through PM4Py's
  inductive miner regardless — but a single case is one observed path with
  nothing to generalize. When a step label recurred in that one trace (a
  re-entered field, or the value-free `process_label` collapsing two entries to
  one name) the miner turned the repeat into optional/loop gateways the lone
  path couldn't justify, and being block-structured smeared those diamonds
  across the whole diagram even around unrelated steps. A `len(log) == 1` path
  now builds the BPMN as a literal `start → t1 → … → end` chain (new
  `_linear_bpmn`), so one case renders as the path it actually took and a
  recurring step simply appears again in sequence (`normalization/bpmn_observed.py`).
- **The Phases view no longer shows a blank bordered box when a session has no
  phases.** An un-phased session (the common starting state) left the phase
  timeline as an empty void; it now shows a centered hint ("No phases yet —
  group steps into phases…"), matching the empty-state treatment used elsewhere
  (`viewer/phase-editor.js`).
- **The Analysis view now refreshes after an in-app "Analyze session".** A
  re-analyze wrote `analysis.json` and reloaded the session, but
  `loadSessionIntoView` re-rendered the Flow, Steps, and Phases levels and *not*
  the Analysis level (which was added later) — so the view kept saying "No
  analysis available" despite "Analysis complete," until the session was
  reopened. It now re-renders on every (re)load (`viewer/views/flow-view.js`).

## [0.16.3] - 2026-05-25

### Fixed

- **Analysis no longer crashes when a session's Process Template file is missing.**
  A session matched against a template on one machine remembers that template's
  path; opened on a machine that doesn't have the file (a hand-off), re-analysis
  died with `FileNotFoundError` and the session couldn't be analyzed at all. A
  missing, unreadable, or malformed template is now treated as "no template" — the
  run logs a warning and proceeds without it (`normalization/canonical_match.py`,
  `normalization/normalize.py`, `viewer/python-runner.js`).

## [0.16.2] - 2026-05-25

### Changed

- **The Session view's top is far less cluttered at laptop widths.** The action
  bar packed eight buttons (wrapping to three rows on a 13" screen), and the
  process-map status, the session chips, and the Session Summary each took their
  own row — pushing the timeline a third of the way down the screen. Occasional
  actions (Match Process Template, Classify activities, Save to App Library, Attach
  & Sync video) and the *Build process map* setting now live behind one visible
  "⋯ More" menu; the process-map status rides the slimmed action row; the chips sit
  on a single line; and the level switcher (Flow / Steps / Phases / Analysis) is
  promoted above the Session Summary. The timeline now starts ~50px higher and the
  bar no longer wraps at 1100px (`viewer/index.html`, `viewer/renderer.js`,
  `viewer/styles.css`).
- **The Steps editor and the header are tidier at laptop widths too.** The Steps
  bulk actions (Group / Delete / Merge selected) used to sit permanently greyed-out;
  they now appear only when 2+ steps are ticked, and the single-key shortcut list
  (J / K / S / M / N) is demoted from a full inline row to a hover hint. The
  decorative "Capture · Mine · Synthesize" tagline is hidden below 1200px and the
  top tabs no longer wrap, so the header stays a single row on a laptop. Together
  with the change above, the Session timeline starts ~90px higher at 1100px
  (`viewer/index.html`, `viewer/views/steps-view.js`, `viewer/styles.css`).

### Fixed

- **Dialog body text no longer clipped or mis-aligned.** Every non-Help popup
  (e.g. "Classify activities") inherited the Help modal's two-column grid, so its
  body was squeezed into the 200px nav column and clipped on the left while the
  footer jumped to the top. The base modal is now a single flex column with a
  padded, left-aligned, scrollable body and a footer pinned bottom-right; the
  two-column grid is scoped to the Help modal alone via `:has(.help-nav)`
  (`viewer/styles.css`).
- **BPMN Process diagram: event names stay on their node, and flows converge
  straight into the end.** After the dagre relayout a node's *name* — a separate
  external label, not drawn inside the box — was left behind at the node's old
  position (the "Start label fell off the start mark box"); each external label now
  moves with its node. Separately, a block-structured miner closes every branch
  with a matching join, so the map ended on a gateway whose only exit was the
  terminal node — a merge diamond that reads like a decision branching into nothing
  (and an XOR-join carries the identical symbol to an XOR-split, so it is genuinely
  misleading). Such a terminal join is now collapsed: its incoming flows reconnect
  straight to the end node so the branches converge directly, while a meaningful
  mid-process join is left intact (`viewer/bpmn-viewer.js`).
- **BPMN external labels are legible in dark mode.** Event and gateway names float
  on the canvas rather than inside a box, and bpmn-js paints them near-black, so
  they vanished against the dark canvas. They now take the foreground colour while
  internal task labels (on their white boxes) stay dark (`viewer/styles.css`).

## [0.16.1] - 2026-05-24

### Changed

- **The BPMN Process diagram lays out cleanly now.** Its coordinates came from a
  hand-rolled routine, so `end` stranded mid-diagram with crossing edges, and the
  drag-to-reorganize affordance was really there to compensate. It now re-lays-out
  with **dagre** — the same layered, crossing-minimised engine that lays out the
  Flow diagram (DFG) cleanly — into a left-to-right flow, then makes that the
  baseline. Flows follow dagre's **node-avoiding** routing (a long edge runs in
  the lane between node rows instead of cutting through an unrelated box). The
  diagram stays draggable (bpmn-js Modeler) for manual nudges, but a clean layout
  is the starting point (`viewer/bpmn-viewer.js`).

### Fixed

- **Middle-clicking the Flow timeline pans it instead of locking up.** Middle-click
  on the scrollable timeline triggered Chromium's native auto-scroll, which bounced
  erratically toward the cursor and left the page in auto-scroll mode so the next
  click was swallowed ("locked controls"). Middle-button now drag-pans the timeline
  (the native behaviour is suppressed); any mouse release ends the pan cleanly so it
  can't stick (`viewer/views/flow-view.js`, `viewer/styles.css`).

## [0.16.0] - 2026-05-24

### Added

- **Aligned reading of repeated work — curate one ticket, apply to all.** The
  Steps view gains a **Flat / Aligned** toggle. Aligned shows the consensus
  **backbone** across the session's detected cases — each step with a frequency
  pill ("seen in 10/12 cases") and its aligned instances (jump to any in Flow).
  Editing a backbone step's name / description / flags and clicking **Apply to all
  N instances** propagates the curation to every case in a *single* annotations
  write, so one Ctrl+Z reverts the whole thing. Steps a single case has that the
  consensus lacks surface as **exceptions**, edited in place. The per-step filter
  hides in Aligned mode and the toggle shows only with 2+ cases (ADR-0015 phases
  2–4; `viewer/step-alignment.js` `alignCases`, `viewer/views/steps-view.js`,
  `viewer/step-editor.js`).
- **Recognition-driven case anchors.** A case anchor can now be named by a
  *recognised* platform signature (`case_anchor.recognized: "search"`, ADR-0011)
  instead of an engagement-specific `automation_id` — composable with a value/label
  pattern, with the explicit id rule kept as a fallback. Case detection generalises
  across apps without per-engagement selectors (`normalization/case_assignment.py`;
  ADR-0012 #7).
- **Step-level statistics (resolves the activity/step stats split-brain).**
  `stats.json` now carries `step_stats` — per-step-name frequency + duration
  distribution (mean / median / p90 / p99), the step-level analogue of
  `activity_stats` — and the Markdown report gains a **Step statistics** table
  beside the Activity one, so the stepped view gets the same treatment as the
  activity view (`normalization/stats_compute.py`, `viewer/report-md.js`).
- **Team-wide taxonomy promotion.** `classification.upsert_taxonomy_rules`
  writes analyst rules directly into a shared `taxonomy.yaml` (de-duped,
  preserving other keys) so they classify every future session — the
  direct-write companion to the existing hand-merged "promote to taxonomy"
  export. (Backend; the in-app button + the choice of which file is the team
  taxonomy still need wiring for the locked-down deployment.)
- **Rearrange the process map by dragging — and it sticks.** The BPMN process
  map now uses the bpmn-js Modeler instead of the read-only viewer bundle, so:
  drag a box to reorganize the auto-layout, click a box to drill to the source,
  and scroll-to-zoom / drag-to-pan actually work (the old bundle had no
  navigation at all). Dragged positions are saved back to the `.bpmn`, so they
  survive a level/tab switch and re-opening the session; a re-analyze
  regenerates the map and resets it. The create/delete editor chrome is hidden,
  so it stays a move-only layout tool (`viewer/bpmn-viewer.js`, `viewer/index.html`,
  `viewer/styles.css`).
- **Team-taxonomy promotion is in-app.** The Classify-activities manager gains a
  "Save to team taxonomy…" button: pick or create a shared `taxonomy.yaml` and
  the labels are merge-upserted into it (dupes skipped, other keys preserved),
  so they classify every future session — not just this one
  (`viewer/views/flow-view.js`, `viewer/main.js`, `viewer/ipc.js`).
- **Flow-diagram layout persists.** Dragging a node in the Flow diagram now
  survives a level/tab switch and re-open, saved per exact node set so a changed
  graph (after re-analyze) gets a fresh layout (`viewer/dfg-viewer.js`).
- **Click a map node to drill down a level.** On the process map, clicking a
  phase node descends to the step level and a step node to the activity level
  (phase→step→activity); the activity level still drills to the source session
  (`viewer/views/aggregate-view.js`).
- **Drill-down now scopes to the clicked node's children (Flow diagram).**
  Clicking a phase node descends to the step level showing only that phase's
  steps; clicking a step node descends to the activity level showing only the
  activity labels seen inside that step. A "scoped: <parent> · show all" chip in
  the map header is the inverse. The Process diagram (BPMN) is a static mined
  file, so there a click descends unfiltered, as before
  (`viewer/views/aggregate-view.js`, `viewer/process-map-levels.js`).
- **Rare-path frequency slider for the Flow diagram.** On a long, dense recording
  the map can carry many low-frequency deviations. A slider sets the minimum edge
  frequency shown — at 1× every path shows; raising it hides paths seen fewer than
  N times, the live label reading "≥ N× (M hidden)". The cutoff is clamped to the
  busiest edge so the map is never blanked, and the slider disables when there is no
  frequency spread to thin. (Generalises the earlier binary "hide rare paths"
  toggle — `viewer/process-map-levels.js` `dropRareEdges`,
  `viewer/views/aggregate-view.js`; ADR-0013 #5.)

### Fixed

- **Divergent steps no longer vanish from the aligned reading.** A step a case
  performs differently from the consensus (a substitution) was aligned diagonally
  and counted as neither a backbone member nor an exception — it disappeared from
  the analyst's view entirely. Every non-hidden step now surfaces as exactly one
  or the other, guarded by a property-based fuzzer (`viewer/step-alignment.js`,
  `viewer/step-alignment.fuzz.test.js`).
- **Normalization survives a corrupt or hand-edited `events.jsonl`.** A
  valid-JSON-but-non-object line (`123` / `"x"` / `[]` / `null`), a
  numeric/null/missing timestamp, a null or missing `data`, a missing `event_id`,
  or a non-string interaction `kind` each used to crash the whole run with an
  uncaught exception. `load_events` now drops non-object lines (like malformed
  JSON) and a boundary guarantees the event shape every downstream stage relies
  on; `parse_ts` falls back rather than throwing (`normalization/normalize.py`,
  `normalization/step_suggest.py`).
- **A repeated recorder `hello` no longer double-captures.** The C# recorder
  reassigned its UIA subscriber on a second `hello` without stopping the first,
  leaking its handlers so every interaction was recorded twice (a silent
  data-integrity bug). `hello` is now idempotent (`capture/recorder/Program.cs`).
- **Anchor case detection tolerates bad timestamps + a misconfigured regex.** A
  non-ISO timestamp on an anchor event, or a typo in a template's
  `case_anchor.matches` regex, crashed the run; timestamps now fall back to the
  epoch and an invalid regex warns + matches nothing
  (`normalization/case_assignment.py`).
- **Empty serial-box clicks no longer fragment case detection.** A focus or
  click on the case-anchor field before anything is typed fired the anchor with
  an empty value, opening a throwaway empty-label "case" that the
  degenerate-case guard then dropped — orphaning the interactions that had been
  stamped to it. Such empty-value fires are now ignored, so the work stays
  attributed to the ticket in progress (`normalization/case_assignment.py`,
  mirrored in `scripts/count-cases.js`).
- **Step / Phase BPMN export is no longer empty.** The export buttons emitted a
  bare Start→End because they ran the template-derived BPMN path with no
  Process Template. They now export the **observed-flow** Step/Phase diagram —
  the same `process_map_step|phase.bpmn` the viewer displays — mining it first
  if needed (`viewer/renderer.js`).
- **Re-analyze keeps curated step→phase / step→template links.** A re-analyze
  regenerates auto steps with new ids, so a phase's `step_ids` (and any template
  link) on a step that was grouped but not otherwise edited used to dangle — the
  grouping was silently lost. A fresh step now inherits the prior step's id and
  curated `phase_id` / `canonical_step_id` when it re-covers the same
  interactions (`step_suggest._merge_steps` / `_inherit_step_identity`).
- **Recorder windows no longer occlude screenshots on a single monitor (D3).**
  The capture dims its own always-on-top windows (panel / label picker / status)
  to opacity 0 for the duration of each grab and restores them in a `finally`,
  so the worker's screen is captured cleanly even with one display
  (`capture/screenshots.js`, `capture/main.js`).
- **Step-level Flow / map no longer explodes into one node per case.** Auto step
  names embed each case's values ("Search — CUST-10101", "Enter 25 in Quantity"),
  so every case produced unique nodes and the step-level diagram became a
  hairball (unusable on a long recording). A value-free `process_label` collapses
  the same kind of step to one node — computed **live** in the viewer
  (`process-map-levels.js`) so the Flow collapses without a re-analyze, and
  stamped at normalize (`step_suggest.process_label`) for the observed-flow BPMN,
  so both diagrams agree.
- **Raw Events panel no longer paints over the Steps screen.** A `min-height:0`
  re-added to `.session-layout-stepsphases` (to bound the editor) had silently
  undone the earlier overlap fix (commit `1833fb5`): the column could shrink
  below its content, so an open Raw Events panel overflowed and overlapped the
  editor instead of scrolling. Removed it, with a comment so it isn't re-added
  (`viewer/styles.css`).
- **Dead Flow / Steps / Phases switcher removed from Compare Sessions.** The
  three-button level switcher in the aggregate toolbar wrote to a state value
  nothing read, so clicking it only moved the highlight and re-rendered the same
  view. The process-map level is set by the "Activity / Step / Phase level"
  dropdown beside the map; the orphaned control and its backing state are gone
  (`viewer/index.html`, `viewer/renderer.js`, `viewer/state.js`).
- **Analysis time study and step statistics no longer fragment per instance.**
  The cross-session time study, `step_stats`, `step_variants`, and the pooled
  automation candidates grouped steps by `canonical_step_id` / raw `step_id` or
  raw name, so with no Process Template every order made its own row — an endless,
  near-valueless list ("Salesforce: Search — CUST-10900", "— CUST-10901", …). They
  now fall back to the value-free `process_label` (the same abstraction the process
  map uses), so a step seen across N orders collapses to one row with `instances=N`
  ("Salesforce: Search · 4"). New shared `step_group_key` / `step_group_label`
  helpers in `analysis_common.py`; applied in `analysis_time_study`,
  `analysis_automation`, and `stats_compute`.

### Changed

- **Recognition signature table is now shared (ADR-0011 follow-ups 1–2).** The
  platform/framework signatures moved to `shared/recognition-patterns.json`,
  loaded by both the viewer (`viewer/recognition.js`) and the Python pipeline
  (new `normalization/recognition.py`). The step auto-suggester's browser-chrome
  noise filter now uses the shared recognition instead of its own hardcoded
  class list, so the viewer and the pipeline classify interactions identically.
- **Activity classification leads with framework recognition (ADR-0011 follow-up
  3).** When the window-title taxonomy doesn't match an activity, its label is
  now derived from the dominant framework-recognised category of the
  interactions in that window ("Form entry", "Data grid", "Search", …) instead
  of "Unclassified — app", so the activity map shows meaningful work even with
  no taxonomy. The taxonomy still owns business labels (it wins);
  `normalization/classification.py`.

## [0.15.0] - 2026-05-23

### Added

- **Recorder stays reachable (D1).** The Live Session window and the
  Start-marker picker now sit at the highest always-on-top level, so they
  stay above other applications instead of disappearing behind them. During
  an active session a left-click on the tray icon brings the Live Session
  window to the front (right-click still opens the menu) — so you can always
  reach Stop / markers without resorting to hotkeys.
- **Interactions are colour-coded (A1).** In the step detail, each interaction
  is tinted by kind — value entry (amber), action (blue), selection (teal),
  toggle (purple) — so a step reads at a glance instead of as a text wall.
- **Choose where a step splits (A2).** Each interaction has a scissors control;
  click it to set the split boundary, and Split cuts there instead of always at
  the interaction-count midpoint (it still falls back to the midpoint).
- **Step timeline context menu (A5).** Right-click a step block to split, merge,
  rename, hide/unhide, jump to Flow, watch, or flag as waste / automation.
- **Step flags are visible and reach outputs (A3).** Flagged steps are badged in
  the list (waste steps are also struck through), the toolbar shows a flag-count
  summary, and the per-session report gains a Steps table with a Flags column.
- **Process map at step or phase level (C1b).** A depth selector builds the Flow
  diagram from your steps or phases (one trace per case), so the map is
  meaningful even with no taxonomy. A blank activity map auto-falls-back to the
  step/phase level when annotations exist.
- **Unclassified-activity warning + classify-in-place (C1a).** The Flow view
  warns when most activity is unclassified (why the application map looks empty),
  and a right-click "Classify this app…" on an activity band adds a taxonomy rule
  and re-analyzes.
- **Configurable hotkeys (D2).** The session-setup window records the four
  recorder shortcuts via a live key-capture — no more hand-editing the YAML.
- **In-app classification manager.** A "Classify activities…" action lists every
  application observed in the session and lets you label each in one place
  (writing per-session classification rules) and re-analyze — the bulk companion
  to the per-band "Classify this app…", so an empty application-level map can be
  fixed without hand-editing taxonomy YAML. The unclassified-activity banner
  links to it.
- **Platform/framework recognition layer (ADR-0011).** Interaction recognition
  is anchored on documented, cross-app platform signatures — the UIA
  ControlType taxonomy plus Chromium/Edge chrome, Bootstrap, AG-Grid,
  SharePoint, Office 365 and Win32/Office conventions — instead of one
  engagement's opaque automation_ids. Steps align across tickets by semantic
  category, unnamed elements read as their real type ("a data-grid cell"), and
  per-session selectors (`txtsr`, window-title taxonomy) drop to examples.
- **Step- and phase-level Process diagram (observed flow).** The Process diagram
  (BPMN) now renders at Step and Phase levels, not just Activity — each mined
  from your actual annotated step/phase flow (with its branches), the BPMN
  counterpart of the Flow diagram. Notation (Process diagram / Flow diagram) and
  level (Activity / Step / Phase) are now fully independent controls: changing
  one never resets the other.

### Changed

- **Case segmentation now uses active-case stamping.** A case_id is stable per
  anchor label (e.g. a serial number), so re-searching the same value resumes
  its case instead of opening a new one, and every event is attributed to the
  most-recently-anchored case — correct even when work on several cases
  interleaves. A degenerate-case guard drops slivers (under ~2 interactions or
  ~1s). This replaces the old gap/pause split, which inflated a couple of
  repeated searches into a dozen "cases".

### Fixed

- **Marker screenshots captured the recorder instead of the work (D3).**
  Firing a marker moves focus to the recorder's monitor, so the screenshot
  showed the recorder UI. Screenshots now aim at the last work-window's
  monitor — the recorder's own windows are excluded from that tracking — so a
  marker captures what the worker was doing. (Single-monitor occlusion, where
  the panel physically covers the work app on one screen, is a separate
  pre-capture follow-up.)
- **The session name entered at setup was never shown (D4).** The project name
  typed in *Set up a recording session* was stored only inside the config
  snapshot and surfaced nowhere. It is now a first-class manifest field
  (`engagement_name`), used as the name in the recents list and shown in the
  viewer's session summary. Existing sessions fall back to the config snapshot.
- **The selected-step pane dragged both panes taller (B1).** The Steps editor
  now pins its row to the available height; each pane scrolls internally, so
  expanding a step's interactions no longer pushes the step list off-screen.
- **Typing into several fields collapsed into one step (A4).** Step suggestion
  now ends a step when typing moves to a different field, so filling N fields
  yields N steps instead of one glued blob. Type-then-click coupling (e.g. type
  a serial then click Search) is preserved; gated by a default-on config flag.
- **Step merge is the clean inverse of split.** "Merge with next" always merges
  the step with the one after it; a separate "Merge selected" merges exactly the
  ticked steps — so one control no longer silently merges the wrong pair. Merge
  is now offered wherever split is (step detail, context menu, toolbar, and the
  M shortcut).
- **The map level selector no longer hijacks the notation.** Choosing Step or
  Phase changes the level in place on the current diagram instead of yanking you
  onto the Flow diagram, and switching diagram keeps the chosen level.
- **The repeat badge is signal, not noise.** A step is badged ("N×") only when
  it recurs in some — but not all — cases; a step that recurs in every case (the
  uniform backbone) gets no badge. "Apply to repeats" stays available regardless.
- **Legends for the new encodings.** A colour key for the interaction-kind bars
  and a one-line key for the repeat badge, so neither reads as an unexplained code.

## [0.14.4] - 2026-05-19

### Added

- **Flow → Steps navigation.** Clicking anywhere on the Flow timeline
  (a band, a marker, a screenshot, or the new right-click "Jump to
  step here" item) parks the timestamp; the next time you open the
  Steps view, the step containing (or closest to, by nearest edge)
  that timestamp is selected and scrolled into view. The Flow
  timeline's right-click menu now opens on the background too, not
  only on case / activity bands.

### Fixed

- **Step times disagreed with the Step timeline axis.** The step
  detail tiles (Start, End) and the interaction-list times used the
  raw UTC portion of the ISO timestamp, while the timeline axis above
  used local time — the step detail showed 08:55:07 next to a 10:55
  axis label on the same step. All step times now render in local
  time.
- **The selected step block on the Step mini-timeline was almost
  invisible.** Replaced a 1-px muted outline with a 2-px accent
  outline plus a brightness/saturate boost and a z-index lift so the
  highlight reads on every block colour.
- **Screenshot dots on the Flow timeline blinked on hover with no
  preview.** The hover-thumbnail used an unresolved relative path and
  could never load; removed the wiring. The dot still scales subtly
  to acknowledge the hover.
- **Clicking a screenshot in the gallery only seeked the video.** It
  now also opens the screenshot full-size, matching the behaviour of
  the dot icon on the timeline.

### Known issues

- The right-click **Jump to step here** item correctly pre-positions
  the Steps view (the right step is selected and scrolled when you
  switch tab), but does not yet auto-switch to Steps — you still have
  to click the Steps tab after picking the menu item.

## [0.14.3] - 2026-05-19

### Fixed

- **The Steps-view step list had dead space below the rows and was too
  short on a laptop viewport.** The v0.14.2 cap was viewport-height
  based, so on a ~800-px-tall laptop the list got capped to ~200 px
  (~7 rows) while the pane stretched taller to match the selected-step
  editor. The list pane is now a flex column and the step list fills
  the remaining pane height (driven by the editor's content via the
  grid row), with a 350-px floor so the list is always tall enough to
  navigate.

## [0.14.2] - 2026-05-19

### Fixed

- **The Steps-view scroll change shipped in v0.14.1 broke the editor
  panes** — transparent panes with content scrolling through them, the
  selected-step editor and the raw events bleeding into the background.
  Reworked as a plain max-height cap on the step list (with a floor) so
  it cannot collapse the panes. The step list scrolls within its own
  pane and the selected-step editor stays in view as you scroll the
  list.

## [0.14.1] - 2026-05-19

### Changed

- The step interaction list and auto-generated step descriptions now
  phrase every recorder event kind — including toggle / checkbox
  changes ("Turned Remember me on") and payload-less text-change
  notifications — with a graceful generic fallback for any future kind.
  Descriptions read as one sentence per action.
- Auto-detected step names now carry the value the step acted on —
  "Search — SN12345" rather than a bare "Search", "Enter SN12345 in
  Serial Number" rather than "Fill Serial Number" — so a step is
  recognisable from the list without opening its interactions.

### Fixed

- In the Steps view a long step list scrolls within its own pane again,
  with the filter bar pinned; the selected-step detail stays in view no
  matter how far down the list you scroll.

## [0.14.0] - 2026-05-19

### Added

- **A step now shows what it interacted with, not just how many
  interactions.** The step detail panel showed a bare count, so
  understanding a step meant cross-referencing the raw event stream by
  hand. It now lists each interaction as a readable line — *Typed
  "SN12345" into Serial Number*, *Clicked Search*, *Selected "Resolved"
  in Status* — collapsible, with the full typed values shown.

- **Auto-detected steps are now self-describing.** An auto-suggested
  step had an empty description. It now carries a generated prose
  summary of what it did — *"Entered 'SN12345' into Serial Number (20
  keystrokes), clicked Search."* — with full field values and the
  keystroke count behind a coalesced typing burst, so a step reads
  meaningfully in the list and in exports without anyone drilling into
  the events. An analyst's own edits to a step survive re-analysis as
  before.

## [0.13.0] - 2026-05-19

### Added

- **Canonical step rules match controls flexibly.** A match rule
  previously compared three fields for exact equality. Rules now accept
  `contains`, `starts_with`, and `matches` (regex) operators over six
  fields — control type, AutomationId, name, value, class name and
  framework ID — so a template can target a control by a stable part of
  its label instead of its full, volatile text.

- **A step rule can declare how far the step extends.** Each canonical
  step carries a `boundary` mode that decides which following events it
  absorbs: `single`, `until_app_change`, `until_pause`,
  `until_field_change`, `until_next_step`, or the default
  contiguous-group behaviour — so a template can describe a step that
  spans a stretch of work, not just one click.

- **Cases can be detected from a recurring field value.** A template
  can name a *case anchor* — a control whose value identifies the work
  item (a ticket number, a serial). The pipeline opens a new case each
  time the anchor changes value and stamps every interaction and
  activity in that span, so a recording of repeated work splits into
  one case per item with no manual markers.

- **Keystroke runs are coalesced as an early pipeline stage.** Typing
  reaches the pipeline as one `value_changed` event per keystroke. A
  dedicated stage now folds a run of edits to one control into a single
  event carrying the final value before any later stage sees the
  stream, with a prefix guard so two different fields typed
  back-to-back are kept apart.

### Changed

- **Automatic step suggestion fragments less.** With no canonical
  template, step suggestion no longer starts a new step on every app or
  window switch, and tolerates a longer idle gap (10 s) and more
  interactions (60) before splitting. It does start a fresh step after
  a completion action — a click on a button or link labelled "search",
  "submit", "save" and the like.

## [0.12.2] - 2026-05-19

### Fixed

- **A browser-heavy recording still fragmented into hundreds of
  auto-detected steps.** Step suggestion started a new step on every
  change of the raw window title, and web-app titles carry volatile
  text (a live memory counter, the "- Microsoft Edge" tail), so the
  *same* application read as a fresh step over and over. Segmentation
  now keys on the stable app prefix — the title up to its first
  separator, the same label it already uses for naming — so a window
  whose title only churns cosmetically no longer splits the step.

- **Auto-suggested phases were unusable.** "Suggest groupings" bundled
  any steps less than 30 s apart and treated every browser tab as one
  app, so a dense session collapsed into two or three enormous
  "Mixed-app phase" blobs. It now groups steps into continuous-work
  blocks — runs with no idle pause longer than two minutes between
  them — and names each phase after its dominant app.

- **A phase could not be deleted or split.** The phase detail pane had
  no height limit, so a phase with many steps pushed its Save / Delete
  buttons off-screen; the step list now scrolls within a fixed height.
  "Split" was wired to nothing — each step row in a phase now carries a
  split control that moves that step and everything after it into a new
  phase.

- **"Jump" on a raw-events row did nothing without a video.** The jump
  action, and clicking an event row, only seeked a video. With no
  recording linked it now moves the Flow timeline playhead to the event
  and scrolls it into view.

## [0.12.1] - 2026-05-19

### Fixed

- **A recorded session of browser work produced hundreds of unusable
  auto-detected steps.** Typing into a web-app field reached step
  suggestion as a flood of per-keystroke `value_changed` events: the
  recorder's debounce coalescer keys on a control's AutomationId or
  Name, and Chrome exposes neither on most web inputs, so it silently
  skipped them — then the step interaction cap sliced one typed value
  into five or six fragment "steps" with growing-prefix names. Step
  suggestion now coalesces a run of `value_changed` events on one
  control before it segments, and folds the browser's repeated
  same-tab `selection_changed` re-fires; a step name no longer echoes
  the window title back as its own label. The recorder's coalescer
  also gained a UIA RuntimeId fallback so identity-less web fields are
  coalesced at capture time in new recordings. Existing sessions are
  fixed on the next Re-analyze — no re-recording needed.

## [0.12.0] - 2026-05-18

> Version note: the `v0.11.0` tag carried this same content and was immediately
> re-released as `v0.12.0` (a renumber — there was no separate 0.11.0 feature set),
> which is why the version sequence has no `[0.11.0]` section.

### Added

- **Process Template steps can be identified from the App Library.** A
  step's match rules — the UI patterns that recognise it in a captured
  session — are now composed through a per-step **Match rules…** picker
  that draws on the App Library (the per-app catalog of named UI
  interactions), a basic app/window rule, or an interaction lifted from
  a sample session. Library-sourced rules keep a reference back to the
  catalog entry and show a drift badge when that entry later changes.

- **Inline phase assignment in the Process Template editor.** Each step
  row has a **Phase** dropdown — assign it to an existing phase or
  create one on the spot. The template's `phases` block, which the
  exports roll steps up into, stays in sync automatically.

- **Close and Delete for a Process Template.** The actions bar gained
  **Close** (unload the template from the editor) and **Delete** (remove
  the `.yaml` from disk, with confirmation). Version-history snapshots
  are deliberately kept on delete.

- **Step reordering in the Steps view.** Each step row has up/down
  buttons, and a **Sort by time** action reorders the whole list
  chronologically.

- **Per-row actions in the Raw events table.** A row can now jump the
  video and timeline to its event, spin a new step off it, or add the
  event to the selected step — not just seek.

- **Zoom controls for the Process diagram.** The BPMN process-map tab in
  Compare Sessions gained zoom-in / zoom-out / fit controls, matching
  the Flow diagram.

### Changed

- **The Process Template tab was relaid out.** Two main columns —
  Template steps and Import steps from a session — with the Advanced
  YAML editor demoted from a co-equal third column to a collapsible
  strip below, reclaiming the space for the panels that matter.

- **Clearer naming.** The app-and-window-only match rule is now a "Basic
  match rule" (was "coarse rule"); the bulk step-import panel is now
  "Import steps from a session" (was "Rough-in from a recording").

- **Steps can be multi-selected with a plain click** on their checkbox;
  Ctrl+click still works.

- **The Raw events table uses the available height** instead of a fixed
  360px panel, and stays collapsible.

### Fixed

- **The Match rules… picker rendered in a narrow left strip** because it
  reused a modal layout meant for a nav sidebar it does not have.

- **A manual step added with no video loaded landed far off the
  timeline** — the fallback timestamp was wall-clock now; it is now
  anchored within the session's recorded span.

- **"Merge with next" ignored a multi-selection.** With two or more
  steps selected it now merges exactly those, in chronological order,
  and names what merged.

- **"+ Add interaction" in the App Library gave no sign anything
  happened** — the new row now scrolls into view, briefly highlights,
  and takes focus.

- **The help text mis-described cases and phases.** Cases are derived
  from markers during normalization, not marked during recording; the
  phases text now explains what phases are for and where to define them.

## [0.10.0] - 2026-05-18

### Added

- **Add a step at the video playhead, without leaving Flow view.** A
  "+ Step" button in the timeline toolbar — and the `S` keyboard
  shortcut — create a step boundary at the current video playhead, so
  a manual step can be marked while watching in Flow view instead of
  switching to the Steps view to place it blind. The playhead inside
  an existing step splits it there; in open space it starts a new step
  running to the next boundary; on a session with no steps yet it
  carves the recording into "Step 1" / "Step 2" at the playhead. The
  per-step lane is switched on so the new boundary appears on the
  timeline immediately.

### Fixed

- **Space and the arrow keys double-fired against the video's native
  controls.** When the `<video>` element had keyboard focus, a Space
  or Left/Right press was handled twice — once by the browser's
  built-in media controls and once by the viewer's global shortcut
  handler — so the two play/pause toggles cancelled out and Space
  appeared to do nothing. The global handler now leaves those keys to
  the native control whenever the video element is focused.

- **The session summary panel could be squeezed flat.** After the
  v0.9.0 session-view overlap fix pinned the event-table and log
  panels to their content height, the summary panel was left as the
  only shrinkable element in the scrolling session column — so it
  collapsed, and its `overflow: hidden` clipped the body, leaving it
  unable to open. It is now pinned like its sibling panels.

- **Command palette result clicks and keyboard navigation.** Hovering
  a result rebuilt the whole list on every mouse-enter, swapping the
  row out between mousedown and mouseup so a click never landed;
  selection highlighting now updates in place. Arrow / Enter / Esc /
  Tab navigation is bound at the document level, so it works whenever
  the palette is open rather than only while the search box holds
  focus.

## [0.9.0] - 2026-05-18

### Added

- **The Analysis view's heuristic findings can now be corrected.** The waste
  and automation classifiers ship as provisional estimates — the value-add vs.
  business-required time split is a guess (all active time defaults to
  value-add), and an automation candidate cannot be judged real from a single
  recording. The Analysis sub-view is now interactive: click a step's waste row
  to set how much of its time is business-required overhead, and confirm or
  dismiss each automation candidate. Corrections are saved to
  `annotations.json` with undo, shown immediately, and folded into the analysis
  layer on the next Analyze run — flowing through to `analysis.json` and the
  PDD export.

- **Compare Sessions gained an Analysis panel.** Loading several recordings of
  the same process now pools their heuristic findings: a cross-session time
  study, a per-worker cycle-time comparison, automation candidates scored
  across sessions — a step seen once per session finally has enough instances
  to judge for repetitiveness — and a process-efficiency trend. Each automation
  candidate carries a fingerprint of how its step was performed, so the same
  step compares cleanly from one recording to the next.

### Fixed

- **The session summary's "Where the time went" bars rendered empty.** The
  bar fill was an inline element, so the browser ignored its width and
  height — the percentages showed but the bars beside them stayed blank.

- **The Flow, Steps, and Phases views could overlap the panels below them.**
  With the analysis-log or raw-events panel open, the session layout was
  squeezed below its content height and the video and annotations spilled
  over the panels beneath. The layout now keeps its height and the session
  view scrolls instead.

## [0.8.0] - 2026-05-18

### Added

- **A pass of vocabulary, capture, and viewer polish.** An auto-detected
  step now shows *why* the tool grouped its interactions ("Grouped 8
  interactions in SAP, max gap 4s"). The screenshot gallery collapses a
  run of near-identical frames behind a "(+N near-duplicates)" badge —
  click to expand — computed from a perceptual hash written during
  normalization. A pipeline failure in the analysis log is prefixed with
  a plain-language explanation of the likely cause. The Ctrl+K command
  palette became multi-provider, so the Steps and Phases views
  contribute their own commands, with a ⌘K hint in the topbar. The
  session summary reports **App Vocabulary coverage** per app, and a
  bootstrapped vocabulary is now ranked by how often each control was
  used — rarely-seen controls fold under a disclosure. On the capture
  side: events are written through a 500 ms batching queue (markers and
  lifecycle events still flush immediately); a long idle stretch is
  tagged **at-desk** when the recorder still saw activity, and rendered
  distinctly on the timeline; each activity event and the manifest carry
  window and display geometry, so the viewer badges which **monitor** a
  window was on; and a session that ends with stored sessions over a
  size threshold prompts a cleanup reminder.

- **Comparing sessions, the video, and markers all got sharper.** The
  Compare Sessions view gains a **Group by worker** toggle — the
  activity and case charts split and colour by worker so you can see
  how different people ran the same process; a **side-by-side** mode
  that stacks two sessions' step timelines, shared steps in green and
  divergent ones in amber, with a plain-language summary of where they
  agree; a **conformance overlay** on the Flow diagram that colours
  each node green (matches a Process Template step) or amber
  (off-template) and lists template steps no session reached; a warning
  when the loaded sessions were analyzed against **different taxonomy
  versions**; and a **Variants by: Activity / Step** toggle on the Path
  variations table, so you can compare the analyst's stepped view of
  the process, not just the raw activity sequence. On the Session view,
  a **Sync video** button re-aligns a recording interactively — click a
  moment in the video, then the matching point on the timeline; a
  **▶ Watch** button on each step plays the recording across just that
  step's span; a timeline range can now be **excluded from analysis**
  (step suggestion and statistics skip it) as well as turned into a
  case; re-analyzing a session that already has steps now **asks for
  confirmation** first, since it regenerates auto-detected steps and
  clears the undo history; and every save of `annotations.json` keeps
  **five rotating backups** as a safety net.

- **Projects carry knowledge forward.** A saved project now auto-saves
  a few seconds after you switch tab or view, so a workspace stays
  current without a manual Save. Project files store their session and
  template paths *relative* to the project file, so a project folder
  can be moved or shared without breaking. A project can also carry a
  **team denylist** of apps to leave out of step suggestion — applied
  to any session opened under the project that has no denylist of its
  own — a **Project notes** field, editable from the Project menu and
  included in the findings report, and a **step-template session**:
  open a step-less session under a project that names one and the
  viewer offers to seed it with the template's step structure, each
  step positioned by relative time.

- **Set a project's step template from the menu.** The Project menu
  gains a "Set current session as step template" action: with a
  project open and a session loaded, one click records that session as
  the project's step template, so later step-less sessions opened under
  the project can be seeded from it. Previously the template could only
  be set by hand-editing the project file.

- **One-click HTML findings report.** The Session view's export bar
  gains a "Findings report..." button. It produces a self-contained
  HTML document — process summary, the process map inline, the steps
  table, the waste / automation / efficiency findings, notes, and
  starred screenshots, plus an editable recommendations block — that
  opens in any browser with no external assets. A pre-export dialog
  picks which optional sections to include. Screenshots gain a star
  toggle in the Screenshots panel; only starred screenshots are
  embedded in the report.

- **A process-analysis layer turns a recording into IE-grade
  findings.** After step suggestion, normalization now runs four
  heuristic analyzers and writes an `analysis.json` sidecar: a per-step
  **waste classification** (value-add vs. waiting / motion / rework /
  cross-app overprocessing — the DOWNTIME wastes), a **time study**
  (per-step cycle time across instances, split into active / waiting /
  switching), **automation-candidate** scoring (repetitiveness and
  rule-basedness, scored only where a step repeats often enough to
  judge), and the **process-efficiency ratio** (value-add over total
  stepped time). The viewer gains a fourth Session sub-view —
  **Analysis** — showing the efficiency ratio, a per-step waste bar,
  the time-study table, and the automation list; the session summary
  panel surfaces the efficiency ratio as a tile; and the PDD export
  appends the waste and automation context under each step. The
  classifiers are deliberately conservative and labelled provisional:
  they are tuned ahead of real 8-hour recording data and meant to be
  recalibrated against it. See
  [ADR-0008](docs/adr/0008-build-the-analysis-layer.md).

- **Session summary panel.** An analyzed session now opens with a
  summary above the timeline instead of leaving the analyst to scroll
  and reconstruct what happened: engagement and worker, duration, case /
  event / step counts, a "where the time went" breakdown of the top
  activities, the app-switch count and longest single-app stretch, and
  the longest cases. It also surfaces **marker problems** — a Start with
  no matching End, an orphaned End, a suspiciously short case — each,
  where fixable, with a one-click button that queues the correcting
  marker edit for the next analysis.

- **Compare Sessions flags duration outliers.** When the loaded set
  holds a session whose total duration is a statistical outlier (a
  Tukey fence around the median), a banner names it and offers to drop
  it from the comparison, so one unusually long or short recording
  doesn't quietly skew the merged statistics.

- **Taxonomy rules that match nothing are surfaced.** Normalization now
  records a per-rule match count in `stats.json`
  (`meta.taxonomy_report`) and prints a note for every taxonomy rule
  that classified zero events — a typo in a rule's title pattern no
  longer fails silently.

- **Canonical match-rate drift warning.** When a re-analysis against a
  Process Template sees its interaction match rate fall sharply from
  the previous run (more than 20 points), normalization records it in
  `stats.json` and the session summary shows a warning — the usual
  cause is the target application changing its field identifiers.

- **The interaction recorder filters browser and Electron chrome.**
  The C# recorder now drops the Chromium render-tree scaffolding events
  — empty-id Pane / Group / Document / Custom panes — that every
  browser, and every Electron app, fires for its own internal DOM, the
  same way it already dropped Win32 desktop-shell chrome. Real web-app
  controls, which carry a page-set automation id, are untouched.
  Without this, an all-day browser-heavy recording could bury the
  signal under tens of thousands of noise events.

- **Recorder health lands on the timeline, not just the debug log.**
  The recorder's periodic stats — events emitted, events dropped, an
  error count, and a snapshot of the last failure (process, control,
  message) — are now written to `events.jsonl` as `recorder_health`
  system events, so capture trouble is visible against the session it
  happened in instead of only in the debug log.

- **Applications the recorder cannot see are flagged.** When a
  foreground application produces no interaction events for a sustained
  stretch — typically because it runs elevated, or exposes no UI
  Automation surface — the capture app records an `uncaptured_app`
  event and shows the worker a one-time notice. Such an app used to
  record silently, with no interactions and no explanation.

- **Interaction events carry capture-quality signals.** The first
  interaction captured for each application is tagged with a
  `coverage_hint` — `rich`, `basic`, or `minimal` — a quick read on how
  much detail UI Automation exposes for that app; and a value clamped
  at the 256-character limit is flagged `value_truncated` so a partial
  value is not mistaken for the whole.

- **Events carry a sequence number.** Every event in `events.jsonl`
  now has a monotonic `_seq`; normalization sorts on
  `(timestamp, _seq)`, so events written within the same millisecond
  keep their true order through the pipeline.

- **Sessions can run through idle for all-day recordings.** A new
  `auto_end_on_idle` config key (default on) governs whether an idle
  stretch past `auto_end_idle_minutes` ends the session. Set it off for
  an 8-hour passive recording — idle is still logged, but only the
  worker, or the end of the shift, ends the session.

- **Bracket a case straight from a timeline selection.** The range-
  selection card on the Flow timeline gains an "Insert case from
  selection" button: name the case and it queues a Start and End
  marker at the selection's edges, applied on the next analysis. An
  analyst can now mark process instances in a long passive recording
  after the fact, with no capture-time markers.

- **A post-session summary closes out each recording.** When a capture
  session ends, the Live Session window shows a summary — duration,
  event / marker / screenshot / interaction counts, and whether video
  was recorded — with an optional field to name the session. The name
  is saved to the session manifest and shown in the viewer's Recents
  list, so a worker hands off a recording knowing it is complete and an
  analyst can tell sessions apart at a glance.

- **The recording setup is checked before capture starts.** A
  pre-flight validation runs at session start; if the engagement ID is
  still the default or the session folder is not writable, it asks the
  operator to confirm before recording — catching a misfiled or
  unwritable session before a long recording goes into it, not after.

- **Hotkeys fall back to an alternate binding when one is taken.** If a
  global shortcut can't be registered because another app already holds
  it (some screen recorders and password managers grab Ctrl+Shift+S),
  capture now tries the Ctrl+Alt+ variant and tells the operator which
  binding is live, instead of the hotkey silently doing nothing.

- **Sessions carry an integrity manifest.** Capture writes
  `session-integrity.json` — every file in the session folder with its
  size — when a session ends. Opening the session in the viewer checks
  that manifest against what actually arrived and shows a warning
  banner if files went missing, so a session copied incompletely (a
  dropped video, a truncated event log) is caught before analysis
  instead of silently producing a partial result.

### Changed

- **Step states read in plain language.** The four pipeline step states
  (`auto_suggested`, `auto_matched`, `manually_authored`, `edited`)
  surface to the analyst as just two — "Auto-detected" and "Confirmed" —
  in the step-list tooltip and the summary panel. The pipeline
  distinction is unchanged; only the wording the analyst sees.

- **The Session view points at what to do next.** Once analyzed, a
  context banner in the summary panel suggests the next move — review
  the auto-detected steps, or group reviewed steps into phases — and a
  long recording auto-scrolls to its first case on load.

- **Re-analysis no longer duplicates analyst-owned steps.** When
  normalization regenerates auto-detected steps, a fresh step that
  overlaps a manually-authored, edited, or hidden step by more than
  half its duration is dropped instead of stacked on top — the analyst
  no longer inherits overlapping duplicates to find and delete.

- **Web apps inside a browser are now visible.** The capture tracker
  starts a new activity event when the window title changes, not only
  when the application changes — so a worker moving between Salesforce,
  web-SAP and Workday inside one Chrome window produces three activity
  events instead of one undifferentiated `chrome.exe` event, and the
  process map shows the real flow. The title is normalized first
  (unread counts, unsaved markers and the browser-name suffix are
  ignored) so cosmetic churn doesn't fragment the timeline. This
  realigns capture with the original design — see
  [ADR-0007](docs/adr/0007-activity-event-granularity.md).

- **The interaction-recorder debounce is configurable.** The window
  that coalesces a burst of value changes into one event — typing into
  a field emits a single event with the final value — was a hardcoded
  750 ms. It is now an `interactions.debounce_ms` config key, passed to
  the recorder sidecar in its startup handshake.

## [0.7.0] - 2026-05-17

### Fixed

- **The Flow map no longer draws meaningless self-loops.** A directly-
  follows graph node with an arrow back to itself has no business
  meaning — it was an artifact of the event log keeping consecutive
  same-activity events separate. Normalization now collapses a run of
  one activity into a single occurrence for the process-mining log (the
  finer per-window rows are kept in `events.csv`), so a self-loop is
  structurally impossible — in the Flow graph, the XES log, and the
  mined BPMN alike.

- **The capture tray menu opens on right-click again.** The tray set a
  context menu and also handled right-click explicitly; on Windows the
  two double-fired and right-click did nothing. Both clicks now open
  the menu reliably.

### Added

- **Per-web-app taxonomy.** A canonical `normalization/taxonomy.yaml`
  classifies browser windows into the actual web apps they host
  (Salesforce, SAP, …) instead of one coarse `Unclassified --
  chrome.exe` node. There is deliberately no per-browser catch-all rule
  — an unmatched window stays `Unclassified`, a prompt for the analyst.
  The viewer's Analyze step picks the taxonomy up automatically.

- **Reclassify an activity from the Flow map.** Clicking a map node
  offers a Reclassify action: give the activity its correct label and
  the correction — stored as a `classification_overrides` entry in
  `annotations.json` — flows through re-analysis into the process map,
  the statistics, and the exports. An `Unclassified` node is now a
  prompt the analyst can answer, not a dead end.

## [0.6.0] - 2026-05-17

### Added

- **Studio Dark — a dark theme for the viewer.** A second, opt-in theme
  alongside the default light Warm Editorial: a cool charcoal-blue base,
  a teal accent, a brighter foreground — cinematic and technical. A
  toggle in the topbar switches it at runtime, the choice is remembered,
  and the stored theme is applied before first paint so there is no
  flash. The dark theme covers every view — the timeline bands, the
  step / phase editors, the Flow-diagram (DFG) graph, and the charts
  included.

### Changed

- **Video stage glow.** The video pane carries a subtle radial-gradient
  depth, and the no-video placeholder a faint grid — applied to both
  themes so they stay visually matched.

## [0.5.0] - 2026-05-17

### Changed

- **Capture app tech-debt remediation.** Following an architecture audit
  (`docs/CAPTURE-ARCHITECTURE-ISSUES.md`), the capture app was reworked: a
  `node:test` suite covers the pure-logic modules; the ~1,580-line
  `main.js` is decomposed into focused modules (boot-log, notify,
  session-storage, window-manager); config defaults are consolidated to a
  single source; and each window's HTML is extracted from its JS module
  into a `ui/*.html` file. The decomposition and HTML extraction are
  behaviour-preserving.
- **Screenshots are debounced.** Coincident triggers (an app switch
  landing together with a marker fire) collapse to a single capture
  instead of several near-duplicates. Manual screenshots are never
  suppressed.
- **Viewer: Flow timeline on the shared timeline core.** The Flow
  timeline is migrated onto the timeline-core lane plugins.
- **Viewer: process map is resizable; Activity Frequency chart fix.**

### Added

- **Capture-time failure notifications.** If screenshots start failing
  during a session, the operator gets a desktop notification rather than
  the failure landing only in the debug log.
- **Recorder liveness watchdog.** The interaction-recorder sidecar is
  monitored; if it wedges without exiting, it is terminated and the
  existing restart path recovers it.

## [0.4.0] - 2026-05-16

### Changed (Warm Editorial redesign)

- **Light-theme visual redesign.** The dark "stratified-dark" viewer
  theme is replaced by "Warm Editorial" — a warm off-white palette, an
  amber accent, sharp corners, soft shadows, and self-hosted Plus
  Jakarta Sans + JetBrains Mono typography, applied from a Claude Design
  handoff.
- **Fill-the-window layout.** Every screen fills the viewport and flexes
  its panels by ratio rather than stacking each at a fixed minimum, so
  the video, the screenshot gallery, the process map, and the editors
  grow with the display. The drag-resize handles remain.
- **Flow timeline rebuilt.** Vivid, distinct per-app band colours; case
  bands moved to a labelled header lane above the activity bands; a
  dedicated screenshot rail with clear camera markers; the Flow-diagram
  graph re-themed to the light palette.
- **Bottom playback bar.** A global video transport — skip, play/pause,
  scrub — pinned below the Session view.
- **Steps view polish.** Compact step durations in the list, Duration /
  Start / End stat tiles in the detail pane, and proper card styling.

### Added (round-2 UX feedback — features)

- **Recent dropdown in the top-bar.** Recent sessions + projects were
  only reachable from the Session empty-state, which vanishes once a
  session loads. New "Recent" dropdown next to the Project menu lists
  recent projects + recent sessions + bundled examples, reachable any
  time.
- **Capture: explicit "Start capture session" button.** The Live
  Session window had no obvious way to begin — its primary control was
  "Fire" (a marker), which auto-starts a session as a side effect. It
  now shows a prominent Start button when idle; the marker controls
  dim until a session is running.
- **Timeline Lanes menu.** The timeline had grown to nine stacked
  lanes. A new "Lanes" dropdown in the timeline header toggles idle /
  markers / screenshots / cases / density / window-titles / per-step
  bands / note dots. Defaults keep the core lanes on and the denser
  additions off; the choice persists.
- **Flow diagram variant overlay.** Hovering a node in the Compare
  Sessions Flow diagram now highlights the session paths (variants)
  running through that activity and dims everything else — you see
  where work diverges. The standalone variant-flow Sankey
  (`viewer/variant-viewer.js`) is removed; the Flow diagram absorbed
  the useful idea.
- **Process map SVG export.** New "Process map SVG" export button.
  Exports whichever map is showing — the BPMN process diagram (via
  bpmn-js `saveSVG`) or the Flow diagram (via a hand-written
  cytoscape→SVG serializer) — as an SVG that imports cleanly into
  Figma, Lucidchart, and browsers.

### Changed (round-2 UX feedback — clarity)

- **"Rework loops" panel renamed** to "Repeated activities within a
  case", with a plain-English explainer ("activities a worker did
  more than once inside the same case — often a sign of rework").
- **Capture session-config window** rewritten for a business
  audience: "Set up a recording session", every field relabelled in
  plain language with a one-line helper.

### Added (round-2 UX feedback — step-noise solution)

- **Step-noise denylist.** A session captured with OBS (or any app the
  UIA recorder picks up) visible used to produce dozens of unannotatable
  steps ("OBS 31.0.1: 12 interactions"). New per-session denylist:
  `annotations.json` gains `step_filters.ignored_processes`;
  `step_suggest.py` drops matching interactions (case-insensitive
  substring on process_name + window_title) before step suggestion.
  New "Ignored apps..." button on the Steps view toolbar opens a dialog
  listing every app observed in the session with its interaction count;
  ticking an app + Save re-analyzes the session with that app excluded.
- **Bulk-delete steps.** Ctrl+click 2+ steps, then "Delete selected"
  removes them in one confirm. Ctrl+Z restores the whole batch.
- **Hide step as noise.** New "Hide as noise" button on the step editor.
  Hidden steps drop out of the list (revealed via a new "hidden" filter
  chip) and — unlike a delete — survive re-analyze: `_merge_steps`
  preserves the `hidden` state so a re-suggest doesn't resurrect them.

### Fixed (round-2 UX feedback — bug bash)

- **Resize handle did nothing.** `.timeline-scroll` had `flex: 1`
  (flex-basis 0) which overrode its `height: var(--timeline-height)`,
  so the `#resize-timeline` drag updated the CSS variable but nothing
  moved. Now `flex: 0 0 auto` so the height var drives the viewport.
- **Zoom buttons overlapped the tabs** in Compare Sessions — the
  verbiage rename had blown the tab labels up. Header now wraps;
  `.map-zoom` is shrink-resistant; the BPMN tab label trimmed back to
  "Process diagram".
- **Misleading `+` cursor** on the timeline (`crosshair`) changed to a
  normal cursor; activity-band hover uses `pointer`. Legend gained an
  interaction hint.
- **Screenshot dots** toned down from 14px glowing circles to quiet
  9px markers that brighten on hover.
- **Cases dropdown** showed a lone "All cases" with no explanation on
  an unanalyzed session; now adds a "(no cases yet — click Analyze
  session first)" hint.
- **Steps editor scroll** — the selected-step editor scrolled off-screen
  when the step list was scrolled. The detail pane is now `sticky` so it
  stays put while the list scrolls.

### Added (P2.2 full + audit fixes)

- **P2.2 Variant flow visualization (full).** New `viewer/variant-viewer.js`
  module renders trace_variants as a Sankey-style metro map: each
  unique (column, activity) becomes a node, edges connect consecutive
  activities across variants, both node and edge widths scale with
  the number of sessions flowing through. Divergence columns are
  highlighted in amber so split points are obvious at a glance. The
  Path variations panel in Compare Sessions now has Flow / Table tabs;
  Flow is the default. Click a node to drill into the activity.

### Fixed (audit pass on the deferred batch)

- **P2.7 screenshot gallery filter** simplified to All / Manual / Auto.
  The previous Marker / App switch / Activity resumed options never
  matched anything because capture's `tracker.fireSystem("screenshot",
  ...)` doesn't write a `reason` field — those distinctions only ever
  lived in the spec. Filter now matches what the data actually carries.
- **P2.2 variant heat empty state.** Previous render's rows would
  persist when switching to a session set with no variants. Now shows
  "No variants — analyze sessions to populate."
- **AM.1 timestamp parsing** replaced fragile offset arithmetic
  (`off === 13 || off === 16 ...`) with an anchored regex that fails
  loudly on unrecognized formats instead of silently mangling them.
- **Process Template form editor**: edits to the Advanced YAML
  textarea now update the form view (debounced 350ms; bails silently
  while the YAML is mid-edit and unparseable). And step deletion now
  cleans up dangling references in `proc.phases[].step_ids[]` so a
  phase can't end up pointing at a missing step.
- **P2.12 window-title strip label threshold** was double-counting
  zoom: `host.clientWidth` already reflects the post-zoom width, so
  the previous `(w/100) * hostW * zoomFactor` was 1.5–3× too aggressive
  and labels appeared on bands that were actually too narrow.
- **P2.3 viewport state across modes** was losing the snapshot because
  `display: none` panels return 0 for `scrollWidth` / `clientWidth`.
  Snapshot now reads from the still-visible outgoing layout BEFORE
  swapping visibility.

### Added (deferred-spec follow-up pass)

- **Process Template form editor** replaces the regex-parsed read-only
  step list with an actual editable form: rename / reorder / add /
  delete steps, edit name and description, with reorder arrows on
  every row. Round-trips through `js-yaml` so the underlying match
  rules and other fields the analyst doesn't see stay intact. Match
  rules themselves remain in the Advanced YAML editor.
- **Phase drag-reorder** (P2.6). Step rows inside a phase can now be
  dragged to reorder; a drop indicator follows the cursor and the
  source row dims while dragging. Reorders persist via
  `annotations.json`.
- **Screenshot gallery** (P2.7). New "Open gallery..." link on the
  Screenshots side-panel opens a full-pane overlay. ←/→ steps
  through screenshots, Space toggles auto-advance (~1.2s), Esc
  closes, click the image to seek the video. Filter by trigger
  reason (manual / app switch / activity resumed / marker fire).
- **Window-title runs lane on the Flow timeline** (P2.12). New lane
  between density and steps showing one band per consecutive
  (app, title) run. Labels render only when bands are wide enough
  (~50px); narrow bands stay as colour stripes so the rhythm of
  title changes is visible without crowding labels.
- **Connect Flow / Steps / Phases viewport state** (P2.3). Switching
  view modes now transfers zoom and scroll fraction across the
  three modes — zoom Flow to 3x, scroll mid-session, switch to
  Steps and you stay at the same place.
- **Multi-version Process Template comparison** (AM.1). Every save
  of a Process Template archives a snapshot under
  `.template-history/<basename>/<timestamp>.yaml`. New "Compare
  Process Template versions" panel in the Compare Sessions view
  lets you pick two versions and see a structural diff: steps and
  phases added / removed / renamed.
- **Variant heat** (P2.2, scoped first cut). The Variants table
  in the Compare Sessions view now renders with a frequency-bar
  heat strip per row, an explicit session-count badge, and a
  visual divergence highlight on activities that appear at the
  same position across multiple variants (where paths split).
  Full timeline-overlay rendering deferred — that needs PM4Py
  per-step variant data plumbing on the Python side.

### Changed (verbiage pass for business-analyst audience)

A targeted sweep through user-facing labels, headers, button text,
help copy, and toasts to replace process-mining / engineering jargon
with business equivalents. Internal variable names, IPC channels,
file names, and code comments are unchanged so internal references
keep working. Highlights:

- **"Aggregate" → "Compare Sessions"** wherever it surfaces in the
  UI: the Tab 2 label, the help-modal navigation entry, the help
  text describing it, and the empty-state hero button ("Open
  sessions to compare..."). Internal handler / id names like
  `aggregateSessions`, `view-aggregate`, etc. stay as-is so
  existing wiring remains intact.
- **"Vocabulary" / "App Vocabulary" → "App Library"**: Tab 4
  label, the section heading, the prep CTA card, the Save / Bootstrap
  buttons, the related toast messages, and the New / Save dialogs.
- **"DFG" → "Flow diagram"**: the panel-tab in Compare Sessions's
  Process map. The discoverability tooltip explains it's a
  Direct-Follows Graph for analysts who recognize the term.
- **"BPMN" → "Process diagram (BPMN)"**: the other panel-tab.
  Keeps the industry-standard acronym (importable into Adonis,
  Bizagi, Camunda) but adds the parenthetical so it's not opaque
  to first-time readers.
- **"Canonical YAML saved" → "Process Template saved"** and other
  toast / dialog touches in the Process Template surface.
- **Process Template tab** layout reframed: the raw template
  definition is now behind an "Advanced: full template definition"
  expander rather than the default-visible YAML pane. The list of
  template steps stays directly editable; the underlying definition
  is collapsed-by-default for non-engineer analysts.
- **First-line README and help phrasing** stays focused on the
  analyst-trying-the-tool experience.

### Added

- **Mode-specific shortcuts overlay** (P2.4). Small persistent
  bottom-right widget on the Session view listing the current
  view-mode's 3-4 most-used shortcuts. Dismissable; preference
  persisted to localStorage.
- **Case-scope dropdown deduplication + scope-to-playhead** (P2.8).
  Duplicate marker labels in the case-scope dropdown get a
  `[H:MM:SS]` time-offset suffix so analysts can tell repeated
  cases apart. New `⇥ playhead` button next to the dropdown scopes
  to whichever case contains the current video playhead.
- **Snap-to-event on timeline click** (P2.9). Background click on
  the Flow timeline snaps to the nearest event within ~10px-worth
  of pixel tolerance (scaled by zoom). Genuine empty-space clicks
  still seek to the literal point.
- **Hotkey conflict detection at startup** (P2.10, capture).
  When `globalShortcut.register()` fails (another app is using the
  binding), a Windows toast surfaces the conflict naming each
  failed hotkey, instead of the silent boot.log-only signal.
- **Analyze-all per-iteration progress label** (P2.11). The
  Aggregate "Analyze all sessions" button shows
  "Analyzing N / total..." per-iteration so a long sweep doesn't
  look frozen. Cancel still works mid-loop.
- **Tray menu reorganization** (P2.13, capture). The previously-flat
  tray menu now groups everything beyond the muscle-memory action
  items (Fire Start / End / Pause / End session) into three named
  submenus: Live status (overlays + windows), Storage (recents +
  prune), and Help & config (help + OBS + session config). Fits
  on small-DPI screens.
- **Live-session window keyboard shortcuts** (P2.14, capture).
  S = focus the marker input, E = end marker, P = pause/resume,
  Y = open sync-marker row. Suppressed when an input is focused.
- **Auto-suggested phase grouping** (AM.2). New "Suggest groupings"
  link on the Phases pane runs two heuristics — group consecutive
  steps from the same app, and group consecutive steps with no idle
  gap > 30s — to propose phases. Preview shown as a confirm modal;
  Apply all creates auto-suggested phases the analyst can rename
  and tweak. Skips steps already in a phase.
- **Range selection on the timeline** (P1.1). Shift-drag across the
  Flow timeline to select a time range; a "Selection" stats card
  pops above the legend showing duration, event count, marker count,
  screenshot count, and top apps in the range. Esc clears. The range
  survives view-mode switches and clears on session change.
- **Screenshot hover thumbnails** (P1.2). Hovering a screenshot dot
  on the Flow timeline pops a 220×140 thumbnail preview near the dot.
  Click still opens the full modal.
- **Mini-map overview above the timeline** (P1.3). 30px strip showing
  the whole session compressed into the visible region. Click anywhere
  to jump; drag the highlighted viewport to scroll. Per-app coloured
  bands provide a thumbnail-of-the-timeline read at a glance.
- **Per-step duration bands on the Flow timeline** (P1.4). When a
  session has steps (auto-suggested, auto-matched, or manually
  authored), each step renders as a labeled band on a dedicated lane
  beneath the density histogram. Click a step band to switch to Steps
  view with that step selected.
- **DFG drill-down picker** (P1.5). Clicking a DFG node in the
  Aggregate view now lists every loaded session containing that
  activity (timestamp + session name) instead of jumping to the
  first match. Single-result auto-picks; ↑↓/Enter for keyboard
  navigation; Esc to dismiss. The picker positions near the click.
- **Batch "Remove N missing" link in Recents** (P1.6). When ≥2
  recents entries are flagged missing, a "Remove N missing" link
  appears alongside "Clear all" so the analyst doesn't have to
  ✕ each one individually.
- **Sparklines on aggregate bar charts** (P1.7). The
  activity-frequency and case-duration bar charts in the Aggregate
  view get a tiny 10-bucket sparkline at the bar's right edge,
  showing temporal distribution across the loaded sessions' wall-
  clock span. Quick read for "did this cluster early or evenly?"
- **Auto-clean stale recents** (P1.8). When a Recents entry is first
  detected missing, `firstMissingAt` is stamped on it. After 30 days
  of being missing, the entry is silently dropped on the next
  render. A temporarily-unplugged drive can't false-positive a real
  recent off the list.
- **Annotation lane on the Flow timeline** (P1.9). Numbered note
  dots render in their own lane between steps and cases when notes
  exist. Click a dot to jump to that note in the side panel and
  seek the video to the note's timestamp.
- **Persistent timeline zoom + scroll per session** (P1.10). Zoom
  factor and `#timeline-scroll.scrollLeft` are persisted to
  localStorage keyed by sessionFolder; reopening a session restores
  the zoom and scroll position. Scroll writes are throttled to once
  per 250ms.
- **Project / engagement layer** (P2.1). New `viewer/project.js` data
  module + topbar Project menu + `.pdt-project.json` file format. A
  project bundles the loaded aggregate session set, the current focus
  session, the active process template, the current view mode, the
  current case scope, and the timeline zoom into a single re-loadable
  file. New IPC handlers `viewer:saveProject`, `viewer:saveProjectAs`,
  `viewer:openProject`, `viewer:loadProjectFile`. The Session view's
  empty state now surfaces a "Recent projects" list alongside "Recent
  sessions"; click a recent project to restore everything in one go.
  Standalone-session opens (the existing flow) still work unchanged
  and don't create projects until you explicitly Save as.
- **Aggregate filter date-range hint.** "YYYY-MM-DD" hint label appears next
  to the From / To date inputs in the Aggregate view so the expected format
  is obvious in environments where browsers render date inputs as plain text.

### Changed

- **Capture window palette aligned to viewer.** All capture-side windows
  (help, OBS settings, session config, label picker, prep-app vocab,
  legacy status) now use the same stratified-dark sage / slate ladder as
  the viewer (`--bg: #14141A` through `--bg-5: #484854`,
  `--fg: #D8D6CE`, `--accent: #6E8A66` sage,
  `--accent-2: #5A7488` slate). Eliminates the electric-blue accent
  (`#3a86ff`) that lingered in the older tray surfaces and clashed with
  the rest of the app.
- **Capture help window** rewritten to document the v0.3 surface area:
  Live Session window, hotkey overlay, first-run welcome, marker
  close-then-open default, multi-monitor screenshot config, and the
  Session config window (vs. raw YAML).
- **Viewer help modal** now documents undo / redo (Ctrl+Z / Ctrl+Y),
  the right-click context menu on activity bands (insert markers,
  scope-to-case, jump-to-case-start/end), and the analysis Cancel
  button.
- **README** gains a "What's new in v0.3" section near the top so a
  first-time reader doesn't have to dig through the changelog to learn
  about the live session window, undo, marker close-then-open, etc.
- **`scripts/generate-icons.ps1`** now reads the sage / slate / bg
  hex tokens directly from `viewer/styles.css` instead of duplicating
  the hardcoded literals. Falls back to the previous defaults if the
  CSS file is missing (so a stripped dist still builds icons).

### Removed

- **Dead `escapeHtml` stub in welcome-window.js**. The inline
  duplicate inside the embedded `<script>` block was unused;
  template-literal callers all hit the module-level definition.
  Bookkeeping cleanup.
- **Last `window.confirm` from the legacy status window.** End-session
  click in `capture/status-window.js` now opens an inline confirm row
  (Cancel / End session) styled to match the operator-panel pattern,
  rather than a raw browser confirm dialog. With this, no
  `window.confirm` or `window.prompt` remains in either app's normal
  flow.

## [0.3.0] - 2026-05-15

UX overhaul (capture + viewer) plus structured logging and CI from a
parallel work stream. See [docs/UX-CHANGES.md](docs/UX-CHANGES.md) for
the full UX changeset rationale and
[SPEC-DEFERRED.md](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/SPEC-DEFERRED.md)
(on branch `product-edition`) for items intentionally deferred to v0.4+.

### Added (UX overhaul)

- **Themed confirm / prompt modals.** Replaces every browser-native
  `window.confirm` / `window.prompt` site in the viewer (7 call sites)
  with `confirmModal()` / `promptModal()` helpers. Destructive
  confirms support a `danger: true` flag that styles the OK button
  red and focuses Cancel. Same swap applied in the capture-side
  operator panel (sync ID, end session inline-confirm rows). Browser
  dialogs no longer appear in either app's normal flow.
- **First-run welcome window** (`capture/welcome-window.js`). 560×540
  onboarding shown once per machine (gated by
  `userData/welcome-shown.json`). Three CTAs: open the live session
  window, open help, dismiss. Reopenable via tray → Help.
- **Hotkey overlay widget** (`capture/hotkey-overlay.js`). Always-on-
  top, click-through, frameless 220×110 corner widget showing the
  three primary hotkeys. Toggleable from the tray; visibility
  persisted across launches.
- **Live session window** (`capture/operator-panel.js`, rebuilt).
  Merges the old operator panel and status window: counter grid,
  recent-events feed, fire-marker input + nest checkbox, inline sync
  marker, inline end-session confirm. Stratified-dark palette to
  match the viewer. The legacy status window remains in the tray as
  "Show status window (legacy)" for one release.
- **Marker close-then-open by default.** Pressing Start with an
  existing open marker now closes the open marker(s) and opens a
  sibling, eliminating the "4 starts, 0 ends, all nested" pathology
  that caused overlapping case bands. Nest semantics remain
  available via the "Nest under current" checkbox in the live
  session window, the picker's secondary button, or a dedicated
  tray submenu. Shift+Enter in the picker flips the choice for one
  fire.
- **Multi-monitor screenshot follows foreground.** New
  `screenshots.display` config (`"active"` default, `"primary"`,
  `"all"`). Active mode picks the display containing the focused
  window via `active-win` bounds; all mode captures every display
  and emits one screenshot event per file with `_d<displayId>.jpg`
  suffix. Fallback chain: foreground bounds → cursor position →
  primary.
- **Native Windows toast on recorder / OBS failure.** When the UIA
  recorder dies permanently or OBS connect fails (non-strict), an
  Electron `Notification` surfaces the failure. Replaces the silent
  tray-tooltip-suffix-only signalling.
- **Annotations undo stack** (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y).
  Every step / phase / marker / note operation snapshots
  annotations.json before saving; undo reverts; redo replays. Stack
  capped at 50, reset on session switch. Action-labeled so the
  undo toast reads "Undone: split step."
- **Time-axis ticks on the Flow timeline.** Sensible tick step
  picked from `{1s, 2s, 5s, 10s, 15s, 30s, 1m, 2m, 5m, 10m, 15m,
  30m, 1h, 2h, 4h, 6h, 12h, 1d}` for ~12 ticks across the visible
  span. HH:MM:SS / HH:MM / M/D labels depending on granularity.
- **Event-density histogram lane.** 120-bucket histogram showing
  user-activity event volume per bin. Bookkeeping events (idle
  starts, pause/resume, recorder lifecycle) excluded so the lane
  reflects analyst-relevant activity. Makes idle-vs-active stretches
  readable at a glance.
- **Per-case lanes on the Flow timeline.** Each case occupies its
  own row via a sweep-line lane assignment, instead of all cases
  stacking onto a single depth-offset row. Dangling cases get a
  dashed right-edge treatment instead of merging visually with
  same-end-timestamp neighbours. Timeline height grows with
  `lanesNeeded`.
- **Case band context menu.** Right-click a case band: scope view
  to this case, jump to start, jump to end. Solves the case-scope-
  dropdown deduplication problem indirectly (you can pick visually).
- **Right-click discoverability hint.** Faint `⋯` fades in at the
  top-right of activity bands on hover; `cursor: context-menu`
  surfaces that right-click does something.
- **Analysis progress streaming + cancel.** Log host opens by
  default while normalize is running. Red Cancel button in the log
  summary kills the in-flight Python child (SIGTERM, then SIGKILL
  500ms later). Cancellation flows through all four normalize entry
  points (`viewer:runNormalize`, `viewer:runNormalizeExtended`,
  `viewer:testCanonicalMatch`, `viewer:bootstrapAppVocab`). The
  aggregate "Analyze all" loop additionally has its own Cancel
  button that kills the in-flight session and breaks the loop.
- **Brand-square icons** (`shared/tracker-icon.ico`, regenerable via
  `scripts/generate-icons.ps1`). Multi-resolution `.ico` (16/32/48/
  64/128/256) derived from the topbar logo design. Wired into both
  `capture/build-package.js` and `viewer/build-package.js` via
  `icon:`, so the .exe / taskbar / alt-tab / Start menu / window
  chrome show the brand square instead of the default Electron
  diamond. `capture/tray-icon.png` replaced with the matching
  32×32 brand square (was Motif's three-bar logo, an unrelated
  product).
- **Stratified-dark palette.** Viewer's six bg tokens (`--bg`
  through `--bg-5`) re-spaced across a wider lightness range
  (~6 points per step) so panels, the timeline strip, and rules
  visually separate at a glance. Foreground bumped to suit the
  brighter average surface. Accents unchanged. Hardcoded color
  literals in `dfg-viewer.js` and the right-click context menu
  rewritten to use CSS variables or token snapshots.
- **Filter clear-X buttons** on Recents (already shipped pre-v0.3
  but mentioned here for completeness).

### Added (other work stream)

- **Marker insert via the viewer timeline.** Right-click an activity band
  → "Insert Start marker here…" or "Insert End marker here". The edit is
  queued in `annotations.json.marker_edits` with `op: "insert"`; re-run
  normalization to apply. Closes the README's "analysts edit
  annotations.json directly until that ships" caveat. `apply_marker_edits`
  in `normalize.py` now supports the insert op.
- **Session config window in the capture app.** New "Session config..."
  tray menu entry opens a form for engagement ID, worker, idle threshold,
  process labels, and OBS scene. Saves to
  `%APPDATA%\process-discovery-tracker\quick-config.yaml`. The next
  launch picks this up automatically if `PDT_CONFIG` is unset.
- **Recorder sidecar threat model** section in `SECURITY.md`. Covers
  process boundary, IPC mechanism (NDJSON over stdio), privileges, what
  UIA does and doesn't expose, and the lifecycle events.
- **Structured logging** for normalization. `normalization/log_setup.py`
  configures a stdlib `logging` root with a stderr handler at WARNING and
  a per-session `RotatingFileHandler` writing `normalize.log` into the
  session folder at INFO. Called from `normalize.py` entry.
- **Capture-side log helpers.** `capture/log.js` exposes `appLogger()`
  (writes to `%APPDATA%\process-discovery-tracker\app.log`) and
  `createSessionLogger(folder)` (writes to `<session>/capture.log`).
  Always-on; complements the existing `bootLog` (gated on `PDT_DEBUG=1`).
- **OBS lifecycle now logs to `app.log`.** Connect failures, scene
  bootstrap failures, and start/stop record failures land in
  `app.log` in addition to the debug-only `boot.log`.
- **Pytest CI.** `.github/workflows/pytest.yml` runs the normalization
  test suite on push and PR to master/main. windows-latest, Python 3.12.
- **`stats.json.meta.dropped_jsonl_lines`.** Count of malformed JSONL
  events the normalizer dropped during load. Surfaces in the pipeline
  console output as well.
- **`docs/DEPLOY.md`.** Install, upgrade, rollback runbook for capture
  and viewer. Includes the BPMN export pivot path if Adonis ever
  rejects PM4Py's output.
- **`docs/TROUBLESHOOTING.md`.** Known failure modes (OBS, recorder,
  hotkeys, taxonomy YAML, slow mining) with log-file pointers.
- **Data dictionary** in `shared/SCHEMA.md`. Semantic notes for the
  `case_ids` stack, step lifecycle states, interaction enrichment
  precedence, and every `stats.json.meta` field.

### Changed

- **Silent exception handlers narrowed.** `bpmn_step.py`, `bpmn_phase.py`,
  and `pdd_export.py` previously caught `Exception` and `pass`'d. Each
  site now catches the specific exceptions it can produce and logs a
  warning with the step / file context. `step_csv.py` was reviewed and
  left as-is — its `except ImportError: pass` is an intentional optional
  pandas fallback to stdlib `csv`.
- **`pdd_export.py` italic bug fixed.** `p.italic = True` on a python-docx
  `Paragraph` is a no-op (only `Run` has `italic`). The previously-swallowed
  AttributeError is now properly avoided by iterating `p.runs`.
- **Malformed JSONL is now logged, not silently dropped.** `load_events`
  in `normalize.py` emits a `WARNING` per dropped line with line number
  and a 120-char snippet. The total count appears in the pipeline summary
  and in `stats.json.meta`.
- **Taxonomy promotion YAML uses `[REVIEW]` instead of `TODO -`.** The
  viewer's "Promote unclassified to taxonomy" export prefixes generated
  labels with `[REVIEW]` so they're visually distinct from forgotten
  developer TODOs that survived into shipped output.

## [0.2.0] - 2026-05-15

First release published via GitHub Releases. Prebuilt binaries are
attached as `capture-v0.2.0.zip` and `viewer-v0.2.0.zip`; the in-repo
`capture/dist/` and `viewer/dist/` trees are gone (gitignored). On a
fresh machine, download from the Releases page rather than cloning the
repo. See README "Installing a prebuilt release" for the SME-side flow.

### Added

- **`interactions.verbose` config flag.** Opt-in forensic mode that
  restores the raw UIA event firehose (focus_changed, text_changed,
  per-keystroke value_changed). Default off. Use only when debugging
  missing events or focus-tracking issues; expect ~3-5x more events
  per session.
- **Auto-extract for `recorder.zip` at runtime.** If `recorder.exe` is
  missing but `recorder.zip` is present next to where it should land,
  `resolveRecorderPath()` extracts it via Windows-native `tar.exe -xf`
  (libarchive-backed, ships with Win10+). Eliminates the silent-fail
  trap where capture sessions ran without UIA recording because the
  recorder zip was never manually extracted.
- **`scripts/publish-release.ps1`.** Wraps `gh release create
  vX.Y.Z dist\release\*.zip ...`. Verifies both assets exist before
  uploading; supports `-NotesFile`, `-Draft`, `-Prerelease`.
- **`docs/BUILD-AND-DIST.md`.** Explains the recorder.exe topology
  (`bin/` vs `obj/` vs `publish/` vs `dist/.../resources/publish/`),
  the distribution model (GitHub Releases), and what's safe to delete
  to reclaim disk space.

### Changed

- **UIA subscriber filters noise at the source.** Three high-volume
  subscriptions were dropped from the default subscription set:
  - `focus_changed` events (fired on every Tab keystroke, click-shift,
    menu hover, dialog open/close). The window/process semantics we
    actually care about ride along on the next signal event.
  - `text_changed` events (notification-only, no payload, mostly a
    heartbeat indicating typing somewhere).
  - Win32 desktop-chrome events (taskbar, window manager, AltTab
    list) where `FrameworkId == "Win32"` and `ControlType` is in
    `{Pane, Group, Window, Custom}`.
  - `value_changed` / `range_value_changed` are now coalesced per
    `(pid, automation_id || name)` within a 750ms debounce window:
    typing "Customer Acme Corp" in an edit field produces one event
    with the final value instead of one per keystroke.

  Expected event volume reduction: 70-85% in typical sessions. An
  8h session that previously produced ~85k events should land in
  the ~15-25k range without losing analytical signal.

- **`scripts/build-distribution.ps1`** now produces `dist/release/`
  containing `capture-vX.Y.Z.zip` and `viewer-vX.Y.Z.zip` ready to
  attach to a GitHub Release. Each zip has a single versioned
  top-level folder (e.g. `capture-v0.2.0/`) so Windows Explorer's
  "Extract All" produces the expected layout. New flags: `-Version`
  (override the release-asset version suffix), `-SkipRelease` (build
  but don't zip).

- **`README.md`** rewrote the "Building for distribution" and added a
  new "Installing a prebuilt release" section. Recipients are
  directed to the Releases page rather than to a manual zip dance.

### Removed

- **In-repo prebuilt `dist/` trees.** `capture/dist/` and `viewer/dist/`
  are now gitignored. The previous "commit the .zip-of-.exe to fit
  under GitHub's 100 MB file limit" workaround was replaced by GitHub
  Releases (2 GB per asset). About 600 MB of committed binaries dropped
  from the repo.
- **`scripts/unzip-dist.ps1`.** Obsolete — Releases ship unzipped
  folders.

### Migration notes

- **For SMEs / analysts**: stop cloning the repo to get the apps. Go
  to the [Releases page](../../releases), grab the two zips, extract,
  run.
- **For maintainers**: the recorder.exe must be rebuilt (`cd capture &&
  npm run build:recorder`) for the noise filter to take effect — the
  C# subscription set lives in `recorder.exe`, not the Electron host.
- **For anyone running an existing session with the old recorder**:
  no action required, but consider a fresh build to cut event volume.

## [0.1.0] - 2026-05-14

Pre-release internal builds. Not published to GitHub Releases; binaries
lived inside the repo as zipped .exe files in `capture/dist/` and
`viewer/dist/`. See git history for incremental changes.
