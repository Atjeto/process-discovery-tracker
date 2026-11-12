# Viewer: the timeline

> The Timeline level (`data-level="flow"`): the one timeline of a project,
> its lanes, its clock, its first row, and the video and the pane above it.
> Read [VIEWER.md](./VIEWER.md) first for the modules around it.

## The screen (lane SCREEN, plan section 11.1)

From the top, under the top bar: the stage (`#lower-workspace`: the video
on the left, the divider `#resize-video`, the pane `#timeline-pane` on the
right), the divider `#resize-timeline`, then the timeline
(`#timeline-section`, `.timeline-pane`) at the full width of the window to
its bottom. Nothing opens over the timeline or beside it. On this level the
page does not scroll (`#view-session.on-timeline`, set by `renderer.js`
`applyLevel`): the stage and the timeline share the height, the pane's
lists scroll in the pane and the lanes in the timeline (`.tl-lanes`) under
its first row. The timeline is 272 px high unless its divider was dragged
(the stage keeps at least its min-height, the timeline giving way first);
the video takes at most 58% of the stage's width and no more than the
stage's height at 16:9 (container units of the stage), less when its
divider was dragged. At 1366x768 that is a video 778 wide, a pane 552 x
440 and a timeline 1366 x 272. Lane W2: a recording without a video, with
screenshots, shows its screen at the clock's moment where the video would
be, at the video's size (*The screen of a recording without a video*,
below); one with no screenshot shows the line *No video linked* with
*Attach video...*, then the pane at the stage's full width. A project with
no recording and no video shows its pane and, under the row, the one line
that says so; no divider.

## Where it lives

| File | Owns |
|---|---|
| [`views/flow-view-timeline.js`](../../viewer/views/flow-view-timeline.js) | `renderTimeline()`: the lane stack in the order of the work, the Steps lane's bands (`layoutStepBands`), what is drawn through every lane (`_drawThroughLanes`: the stretches set aside, `leftOutBands`), the playhead, a background click that seeks; the bar of the whole length (`syncBar`); the Lanes menu with what the marks mean (`placeLanesMenu`, `_syncLegend`); a double-click on a transaction (`zoomToTransaction`); zoom, scroll and their persistence; the summary line. |
| [`timeline/timeline-core.js`](../../viewer/timeline/timeline-core.js) | Pure layout: `chooseTicks` (the tick positions and labels), `packLanes`, `layoutLaneStack` and `renderLaneStack` (a stack of lane plugins); lane LANES: the bar of the whole length (`barBox`, `barCentreOn`, `barDragTo`, `barStep`, `barValue`) and a double-click's view of one transaction (`zoomToSpan`). Unit-tested. |
| [`step-band-label.js`](../../viewer/step-band-label.js) | Pure (lane LANES): what a step's band says: its name where it reads, else its number (the pane's), else nothing (`bandLabel`, `stepNumbers`). Unit-tested. |
| [`step-band-width.js`](../../viewer/step-band-width.js) | Pure (lane LANES): how wide a step's band is drawn: its time, at least 2 px, never past the start of the next band of its transaction (`drawnBands`). Unit-tested. |
| [`views/flow-view-video.js`](../../viewer/views/flow-view-video.js) | The videos of the project on the clock (C23: `chainOf`, `clipAtMs`, `playheadMs`), `timelineSpan()` (the stretch of time the timeline lays out), the player (one video at a time, playing on into the next), the playhead's place, seeking, and the edits of the chain: Add, Sync, Replace, Trim and Remove video. |
| [`video-chain.js`](../../viewer/video-chain.js) | Pure: the clips, where each is on the clock, and the edits back to back (a trim, a replace, a remove, an add, and what moves with them). Unit-tested. |
| [`views/video-lane.js`](../../viewer/views/video-lane.js) | The Videos lane: one band per video, a side dragged trims it, its right-click menu. |
| [`views/flow-view-transcript.js`](../../viewer/views/flow-view-transcript.js) | The Transcript lane (one row per transcript) and each transcript's Sync, Replace and Remove; lane E, the Transcript tab beside the video (`renderTab`, `tickTab`). |
| [`transcript-list.js`](../../viewer/transcript-list.js) | Pure (lane E): the Transcript tab's rows, the sentence at a moment, the search's marks and count. Unit-tested. |
| [`left-out.js`](../../viewer/left-out.js) | Pure (lane E): the stretches put aside, the skip when playing, the sentences left out, the words of a recording and of a project without one. Unit-tested. |
| [`show-here.js`](../../viewer/show-here.js) | Pure (lane E): the step "<step>" starts here acts on, the next one, the place it keeps. Unit-tested. |
| [`views/flow-view.js`](../../viewer/views/flow-view.js) | The timeline's menus (a right-click starts or ends a transaction, adds a note, adds a step, gives a step written first its moment, jumps to a step; a transaction band's menu), range selection with Leave out of the analysis or Not part of the process (a Shift-drag may start on a hatch), Include again, "<step>" starts here. |
| [`views/flow-view-markers.js`](../../viewer/views/flow-view-markers.js) | The marker edits: `moveMarker` (the move a dragged transaction side makes), `renameMarker` and `deleteMarker` (a transaction's header in the pane). |
| [`views/timeline-pane.js`](../../viewer/views/timeline-pane.js) | Lane PANE: the pane beside the video (five tabs; the Steps tab's list, the step opened in place, the transactions' headers; Notes; Files). |
| [`pane-lists.js`](../../viewer/pane-lists.js) | Pure (lane PANE): the pane's groups and rows, the hint line, the acts above the list, Previous and Next, the notes and files rows. Unit-tested. |
| [`timeline-row.js`](../../viewer/timeline-row.js) | Pure (lane SCREEN): the timeline's first row: its words (`LABELS`, `titles`, "the video" or "the recording"), what shows and what can be clicked (`rowState`), the transaction button (`transactionSlot`), the clock (`clockText`, `clockTarget`) and a selected stretch (`stretchText`); lane W2: the speed's choices and the one kept (`SPEEDS`, `speedOf`, `SPEED_KEY`). Unit-tested. |
| [`timeline-screen.js`](../../viewer/timeline-screen.js) | Pure (lane W2): which screenshot a recording without a video shows at a moment (`screenAt`) and the lines around it. Unit-tested. |
| [`stretch-keys.js`](../../viewer/stretch-keys.js) | Pure (lane W2): I and O, the pair they make (`press`) and the words they say. Unit-tested. |
| [`lane-keys.js`](../../viewer/lane-keys.js) | Pure (lane W2): a lane as one Tab stop: its marks in time order (`timeOrder`), the mark the lane takes the focus on (`startAt`), where Left, Right, Home and End go (`stepTo`), a mark's name (`markName`). Unit-tested. |
| [`shot-groups.js`](../../viewer/shot-groups.js) | Pure (lane W2): the screenshots close together drawn as one mark (`groupShots`, `markWidth`) and its tooltip. Unit-tested. |
| [`layout-controls.js`](../../viewer/layout-controls.js) | The two dividers and the video modes. |

## The one clock

Every time the Timeline shows is the time since the recording started
(AD-26): the tick labels, the tooltips of activity bands, screenshots and
notes, the pane's rows and transactions' headers, the screenshot stamps and the transcript rows, as m:ss, or
h:mm:ss from an hour. The origin is `manifest.started_at`, else the first
event (`dom.recordingStartMs`); `chooseTicks(start, end, count, origin)`
counts its ticks from it. The step pane, the step panel and the PDD's
pointers ("Transaction 1 at 0:19") use the same clock, and so do the Raw
events rows below the Timeline (lane FX1). The time of day shows in one
place only: the resting text of the row's message area, "Recorded <date>
<time> · <length>" (`#timeline-summary`; the Overview's project line says
who recorded it, not when).

