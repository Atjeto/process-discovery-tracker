# PDT 1.0 — Productization Redesign Spec

> **Status:** Proposal — drafted 2026-06-04, revised 2026-06-05 to commit to
> a single business model (consultant-led delivery with the *configured tool*
> as a natural leave-behind), to drop the persona model from five modes to
> three, and to scope the LLM work down to what carries real demo value.
> Records a coherent target for the v1.0 productization line, on top of the
> v0.22.x lineage. Decisions inside are individually ADR-worthy; this doc
> exists to make them visible together so the shape can be argued before any
> one of them is implemented.
>
> Related strategic docs already in repo:
> [architecture/NORTH-STAR.md](architecture/NORTH-STAR.md),
> [architecture/VALUE-CHAIN-REVIEW.md](architecture/VALUE-CHAIN-REVIEW.md),
> [architecture/COHERENCE-AUDIT.md](architecture/COHERENCE-AUDIT.md),
> [SPEC-DEFERRED.md](SPEC-DEFERRED.md).

## 0. TL;DR

PDT 1.0 stops being an **analyst instrument** and becomes a **consulting
augmentation tool with a natural leave-behind path.** The consultant leads
the engagement and produces a **Process Backlog + a PDD per identified
process** as the immediate deliverable; the *configured tool itself* —
calibrated, vocabularies authored, templates tuned — is the leave-behind
when a client wants to retain it. **One pitch, one architecture, two phases
of the same engagement.** The pitch flexes per deal between "engagement only"
and "engagement + retained tool" without architectural rework.

**AI/ML is scoped to what carries the demo:**
- **Pattern Layer (classical ML)** — sequence motif mining, activity
  clustering, anomaly detection, marker-free case inference. Essential.
- **Naming Layer (local LLM, scoped to two uses)** — *activity naming* (the
  visible-wow output the Cockpit displays) and the *executive-summary
  paragraph* of each PDD. Screen names, phase names, the rest of the PDD,
  and the self-annotation questions are **heuristic-templated**, not LLM-
  driven — the LLM tax is paid only where it materially improves the
  deliverable.

**The viewer ships three contextual defaults** of one app (not five
separate UIs): **Glance** (timeline-as-story for the recording worker),
**Cockpit** (the consultant's review surface), **Workshop** (the existing
five-tab depth, rehomed behind a toggle). A new **Engagement** workspace
aggregates many sessions from many workers. A single polished **Demo Pack
engagement** closes the 30-minute prospect interest collapse — three demos
ship later, after one has proven the format.

None of the existing integrity invariants change — AI slots in as one more
suggester sitting next to the heuristic ones already governed by
[ADR-0017](adr/0017-suggested-markers.md),
[ADR-0018](adr/0018-anchor-candidates.md), and
[ADR-0023](adr/0023-recorder-capture-confidence.md). The €-ROI band
([ADR-0016](adr/0016-segment-level-automation-candidacy.md)) is rebuilt to
derive only from measured quantities so it stops giving false precision.

**Total committed work: ~6.5 cycles**, sequenced so consultant-defensible
value lands by cycle 2.5 *without any AI dependency*. The LLM work is
sequenced last and is bounded enough that if it slips or underperforms, the
rest of the product still ships.

## 1. Why this rewrite exists

The v0.20.x → v0.22.x line has shipped strong **discipline** — the e2e gate,
the session golden, the ADR registry, the suggest-don't-mutate detector
lineage, capture-confidence, App Vocabularies, the grain slider, Reference
Maps, the consent + masking layer. The integrity story is excellent. But two
problems are not solved by more discipline:

1. **The analyst-shaped hole.** PDT's outputs assume someone curates: places
   markers, names activities, identifies cases, edits annotations, writes the
   PDD prose. In a real organisation the worker is willing to be captured but
   no one is willing to be the analyst. The consultant (the owner) is the
   single available analyst and does not scale per session.
2. **The 30-minute prospect collapse.** A prospect who opens a raw session
   sees an event-fog: hundreds of nodes in the DFG, an unmarked timeline,
   dense interactions. The visible message is *"this is for someone else."*
   Interest drops before value lands.

Both are downstream of the same root: **the tool surfaces raw and intermediate
artifacts to the user, when the user wants synthesised conclusions.** This
spec describes the rebalanced product.

## 2. The reframing — operating model

**One pitch, one architecture, two phases of the same engagement.** The
consultant walks in the door selling outcomes-now-plus-capacity-later. The
buyer can take engagement-only or engagement-plus-retained-tool; the
architecture supports both without rework. The "retained tool" path is not
a separate product line — it's the natural state of the tool after a
successful engagement, when the client champion takes over the same Cockpit
the consultant was using.

**Three contextual defaults of one app** (§4 details each):

| Default | Who lands here first | Intent |
|---|---|---|
| **Glance** | Worker, immediately after their session normalises | "Show me what I did, let me confirm or correct it" |
| **Cockpit** | Consultant (during engagement) or client champion (after) | "AI found these; review, promote, edit, export" |
| **Workshop** | Whoever needs depth — analyst, RPA dev investigating an automation | "Slice, dice, drill, refine — the existing five-tab depth" |

The same human moves between defaults across sessions. A consultant
Glances their own pilot capture, Cockpits an engagement, drops into Workshop
to debug a misclassified case. A worker Glances their own session and
never sees Cockpit. A client champion uses Cockpit during normal operation
and only ever opens Workshop when something looks wrong. **The mode is
inferred from the user's recent actions and the artefact they're viewing,
and is one click to override.**

**The product is the deliverable + the configured tool.** The app is the
assembly line; the configured app is itself part of what the consultant
leaves behind. Everything in the viewer is judged against two questions:
*does this make the consultant faster at producing a publishable PDD?* and
*does this let the client champion keep producing them without us?*

