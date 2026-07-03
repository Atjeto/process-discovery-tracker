# Delegation brief template

Copy this skeleton verbatim and fill the {PLACEHOLDERS}. Delete a section
only if it genuinely does not apply, and say so in the coordinator notes.
Every clause maps to a documented failure or a zero-correction lane; the
case IDs are in SKILL.md.

---

## Role and mission

You are implementing {SCOPE_ONE_SENTENCE} in {REPO_PATH}. Work through the
items below in order. Your final message IS the deliverable; structure it
exactly as specified in "Report format" at the bottom.

Why this work matters: {ONE_SENTENCE_OF_INTENT_FOR_THE_WHOLE_PASS}.

## Environment (positive facts)

- {OS / SHELL RULE, e.g. "Windows; Bash with explicit cd for
  repo-relative commands, PowerShell only for Windows tooling"}
- {WHAT HAPPENS ON LAUNCH, e.g. "the viewer re-analyzes the committed
  session on load; use a temp copy"}
- Everything you need is installed. Do not install, update, or
  configure anything.

## Glossary (house terms the agent will meet)

- {TERM}: {TWO-LINE DEFINITION}
- {TERM}: {DEFINITION}

## Process fences (verbatim, non-negotiable)

No subagents, no background tasks, foreground only. Do NOT commit, and
leave git state (branches, worktrees, stashes) to the coordinator. Your
final message IS the deliverable.

Pre-existing untracked files and .claude/settings.local.json are
environmental; do not touch or report on them.

Guarded files, do not modify under any circumstance:
{GUARDED_FILE_LIST}

{IF_PARALLEL: "Agent B is working the following lane in parallel:
{OTHER_LANE_FILES}. Do not touch those files. If a task appears to
require touching them, skip it and flag it."}

## Read first, in this order, before changing anything

0. Discipline skills for this task (read fully, they bind like the
   fences): {SKILL_PATHS, e.g. .claude/skills/verified-completion/
   SKILL.md, .claude/skills/scope-discipline/SKILL.md; pick 4-5 per
   the pack README's model defaults}
1. {FILE}: {WHY / WHAT TO NOTICE}
2. {FILE}: {WHY}
3. {GUARDRAILS_OR_CLAUDE_MD_PATH}: repo invariants and gate contract

Do not trust remembered DOM handles, selectors, or line numbers. Grep the
current value from {SOURCE_OF_TRUTH_FILE} before using any of them.

## Lane

The complete list of files you may modify (stated once, tasks below
reference but never restate it):
{LANE_FILE_LIST}

## Items, in priority order

Items {N-M} are mandatory. Items {X} are optional: if anything runs
long, skip them and say so in the report.

### Item {N}: {TITLE}

- Intent: {ONE SENTENCE OF WHY, BEFORE ANY MECHANICS}.
- Where: {FILE} near the line containing the quoted string
  "{GREPPABLE_STRING}" (line numbers drift; the string is authoritative).
- Premise check: expect {WHAT THE COORDINATOR BELIEVES IS TRUE, e.g.
  "three rules, zero live references"}. If this does not hold, STOP:
  the premise is wrong; report instead of proceeding.
- What: {CHANGE_DESCRIPTION}.
- Worked example (if the item applies a pattern, paste the exact code
  shape or before/after once):
  {EXAMPLE}
- Acceptance (observable outcome, the layer the owner sees):
  {e.g. "reads as ONE element with one phrasing, judged on the
  screenshot, not the DOM" / "zero occurrences of warning X at runtime,
  count them and account for each"}.
- Selection rule (if the action has multiple plausible targets):
  {e.g. "first by capture date"}. If no rule fits, flag instead of
  choosing arbitrarily.
- Pattern to mirror (if any): open {PATTERN_FILE} and copy the canonical
  call site VERBATIM. Put the original and your instance side by side in
  your verification; "mirrors X" means it inherits what X actually is.
- If this item removes a component: grep its class names and delete
  now-dead styles in the same change.
- Sanity check: expect roughly {N} {OUTPUTS/OCCURRENCES}; stop and
  investigate if far off.
- Anti-goals: {WHAT NOT TO DO INSIDE THE ALLOWED FILES, e.g. "delete
  nothing else, however dead it looks; do not restyle otherwise"}.
- Expected size: {ROUGH DIFF MAGNITUDE}; if you exceed roughly
  {2-3x THAT}, stop and re-read the intent.
- Decision budget: you decide {X} alone; flag rather than decide {Y}.

{REPEAT PER ITEM. Verification-only items are legitimate: their
deliverable is a verdict plus evidence, and "no change needed" is a
success.}

## Skips are acceptable

If an item's precondition does not hold, investigate, skip, and document
the reason in your report. A justified skip is a good outcome; inventing
workaround logic to force completion is not.

## Verification you must run before reporting

- Temp script with named assertions covering each item's acceptance;
  delete it afterward.
- Per-file foreground test commands (full-suite runs are FORBIDDEN,
  Windows reporter hang):
  {EXACT_COMMANDS_PER_FILE}
- Every behavior change: one positive control AND one
  suppression/mutation control.
- Snapshot regenerations: read the new strings and justify each delta in
  the report.
- New <details>/<summary> elements: a summary carries its own chevron
  glyph only together with native-marker suppression; check every surface
  the pattern ships to.
- If a NEW assertion/pin fails on first run, question the assertion
  before the code (known trap: scrollWidth > clientWidth is true by
  design on text-overflow: ellipsis; assert box-vs-container geometry).
- Run the full pre-commit gate: {GATE_COMMAND}. Record exact counts.
- Repo-relative invocations: Bash with explicit cd "{REPO_PATH}" prefix,
  not PowerShell.

## Report format (your final message, exactly this structure)

1. Per item: what changed, files touched, verification evidence with
   exact counts.
2. Found but did NOT change.
3. Skipped, with reason.
4. Residual risks: anything noticed but not verified (narrow widths,
   timing, real-data cardinalities). List explicitly; the coordinator
   will disposition each one.
5. Pins/snapshots updated, each named and justified.
6. Gate result with exact counts.

Tone: plain and factual. No adjectives about the quality of your own
work. "Unverified" is an acceptable status and always better than a
guess dressed as a fact.

## Mission anchor

If at any point you lose the thread, this is the whole task:
{ONE PLAIN SENTENCE RESTATING EVERYTHING}. Nothing else.

---

# Coordinator-side stub (do not send to the agent)

- [ ] Same-layer agents sequenced, not parallel.
- [ ] On "completed": report text exists, git status matches claims,
      worktrees/branches clean.
- [ ] Every residual risk from section 4 dispositioned: verified now
      (how?) or logged as a named open item.
- [ ] Review checklist from SKILL.md run with referenced patterns OPEN.
- [ ] Live walkthrough if UI restructure (temp-copy session / demo
      profile seed; revert pair afterward).
- [ ] Diff grepped for em dashes.
- [ ] Postmortem notes captured while fresh (including my own errors).
