# Value-Chain Review: Why the app produces logs, not process insight

**Date:** 2026-05-22
**Author:** Architecture review (prompted by first real-data sessions)
**Companion to:** [ADR-0010](../adr/0010-ux-overhaul-viewer-recorder.md) (the 12 surface
fixes) and [ADR-0009](../adr/0009-normalization-redesign-v013.md) (the segmentation
redesign — redirected by this review; see Decision 1)

## Why this document exists

The 12 issues in ADR-0010 were reported as bugs. They are not bugs. They are
symptoms of one structural fact: **the app captures faithfully and exports
competently, but the transformations in the middle — the part that turns a log
into a process — leak meaning at every seam.** The result is what the owner
named exactly: "random logs and no context."

This review traces the value chain end to end, shows where context leaks, and
reduces the whole backlog to **three decisions** that everything else hangs
off. It is written at the process level, not the code level; code is cited only
as evidence.

---

## The value chain and its five seams

The app's promise is a pipeline that climbs a ladder of abstraction:

```
   raw events        classified         cases &        analyst       deliverable
   (UIA + polls)  →  activities    →    steps &     →  meaning    →   (process map,
                     (taxonomy)         phases         (flags,        PDD, findings,
                                        (segmentation) names,         time study)
                                                       phases)
       │               │                  │              │               │
    SEAM 1          SEAM 2             SEAM 3         SEAM 4          SEAM 5
   capture→raw    raw→meaning       events→units   units→meaning   model→output
```

Each seam is a hand-off. The data model that carries the hand-off
(`shared/SCHEMA.md`) is genuinely good — rich, versioned, well-documented. The
output formats (XES, BPMN, DFG, PDD, HTML report, stats) are competent. **The
failure is never the format on either side of a seam — it is that the seam
itself assumes work that is not prompted, not possible in-app, or not fed
back.** Below, each seam, what leaks, and the evidence.

---

### SEAM 1 — Capture → raw events: input quality is silently degraded

**What it should do:** produce a faithful, identifiable log: correct
screenshots, a named session, markers fired at the right moments.

**What leaks:**

- **Screenshots capture the recorder, not the work** (ADR-0010 D3).
  `screenshots.js:resolveTargetDisplays()` captures the display holding the
  *foreground* window. The instant the operator clicks a marker or types a
  label, the operator panel *is* the foreground — so the visual evidence for
  that step is a picture of the tool. Every step's `screenshot_refs` can be
  worthless.
- **The session loses its name** (ADR-0010 D4). `engagement_name` is written to
  `quick-config.yaml` but `session.js` never reads it into `manifest.json`. The
  analyst receives folders named by timestamp and cannot tell them apart.
- **The recorder hides** (ADR-0010 D1) and **hotkeys are friction** (D2). Both
  push the operator toward *firing fewer and worse markers*.

**The cascade:** markers are the *only* case signal in marker mode
(`case_assignment.py`), and screenshots are a step's primary evidence. So Seam 1
defects don't stay in the recorder — they poison the case structure (Seam 3) and
the step evidence (Seam 4) downstream. **Garbage in is not a metaphor here; it
is the literal failure mode.** This is why D1–D4 are not cosmetic.

---

### SEAM 2 — Raw activities → classified activities: empty by default, no way to fix it in-app

**What it should do:** label every foreground window with a business-meaningful
activity ("CRM — Salesforce", "TAMBA") so the mined map has real nodes.

**What leaks:** `taxonomy.yaml` ships with example rules for apps nobody in the
target deployment runs (Salesforce, SAP). For the owner's real sessions (TAMBA,
SNFI, ES Call Management) **zero rules match**, so every activity is
"Unclassified — <app>". PM4Py then collapses all "Unclassified" variants into a
trivial **Start → End** graph. That is precisely the "11 steps, 159 events, map
shows only start and end" report.

**The deeper problem is not the empty taxonomy — it is that there is no in-app
authoring path for it.** Classification is the load-bearing step for the
headline artifact (the process map), yet:

- The analyst must hand-edit a YAML file they were never told exists.
- Nothing in the workflow *prompts* for classification.
- The one in-app correction that exists (reclassify on a DFG node,
  `aggregate-view.js:1105`) acts after the fact, on a map that is already empty.

