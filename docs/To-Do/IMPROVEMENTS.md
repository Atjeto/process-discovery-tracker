# Improvements — Pain Points, Solutions & Execution Plan

> **Scope:** the tool as it is used today — internal, single team, managed
> Windows machines, analyst + worker workflow, session folders moved manually.
> No go-to-market framing; everything here is about making the tool better for
> the people already using it.
>
> **Status:** living document. 81 identified entries across 30 categories,
> collapsed into 14 root-cause clusters, organized into a revised execution
> plan with the analysis layer as the central addition.

---

## Strategic Context — Two Workflows, One Tool

The tool serves two distinct workflows that share capture infrastructure
and analytical outputs:

### Workflow A — Structured process discovery (current primary)

An analyst schedules a call, records a 1-hour session with a worker
walking through a process. The session has markers. The output is a
**BPMN process map** and a **PDD (Process Definition Document)** that a
developer uses to build or automate. This is the bread-and-butter
workflow — it's how processes get documented and scoped for development.

The viewer matters here because the analyst is actively investigating a
specific recording, building steps, authoring the PDD, and producing a
map.

### Workflow B — IE review / continuous improvement (underserved)

Every 2-3 months, someone needs to assess the state of a team or
function. Where are the bottlenecks? What's changed since last review?
What are the new automation candidates? Where is time being wasted?

This is where passive 8-hour recording, auto-detection, time studies,
waste analysis, and cross-worker comparison would live. The output isn't
a PDD for a developer — it's an **improvement plan** for a manager or
CI lead.

### The shared outputs

The key insight: **the analytical outputs apply to both workflows.**

A 1-hour structured session benefits from waste classification just as
much as an 8-hour shift. When the analyst records a worker walking
through an order-entry process, the tool should say: "42% of this
process is value-add, 31% is business-required non-value-add (compliance
checks, approvals), and 27% is waste — 15% waiting for SAP to load, 8%
switching between SAP and Excel for lookups, 4% re-entering data that
already exists in another system." That goes straight into the PDD as
context for the developer. Aggregated across 10 sessions, the same data
feeds the IE review.

Automation candidate scoring applies to both too. In Workflow A, it
tells the developer "steps 3-5 are the automation target — here's the
interaction sequence, here's the frequency, here's the estimated
savings." In Workflow B, it tells the CI lead "across this team, here
are the top 5 automation opportunities ranked by annual hours saved."

### What's missing: the analysis layer

The tool has strong capture infrastructure, a solid normalization
pipeline, and a functional viewer for investigation and step authoring.
What's missing is an **analysis layer** that sits between normalization
and the deliverable — that takes the cases, steps, interactions, and
statistics the pipeline already produces and computes IE-grade findings
both workflows need.

The analysis layer is a set of Python modules in the normalization
pipeline. It runs after step suggestion / canonical matching and before
export. It takes `annotations.json` (steps, phases), `stats.json`
(activity/case stats), and the raw interaction stream, and produces an
`analysis.json` sidecar with: waste classifications per step, time study
data per step, automation scores per step, and the process efficiency
ratio. The viewer reads `analysis.json` and surfaces it. The report
generator includes it. The PDD export includes it alongside step
definitions.

For **Workflow B specifically**, the additional piece is **auto case
detection** — finding repeated process instances in an unstructured
8-hour recording without markers. Everything else — waste
classification, time study, automation scoring — is shared across both
workflows.

### CI/IE practices the tool should enable

| Practice | How the tool enables it | Current state |
|----------|------------------------|---------------|
| **Value Stream Mapping** | Classify every step/activity as VA / BNVA / NVA. Compute process efficiency ratio (VA time / total time). Produce a VSM-style breakdown per step. | Not implemented. Stats exist but are descriptive, not classified. |
| **Lean waste identification (DOWNTIME)** | Auto-detect: Waiting (idle gaps, system loading), Motion (app switches, navigation), Defects (rework/repeated sequences), Overprocessing (cross-system data re-entry). | Rework detection exists in stats. Other waste types not classified. |
| **Time & motion study** | Per-step cycle time: mean, min, max, σ, percentile. Breakdown: active processing / waiting / switching. Cross-worker comparison. | Activity duration stats exist. Not broken down by waste type. No cross-worker comparison at step level. |
| **Automation candidate identification** | Score each step on: repetitiveness (same interaction sequence across instances), rule-basedness (no branching), volume (frequency × duration), digital accessibility. Estimate annual time savings. | Not implemented. Canonical matching gets close but doesn't score for automation. |
| **Process standardization** | Identify highest-variance steps. Compare best vs worst performer per step. Flag where training or tool improvement would reduce variation. | Variant analysis exists. Not tied to individual steps or workers. |
| **Conformance checking** | Overlay expected process (template) on observed process. Flag deviations. | Drift detection exists. No visual conformance overlay. |
| **Before/after measurement** | Compare baseline recording against post-improvement recording with explicit delta metrics. | No structured comparison framework. |

### Guiding principles (updated)

1. **Present a hypothesis, not a dataset.** The tool should have an
   opinion about what's interesting before the analyst looks.
2. **The deliverable is the product.** The PDD, the improvement report,
   the automation candidate list — not the timeline explorer.
3. **Serve both workflows from one analysis layer.** Waste
   classification, time study, and automation scoring run on 1-hour
   sessions and 8-hour shifts alike.
4. **Accumulate knowledge across engagements.** A team using the tool
   for six months should find it dramatically more useful than on day
   one.

---

## Part 1 — Pain Point Register

Every identified issue, grouped by workflow area. Each entry has an **ID**,
a **severity**, and a **suggested direction**.

- **High** — the analyst or worker hits this regularly and it costs real time.
- **Medium** — it's friction, the workaround is known but annoying.
- **Low** — nice to have; current approach is tolerable.

---

### 1 — Analyst: First contact with a session

**I1 — No session summary on load** — *High.*
The analyst opens a folder, hits Analyze, waits, then scrolls through a
timeline trying to figure out "what did this person actually do." No summary.
Data exists in `stats.json` — it just needs to be visible.

**I2 — Timeline too zoomed out on long sessions** — *Medium.*
A 2-hour session at default zoom compresses everything. The analyst can zoom
but doesn't know *where* to zoom first.

**I3 — No "session is an outlier" flag in Compare Sessions** — *Medium.*
When loading 5 sessions, one is usually weird. The variant table shows it
implicitly; the analyst has to read it and figure out which.

### 2 — Analyst: The marker / case problem

**I4 — Marker cleanup is manual and error-prone** — *High.*
The case structure depends on the worker pressing Start/End at the right
moments. Workers forget, double-press, nest incorrectly. The analyst
inherits the mess and marker edits require understanding the problem first.

### 3 — Analyst: Steps and step suggestion

