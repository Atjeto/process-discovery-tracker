# Brief: v1.4.1 fix chip (defects from the 2026-07-02 postmortem)

Model: sonnet. Single agent, foreground. Coordinator: fill the two
{FILL} values before sending; everything else is ready.

## Mission

Fix the small defects that shipped in v1.4.0's disclosure pass. This is
pure cleanup: no new behavior, no redesign. The bar: after this pass the
disclosure surfaces look intentional and the stylesheet contains no
debris from the pass.

## Environment

- Repo root: {FILL}. Windows machine. Run all repo-relative commands in
  Bash with an explicit cd to the repo root first; PowerShell only for
  Windows-specific tooling. PS 5.1 mangles quoted native args.
- The viewer RE-ANALYZES the committed demo session on every launch. If
  you launch the app, load a temp copy of sessions/example-aggregate
  (mirror what freshenSession() in e2e/session-smoke.js does), or run
  the revert pair immediately after. Never leave a launch against the
  committed session un-reverted.
- Everything you need is installed. Do not install, update, or configure
  anything.

## Glossary (house terms)

- surface: a top-level view (Overview, Compare, Flow, Template,
  App Library).
- pin: an e2e assertion that locks a rendered detail in place.
- gate: the pre-commit check suite.
- chip: a small scoped work item like this one.

## Process fences (verbatim, non-negotiable)

No subagents, no background tasks, foreground only. Do NOT commit, and
leave git state (branches, worktrees, stashes) to the coordinator. Your
final message IS the deliverable.

Pre-existing untracked files and .claude/settings.local.json are
environmental; do not touch or report on them.

Guarded files, do not modify under any circumstance:
process-map-levels.js, dfg-viewer.js, anything under the pipeline.

## Read first, in this order, before changing anything

1. AGENT-DELEGATION-POSTMORTEM-2026-07-02.md, sections S1, O2, O3, O1
   only. These define the four defects you are fixing; the intent behind
   each item below comes from there.
2. styles.css: grep "how-this-works" and read the whole block. Then grep
   "details-marker" and read how the Machine-drawer summary suppresses
   the native disclosure marker. Item 1 copies that pattern.
3. styles.css: grep "ov-tier2" and read the rules (expect three).
4. index.html: grep 'data-view=' and note the REAL nav handles
   (canonical, vocabularies, and peers). Do not trust remembered
   handles; a wrong remembered value cost a full drive pass once.

## Lane

The complete list of files you may modify: styles.css, the Compare /
Template / App Library view modules, and (item 4 only) the Overview
badge subtitle string source. Nothing else.

## Items, in priority order

Items 1-3 are mandatory. Item 4 is optional: if anything runs long,
skip it and say so.

### Item 1 (S1): doubled disclosure markers on three surfaces

- Intent: every new disclosure currently renders TWO chevrons, the
  browser's native marker plus the literal glyph in the summary text.
  It reads as a rendering bug. One chevron, the literal one, everywhere.
- Where: grep styles.css for "how-this-works". The affected disclosures
  are the "How this works" / "Why these sessions don't compare yet"
  elements on Compare, Template, and App Library.
- What: add native-marker suppression to the shared summary rule, the
  same way the Machine-drawer pattern does it. Worked example, copy this
  shape:

  .how-this-works > summary { list-style: none; }
  .how-this-works > summary::-webkit-details-marker { display: none; }

- Acceptance (visual, judged on screenshots): exactly one chevron per
  disclosure on ALL THREE surfaces. Screenshot each surface: three
  surfaces, three screenshots. This defect shipped precisely because
  only one surface was eyeballed.
- Anti-goals: do not restyle the summaries otherwise; do not touch the
  Machine drawer itself.
- Expected size: under 10 lines of CSS. If you are writing more, stop
  and re-read the intent.

### Item 2 (O2): dead .ov-tier2 rules

- Intent: the .ov-tier2 chip was removed from the Overview render but
  its styles remain. Debris makes future greps lie.
- Where: grep "ov-tier2" repo-wide. Expect three rules in styles.css and
  zero references anywhere else. If you find a live reference, STOP:
  the premise is wrong; report instead of deleting.
- What: delete the three dead rules.
- Acceptance: repo-wide grep for "ov-tier2" returns zero hits. Report
  the count before and after.
- Anti-goals: delete nothing else, however dead it looks. If you notice
  other apparently-dead styles, list them under "found but did NOT
  change".
- Expected size: three rule deletions, zero additions.

### Item 3 (O3): narrow-width verification of the summary teaser

- Intent: v1.4.0 lengthened the Session-summary teaser line and every
  eyeball ran at 1500x950; nobody has ever seen it narrow. This item is
  a VERIFICATION, not a change, and may legitimately end with "no
  change needed".
- What: view the Overview teaser at 1280x800 and 1024x768 (temp-copy
  session rule applies). Screenshot both.
- Acceptance: two screenshots plus a one-sentence verdict. If the line
  wraps badly, clips, or collides, report it with the screenshot and
  PROPOSE the minimal fix; do not implement it.
- Decision budget: you decide what the screenshots show; the owner
  decides whether it needs fixing.

### Item 4 (O1, optional): merged-badge phrasing

- Intent: the merged case-state badge still reads as two chips glued
  together: a checkmark clause, then a separator, then an uppercase
  clause. Wanted: one fact, one voice; a reader should not suspect two
  sentences were merged.
- Where: grep for "ov-badge-sub"; the current subtitle string is nearby.
  Note: the current string joins its clauses with an em dash. The owner
  rule is NO em dashes anywhere; whatever you write must not contain
  one, and this is also your chance to remove the existing one.
- What: reword the badge + subtitle into a single phrasing that keeps
  both facts (count/state and the analysis-mode flag). Implement your
  best candidate; list your runner-up phrasing in the report.
- Acceptance (visual): screenshotted, the element reads as ONE element
  with ONE phrasing. Judge the screenshot, not the DOM; the original
  defect satisfied a DOM-shaped criterion while still looking glued.
- Anti-goals: do not change the badge's data sources; no structural DOM
  changes beyond what the wording needs.

## Verification you must run before reporting

- Temp script with named assertions for the scriptable acceptances
  (item 2's zero-grep; item 1's computed list-style on all three
  summaries). Delete the script afterward.
- Per-file foreground vitest for any pin you touch: {FILL exact
  commands}. Full-suite runs are FORBIDDEN (Windows reporter hang).
- If you add a pin for item 1, assert via computed style, not a visual
  heuristic. Known trap: scrollWidth > clientWidth is true by design on
  text-overflow: ellipsis elements. If your NEW pin fails on first run,
  question the assertion before the code.
- Run the pre-commit gate; record exact counts (tests run, passed, pins
  updated by name).
- Grep your whole diff for em dashes before reporting. Zero is the only
  acceptable count.

## Report format (your final message, exactly this structure)

1. Per item: what changed, files touched, verification evidence with
   exact counts.
2. Found but did NOT change.
3. Skipped, with reason.
4. Residual risks: anything noticed but not verified. List explicitly;
   the coordinator dispositions each one.
5. Pins/snapshots updated, each named and justified.
6. Gate result with exact counts.

Tone: plain and factual. No adjectives about the quality of your own
work. "Unverified" is an acceptable status and always better than a
guess dressed as a fact.

## Mission anchor

If at any point you lose the thread, this is the whole task: remove the
doubled chevrons on three surfaces, delete three dead CSS rules, look at
one teaser at two narrow widths, and optionally reword one badge.
Nothing else.