**The cascade:** an unconfigured Seam 2 means the process-mining map is empty
*and* the Flow timeline's application lane renders every band the same
"Unclassified" grey (`flow-view.js` activity lane), which reads as "nothing is
happening." Two of the app's three headline surfaces are blank for a first-time
user, with no signpost toward the fix.

---

### SEAM 3 — Events → steps: the segmentation model does not match how people work

**What it should do:** group raw interactions into meaningful units of work
("Look up the serial number", "Write the resolution").

**What leaks:** `step_suggest.py` splits on mechanical proxies — a time gap, an
app/window change, an interaction-count cap, a completion word. None of these is
a *task* boundary. ADR-0009 already measured the consequence: the real 1h33m ATM
recording yields **~308 atomic steps instead of the expected ~70**, and
concluded — correctly — that this is **a model mismatch, not a tuning bug.** The
step memory says the same: "Do NOT keep tuning the gap/app split."

The reason is structural. A worker handling one ticket bounces between TAMBA,
SNFI and Excel a dozen times. A segmenter that starts a new step on every app
switch shatters one ticket into 15+ fragments. A segmenter that *doesn't* (and
instead groups by time) fuses a whole form-fill into one blob. **There is no
single mechanical rule that fits interleaved multi-app work, because the unit of
work is defined by task intent, which the raw stream does not contain.**

ADR-0010 A4 (element-level grouping) adds one more proxy dimension. It will help
at the margin — a button click becoming its own step is correct — but it is
still a proxy. **ADR-0009 already identified the real fix and then stalled:**
case anchors (detect a ticket from the serial-number field, not from markers) +
canonical templates with span boundaries (`absorb_interleave`). That work is
gated on one unanswered question: *what does the recorder actually capture for
AG Grid cells?* (ADR-0009 Issue 1, still open).

**The cascade:** every downstream surface that keys off steps — phases, the
step-level stats, the analysis layer (waste/time-study), the PDD — inherits 308
wrong units. The analyst's entire job becomes hand-repairing segmentation, which
is why the Seam 4 ergonomics (below) feel so painful: they are the tools for a
repair job that should not be this large.

---

### SEAM 4 — Steps → analyst meaning: annotation is write-only

**What it should do:** let the analyst impose meaning — rename, split at the
right place, flag waste/automation/conditional/exception, group into phases —
and have that meaning *count for something*.

**What leaks (two distinct failures):**

1. **The ergonomics make imposing meaning slow and blind.** Interactions are an
   undifferentiated text wall with no value/action distinction (A1). Split
   always cuts at the count-midpoint, never where the analyst means (A2). The
   step timeline has no right-click menu (A5). The detail panel grows and shoves
   the step list off-screen (B1). Each of these is a papercut on a task the
   analyst must do *hundreds* of times because Seam 3 over-produced.

2. **The meaning, once imposed, evaporates.** The four flags
   (`conditional`, `exception_path`, `waste`, `automation_candidate`) are saved
   to `annotations.json` and then **do nothing visible** (A3). They do not badge
   the step list, do not change the aggregate, do not reach the PDD or the
   report. The analyst marks ten steps as "waste" and the app gives back no
   acknowledgement that anything happened.

**This second failure is the heart of "no context."** The app asks the analyst
for interpretation and then absorbs it silently. There is no feedback loop — no
moment where the analyst sees their judgement accumulate into something. Work
that produces no visible result feels like producing logs.

**The cascade:** because annotation doesn't propagate, the deliverable (Seam 5)
can't reflect it, which means the analyst's expertise — the entire reason a
human is in the loop — never reaches the client artifact.

> **Update (v0.21.0 — [ADR-0027](../adr/0027-retire-per-step-path-flags.md)):**
> failure 2 is closed. The three flags that "did nothing" had no coherent
> single-step meaning, so they were **retired**: `automation_candidate` moved to
> segment-grain candidacy ([ADR-0016](../adr/0016-segment-level-automation-candidacy.md)),
> `exception_path` to the observed trace variants, and `conditional` to the map's
> branch frequency ([ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md)). The
> one genuine per-step judgement, **`waste`**, now propagates for real — it feeds
> the efficiency figure and the €-ROI band (§11c) and reaches the HTML report and
> PDD. Annotation is no longer write-only; the surviving flag has a visible
> consumer, and the retired concepts are sourced from where they actually live.