**I5 — Step suggestion is too noisy or too quiet** — *High.*
Auto-suggested steps from heuristic grouping produce junk the analyst
deletes, merges, and re-authors. No explanation of *why* a step was
suggested.

**I6 — Rapid app switches pollute the step model** — *Medium.*
A worker tabs SAP → Excel → SAP → Email → SAP in 30 seconds. Four activity
bands, three screenshots, three suggested steps — all part of one logical
action.

### 4 — Analyst: Re-normalization anxiety

**I7 — Re-normalization is scary** — *Medium.*
The analyst has spent 30 minutes editing steps and needs to re-analyze. The
docs say re-norm preserves manual work, but the analyst doesn't trust it.

### 5 — Analyst: Video alignment

**I8 — Video-to-timeline sync is fragile** — *Medium.*
OBS sync depends on a clock-offset file. If OBS started late, restarted, or
was forgotten, alignment breaks. `externalVideoOffsetMs` exists but the
analyst doesn't know it.

**I9 — Step-to-video link is the killer feature but isn't prominent** —
*Medium.*
Clicking a step and having the video jump is what makes the tool different.
But the connection isn't visually immediate in the Steps view.

### 6 — Analyst: Screenshots

**I10 — Screenshot gallery is a wall of sameness** — *Medium.*
60 screenshots, many nearly identical. The analyst scrolls looking for the
one they need.

**I11 — No text search across screenshots** — *Low.*
No way to search screenshot content for on-screen text.

### 7 — Analyst: Process map and conformance

**I12 — Mined process map vs. expected process — no overlay** — *Medium.*
PM4Py shows observed behavior. The analyst has a mental model of how it
*should* work. The gap is the value, but the tool doesn't surface it.

**I13 — Cross-session comparison with mismatched taxonomies** — *Low.*
Sessions captured with different taxonomy versions produce unreliable
variant comparisons. No warning.

### 8 — Analyst: Annotations and deliverables

**I14 — Notes don't flow into any export** — *High.*
Annotation notes live in `annotations.json` and don't appear in any report
or export. The analyst keeps real observations in a separate Word doc.

**I15 — No "exclude this range" annotation** — *Medium.*
The worker does something wrong mid-session. The analyst can't mark a time
range as "not part of the process."

**I16 — Exports don't match what the stakeholder wants** — *High.*
The analyst's audience wants a presentation-ready one-pager. The exports
are raw BPMN, XES, CSV, SVG, Markdown, docx.

### 9 — Analyst: Taxonomy and vocabulary maintenance

**I17 — App Vocabularies are manual YAML work** — *Medium.*
Building a vocabulary requires understanding UIA field structure and
editing YAML. Most apps probably stay as raw UIA names.

**I18 — Taxonomy hard to maintain across engagements** — *Low.*
Multiple engagements = multiple taxonomy files, no consolidation path.

### 10 — Analyst: State and workflow continuity

**I19 — Project state doesn't auto-save** — *Medium.*
The project file matters most in multi-session comparison. The analyst
probably just uses Recents instead of explicitly saving projects.

### 11 — Worker: Capture experience

**I20 — No post-session summary for the worker** — *High.*
The worker presses End and hopes it worked. No confirmation of what was
captured. "OBS died 5 minutes in" discovered hours later by the analyst.

**I21 — No pre-session config validation** — *Medium.*
5 workers, 5 config copies. Worker 3 has wrong OBS, worker 5 has hotkey
conflicts, worker 1 forgot the engagement ID.

**I22 — Recording indicator is too subtle** — *Low.*
Tray icon shows state but tray icons are hidden by default on modern
Windows.

### 12 — Worker/Analyst: Idle detection nuance

**I23 — Idle doesn't distinguish "reading" from "away"** — *Medium.*
Reading a long document is idle to the system but active to the process.
The analyst can't tell which.

### 13 — Analyst: Pipeline diagnostics

**I24 — Normalization errors are developer-speak** — *Medium.*
"KeyError: 'case_ids'" means nothing to a business analyst. The analyst
shouldn't need to leave the app to diagnose a pipeline failure.

### 14 — Operational: Storage and performance

**I25 — Session folders grow silently** — *Low.*
An hour-long session can be 3-5 GB. The prune script exists but someone
has to run it.

**I26 — Viewer probably slow on large sessions** — *Low.*
25k events and 200 screenshots is a lot of DOM. No performance budget or
profiling documented.

### 15 — Untapped: Audio and verbal context

**I27 — No access to what the worker said** — *Low.*
If OBS records audio, there's no way to search or annotate it. The verbal
explanations are the real insight.

### 16 — Recorder: UIA coverage and signal quality

**I28 — UIA richness is app-dependent, discovered too late** — *High.*
WPF apps expose rich UIA trees. Win32/Java/Electron apps often expose
almost nothing. The analyst discovers sparse interaction data only after
the session.

**I29 — Browser-based work generates enormous noise** — *High.*
Chrome/Edge fire UIA events for every DOM change. Browser-heavy processes
are a firehose of noise.

**I30 — 750ms value_changed debounce is a fixed constant** — *Medium.*
Too aggressive for fast typists, too frequent for slow form-fillers.

**I31 — Value clamp at 256 chars is invisible and possibly leaks PII** —
*Medium.*
Long text truncated with no flag. PII-carrying non-password fields captured
in full.

**I32 — Recorder can't see elevated processes** — *Medium.*
Enterprise apps running elevated are invisible to UIA. No notification.

**I33 — Recorder crash doesn't identify the cause** — *Low.*
The recorder crashes, restarts, crashes again on the same app. No
diagnostic to identify which app/control caused the failure.

**I34 — Recorder stats line carries no diagnostic signal** — *Low.*
The 30s stats line exists only for liveness. Could carry event counters,
drop rates, memory usage.

### 17 — Normalization: Pipeline internals

**I35 — Collapse stage over-fragments browser sessions** — *High.*
Browser window titles change constantly. Each title change creates a new
activity event. Browser-heavy timelines are walls of thin bands.

**I36 — Same-timestamp ties make step suggestion non-deterministic** —
*Medium.*
Two events at the same millisecond sort in an unstable order. Step
grouping depends on which lands first.

**I37 — _merge_steps() probably allows overlapping steps** — *Medium.*
Manual and auto steps can coexist with overlapping time ranges. The
analyst has to notice and delete duplicates.

**I38 — Canonical matching breaks silently on app updates** — *Medium.*
Field IDs change when the target app updates. Match rate drops with no
explanation of *why*.

**I39 — Variant comparison uses activity sequence, not logical process** —
*Medium.*
Checking email mid-process creates a different variant even though the
process is the same.

**I40 — PM4Py mining failure is all-or-nothing** — *Medium.*
If BPMN mining fails, the DFG is also lost even though it's independently
computable.

