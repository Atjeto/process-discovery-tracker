# How to use PDT

This guide gets a process manager started with the Process Discovery Tracker
(PDT). It follows one example, the demo project that comes with PDT: an
order-to-cash process. The SME, Maria Keller, recorded four orders at a sales
desk. For each order they found the customer in Order Desk, a web app,
entered the order there and added it to the tracking sheet in Excel. The
second order also needed a printed confirmation and a material looked up in
Notepad, the third was for a new customer, and the fourth started on the
wrong customer. The demo project is this example finished: open it to see
what each act gives.

In the app, the same guide is Help, *Getting started* (the ? in the top
bar).

## What PDT does

1. The SME records the process a few times: each pass is a transaction, for
   example one order.
2. PDT drafts the steps of each transaction and draws the process map.
3. You fix and name the steps of one transaction, the reference transaction,
   and confirm it.
4. You write the document fields, and PDT writes the PDD with the map: the
   process written down, for the SME to confirm and for whoever asks about
   it.
5. You hand the PDD and the whole project to the developers as a numbered
   version.

## Start a project

- **From the SME's recording.** The SME records with the capture app and
  sends you the zip it makes (*Make a zip for the analyst*). In PDT, choose
  *Open*, *Open a zip...* and pick the zip, then say where its folder is
  made (beside the zip unless you choose another place). PDT unzips it,
  opens it and analyzes the recording by itself: the top bar says *Updating
  steps and map...* until it is done. You can also drop the zip on the page
  shown while no project is open.
- **From a video.** Choose *New*, *New project from a video...* and pick the
  video, for example a Teams recording of the SME at work, with its
  transcript if you have one: pick both at once. Several videos go one after
  the other in the order of their names, and each transcript goes with the
  video whose name it shares. Then name the project: its folder is made where
  you save it, with a copy of the videos and the transcripts attached.
  It opens on the Timeline, where you mark the steps as you watch (*Mark a
  video as you watch it*, below).
- **From nothing.** Choose *New*, *New empty project...* and name the
  project. You add the steps by hand, or paste your notes: in Steps, click
  *Paste notes...* and paste them, and each line becomes a step.
- **The demo.** Choose *Open*, *Open the demo project*. A finished project
  opens: four orders entered in the Order Desk web app and an Excel
  tracking sheet, with its video, transcript, flow, sub-process, notes,
  attachments, document and maps. Each time you get a fresh copy in
  *Documents\PDT demo*, so change anything.

Help, *Recording keys*, lists what to tell the SME before they record.

## Your first hour

The Overview's *Checklist* lists the main acts below and ticks each one when
it is done; its button takes you to the next. For a recording the acts are
*Mark the transactions*, *Confirm the reference transaction*, *Review the
other transactions*, *Write the document* and *Hand off*. For a project made
from a video or from nothing they are *Add the steps*, *Write the steps* (a
name of its own and a description for each step), *Review the other
transactions* when it has two or more, *Write the document* and *Hand off*.
On the Timeline, Steps and the Map, the top bar shows the next act, such as
*Next: write the steps (1 of 7)*, and a click on it opens the Checklist.

1. **Attach the video and the transcript.** On the Overview, click *Attach*
   after *No video* and pick the video. PDT opens the Timeline: pause the
   video at a moment you recognize, click *Mark frame*, then click the same
   moment on the timeline. The video is copied into the project folder.
   Attach the meeting transcript (a Teams .vtt or .docx) with *Attach* after
   *No transcript*: the synced video places its sentences in time. Without a
   video, *Sync...* on the Timeline's *Transcript* lane places it: pick a
   sentence, then click where it was said.
2. **Check the transactions.** On the Timeline, each transaction is a band,
   from *Transaction 1* to *Transaction 4*. If one is missing, right-click the
   timeline where it starts and choose *Start a transaction here...*. If one
   starts or ends in the wrong place, type its times in Steps or drag its
   band on the Timeline (see *Everyday tasks*).