## The first row (lane SCREEN, plan section 11.3)

`.timeline-header#tl-row` holds how to play and how to mark, in the order
Tab goes: **Play** (`#btn-tl-play`, only with a video, its `aria-label`
"Play" or "Pause"), **the clock** (`#btn-tl-clock`, "6:20 / 1:02:00"; a
click makes it the field `#tl-clock-field`: Enter goes there, kept inside
the timeline, Escape or leaving it keeps it as it was, a time that cannot be
read says "Type a time such as 6:20." in the message area), lane W2: **the
speed** (`#tl-speed`, only with a video: *1x*, *1.5x*, *2x*, its tooltip "How
fast the video plays"; the player's default rate too, so it holds across
the videos of a chain and a project opened in the window, the browser
keeping the pitch; kept on this computer in `pdt.playbackRate`; a choice
made with the mouse gives the focus back), **Add step**
(`#btn-add-step`, only with a video, the row's filled button in a project
without a recording), **Start transaction** or **End transaction** (one
button, `#btn-tl-transaction`, `data-kind`: *End transaction* while the
clock's moment is inside a transaction whose end is not marked yet), **Add
note** (`#btn-tl-note`), the **message area** (`#tl-message`), **Lanes**,
zoom out, **Show all**, zoom in (lane LANES: the *Transaction:* select is
gone). The
marking buttons act at the clock's moment (`Video.playheadMs`), with the
right-click's acts (`queueSyntheticMarker`, `addStepAt`,
`AnalystUI.addNote`); without a moment (a recording without a video, nothing
clicked yet) they are there with `aria-disabled` and a tooltip that says
why; a project opened read only does not show them. *Start transaction*
asks for the name in its own words ("Start transaction") while the video
is paused; while it plays the start is added at once with no name and no
question, the right-click's *Start a transaction here* too
(`queueSyntheticMarker`, the rule of `step-panel.js` `nameTakesFocus`), and
*Rename* on the transaction's header names it afterwards; its message
reads "Transaction started at 0:05." (D4: the steps follow a moment later
by themselves, in a recording too). A click on a button of the
row leaves the focus where it was, so Space goes on playing; Tab reaches
each control, Space or Enter works it. `flow-view.js` `syncTimelineRow`
draws it after every change of the clock, the transactions, the selection
(`State` topic `selection`) and the level; `timeline-row.js` decides.

**Messages** (`dom.js` `toast`, `placeToast`): while the Timeline shows,
`#toast` itself moves into the message area (`.in-row`): one line, cut with
an ellipsis, the whole text in the tooltip of its `.toast-text`, an error in
the error colour with its Dismiss; the resting text hides while it shows.
On the other levels it is at the foot of the window as before. A step added
on the Timeline says "Step added at 6:20."

## The span

`timelineSpan()` decides what the timeline lays out:

- **A recording** runs from its first event to its last.
- **A video project** (`manifest.source: "video"`, contract C16) has no
  events: the timeline runs on its videos (C23, back to back), from the
  first one's start to the last one's end, once their lengths are known (a
  recorded `.webm` with no length in its file is measured by one seek past
  its end; a length measured is kept with its video at the next edit of the
  chain). The summary line reads "Video · <length>".
- **A blank project** (nothing recorded, no video) has no span: the
  timeline shows one line, "No recording and no video in this project.",
  with *Attach video...* (`#tl-empty`). The bar of the whole length hides,
  and so do the controls that act on a drawn timeline (Lanes, the zoom) and
  the video band (lane FX3); the pane's Steps tab
  offers *Add step* and *Paste notes...* (lane PANE), and the Steps list
  says that transactions are marked on the timeline once a video is
  attached.

## The lanes