**I41 — Step-noise denylist is per-session but noise is per-team** —
*Medium.*
The analyst re-configures the same denylist for every new session.

### 18 — Capture: Edge cases and reliability

**I42 — Virtual desktops are invisible** — *Low.*
Win+Tab context switches don't appear in the event stream.

**I43 — Multi-monitor activity has no spatial context** — *Medium.*
The event stream doesn't record which monitor the window was on.

**I44 — Accidental session start has no undo** — *Medium.*
Firing a marker auto-starts a session. Muscle memory or wrong-app hotkey
press creates a junk session.

**I45 — Hotkey conflicts are detected but not resolved** — *Medium.*
A toast names the conflict and does nothing. The worker works without
that hotkey.

**I46 — OBS scene bootstrap conflicts with existing setup** — *Low.*
The capture app creates duplicate scenes in OBS instead of reusing
existing ones.

**I47 — appendFileSync blocks on interaction bursts** — *Low.*
Per-event sync writes block the Node event loop during rapid interaction
bursts.

### 19 — Multi-worker coordination

**I48 — No per-worker grouping in Compare Sessions** — *High.*
The view treats every session identically. No grouping by worker, no
per-worker analytics.

**I49 — No side-by-side session comparison** — *High.*
The aggregate view merges. The analyst wants to see two timelines aligned
to spot divergence.

**I50 — Sync markers are recorded but never acted on** — *Medium.*
No alignment, no offset computation, no synchronized playback from
matching sync IDs.

### 20 — The session handoff

**I51 — No session integrity verification** — *Medium.*
No checksum or file manifest. Incomplete transfers discovered only when
the analyst tries to use the session.

**I52 — Session folders identified by timestamp, not content** — *Low.*
Three sessions on the same day = three opaque timestamp folders.

**I53 — No selective session packaging for transfer** — *Low.*
No "export without video" option for when only the event stream is needed.

### 21 — Analyst learning curve and discoverability

**I54 — No guided first-analysis workflow** — *High.*
Large concept surface, no onboarding in the viewer. The help modal
documents features but doesn't teach workflows.

**I55 — Step lifecycle states leak implementation details** — *Medium.*
`auto_suggested`, `auto_matched`, `manually_authored`, `edited` are
pipeline concepts that confuse the analyst.

**I56 — Cases vs. steps relationship not explained** — *Medium.*
Cases (from markers) and steps (from interaction grouping) exist on
different axes. The UI doesn't explain this.

### 22 — App Vocabulary workflow

**I57 — Vocabulary bootstrap is overwhelming** — *Medium.*
Hundreds of unique UIA field tuples per app. No prioritization by
frequency.

**I58 — Vocabularies have no coverage reporting** — *Low.*
If the app updates and the vocabulary stops matching, nobody knows.

**I59 — Cross-app interaction patterns are invisible** — *Low.*
Copy from SAP, paste into Excel — the pattern isn't captured or surfaced.

### 23 — Project layer and analytical continuity

**I60 — Project doesn't save analytical context** — *Medium.*
Saves viewport state but not denylist preferences, taxonomy version per
session, or cross-session notes.

**I61 — No engagement-level narrative** — *Medium.*
No project-level summary or findings text area. The analyst constructs
the narrative manually.

**I62 — Project paths are absolute** — *Low.*
Sending a project file to a colleague breaks every path.

### 24 — Cross-session knowledge transfer

**I63 — Analyst redoes step work across sessions of same process** —
*High.*
Sessions 2-5 start from scratch even though the process is the same.
Canonical matching partially helps; manual edits don't transfer.

**I64 — No before-and-after comparison framework** — *Medium.*
Re-recording after improvements has no structured old-vs-new comparison.

### 25 — Undo model edge cases

**I65 — Undo stack doesn't survive viewer restart** — *Medium.*
In-memory, capped at 50, cleared on session switch.

**I66 — Re-normalization probably clears the undo stack** — *Low.*
Undo-stack fence the analyst doesn't expect.

### 26 — Configuration validation

**I67 — Taxonomy rules fail silently** — *Medium.*
A typo in a rule matches 0 events. No feedback.

**I68 — No cross-config validation** — *Low.*
Taxonomy, canonical set, and vocabularies are separate files with no
cross-reference checking.

### 27 — Exports and deliverables

**I69 — Markdown report unreadable by stakeholders** — *Medium.*
Stakeholders don't have Markdown renderers. Report opens in Notepad.

**I70 — Process map SVG needs manual cleanup** — *Low.*
Oversized canvas, generic fonts, dark-UI colours on white slides.

### 28 — Viewer: underused and misused UI

**I71 — Density histogram shows noise, not signal** — *Low.*
Browser DOM events look the same as meaningful form interactions in the
histogram.

**I72 — Command palette invisible and inconsistently wired** — *Low.*
Only `flow-view.js` provides commands. No discoverability hint.

**I73 — Event table is unused screen real estate** — *Low.*
A developer debugging tool taking layout space from analyst-facing
content.

### 29 — Analysis layer: IE/CI outputs (missing)

**I74 — No waste classification on activities or steps** — *Critical.*
The tool produces activity durations and rework statistics but never
classifies time as value-add, business-required non-value-add, or waste.
The analyst mentally categorizes waste while watching the timeline and
writes the classification into a separate document. The data to
auto-classify is already captured: idle gaps (waiting), rapid app
switches (motion), repeated sequences (defects/rework), cross-app data
transfer (overprocessing).

**I75 — No time study computation** — *Critical.*
The tool computes activity durations and case durations but not IE-grade
time study metrics per step: cycle time with mean/min/max/σ, breakdown
into active processing vs waiting vs switching, or cross-worker
comparison at the step level. The analyst produces these manually or
not at all.

**I76 — No automation candidate scoring** — *Critical.*
The interaction stream contains everything needed to identify RPA
candidates — repetitive sequences, rule-based paths, volume data — but
the tool never scores steps for automation potential or estimates time
savings. The analyst eyeballs the interaction stream and writes
candidates into a separate assessment document.

**I77 — No process efficiency ratio** — *High.*
No single metric summarizes "how efficient is this process." VA time /
total time is the standard lean metric. The data exists. The tool
doesn't compute or display it.

**I78 — PDD export doesn't include analytical context** — *High.*
`pdd_export.py` produces a process definition document with steps and
phases. It does not include waste classification, time study data,
automation flags, or efficiency metrics — the context a developer or
automation engineer needs to prioritize and scope the work.

**I79 — No passive capture mode for IE reviews** — *High.*
The capture app is designed for structured sessions with markers. An
8-hour passive recording (no markers, no coordination, just record the
shift) requires a different mode: no Start/End prompts, no marker UI
as the primary control, no auto-end on idle. The Live Session window
should show a shift timer and a summary of activity, not a marker
stack.

