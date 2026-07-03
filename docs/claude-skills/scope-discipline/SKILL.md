---
name: scope-discipline
description: Use whenever implementing a specified task, chip, or work item, whenever tempted to improve, refactor, reformat, or clean up something adjacent to the task, whenever removing a component or feature, and whenever the change is growing larger than expected. Consult it at task start and again before finalizing the diff.
---

# Scope discipline: the diff contains the task and nothing else

Scope failures are the quiet ones: nothing breaks, review just gets
slower and riskier, and unrequested changes ship without anyone having
decided to ship them. The rule has two halves: everything asked, nothing
else.

## The mapping test

Before finalizing, walk the diff hunk by hunk. Every hunk maps to a
named task item. A hunk with no item is removed, no matter how good it
is. The reverse mapping also holds: every item maps to hunks or to a
documented skip (see verified-completion).

## "While I am here" is a trap

Things noticed but not asked for (dead code, a better name, a fragile
pattern, a missing null check elsewhere) go in the report under a
"found but did NOT change" section. That section is where good
observations create value; the diff is not. An unrequested improvement
inside the diff is indistinguishable from an accident to the reviewer,
and it converts a five-minute review into a thirty-minute one.

No drive-by formatting, whitespace churn, or import reordering outside
touched hunks. Noise hides the actual change.

## Removals are complete or they are not removals

Removing a component includes, in the same change: grep its names
(classes, exports, config keys, feature flags) and delete now-dead
styles, references, and registrations. Half a removal is worse than
none; the debris makes every future grep lie. Report the before/after
occurrence counts of each removed name.

## Deleting artifacts needs a target check

"Remove anything unused" never authorizes deleting the current
packaged distributable. Before deleting build outputs, separate stale
duplicates from the one that ships: the README's ship instruction, the
newest mtime, the working exe / installer / bundle. Documented case: a
cleanup swept the exact folder the README said to zip and ship,
bucketed with three genuinely stale siblings; the reader had even seen
the ship instruction. Regenerable is not deletable. Confirm the
current artifact by name before touching it; delete the obviously
stale freely.

## The overbuild guard

Implement the case that was asked, not the general framework around it.
Concrete tripwires, any of which means stop and reconsider:

- An abstraction with exactly one caller.
- A configuration option the task did not name.
- A helper module created for code used once.
- Handling for inputs the system cannot currently produce.

Generality is a feature request like any other: if it seems genuinely
needed, propose it in the report; do not smuggle it into the diff.
Stronger models fail here more, not less: the better the imagined
architecture, the stronger the pull to build it unasked.

## Magnitude is a signal

If the brief stated an expected change size and the diff is several
times larger, the most likely explanation is a misunderstanding of the
task, not a bigger task. Stop, re-read the item's intent, and either
shrink the approach or report the discrepancy before continuing.

## Anti-goals bind like goals

When the task states things NOT to do, treat them with the same force
as requirements. If an anti-goal seems to conflict with completing an
item, flag the conflict in the report rather than resolving it
unilaterally.
