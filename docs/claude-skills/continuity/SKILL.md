---
name: continuity
description: Use at session start to load the chain (memory, findings, active spec, hygiene sweep), immediately after any owner correction, at the end of any session that ran subagents, and before ending any session. Also use whenever tempted to build or edit a skill mid-session, whenever writing lessons learned, and whenever deciding where a new rule should live. This is the skill that makes the next session smarter than this one; skipping it is how lessons get re-bought at full price.
---

# Continuity: the chain of sessions and how it learns

You are temporary; the chain is not. It hands forward through five
stores, each with a distinct job:

- git history: what changed and why (commit messages carry intent).
- docs/: what the product is (specs, outcomes log, standards).
  Owner territory: never edited unasked (owner-contract).
- the per-project memory directory (outside the repo): owner
  corrections and project state the repo cannot record.
- .claude/agent-findings/: raw, dated failure catalogs from
  agent-running sessions.
- docs/claude-skills/ (this pack): the compiled judgment. Rules live
  here only after surviving consolidation.

## Session start

1. The memory index arrives automatically; treat entries as
   point-in-time claims, not live state. Verify a memory against the
   current repo before asserting it as fact; update or delete ones
   proven wrong, including their index lines.
2. If the work touches the active plan, read its spec and outcomes
   log fresh (currently docs/SPEC_COHERENCE_CYCLE.md and
   docs/CYCLE_OUTCOMES.md; grep rather than trusting this line to
   stay current).
3. Hygiene sweep: git status, git worktree list, git branch, looking
   for leftovers from prior sessions. Prune merged debris as
   ordinary housekeeping; ask only when removal would touch unmerged
   work (destructive). Leftovers are cleanup, not alarms.

## Lessons flow one way: findings first, skills later

The corrected-and-now-permanent process:

1. During any session that runs agents, log failures as they happen
   into .claude/agent-findings/<date>_<topic>.md: case, model, what
   happened, root cause, caught by, correction, candidate RULE.
   Include your own coordinator misses; a catalog that only polices
   agents is propaganda (delegation-postmortem).
2. Do NOT build or edit skills from one session's sample, however
   clear the lesson feels in the moment. This exact move was made on
   2026-07-02 and corrected the same day; the premature skill was
   demoted back to raw findings. One session is an anecdote; the
   pack encodes evidence.
3. A dedicated consolidation session, owner-invoked, later mines ALL
   findings since the last pass, plus new memories and git history,
   and lands each rule in exactly one skill with its case ID. It
   then appends itself to the pack README's lineage section.

Owner corrections are the exception to waiting: they become a memory
file the SAME session (update the existing file if one covers the
topic; fix the index line; never duplicate). A correction not
written down will be re-bought at full price, and re-buying
corrections is the single fastest way to lose this owner's trust.

## What deserves writing down

Not what the repo already records (code, git history, docs). Write
what only this session knows: environment surprises, the context
around a correction, why a decision went the way it did, anything a
future session would otherwise re-derive or re-suffer. Convert
relative dates to absolute. One file, one fact, linked to its
neighbors.

## Session end

- Background shells: none running.
- Worktrees and temporary branches: merged or removed, none stray.
- Instrumentation (boot hooks, debug prints, temp scripts):
  reverted, and temp scripts deleted.
- Uncommitted work: reported to the owner plainly (what exists and
  why), never silently abandoned.
- If agents ran: the findings file exists and is complete while the
  transcripts are still fresh; "caught by" and "root cause" become
  unreconstructable within days.

## Maintaining this pack (consolidation sessions only)

- Enhance the existing skill before adding a sibling; two skills
  covering one risk trigger reliably on neither (pack README).
- A dojo skill past roughly 120 lines splits.
- Every rule cites its case or correction. A rule without provenance
  is a smell, and a future session is entitled to demote it back to
  findings.
- Classify every rule by tier, and write it so the tier shows:
  (1) general best practice, (2) machine or environment fact (dated,
  re-verifiable), (3) owner standing preference (his to retire),
  (4) incident guardrail. Guardrails EXPIRE: they become standing
  only on recurrence or the owner's say-so. Validate every candidate
  rule against normal engineering practice before landing it; a rule
  that contradicts common practice needs the owner's explicit
  confirmation to stand. The retired don't-branch rule is the
  cautionary tale: a one-time correction fossilized into law and the
  owner had to retire it twice.
- Descriptions are the trigger surface: state WHEN to consult, in
  the second person, concretely enough that a cold model recognizes
  the moment. Err on the pushy side; skills undertrigger by default.
- Volatile repo facts (line numbers, handles, current spec names) do
  not belong in skills; name the source of truth and require a fresh
  grep. A wrong value enshrined in guidance re-arms itself forever
  (the F2 trap).
- Explain the why behind every rule; a future model obeys reasons
  more reliably than capital letters.
- Append the session to README lineage: date, sources mined, what
  changed. The next mind starts by reading that, then reads every
  findings file newer than the last lineage entry.
