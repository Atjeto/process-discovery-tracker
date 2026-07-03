---
name: seam-checking
description: Use whenever changing a value's shape, source, name, or format, whenever adding a feature that coexists with another feature (caps, filters, toggles, reveals, thresholds), whenever changing anything that other files consume, and during any migration or data-shape change. Consult it before the change, to plan the consumer sweep, and after, to verify it.
---

# Seam checking: correctness lives between the pieces

The most expensive class of shipped bugs is not a broken function; it
is two correct functions with a broken seam between them. Features
verified in isolation say nothing about their interaction, and value
changes verified at the producer say nothing about the render site.
This skill is the sweep that covers the seams.

## Changing a value: trace every consumer

Before changing a value's shape, source, name, unit, or precision:

1. Grep the symbol repo-wide and list every consumer.
2. Read each usage site, especially render sites: integers must stay
   integers, units must stay attached, locales and timezones must stay
   correct (documented case: a changed value source broke display
   formatting because nobody read the render site).
3. Check the non-obvious consumers: serialization, persisted state,
   snapshots, analytics events, and anything that stores the OLD shape.
   Old persisted data meeting new code is a seam too: state what
   happens to it.

The change is complete when every consumer on the list is verified or
updated, not when the producer compiles.

## New feature pairs: enumerate and test the interactions

When a change creates a pair (a new feature next to an existing one),
list the interactions the pair creates and test each. The documented
failure classes, all shipped by a strong model:

- **Cap and reveal:** whoever ships a cap must ship the uncapped data
  in the same payload; otherwise the reveal has nothing to reveal.
  Test: post-reveal state contains items the capped state did not.
- **Hidden controls:** hiding a control below a threshold must
  neutralize the state it governs, not just its pixels. Test: below
  the threshold, data outside the hidden filter's window is still
  reachable.
- **Toggles and expands:** an existing button is not a working
  interaction. Test the post-state against the pre-state.
- **Buckets and fallbacks:** grouping logic needs at least two distinct
  inputs landing in the same bucket to prove it groups (see
  test-integrity, fixture cardinality).

The general form: if the change introduces feature B beside feature A,
"A works" plus "B works" is zero evidence about A-with-B. Write the
A-with-B test.

## Identity is a shape too

When consumers key on object identity (memo deps, effect deps,
selector caches), referential stability is part of the producer's
contract. Documented case: integration hooks returning a fresh {} for
their disabled path re-keyed a useMemo, which re-dispatched an insights
worker on every render: a hard update-depth crash in jsdom and an
invisible 16ms battery-drain loop in the real browser, which is why no
eyeball ever caught it. The house pattern: one frozen sentinel per hook
(EMPTY_BY_DATE = Object.freeze({})) returned for every empty or
disabled state, plus useMemo on derived maps. When adding any producer
that feeds identity-keyed consumers, test stability with toBe across
renders, not just toEqual.

## Cross-file invariants

If an edit in file A relies on a guarantee maintained in file B (an
ordering, a non-null promise, a format contract), open B and confirm
the guarantee still holds AFTER the change. Guarantees are maintained
by code, not by intention, and the maintaining code may itself be what
the task changed.

## Migration completeness

A migration is done when: the producer is changed, every consumer is
swept (step list above), the old shape's remnants are removed (dead
constants, dead styles, dead branches; see scope-discipline on complete
removals), and one test exercises the boundary where old meets new.
Half-migrations are seam bugs on a delay timer.

## The seam report

In the final report, list the seams that were checked ("consumers of X:
5 found, 5 verified; pair interactions tested: cap+reveal, threshold").
An unlisted sweep is indistinguishable from an unswept seam, and the
reviewer must assume the worst.