---

### SEAM 5 — Model → output: the wrong map at the wrong level

**What it should do:** produce the deliverables. The owner stated the
requirement precisely and it is worth quoting as the spec:

> "Process maps are interaction/step level based. Process *Mining* maps are time
> studies and application level based, with possible drill down."

That is **two different artifacts at two different levels of abstraction:**

| Artifact | Level | Built from | Audience question |
|---|---|---|---|
| **Process map** | step / phase | `annotations.json` steps & phases | "What is the documented process?" |
| **Process-mining / time study** | application | classified activity events | "Where does the time actually go?" |

**The app builds only a degraded version of the second one.** The DFG/BPMN is
mined from *activity* events (Seam 2), so it is (a) empty without taxonomy and
(b) at the application level — the wrong level for a process the analyst hands a
client. **The step/phase process map — the one that reflects the analyst's
actual model and would be the deliverable — does not exist as a map at all.**
The step sequence lives in `annotations.json` and in `stats.json.step_variants`,
but nothing renders it as a graph.

This is the level-confusion that makes the whole map feature feel "unintuitive":
the analyst expects the map to show *their* process (the steps they curated) and
instead gets an empty application-level mining graph they never asked to be the
centrepiece.

**The cascade:** the PDD and HTML report are likewise one-time *snapshots*
exported from whatever exists at click-time, not living *projections* of the
annotated model. So even when the analyst does the work, the deliverable is a
dump, not a view that reflects the model as it stands.

---

## The meta-pattern, stated once

Every seam fails the same way:

> The data model is rich and the output formats are competent, but each
> transformation between them assumes work that is **not prompted** (Seam 2
> taxonomy), **not modelled** (Seam 3 task intent), **not fed back** (Seam 4
> flags), or **not built** (Seam 5 step-level map). Meaning leaks at every
> hand-off, so faithful logs never become a process.

That is the whole diagnosis. The 12 surface issues are where the leaks surface
to the user.

---

## Three decisions everything hangs off

The backlog (ADR-0010's 12 + ADR-0009's 10) collapses to three strategic
decisions. Make these and the task lists become execution; leave them open and
the papercuts keep recurring.

### Decision 1 — What is a "step"? (owns Seam 3)

The mechanical segmenter is a dead end (ADR-0009 + step memory both say so), and
two facts about the real workload decide the replacement:

- **Both regimes occur regularly** — short single-process recordings (tens of
  steps) *and* long repetitive multi-ticket recordings (the 308-step ATM
  session). The tool must serve both.
- **Processes are mostly one-off** — each engagement is a different process,
  rarely re-recorded.