Concretely, the work happens in this flow:

```
Worker records (+ self-annotates 5 min)         capture/
        │
        ▼
Normalization + Pattern Layer                   normalization/
        │       (ML — sequence motifs, clustering, anomaly)
        ▼
Naming Layer (local LLM)                        normalization/naming/
        │       (activities, screens, phases, draft PDD prose)
        ▼
Engagement Workspace                            viewer/ (new)
        │       (aggregate sessions, surface processes)
        ▼
Consultant reviews + curates AI suggestions     viewer/cockpit/
        │
        ▼
Process Backlog + PDDs                          deliverables/
```

Cross-cutting: capture-confidence ([ADR-0023](adr/0023-recorder-capture-confidence.md))
gates every AI output — if input confidence is low, naming and ROI return
*"insufficient signal"* rather than confabulated content.

## 3. The three new layers

### 3.1 Pattern Layer — classical ML and sequence mining

**Purpose:** detect structure in unmarked event streams. Replaces the analyst's
*pattern-recognition* job (not their judgement job).

**What it produces:**
- **Activity clusters.** Recurring event windows grouped by sequence
  similarity. The output of this layer is what the Naming Layer then names.
  Replaces the assumption that `process_label` derived from a single window
  title is enough.
- **Motifs / repeated subsequences.** "These 7 events repeat 23 times across
  4 sessions" — the raw signal for automation candidacy that
  [ADR-0016](adr/0016-segment-level-automation-candidacy.md) needs to be
  honest.
- **Cross-session case linkage.** When markers are absent, infer case
  boundaries from motif boundaries + app-vocabulary anchors + dwell-time
  bimodality. Always surfaces with a **confidence band**, never a single
  point estimate.
- **Anomalies.** Sessions or segments that differ substantially from the
  modal pattern — the candidate exceptions the consultant should look at
  first.

**How it ships:**
- New module: `normalization/patterns/` (sibling to `normalization/recognition/`).
- Submodules: `motif_mining.py`, `clustering.py`, `anomaly.py`, `case_inference.py`.
- Pure-Python where possible (use `scikit-learn` if/where unavoidable — vendor
  weights into `viewer/python/` only if the wheel is small; otherwise fall back
  to in-repo implementations of motif mining, since the input volume is small).
- Output integrates as a new `derived/patterns.json` blob and as new fields on
  existing `segments[]` / `cases[]` in `annotations.json` — additive, never
  destructive, never overwrites `manually_authored`.

**Why ML and not just heuristics:** the current heuristic stack
(`step_suggest`, `case_assignment`, segment ROI) already does the easy
deterministic version. The remaining lift — *similarity across noisy variant
sequences, cross-session linkage, anomaly thresholds calibrated to the
actual session* — is what classical ML adds without LLM cost or privacy
implications.

### 3.2 Naming Layer — local LLM, **scoped to two uses**

**Purpose:** produce business-language names and the one paragraph of prose
that carries the deliverable's narrative voice. The LLM tax is paid only
where it materially improves the deliverable; everything else stays
deterministic.

**Why scoped:** the full version (5 LLM uses) is 2–3 cycles of heavy
prompt-engineering, eval-harness, and hallucination-guarding work. Most of
the visible "AI wow" comes from *one* prompt — activity naming. The other
LLM uses originally specced (screen names, phase names, full PDD body,
interview questions) are nice-to-have but not load-bearing — and each one
adds a hallucination surface and a calibration loop. **Implementation cost
drops from ~2.5 cycles to ~1 cycle by scoping; visible quality stays
~80% of the full version.**

**The two LLM uses we keep:**

| Input (what the LLM sees) | Output | Why kept |
|---|---|---|
| Activity cluster: recognised interactions, window titles, control captions, app context, durations, frequency | Activity name + short description + confidence | This is what makes the Cockpit say "Review incident" instead of "cluster_4_in_servicenow". Load-bearing for the demo. |
| Process candidate: name + summary statistics + variant tree + automation candidates | Draft **executive-summary paragraph only** (PDD §1) — one paragraph, around the measured numbers, with provenance | This is the prose that carries the deliverable's voice. The rest of the PDD is structured templates with measured-input substitution; this one paragraph is where narrative quality matters. |

**Deterministic replacements** for what was previously LLM:

| Previously LLM | Now | Why |
|---|---|---|
| Screen names | Window-title patterns + App Vocabulary lookup | The vocab layer already handles this well; LLM would be redundant. |
| Phase names | Templated from the sequence of activity names ("Open → Read → Submit" patterns) | Templates beat LLM for short structural labels. |
| PDD §2–§5 prose | Structured templates with measured-input substitution | The numbers are the message; the prose around them can be written once as templates. |
| Self-annotation questions | Heuristic templates with observed-value substitution ("We saw you switch between {app_a} and {app_b} {n} times — what were you doing?") | The wizard UX is the value; the LLM was decoration. |

**Hard rules:**
- **Never sees raw events.** Only the derived stream. Same boundary the PII
  masking work ([§11f](../CHANGELOG.md)) already enforces. No keystrokes, no
  clipboard contents, no value contents — only structural facts.
- **Never produces numbers.** All numerical content in the PDD (durations,
  counts, € savings) is templated in from measured quantities. The LLM
  produces the prose that surrounds them. This is the single most important
  rule in this spec — hallucinated ROI ends the product.
- **Confidence + provenance on every output.** Each name carries a
  confidence score and the list of input cues that drove it; the Cockpit
  shows both, the consultant can drill in.
- **Refuses to name when input confidence is below threshold.** Returns
  `"insufficient signal"` with an explanation. Capture-confidence
  ([ADR-0023](adr/0023-recorder-capture-confidence.md)) feeds this directly.