3. **Name the steps of the reference transaction, or pick them from the
   library.** In Steps, transaction 1 is the reference transaction. Where
   the recorder cut a step wrongly, split or merge it first (see *Everyday
   tasks*). Then click each step and type its name, the title of the
   selected step: the step that ends at *Save order* becomes *Enter the
   order*.
   The same drafted step in the other transactions takes the name too. Where
   the library has activities for the step's system, the *Name* field lists
   them: pick one instead of typing.
4. **Write short descriptions.** *Description*, under the step's name, is
   the text the PDD prints under the step. One or two sentences are enough,
   for example on *Add the order to the tracking sheet*: *Type the new order
   as a row of the order tracking sheet (order, customer, item, quantity,
   unit price) and save the sheet.* With a
   transcript, what the SME said during the step is right under it: *Add*
   copies a sentence into the description. The step panel on the right
   plays the step (*Play*) and shows every time it happened, with its
   screenshots, what was said and notes. What the recorder saw is under
   *Recorded*.
5. **Set the flow where it branches or loops.** In transaction 2 the SME
   printed a confirmation: that customer wants one with every order. On
   that step, *Print the order confirmation*, click *Only when...* and type
   *the customer asks for a printed confirmation*. In transaction 4 the SME
   started on the wrong customer, cancelled and searched again. On *Enter
   the order*, click *Decision...*, pick *Find the customer* under *Back to*
   and type when: *the wrong customer was selected*. The demo's flow also
   goes from *Find the customer* to *Create the new customer*, a step
   transaction 3 did, when *the search finds no account*, and ends early
   after *Enter the order* when *the customer's credit is blocked*. The map
   draws them all.
6. **Confirm the transaction.** Click *Confirm transaction* (Ctrl+Enter).
   The steps you did not change are accepted as they are. *Undo confirm*,
   beside the *Confirmed* badge, takes it back. A transaction with no drafted
   step, such as one you added by hand, has nothing to confirm: it shows no
   *Confirm transaction*, and the Checklist ticks the act.
7. **Look at how the other transactions differ.** Open transactions 2, 3 and
   4 in Steps. Their rows show how each differs from the reference
   transaction: *Extra*, *Again* or *Moved* on a step, and a greyed
   *Skipped* row where a step of the reference transaction is missing
   (point at one to read it whole). A missing step that has a condition
   reads *Not done* instead, which is no difference. The Checklist asks you
   to open only the transactions that differ. Transaction 2 has two
   extra steps: the printed confirmation and the Notepad lookup.
   Transaction 3 has one: *Create the new customer*. Transaction 4 has no
   differences, and a line says that part of it was left out of the
   analysis (the stretch where the SME started on the wrong customer). Where
   the recorder drafted the same work as another step, give it the name of the
   reference transaction's step: it then counts as that step. The other
   transactions are not confirmed.
8. **Fill the document fields on the Overview.** Open *Document* and write
   each field: title, purpose, scope, trigger, result, key contacts,
   business rules, exceptions, volume and effort, and the improvement and
   automation scope (the request and the notes are optional). For example, the title *Order to
   cash: enter a customer order*, the trigger *A customer order arrives by
   e-mail* and the volume and effort *About 40 orders a day, 2 to 3 minutes
   each*. The PDD prints each field in its own place, and the title names
   the files PDT makes: *Order to cash enter a customer order PDD.docx* (a
   file name cannot hold the colon). With a transcript, *Add to* puts a
   sentence into a field. Where a value is typed again in another system
   (here, the product from Order Desk in the tracking sheet in Excel), the
   PDD says so under the improvement scope.
9. **Check the Map.** The Map shows the map the PDD prints: a box per step
   with the system it is done in above it, and the decisions from the flow
   you set. The demo's map starts at the trigger and ends at the result you
   wrote, with a decision before each step only some orders need, such as
   *Create the new customer*. Click a
   box to see each time the step happened, with its moment in the video and
   its screenshots. *Show how the transactions ran* shows the paths the
   transactions took; point at a line to see how often.
10. **Hand off.** Click *Hand off...* on the Checklist, or choose *Export*,
    *Hand off...*. PDT makes one zip with the whole project, the PDD and the
    process map (see *Hand over to the developers*). The PDD is written
    again from the project each time, so hand off again after a change. For
    the PDD alone, for the SME to read, choose *Export*, *PDD (.docx)*. With
    attached files, as in the demo, the PDD comes as one zip with an
    *Attachments* folder: the attachment names in the PDD open the files
    once the zip is extracted, so the SME gets them with the document.