"One-off" is fatal to the obvious fix. A persistent, hand-authored **canonical
template** (ADR-0009's central mechanism) earns its keep only by matching
*future* recordings of the same process. If the process is never re-recorded the
template matches zero future sessions and is pure overhead. **Cross-session
templates are the wrong tool here.**

But the hard regime is not random — the 308-step session is 12 tickets x ~the
same 7 steps. **The repetition is intra-session, not inter-session.** That is the
opening:

> **Detect the repeating unit (the ticket / case), align the instances, let the
> analyst curate ONE and propagate to all.** The "template" is auto-derived from
> within the session and dies with it — never authored, named, maintained, or
> reused across engagements. Exactly right for one-off work.

This is a *different* build from ADR-0009's persistent YAML templates:

- **Survives from ADR-0009:** anchor-based case detection (find the tickets from
  the serial-number field, not from markers). It is the prerequisite that finds
  the repeating unit and needs only a per-session "which field is the case key"
  pick — no maintained template.
- **Repurposed:** the existing `sequence_signature` / `step_variants` machinery
  (built for *cross-session* pooling in Compare-Sessions) is the bones for
  *intra-session* alignment — pointed within one session across the detected
  cases.
- **Rejected:** persistent canonical-template matching (mis-targeted for one-off
  processes).

**Two regimes, two answers:**

| Regime | Answer |
|---|---|
| Short, single-process | Cheap `step_suggest` heuristic fix (ADR-0009 Issue 7) + fast manual curation (ADR-0010 A1/A2/A4/A5 + B1). No repetition to exploit, but few steps, so manual is fine. |
| Long, repetitive multi-ticket | Intra-session repetition alignment: anchor-detect the cases, align the instances, curate one and project across all. |

**Caveats — this is the right hard build, but it is hard:** alignment must be
fuzzy / variant-aware (ticket 3 had an exception) — a step-level trace-clustering
problem; the AG Grid capture gate (ADR-0009 Issue 1) sets the *granularity* of
what can be aligned, not whether alignment works; and not every process has a
clean case key (fallback: the analyst marks the first repetition, or detect
recurring sub-sequences by self-similarity).

Until Decision 1 is settled, **A4 is a band-aid** — worth applying for the short
regime, but it does nothing for the 308-step regime, where alignment is the cure.

### Decision 2 — What is "the process map"? (owns Seams 2 + 5)

The owner's framing is two levels (step/phase process map vs application time
study). The "mostly one-off" answer sharpens it: **cross-session aggregation has
little value** when you rarely hold N recordings of the same process, so the
**Aggregate / Compare-Sessions view demotes** and the action moves to the
*single rich session*.

Commit to **one zoomable, single-session process map**, with the time study as
*statistics* rather than a second graph:

- **Phase level (default).** Built from `annotations.json` phases — a handful of
  analyst-authored buckets, meaningful by construction, *never* a hairball and
  *never* dependent on taxonomy. This is the deliverable.
- **Step level (drill-down).** A step DFG over the curated steps. **Only
  meaningful once Decision 1 is in hand:** over 308 raw auto-suggested steps it
  is a 308-node hairball — as useless as the empty activity map, failing in the
  opposite direction. Intra-session repetition rescues it: 12 ticket instances
  supply the *frequencies* that turn it from a single line (one instance) or a
  hairball (all unique) into a real "this path 10/12 times" process model.