- **Always editable.** Every AI label is a suggestion in the
  `auto_*` namespace ([ADR-0017](adr/0017-suggested-markers.md) pattern).
  Consultant accepts, edits, or rejects. Manual overrides survive
  re-normalisation.

**How it ships:**
- New module: `normalization/naming/` with `llm_client.py`, `activity_namer.py`,
  `pdd_prose.py`, `interview_questions.py`.
- Default backend: **Ollama** (`http://localhost:11434`) with `llama3.1:8b-instruct`
  or `qwen2.5:14b-instruct` — selected by the consultant in app settings, not
  bundled. If Ollama is not reachable, the layer degrades to *"no naming"* —
  the structural outputs of the Pattern Layer still display, the cockpit
  shows `cluster_4_in_servicenow` instead of `"Review incident"`. The pattern
  layer's value is preserved even when the LLM is off.
- Optional cloud backend (Anthropic / OpenAI / Azure-OpenAI) **disabled by
  default**, behind an explicit "I understand this sends derived structures
  off-machine" consent gate. The buyer who wants higher quality opts in;
  the buyer who picks PDT for the no-cloud story is unaffected.
- New ADR: **ADR-0028 — AI naming layer (local-first, structured-input-only,
  no-numbers-from-LLM).** This is the strategic shift from the prior
  "no LLM in product" stance, recorded with the reasoning explicit.

### 3.3 Interview Layer — **heuristic-templated** worker self-annotation

**Purpose:** replace the freeform analyst-annotation step with a guided
worker-annotation step. Workers cannot annotate freeform; they can answer
pointed questions. **Templates with observed-value substitution generate the
pointed questions** — the LLM was decoration here, dropped to save
implementation cost without losing the wizard's value.

**Cost: ~0.5 cycle for the wizard UX + the template library, vs. ~1 cycle
if LLM-generated.**

**Trigger:** at the end of a capture, before the session is closed and sent.
The capture tray pops the **Self-Annotation Wizard**:

```
┌─ PDT — Wrap up your session ───────────────────────────────┐
│                                                             │
│ We recorded 4h 12m. Five quick questions, then you're done. │
│                                                             │
│ 1 / 5  Between 10:23 and 10:47 you switched between Excel  │
│        and ServiceNow 12 times. What were you working on?  │
│        ────────────────────────────────────────────         │
│        [    text input — ~1 line                       ]    │
│                                                             │
│   ☐ This was an exception or rework, not the normal flow.  │
│                                                             │
│        [ Skip ]                          [ Next  → ]        │
└─────────────────────────────────────────────────────────────┘
```

**Question generation rules:**
- 5 questions max per session, 30 seconds each target → 2.5 minutes total.
- Generated from a **fixed template library** keyed by detected pattern type
  (longest segment, top activity cluster, anomaly, ambiguous case boundary,
  high-frequency motif). Each template has 3–5 phrasing variants for
  freshness; the wizard picks one per question.
- Templates always reference *what was observed* ("you switched 12 times"),
  never *what you might have been doing* (don't lead the witness).
- One yes/no exception flag per question to capture rework cheaply.
- Skippable, but the wizard tracks completion rate — the Cockpit shows the
  consultant how much of the session was self-annotated.
- **Upgrade path:** if Phase 4 (LLM Naming Layer) lands well, a future
  cycle can swap templates for LLM-generated questions where templates
  underperform — but only after the deterministic version ships and we see
  where it falls short.

**Output:** appended to `annotations.json` as `self_annotations[]` —
authoritative for case-boundary confirmation, activity naming (overrides AI
suggestion when present), and exception detection. Marked
`manually_authored: true` so re-normalisation preserves them.

## 4. The Cockpit — viewer redesign

### 4.1 The current viewer's structural problem

Today's viewer has five top-level tabs (Flow / Steps / Map / Analysis /
Compare), a notation × level matrix, the view-time grain slider, Reference
Maps, anchor and marker suggestions. This is an **analyst's instrument
panel**. It is the right instrument panel for an analyst. There are no
analysts.

A consultant arriving at a session wants three things in order:
1. **What did the system find?** (AI summary, top processes, headline numbers)
2. **Is it right?** (drill into specific findings to verify)
3. **Export and move on.** (PDD, backlog entry, slide-ready card)

### 4.1.1 Three contextual defaults of one app

Not five separate UIs — three contextual defaults that share state, routing,
and most components:

- **Glance** — single-column timeline-as-story view; AI labels overlaid on
  the recorded events; one-click corrections. The default a worker lands on
  immediately after their session normalises. Reuses the existing timeline
  subsystem ([architecture/VIEWER-TIMELINE.md](architecture/VIEWER-TIMELINE.md))
  with an AI-label overlay layer and an inline edit affordance.
  **Cost: ~0.5 cycle.**
- **Cockpit** — the summary-first review surface described in §4.2. The
  default a consultant or client champion lands on when opening an
  Engagement. **Cost: ~1 cycle (the main net-new UI).**
- **Workshop** — the existing five-tab depth, *rehomed* behind a Depth
  toggle but otherwise unchanged. The default for whoever explicitly opts
  into "I want to slice and dice." **Cost: ~0.5 cycle (reorganisation,
  not rebuild).**

**Mode inference:** the tool defaults Glance for a session ≤24h old that the
current user recorded; Cockpit for any other Engagement or Session view;
Workshop only when explicitly toggled. One click in the top bar overrides.
Mode is persisted per Engagement so a returning consultant picks up where
they left off.

A "Develop" drawer (RPA-bot scaffold export, selector dumps, timing
detail) is deferred — built on top of the process-detail view (§4.4) the
first time an actual RPA dev asks for it.

### 4.1.2 Glance — the worker's introspection view