**I80 — No auto case detection for unstructured recordings** — *High.*
Without markers, the normalization pipeline has no case boundaries.
For passive recordings, the tool needs to auto-detect repeated process
instances from the activity pattern — "this sequence of apps and
interactions looks like the same process you did 40 minutes ago." A
heuristic approach (long idle gap + app change + similar starting
pattern = probable case boundary) covers the common case before the
deferred ML approach.

**I81 — No cross-system data transfer detection** — *Medium.*
When a worker copies data from one app and enters it in another (SAP →
Excel, email → CRM), the interaction stream shows `value_changed`
events in both apps within a short time window. This pattern is
overprocessing waste and an automation signal but is never detected or
surfaced.

---

## Part 2 — Root-Cause Clusters & Solutions

The 73 entries collapse into 13 root problems. Solving the root prevents
bloat — one fix per cluster instead of scattered features.

---

### Cluster A — "The analyst's first 10 minutes are wasted"

**Entries:** I1, I2, I3, I55, I56, I71, I73

**Root cause:** the tool shows everything and explains nothing. There is no
summary, no orientation, and implementation concepts leak into the UI.

**Solution — session summary panel:**

Replace the event table (I73) as the default content in the Session view
with a summary panel. Contents:

- Session stats from `stats.json`: duration, case count, event count,
  app breakdown (top 5 apps by time %), app switch count, longest
  single-app stretch.
- Simplified step states (I55): show "auto-detected (review it)" vs
  "confirmed by you (safe)" — two visual states, not four. The pipeline
  distinction (`auto_suggested` / `auto_matched` / `manually_authored` /
  `edited`) stays internal.
- Cases-vs-steps hint (I56): a one-liner on first encounter — "Cases are
  time ranges from Start/End markers. Steps are logical actions identified
  during analysis."
- Marker problems (feeds I4): dangling starts, duplicate starts,
  suspiciously short cases (<5 s), cases with zero interactions. Each
  with a one-click fix.
- Outlier flag for Compare Sessions (I3): "Session 3 is an outlier —
  2.4x longer than median."
- Filter density histogram to interaction events only (I71).
- Auto-zoom to first case on load (I2).

The event table moves behind a menu toggle for developer debugging.

**Scope:** UI work, no new data model, no pipeline change. Existing data.

---

### Cluster B — "The marker/case model is fragile"

**Entries:** I4, I15, I44

**Root cause:** the worker is an unreliable case-boundary emitter. The
analyst inherits the mess.

**Solution — marker problems + range-to-case:**

- **Marker problems** in the session summary (Cluster A): list issues,
  offer one-click fixes ("close this start at [next idle gap / session
  end]").
- **Range-to-case on the timeline:** the existing Shift-drag range
  selection (already implemented) gains an "Insert case from selection"
  action. The analyst drags the range, clicks "create case," types a
  label. Under the hood: two `marker_edit` inserts (start + end). The
  infrastructure exists.
- **Accidental-start countdown (I44):** on first marker of a session,
  show a 3-second countdown in the Live Session window with Esc to
  cancel. One condition in `main.js`'s marker fire handler.

Don't build a full wizard. Don't build auto-inference yet. The summary +
range-to-case + countdown cover the 80% case.

---

### Cluster C — "Knowledge doesn't persist across sessions"

**Entries:** I41, I63, I60, I61, I62, I19

**Root cause:** the project layer saves viewport state but not analytical
context. Every new session is a fresh start.

**Solution — thicker project layer:**

Expand `project.js` to hold:

- **Team-level step-noise denylist** (I41): a `default_ignored_processes`
  list in the project file, applied automatically when loading any session
  into the project. Per-session overrides still work.
- **Step template reference** (I63): a `step_template_session` path in the
  project. When loading a session that has no steps, and the project has a
  template, offer: "Apply step structure from [template session]? (copy
  step names, adjust timing proportionally)." One-click, then the analyst
  adjusts.
- **Project-level notes** (I61): a `findings` text field in the project
  file. Editable from a "Project notes" panel. The engagement narrative
  stays inside the tool.
- **Analytical context** (I60): store the active taxonomy path, canonical
  set path, and a per-session `{ analyzed: bool, taxonomy_version }` map
  in the project file.
- **Relative paths** (I62): store all paths relative to the project file
  location. Resolve at load time. Projects become portable.
- **Auto-save** (I19): persist project state on every state change with a
  5-second debounce. No explicit Save needed for the working state. Save
  As still creates a named file.

**Scope:** all `project.js` changes + a small `loadSessionIntoView` hook.

---

### Cluster D — "The recorder's signal quality varies and is undiagnosable"

**Entries:** I28, I29, I30, I31, I32, I33, I34, I36

**Root cause:** the recorder is a black box. Signal quality depends on the
target app, and when quality degrades the analyst has no diagnostic.

**Solutions — incremental C# and config changes:**

- **I29 — browser noise filter:** add to `UiaSubscriber.cs`: when
  `FrameworkId == "Chrome"` and `ControlType ∈ {Pane, Group, Document,
  Custom}` with no `AutomationId`, drop the event. Mirrors the existing
  Win32 desktop-chrome filter. ~15 lines of C#.
- **I33 + I34 — crash diagnostic + enriched stats:** wrap the UIA event
  handler in a try/catch that records `(pid, process_name, control_type)`
  of the last element before any exception. Emit on the 30s stats line
  alongside counters: events emitted, events dropped, errors. Electron
  side parses and writes a `recorder_health` system event.
- **I30 — configurable debounce:** add `interactions.debounce_ms` to
  `config.js` DEFAULTS. Pass to the recorder on startup via the `hello`
  message. The C# side reads it instead of hardcoding 750.
- **I32 — elevated process detection:** in `tracker.js`, when `active-win`
  returns a window, check if the PID is elevated. If so, emit
  `{ kind: "elevated_process" }` system event + one-time notification.
  Electron-side only.
- **I28 — UIA coverage hint:** when the recorder emits first events for a
  new foreground app, include `coverage_hint: "rich" | "basic" | "minimal"`
  based on whether the element has an `AutomationId`. The Live Session
  window shows this per-app. No separate probe — information surfaces
  during the session.
- **I31 — value truncation + PII:** add `value_truncated: true` to
  NDJSON output when the C# side clamps. Add
  `interactions.suppress_values_for` to config — a list of
  `(process_name, automation_id)` pairs replaced with `[suppressed]`.
- **I36 — sequence counter:** add an incrementing `_seq` to each NDJSON
  event in the recorder. Used as secondary sort key in
  `normalize.py`'s load stage. Deterministic ordering.

Each change is independent and testable. No architectural change.