`renderTimeline()` builds lane plugins, each `{ key, height, gapBefore,
render(host, ctx) }`, and hands them to `TimelineCore.renderLaneStack`,
which stacks them, sets the zoomed width and calls each lane's `render`. A
lane of height 0 is skipped and adds no gap, so no room is left under the
last lane drawn. Lane LANES (plan section 11.3): the lanes read
from the top in the order a process manager builds the process (when,
which transaction, which step, in which system, what was said, then the
media), each drawn only when the project has such things:

| Lane | Shows | Clicks |
|---|---|---|
| Time | The time since the recording started; the tick lines run down through every lane. No name. | |
| Transactions | One band per transaction (a run in the code), labelled with its Start marker's label (else "Transaction N"; a label that only numbers it, such as an older recording's "Run 2", is not shown) when the band is wide enough; a transaction with no end runs to the end with a dashed edge. The transactions are paired the way the pipeline pairs them: a Start while one is open ends it (they never nest). The bands show the markers as they now are (2.0.3, `MarkerEdits.currentMarkerEvents`), drawn the same before and after the analysis that applies a change (D4: it runs a moment later by itself). The tooltip ends "Double-click: show only this transaction." | Click: go to the transaction's start (a moment later: `TX_CLICK_WAIT_MS`, so a double-click can take it back). Double-click: show only this transaction (see *Zoom and the bar of the whole length*). Right-click: Jump to start, Jump to end. Drag its start, or its end when a marker ends it: that marker moves (see *Dragging a side*). |
| Steps | The tall lane, 44 px: one band per visible step with a time of the level the Steps list shows, its name inside it on up to two lines of 12 px text, cut with an ellipsis; a band too narrow for its name (`step-band-label.js` `bandLabel`: less than `NAME_MIN_PX` inside its padding, unless the whole name fits on one line) shows the step's number in its transaction, the number the pane's Steps tab shows (`stepNumbers` over `pane-lists.js` `stepGroups`; inside a sub-process its place among the visible steps of its level), and nothing when even that does not fit; the tooltip always starts with the name. No band covers another: a band is drawn as wide as its time, at least 2 px, and never past the start of the next band of its transaction (`step-band-width.js` `drawnBands`; under 12 px it is drawn without its padding, `.slim`), and the label rule reads that width. A step left with no label is named by its tooltip, listed in the pane's Steps tab and widened by the zoom. `layoutStepBands` decides after each render and when the lanes change width. A draft (`auto_suggested`) is dashed (`.draft`), the open step fades out, a placed step has its accent edge and dotted foot, the selected one a 2 px outline. A one-click step is drawn at the lane's smallest width (lane FX2). Its name tooltip: "Steps: each step in the order of the process; click one to open it beside the video." | Click: open the step beside the video, the clock at its start. Right-click: the moment's items, then Open in Steps, Select + seek here, Place after a step..., Hide or Delete. Drag the start or the end of a step whose time is the analyst's (see *Dragging a side*). |
| Systems | A recording only (a toggle of its own, *Systems*): one band per foreground window, coloured by application and named by its system (the one vocabulary, C14: a Chrome window on Salesforce reads "Salesforce"), with the window title and the duration when there is room; a monitor badge on multi-display recordings. A band of an app among the Apps outside the process is hatched too, its tooltip saying so (lane FX2, `.tl-app-left-out`). A video project has no Systems lane and no low row in its place: a right-click anywhere on the timeline marks there. | Click: go there. Right-click: the timeline menu at that moment. |
| Transcript | Only while a transcript is attached: one row per transcript (C23: one per video, its row named "Transcript 2 · its video" when there are several), the sentences said while the recording ran, at their times, once the transcript is placed (its own video, else its own sync, else the first video's). Its label says "Not synced" until then and carries Sync, Replace and Remove. | Click a sentence: go there. |
| Videos | Only while the project has a video the analyst added (C23, 2.0.6): one band per video where it is on the clock, named after its file; a trimmed side is drawn thicker, a video whose file is not found here hatched. | Click: go there (the player shows that video at that moment). Drag a side: trim it. Right-click: the moment's marking entries (the timeline's own menu), then under the video's name Trim the start here, Trim the end here, Give its start back, Give its end back, Sync video (in a recording), Replace video (Find the video for one not found), Remove video, Add a video. |
| Screenshots | A rail of the recorder's screenshots, and of the ones the analyst added at a moment (a video frame; lane FX2, `.tl-screenshot-added`, the step it is on in its tooltip). Off until chosen. Lane W2: screenshots whose marks would cover each other at this zoom are one mark with their count (`.tl-shot-group`, `data-count`; `shot-groups.js`: a screenshot joins the mark before it while it is closer to that mark's first than the mark is wide, the mark as wide as its count needs), "3 screenshots from 1:40 to 1:46. Click: show the first in the Screenshots tab."; drawn again at each render and when the lanes change width, so zooming in splits it. | Click: the Screenshots tab beside the video at it (of several, the first), the clock at its moment. |
| Notes | Only while a note is pinned to a moment (`annotations.analyst_notes`, C16): one pin per note. | Click: the Notes tab at it, the clock at its moment. Right-click: Edit note, Delete note. |
| Idle | A recording only, off until chosen (`LANE_DEFAULTS.idle` false; a choice saved before still wins): its idle stretches (`idleStretches`), an "at desk" idle, where the recorder still saw input, hatched apart from "away". | |

