# Features

What the Process Discovery Tracker does, by component. This is the capability
catalogue; for *how* each piece is built see the
[architecture reference](architecture/OVERVIEW.md), and for per-release history
see [CHANGELOG.md](../CHANGELOG.md).

The product has three components — **Capture** (record), **Normalization**
(transform), **Viewer** (analyze) — joined by a self-contained session folder.

## Capture — recording a session

Worker-side Electron tray app; see [architecture/CAPTURE.md](architecture/CAPTURE.md).

- **Foreground-window tracking** — polls the active window every 5 s and records
  `activity` events (app, title, duration).
- **UI-interaction recording** — a C# UI Automation sidecar captures clicks,
  selections, toggles, and field edits as `interaction` events, with noise
  filtering and per-keystroke coalescing.
- **Process markers** — Start/End markers (hotkey, tray, or the Live Session
  window) bracket the process; nested and sibling markers are supported; open
  markers auto-close on long idle.
- **Screenshots** — event-triggered captures (app switch, marker fire, idle
  resume, manual), multi-monitor aware, debounced so coincident triggers collapse
  to a single capture.
- **OBS video** — optional; drives OBS Studio over a local WebSocket to record
  the screen, and writes a clock-sync file so the viewer can align events to the
  video.
- **Idle detection** — pauses tracking and can auto-end the session after a
  configurable idle period.
- **Live Session window** — recording indicator, timer, open-marker stack,
  counters, recent-events feed, inline marker firing, and an end-session confirm.
- **Sync markers** — a shared sync ID fired across machines to correlate
  multi-worker sessions.
- **Resilience** — orphan-session recovery on the next launch; a recorder
  liveness watchdog; desktop notifications when capture is degrading (OBS
  dropped, recorder dead, screenshots failing).
- **Configuration** — per-session YAML (engagement / worker identity, hotkeys,
  idle thresholds, screenshot triggers, OBS, process-label list), editable via a
  plain-language setup window.
- **Session storage management** — in-tray disk-usage display, per-session
  delete, and bulk prune-by-age.
- **App-vocabulary prep sessions** — a dedicated capture mode (tray → *Start app
  vocabulary prep session…*) records a focused walkthrough of one app, filed
  separately under `vocab-prep`, purely to bootstrap that app's vocabulary (ADR-0002).
- **Worker consent gate** — an optional consent prompt at session start
  (`config.consent.mode`: off / per_session / once); declining aborts the session
  before any folder is created, and the decision is recorded in the manifest (§11f).
- **Honest capture-quality signals** — every interaction carries a detected UI
  `framework`, an `identity_source` ladder rung, and a per-element `confidence`,
  plus value-recovery and an opt-in OCR last resort, so thin captures on hard
  frameworks (Citrix/RDP, terminal, legacy controls) are *flagged* rather than
  silently lost ([ADR-0023](adr/0023-recorder-capture-confidence.md)).
- **Readiness check** — tray item (*Run readiness check…*) and a `--readiness`
  CLI for the day before a pilot: free disk on the session target **and** on the
  recorder's self-extract drive (the full-disk → 0-events failure class), the
  recorder starts and UI Automation answers, and a per-running-app **trust tier**
  (rich / basic / minimal / wall) from a short UIA snapshot probe using the same
  §11e identity/framework/confidence fields as real captures. Writes
  `readiness-report.json` next to the sessions plus a human summary (lab-phase §E1).
- **Dead-man alert** — if an active session sees **no interaction event and no
  recorder heartbeat for over 2 minutes**, the tray icon flips to a warning state,
  an OS notification fires, and a durable `recorder_silent` system event lands in
  `events.jsonl` (with `recorder_silent_end` on recovery) — the silently-dead
  recorder is loud within minutes instead of invisible all day (lab-phase §E2).
- **Worker close-out wizard** — at session end, up to 5 observed-value questions
  (longest focus stretch, most-repeated action, heaviest app-switch pair,
  re-keyed values — heuristic templates over measured `events.jsonl` facts, no
  LLM) append the worker's own answers to `annotations.json self_annotations[]`
  (`manually_authored: true`, preserved by re-normalization); then a read-only
  review pane (facts + the steps they marked) with an explicit **Submit
  session** that stamps `manifest.worker_review` — worker agency as the consent
  feature (lab-phase §E3).

## Normalization — transforming the recording

Analyst-side Python pipeline; see
[architecture/NORMALIZATION.md](architecture/NORMALIZATION.md).

- **Case assignment** — builds a case tree from Start/End markers and stamps every
  event with its case stack; can also detect cases from a recurring **anchor**
  field (e.g. the serial-search box), so re-searching the same value resumes one
  case instead of fragmenting (ADR-0012). Precedence: Process Template anchor →
  session-level anchor override → markers.
