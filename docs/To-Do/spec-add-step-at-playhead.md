# Spec: Add Step at Playhead from Flow View

## Problem

Step CRUD lives exclusively in `steps-view.js`. To add a manual step the analyst must leave Flow view (where the video plays), switch to Steps view, place a step boundary blind, then switch back to check. This is the most common annotation friction.

## Solution

A single "Add step here" action available in Flow view that splits/creates a step at the current video playhead position. The analyst stays in Flow, keeps watching, keeps stamping.

## Behaviour

1. **Trigger:** button in the Flow toolbar area (near the Lanes menu / zoom controls) **and** keyboard shortcut `S` (suppressed when an input/textarea is focused, same pattern as capture's `S/E/P` keys — see `renderer.js` shortcut wiring).
2. **Timestamp:** read the playhead's wall-clock position via `videoStartTs()` + `video.currentTime` (same calc `positionPlayhead()` already does in `flow-view.js`).
3. **What it does:**
   - If **no steps exist yet** → create a single step spanning the full session, with the playhead timestamp as its end, and a second step from playhead to session end. Name them "Step 1" / "Step 2".
   - If **steps exist** → find the step whose time range contains the playhead timestamp and split it at that point (same logic as the existing `splitStep()` in `steps-view.js`). The new step gets an auto-incremented name ("Step N").
   - If the playhead is within 2 seconds of an existing step boundary → do nothing, show a brief toast ("Too close to an existing boundary").
4. **Persistence:** route through `saveAnnotationsWithUndo()` in `session.js` with label `"Add step at playhead"`. Emit the `steps` and `timeline` state topics so both the Flow per-step lane and the Steps view re-render.
5. **Feedback:** brief toast confirming the step name. The per-step lane on the Flow timeline (P1.4) updates immediately — the analyst sees the new boundary appear on the timeline without leaving Flow.

## Files to touch

| File | Change |
|---|---|
| `viewer/views/flow-view.js` | Add `addStepAtPlayhead()` function. Wire the button and the `S` hotkey. The function reads playhead time, delegates to the step-split logic, calls `saveAnnotationsWithUndo`. |
| `viewer/views/steps-view.js` | Extract the core split logic from `splitStep()` into a shared helper (or export it) so `flow-view.js` can call it without duplicating. Keep `splitStep()` as a wrapper that calls the shared helper. |
| `viewer/index.html` | Add the toolbar button inside `#session-layout-flow` toolbar area. |
| `viewer/styles.css` | Minimal styling for the new button (follow existing `.toolbar-btn` patterns). |

## Not in scope

- Renaming or editing the step from Flow view (do that in Steps view).
- Adjusting step boundaries by dragging in Flow (future "medium" option).
- Any changes to Steps or Phases view.

## Test

1. Open a session with video in Flow view. Play to mid-session. Press `S`. Verify a step boundary appears on the per-step lane at the playhead position.
2. Press `S` again at a different point. Verify the correct existing step was split.
3. Press `S` within 2s of an existing boundary. Verify toast, no split.
4. Ctrl+Z. Verify the split is undone.
5. Switch to Steps view. Verify the steps created from Flow are there and editable.