**A lane is one Tab stop** (lane W2, plan section 11.5, `_wireLaneMarks`,
the rule `lane-keys.js`). The Transactions, Steps, Transcript, Screenshots
and Notes lanes draw their marks into a box of their own
(`.tl-lane-marks[data-lane]`, no height, so the pointer reaches the
timeline's background around the marks): `role="listbox"` named after the
lane ("Steps in <name>" inside a sub-process), each mark `role="option"`
named by its tooltip's first line, one mark of the lane in the Tab order (a
roving `tabindex`). After the row's controls Tab stops once on each such
lane with marks, in their order on screen, on the mark at the clock's
moment, else the next one after it, else the first; Left and Right go to
the previous and the next mark (stopping at the ends, the video not
moving), Home and End to the first and the last, and the lanes scroll so
the mark and its focus ring show (the bar's box follows); Enter does what a
click on the mark does. The focus ring is the app's (2 px of `--accent-2`,
2 px off the mark). A press of the mouse on a mark does not give it the
focus (a capture `mousedown` on `#timeline`), so the arrow keys go on
moving the video. A render keeps the mark that had the focus (`_focusedMark`,
`_refocus`: by its `data-mark`, else the nearest in time).

**The header column** (`#tl-lane-names`, `renderLaneNames`), drawn like a
video editor's track headers (the owner's reviews): a column of its own
beside the lanes, a cell per lane drawn from the middle of the gap above it
to the middle of the gap under it, holding a key that looks like the
lane's own marks (a transaction's band, a step's band, the first systems'
colours, a speech bubble, a note's pin, a screenshot's mark, a grey idle
stretch) and the lane's name in the small section labels' type, centred on
what the lane draws. The dividers between the cells run on across the
timeline as the lanes' separators (`.tl-lane-sep`). A cell's tooltip says
what the lane shows; pointing at it lights the lane up across the timeline
(`.tl-lane-hover`). The ticks have no cell. Inside a sub-process the Steps
lane reads "Steps in <name>", and the column widens to show it (up to a
limit).

The playhead (`#tl-playhead`) lies over every lane; it follows the video,
and without a video a seek moves it and scrolls it into view. The bar of
the whole length shows it too.

**Drawn through every lane** (`_drawThroughLanes`), from the top of the
first lane under the ticks to the foot of the last one: the stretches set
aside (below).

