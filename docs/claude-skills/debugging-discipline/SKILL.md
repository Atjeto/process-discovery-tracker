---
name: debugging-discipline
description: Use whenever investigating a bug, a failing test, an unexpected behavior, a regression, or an error message, and whenever a fix attempt did not work on the first try. Consult it BEFORE making the first change, not after several failed attempts; the discipline only works if it starts at attempt one.
---

# Debugging discipline: one hypothesis, one change, one verdict

Debugging fails in two opposite ways: thrashing (changing things until
something goes green, with no understanding of why) and stalling (going
quiet with nothing to show). Both are forbidden. The replacement is a
loop with a written hypothesis at its center.

## The loop

1. **Reproduce first.** No reproduction means no fix, only a guess. If
   the failure cannot be reproduced, THAT is the finding; report it with
   what was tried instead of patching speculatively.
2. **Read the actual error.** The whole message and the whole stack, not
   the first line. Most wrong fixes come from pattern-matching a
   familiar-looking first line onto a different bug.
3. **Triage the suspect class early: logic, state, or environment.**
   Environment checks (version, working directory, stale build, cache,
   wrong shell) are the cheapest to run and the most embarrassing to
   skip; a drifted working directory or shell quirk can mimic any bug.
   On this machine, even your own file reads can lie
   (windows-environment: the MSIX shadow).
4. **Write one hypothesis with a testable prediction.** "If X is the
   cause, then changing/observing Y will show Z." If no prediction can
   be stated, the hypothesis is not ready; observe more first.
5. **Make ONE change.** A single variable. If two things changed and it
   went green, nothing was learned and the fix cannot be trusted.
6. **Check the prediction, not just the color.** Green for the wrong
   reason is a future red.
7. **Revert disconfirmed changes immediately.** The diff between
   attempts stays minimal; layered failed attempts turn the codebase
   into a second bug.

## Instrument, do not speculate

When the mechanism is unclear, add observation before making changes: a
temporary print, an interceptor, a captured stack. Observe, note the
finding, REMOVE the instrumentation. One captured stack outweighs five
theories.

## When a NEW check fails on its first run

Question the assertion before the code. New guards frequently encode a
wrong model of the system (documented case: a clipping heuristic using
scrollWidth > clientWidth, which is true by design on legitimate
text-overflow ellipsis). Confirm the assertion can distinguish pass from
fail on known-good and known-bad input before trusting its verdict.

## Dead ends stay dead

A failed approach does not get re-run unchanged in the hope that the
machine behaves differently this time; it does not. Two documented
session-killers here: re-running an identical failing test command,
and until-grep / tail -f polling of background output, which hangs on
this shell (windows-environment). Same command plus same result twice
is the hard ceiling; the next attempt must change the hypothesis, the
tool, or the plan.

## Pre-existing or yours?

Before debugging a failure as if you caused it: git stash, run the
failing file, git stash pop. Failing on clean main means pre-existing;
record it and move on unless asked. One masquerade to know: a test
with a fixed past NOW anchor and an unpinned system clock rots as
wall-time drifts, so it LOOKS pre-existing and unrelated while being a
latent bug in the test itself (test-integrity has the pin pattern).

## When the owner reports a failure you cannot reproduce

The report outranks your passing check until the two are reconciled.
Find the exact thing that fails for him: which file hangs, which step,
which environment difference. Substituting a narrower check that
passes ("the subset is green") and declaring health is the most
corrosive move in this collaboration's recorded history; it was once
repeated four times in one session against explicit pushback. If the
failure is genuinely irreproducible after real effort, THAT is the
finding: report what was tried and what observation would
discriminate.

## The thrash limit

After THREE disconfirmed hypotheses: stop changing code. Write up what
is now known, what has been excluded (with evidence), and the best
remaining candidates. Report that. A structured "here is what it is not"
is genuinely valuable output; a fourth blind attempt is not. Stalling
silently is equally forbidden: if stuck, the deliverable is the writeup.

## The tuning limit: repeated re-tuning means the model is wrong

The thrash limit's slow-motion sibling. When the same knob has been
re-tuned across multiple attempts or sessions and the failure persists
IN KIND (not just in degree), stop tuning: the constant is not wrong,
the model behind it is. Documented case: a step-segmenter split on
time-gaps/app-switches was tuned for weeks; a real 93-minute recording
still yielded ~308 fragments where ~70 tasks existed. The recorded
verdict — "model mismatch, not a tuning bug; do NOT keep tuning the
gap/app split" — held: the fix was changing the unit of work entirely,
and no threshold would ever have found it. Ask at the second re-tune:
what would have to be true for ANY value of this knob to work? If
nothing, redesign the mechanism and write the do-not-retune verdict
down where the next tuner will look.

## Done means mechanism

A fix is complete only when the report can state WHY the bug happened,
in one or two sentences, and why the change addresses that mechanism.
"It passes now" without a mechanism is a coincidence being shipped. If
the mechanism cannot be stated, keep the fix but label it explicitly:
"symptom resolved, root cause not established", so the reviewer can
decide whether that is acceptable.