```
┌─ PDT — Your session: 4h 12m ────────────────────────────────┐
│                                                             │
│  We labelled what we saw. Skim, fix anything wrong, done.   │
│                                                             │
│  09:00 ─────────────────────────────────────────── 13:12    │
│        │                                                    │
│  09:00 ▌ Reviewing incident INC0010842 ········ ✓ Looks right
│  09:08 ▌ Drafting reply in Outlook ············ ✎ edit     │
│  09:14 ▌ ⚠ Anomaly — long gap (8m)                          │
│         │  What were you doing?  [...........]              │
│  09:22 ▌ Updating spreadsheet "AP Tracker" ····  ✓          │
│  09:31 ▌ Switching between Excel and ServiceNow             │
│         │  (12 switches in 24m — automation candidate)      │
│  ...                                                        │
│                                                             │
│  When you're done: this session goes to the consultant.     │
│  [ Submit and close ]    [ Skip and close ]                 │
└─────────────────────────────────────────────────────────────┘
```

**Glance is the highest-leverage UI add in this spec**:
- It is the entry point for the largest user population (every recording
  worker).
- Disagreements captured here are the highest-quality training signal the
  Pattern Layer can get — a worker correcting "Reviewing incident" to
  "Triaging incident" produces a labelled example the Naming Layer can
  evaluate against and the next pattern-mining pass can constrain against.
- It is also the *introspection* feature that makes capture feel like
  agency, not surveillance. Workers see what was observed, can correct it,
  and choose to submit. This matters for adoption.

### 4.2 The new top-level structure

```
┌─ PDT ───────────────────────────────────────────────────────┐
│  ⌂ Engagement  ▸ Session   [ Cockpit | Depth ]    [ Export ]│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  COCKPIT                                                    │
│  ──────────────────────────────────────────────────────     │
│                                                             │
│  Headline                                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 4h 12m captured · 47 app switches · 8 retypes       │    │
│  │ AI identified 3 process candidates · 2.3h potential │    │
│  │ savings (band: 1.4h — 3.1h, conservative — high)    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Process candidates (AI)                  [confidence]      │
│  ├─ Review incident (ServiceNow)            ████░  0.78     │
│  ├─ Reconcile invoice (Excel + SAP)         ███░░  0.62     │
│  └─ Email triage (Outlook)                  ██░░░  0.41     │
│                                                             │
│  What stood out                                             │
│  ├─ INC0010842 appeared in 3 different windows — likely     │
│  │  manual data movement (automation candidate)             │
│  ├─ 23 min waiting on a screen load between 11:14 and 11:37 │
│  ├─ One 4-event sequence repeated 18 times (form retry?)    │
│  └─ Anomaly: case 7 differs substantially from cases 1-6    │
│                                                             │
│  Self-annotation         3 / 5 answered  [▶ continue review]│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Three principles:**
- **One column, top-to-bottom.** Read like a memo, not navigate like an app.
- **Each item is a verb.** Click a process candidate → process detail view.
  Click "what stood out" item → linked evidence in the session.
- **Every claim has a confidence + provenance pop-out.** Click the 0.78 →
  see the cues that produced it.

### 4.3 The Workshop toggle (formerly "Depth")

The existing five tabs and the notation × level matrix are not deleted. They
become **Workshop** mode behind a top-bar toggle. The consultant flips to
Workshop when they need to verify an AI claim, debug a misclassified case,
or hand a session to a peer who thinks in DFGs. This honours the existing
investment ([architecture/VIEWER.md](architecture/VIEWER.md),
[architecture/VIEWER-TIMELINE.md](architecture/VIEWER-TIMELINE.md))
without forcing anyone to start there.

**Default is Cockpit (or Glance for fresh-worker-recorded sessions).** A
new install opens whichever default the user's role + recent action infer.
Workshop is always one click away. The current default of "Flow tab open on
a 50-node DFG" goes away — that is the single biggest 30-minute
interest-collapse driver.

**Disagreement is a first-class verb everywhere.** Every AI-generated label
in Glance, Cockpit, and Workshop has a one-click reject / edit affordance.
Rejections are stored in the engagement's `annotations.json` as negative
examples. The next normalisation pass (triggered by Save) re-mines with
those constraints. No live retraining; just *"re-run the pipeline with
these labels treated as known-wrong."* **Cost: ~0.5 cycle on top of the
Pattern Layer.**

### 4.4 Process detail view

Click a process candidate in the Cockpit → a single-page process detail:

```
Review incident (ServiceNow)                  Confidence 0.78
────────────────────────────────────────────────────────────────
Seen in:  3 sessions · 14 cases · this session contributes 4
Variants: 3 (78% modal path)
Average duration: 6m 12s · range 2m 04s — 14m 47s
Automation candidates: 2 · estimated savings band 8–14h / month

Modal path                          (live BPMN preview, simplified)
  ◯ Open incident  →  ◯ Read description  →  ◯ Check assignment
    →  ◯ Add comment  →  ◯ Update state  →  ◯ Submit

Why we named this "Review incident"  [show provenance]
  • Window title pattern: "Incident — *"
  • Control "Description (read-only)" touched in 12/14 cases
  • Recognised ServiceNow app vocabulary
  • Worker self-annotation 2/3: "reviewing incoming incidents"

Edit name  |  Reject suggestion  |  Promote to backlog
PDD preview  |  Variants  |  Linked evidence  |  Export
```

This view is the *unit of consultant review*: one process, one screen, all
the evidence, all the actions. From here the consultant promotes it to the
**Engagement Process Backlog**.

## 5. The Engagement workspace

### 5.1 What an Engagement is

A new top-level concept above the session. An Engagement represents one
consulting deliverable — typically *"one client, one functional area,
N captured sessions over weeks W1–W4"*.

```
engagements/
  acme-finance-2026-q3/
    engagement.json              ← metadata, owner, dates, scope
    sessions/                    ← symlinks or copies of session folders
      2026-06-04-alice-ap.../
      2026-06-05-bob-ap.../
      ...
    backlog.json                 ← the Process Backlog (deliverable artefact)
    processes/                   ← one folder per identified process
      review-incident/
        pdd.md                   ← polished PDD for this process
        evidence.json            ← which sessions/cases support which claims
        thumbnail.png            ← BPMN snapshot for slides
    deliverables/
      backlog.xlsx               ← exported backlog
      pdd-bundle.pdf             ← assembled multi-PDD document
      slide-cards/               ← one PNG per insight card