- **Unbracketed-session recovery** — when a long capture has no markers and no
  Process Template (everything would collapse into one case), two hand-rolled
  detectors offer a one-click fix: **suggested markers** propose Start/End
  boundaries from a change-point scan of the event stream (ADR-0017), and **anchor
  candidates** rank the field whose typing best segments the session into cases
  (ADR-0018). Both write only to `annotations.json` and apply only when the analyst
  Accepts; dismissals and accepts survive re-normalization.
- **Platform recognition** — classifies interactions into semantic types from
  documented platform/framework signatures (UIA ControlTypes + Chromium /
  Bootstrap / AG-Grid / SharePoint / Office), shared between the viewer and the
  pipeline so they agree (ADR-0011).
- **Activity classification** — rule-based classification against a taxonomy YAML;
  an unmatched activity falls back to a semantic label from the dominant recognised
  interaction category ("Form entry — chrome.exe") rather than "Unclassified".
- **Step suggestion** — groups consecutive interactions into suggested steps, with
  a per-session noise denylist; each step is stamped with a value-free
  `process_label` so repeated work collapses downstream (ADR-0013), plus
  `grain_keys` (element / screen / app) — the substrate for the viewer's view-time
  grain roll-up (ADR-0024).
- **Value-free screen labels** — window titles that embed a record id ("Create
  INC0010010 | Incident | ServiceNow") are stripped to one logical screen
  (`shared/screen-label-patterns.json`), so the map, steps, and stats don't fan out
  per case (ADR-0024 §6a/§6b).
- **Structural PII masking** — sensitive field values (password, SSN, card, CVV,
  PIN, secret/token, IBAN, routing/account number) are redacted in the *derived*
  event stream only — raw `events.jsonl` is never rewritten — with a one-way,
  join-preserving token so mining still distinguishes distinct secrets. Privacy by
  default; analyst-tunable via `pii_masking_config` (§11f).
- **Canonical matching** — matches interactions against a reference "canonical"
  step set, with a match rate and drift detection when the canonical set shifts.
  Re-analyze inherits a step's identity + curated grouping so corrections survive.
- **App Vocabularies** — per-application dictionaries that turn raw UIA fields
  into human-readable names and screen IDs.
- **Statistics** — activity, case, **step**, trace-variant, outlier, and rework
  statistics; step stats and variants group by the value-free label so they don't
  fragment per instance (ADR-0013).
- **Analysis layer** — heuristic waste / time-study / automation-candidate /
  process-efficiency findings, per session and pooled across sessions (ADR-0008).
  Automation candidates are **ranked by priority** (instance count × mean duration
  × automatable share) and projected into a conservative / expected / optimistic
  **€-ROI** savings band that feeds the viewer panel and the PDD (ADR-0016).
- **Process mining** — PM4Py miners produce the activity BPMN map and a DFG, plus
  **observed-flow** Step/Phase BPMNs mined from the analyst's annotations (no
  Process Template required — ADR-0012).
- **Exports** — `events.xes` (IEEE 1849-2016), a flat step CSV, `stats.json`, and
  a process-definition `.docx`.
- **Non-destructive re-runs** — manually-authored and analyst-edited steps survive
  re-normalization; only machine-suggested artifacts are regenerated.

## Viewer — analyzing a session

Analyst-side Electron app; see [architecture/VIEWER.md](architecture/VIEWER.md).

### Session view

- **Overview landing** — the default level: a case-quality badge (with the
  "case analysis on/locked" clause folded in as its subtitle), six measured fact
  tiles, a findings feed grouped by detector (one "how this was measured" note per
  group), and the memo export. Each finding card is a resident claim + tier chip +
  include-in-memo, with its evidence numbers, a screenshot **chip**, and a
  Show-on-timeline link one click behind an expand chevron.
- **Video-synced timeline** — a Flow timeline of activity bands, idle, markers, a
  labelled case header lane, and a screenshot rail; clicking seeks the OBS video.
  When no recording is linked the video stage collapses to a slim one-line band
  (with a "Link recording…" affordance), giving the space to the timeline + notes.
- **Optional timeline lanes** — density histogram, window-title runs, per-step
  bands, note dots — toggled via a Lanes menu.
- **Minimap, range selection, playhead** — whole-session orientation, Shift-drag
  range stats, and a video-synced playhead.
- **Steps & Phases** — review and edit machine-suggested steps (split / merge /
  hide / bulk-delete), group steps into phases, with a mini-timeline for each.
- **Aligned reading — curate one, apply to all** — a Flat / Aligned toggle on the
  Steps view shows the consensus backbone across the detected cases, each step
  with a frequency ("seen in N of M cases"); curate one step and propagate its
  name / description / flags to every case in a single undo, with divergent steps
  surfaced as editable exceptions (ADR-0015).
- **Annotations** — notes, a screenshot gallery, and a marker list, with full
  undo / redo; edits save to `annotations.json` and never touch the raw events.