## Everyday tasks

### Mark a video as you watch it

1. Play the video on the Timeline: click *Play*, at the left of the row
   above the timeline, or press Space. To go to a moment, click the clock
   beside it (*0:00 / 1:02:00*), type a time and press Enter. Where the SME
   starts the work, click *Start transaction*. While the video plays, the
   transaction starts at once; name it afterwards with Rename, on its header
   beside the video. *Lanes*, at the right of that row, chooses the lanes the
   timeline shows and says what their marks mean. To see a part of the
   timeline larger, click *+*: the bar under the lanes shows the whole
   length, and dragging its box moves along it. Double-click a transaction's
   band to show only that transaction; *Show all* shows the whole length
   again.
2. As each step starts, press S (or click *Add step*), or right-click there
   and choose *Add a step here*, on the band of the step before it too. The
   step before it ends there. The newest step is *open*, fading out on the
   Timeline: it ends where you add the next one.
3. Where the transaction ends, click *End transaction* (the same button
   reads so while a transaction runs on): its last step ends there too.
   *Start transaction* for the next one ends the one before it the same
   way. *Add note* puts a note at that moment; notes stay out of the PDD.
   Right-clicking the timeline offers the same acts at the moment you click.
   A message about what you did reads in the same row.
4. Each step you add opens beside the video, in the *Steps* tab, its
   screenshot taken from the video at that moment. Pause the video before
   you press S, and the cursor is in the step's name: type the name, press
   Enter, and play on. Its system and its description are right under the
   name. While the video plays, S only marks the steps: name them in the
   *Steps* tab or in Steps afterwards. *All steps* goes back to the list.
   Ctrl+Z takes back a mark put in the wrong place, with its screenshot.
5. The *Transcript* tab beside the video lists what was said, with its time
   and who said it. Type in its search to find a word, for example
   *invoice*: it shows how many sentences hold it. With several speakers,
   pick one to read only theirs. The sentence the video is at is marked and
   stays in view while the video plays, unless your pointer is on the list
   or the search holds text.
6. Click a sentence to go to that moment. *Add step here*, after the
   sentence, adds a step that starts where it is said. *Copy to...* copies
   the sentence into the description of the selected step or into a field
   of the document.
7. Steps written first, from your notes, have no time: the *Steps* tab
   beside the video says how many, and each of them has *Starts here* on its
   row. Go to the moment a step starts in the video, then click *Starts here*
   on that step: the step starts at that moment and, without a picture,
   takes the video's frame there. Its place among the steps stays.
   Right-clicking the timeline offers the same at the moment you click,
   naming the step, and Ctrl+Z undoes it.

### Put a step where it belongs in the process

1. Late in the video the SME corrects a step shown earlier, or adds a
   condition or a step that belongs before: mark it where it is said, as
   any other step (press S, or right-click and choose *Add a step here*).
2. Right-click its band on the Timeline, or its row in Steps, and choose
   *Place after a step...*, then pick the step it comes after, in its
   transaction or in another one. In Steps, Alt+Up and Alt+Down move it one
   step at a time.
3. In the process, on the map and in the PDD it now comes after that step.
   On the Timeline its band stays where it was said, with its video, and is
   marked as placed elsewhere in the process; its row in Steps reads
   *Placed*.
4. *Back to its time*, in its menu, puts it where its time puts it again.
   Ctrl+Z undoes a move.

### Work with several videos

1. On the Overview, click *Add another* after *Video* (*Add*, once there are
   several) and pick one or more videos: several go in the order of their
   names. In a project made from videos they go after the last one, back to
   back. In a recording you sync the first with two clicks, as when you
   attach one, and the others go after it; *Sync video...* on a video's band
   syncs that one again.
2. On the Timeline the *Videos* lane shows each video as a band. The
   timeline runs across them: a moment on it is the same moment however many
   videos there are. The video that shows the playhead plays, then the next
   one.
