# Viewer: the timeline

> The Timeline level (`data-level="flow"`): the one timeline of a project,
> its lanes, its clock, and the video beside it. Read
> [VIEWER.md](./VIEWER.md) first for the modules around it.

## Where it lives

| File | Owns |
|---|---|
| [`views/flow-view-timeline.js`](../../viewer/views/flow-view-timeline.js) | `renderTimeline()`: the lane stack, the stretches left out of the analysis (`leftOutBands`), the legend, the playhead, a background click that seeks; the minimap; the lanes menu; zoom, scroll and their persistence; the summary line. |
| [`timeline/timeline-core.js`](../../viewer/timeline/timeline-core.js) | Pure layout: `chooseTicks` (the tick positions and labels), `packLanes`, `layoutLaneStack` and `renderLaneStack` (a stack of lane plugins). Unit-tested. |
| [`views/flow-view-video.js`](../../viewer/views/flow-view-video.js) | `timelineSpan()` (the stretch of time the timeline lays out), the playhead's place, seeking, Attach video, Sync video and Remove video. |
| [`views/flow-view-transcript.js`](../../viewer/views/flow-view-transcript.js) | The Transcript lane and the transcript's Sync. |
| [`views/flow-view.js`](../../viewer/views/flow-view.js) | The timeline's menus (a right-click starts or ends a transaction, adds a note, jumps to a step; a transaction band's menu), range selection with Leave out of the analysis, Include again, the Transaction select. |
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
  events: the timeline runs on the video, from the video's start for the
  video's length, once the player has read the length (a recorded `.webm`
  with no length in its file is measured by one seek past its end). The
  summary line reads "Video · <length>".
- **A blank project** (nothing recorded, no video) has no span: the
  timeline shows one line, "No recording and no video in this project.",
  with *Attach video...* (`#tl-empty`). The legend and the minimap hide.

## The lanes

`renderTimeline()` builds lane plugins, each `{ key, height, gapBefore,
render(host, ctx) }`, and hands them to `TimelineCore.renderLaneStack`,
which stacks them, sets the zoomed width and calls each lane's `render`. A
lane of height 0 is skipped. From top to bottom:

| Lane | Shows | Clicks |
|---|---|---|
| Ticks | The time since the recording started; tick lines run down through the activity lane. | |
| Transactions | One band per transaction (a run in the code), labelled with its Start marker's label (else "Transaction N"; a label that only numbers it, such as an older recording's "Run 2", is not shown) when the band is wide enough; a transaction with no end runs to the end with a dashed edge. The transactions are paired the way the pipeline pairs them: a Start while one is open ends it (they never nest), and the bands follow the markers the last analysis used. | Click: go to the transaction's start. Right-click: Jump to start, Jump to end. |
| Activity | One band per foreground window, coloured by application and named by its system (the one vocabulary, C14: a Chrome window on Salesforce reads "Salesforce"), with the window title and the duration when there is room; a monitor badge on multi-display recordings. Idle stretches, pending marker bars and the stretches left out of the analysis lie on the same row. A video project has a low empty row here, a place to right-click. | Click: go there. Right-click: the timeline menu at that moment. A stretch left out: click or right-click for Include again. |
| Transcript | Only while a transcript is attached: the sentences said while the recording ran, at their times, once the transcript is placed (its own sync, else the synced video's). Its label says "Not synced" until then and carries Sync, Replace and Remove. | Click a sentence: go there. |
| Notes | Only while a note is pinned to a moment (`annotations.analyst_notes`, C16): one pin per note. | Click: go there. Right-click: Edit note, Delete note. |
| Screenshots | A rail of the recorder's screenshots. | Click: open it in the image viewer. |
| Steps | One band per visible step with a time, named as in Steps. | Click: select the step, go to its start, open the step panel. Right-click: Open in Steps, Select + seek here. |

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
*Apply marker changes* is drawn at once as a dashed bar, labelled
"(pending)" on a Start; applied markers show as transaction bands and in
the Markers panel.

**The lanes menu** (`#btn-lanes`) turns lanes on and off: Idle, Screenshots,
Transactions, Steps, and Transcript and Notes while they exist. A fresh
profile shows Idle, Transactions and Steps (and Transcript and Notes when
there is one); Screenshots starts off. The choice persists in
`pdt.timelineLanes`. The activity lane has no toggle.

**The legend** under the timeline names the systems drawn and explains only
the marks on screen: idle, a pending marker, a screenshot, a note, a
stretch left out of the analysis.

## The timeline menu

A right-click on the activity row or on the timeline's background opens one
menu at the moment clicked:

- *Start a transaction here...* and *End the transaction here*: a marker
  edit, shown at once as pending; *Apply N marker changes* in the top bar
  updates the transactions, the steps and the map.
- *Add note here...*: a note pinned to that moment (the Notes lane turns on).
- *Jump to step here*: the Steps level, on the step at that moment.

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

The video pane below the timeline plays the project's video: the one the
analyst attached (copied into the folder's `video/`, contract C16 and
`video-path.js`), else the OBS recording. Without one the pane collapses to
a slim band with *Attach video...*.

- **Attach video** (the band, the Overview's project line, or the empty
  timeline) chooses the file, then syncs it with two clicks: pause the video
  at a moment you recognize and click *Mark frame*, then click the same
  moment on the timeline. The offset is saved in
  `annotations.external_video.offset_ms`. A project with nothing recorded
  takes the video at offset 0 without the clicks. When the stored video is
  not found (a folder received from another machine without it), the video
  chosen with Attach video takes its place and keeps the stored sync.
- **Sync video...** (the pane's header, only with a video) runs the two
  clicks again.
- **Remove video** (the pane's header, and *Remove* on the Overview's
  project line; only for the video the analyst attached) takes
  `external_video` out and, for the copy the app made in `video/`, the file
  with it; it asks first. *Replace* (Attach video over a video) takes out
  the copy it replaces the same way. Attach, Replace, Sync and Remove are
  each one undoable edit: Ctrl+Z brings back the entry and its file, and the
  project is loaded again with its video (lane CC).
- **+ Step** (the timeline's header, only with a video; or the S key) adds a
  step at the playhead.
- A step's own playback is in the step panel (Watch), beside the steps.
- The playback bar at the bottom of the window mirrors the video: play,
  back and forward 5 s, a scrub bar and the times.

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
| A transcript or video sync | the project, reloaded |