- **Suggested markers & anchor candidates** — for a session captured without
  markers, the Flow timeline shows dashed suggested-marker bars (Accept to bracket
  a case, Dismiss to suppress) and the markers panel surfaces ranked anchor
  candidates ("Looks like a case anchor — `<field>` …"); Accept writes a
  session-level anchor and the next Analyze stamps real cases (ADR-0017 / ADR-0018).
- **In-view process map** — a **Map** level renders this single session's full
  interactive process map (the same Process diagram / Flow diagram × Activity /
  Step / Phase matrix as Compare Sessions) without leaving the Session view.
- **Grain slider — view-time step consolidation** — a single **Grain** control
  (element / screen / app / phase / case, default screen) rolls up the Steps list,
  the Flow diagram, the Map, and the Analysis itemisation live, with zero data
  mutation; sliding back restores the full detail (raw events are never touched —
  [ADR-0024](adr/0024-step-grain-as-view-time-rollup.md)).
- **Reference maps — decoupled, editable BPMN copies** — **⑂ Fork map** snapshots
  the current Process diagram into a standalone, fully-editable bpmn-js copy (a
  *one-way leaf* the pipeline never re-mines, merges, or regenerates). Copies live
  in a per-session **Reference maps** gallery, are typed **As-Is / To-Be /
  Reference**, carry visible provenance ("hand-edited, not updated by analysis")
  with a **drift** chip + **Re-fork** when the source map later changes, and a
  selected **To-Be** map embeds in the PDD's *Proposed to-be process* section
  (captioned analyst-authored, not mined). Every verb (fork / rename / kind /
  PDD-role / delete) is Ctrl+Z-able; copies survive re-analyze untouched
  ([ADR-0019](adr/0019-reference-maps.md)).
- **Run normalization in-app** — spawn the bundled Python pipeline with progress
  streaming and a cancel control.
- **Analysis findings** — a per-session Analysis level surfaces the estimated
  waste / time-study / automation / efficiency findings for review and correction
  (ADR-0008). Each section renders inside a **collapsible module** (title +
  one-line takeaway + chevron) whose collapse state persists per analyst; the
  takeaway shows even when collapsed. Tier gates always win — the efficiency figure
  and the value/waste bars stay behind a call-to-action until a step's
  business-required time is judged, so a default surface never shows a
  measured-looking "all value-add" result.
- **Return on automation (€-ROI)** — the Analysis level shows each automation
  candidate's conservative / expected / optimistic savings band (hours/yr, or €
  net/yr once a labour rate is set) with an **Edit assumptions…** form and per-row
  tuning; the headline total is provably grain-invariant (§11c). Below a floor
  (< 1 h/yr) the hero figure is replaced by a plain sentence so a near-zero saving
  is not dressed up as a hero stat.
- **Findings report (HTML)** — a one-click self-contained HTML report (process
  summary, the process map inline, the steps table, the waste/automation/efficiency
  findings, notes, and starred screenshots, plus an editable recommendations block)
  that opens in any browser with no external assets.
- **Process Definition Document (PDD)** — export a single session as a structured
  `.docx` PDD (document control, the As-Is process with an embedded process map,
  automation assessment, exceptions) — not a dump of pipeline data, but a real
  process-definition deliverable.

### Compare Sessions (Aggregate) view

- **Cross-session findings feed** (lab-phase §D1/§D2) — the surface LEADS with
  `variant_divergence`: for ≥ 2 Tier-2 sessions of the **same process** (same
  Process Template or the same accepted case anchor), per-case step-label
  sequences are aligned on the consensus backbone and compared per
  worker/session — *who completes a case in how many steps (median active
  time), and where the paths first diverge*. Rendered with the same
  finding-card component as the Overview; claims comparative, never normative;
  below the precondition one resident sentence + a collapsed disclosure
  (mechanics) + a real button that jumps to a loaded session's Overview render
  instead (no prose pointer). The findings export at the top of the Markdown
  report (all loaded sessions).
- **Aligned reading** (lab-phase §D2) — the pooled consensus step backbone
  across every loaded case, with per-worker/session hit counts (`A 4/4 ·
  B 0/3`) and off-backbone exceptions — how the process reads before it is
  drawn. Read-only here; curation stays in the Steps view's Aligned reading.
- **Process maps — notation × level matrix** (demoted below the findings +
  aligned reading, §D2) — Process diagram (BPMN, via bpmn-js)
  or Flow diagram (DFG, via cytoscape + `@dagrejs/dagre`), each at Activity / Step
  / Phase level; the two axes are independent (ADR-0012). Both lay out
  **left-to-right** and group the screen axis **value-free** (one logical screen is
  one node across cases, no per-record fan-out); zoom/pan and dragged layout persist.
