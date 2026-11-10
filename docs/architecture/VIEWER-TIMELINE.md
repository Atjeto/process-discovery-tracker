# Viewer: the timeline

> The Timeline level (`data-level="flow"`): the one timeline of a project,
> its lanes, its clock, and the video beside it. Read
> [VIEWER.md](./VIEWER.md) first for the modules around it.

## Where it lives

| File | Owns |
|---|---|
| [`views/flow-view-timeline.js`](../../viewer/views/flow-view-timeline.js) | `renderTimeline()`: the lane stack, the stretches left out of the analysis (`leftOutBands`), the legend, the playhead, a background click that seeks; the minimap; the lanes menu; zoom, scroll and their persistence; the summary line. |
| [`timeline/timeline-core.js`](../../viewer/timeline/timeline-core.js) | Pure layout: `chooseTicks` (the tick positions and labels), `packLanes`, `layoutLaneStack` and `renderLaneStack` (a stack of lane plugins). Unit-tested. |
| [`views/flow-view-video.js`](../../viewer/views/flow-view-video.js) | The videos of the project on the clock (C23: `chainOf`, `clipAtMs`, `playheadMs`), `timelineSpan()` (the stretch of time the timeline lays out), the player (one video at a time, playing on into the next), the playhead's place, seeking, and the edits of the chain: Add, Sync, Replace, Trim and Remove video. |
| [`video-chain.js`](../../viewer/video-chain.js) | Pure: the clips, where each is on the clock, and the edits back to back (a trim, a replace, a remove, an add, and what moves with them). Unit-tested. |
| [`views/video-lane.js`](../../viewer/views/video-lane.js) | The Videos lane: one band per video, a side dragged trims it, its right-click menu. |
| [`views/flow-view-transcript.js`](../../viewer/views/flow-view-transcript.js) | The Transcript lane (one row per transcript) and each transcript's Sync, Replace and Remove. |
| [`views/flow-view.js`](../../viewer/views/flow-view.js) | The timeline's menus (a right-click starts or ends a transaction, adds a note, adds a step, jumps to a step; a transaction band's menu), range selection with Leave out of the analysis, Include again, the Transaction select. |
| [`views/flow-view-markers.js`](../../viewer/views/flow-view-markers.js) | The Markers panel, and `moveMarker` (the move a dragged transaction side makes). |
| [`layout-controls.js`](../../viewer/layout-controls.js) | The resize handles and the video modes. |

## The one clock

Every time the Timeline shows is the time since the recording started
(AD-26): the tick labels, the tooltips of activity bands, screenshots and
notes, the Markers panel, the screenshot stamps and the transcript rows, as m:ss, or
h:mm:ss from an hour. The origin is `manifest.started_at`, else the first
event (`dom.recordingStartMs`); `chooseTicks(start, end, count, origin)`
counts its ticks from it. The step pane, the step panel and the PDD's
pointers ("Transaction 1 at 0:19") use the same clock, and so do the Raw
events rows below the Timeline (lane FX1). The time of day shows in one
place only: the summary line above the timeline, "Recorded <date> <time> ·
<length>".

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
  with *Attach video...* (`#tl-empty`). The legend and the minimap hide, and
  so do the controls that act on a drawn timeline (the Transaction select,
  Lanes, the zoom) and the video band (lane FX3); the Markers tab says that
  transactions are marked on the timeline, which such a project has once a
  video is attached, and the Steps list says the same.

## The lanes

`renderTimeline()` builds lane plugins, each `{ key, height, gapBefore,
render(host, ctx) }`, and hands them to `TimelineCore.renderLaneStack`,
which stacks them, sets the zoomed width and calls each lane's `render`. A
lane of height 0 is skipped. From top to bottom:

| Lane | Shows | Clicks |
|---|---|---|
| Ticks | The time since the recording started; tick lines run down through the activity lane. | |
| Transactions | One band per transaction (a run in the code), labelled with its Start marker's label (else "Transaction N"; a label that only numbers it, such as an older recording's "Run 2", is not shown) when the band is wide enough; a transaction with no end runs to the end with a dashed edge. The transactions are paired the way the pipeline pairs them: a Start while one is open ends it (they never nest). The bands show the markers as they now are (2.0.3, `MarkerEdits.currentMarkerEvents`): a band no band of the last analysis matches (a marker added, moved or renamed, not applied yet) is dashed all round, `.pending`, its tooltip saying so. | Click: go to the transaction's start. Right-click: Jump to start, Jump to end. Drag its start, or its end when a marker ends it: that marker moves (see *Dragging a side*). |
| Activity | One band per foreground window, coloured by application and named by its system (the one vocabulary, C14: a Chrome window on Salesforce reads "Salesforce"), with the window title and the duration when there is room; a monitor badge on multi-display recordings. A band of an app among the Apps outside the process is hatched too, its tooltip saying so (lane FX2, `.tl-app-left-out`). Idle stretches, pending marker bars (a marker deleted, or any marker change while the Transactions lane is off) and the stretches left out of the analysis lie on the same row. A video project has a low empty row here, a place to right-click. | Click: go there. Right-click: the timeline menu at that moment. A stretch left out: click or right-click for Include again. |
| Videos | Only while the project has a video the analyst added (C23, 2.0.6): one band per video where it is on the clock, named after its file; a trimmed side is drawn thicker, a video whose file is not found here hatched. | Click: go there (the player shows that video at that moment). Drag a side: trim it. Right-click: Trim the start here, Trim the end here, Give its start back, Give its end back, Sync video (in a recording), Replace video (Find the video for one not found), Remove video, Add a video. |
| Transcript | Only while a transcript is attached: one row per transcript (C23: one per video, its row named "Transcript 2 · its video" when there are several), the sentences said while the recording ran, at their times, once the transcript is placed (its own video, else its own sync, else the first video's). Its label says "Not synced" until then and carries Sync, Replace and Remove. | Click a sentence: go there. |
| Notes | Only while a note is pinned to a moment (`annotations.analyst_notes`, C16): one pin per note. | Click: go there. Right-click: Edit note, Delete note. |
| Screenshots | A rail of the recorder's screenshots, and of the ones the analyst added at a moment (a video frame; lane FX2, `.tl-screenshot-added`, the step it is on in its tooltip). | Click: open it in the image viewer. |
| Steps | One band per visible step with a time, named as in Steps; a step that starts and ends at one moment (a one-click step) is drawn at the lane's smallest width (lane FX2). | Click: select the step, go to its start, open the step panel. Right-click: Open in Steps, Select + seek here, Hide or Delete. Drag the start or the end of a step whose time is the analyst's (see *Dragging a side*). |

**The header column** (`#tl-lane-names`, `renderLaneNames`), drawn like a
video editor's track headers (the owner's reviews): a column of its own
beside the lanes, a cell per lane drawn from the middle of the gap above it
to the middle of the gap under it, holding a key that looks like the
lane's own marks (a transaction's band, the first systems' colours, a
speech bubble, a note's pin, a screenshot's mark, a step's band) and the
lane's name in the small section labels' type, centred on what the lane
draws. The dividers between the cells run on across the timeline as the
lanes' separators (`.tl-lane-sep`). A cell's tooltip says what the lane
shows; pointing at it lights the lane up across the timeline
(`.tl-lane-hover`). A video project's low activity row has no cell, and
the ticks none. Inside a sub-process the Steps lane reads "Steps in
<name>", and the column widens to show it (up to a limit).

The playhead (`#tl-playhead`) lies over every lane; it follows the video,
and without a video a seek moves it and scrolls it into view.