```

### 5.2 Cross-session work the engagement enables

- **Cross-session activity clustering.** "Review incident" detected across
  sessions from Alice, Bob, and Carol becomes one Engagement-level activity.
- **Variant analysis.** With ≥3 cases of the same process, variant counts
  are meaningful. Below 3, they are noise — and the Cockpit refuses to
  display variant percentages, surfacing instead *"only 2 cases observed;
  variant analysis suppressed."*
- **Aggregate ROI.** Per-process automation savings projected from
  per-session candidates. Always with the conservative–optimistic band
  ([ADR-0016](adr/0016-segment-level-automation-candidacy.md)), always
  derived from measured durations, never from LLM output.
- **Backlog ranking.** Processes ranked by (frequency × time × confidence).
  Low-confidence processes are visible but ranked below; the consultant
  decides whether to push them up after review.

### 5.3 Cockpit at engagement level

The same Cockpit pattern as for a session, one level up:

```
ACME · Finance · Q3 2026                       [ Cockpit | Depth ]
─────────────────────────────────────────────────────────────────
12 sessions captured (Alice, Bob, Carol — 4 sessions each)
38h 17m total · 11 processes identified · 5 promoted to backlog
Estimated annual savings band: €92k — €218k (conservative — high)

Backlog (5)                          Effort | Savings/yr | Conf
├─ Review incident (ServiceNow)      ●○○○○  | €42k–€84k  | 0.78
├─ Reconcile invoice (Excel + SAP)   ●●○○○  | €28k–€71k  | 0.71
├─ Email triage (Outlook)            ●○○○○  | €14k–€34k  | 0.55
├─ ...
└─ ...

Candidate processes — review needed (6)
├─ ...