3. To trim a video, drag the start or the end of its band, or right-click it
   and choose *Trim the start here* or *Trim the end here*. In a project
   made from videos, the videos after it and what you marked on them move
   with it, and a trim that would cut away a step or a mark is refused and
   says what is there. *Give its start back* and *Give its end back* undo a
   trim, and so does Ctrl+Z.
4. Right-click a band to replace or remove that video (a video whose file is
   not found offers *Find the video...*). Removing a video takes what you
   marked on it with it, after asking. A transcript belongs to one video:
   *Attach* asks which, and its sentences move with that video. *Add
   another* after *Transcript* attaches the next transcript; each has its
   own row on the Timeline, with *Sync...*, *Replace...* and *Remove*.

### Add a step the recorder missed

1. In Steps, select the step it comes after.
2. Click *+ Add step* (or press N), type its name and click *Add step*.
3. Set its system: type it first on the line under the step's name.
   Alt+Up and Alt+Down move the step.
4. With a video, you can instead pause the video at that moment on the
   Timeline and click *Add step* (or press S), or right-click the timeline
   there and choose *Add a step here*: the step gets that time. In the
   demo, *Look up the SAP material* in transaction 2 was added at its
   moment: the recorder saw no action there.
   Right-clicking a step on the Timeline also offers to open it in Steps, or
   to delete it (a recorded step is hidden).
5. To add many steps at once, click *Paste notes...* in Steps and paste
   your notes from Notepad or Teams: each line becomes a step, the text
   after its first colon its description, and a line that starts with a
   document field's name and a colon (*Trigger:*, *Volume:*) goes to that
   field. The line under the box says what it will make. One
   Ctrl+Z takes it all back.

### Change when a transaction or a step starts or ends

1. In Steps, open the transaction: *Starts at* and *Ends at* are under its
   name. Type a time the way the timeline shows it, for example *0:09* or
   *1:05.5*, and press Enter. Up and Down change it by a second. An empty
   *Ends at* runs until the next transaction starts, or to the end.
2. What you marked together moves together: a step that starts or ends
   where the transaction does moves with its *Starts at* or *Ends at*. A
   step you delete gives its time back to the step before it.
3. A step you added has its times on the line under its name, for example
   *Transaction 1 · 0:09 to 0:31*: type a time there and press Enter.
   Emptied, its end goes back to where the next step starts or its
   transaction ends. A step added without a time says *no time yet*: type
   when it starts. The step
   then belongs to the transaction its start is in, and a step right
   against it moves along. A step the recorder drafted keeps the time of its
   recorded actions: split or merge it instead.
4. On the Timeline you can instead drag the start or the end of a
   transaction's band, or of a step you added; a transaction that runs to
   the end gets its end that way too. Near a step's start or the playhead
   it snaps there. Esc while dragging puts it back, and Ctrl+Z undoes a
   change.

### Split or merge steps

1. Select the step in Steps. The toolbar above the list acts on it:
   *Split...*, *Merge with next*, *Hide step*, *Open as a sub-process*, and
   *Delete* on a step you added.
2. To split it, click *Split...* (or press S): *Recorded*, under the step,
   lists its actions, and you click the scissors after the action where the
   first part ends. *Recorded* stays open or closed as you last left it.
3. To merge it with the next step, click *Merge with next* (or press M). To merge
   several, tick them in the list and click *Merge selected*. To move the
   line between two steps, merge them, then click the scissors where the
   first should end: the place where they met is marked.
4. A merge is made in the other transactions too, and a name you then give
   the merged step reaches them, so the map keeps one box.

### Add a screenshot, a note or a file

1. Select the step in Steps.
2. *Add screenshot*: a frame of the video, a pasted image (Ctrl+V) or an
   image file. *Use in PDD* picks the one the PDD prints under the step.
3. *Add note*: notes stay in the app, beside the step on the Map; the PDD
   does not print them. In the demo, *Add the order to the tracking sheet*
   has one: *Finance asked to keep the sheet until the weekly report can
   read Order Desk directly.*
4. *Attach file...*: for example the material mapping file, on the demo's
   *Look up the SAP material*. It is copied into the project folder, the
   PDD lists it, and the PDD's export carries it. For a file of the whole
   project, such as the demo's order tracking sheet, use *Add file...* under
   the document fields on the Overview.