**A change to the transactions applies by itself** (2.0.3 in a project made
from a video or from nothing; D4, the owner 2026-11-10, in a recording too):
a transaction added, moved, ended, renamed or deleted is drawn at once where
it was put, and the steps follow the last analysis until the next one runs,
by itself (`flow-view.js` `scheduleAutoApply`, `auto-apply.js` `runDue`):
1.2 s after the change, once no dialog is open, no key was pressed for as
long, no side is being dragged and no field holds unsaved typing; a save
while it runs stops it first (`yieldAutoApply`, through `session.js`
`writeAnnotations`) and it runs again after. Nothing asks first, and a run
that worked says nothing; the top bar's status line says "Updating steps
and map..." with Cancel while it runs. A run cancelled or failed holds the
changes: the top bar offers *Update the steps* ("Updates the transactions,
their steps and the map with your latest changes."), and the next change
runs it again too. An undo or a redo that changes the markers runs it again
as well (`markersReverted`). In a recording the run drafts the drafts again;
the confirmed, edited, added and hidden steps are kept (a renamed or
described draft is edited), a draft keeps its id where it covers the same
actions, and the step selected, the step opened in the pane, the Steps
level's open transaction, the pane's scroll and the clock's moment stay.

**The Lanes menu** (`#btn-lanes`, its tooltip "Choose which lanes the
timeline shows, and see what its marks mean") lists, under *Show lanes*,
the lanes in the timeline's order, each named as at the timeline's left,
each only while the project can draw it (`#lane-activity-row` and
`#lane-idle-row` with a recording's events, the Transcript, Videos and
Notes rows while there are some): Transactions, Steps, Systems,
Transcript, Videos, Screenshots, Notes, Idle. A fresh profile shows all but
Screenshots and Idle. The choice persists in `pdt.timelineLanes`. Under
them, *What the marks mean* (`#lanes-legend`, `_syncLegend`) lists only the
marks the timeline draws now, each with its tooltip: the systems' colours,
idle, "dashed: a draft step", a screenshot, a
note, the hatch in the project's words (`LeftOut.wordsFor`), "placed
elsewhere in the process"; the heading hides when none is drawn. The menu
opens under its button when it fits there, else above it where there is
more room, and scrolls inside the window when taller than that room
(`placeLanesMenu`). The legend row that stood under the timeline is gone.

## The timeline menu

A right-click on the activity row or on the timeline's background opens one
menu at the moment clicked:

- *Start a transaction here...* and *End the transaction here*: a marker
  edit, drawn at once; the transactions, the steps and the map follow a
  moment later by themselves (D4). Its message: "Transaction started at
  0:05." or "Transaction ended at 0:20.".
- *Add note here...*: a note pinned to that moment (the Notes lane turns on).
- *Add a step here*: a step at that moment, as *Add step* adds one at the
  playhead.
- *Open in Steps*: the Steps level, on the step at that moment (lane A-2,
  one name per act; it read *Jump to step here*).

A transaction's start or end, and a step, start at the moment clicked, or
at a step's start or the playhead within 8 px of it (2.0.3, `snapMoment`;
a new step also at a step's end or a transaction's side). A marker never
comes to a step's end: an action and a marker of the same time sort marker
first, so a marker there would part the step's last action from it.

## Dragging a side

2.0.3 (a process manager's report: a transaction started a few pixels after
the step it was meant to hold, and nothing could move either). Steps types
the same times (an open transaction's *Starts at* and *Ends at*, the
selected step's start and end), and the rules for both are
[`time-edits.js`](../../viewer/time-edits.js)'s. A pointer
within 6 px of a side that drags shows the resize cursor; pressed and moved
3 px, the side follows it, its time (m:ss) above it, until the release
saves it. Esc puts it back and saves nothing; the click the release makes is
not a click on the band. Ctrl+Z undoes a move (`wireEdgeDrag`).

- **A transaction's side** is a marker: its Start, and the End or the next
  Start that ends it; a transaction running to the end gets its End from
  its end dragged (`endAddDrag`).
  The marker moves between its neighbours, 100 ms from each, so the
  transactions keep their order (`markerDragBounds`); it snaps to a step's
  start or the playhead. The move is a marker change (`moveMarker`: an
  inserted marker's insert edit moves itself; a captured marker's move not
  yet analyzed takes the new time, so dragging it again adds no change);
  its message reads "Transaction moved to 0:05." ("Transaction's end moved
  to 0:20." for an end), and the steps follow a moment later.
- **A step's side** drags when its time is the analyst's
  (`AC.stepTimeMovable`: no recorded actions and no sub-steps; a recorded
  step keeps its actions' time, which Split and Merge change). It moves
  between the bands beside it, inside its sub-process, the step at least
  100 ms long (`stepEdgeBounds`); a step back to back with it whose time is
  the analyst's too gives way, its touching side following. It snaps to any
  side drawn and the playhead. Saved at once as one edit
  (`steps-view.js` `setStepTimes`): a step of the main level then belongs to
  the transaction that holds its new start, or to none (*Outside the
  transactions*), without an analysis.
- **Steps are marked one after another** (the owner: "the duration is
  endless", then "you always add steps sequentially"): a new step (Add step,
  *Add a step here*, a start typed for a step without a time) inside a
  step of the analyst's ends that one there (`time-edits.js`
  `cutForNewStep`, neither part running over a boundary); in open space it
  lasts until the next step starts or the next transaction boundary. A
  marker added or moved ends a step of the analyst's that starts in a
  marked transaction and runs past its end (`cutAtBoundaries`), in the same
  edit (`flow-view-markers.js` `clipStepsToTransactions`); a step that
  starts outside every transaction is left whole. The step being marked,
  running to the end of the timeline with no boundary after its start, is
  open (`isOpen`, main level): its band has `.open` (a mask fades it out
  after its start, and it has no end to drag), its tooltip, the Steps line
  (`#step-end` empty, placeholder "open") and the step panel's row say
  "open", never a length, and the panel's average leaves it out.
- **Joined sides move together.** A marker moved takes the step sides that
  sit on it along (`followMarker`: a step's start on a Start, a step's end
  on a Start or an End; never over another step, never under 100 ms); one
  taken out lets the step that ended there run on to the next step or
  boundary (`followRemoval`). A step of the analyst's deleted gives its
  time to the step that ended where it started, up to that one's
  transaction's end (`handBack`, `steps-view.js` `deleteStep`); an end
  emptied in Steps runs on the same way (`naturalEnd`).
- **Every right-click marks there.** A step's or a transaction's band opens
  the Timeline's menu (`flow-view.js` `showMarkerInsertMenu` with a `band`:
  the moment's items, then a rule, the band's name as `.tl-ctx-head` and its
  own items: *Open in Steps*, *Play* (where a video shows the step's start:
  the step selected and played from its start, `seekClock`; lane A-2, it
  read *Select + seek here*), *Place after a step...*
  (and *Back to its time* on a placed step), *Delete step* or *Hide step*;
  *Go to its start*, *Go to its end*), so the next step is added on the band of
  the open one before it.
- **A step's place in the process is its own** (2.0.5, contract C22; the
  owner's report: a correction the SME shows late in a video, marked where
  it is said, came after every step in between). *Place after a step...*
  (`steps-view.js` `placeStepAfterAction`, a `chooseModal` list of every
  transaction's steps and *First in* each) puts the step right after the
  one chosen, in that one's transaction (`step.placed_after`); its band,
  its video and its time stay where they are. A placed band has `.placed`
  (an accent edge and a dotted foot; `flow-view-timeline.js` `placedLine`
  adds "In the process: after ..." to its tooltip) and the Lanes menu's
  `.lg-placed` shows while one is drawn. *Back to its time*
  (`backToTimeAction`) is the inverse. The order rule is `step-order.js`'s
  (pinned with the pipeline by `shared/step-order-golden.json`); the time
  rules of this section stay the timeline's: a placed step is cut, dragged
  and handed time back by its neighbours on the timeline, never by its
  neighbours in the process.

**Range selection.** Shift-drag on the background selects a range; lane
SCREEN: the timeline's row shows it in place of its three marking buttons
(`#tl-selection`): its times and length ("0:40 to 1:10 · 30s",
`#tl-selection-times`), then *Leave out of the analysis* (in a recording
that holds events: it asks first, the range goes into
`annotations.excluded_ranges` and the analysis runs again) or, lane E (E4),
*Not part of the process* in a project made from a video or from nothing
(`flow-view.js` `putAside`: the same `excluded_ranges` entry, one undoable
edit, no question and no analysis), both `#tl-selection-exclude` and the
row's filled button; *Make it a transaction* (`#tl-selection-case`: a Start
and an End marker, one undoable edit, its question in its words); and *Clear
selection* (`#tl-selection-clear`). Read only: the times and *Clear
selection* only. Esc clears it once a menu, a dialog or a field had the
Escape. The card that counted events, markers, screenshots and systems is
gone.

**I and O** (lane W2, plan section 11.3 and 11.5; `flow-view.js`
`stretchKey`, the pair `stretch-keys.js`, called by `renderer.js` on the
Timeline, not in a field or a select, with no dialog, menu or gallery
open): I puts the start of a stretch at the clock's moment, O its end, also
while the video plays. With both the stretch is selected
(`State.setSelectionRange`, drawn as a Shift-drag leaves it), the row
showing its times and its acts; O first, or O at a moment before the start,
gives the pair the right way round, and a second I moves the start. Until O
comes the start is a thin dashed line through the lanes, "Start of a
stretch" (`#tl-stretch-mark`; "End of a stretch" for an O before any I),
drawn again at each render; a click on the timeline goes through it, Escape
clears it (before the selected stretch). I says "Stretch starts at 0:40."
in the message area (an O first, "Stretch ends at 0:40."), O nothing; I and O
at one moment make no stretch and say "A stretch needs a start and an end at
two moments.", the first kept. Neither key asks anything or takes the
focus. A project opened read only selects too.

**The stretches left out of the analysis** (lane CC; lane LANES: through
every lane) are drawn as a quiet hatch from the top of the Transactions
lane to the foot of the last lane (`.tl-left-out`, its `data-start` and
`data-end` the entry's), under the marks (first in `#timeline`, no
z-index), so a step or a transaction on it stays on top and opens on a
click. Over the lanes whose marks fill their row (the Systems, the Videos)
the same hatch lies over the marks and lets the pointer through
(`.tl-left-out-over`), so the stretch reads as set aside there too. Its
label shows once, at its top, above the marks: "Left out of the analysis"
where it is wide enough and "Left out" where only that fits
(`leftOutLabel`); its tooltip gives the times and says that its steps are
not drafted and its time not counted. The Lanes menu's "left out of the
analysis" shows while one is drawn. An app outside the process stays
hatched on the Systems lane only (it is not a stretch of time). A click (or
a right-click) on the hatch where no mark is, or on its label, opens the
timeline menu with *Include again* (the
inverse: the entry leaves `excluded_ranges` and the analysis runs again,
drafting its steps) and *Go to its start*. Both are one undoable edit, and
an undo or a redo of either analyzes again (`session.js`
`revertFollowUp`). Steps and the PDD then read the transaction with a
stretch left out as such: it says once, first, "Part of this transaction
was left out of the analysis (m:ss to m:ss)", and the reference steps done
in the stretch are not listed as skipped (`run-differences.js`, pinned
with the PDD by `shared/run-differences-golden.json`).

**Not part of the process** (lane E, E4). In a project without a recording
the same mark is a detour of the call (`left-out.js`, the pure side). Its
band, label and tooltip say "Not part of the process" (`leftOutLabel` and
`leftOutTitle` with `recorded` false), hatched through every lane as in a
recording, and the Lanes menu reads "not part of the process". It changes nothing an analysis makes: the readers of the
stretches (Steps' differences, the live map's cuts in `renderer.js`, the
step BPMN's cuts in `pipeline_stages.py`, the PDD's `left_out`) take none
in a project without a recording (`left-out.js` `analysisRanges`), so
Include again and an undo or a redo of either analyze nothing
(`revertFollowUp` with `recorded` false).

**Playing skips a stretch put aside**, of either kind (`flow-view-video.js`
`_skipLeftOut`, the rule `left-out.js` `skipTo`): when playback runs into a
stretch's start, the clock goes on at its end (`seekClock`, across the
videos of the chain); a seek sets the moment playing goes on from, so a seek
into a stretch plays it to its end. The time updates come about four times a
second: a timer checks again right at a start that is near.