**Idle** is not a lane of its own: the idle stretches lie on the activity
row (an "at desk" idle, where the recorder still saw input, looks
different from "away"). **Pending markers**: a marker change waiting for
*Apply marker changes* shows at once. A marker added, moved or renamed is
drawn by its transaction's band, dashed (2.0.3); a marker deleted, and any
change while the Transactions lane is off, as a dashed bar on the activity
row, labelled "(pending)" on a Start. The steps and the Transaction select
follow the last analysis until then. In a project made from a video or from
nothing (no drafts to draft again) marker changes apply by themselves
(`flow-view.js` `scheduleAutoApply`): 1.2 s after the change, once no
dialog is open, no key was pressed for as long, no side is being dragged
and no field holds unsaved typing; a save while it runs stops it first
(`yieldAutoApply`, through `session.js` `writeAnnotations`) and it runs
again after. An undo that changes the markers there analyzes again.

**The lanes menu** (`#btn-lanes`) turns lanes on and off: Idle, Screenshots,
Transactions, Steps, and Transcript and Notes while they exist. A fresh
profile shows Idle, Transactions and Steps (and Transcript and Notes when
there is one); Screenshots starts off. The choice persists in
`pdt.timelineLanes`. The activity lane has no toggle.

**The legend** under the timeline names the systems drawn and explains only
the marks on screen: idle, a pending change, a screenshot, a note, a
stretch left out of the analysis.

## The timeline menu

A right-click on the activity row or on the timeline's background opens one
menu at the moment clicked:

- *Start a transaction here...* and *End the transaction here*: a marker
  edit, shown at once as pending; *Apply N marker changes* in the top bar
  updates the transactions, the steps and the map. It asks first only while
  a step is a draft (a project made from a video or from nothing has none).
- *Add note here...*: a note pinned to that moment (the Notes lane turns on).
- *Add a step here*: a step at that moment, as *+ Step* adds one at the
  playhead.
- *Jump to step here*: the Steps level, on the step at that moment.

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
  inserted marker's insert edit moves itself; a captured marker's pending
  move takes the new time, so dragging it again adds no change), shown
  pending until *Apply marker changes*.
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
  endless", then "you always add steps sequentially"): a new step (+ Step,
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
  own items: *Open in Steps*, *Select + seek here*, *Place after a step...*
  (and *Back to its time* on a placed step), *Delete step* or *Hide step*;
  *Jump to start*, *Jump to end*), so the next step is added on the band of
  the open one before it.
