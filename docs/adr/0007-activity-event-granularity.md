# ADR-0007: Activity-Event Granularity — Title in the Run Key

**Status:** Accepted — implemented
**Date:** 2026-05-17
**Deciders:** Project owner

## Context

The capture tracker batches `active-win` polls into *activity runs*. Until
now a run was keyed on `(app, pid)` — `tracker.js` started a new activity
event only when the foreground application or process changed, and the
window title was overwritten in place (`currentRun.title = title`) and
discarded between polls.

The consequence surfaces on browser work. A worker who spends twenty
minutes in Chrome moving between three web apps — Salesforce, a web-based
SAP, Workday — produces a **single** activity event labelled `chrome.exe`,
carrying only whichever title showed at the last 5-second poll. The
in-browser navigation is lost at capture. Downstream, the process map has
nothing to draw but one undifferentiated "Chrome" node, and the v0.7.0
per-web-app `taxonomy.yaml` — which classifies a browser window into the
web app it hosts — can only ever see that one coarse title.

This was a divergence from the original design, not a deliberate choice.
`process_discovery_tracker_design.md` §3.1 specifies that "each poll
produces an event", and §7.1's window-run collapse merges "adjacent
identical events (same app, **title**, label, case_ids)" — the only place
the design pins down run identity, and it includes the title. The
normalization side is faithful (`collapse_adjacent` keys on
`(app, title, label, case_ids)`); it simply never receives title
transitions because capture discarded them first. `SCHEMA.md` had since
documented the coarser `(app, pid)` reality as if it were the contract.

The To-Do backlog did not catch this. `IMPROVEMENTS.md` I35 read the
symptom backwards (it proposed collapsing *more*, by app only);
`SPEC-DEFERRED.md` P2.12 worked around it with a deferred viewer "title
strip"; ADR-0002's App Vocabulary `screen_id` is a parallel,
interaction-layer mechanism. None restores capture granularity.

## Decision

**An activity run is keyed on `(app, pid, normalized window title)`.**
`tracker.js` starts a new activity event whenever the normalized title
changes, not only on an app/pid change — realigning capture with the
design's §3.1/§7.1 model.

The title is **normalized** before the run-boundary comparison, because
the raw title carries cosmetic churn that is not a process step: a
`(3)` unread-count prefix, a `*`/`●` unsaved-changes marker, the trailing
browser-name suffix (` - Google Chrome`, …). Normalization strips those,
so a Gmail unread tick does not fragment the timeline while a genuine
navigation still does. The **raw** title is still recorded verbatim on
each emitted event — normalization governs run boundaries only, and the
taxonomy keeps classifying the real title.

## Options Considered

### Option A — Title in the capture run key *(chosen)*
Restores the design's intended granularity with one capture-side change
(`tracker.js`). The title is already polled; it was simply discarded.

### Option B — Reconstruct web-app segments in normalization
Split the coarse activity event in the pipeline using the window titles
on interleaved interaction events. No capture change, but it only works
where UIA interaction events exist and are dense — browser UIA is noisy
and variable. Partial and indirect.

### Option C — Viewer-only window-title strip (SPEC-DEFERRED P2.12)
A display affordance under the activity band. Helps the eye, but the
process map, the DFG, and the mined BPMN still see one "Chrome" node —
the deliverable does not improve.

## Consequences

**Easier:**
- The process map, the timeline, and the statistics show the real flow
  through web apps instead of one "Chrome" blob.
- The v0.7.0 per-web-app taxonomy finally pays off — with no taxonomy
  change; it just starts receiving one title per web-app segment.
- C1 / I35's `--collapse-mode app_only` gains a genuine purpose as the
  optional *coarse-view* toggle, rather than being a near-no-op.

**Harder / to watch:**
- More activity events per browser-heavy session — a larger
  `events.jsonl` and a denser timeline. This matters most for 8-hour
  passive recordings (Phase G); it strengthens the case for the
  collapse-by-app view and for the viewer-performance work (I26).
- `collapse_activity_occurrences` (the v0.7.0 self-loop fix) already
  merges consecutive same-label segments, so the process-mining event
  log stays clean — two adjacent Salesforce screens collapse to one
  occurrence and cannot form a directly-follows self-loop.

**Documentation:**
- `SCHEMA.md` updated — the activity-event run definition.
- `process_discovery_tracker_design.md` is historical and already
  consistent (it specified this model); left as-is.

## Action Items

1. [x] `tracker.js` — `(app, pid, normalized-title)` run key;
       `normalizeTitle` / `isNewRun` helpers, both unit-tested.
2. [x] `SCHEMA.md` — activity-event run definition updated.
3. [x] `docs/architecture/CAPTURE.md` — run model updated.
4. [x] `docs/To-Do/IMPLEMENTATION-SPEC.md` — C1's framing corrected:
       it is the coarse-view companion to this change, not the fix.
5. [ ] Follow-on: decide whether a web-app switch (a normalized-title
       change within one browser) should also trigger a screenshot —
       §3.4 fires screenshots on an application-executable switch only.
