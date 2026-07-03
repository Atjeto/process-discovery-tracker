---
name: no-silent-failures
description: Use whenever writing error handling, try/catch or except blocks, fallback values, default parameters, retries, timeouts, or optional chaining on data that should exist, and whenever writing scripts that query, select, or drive anything (DOM selectors, file lookups, API queries). Consult it any time code decides what happens when something is absent or fails.
---

# No silent failures: errors travel up or stop the program

The most damaging habit in generated code is defensive handling that
makes failures invisible: the empty catch, the fallback default, the
guard that skips silently. Each converts a crash-now into a
wrong-answer-later, and wrong-answer-later costs ten times more to find.
Loud failure is a feature.

## The core rule

An error either propagates to something that handles it meaningfully or
stops execution with a message naming what failed and where. It never
evaporates. Concretely forbidden:

- Empty catch/except blocks, and catch-log-continue where the error
  affects correctness.
- Broad exception catches (bare except, catch (e) {}) around logic;
  catch the specific failure being handled.
- Swallowing an error to keep a loop or batch going without recording
  WHICH items failed and surfacing that record.

## Fallback values mask bugs

A default that papers over a missing input does not handle the absence;
it hides it. `value || defaultValue` on data that should always exist
turns a detectable bug into silent data corruption. Fallbacks are
legitimate only when ALL of the following hold: the absence is an
expected, designed-for state; the fallback is logged or reported; and
the task sanctions it. Otherwise: throw, with the missing thing named.

## Expected absence vs unexpected absence

These are different states and the code must encode which one it means.
"This element may legitimately not exist on this page" is a documented
branch with a comment saying why. "This element should exist" is an
assertion that fails loudly when violated. The bug pattern to avoid is
one code path serving both meanings, which is how absence becomes
invisible.

## Scripts and probes fail loud

In any drive, test, or verification script: an absent selector, a
missing file, an empty query result, or a zero-row response is a FAILURE
by default, never a silent skip. Documented case: `if (count())` guards
around guessed DOM handles silently skipped two entire surfaces and
cost a full re-run; the wrong handles were even enshrined in docs
afterward. Grep the real value from the source of truth before driving,
and make the absent path throw with the selector name in the message.

## Tolerance knobs are reportable

Every retry added, timeout raised, tolerance widened, or sleep inserted
gets a line in the report with the reason. These knobs are where race
conditions and real bugs go to hide; an unreported knob is a silent
failure with a delay timer.

## Warning classes are counted, not sampled

When fixing a class of warnings or errors: count the occurrences, fix
or account for each, and report before/after counts. Acceptance is zero
at runtime, not one fixed instance. One silenced instance plus a
"probably the same everywhere" is the silent-failure pattern applied to
cleanup.
