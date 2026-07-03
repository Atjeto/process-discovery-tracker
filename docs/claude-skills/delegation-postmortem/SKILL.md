---
name: delegation-postmortem
description: Use after EVERY subagent delegation cycle (implementation, audit, review, or polish passes) to write the case-register postmortem, and whenever the user says postmortem, retro, lessons learned, case register, failure harvest, or "what went wrong with the agents". Also use proactively when a delegation cycle just finished and defects, near-misses, or supervisor corrections occurred. Output feeds new rules into the subagent-briefing skill; a cycle without a postmortem is a cycle whose lessons will be re-learned at full price.
---

# Delegation postmortem (case register)

The subagent-briefing skill exists because two cycles were postmortemed
in this exact format. This skill keeps the flywheel turning: every
delegation cycle ends with a case register, and every register lands its
rules somewhere durable.

## When to run

After any cycle where subagents implemented, audited, or reviewed work.
Run it while the transcripts are fresh; the register's value decays fast
because "caught by" and "root cause" become unreconstructable.

## Source material (gather before writing)

- The agents' final reports, verbatim.
- The supervisor's independent re-validation (re-run checks,
  screenshots, probes) and its raw outputs.
- The shipped commit(s) and the diff.
- The delegation briefs themselves (a brief defect is a root cause).
- Any owner corrections during or after release.

## Structure of the register

Open with the **honest headline first**: the invariant-level facts
stated plainly before the deviation list ("zero hard-invariant breaches,
zero gate failures; both agents ran the full gate and reported exact
counts"). This calibrates the reader: what follows is a polish list or a
disaster report, and the headline says which. Never bury a clean
headline under an exhaustive register, and never use a clean headline to
soften a genuine failure.

Then one case per finding, in this exact format:

    ### {ID} : {one-line title} : {status}
    What happened -> root cause -> caught by -> status -> RULE.

- **ID convention:** one letter per source (S = sonnet agent findings,
  O = opus agent findings, F = supervisor/process findings), numbered
  within the cycle. Keep IDs stable forever; the briefing skill cites
  them.
- **Status vocabulary:** shipped defect / self-caught / accepted /
  open / review error / near-miss / shipped debris.
- **The RULE is the deliverable.** State it as an instruction a future
  brief or reviewer can execute, not as a moral ("a summary may carry
  its own glyph only together with native-marker suppression", not
  "be more careful with markers").

## Coverage rules (what makes a register honest)

1. **Supervisor errors are mandatory findings**, including false
   accusations of correct agents. The register that only polices agents
   is propaganda; two of the most valuable v1.4.0 findings were F-class.
2. **Root-cause briefs, not just agents.** When an agent chose
   arbitrarily or satisfied the letter of a spec, ask first whether the
   brief under-specified (S3, O1). "Under-specified delegation prompt"
   is a valid and common root cause.
3. **Near-misses count.** Anything caught by the last-line guard
   (clean-tree check, gate) rather than by process was one guard away
   from shipping (F3). Register it.
4. **A "What worked" section is mandatory.** Name the behaviors to
   preserve (honest skips, self-catches, exact counts, sequencing
   choices) so good behavior gets encoded rather than regressed.
   Quality skips are successes; say so.
5. **Distinguish disclosure failures from detection failures.** "The
   agent disclosed the risk and nobody dispositioned it" (O3) is a
   supervision finding, not an agent finding. File it under F.

## Consolidation (the part that makes it worth writing)

Every RULE gets a named landing place, in the register itself:

1. **Guidance-doc fixes land in the SAME commit as the postmortem.**
   A wrong value enshrined in a doc traps every future agent (F2); the
   postmortem that documents it without fixing it has re-armed the trap.
2. **The register itself lands in .claude/agent-findings/** as a dated
   raw catalog (<date>_<topic>.md). Do not turn it into skills in the
   same session: one session's sample is an anecdote, and a prematurely
   promoted skill has already been demoted once (2026-07-02). A later
   dedicated consolidation session migrates each RULE into the matching
   skill section with its case ID attached (see the continuity skill).
   Rules that live only in the postmortem file still get re-learned, so
   the register must name its intended landing place per rule even
   while it waits.
3. **Shipped debris spawns a fix chip**: an explicit scoped work item
   listing each shipped defect, ready to be briefed with
   subagent-briefing's BRIEF-TEMPLATE.md.
4. **Open items get owners.** Any finding whose status is "open" appears
   in the fix chip or a tracked list; an open finding with no owner is
   O3 happening again, one level up.

Close the register with the consolidation table: rule -> where it now
lives (doc + section), so a later reader can verify the landing actually
happened.

## Anti-patterns

- Writing lessons as narrative prose instead of executable rules.
- Registering agent findings only (see coverage rule 1).
- Renumbering or reusing case IDs across cycles.
- Postponing the register "until after the release"; F3 was discovered
  DURING release prep precisely because someone was still looking.
- Letting the register grow rules that never land anywhere (see
  consolidation; the register is a routing document, not an archive).