- **Map navigation** — drill-down *scopes* to a clicked node's children
  (phase → its steps → that step's activities) on the Flow diagram, with a
  "show all" chip; a rare-path frequency **slider** thins low-frequency branches
  for readability on dense recordings (ADR-0013). Clicking an activity node drills to
  the source session or reclassifies it.
- **Cross-session statistics + analysis** — activity-frequency and case-duration
  charts; trace-variant, outlier, and rework tables; and a pooled Analysis panel
  (time study, per-worker comparison, automation candidates, efficiency trend).
- **Exports** — BPMN (activity / step / phase), XES, statistics, Markdown reports
  (with **Activity *and* Step statistics** tables), process-map SVG, the HTML
  findings report, and a PDD.

### Across the viewer

- **Process Template editor** — define and version a canonical step set and match
  sessions against it. **The primary way a template is born is as a byproduct
  of curation** (lab-phase §D3): Steps → "Export as Process Template" carries
  each curated step's match rules **and the accepted case anchor** into the
  YAML, so the next session of the same process arrives **self-segmented**
  (anchor inherited via template) and auto-matched — the flywheel. The raw
  YAML editor + version compare live in a collapsed **Machine-layer drawer**;
  auto-phase suggestion is out of the default flow (config flag
  `autoPhaseSuggest`, default off — phases come from the template or the
  analyst's own grouping).
- **App Library** — create, edit, and **delete** the App Vocabularies that enrich
  interactions, and **Discover from window** — point-and-learn discovery snapshots a
  prepared app window (two passes) and loads a stable-signature skeleton, the picker
  skipping volatile per-render ids. Each discovered control is annotated with the
  context the UIA walk captured (role / framework / on-screen region / ancestry +
  an honest weak-signature note), `class_name`-keyed signatures survive the save
  round-trip, and re-discovery merges into the selected vocab — entirely on-device
  ([ADR-0025](adr/0025-in-app-vocabulary-discovery.md)). Each row's raw signature
  fields collapse behind a "Match signature ▸" disclosure (auto-open on a
  discovered row); the toolbar's Machine-layer verbs ("Reload list", "Open YAML
  in editor") live in a "⋯ More" popup alongside the primary actions.
- **Vocab record semantics + discovery autofill** (lab-phase §C1/§C2) — each
  vocabulary row carries optional semantics (`verb`, `object`, `means`,
  `completion`, `case_id_source`, `carries_value`); discovery **auto-fills** the
  derivable ones (verb from control type × event kind, completion for
  Save/Submit/Send/OK buttons, carries_value for value-holding roles) so the
  editor pass is a per-row **review checklist** (reviewed ticks, progress count,
  Approve all), not authoring into blank boxes. Consumers: `completion` ends a
  step in step suggestion, `case_id_source` adds a small anchor-candidate scoring
  bonus (never a gate), `carries_value` widens the re-key detector's field set.
- **"Copy for LLM" + reviewed import** (lab-phase §C3 — authoring-time,
  consultant-side; the product runtime stays no-LLM) — one human-readable,
  PII-masked JSON of the **derived stream only** (vocab skeleton rows + facts +
  findings with tokenized values + value-free step groups; no raw events, no
  screenshots, no id lists), shown in a line-by-line review modal before
  copy/save; the LLM's suggestions paste back as a per-row approval checklist
  (suggest-don't-mutate — nothing applies without a tick, and Save stays manual).
- **Data posture** (lab-phase §C4) — `sealed | reviewable | open` (default
  reviewable), set and displayed on the Overview header; **sealed removes the
  Copy-for-LLM surface from the DOM entirely** — the egress promise is enforced
  by code, mirroring the empty-allowlist egress guard.
- **Team taxonomy** — promote analyst classification corrections into a shared
  `taxonomy.yaml`, so they classify every future session, not just this one.
- **Project layer** — save the working set (loaded sessions, focus session,
  active template, view state) into a single `.pdt-project.json` file.
- **Themes** — the light "Warm Editorial" default and an opt-in "Studio Dark"
  theme, switchable at runtime.
- **Command palette, keyboard shortcuts, and recent-sessions** — workflow
  conveniences throughout.

## What's deferred

Capabilities intentionally out of scope are tracked in
[SPEC-DEFERRED.md](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/SPEC-DEFERRED.md)
(on branch `product-edition`), notably the local ML stack (variant
merging, learned case-boundary inference) and multi-analyst concurrent editing.
The **non-ML** Phase 0 of the case-boundary work has shipped (suggested markers +
anchor candidates, ADR-0017 / ADR-0018); the ML-backed Phase 1+ stays deferred.
The broader product boundary — services-boutique, not self-serve enterprise
product (no BYOC / web-viewer / multi-user, no LLM-in-product, no MDM packaging) —
is fixed by [ADR-0026](adr/0026-distribution-unsigned-and-services-boutique-scope.md).