---

### Cluster E — "The normalization pipeline has silent edge cases"

**Entries:** I35, I37, I38, I39, I40, I67

**Root cause:** the pipeline is correct on the happy path but silent on
edge cases. Failures don't explain themselves.

**Solutions — focused Python changes:**

- **I35 — collapse-by-app:** add a `collapse_mode` option —
  `"app_and_title"` (default) or `"app_only"`. When `app_only`, the
  collapse stage ignores `title`. Exposed in the viewer's normalize
  dialog as a checkbox: "Collapse browser title changes." One config
  key, one `if` branch.
- **I37 — merge overlap detection:** after `_merge_steps()`, scan for
  time-range overlaps between manual and auto steps. If an auto step
  overlaps a manual step by >50%, drop it. Log the suppression. ~5 lines.
- **I40 — DFG/BPMN decoupling:** wrap BPMN mining in its own try/except.
  If it fails, skip `process_map.bpmn` but still write `dfg.json`. The
  DFG computation is already separate code.
- **I67 — taxonomy validation:** after classification, emit a
  `taxonomy_report` in `stats.json.meta` listing per-rule match counts.
  Rules with 0 matches get flagged. Surface in the normalization log:
  "⚠ Rule 'SAP.*incoive' matched 0 events." No new UI.
- **I38 — canonical drift surface:** when `match_rate` drops below the
  previous session's rate minus 20 points, emit a `canonical_drift_warning`
  in `stats.json` listing stopped-matching steps and changed field values.
  Show as a yellow banner in the Steps view.
- **I39 — step-level variants:** add `variant_level` option: `"activity"`
  (current) or `"step"`. Step-level uses the step sequence instead of the
  activity sequence. Toggle in Compare Sessions. Worth doing but not in
  the first pass.

---

### Cluster F — "The last mile to a deliverable is manual"

**Entries:** I14, I16, I69, I70

**Root cause:** the tool's output is raw artifacts. The analyst assembles
the deliverable outside the tool.

**Solution — self-contained HTML findings report:**

One `generateFindingsReport()` function in a new `report-html.js` module.
Composes:

- **Process map** (inline SVG, light palette, cropped to content —
  solves I70).
- **Session or aggregate stats** (formatted from `stats.json`).
- **Analyst notes** (from `annotations.json` — solves I14).
- **Flagged screenshots** (base64-embedded; the analyst stars
  screenshots in the gallery, starred ones appear in the report).
- **Variant summary** if multiple sessions.
- **Placeholder recommendations section** (editable before export, or
  left as "Recommendations: [to be completed]").

Self-contained HTML, opens in any browser, looks presentable (solves I69).
The existing Markdown report stays for developer/data use.

**Scope:** one new module, one export action.

---

### Cluster G — "Multi-worker comparison is the point but the tool doesn't support it"

**Entries:** I48, I49, I12, I50

**Root cause:** Compare Sessions merges everything into an aggregate. The
analyst wants to see *differences*.

**Solutions:**

- **I48 — per-worker grouping:** in `aggregate-view.js`, when
  `manifest.worker` is populated, add a "Group by worker" toggle. The
  existing charts gain a per-worker colour or column grouping. Rendering
  change only — data is already loaded.
- **I49 — two-session side-by-side:** when exactly two sessions are
  loaded, a "Compare" button renders two `TimelineCore.renderMiniTimeline`
  strips stacked vertically, aligned by time or first case start, with
  matching steps highlighted and divergences called out. Reuses existing
  timeline core. Moderate scope but bounded.
- **I12 — conformance overlay:** when the analyst has a Process Template
  and loads a session, colour the DFG nodes: green = matches template,
  amber = deviates, red = missing from template. The data exists —
  `auto_matched` steps know their canonical counterpart. Colour overlay
  on `dfg-viewer.js` nodes.
- **I50 — sync marker alignment:** defer. The infrastructure is
  non-trivial and it's only relevant for handoff processes.

---

### Cluster H — "Capture-side confidence"

**Entries:** I20, I21, I45, I46, I51, I52

**Root cause:** the worker can't tell if the session is good, and the
analyst can't tell if the transfer was complete.

**Solutions — small independent capture-side changes:**

- **I20 — post-session summary:** when `session.end()` is called, show a
  panel in the Live Session window: duration, event/case/screenshot/
  interaction counts, video status. Data is already in memory.
- **I52 — session label:** add a `label` field to `manifest.json`. Set it
  from the Live Session window's end screen. Show in Recents alongside
  the timestamp. One field, one input.
- **I21 — config validation:** at session start, checklist:
  `engagement_id` set, OBS reachable (if configured), recorder spawned,
  hotkeys registered, folder writable. Green/red in the Live Session
  window. If anything is red, don't auto-start.
- **I45 — hotkey fallback:** when `globalShortcut.register()` fails, try
  Ctrl+Alt instead of Ctrl+Shift. If fallback succeeds, notify. If both
  fail, notify and continue.
- **I46 — OBS scene reuse:** before `CreateScene`, call `GetSceneList`.
  If "Process Discovery" exists, reuse it.
- **I51 — session integrity:** at session end, write
  `session-integrity.json` (file names + sizes). At viewer open, validate.
  Flag missing files.

---

### Cluster I — "The analyst learning curve"

**Entries:** I54, I56, I55, I24

**Root cause:** large concept surface, no workflow guidance, implementation
details leaking into the UI.

**Solution — context-sensitive banners, not a tutorial:**

When a session loads with no `stats.json`: "This session hasn't been
analyzed yet. Click **Analyze** to identify cases, steps, and statistics."

After normalization, if auto-suggested steps exist: "Review the **Steps**
tab — N steps were auto-detected and may need editing."

After steps are reviewed, if no phases exist: "Group your steps into
**Phases** to organize the process."

Each banner is one line, one link, dismissed on action. State machine with
3-4 states driven by presence/absence of `stats.json`,
`annotations.steps`, `annotations.phases`. No new view.

I55 and I56 are addressed in Cluster A (session summary panel). I24
(pipeline error translation) is addressed by mapping common Python
exceptions to plain-language messages in the normalization log host:
"Analysis failed because 3 events have no timestamp" instead of
"KeyError: 'timestamp'".

---

### Cluster J — "Video and screenshots are underutilized"

**Entries:** I8, I9, I10, I27, I11

**Solutions:**

- **I8 — interactive video re-sync:** "Sync video" button near the player.
  Click → "click a moment in the video, then click the matching event on
  the timeline." Two clicks compute the offset, write to
  `annotations.json.externalVideoOffsetMs`, reload. Small modal, two click
  handlers, one arithmetic operation. Infrastructure already exists.