[ Export backlog ]  [ Export PDD bundle ]  [ Demo mode ]
```

## 6. Deliverables — what we hand to the client

The deliverables are the **product**. Their shape is what the buyer is
actually buying. **Five deliverables** — four content artefacts produced
from the engagement, and the configured tool itself as the leave-behind:

### 6.1 Process Backlog (XLSX + PDF)

A ranked spreadsheet, one row per identified process. Columns:

| Process | Description | Frequency / mo | Avg duration | Automation effort | Savings band / yr | Confidence | Status |
|---|---|---|---|---|---|---|---|
| Review incident | ... | 240 | 6m 12s | Low (1 dev-week) | €42k — €84k | 0.78 | Promoted |
| ... | | | | | | | |

This is the **board-ready artefact**. Most clients will engage with this
spreadsheet and not the PDDs. It must be excellent: clean column choice,
defensible confidence numbers, savings bands not point estimates.

### 6.2 Process Discovery Document (PDD) — one per promoted process

A 4–8 page document per process. Structure (each section short, dense,
visual):

1. **Process at a glance** — one paragraph + one BPMN thumbnail + headline
   numbers (frequency, avg duration, savings band).
2. **What we observed** — modal path + variant tree + screenshots from
   evidence sessions (auto-extracted, sensitive-content masked).
3. **Where the time goes** — duration breakdown by step, waiting time
   highlighted.
4. **Automation candidates** — the segment-grain candidates ranked, with
   measured cycle times and the conservative–optimistic band.
5. **Recommended next steps** — the prose section the LLM drafts;
   templated structure, LLM fills with measured-input narrative; consultant
   reviews/edits.
6. **Evidence index** — which session / case supports each claim. Internal,
   delivered for auditability.

### 6.3 Insight Card (PNG, one per insight)

A single-image deliverable for inline slide use. One claim, one chart, one
sentence. Generated from any Cockpit "what stood out" item with one click.
This is the artefact the consultant drops into their own decks during the
sales conversation.

### 6.4 Demo Pack

Pre-canned polished Engagement that ships with the installer. Opens via
**Demo mode** in the engagement Cockpit. **Ships with one excellent
engagement; more added after the first proves the format.**

The launch engagement: *IT Service — incident handling* (ServiceNow). Chosen
because the App Vocabulary for ServiceNow is already the strongest in repo
([§11d](../CHANGELOG.md)), so the demo's named activities will look most
credible. Contains: the engagement Cockpit populated, a 5-row backlog, two
finished PDDs (Review incident, Reassign incident), three insight cards.
**The Demo Pack is what a prospect sees first.** It is rebuilt every
release from real-but-anonymised pilot data, not synthesised, so its
content is defensible — and committed under `sessions/demo-pack/` the way
`sessions/example-aggregate/` already is.

Three demos was the original plan; one polished demo lands harder than
three mediocre ones at half the cost. Finance and HR demos ship in a later
cycle, once the format is validated.

### 6.5 The configured tool itself (the leave-behind)

When a buyer takes the engagement-plus-retained-tool deal, the deliverable
extends to include the **configured PDT installation**: the engagement
template with all calibrated thresholds, the App Vocabularies the
consultant authored or extended, the Reference Maps committed, the PDD
templates tuned to the buyer's deliverable voice, the contextual-help
content the consultant left as inline annotations.

**Implementation:** a configuration export bundle (`engagement-config.zip`)
that an Operate-mode user imports into a fresh PDT install on their machine.
**Cost: ~0.5 cycle** for the export/import path. The bundle is also useful
internally — the consultant uses it to clone their own setup across
engagements without re-authoring vocabularies.

The deeper Operate-path features — first-30-minutes onboarding flow,
full contextual-help content, in-app training corpus — are **deferred to
the first deal that actually wants retention.** What ships in v1.0 is the
*hooks*: a `helpContext` slot wherever an AI artefact renders, a config
export/import path, the Demo Pack engagements that double as training
corpus. The content populating those hooks comes later, paid for by the
first retention deal.

## 7. Architecture impact

### 7.1 New modules (additive)

| Path | Purpose |
|---|---|
| `normalization/patterns/motif_mining.py` | Sequence motif discovery |
| `normalization/patterns/clustering.py` | Activity clustering |
| `normalization/patterns/anomaly.py` | Anomaly detection |
| `normalization/patterns/case_inference.py` | Marker-free case-boundary inference |
| `normalization/naming/llm_client.py` | Ollama / cloud backend, common interface |
| `normalization/naming/activity_namer.py` | Activity / screen / phase naming |
| `normalization/naming/pdd_prose.py` | PDD section drafting (no numbers) |
| `normalization/naming/interview_questions.py` | Self-annotation question generation |
| `normalization/engagement/` | Engagement aggregation, cross-session linkage |
| `capture/self-annotation/` | Post-capture wizard (Electron renderer) |
| `viewer/cockpit/` | The Cockpit view (session + engagement) |
| `viewer/process-detail/` | Per-process detail view |
| `viewer/engagement/` | Engagement workspace UI |
| `viewer/deliverables/` | Backlog / PDD / insight-card exporters |

### 7.2 Existing modules affected

| Path | Change |
|---|---|
| `normalization/normalize.py` | Add `--with-patterns`, `--with-naming` flags. Default off until the consultant opts in per engagement. |
| `normalization/pipeline_stages.py` | New stages `pattern_layer`, `naming_layer` slotted after `segment_assembly`. |
| `normalization/analysis_roi.py` | Inputs now come from pattern-layer candidates, not direct heuristic detection. Confidence threshold drops candidates below 0.5 from the visible band. |
| `viewer/state/` | New top-level concept: `currentEngagement`. Routing supports `engagement` and `session` scopes. |
| `viewer/render/` | Cockpit becomes the default route. The five-tab DepthView is a sibling component lazy-loaded on toggle. |
| `viewer/process-map-levels.js` | Unchanged — feeds the Depth view, still used by the cockpit's modal-path thumbnail. |
| `shared/SCHEMA.md` | New sections: `patterns/`, `naming/`, `self_annotations[]`, engagement-level files. Strictly additive. |

### 7.3 ADRs needed

| ADR | Decision |
|---|---|
| **ADR-0028** | AI naming layer — local-first, structured-input-only, no-numbers-from-LLM. Records the shift from the prior no-LLM stance. |
| **ADR-0029** | Pattern layer — classical ML + sequence mining as a normalisation stage. |
| **ADR-0030** | Engagement workspace — the new top-level concept. |
| **ADR-0031** | Cockpit as default view + Depth toggle for the analyst surface. |
| **ADR-0032** | Worker self-annotation as the analyst-replacement input. |
| **ADR-0033** | Demo Pack as a shipped artefact, rebuilt from anonymised pilot data each release. |

Each is small in isolation; together they describe the rebalance.

### 7.4 Guard updates ([CHIP-GUARDRAILS.md](CHIP-GUARDRAILS.md))

New invariants the e2e gate and golden check should pin:

- **LLM never sees raw fields.** A guard greps the naming-layer inputs for
  any reference to raw `events.jsonl` fields outside the approved derived
  set; fail-loud on regression.
- **No LLM-produced numbers in deliverables.** A guard parses generated PDD
  prose and fails if it contains numerical tokens not present in the
  templated number set.
- **Confidence floor on visible band.** A guard verifies that candidates
  below the configured confidence threshold do not appear in the public
  backlog.
- **Cockpit-first default.** An e2e check that a fresh install opens the
  Cockpit, not the DFG tab.
- **Cluster-count sanity.** A guard verifies the Pattern Layer's variant
  suppression: ≤2 cases means no displayed variant percentages.

## 8. Phased rollout

Six phases, **~6.5 cycles total**, sequenced so consultant-defensible value
lands by cycle 2.5 with no AI dependency. Each phase ships an honest product
on its own.

### Phase 0 — Cockpit + Engagement data model on current data (~1.5 cycles)

**Risk:** low — no AI dependency.

Build the Cockpit view and the Engagement data model *on top of the existing
data*. Headline numbers, process candidates derived from existing heuristic
segments, "what stood out" items from existing detectors (suggested markers,
anchor candidates, segment ROI). The Workshop toggle rehomes the existing
five-tab UI.

**€-ROI honesty pass lands here** ([ADR-0016](adr/0016-segment-level-automation-candidacy.md)
update): candidates below the confidence floor are excluded from the public
band; the visible band derives only from measured quantities; provenance
clickable on every number. This ships regardless of whether the rest of the
phases land.

**Why first:** validates the layout, the consultant flow, and the
deliverable exports against real data before AI is added. If the rest of
the spec never ships, Phase 0 alone is a strict improvement over v0.22.x.

### Phase 1 — Engagement Cockpit + Backlog export + Demo Pack v1 (~1 cycle)

**Risk:** low.

The engagement-level Cockpit (§5.3), Process Backlog export to XLSX and PDF,
PDD bundle export. **One polished Demo Pack engagement** (ServiceNow IT
Service — chosen because the App Vocabulary is strongest there). Hosted
PDD samples for the landing-page pitch.

**Why second:** this is where consultant-facing value lands without AI. A
multi-session Process Backlog is something PDT cannot produce today. The
prospect-funnel artefact (Demo Pack) ships here.

**Cumulative cost: 2.5 cycles.** At this point the spec has delivered:
Cockpit + Engagement + Backlog + one Demo Pack engagement + €-ROI honesty.
**The consultant can run a real engagement and produce real deliverables
without any of the AI layers.** This is the spec's de-risking checkpoint.

### Phase 2 — Pattern Layer + disagreement-as-feedback loop (~1.5 cycles)

**Risk:** medium — new normalisation stage, calibration loops against demo
data.

Add `normalization/patterns/`: motif mining, activity clustering, anomaly
detection, marker-free case inference. Activity clusters replace the
"each window is its own step" assumption. Variant detection becomes
defensible. Cross-session linkage works.

**Disagreement-as-feedback loop ships here:** every AI-surfaced label
(currently still using cluster IDs, not LLM names) gets a one-click reject /
edit in Glance, Cockpit, and Workshop. Rejections store as negative examples;
the next normalisation pass uses them as constraints. No live retraining.

### Phase 3 — Glance mode + heuristic-templated self-annotation wizard (~1 cycle)

**Risk:** medium — capture-side UX + timeline view extension.

Build the Glance default and the post-capture wizard. **Both use
deterministic templates with observed-value substitution** — no LLM
dependency. Wizard ships with the template library described in §3.3.

**Why before LLM Naming:** Glance + wizard generate human-corrected labels
and confirmed case boundaries that improve the Pattern Layer's outputs and
give us labelled examples to evaluate the Naming Layer against when it
ships. Building Naming against curated data is much lower-risk than
building it blind.

### Phase 4 — Scoped Naming Layer (local LLM, two uses) (~1 cycle)

**Risk:** medium — heavy work but bounded by scope.

Add `normalization/naming/` with **exactly two LLM uses** (§3.2): activity
naming and PDD executive-summary prose. Ollama default backend. Capture-
confidence gating; provenance pop-out; no-numbers enforcement.
[ADR-0028](adr/0028-ai-naming-layer.md) records the strategic shift from
the prior no-LLM stance.

If this phase slips or underperforms, Phases 0–3 already ship a defensible
product; the Cockpit displays cluster names + template-filled prose instead
of LLM-named activities + LLM-written exec summary. The visible quality
degrades; the integrity story doesn't.

### Phase 5 — Operate-path hooks (~0.5 cycle)

**Risk:** low.

Configuration export/import bundle (§6.5). Help-context slots wired
wherever AI artefacts render — content stubs only, populated later by the
first retention deal. Mode-inference logic finalised so a client champion
opening PDT lands on Cockpit by default, not Workshop.

**Why last:** all the load-bearing hooks are cheap to add once the
Cockpit and Engagement are stable. The polish (full contextual help, the
first-30-minutes onboarding flow, additional Demo Pack engagements) is
deferred until a real retention deal funds it.

### Cumulative summary

| Phase | Adds | Cycles | Cumulative |
|---|---|---|---|
| 0 | Cockpit, Engagement data model, €-ROI honesty | 1.5 | 1.5 |
| 1 | Engagement Cockpit, Backlog export, Demo Pack v1 | 1.0 | 2.5 |
| 2 | Pattern Layer, disagreement-feedback loop | 1.5 | 4.0 |
| 3 | Glance, self-annotation wizard | 1.0 | 5.0 |
| 4 | Scoped Naming Layer (LLM) | 1.0 | 6.0 |
| 5 | Operate-path hooks | 0.5 | 6.5 |

**De-risking checkpoint at 2.5 cycles** (after Phase 1): full consultant
flow, no AI. **AI value lands at 6 cycles** (after Phase 4). **Total
committed work: 6.5 cycles.**

## 9. Integrity backbone — what does NOT change

These are the load-bearing values from the v0.x lineage. AI/ML and the
Cockpit do not modify any of them:

- **Raw immutable, analysis side-car.** `events.jsonl` is still append-only.
  All new outputs are additive in `annotations.json` and new derived blobs.
- **Suggest-don't-mutate.** Every AI output is an `auto_*` proposal.
  Manual overrides survive re-normalisation. ([ADR-0017](adr/0017-suggested-markers.md))
- **No-cloud by default.** Local LLM by default. Cloud LLM behind an
  explicit consent gate. Raw events never leave the machine in either case.
- **Capture-confidence is load-bearing.** Low input confidence → LLM refuses
  to name → Cockpit shows "insufficient signal" rather than confabulating.
  ([ADR-0023](adr/0023-recorder-capture-confidence.md))
- **Numbers from measurement, never from LLM.** Every numerical claim in
  every deliverable traces to a measured quantity.
- **Coherence discipline.** Every new verb gets its inverse, its legend, a
  control-interaction check, and a real-run check.
  ([architecture/COHERENCE-AUDIT.md](architecture/COHERENCE-AUDIT.md))
- **No bundler, CommonJS, `node:test`, `pytest`.** The build story doesn't
  change.
- **ship-unsigned, services-boutique scope.** ([ADR-0026](adr/0026-distribution-unsigned-and-services-boutique-scope.md))

## 10. Success criteria — how we know this lands

In rough order of importance:

1. **The 30-minute prospect test.** A skeptical prospect, with no
   onboarding, opens the Demo Pack and within 30 minutes says *"can we
   try this on one of our processes."* This is the door-opener test from
   the strategic pass.
2. **The consultant throughput test.** From "Engagement folder created"
   to "client-ready Process Backlog + 2 PDDs" in **under one working day**,
   for a 4-session engagement. Today this is "several days plus owner
   bandwidth."
3. **The honesty test.** The €-ROI band in deliverables is defensible
   against a skeptical CFO asking "where does that number come from." Every
   number traces to a measurement; every confidence has provenance.
4. **The "could a manager do this" test.** A client manager (not an
   analyst) opens the Cockpit on their own engagement and can identify the
   top three automation candidates without consultant hand-holding. This is
   the long-term productisation test — likely only reachable after Phase 2.
5. **The integrity test.** No regression on the existing guards.
   Specifically: no LLM output reaches a deliverable through a path that
   bypasses the no-numbers rule. The session golden still passes on all 10
   demo sessions plus the new Demo Pack engagements.

## 11. Open questions

Things this spec deliberately does not decide. Each is a call for the owner.

- **Local LLM ceiling for the executive-summary prose.** A 7–14B local
  model handles activity naming well (short, structured output). The
  executive-summary paragraph is harder — local quality may be uneven. If
  the first real engagement shows this, the cloud-opt-in backend path
  (already in §3.2 as deferred) gets unblocked. Until then, accept the
  ceiling.
- **Multi-worker capture coordination.** An engagement spans many workers'
  sessions. Today there is no mechanism to coordinate "everyone capture the
  AP invoice process this week." Out-of-band coordination is the v1.0
  answer; a coordination surface inside PDT is deferred.
- **Process naming carry-over across engagements.** When the consultant
  names a process ("Review incident") and PDT later sees the same pattern
  at a different client, should the name carry over? **v1.0 answer:
  per-client isolation, no carry-over.** Cross-client pattern sharing is
  a bigger play and a bigger sale; revisit after first three engagements.
- **Pricing model.** Engagement-priced, seat-priced, perpetual, or
  hybrid? Out of scope for this spec; the §6.5 retention path supports
  any of them.
- **The "Reference Map" interaction with AI-identified processes.**
  Reference Maps ([ADR-0019](adr/0019-reference-maps.md)) are
  consultant-authored snapshots. When the Pattern Layer surfaces a process
  the consultant already has a Reference Map for, the Cockpit should link
  them — rule for linkage (name match? structural match? both?) defers to
  Phase 2 when the Pattern Layer's actual output shape is known.
- **Skipped self-annotation behaviour.** v1.0 answer: graceful — the
  Pattern Layer proceeds without that signal, confidence is lower, the
  Cockpit shows the gap. The "session held in `needs_annotation` state"
  alternative is rejected because it punishes the worker for honest
  unwillingness and reduces capture volume.

### Decisions taken in this revision (no longer open)

- **One business model, not two.** Consultant-led delivery with the
  configured tool as a natural leave-behind. The pitch flexes per deal;
  the architecture does not.
- **Three contextual defaults, not five separate UIs.** Glance, Cockpit,
  Workshop. Develop drawer and full Operate UX deferred.
- **Scoped Naming Layer.** Two LLM uses only (activity naming +
  executive-summary prose). Screen names, phase names, PDD §2–§5 prose,
  and self-annotation questions are deterministic templates.
- **One polished Demo Pack engagement at launch**, not three.
- **Disagreement-as-feedback architecture** committed (one-click reject
  anywhere; constraints fed to next normalisation pass; no live retraining).
- **Operate-path hooks committed, polish deferred.** Configuration
  export/import in v1.0; in-app onboarding flow waits for the first
  retention deal.

---

## Appendix A — example consultant workflow under PDT 1.0

This is the workflow this spec is designed to enable. Hour-by-hour, end to end.

**Monday 09:00 — Engagement kickoff.** Consultant creates Engagement
*"ACME Finance Q3"*. Picks 3 workers (Alice, Bob, Carol). Sends each the
capture installer with a one-line goal: "record yourself doing your normal
AP invoice work this week."

**Monday–Friday — Workers capture.** Each runs 2–4 sessions during normal
work. At end of each session the Self-Annotation Wizard asks 5 questions;
they answer 4 on average. Total: ~10 sessions, ~40 hours of capture, ~30
self-annotation prompts.

**Monday following — Consultant opens engagement.** All sessions present,
normalised, pattern-mined, named overnight. Engagement Cockpit shows:
*11 processes identified, 5 high-confidence, 6 needing review.*

**09:00–12:00 — Review high-confidence candidates.** Consultant clicks
through 5 process detail views. Edits two names (LLM proposed
"reconcile invoice", consultant changes to "match invoice to PO"). Rejects
one (LLM clustered two distinct processes; consultant splits them in
Depth view). Promotes 5 to the backlog.

**13:00–16:00 — Review candidates.** Six more processes, lower
confidence. Consultant promotes 3, rejects 2, defers 1 pending more
captures from Bob.

**16:00–17:00 — Export deliverables.** Backlog → XLSX. PDD bundle → PDF
(LLM-drafted prose, consultant skim-edited inline in the Cockpit during
review). Three Insight Cards → PNGs for next morning's client deck.

**Tuesday — Client meeting.** Consultant presents the backlog spreadsheet,
opens two PDDs, drops the three insight cards into the deck. Client signs
off on top 3 for automation pilot.

Today, that same workflow would take **two-to-three weeks of owner time**.
That is the productisation gap this spec exists to close.

---

## Appendix B — what this spec deliberately does NOT do

- Does not build a multi-tenant cloud version. ([ADR-0026](adr/0026-distribution-unsigned-and-services-boutique-scope.md))
- Does not introduce a database. Files-on-disk continues; engagements are
  directories.
- Does not introduce a bundler or TypeScript. CommonJS, plain Electron,
  bundled Python.
- Does not centralise pattern training across clients. Each engagement
  trains in isolation; cross-client pattern sharing is a deferred decision.
- Does not retire any of the v0.20.x discipline work — the e2e gate, the
  session golden, the ADR registry, the coherence audit. All of it
  continues; new artefacts get the same treatment.
- Does not assume the LLM is reliable enough to skip consultant review.
  Every AI output is a suggestion. The consultant is always in the loop.

---

*End of spec. Next move on approval: cut ADR-0028 to record the AI-layer
shift, then start Phase 0 (Cockpit on current data).*