- **A step's place in the process is its own** (2.0.5, contract C22; the
  owner's report: a correction the SME shows late in a video, marked where
  it is said, came after every step in between). *Place after a step...*
  (`steps-view.js` `placeStepAfterAction`, a `chooseModal` list of every
  transaction's steps and *First in* each) puts the step right after the
  one chosen, in that one's transaction (`step.placed_after`); its band,
  its video and its time stay where they are. A placed band has `.placed`
  (an accent edge and a dotted foot; `flow-view-timeline.js` `placedLine`
  adds "In the process: after ..." to its tooltip) and the legend's
  `.lg-placed` shows while one is drawn. *Back to its time*
  (`backToTimeAction`) is the inverse. The order rule is `step-order.js`'s
  (pinned with the pipeline by `shared/step-order-golden.json`); the time
  rules of this section stay the timeline's: a placed step is cut, dragged
  and handed time back by its neighbours on the timeline, never by its
  neighbours in the process.

**Range selection.** Shift-drag on the background selects a range; a card
shows its length, events, markers, screenshots and systems, with *Insert
transaction from selection* (a Start and an End marker, pending),
*Leave out of the analysis* (only in a project with a recording: it asks
first, the range goes into `annotations.excluded_ranges` and the analysis
runs again) and *Clear selection*. Esc clears it.

**The stretches left out of the analysis** (lane CC) are drawn where they
are made: a quiet hatch over the Systems lane (`.tl-left-out`, its
`data-start` and `data-end` the entry's), the bands under it muted, reading
"Left out of the analysis" where it is wide enough and "Left out" where
only that fits (`leftOutLabel`); its tooltip gives the
times and says that its steps are not drafted and its time not counted.
The legend's "left out of the analysis" shows while one is drawn. A click
(or a right-click) on it opens the timeline menu with *Include again* (the
inverse: the entry leaves `excluded_ranges` and the analysis runs again,
drafting its steps) and *Go to its start*. Both are one undoable edit, and
an undo or a redo of either analyzes again (`session.js`
`revertFollowUp`). Steps and the PDD then read the transaction with a
stretch left out as such: it says once, first, "Part of this transaction
was left out of the analysis (m:ss to m:ss)", and the reference steps done
in the stretch are not listed as skipped (`run-differences.js`, pinned
with the PDD by `shared/run-differences-golden.json`).

## The video beside it

The video pane below the timeline plays the project's videos: the ones the
analyst added (copied into the folder's `video/`, contract C16 and
`video-path.js`; a chain on the clock, contract C23), else the OBS
recording. Without one the pane collapses to a slim band with *Attach
video...*. The player shows one video at a time: a seek (a click on the
timeline, a band, a step) shows the video that covers that moment, at that
moment; played on past a video's end it goes on with the next one when that
starts there; a trimmed part is never shown. Every time it gives (the
playhead, + Step, a marker moved to the playhead, a frame's moment) is a
moment on the clock, whichever video shows it (`playheadMs`).

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
- **+ Step** (the timeline's header, only with a video; or the S key) adds a
  step at the playhead. Lane E-1 (`flow-view.js` `addStepAt`, for *Add a
  step here* too): the frame of the video at that moment is read first
  (`analyst-ui.js` `frameAtMoment`: from the player itself when it shows
  that moment, settled and not seeking, else from a copy off screen, at
  most a few seconds), written as an added screenshot and named in the same
  undoable edit as the step (`steps-view.js` `addStepAtTimestamp`, which
  knows what it would add before the file is written); no frame, no
  picture, and nothing said. The step then opens in the step panel, its
  name focused and selected unless the video is playing. A step deleted
  takes its added screenshots with it, and a step merged into another
  hands them to it.
- A step's own playback is in the step panel (Watch), beside the steps,
  from the video that shows its moment.
- The playback bar at the bottom of the window covers the videos on the
  clock, from the first one's start: play, back and forward 5 s (the arrow
  keys too, across the videos), a scrub bar and the times.

## Zoom, scroll, minimap

- **Zoom**: `#btn-zoom-in`, `#btn-zoom-out`, `#btn-zoom-reset` (and `+`, `-`,
  `0`) multiply or divide `State.zoomFactor` by 1.5 (never below 1) or reset
  it; the timeline is that many times as wide as its pane.
- **Scroll**: a middle-button drag pans the timeline. The zoom and the scroll
  persist per project folder in `pdt.timelineState`. On the first open of a
  project the timeline scrolls to the first transaction when it starts later.
- **Minimap** (`#timeline-minimap`): shown only while zoomed in; a
  compressed view of the activity with the visible stretch marked. Click to
  jump there, drag the marked stretch to scroll.
- **Resize**: `#resize-timeline` sets the timeline's height (80 to 360 px,
  default 160, `pdt.timelineHeight`); `#resize-video` the video pane's width
  (240 to 1200 px, default 600, `pdt.videoWidth`). The video pane can also be
  expanded to 70% of the width, or full screen.

## Render triggers

| Trigger | Re-renders |
|---|---|
| Project load | the timeline, its summary, the side panels |
| Switching to the Timeline | the timeline, with the zoom and scroll carried over |
| A zoom button or key | the timeline |
| An annotation edit | the `timeline` topic: the timeline, in place |
| A lane toggle | the timeline |
| The video's length becomes known (a video project) | the timeline, its summary and the playhead |
| A video attached, replaced, synced or removed | the project, reloaded |
| A transcript sync | the timeline (the loaded transcript takes the new offset) |