### Leave out an app or a stretch of the recording

1. An app, for example Calculator, where the SME checks a total out of
   habit: in Steps, click *Apps outside the process...*, tick the app and
   click *Save*.
2. A stretch, for example where the SME started on the wrong customer: on
   the Timeline, hold Shift and drag across it, click *Leave out of the
   analysis* in the row above the timeline, then *Leave out*.
3. The steps and the map are drafted again without it. A stretch left out
   shows hatched: click it and choose *Include again* to bring it back.
   Playing skips it, and the *Transcript* tab leaves out what was said in
   it.
4. In a project made from a video, a detour of the call, for example thirty
   minutes on another topic: hold Shift and drag across it, then click *Not
   part of the process*. It shows hatched, playing skips it, and the
   *Transcript* tab says *Not part of the process* in its place. Your steps
   stay as they are, and the maps and the PDD do not mention it. Seek into it
   to watch it anyway. Click it and choose *Include again* to bring it back,
   or press Ctrl+Z.

### Make a sub-process

1. To give a step its own steps, select it and click *Open as a
   sub-process* in the toolbar: *Enter the order* gets one step per field and
   click, from *Enter Quantity* to *Click Save order*.
2. To group steps, tick steps that follow one another, click *Group into a
   sub-process...* and name it, for example *Find or create the customer*.
3. Click *▸ 5 sub-steps* on its row to open it; the line above the list goes
   back up. *Dissolve sub-process* undoes it.
4. In the PDD, each sub-process gets a chapter with its own map.

### Edit the map as your As-Is map, and make a To-Be copy

1. On the Map, click *Edit as the As-Is map*. The editor opens on a copy of
   the process map. Change it: the copy is kept once you change something.
2. Close the editor. The PDD now prints your As-Is map in place of the
   process map, and an analysis never changes it.
3. For the To-Be map, click *Edit a new copy*, set *Use in PDD as* to *To-Be
   map* and change the copy. The PDD prints it under the improvement scope.
4. *Edited maps* lists your copies, with *Edit*, *Duplicate* and *Delete*.

### Open a second project in a new window

1. Choose *Open in a new window...* in the *Open* menu, and pick the project
   folder.
2. It opens in a window of its own, and the project you had open stays open.
3. A project opens for editing in one window only: in a second window it
   opens read only.

### Undo

1. Press Ctrl+Z to undo your last change, and Ctrl+Y to redo it.
2. *Undo* and *Redo* in the top bar do the same.
3. Undo covers every change (steps, markers, document fields, edited maps,
   the video, a stretch left out, a removed transcript), up to 50, until you
   open another project.
4. In the map editor, Ctrl+Z and Ctrl+Y undo and redo the changes to the
   map.

## Hand over to the developers

1. Choose *Hand off...* in the *Export* menu.
2. Type what changed in this version (for version 1 it says *First hand-off*
   already) and click *Hand off*.
3. PDT makes *Order to cash enter a customer order v1.zip* next to the
   project folder and opens its folder. Send that zip to the developers.

**What a reader will miss.** When the PDD of this version leaves something
out, the dialog says so above the note: steps that are still drafts, steps
with no name of their own, no description, no picture or no system, a
decision that does not say when, empty document fields, or an As-Is map made
before the steps changed. Click a line to go where it is fixed (nothing is
handed off), or click *Hand off anyway*. Once everything before the hand-off
is done, or after a version was handed off, the same list shows under the
Checklist on the Overview: click *A reader of the next version will miss* to
open it.

**What the zip holds.** The whole project folder, without the backup copies
of the working file and the analysis log. At its top: *Start here.txt*,
which says what each file is; the PDD, *Order to cash enter a customer order
v1 PDD.docx*; the Technical details, *Order to cash enter a customer order v1
Technical details.xlsx*; and the process map as a picture that opens in a
browser (*Order to cash enter a customer order v1 map.svg*) and as BPMN 2.0
for ADONIS, Camunda, Bizagi and similar tools (*Order to cash enter a
customer order v1 map.bpmn*). The Technical details is a
spreadsheet for the developers: every click and entry of the reference
transaction with the control it acted on, the fields typed in each
transaction, and the applications. A project made from a video or from
nothing recorded none of that, so its zip has no Technical details.

