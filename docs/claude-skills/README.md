# Claude skills pack: the compiled judgment of this repo's sessions

> **MOVED (2026-07-03) — this copy is a dated snapshot; do not edit it.**
> The live, canonical pack is **`~/.claude/skills/`** (user-global, its own
> git repo) — it loads automatically in EVERY project on this machine, this
> one included. Enhance skills THERE and commit there; this snapshot exists
> only as the record of the 2026-07-03 consolidation that seeded it. Raw
> findings still land per-repo in `.claude/agent-findings/`.

Durable operating knowledge for whoever works this repo next (any
model, any session), distilled from postmortemed delegation cycles,
the owner's recorded corrections, and this machine's documented
traps. Four layers:

- CORE: read first, every session; the reasoning the rest compiles.
- OPERATOR: binds the main session driving the repo with the owner.
- ORCHESTRATOR: read by the coordinating session when delegating.
- DOJO: agent-facing counter-skills, attached per delegation via the
  brief's read-first list (or installed globally so they trigger on
  their own descriptions).

Install: copy each folder into .claude/skills/ (project) or
~/.claude/skills/ (global). The filename SKILL.md inside each folder
is mandatory; the folder name is the skill's identity. The pack is
also readable in place from docs/claude-skills/; the owner decides
what goes live in .claude/skills/.

## Core

- operating-core: what generates every other rule. The one failure
  under all failures, the three disciplines, the trust ledger, the
  order of authority when rules conflict, economy of motion. When a
  situation matches no rule, decide from this.
- design-judgment: value is consequence, not truth. The use gate and
  its corollaries, the four forces of saturation, the critique method
  (ground in the artifact, name the inversion, decide don't park, own
  your share), building without re-saturating. Read before critiquing,
  planning, or adding any resident surface.

## Operator layer

- owner-contract: the standing terms with this owner, verbatim where
  it matters: silence by default, the action ledger (commit / build
  / docs / deletion all need current-turn words), commit and release
  mechanics, cycle-session conduct, what his bug reports outrank.
- windows-environment: the documented ways this machine lies: MSIX
  shadow reads of %APPDATA%, the vitest full-suite reporter hang,
  PowerShell 5.1 quirks, poll-loop bans, the desktop tracker's
  deploy-in-place reality.
- continuity: session start and end hygiene, the findings-first
  lesson flow, memory discipline, and the maintenance protocol for
  this pack itself.
- motif-voice: product conscience for anything a Motif user reads:
  serve the state, never label the person; gate tools, not truths;
  plain words; the mechanics that are also tests.

## Orchestrator layer

- subagent-briefing: the delegation lifecycle. Brief writing, model
  selection and sequencing (sonnet/opus/haiku), git modes, completion
  checks, supervisor review, risk ledger, the feed-the-log-forward
  loop. Includes BRIEF-TEMPLATE.md, EXAMPLE-BRIEF.md (polish pass,
  coordinator-commits) and EXAMPLE-BRIEF-R3.md (feature phase,
  agent-commits, probe gate). Evidence: the C1-C9 catalog, the v1.4.0
  disclosure-pass postmortem, and the 2026-07-03 R-cycle register.
- delegation-postmortem: run after every cycle; produces the case
  register whose rules feed the findings files and, through
  consolidation, this pack.

## Dojo layer (agent-facing counter-skills)

| Skill | Counters | Hits hardest on |
|---|---|---|
| verified-completion | premature "done", confidence-padded reports, memory-as-evidence | sonnet |
| debugging-discipline | shotgun edits, thrashing, silent stalls, pattern-matched wrong fixes | sonnet |
| no-silent-failures | swallowed errors, masking fallbacks, silent skips, guessed selectors | sonnet |
| grounded-claims | invented APIs, stale memory of files/values, long-context instruction decay | sonnet |
| scope-discipline | "while I'm here" drift, diff bloat, half-removals, unrequested abstractions | both (overbuild guard hits opus hardest) |
| test-integrity | weakened assertions, unread snapshot regens, cardinality-1 fixtures, dishonest coverage | both |
| seam-checking | interaction-pair bugs, unread render sites, half-migrations, cross-file invariant breaks | opus |

## Default attachment per delegation

State the attachments in the brief's read-first list, e.g. "Read
these skills before anything else:
.claude/skills/verified-completion/SKILL.md, ...". Defaults:

- **sonnet, mechanical/polish work:** verified-completion,
  scope-discipline, no-silent-failures, grounded-claims. Add
  test-integrity when any test file is in the lane.
- **opus, architectural/seam work:** seam-checking, scope-discipline,
  test-integrity, verified-completion.
- **haiku, dictated-structure docs/transcription:** no dojo attachments
  — put the exact text to emit in the brief instead (haiku echoes
  descriptions rather than interpreting them; R-cycle RH1/RH2). Verify
  encoding after any commit it makes.
- **any bug-fix task, either model:** add debugging-discipline.
- **any lane adding a resident surface/module/metric:** add
  design-judgment.
- **any lane touching tests or files outside the repo:** restate the
  relevant windows-environment lines in the brief.
