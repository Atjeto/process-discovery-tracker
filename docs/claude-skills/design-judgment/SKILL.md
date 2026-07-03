---
name: design-judgment
description: Use when critiquing a product or surface, deciding what to build, keep, gate, or delete, writing or reviewing a design plan, or when an owner says some version of "this has everything and yet I can't use it". Also use before adding any new surface, module, metric, or report to an existing product, and when reviewing whether a feature earned its place. This is judgment, not process; it pairs with operating-core the way the dojo skills pair with subagent-briefing.
---

# Design judgment: value is consequence, not truth

Distilled from the 2026-07 approachability cycle: a product where every
panel was honest, tested, and documented — and the sum was "unapproachable,
scary, tiring just to look at". Its owner had struggled for months to make
himself use his own app. Every rule below was paid for there; the tier is
general best practice unless marked.

## Two gates, in order

Most quality processes gate on truth: is the claim correct, is the number
measured, is the state honestly labeled. Necessary — and insufficient. The
second gate is consequence: **who does what differently after reading
this?** A surface earns residence only if, on real input, it produces at
least one of: a sentence in the deliverable, a recorded user decision, or
an instruction for the next round of input. Fails all three → it renders
on demand, or not at all. Calm, honest noise is still noise.

Corollaries that fall out, each a shipped failure once:

- **An assumption never gets a column.** A config constant rendered
  per-row reads as per-row measurement (a flat 70% "automatable share"
  column). Assumptions render once, in the assumptions line.
- **Gates gate composites, not just heroes.** A floored headline above a
  still-rendered table of zeros is a gate in name only.
- **A merged quantity cannot answer a comparison question.** A compare
  surface that sums instead of differencing has deleted its own subject.
- **Per-item asks multiply.** Any field or judgment requested per item is
  multiplied by item count before it ships; 500 × anything is a rejected
  design. Empty inputs read as owed work.
- A number earns pixels when someone will act on it; below that it's a
  sentence; below that a CTA; below that, nothing.

## Where saturation comes from (name the force, then resist it)

- **Canon import.** Borrowing the furniture of a neighboring domain that
  has 1000× the data (enterprise process-mining tables at N=3; big-data
  dashboards for one user's week). The furniture implies evidence the
  input cannot supply.
- **Additive sedimentation.** Cycles only ever add. Audit any long-lived
  product for deletions: one deletion in 27 decision records is a
  diagnosis, not a history. Phase-tagged comments layered in one function
  are geological strata — read them as a warning.
- **Use-pressure inversion.** Surfaces grow fastest exactly where nobody
  uses them, because nothing pushes back. The ~20-block compare view
  needed a corpus that barely existed; the feature whose only successful
  user is an e2e script is the purest form.
- **Acceptance data that cannot fail.** Every surface tuned against a
  curated demo passes forever; the demo cannot fail the way Tuesday
  fails. (test-integrity has the executable form of this rule.)
- **"We built it with care."** Care is not the test; consequence is. The
  cuts you resist hardest are your own inventions — audit those first.

## Critique method

- **Ground it in the artifact.** Open the real code, the real screen,
  the real data before judging; cite what you found (a file whose header
  proudly documents the flaw — "self-contained by design" — beats a page
  of impressions). Critique from memory produces F1-class false flags.
- **Name the inversion.** Many bad surfaces are a correct capability at
  the wrong orientation: an authoring-first form where the job is
  evidence-first naming; nouns (views, editors, libraries) where the
  user works in verbs in a sequence. The user's frustrated sentence
  often IS the design — "let me find that submit button and see if the
  selector is right" specified a whole workbench in one breath. Listen
  for specifications wearing complaint costumes.
- **Decide, don't park.** A critique that ends in "consider revisiting"
  has decided nothing. Every item gets a verdict — keep, gate, demote,
  delete — and where you genuinely can't decide, name the ONE fact that
  would settle it and the cheapest way to get it (three real memos
  settle a border argument no armchair can).
- **Find the empirical instrument.** The strongest form of a design
  argument is a measurement protocol the owner can run: timed real
  sessions, a ledger of which surfaces produced sentences/decisions/
  instructions, a kill rule agreed in advance. Taste starts arguments;
  ledgers end them.
- **Own your share.** A register that only indicts others is
  advertising. The critique's author built half the problem; say which
  half (the demo that couldn't fail was mine; the unsatisfiable
  invariant in the brief was mine). Credibility is bought with your own
  entries.

## Building without re-saturating

- Every new verb ships with its inverse, its legend, and a real-run
  check — a verb you can't undo or can't explain is chrome debt
  (owner-repo form: the COHERENCE-AUDIT checklist).
- State the mental model in one sentence on the surface itself ("a
  vocab is one app's dictionary: when the recorder sees THIS, call it
  X"). If you can't write that sentence, the surface isn't ready.
- Derive, never ask twice: anything the system already captured is
  never typed by a human (blank signature forms asking the analyst to
  re-enter what the recorder recorded).
- Prefer subtraction first in any rescue: deletion is cheap, reversible
  via git, and buys back the will to use the thing — which every later
  phase depends on. The fear a user reports is load-bearing data;
  "scary" means no altitude and no order of operations, and the fix is
  sequencing (what should I do next?), not more panels.
- Thresholds and rails are guidance, not measurements — label advisory
  numbers as advisory, and never let a suggestion auto-run.

## The test to leave behind

Before adding anything resident, write down: the memo sentence it will
produce, or the decision it will record, or the instruction it will
emit — on the worst realistic input, not the demo. If the spec can't
name one, the feature is a drawer or a deletion. This one habit,
applied at spec time, prevents every failure this skill catalogs.