- **I9 — step-to-video "Watch" button:** in the Steps detail pane, when a
  step is selected and video is loaded, show "▶ Watch." Click seeks to
  step start time and auto-plays. At step end, pause. Wiring
  `video.currentTime` and `video.play()` to step timestamps. Tiny.
- **I10 — screenshot duplicate detection:** compute a perceptual hash
  (8×8 grayscale average hash, 64-bit) for each screenshot during
  normalization. Store in `stats.json` or a sidecar. In the gallery,
  group consecutive screenshots with hamming distance <5. Show only the
  last, with "(+3 similar)" badge. Few lines of Python (Pillow) or
  Electron canvas.
- **I27 — audio transcription:** defer. Whisper requires PyTorch (~1.5 GB),
  conflicts with the "no heavy dependencies" philosophy. Flag as future
  optional plugin.
- **I11 — screenshot OCR:** defer, same reasoning. Tesseract/EasyOCR are
  large dependencies. The perceptual hash grouping reduces the gallery
  enough.

---

### Cluster K — "Vocabulary usability"

**Entries:** I57, I58, I17

**Solution — frequency-ranked bootstrap + coverage metric:**

- **I57:** modify `bootstrapAppVocab` to sort output by frequency. Add
  `# seen N times` comment per entry. In the App Library tab, collapse
  entries seen ≤2 times under "Show uncommon fields." The analyst sees
  the 15 fields that matter first.
- **I58:** after interaction enrichment, compute
  `vocab_coverage = interactions_with_meaningful_name / total` per app.
  Write to `stats.json.meta`. Surface in the session summary: "App
  Vocabulary coverage: SAP 87%, Excel 12%, Chrome 0%."
- **I17 — interactive vocabulary builder:** defer. The frequency-ranked
  bootstrap + coverage reporting gets 80% of the value at 10% of the
  effort.

---

### Cluster L — "Undo and re-normalization edges"

**Entries:** I7, I65, I66

**Solutions:**

- **I7 — re-norm confirm dialog:** before re-normalizing, show: "Will
  regenerate N auto-suggested steps. Your M manual steps will be
  preserved. Undo history will be cleared. Continue?" Two numbers
  computed from `annotations.json`. Trivial.
- **I65 — rotating annotation backups:** don't persist the full undo stack.
  Instead, keep the last 5 `annotations.json` versions as `.1` through
  `.5` (rotating on each write). Manual recovery for deep undo. Small
  change to `session.js` save path.
- **I66:** addressed by I7's confirm dialog warning.

---

### Cluster M — "Remaining independent items"

Items not collapsed into a cluster. Each is a standalone small fix or an
explicit deferral.

| ID | Solution | Scope |
|----|----------|-------|
| I5 | Show *why* a step was suggested (grouping reason) in the step detail pane. Defer the cross-session pattern library to after I63 (step template) proves the concept. | Small viewer change |
| I6 | Absorbed by I35 (collapse-by-app). When browser title changes collapse, rapid app-switch fragments disappear. | — |
| I13 | Compare `stats.json.meta.taxonomy_version` across loaded sessions. Yellow banner if they differ. One comparison. | Trivial |
| I23 | In `tracker.js`, when idle fires, check if the recorder emitted events in the last N seconds. Emit `idle_start` with `{ at_desk: true/false }`. Timeline renders dashed vs solid idle bands. One variable, one condition. | Small |
| I25 | Proactive prompt when session storage crosses a configurable threshold. Check at session end. | Small |
| I26 | Profile the render pipeline on a real large session before acting. Add `performance.mark` spans to `renderTimeline()` and the annotation edit path. | Investigation first |
| I43 | `active-win` returns window bounds. Store `{ x, y, w, h }` per activity event. Viewer infers monitor from coordinates (display geometry saved in `manifest.json` at capture start). Show monitor indicator. | Small capture + viewer |
| I47 | Switch to `fs.appendFile` (async) with a write queue. `fsync` every 500ms. Markers and manual screenshots flush immediately. | Small `tracker.js` change |
| I64 | Defer as standalone. The side-by-side (I49) + conformance overlay (I12) together provide the before/after comparison. | — |
| I72 | Wire all views as command providers. Add "⌘K" hint in topbar. Incremental per-view wiring. | Small, incremental |


**Explicitly deferred (not worth the effort now):**

| ID | Entry | Reason |
|----|-------|--------|
| I11 | Screenshot OCR | Heavy dependency (Tesseract/EasyOCR). Perceptual hash grouping (I10) reduces the gallery enough. |
| I17 | Interactive vocabulary builder | The frequency-ranked bootstrap (I57) + coverage metric (I58) get 80% of the value. |
| I18 | Taxonomy diff/merge UI | Tolerable workaround (manual YAML comparison). Low frequency. |
| I22 | Screen-edge recording indicator | Fragile always-on-top frameless window. Tray + Live Session window + hotkey overlay cover this. |
| I27 | Audio transcription (Whisper) | PyTorch ~1.5 GB, GPU-dependent. Conflicts with "no heavy deps." Future optional plugin. |
| I42 | Virtual desktop detection | `IVirtualDesktopManager` COM interface is undocumented, changes between Windows versions. |
| I50 | Sync marker alignment | Non-trivial infrastructure. Only relevant for handoff processes. |
| I53 | Selective session packaging | The analyst can manually skip the video file. Low frequency. |
| I68 | Cross-config validation | Low frequency. Not enough config files in use for this to be a daily pain. |

---

### Cluster N — "The analysis layer doesn't exist"

**Entries:** I74, I75, I76, I77, I78, I80, I81

**Root cause:** the tool stops at "here's what happened" and never
reaches "here's what should change." The analyst produces IE-grade
findings manually outside the tool. The data to produce them
automatically is already captured.

**Solution — analysis pipeline modules + `analysis.json`:**

A set of Python modules in the normalization pipeline, running after
step suggestion / canonical matching and before export. They take
`annotations.json`, `stats.json`, and the enriched event stream, and
produce an `analysis.json` sidecar per session.

**Module 1 — Waste classifier (`analysis_waste.py`):**