- **Activity level (drill-down) + time-study stats.** The current DFG, gated
  behind a taxonomy the analyst can now *author in-app* (the editor in "what
  else"). This is the time study, with drill-down to interactions and the video.

So the step map is **not** the independent quick win the first draft of this
review claimed — it is downstream of segmentation quality. The always-clean
default is the **phase** map.

### Decision 3 — Does analyst work accumulate into a living deliverable? (owns Seam 4)

Decide that annotation **propagates**:

- Flags badge the step list, roll into the aggregate, and flow to the PDD and
  report (ADR-0010 A3).
- The PDD / findings report becomes a **projection of the annotated model** that
  reflects the current state, not a one-time dump.

This is the decision that converts "logs" into "context": it is the feedback
loop that tells the analyst their judgement changed the artifact.

---

## How the existing backlog maps onto the seams

This is the cascade the owner asked for — what each fix actually touches.

| Seam | ADR-0010 items | ADR-0009 items | Net effect of fixing |
|---|---|---|---|
| **1 Capture** | D1, D2, D3, D4 | — | Stops input corruption; protects case + evidence quality downstream |
| **2 Classify** | C1a | Issues 1, 6 | Process-mining map gains real nodes + an authoring path |
| **3 Segment** | A4 (short regime) | Anchor detect (Issue 3) + coalesce (2) + heuristic (7) survive; templates (4,5,8) rejected | Curate 1 ticket -> apply to 12 (long); manual is fine (short) |
| **4 Annotate** | A1,A2,A5,B1 (ergonomics) + **A3 (feedback loop)** | — | Repair becomes bearable *and* worthwhile |
| **5 Output** | C1b (step map) | — | The deliverable becomes the analyst's actual process |

Read down the A4 row: ADR-0010 touches Seam 3 with one proxy; ADR-0009 *is* the
Seam 3 redesign. They are the same seam at two ambition levels. They should be
sequenced (Decision 1c), not pursued independently.

---

## What else needs changing (not in either ADR)

These gaps are implied by the three decisions but appear in neither backlog:

1. **An in-app taxonomy editor (Seam 2).** ADR-0010 C1a adds a per-app
   right-click; the real gap is that classification — the headline map's
   precondition — has *no* authoring UI at all. A small editor (list rules, add
   `app + title_regex → label`, preview match count against the loaded session)
   converts a hidden YAML dependency into a workflow step. Without it, every new
   deployment starts with an empty map and no signpost.

2. **An intra-session curate-once-apply-to-all loop (Seam 3 ↔ 4).** When the
   analyst fixes one ticket's steps, that work must propagate to the other 11
   *within the same session* — not be saved as a cross-session template (which
   one-off processes never reuse). This is the same alignment mechanism as
   Decision 1, surfaced as an editing affordance: curate / flag / name one
   instance, project across the aligned instances. `canonical-author.js`
   (steps → template) is repurposed as the *intra-session* propagation engine,
   not a YAML-authoring path.

3. **The deliverable as a projection, not a snapshot (Seam 5).** The PDD/report
   (`pdd_export.py`, `report-html.js`) export once from click-time state. If
   annotation is to "count" (Decision 3), the deliverable needs to be a *view*
   of the model that reflects flags, names, phases, and findings as they stand —
   regenerated, diffable, and obviously tied to the analyst's edits.

4. **Resolve the split-brain between activity-level and step-level stats.**
   `stats.json` carries both `trace_variants` (activity) and `step_variants`
   (step); the map uses only activity, the analysis layer uses only steps. The
   two-map decision (Decision 2) should also decide which level each statistic
   reports at, so the numbers stop disagreeing about what "the process" is.

5. **Re-normalization's effect on the curated model.** `_merge_steps` preserves
   `manually_authored` + `edited` steps, but the *relationships* an analyst
   builds — step→phase membership, the step→template match, the regenerated
   activity map — are not all guaranteed to survive a re-run cleanly. If
   Decision 1c makes manual curation the primary workflow, the non-destructive
   guarantee must explicitly cover the curated model's relationships, not just
   the step rows.

6. **An explicit IA decision for the two maps (Seam 5).** Where the step map and
   the time-study map live in the UI, which is the default, and how drill-down
   moves between them (step → its activities → its raw interactions → the video
   frame). This is the navigational expression of Decision 2.

---

## Recommended sequence

Ordered by *unblocks-the-most* and *lowest-risk-first*, not by area.

**Step zero — the AG Grid fact-find.** Inspect a real captured AG Grid event
from the ATM session (ADR-0009 Issue 1). An hour of work that sets the
*granularity* of intra-session alignment and could reshape it. Do it before the
alignment build, not after.

**Phase 0 — Stop corrupting the input (Seam 1).** D4 (name, one line), D3
(screenshot target), D1 (recorder visibility). Small, self-contained, and every
later phase depends on clean input. Do these first regardless of the bigger
decisions.

**Phase 1 — Make the analyst's process visible without taxonomy (Decision 2).**
Ship the **phase-level process map** as the default — built from
analyst-authored phases, always clean, never dependent on taxonomy. This answers
the loudest complaint ("my map is empty"). The step-level map waits for
Decision 1: over raw 308 steps it is a hairball.

**Phase 2 — Make curation fast and worthwhile (Seam 4).** The ergonomics
together (A1 colour-coding, A2 click-to-split, A5 context menu, B1 layout)
**and** A3 (flags propagate, carrying the heuristic-vs-confirmed confidence
state), plus the cheap `step_suggest` heuristic fix (ADR-0009 Issue 7) that
shrinks the short regime's step count. One effort — same workflow. Makes the
next real session usable in both regimes.

**Phase 3 — Close the taxonomy loop (Seam 2).** The in-app taxonomy editor +
classify-in-place (C1a), so the activity time-study map gains real nodes and
drill-down.

**Phase 4 — Intra-session repetition alignment (Decision 1, the hard build).**
Anchor-detect the cases, fuzzily align the instances, surface
curate-once-apply-to-all editing, and let the step DFG draw its frequencies from
the aligned instances. This makes the 308-step regime usable and the step map
meaningful. It supersedes ADR-0009's canonical-template mechanism while keeping
its anchor-detection idea.

The ordering is deliberate: Phases 0–2 produce a tool usable on the short regime
*today* and the curated single session that validates the Phase 4 alignment
design. Phase 4 is the hard build — but it is the *right* hard build: unlike
cross-session templates, it fits one-off processes.

---

## Status — what shipped (2026-05-23)

The review's three decisions and six gaps have largely been executed; this section
closes them out.

| Item | Status | Where |
|---|---|---|
| **Decision 1** — intra-session alignment (not cross-session templates) | Direction accepted; **partially built** | Anchor-based case detection shipped ([ADR-0012](../adr/0012-active-case-stamping-and-map-matrix.md)); the alignment engine (`step-alignment.js`, repeat badges, "Apply to N repeats") is a first cut; the full fuzzy alignment + curate-once-propagate loop is now its own [ADR-0015](../adr/0015-intra-session-repetition-alignment.md). |
| **Decision 2** — one zoomable single-session map (phase / step / activity) | **Shipped** | Notation × level matrix + observed-flow step/phase maps + drill-down + "Hide rare paths" ([ADR-0012](../adr/0012-active-case-stamping-and-map-matrix.md), [ADR-0013](../adr/0013-value-free-grouping-and-map-readability.md)); the dead aggregate switcher was removed. |
| **Decision 3** — annotation propagates | **Shipped** | Step flags badge the list and reach the report / PDD ([ADR-0010](../adr/0010-ux-overhaul-viewer-recorder.md) A3). |
| Gap 1 — in-app taxonomy editor | **Shipped** | Classification manager + classify-in-place + team-taxonomy promotion ([ADR-0010](../adr/0010-ux-overhaul-viewer-recorder.md), [ADR-0011](../adr/0011-platform-recognition-layer.md)). |
| Gap 2 — curate-once-apply-to-all loop | **Partial** | First cut in `step-alignment.js`; the full loop is [ADR-0015](../adr/0015-intra-session-repetition-alignment.md). |
| Gap 3 — deliverable as a projection, not a snapshot | **Open** | The PDD "living projection" still needs an owner definition (NEXT-SESSION-SPEC §4). |
| Gap 4 — activity / step stats split-brain | **Shipped** | `step_stats` + value-free `process_label` grouping ([ADR-0013](../adr/0013-value-free-grouping-and-map-readability.md)). |
| Gap 5 — re-norm preserves the curated model's relationships | **Shipped** | `_inherit_step_identity` keeps step↔phase / step↔template links across re-analyze ([ADR-0013](../adr/0013-value-free-grouping-and-map-readability.md)). |
| Gap 6 — explicit IA for the two maps | **Shipped** | The independent notation × level axes + drill-down ([ADR-0012](../adr/0012-active-case-stamping-and-map-matrix.md)). |

## One-paragraph summary for the owner

The app captures well and exports well; it fails in the middle, where logs
become a process. Five hand-offs each leak meaning: the recorder corrupts its
own input (wrong screenshots, lost names), classification is empty out of the
box with no in-app fix, segmentation uses mechanical rules that don't match
real multi-app work (308 steps vs ~70), the analyst's flags and edits vanish
without propagating anywhere, and the "process map" is built at the application
level from empty data instead of from the steps the analyst actually curated.
Two facts about the workload — both regimes occur regularly, and processes are
mostly one-off — settle the three decisions the 22 backlog items reduce to:
**what a step is** (NOT cross-session templates, which one-off work never
reuses; instead a cheap heuristic + fast manual curation for short sessions, and
*intra-session repetition alignment* — curate one ticket, apply to twelve — for
long ones), **what the process map is** (one zoomable single-session map:
phase-level default that never needs taxonomy, step-level that gains meaning as
curation supplies frequencies, activity-level time study gated on an in-app
taxonomy editor — the cross-session Aggregate view demotes), and **whether
annotation accumulates** (yes — flags propagate carrying their confidence state,
riding the same alignment mechanism). Do the AG Grid fact-find, fix input
quality, ship the phase map to kill the empty-map complaint, make curation
fast-and-worthwhile, close the taxonomy loop, and only then build intra-session
alignment — the right hard build for one-off processes — on the curated session
those earlier phases produce.