## The Transcript tab

Lane E (E3), lane PANE: the pane's Transcript tab, beside Steps, Screenshots, Notes and Files
(`flow-view-transcript.js` `renderTab`, the pure list in
`transcript-list.js`). The chosen tab stays chosen while the window lives.
Every placed sentence of every transcript in time order on the one clock
(`transcript-model.js` `partsOf`), the speaker where it changes; a
transcript not placed yet is a line with *Sync the transcript...*; without a transcript, a
line with *Attach transcript...*. A search over the list hides what does not
match, marks the matches and counts them ("3 of 340"); with more than one
speaker a select ("Everyone" first) narrows to one. The list is built once
per change of what it shows (the transcripts, their placement, the
stretches put aside, read only) and never while typing or playing: a tick
of the playhead moves one class (`current`, a binary search), and while the
video plays keeps that row in view, unless the pointer is over the list,
the keyboard is in it or the search holds text. Off-screen rows are not laid
out (`content-visibility`), so a call of thousands of sentences opens in a
few hundred milliseconds. A click on a sentence puts the clock there
(`seekClock`: a paused video stays paused). After each sentence two text
buttons (`.trt-acts`): *Add step here* (the clock goes there, then
`flow-view.js` `addStepAt`, what S does) and *Copy to...*, one menu headed
*Copy this sentence to* (the Overview's `showDocTargetMenu` with
`opts.head` and `opts.first`): first *The description of "<step>"* (the
step editor's handler, `panelFieldCallbacks` `onDescription`; with no step
selected *The description of a step (select a step first)*, shown,
`aria-disabled`), then the document's fields. The buttons show on the row
under the pointer, the row holding the keyboard and the current row; on the
others they are transparent (`opacity: 0`, so they keep their space and Tab
still reaches them; `visibility: hidden` would take them out of the Tab
order). A stretch marked as not part of the process stands in one row,
"Not part of the process: 12:10 to 41:30" (or "Left out of the analysis:
..."), with *Include again*. Read only: no act and no Include again. The
step panel's and the step editor's *Said* lists leave a marked stretch's
sentences out too (`left-out.js` `saidOutside`).

A Shift-drag on the timeline's background selects; the click that ends it
neither seeks nor starts the video (`flow-view-timeline.js`, the
background click returns on `shiftKey`). In a project without a recording
the row shows the stretch's times and length.

**What is said, under the video** (lane W2, plan section 11.1;
`flow-view-transcript.js` `syncCaption`). While a transcript is placed on
the clock, a band under the picture (`#video-caption`, inside the video
pane: under the video, or under the screen of a recording without one;
never over it) shows the sentence at the clock's moment: the speaker in
bold, then the sentence, 14 px on at most two lines cut with an ellipsis,
the whole of it and "Click: show it in the Transcript tab." in its tooltip
(`#video-caption-say`, a button). The sentence is the tab's sentence at
this moment (`transcript-list.js` `sentenceIndexAt`, the rule `tickTab`
marks it by) while it is being said (`sayingAt`: up to its end), over the
tab's own rows, so a stretch set aside shows nothing; between two sentences
the band is empty and keeps its height, so the picture does not jump; the
picture gives way to it. It follows the clock: every frame while the video
plays, and each seek or move of the clock. A click opens the Transcript tab,
which marks that sentence and puts it in view.

## The video above it

The video pane above the timeline plays the project's videos: the ones the
analyst added (copied into the folder's `video/`, contract C16 and
`video-path.js`; a chain on the clock, contract C23), else the OBS
recording. Without one the pane collapses to a slim band with *Attach
video...* (lane W2: in a recording with screenshots, the screen below
instead). The player shows one video at a time: a seek (a click on the
timeline, a band, a step) shows the video that covers that moment, at that
moment; played on past a video's end it goes on with the next one when that
starts there; a trimmed part is never shown. Every time it gives (the
playhead, Add step, a marker moved to the playhead, a frame's moment) is a
moment on the clock, whichever video shows it (`playheadMs`). Lane SCREEN:
`#video` has no controls of its own; the row plays, pauses and goes to a
time, a click on the video plays or pauses it, and the keys move it. While a
sync's first step shows, the video shows its own controls, to scrub a video
not placed on the clock yet (`startVideoSync`, `cancelVideoSync`). The
video's corner (`#video-overlay`) says "loading…" until the video's length
is known and nothing after: the video's own time no longer shows there.

- **Attach video**, **Add video** (the band, the Overview's project line, the
  Videos lane's menu, or the empty timeline) chooses one or more files. In a
  project made from videos they go after the last one, back to back, in the
  order chosen. In a recording the first is synced with two clicks: pause the
  video at a moment you recognize and click *Mark frame*, then click the same
  moment on the timeline (the others follow it, back to back). The place is
  saved in the clip's `offset_ms` (`annotations.external_videos`). When the
  one stored video is not found (a folder received from another machine
  without it), the video chosen takes its place and keeps its place.
- **Sync video...** (the pane's header and a band's menu, in a recording)
  runs the two clicks again for that video.
- **Trim**: a side of a band on the Videos lane dragged (the time in the
  file follows the pointer, kept within the file and at least a second
  long), or a band's right-click: *Trim the start here*, *Trim the end
  here*, *Give its start back*, *Give its end back*. Back to back, the
  videos after it and everything marked on them move with it (a trim that
  would cut away a mark is refused, naming it); in a recording nothing else
  moves.
- **Replace video...** (a band's menu, *Replace* on the project line) keeps
  the video's place and trim; back to back what follows moves by the change
  of length; in a recording the new file is synced with the two clicks.
  *Find the video...* for a video whose file is not found keeps its sync.
- **Remove video** (the pane's header for the video in the player, a band's
  menu, *Remove* on the project line) takes the video out and, for the copy
  the app made in `video/`, the file with it; it asks first, naming what is
  marked on it, which goes with it back to back while what follows moves up.
  *Replace* takes out the copy it replaces the same way. Add, Replace, Sync,
  Trim and Remove are each one undoable edit: Ctrl+Z brings back the entries
  and their files, and the project is loaded again with its videos (lane CC;
  analyzed again when the transactions moved with them).
- **Add step** (the timeline's row, only with a video; or the S key) adds a
  step at the clock's moment, and says "Step added at 6:20.". Lane E-1 (`flow-view.js` `addStepAt`, for *Add a
  step here* too): the frame of the video at that moment is read first
  (`analyst-ui.js` `frameAtMoment`: from the player itself when it shows
  that moment, settled and not seeking, else from a copy off screen, at
  most a few seconds), written as an added screenshot and named in the same
  undoable edit as the step (`steps-view.js` `addStepAtTimestamp`, which
  knows what it would add before the file is written); no frame, no
  picture, and nothing said. The step then opens in place in the pane's
  Steps tab beside the video (lane PANE), its name focused and selected
  unless the video is playing; Enter then leaves the name, so Space plays
  on. A step deleted
  takes its added screenshots with it, and a step merged into another
  hands them to it.
- **Starts here** (lane E, E5; lane PANE: on the row of each step
  without a time in the pane's Steps tab, only with a video,
  `#tp-steps .tp-here`; the toolbar's `"<step>" starts here` left, the act
  sits on the step). A click gives that step the playhead's moment
  (`flow-view.js` `showHereAt`, `steps-view.js`
  `showStepAt`): a start typed's rules (`time-edits.js` `placeUntimed`, a
  step of the analyst's it lands in cut there), its place in the process
  kept (`show-here.js` `keepPlace`, deriveOrder's fewest placements) unless
  it joins another transaction, the video's frame as its screenshot when it
  has none; one undoable edit. The step stays selected and its row keeps
  the focus. The timeline's right-click menu offers the same under *Add a
  step here*, at the moment clicked, on the step `show-here.js` `targetOf`
  names (the selected step when its time is the analyst's to set, else the
  first step without a time), then selects the next one (`nextAfter`).
- A click on a step band opens the step in place in the pane beside the
  video, the clock at its start (a paused video stays paused); a
  screenshot or a note on the timeline opens its tab at it. The step panel
  no longer opens on the Timeline (lane PANE); its own playback (*Play*)
  is on Steps and the Map.
- The playback bar at the foot of the window is gone (lane SCREEN): it
  showed on every level and drove a video only the Timeline shows. Its keys
  stay: Space plays or pauses, Left and Right move 5 s (with Shift 10 s),
  across the videos (lane W2: on the Timeline of a recording without a
  video too; a select keeps its own arrows).
- **The screen of a recording without a video** (lane W2, plan section
  11.1; `flow-view-screenshots.js` `syncScreen`, the rule
  `timeline-screen.js` `screenAt`). Where no video shows, a recording with
  a screenshot shows its screen at the clock's moment (`flow-view-video.js`
  `_showPane`: `.on-screen` on `#video-pane` and `#lower-workspace`, never
  `.no-recording`): the screenshot taken last at or before the moment (of
  two at one moment, the later in the Screenshots tab's order; one taken in
  a stretch set aside still shows) in `#video-screen-pic`, contained, as
  large as the pane allows, and one line under it, `#video-screen-line`,
  "Screenshot at 1:42" and, when it is on a step (added to it, or among a
  visible step's recorded screenshots), " · <step>". Before the first,
  `#video-screen-empty` reads "No screenshot before this moment."; with no
  moment yet, "Click the timeline to see the screen at that moment."; a file
  that is not in the project, "The screenshot file is missing: <file>" in
  the picture's place. Above it the band's line reads "No video in this
  project." with *Attach video...* ("No video linked" when the project holds
  a video whose file is not found here). It follows the clock (the
  `onPlayhead` of `flow-view.js`: a click on the timeline, a typed time, a
  mark of a lane, the Left and Right keys, which move the clock 5 s, 10 s
  with Shift, `flow-view-video.js` `nudgeClock`, kept inside the timeline).
  A click on the picture opens it in the gallery (`openScreenshotGallery`
  with its file; the gallery then owns Space, the arrows and Escape).
- **Expand** (`#btn-video-expand`) gives the video 70% of the stage's width,
  the pane the rest; **fullscreen** (`#btn-video-fullscreen`, Esc leaves it)
  gives the video the whole window above the timeline's row, which stays in
  view (Play, the clock, the marking buttons, the message area); the pane,
  the lanes and the dividers are not shown.

## Zoom and the bar of the whole length

- **Zoom**: `#btn-zoom-in` (Zoom in), `#btn-zoom-out` (Zoom out),
  `#btn-zoom-reset` (*Show all*) (and `+`, `-`, `0`) multiply or divide
  `State.zoomFactor` by 1.5 (never below 1) or reset it; the timeline is
  that many times as wide as its pane.
- **A double-click on a transaction's band** (lane LANES,
  `zoomToTransaction`) zooms to its span with a twentieth of its length of
  room on each side (`TimelineCore.zoomToSpan`, at most `MAX_ZOOM` 400, kept
  inside the timeline) and keeps the clock where it is: the band's click
  goes to its start only `TX_CLICK_WAIT_MS` (250 ms) later, the second click
  of a double-click takes it back, and a slower double-click whose first
  click already went puts the clock back. A double-click does not drag a
  side (a side moves only after the pointer has moved 3 px). *Show all*
  comes back to the whole length. It replaces the *Transaction:* select,
  which dimmed the other transactions and changed nothing else.
- **The bar of the whole length** (lane LANES, `#tl-bar` in `#tl-bar-row`,
  under the lanes, as wide as their track): a 14 px track in a 24 px
  target that always shows the whole timeline; the part the lanes show is
  its box (`#tl-bar-box`, `TimelineCore.barBox`), filling it at the whole
  length. Drag the box to move along the timeline (`barDragTo`); press
  elsewhere on it to centre the view there (`barCentreOn`) and drag on from
  there; with the focus on it, Left and Right move the box a tenth of what
  shows (`barStep`; the video does not move). The playhead is a thin line on
  it (`#tl-bar-playhead`, following `#tl-playhead`). For a screen reader it
  is `role="scrollbar"`, `aria-controls="timeline-scroll"`,
  `aria-orientation="horizontal"`, its `aria-valuenow` how far along the
  view is (`barValue`, 0 to 100). Its tooltip: "The whole length of the
  timeline. Drag the box to move along it, or click a place to go there."
  It replaces the minimap that showed above the lanes while zoomed in, and
  the lanes' own horizontal scrollbar, hidden (`scrollbar-width: none`):
  the wheel, Shift and the wheel, a middle-button drag and the zoom keys
  still work. The zoom and the scroll persist per project folder in
  `pdt.timelineState`. On the first open of a project the timeline scrolls
  to the first transaction when it starts later.
- **Resize**: `#resize-timeline`, between the stage and the timeline, sets
  the timeline's height (`--tl-height`, 150 to 640 px, the stylesheet's 272
  until dragged, `pdt.stage.timelineHeight`; dragged up, the timeline
  grows); `#resize-video` the video's width (`--video-width`,
  `pdt.stage.videoWidth`, kept at most 58% of the stage and its height at
  16:9). The sizes the layout before lane SCREEN stored (`pdt.timelineHeight`,
  `pdt.videoWidth`) are not read.
- **Raw events** (`.event-table-host`, only with events): one line under the
  timeline; opened, its table shows above that line (at most a third of the
  window high), the line staying where it was, the stage and then the
  timeline giving way; the row stays in view. Lane W2: the video (or the
  screen) and the pane then give way to the stage below their usual least
  heights, so neither lies over the row at 1024x720.

## Render triggers

| Trigger | Re-renders |
|---|---|
| Project load | the timeline, its summary, the side panels |
| Switching to the Timeline | the timeline, with the zoom and scroll carried over |
| A zoom button or key | the timeline |
| An annotation edit | the `timeline` topic: the timeline, in place |
| A lane toggle | the timeline, and what the marks mean in the Lanes menu |
| The video's length becomes known (a video project) | the timeline, its summary and the playhead |
| A video attached, replaced, synced or removed | the project, reloaded |
| A transcript sync | the timeline (the loaded transcript takes the new offset) |
