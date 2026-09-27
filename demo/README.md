# The demo project

`Order to cash/` is the project the viewer opens with *Open*, *Open the demo
project*. The package ships it in `resources/demo`; each time it is opened,
`viewer/demo-project.js` copies it into `Documents\PDT demo` (a fresh copy:
"Order to cash", then "Order to cash (2)", ...), so the folder here never
changes.

What it is: Maria Keller (a made-up SME) enters four orders at a sales desk.
Each order goes into the Order Desk web app (the test web app of the live
harness) and a row of an Excel tracking sheet. Order 2 prints a confirmation
and checks a material mapping in Notepad; order 3 is a new customer and
checks a total in Calculator; order 4 starts on the wrong customer and
cancels.

How it was made (2026-09-27):

1. Recorded live through the packaged 2.0.1 capture app and recorder, with
   real input driven by the live harness (scenario `rec12-demo`).
2. The screenshots were masked before they were committed: the Windows
   taskbar cropped off, the account pictures, the Chrome profile button and
   the other Notepad tabs of the machine it ran on painted over. Two Windows
   Widgets events (news headlines the recorder saw) were taken out of
   `events.jsonl`.
3. The video is made from the recording's own screenshots, each shown from
   its moment, under a line with the time, the transaction and the window
   in front. The transcript is written for the recording.
4. A script drove the viewer through the analyst's work: the video attached
   and synced, the transcript attached, Calculator left out as an app
   outside the process, order 4's wrong customer left out of the analysis,
   the SME's New order clicks hidden, the Notepad lookup added at its moment
   (the recorder saw no action there), names from the project's activity
   library (`library.json`), the flow (Only when, a loop, an early end, a
   Decision to a step another transaction did), Enter the order opened as a
   sub-process, a waste flag, a description, notes on a step and at a
   moment, attachments, an analyst screenshot for the PDD, transaction 1
   confirmed and the others reviewed, the document, an edited As-Is map, a
   To-Be map with a service task and a send task, and a hand-off (version
   1, by "Process team").

The hand-off's zip is not shipped: *Hand off...* on the demo makes the next
one, which *Open a hand-off (.zip)...* then opens read only.
