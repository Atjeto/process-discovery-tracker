---
name: verified-completion
description: Use before declaring ANY task, item, or fix complete, before writing a final report, and whenever about to say "done", "fixed", "passing", "should work", or "implemented". Also use when finishing partially or running out of time. This skill defines what counts as evidence for a completion claim; consult it every time work is about to be reported as finished, even for small tasks.
---

# Verified completion: done means demonstrated

A completion claim is a claim about evidence, not about effort. The most
common way agent work fails is not a wrong change; it is a right-sounding
report about an unverified change. This skill makes that impossible.

## The evidence hierarchy

From strongest to worthless:

1. Command output produced THIS session, pasted with exact counts.
2. File content read from disk AFTER the change was written.
3. A reasoned inference, labeled as inference.
4. Memory of having done something. Memory is not evidence. If the only
   support for a claim is that you remember doing it, re-run or re-read
   before claiming it.

"Should pass", "should work", and "this will fix it" are banned phrases
in reports. Either it was run and the output says so, or the claim is
labeled unverified.

## Before declaring done, in order

1. Re-read the ORIGINAL task statement, top to bottom. Not your summary
   of it; the original. Long sessions decay your model of the task
   silently, and the cheapest fix is thirty seconds of re-reading.
2. Walk each stated requirement against the actual diff. Every
   requirement maps to a change or to a documented skip; every change
   maps back to a requirement (unmapped changes violate scope; see the
   scope-discipline skill).
3. Run every check the task names, in the foreground, now. A check run
   before your last edit proves nothing about the code after it.
4. Record exact counts: tests run, tests passed, occurrences found,
   occurrences fixed. "All green" is not a count. For warning or error
   classes: count occurrences and account for each one; acceptance is
   zero at runtime, not one fixed instance.
5. Counts include SKIPS, and skips get a coverage check: "520 passed"
   is not green when the 11 skips are exactly the tests covering the
   layer you touched (documented case: dependency-gated pipeline tests
   skip silently under the system interpreter). State pass count, skip
   count, whether the skipped set covers your change, and — if it does
   — the compensating check you ran instead.

## Claim labeling

Every claim in the report carries one of three statuses:

- verified: ran it or read it this session; evidence in the report.
- inferred: reasoned from verified facts; the reasoning is stated.
- assumed: taken from the brief or the environment without checking.

Fluent prose must never let an inferred or assumed claim read as
verified. "Unverified" is an acceptable status and always better than a
guess dressed as a fact.

## Partial completion is a defined outcome

Running out of time or hitting a blocker is not a failure state; an
imprecise report is. If work is partial:

- Report the exact done/undone split per requirement.
- State what was verified about the done part.
- State the blocker or remaining work concretely enough that another
  agent could resume from the report alone.

A precise partial beats a vague complete every time. Similarly, a
justified skip (precondition not met, investigated and documented) is a
successful outcome, not a shortfall.

## State you mutated: snapshot first, prove restoration by diff

Before any run that can dirty shared state (a tree the app regenerates,
a config, a fixture), snapshot the baseline to files (`git status
--short` + `git diff` at minimum). "Restored" is a claim: prove it by
diffing current state against the snapshot, and never claim
byte-exactness from memory or post-hoc reconstruction (documented case:
a "byte-for-byte restored via the reachable stash object" claim that
the tree contradicted). Report any residue you could not restore.

## Derived numbers get an absurdity check

Any count, sum, or percentage you computed and are about to display or
report gets one sanity pass against the data's known shape before it
ships: "~530 unnamed controls in a 155-event session" indicts the
aggregation (per-source summing where a union was meant), not the data.
A plausible-looking number computed with the wrong shape is the failure
mode; the check costs one sentence of thought (documented catch:
530 → 47 by union-of-matched-keys).

## Scope of verification is part of the claim

Say what your verification did NOT cover and why, in the report:
"unit-tested and build-verified; NOT screenshot-driven — the panel is a
native tray and no live session was available." Honest scope makes a
narrower verification trustworthy; a vague "verified" makes even a wide
one suspect. This pairs with claim labeling below — an unverified
dimension is stated, not hidden.

## Report tone

Plain and factual. No adjectives about the quality of your own work
("robust", "clean", "comprehensive"). The reviewer decides quality; you
supply counts and evidence. Confidence-padding is what makes review
expensive and what lets defects ship.
