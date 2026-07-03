---
name: motif-voice
description: Use whenever writing or reviewing ANY text a Motif user will read: insight sentences, UI copy, notifications, empty states, labels, onboarding, settings, release notes; whenever naming a feature, metric, or mode; and whenever deciding what the free tier shows or locks. Motif is a self-tracking app for people whose self-signal is unreliable; the rules here are product ethics, not style preferences, and several are enforced by lint and tests. Consult it before writing the copy, not after.
---

# Motif voice: serve the state, never label the person

Motif measures like a prosthesis and must not deliver like a
horoscope, a doctor, or a nag. The audience is the SITUATION of
unreliable self-signal (rhythm chaos, load crush,
depletion-recovery), never a diagnosis or a named condition. These
rules survived a full design cycle and several deliberate
rejections; treat them as settled unless the owner reopens them.

## Identity rules (hard)

- No condition names, ever. Not in copy, not in settings, not in
  strings that could surface. The "ADHD baseline" chip was built and
  then deliberately removed; that removal is the precedent, not an
  accident.
- The engine is not an observer. Never "Motif noticed", "Motif
  sees", "Motif thinks": detector sentences are agentless statements
  about the data. An agent-voice lint exists; keep it passing and
  extend it when new observer phrasing creeps in.
- The one earned brand use: the verdict ledger is "Your motifs",
  meaning patterns that held when tested, with "not one of your
  motifs" as the exoneration copy. "Motif of the day" was explicitly
  rejected as horoscope framing; do not reinvent it under a new
  name.
- No prescriptions, ever. The app reports what held and what did
  not; the verdict loop is the only causal path; the user decides
  what to do about it.

## Money never gates truth

"Gate tools, not truths": a finding ABOUT the user is never
ransomed, teased, or locked. Earned verdicts never re-lock. Data
export stays free forever. De-ransoming the UI (removing teaser rows
and locked-count pills) was a shipped cycle deliverable; do not
regress it. Depth, breadth, integrations, and history are the
gateable surface.

## Plain words

- Short sentences, everyday words, especially on morning surfaces.
  Care copy and plain-words mornings were explicit deferred-item
  fixes; the bar is a tired person at 7am, not a dashboard reader.
- No internal jargon in user-facing text: byDate, Tier 2, fusion,
  Phase A, detector names. The same bar applies to Play Console
  release notes (format in owner-contract).
- One word per concept, per the cycle's lexicon: "pattern" is the
  umbrella word; "status", not highlights; "recharge", not
  restoration. The lexicon lives in the spec (W13); grep it fresh
  before naming anything new.

## Mechanics that are also tests

- No em or en dashes anywhere; an insight-sentence test asserts
  this, and the repo rule extends it to everything
  (docs/CODING_STANDARDS.md).
- No emoji in user-facing copy unless the owner asks; an emoji rule
  shipped in the polish pass.
- Numbers render in the shape the sentence promises: integer-worded
  copy gets integers; round severity-weighted floats at the render
  site. Documented case: "Stress events 9.7" shipped because the
  data changed and nobody re-read the sentence around it.
- Insight tests assert sentence prefix + values + key phrases, never
  exact full strings.
- A sentence may not claim more than its evidence: thresholds, n
  floors, and stability gates for what an insight may say live in
  RESEARCH.md Part 6 and the thresholds module. Overclaiming copy is
  a voice bug even when the math is right.

## Source of truth

This skill is an index, not the spec. The audience statement,
situation registry, lexicon, and tier map live in
docs/SPEC_COHERENCE_CYCLE.md (W12 through W14). When this skill and
the spec disagree, the spec wins and this skill gets fixed in the
same change.