For every step (or activity segment if steps don't exist), classify
time as VA / BNVA / NVA using heuristics:

| Waste type (DOWNTIME) | Detection signal | Source |
|------------------------|------------------|--------|
| **Waiting** | Idle gaps > threshold within a step, system-loading pauses (brief idle between interactions) | Idle events, interaction gaps |
| **Motion** | App switches < N seconds where the worker returns to the same app; navigation within an app (clicking through menus with no data entry) | Activity events, interaction events |
| **Defects / Rework** | Repeated activity sequences already flagged by rework detection; backward navigation (returning to a previous step) | `stats.json` rework data, step ordering |
| **Overprocessing** | Cross-app data transfer — `value_changed` events in two apps within a short window with similar content (I81); manual formatting; copy-paste sequences | Interaction stream temporal correlation |
| **Transport** | Data moved between systems without transformation (export from A, import into B) | Same as overprocessing but at the step level |

The analyst reviews and corrects classifications. Output:
`analysis.json.waste_classification[]` — one entry per step with
`{ step_id, va_ms, bnva_ms, nva_ms, waste_types: [...] }`.

**Module 2 — Time study (`analysis_time_study.py`):**

For every step, across all instances in the loaded sessions:

- Cycle time: mean, min, max, σ, p25/p50/p75/p95
- Breakdown: active processing ms, waiting ms, switching ms
- Per-worker comparison (if `manifest.worker` differs across sessions)
- Flags: highest-variance step, longest step, biggest best-vs-worst
  worker gap

Output: `analysis.json.time_study[]` — one entry per step with
timing stats. Aggregated version for Compare Sessions.

**Module 3 — Automation scorer (`analysis_automation.py`):**

For every step, score on four dimensions:

| Dimension | Computation | Data source |
|-----------|-------------|-------------|
| **Repetitiveness** | % of instances where the interaction sequence matches (same automation_ids in same order) | Canonical matching data, interaction stream |
| **Rule-basedness** | Inverse of branching — if the interaction path is the same every time, score is high; if it varies, score is low | Variant analysis at step level |
| **Volume** | `instances_per_period × step_duration` — analyst fills in `instances_per_period` if not inferrable | Step timing × session count |
| **Estimated savings** | `step_duration × instances_per_day × 220 × (1 - automation_discount)` | Computed; analyst confirms `instances_per_day` |

Output: `analysis.json.automation_candidates[]` — ranked by
estimated savings, with per-dimension scores.

**Module 4 — Process efficiency (`analysis_efficiency.py`):**

- `process_efficiency_ratio = total_va_ms / total_elapsed_ms`
- Per-step efficiency breakdown
- Comparison across sessions / workers

Output: `analysis.json.efficiency` — the single summary metric plus
per-step and per-session breakdowns.

**Viewer integration:**

- **Session view:** new "Process Analysis" panel (or tab alongside
  Steps / Phases) showing waste breakdown (stacked bar per step),
  time study table, automation candidates list, and the efficiency
  ratio. The session summary (Cluster A) surfaces the efficiency
  ratio and top waste categories.
- **Compare Sessions:** aggregated analysis — cross-session time
  study, per-worker comparison, aggregated automation candidates,
  trend in efficiency ratio if multiple time periods are loaded.
- **PDD export:** `pdd_export.py` enhanced to include waste context
  per step, automation flags, and efficiency metrics alongside the
  existing step definitions.

**Scope:** 4 Python modules, 1 JSON sidecar, viewer panel additions,
PDD export enhancement. The heavy computation is arithmetic on
existing data. The heuristic classifiers are the design work.

---

### Cluster O — "Passive capture doesn't exist"

**Entries:** I79, I80

**Root cause:** the capture app assumes structured sessions with
markers. An 8-hour passive recording (no markers, no coordination)
requires a different mode.

**Solution — passive mode + auto case detection:**

- **I79 — passive capture mode:** a `capture_mode: "passive"` config
  option. In passive mode: no Start/End marker prompts, no marker
  stack in the Live Session window (replaced by a shift timer and
  activity summary), idle detection doesn't auto-end the session
  (it records idle as data), and the session runs until explicitly
  stopped or until a configured shift duration elapses. The worker
  installs the tray app and forgets about it. All other capture
  machinery (polling, screenshots, recorder, OBS) works unchanged.
- **I80 — auto case detection:** a normalization module
  (`case_detect.py`) that runs before case assignment when no
  markers exist. Approach: find recurring subsequences in the
  activity stream. Heuristics: (1) long idle gap (> configurable
  threshold, default 5 min) + app change = probable case boundary;
  (2) similar starting pattern (same first 3 apps in same order)
  across detected segments = probable same process. Output: proposed
  marker events injected into the stream, which the existing case
  assignment then processes. The analyst reviews and confirms in the
  viewer (using the marker cleanup / range-to-case tools from
  Cluster B).

**Scope:** capture config addition, one normalization module, viewer
shows proposed cases as editable markers. The existing pipeline
handles the rest once markers exist.

---

## Part 3 — Execution Plan (revised)

The execution plan is restructured around the analysis layer as the
central addition. The original viewer/capture polish passes are
preserved but resequenced after the foundational work.

**Estimated total: ~30-35 days of focused work** (up from ~20-25,
reflecting the analysis layer and passive capture additions).

---

### Phase 1 — Analysis Layer — ~5-7 days (Python)

**Clusters: N (analysis) + E (pipeline hardening)**

The foundational work. Everything downstream — the deliverable, the
viewer panels, the IE review workflow — depends on `analysis.json`
existing with waste, time study, automation, and efficiency data.

| Item | Work |
|------|------|
| `analysis_waste.py` — waste classifier (I74) | Heuristic VA/BNVA/NVA per step from idle gaps, app switches, rework, cross-app transfers |
| `analysis_time_study.py` — time study (I75) | Per-step cycle time stats, active/waiting/switching breakdown, worker comparison |
| `analysis_automation.py` — automation scorer (I76) | Repetitiveness, rule-basedness, volume scoring; estimated annual savings |
| `analysis_efficiency.py` — efficiency ratio (I77) | VA/total ratio per step and per session |
| `analysis.json` sidecar schema + writer | Structured output consumed by viewer and exports |
| Cross-app data transfer detection (I81) | Temporal correlation of `value_changed` events across apps |
| Collapse-by-app option (I35) | Essential for browser-heavy sessions feeding the analysis |
| Merge overlap detection (I37) | Prevents double-counted steps in the time study |
| DFG/BPMN decoupling (I40) | DFG must survive BPMN mining failure for the analysis to render |
| Taxonomy validation (I67) | Analysis quality depends on correct classification |

**Delivers:** every normalized session now produces structured IE
findings. The data exists even before the viewer surfaces it.

---

### Phase 2 — The Deliverable — ~3-4 days

**Clusters: F (report) + enhanced PDD**

| Item | Work |
|------|------|
| `report-html.js` — findings report (I14, I16, I69, I70) | Self-contained HTML: process map, waste breakdown, time study, automation candidates, notes, screenshots, efficiency ratio |
| Enhanced PDD export (I78) | `pdd_export.py` includes waste context, automation flags, time data per step |
| Screenshot starring in gallery | Star/flag toggle; starred screenshots flow into reports |
| Export action wiring | "Export findings report" / "Export PDD" buttons on Session and Compare Sessions views |

**Delivers:** the analyst's output is a structured CI/IE deliverable,
not raw data assembled in PowerPoint. The PDD now gives developers
the analytical context they need.

---

### Phase 3 — Viewer Surfaces for Analysis — ~3-4 days

**Clusters: A (session summary, revised) + N (viewer integration) + G (comparison)**

| Item | Work |
|------|------|
| Session summary panel with analysis data (I1, I77) | Efficiency ratio, top waste categories, automation candidates summary, marker problems |
| Process Analysis panel in Session view | Waste stacked bar per step, time study table, automation candidate list |
| Aggregated analysis in Compare Sessions | Cross-session time study, per-worker comparison, aggregated automation candidates |
| Per-worker grouping (I48) | "Group by worker" toggle on aggregate charts and time study |
| Conformance overlay (I12) | Green/amber/red DFG nodes from canonical match data |
| Outlier flag (I3) | "Session 3 is an outlier" callout |
| Simplified step states (I55) | Two visual states, not four |
| Context-sensitive workflow banners (I54) | State machine for first-time analyst guidance |

**Delivers:** the viewer surfaces analysis findings and comparisons.
The analyst reviews and corrects rather than building from scratch.

---

### Phase 4 — Passive Capture + Auto Case Detection — ~3-4 days

**Cluster: O**

| Item | Work |
|------|------|
| Passive capture mode (I79) | `capture_mode: "passive"` config, shift timer UI, no marker prompts |
| Auto case detection (I80) | `case_detect.py` heuristic module, proposed markers, analyst confirmation |
| Passive-mode viewer defaults | Default to app-only collapse, auto-zoom to first detected case, analysis panel as landing |

**Delivers:** the IE review workflow is enabled. Record an 8-hour
shift, get auto-detected process instances, get waste analysis and
automation candidates without the analyst hand-building anything.

---

### Phase 5 — Capture Confidence + Recorder Quality — ~3-4 days

**Clusters: H (capture confidence) + D (recorder signal)**

| Item | Work |
|------|------|
| Post-session summary (I20) | Session-end panel in Live Session window |
| Config validation (I21) | Pre-start checklist |
| Hotkey fallback (I45) | Auto-fallback on conflict |
| OBS scene reuse (I46) | Check before create |
| Session integrity file (I51) | File manifest at capture end, validation at viewer open |
| Session label (I52) | `label` field in manifest |
| Accidental-start countdown (I44) | 3-second cancel window |
| Browser noise filter (I29) | C# framework filter |
| Crash diagnostic (I33) | Last-element logging |
| Configurable debounce (I30) | Config key → C# parameter |
| Elevated process detection (I32) | System event + notification |
| UIA coverage hint (I28) | `coverage_hint` on first events per app |
| Value truncation flag (I31) | `value_truncated` + PII suppression config |
| Sequence counter (I36) | Incrementing `_seq` for deterministic sort |

**Delivers:** capture sessions are more reliable, the interaction
stream is cleaner, and failures are diagnosable.

---

### Phase 6 — Project Layer + Knowledge Persistence — ~2-3 days

**Cluster: C**

| Item | Work |
|------|------|
| Project auto-save (I19) | State-change listener + 5s debounce |
| Relative paths (I62) | Path resolution at save/load |
| Team-level denylist (I41) | `default_ignored_processes` in project file |
| Project-level notes (I61) | `findings` text field + UI panel |
| Analytical context (I60) | Taxonomy path, canonical path, per-session analysis status |
| Step template reference (I63) | "Apply steps from..." prompt when loading a new session |

**Delivers:** knowledge persists across sessions and engagements.

---

### Phase 7 — Marker Cleanup + Remaining Viewer Polish — ~2-3 days

**Clusters: B (markers) + L (undo) + remaining standalone items**

| Item | Work |
|------|------|
| One-click marker fixes in summary panel (I4) | Fix buttons alongside flagged problems |
| Range-to-case creation (I15) | "Insert case from selection" on Shift-drag |
| Re-normalization confirm dialog (I7) | Step count + undo warning |
| Rotating annotation backups (I65) | Last 5 versions on each write |
| Two-session side-by-side (I49) | Two stacked mini-timelines |
| Canonical drift surface (I38) | Yellow banner in Steps view |
| Step-level variants (I39) | Toggle in Compare Sessions |

**Delivers:** markers, undo, and comparison polish.

---

### Phase 8 — Video, Screenshots, and Remaining Items — ~2-3 days

**Clusters: J (video/screenshots) + K (vocabulary) + M (standalone)**

| Item | Work |
|------|------|
| Interactive video re-sync (I8) | Two-click offset computation |
| Step-to-video "Watch" button (I9) | Seek + auto-play |
| Screenshot perceptual hash grouping (I10) | Average hash, gallery collapse |
| Frequency-ranked vocabulary bootstrap (I57) | Sort by frequency, collapse uncommon |
| Idle at-desk detection (I23) | `at_desk` flag from recorder activity |
| Multi-monitor indicator (I43) | Window bounds → monitor inference |
| Step suggestion reason (I5) | Grouping reason in detail pane |
| Pipeline error translation (I24) | Plain-language error messages |
| Command palette wiring (I72) | All views as providers |
| appendFileSync → async (I47) | Write queue with periodic flush |
| Storage threshold prompt (I25) | Prompt at session end |
| Taxonomy match report (I67) | Per-rule counts in normalization log |
| Vocab coverage metric (I58) | Per-app coverage in session summary |
| Mismatched taxonomy warning (I13) | Yellow banner in Compare Sessions |

**Delivers:** accumulated polish across video, screenshots, vocabulary,
and small standalone items.

---

## Summary

| Metric | Value |
|--------|-------|
| Total entries | 81 |
| Root-cause clusters | 15 (A-O) |
| Execution phases | 8 |
| Estimated total effort | ~30-35 days |
| Entries addressed | 72 |
| Entries explicitly deferred | 9 (I11, I17, I18, I22, I27, I42, I50, I53, I68) |
| New Python modules | 5 (4 analysis + 1 case detection) |
| New JS modules | 1 (`report-html.js`) |
| New data artifacts | 1 (`analysis.json` per session) |
| New views introduced | 0 (new panels within existing views) |
| New capture modes | 1 (passive) |

The analysis layer (Phase 1) is the foundation. Phases 2-3 surface
its output. Phase 4 extends the tool to the IE review workflow.
Phases 5-8 are the original viewer/capture polish, resequenced to
follow the foundational work. Each phase ships independently.

---

*Document started 2026-05-17. Four review passes: (1) initial
analyst/worker workflow pain points, (2) recorder + normalization +
capture edge cases, (3) multi-worker coordination + project layer +
learning curve + vocabulary + knowledge transfer + undo + config +
exports + UI, (4) strategic reframing around two workflows (structured
discovery + IE review), the CI/IE analysis layer, and waste/time-study/
automation-scoring as the missing analytical engine.*