- Keep attachments to 4-5 per brief. Attaching everything dilutes
  everything; pick the skills matching the task's dominant risk.

## Why the dojo seven

Distilled from two postmortemed delegation cycles (case IDs C1-C9,
S1-S3, O1-O3, F1-F4; evidence in .claude/agent-findings/ and the
viewer repo's postmortem) plus the known failure clusters of each
model tier. The observed pattern that shaped the split: sonnet-class
failures cluster in process discipline and evidence handling (hence
four skills about evidence, scope, and grounding), opus-class
failures cluster in seams and letter-vs-intent satisfaction (hence
seam-checking, and intent-first briefing on the orchestrator side).

## Maintenance contract

Rules enter through two feeders, and only through them:

1. Delegation postmortems: agent failures land as raw catalogs in
   .claude/agent-findings/<date>_<topic>.md (delegation-postmortem).
2. Owner corrections: recorded as memory files the same session
   (continuity).

Neither becomes a skill mid-session; one session is an anecdote.
Dedicated consolidation sessions, owner-invoked, mine everything
since the last pass and land each rule in exactly one skill, in the
matching section, with its case or correction attached. When a dojo
skill grows past roughly 120 lines, split it rather than letting it
blur; a skill that covers two risks triggers reliably on neither.
Volatile repo facts stay out of skills: name the source of truth and
grep it fresh.

Every rule carries a tier, and consolidation validates it: general
best practice; machine fact (dated, re-verifiable); owner standing
preference (his to retire); or incident guardrail. Incident
guardrails expire unless they recur or the owner confirms them as
standing, and any rule that contradicts normal engineering practice
needs the owner's explicit confirmation to stand. The retired
don't-branch rule (one 2026 incident, retired twice by the owner) is
what skipping this validation produces.

## Lineage

Each consolidation session appends one entry here: date, sources
mined, what changed. When enhancing this pack, read this section
first, then every findings file newer than the last entry. Enhance
existing skills before adding near-duplicates.

- 2026-07-02: first pack. Sources: the 2026-07 audit-cycle catalog
  (C1-C9, now at .claude/agent-findings/) and the v1.4.0
  disclosure-pass postmortem (S*, O*, F*). Result: the orchestrator
  layer (subagent-briefing + template + example,
  delegation-postmortem) and the seven dojo skills.
- 2026-07-03: consolidation session (Fable 5). Sources: the full
  owner-correction memory corpus (19 files), the 2026-07-02 findings
  catalog, docs/CODING_STANDARDS.md, and git history
  59b2f8c..50cf1e3. Result: added the core and operator layers
  (operating-core, owner-contract, windows-environment, continuity,
  motif-voice); enhanced subagent-briefing (parallel cap,
  findings-path fixes), delegation-postmortem
  (findings-first landing), debugging-discipline (dead ends,
  pre-existing triage, owner-reported failures), test-integrity
  (clock pinning, scenario validation), grounded-claims (instrument
  fallibility), seam-checking (referential identity),
  scope-discipline (artifact deletion). Same-day owner adjustment:
  the don't-branch rule retired to hygiene-only across the pack ("it
  was a one time thing"), and rule tiers added to the maintenance
  contract so incident guardrails cannot fossilize into law again.
  Next session: start here, then .claude/agent-findings/ for
  anything newer than this entry.
- 2026-07-03 (later, same day): consolidation session (Fable 5,
  owner-invoked), in the process-discovery-tracker repo. Sources: the
  R-cycle delegation register
  (.claude/agent-findings/2026-07-03_r-cycle-delegation.md — 7
  sequential agents, 3 sonnet / 3 opus / 1 haiku, phases R1–R5,
  agents committing), the PDT repo's history (CLAUDE.md,
  CHIP-GUARDRAILS, ADR-0009/0024/0027 lineage, the approachability
  critique + redesign), and the supervising session's own briefs.
  Result: NEW core skill design-judgment (the use gate, saturation
  forces, critique method) and NEW EXAMPLE-BRIEF-R3.md (feature-phase,
  agent-commits, probe gate); subagent-briefing gained the haiku tier,
  the two validated git modes (single-writer principle kept, the
  agents-never-commit letter retired — R-cycle evidence + owner
  direction), the feed-the-log-forward loop, calibration clauses
  33–39, and supervisor rules (per-phase verification cadence,
  accusation standard, shared-checkout concurrency);
  verified-completion gained skip-coverage counts, snapshot-first
  restoration proof, the derived-number absurdity check, and
  verification-scope disclosure; test-integrity gained
  acceptance-data-must-fail-like-production and
  twice-regressed-invariants-become-guards; debugging-discipline
  gained the tuning limit (model-mismatch vs knob); windows-environment
  gained the BOM/commit trap, shared-checkout concurrency, and the PDT
  repo section (two Pythons, demo regeneration, captures-stay-local).
  Tier validation done per the maintenance contract; no rule in this
  pass contradicts normal engineering practice. Next session: start
  here, then .claude/agent-findings/ (BOTH repos) for anything newer.
