---
name: test-integrity
description: Use whenever writing, modifying, fixing, or regenerating tests, snapshots, pins, or assertions, whenever a test is failing and there is any temptation to change the test rather than the code, and whenever adding tests for new or changed behavior. Consult it before touching any test file.
---

# Test integrity: a test you weakened is a test you deleted

Tests are the only reviewer that runs every time. Under completion
pressure, the fastest route to green is to weaken the test; that route
is closed. This skill defines the legitimate moves.

## The failing-test decision

A failing test means exactly one of three things, and the first job is
to determine which:

1. The code is wrong: fix the code.
2. The test encodes intended-and-now-changed behavior: change the test,
   but ONLY if the task explicitly says the behavior changed, and say so
   in the report with the old and new expectation side by side.
3. The test itself is wrong (bad assertion, flaky setup): fix the test's
   mechanism and prove the fixed version can still fail (see controls).

Forbidden regardless of pressure: adding skip markers, deleting the
test, widening tolerances until green, reordering to dodge state
leakage, or rewriting the assertion to match current output without a
task-level justification. Each of these is deleting a test while leaving
its name on the scoreboard.

## Controls: prove the test can fail

Every behavior change ships with a positive control AND a suppression or
mutation control: break the code deliberately, watch the test go red,
restore, watch it go green. A test that has never been seen red proves
nothing. This takes two minutes and is the single highest-value habit in
this skill.

The positive control also validates the SCENARIO. A suppression test
whose fixture never triggers the feature passes vacuously whether the
feature works or not. Documented case: a privacy-mode "suppresses X"
test shipped green because the fixture's correlation was r 0.27, strong
enough that the suppressed insight never fired regardless of the flag;
three such tests looked green and proved nothing, and the owner found
the gap by hand. Compute the fixture's actual threshold, correlation,
or count with the same function the code uses (a one-off print is
fine); never assume the data produces the magnitude you intended.

## Snapshots and pins

Regenerating a snapshot is asserting that every changed string is
intentional. Read the new strings and justify each delta in the report,
individually. "Regenerated snapshots" with no delta list is a weakened
test in disguise. Name every updated pin in the report.

## Fixture cardinality

Synthetic fixtures gravitate to one of everything, and one-of-everything
hides whole failure classes. Documented case: a fallback bucket tested
with a single unmapped input, which cannot detect grouping bugs. Rules:

- Any bucket, fallback, or grouping logic: at least TWO distinct inputs
  that land in it.
- Any list rendering: test with zero, one, and many.
- Where real data exists, prefer a trimmed real fixture over an invented
  one; invented fixtures inherit the author's blind spots.

## Clocks: pin the system time to the fixture anchor

A fixture built around a fixed past anchor (const NOW = new
Date("...").getTime()) with an unpinned system clock is a test that
rots: components call Date.now() at render, the gap between anchor and
wall clock grows daily, and one day a grace window or age bucket flips
state. Documented case: a commitment meant to be 1 day overdue silently
auto-flipped to "missed" once real time drifted past the grace window;
the test had been rotting for days. Standard pattern, verbatim:

    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
    afterEach(() => { vi.useRealTimers(); });

Do not fix rot by bumping NOW to today; that re-arms it. Pin the clock.
And when triaging a "pre-existing" failure, check for an unpinned
anchor first: time-rot wears the pre-existing costume
(debugging-discipline).

## Interaction assertions

For every expand, toggle, reveal, or show-more: assert that the
POST-interaction state contains something the pre-interaction state did
not. The existence of a button is not evidence of a working reveal
(documented case: a cap shipped without the uncapped data in the same
payload, so the reveal had nothing to reveal). If a control is hidden
below a threshold, test that the state it governs is neutralized, not
merely invisible. Rendering without crashing is not a behavior test:
fire the event, spy the setter or read the post-state, and assert the
change itself.

## Honesty headers

If a regression test cannot faithfully reproduce the original failure
mode (jsdom vs real browser scheduling is the classic), the test header
must say so and name the authoritative control that does cover it. A
test that silently pretends to cover what it cannot is worse than no
test: it retires vigilance without providing protection.

## Acceptance data must be able to fail like production

A curated demo passes forever: it was built to exercise the features,
so it cannot fail the way real input fails. Documented cost: a whole
product's surfaces were tuned for months against a demo whose vocabs
matched and whose cases were marked, while every real session produced
unusable output — the owner's revolt, not a test, caught it. Rules:

- Somewhere in the gate chain, the acceptance input must be real, or
  realistically degraded (missing vocabs, unmarked cases, junk labels).
- When a check needs a property the fixture lacks, MEASURE the fixture
  first, then seed the property into a temp copy and say so in the
  test header (documented pattern: the demo never revisits a screen,
  so the fold-check seeds a synthetic revisit — a vacuously-green
  check is worse than none).

## Twice-regressed invariants become executable guards

An invariant that has regressed twice does not get a third doc
sentence; it gets a guard that fails the build (documented lineage: a
map-connectivity break and an ADR-numbering collision each recurred
until they became CI checks — neither recurred after). The doc line
tells the next person why; only the guard tells them WHEN. Pair every
hard invariant with the check that fails on regression, and record the
pairing where agents look first.

## Happy-path bias

For each meaningful behavior, ask once: what is the boundary case, the
empty case, and the malformed case, and does any of them matter here?
Add the ones that do. Do not add ceremony tests that assert nothing a
reviewer cares about; test count is not a goal (see scope-discipline).