**How a developer opens it.** In PDT, choose *Open*, *Open a zip...* and
pick the zip. It opens read only: everything can be looked at
and played, and nothing can change.

**The next version.** Keep working in your project, then choose *Hand
off...* again: PDT makes *Order to cash enter a customer order v2.zip*. The
demo was handed off once already (its zip does not come with it), so *Hand
off...* on it makes version 2. The PDD says which version it is and lists
every version with what changed. Ctrl+Z takes a hand-off back; its zip
stays.

## Where things are kept

- **The project folder** holds everything: the recording, your work, the
  video, the transcript, screenshots, attached files, the library and your
  edited maps. Copy it whole, never in parts.
- **Every change you make saves itself to the project folder.** The top bar
  says *Saved*; point at it to see the folder. If it says *Not saved*, point
  at it to see why.
- **The Export menu** has three groups: *For the developers and the
  archive* (*Hand off...*), *For another analyst* (*Whole project (.zip)*)
  and *Single files* (the PDD, the Technical details and the map as an
  image or as BPMN).
- **Made on export:** the PDD, the map (as an image or as BPMN) and the
  Technical details go where you save them. *Whole project (.zip)* and *Hand
  off...* make their zip next to the project folder. Every export opens its
  folder with the file selected.
- **Handing it on.** To hand the project to another analyst, use *Export*,
  *Whole project (.zip)*: one zip of the whole folder, made next to it. For
  the developers and the archive, use *Hand off...* instead.

## The library

The library lists named activities for each system: for Order Desk, for
example, *Find the customer*. Click the selected step's name: it lists the
activities of the step's system, and a pick gives the step its name, its
system and, when you wrote none, its description. You can still type any
name. Where the library has no activities for the system yet, the field says
so. A project keeps the library it started with, so a newer library does not
change it. The owner of PDT maintains the library, and it comes with the
app.

## When something looks wrong

- **"This folder is not a project: it has no manifest.json."** The folder
  holds no recording. Open the SME's zip itself with *Open*, *Open a
  zip...*, or open the recording folder inside the folder it was unzipped
  to.
- **"This recording has no transactions marked."** The SME did not press the
  transaction key. On the Timeline, right-click where each transaction
  starts and choose *Start a transaction here...*.
- **A step is listed under Outside the transactions.** It starts before or
  after every transaction. In Steps, open the transaction and type an
  earlier *Starts at*. A step you added can instead be given a start inside
  the transaction.
- **"The analysis failed, so the steps and the map are not drafted."** The
  log at the top says why. Choose Help, *Troubleshooting*, *Re-analyze*:
  your confirmed, edited, added and hidden steps are kept.
- **"The As-Is map was made before the steps changed: check it, or Copy
  again."** On the Map, edit your As-Is map to match the steps, or click
  *Copy again* for a new copy of the process map as it is now.

## Glossary

| Word | Meaning |
|---|---|
| Project | What you open or start in PDT: one folder with the recording or video, your work and all you add. |
| Request | The name and code of the request the project is for, written in the document's *Request* field. The Overview shows it on the project line. |
| SME | The subject matter expert who does the process and records it. |
| Transaction | One pass through the process, for example one order. |
| Step | One piece of work in a transaction, for example *Enter the order*. |
| Reference transaction | The transaction you name, fix and confirm; the PDD is built around it. |
| Sub-process | A step with steps of its own. |
| Placed | A step you put elsewhere in the process than its time on the Timeline, for example a correction the SME gave later in the video. |
| Process map | The map PDT draws from the steps. |
| As-Is map | Your edited copy of the process map; the PDD prints it in its place. |
| To-Be map | A copy you change to show the process as it should be. |
| PDD | The Process Definition Document: the Word document PDT writes. |
| Technical details | The spreadsheet for the developers that comes with a hand-off. |
| Hand-off | A numbered version for the developers: one zip. |
| Library | The named activities per system that a step's *Name* field lists. |
