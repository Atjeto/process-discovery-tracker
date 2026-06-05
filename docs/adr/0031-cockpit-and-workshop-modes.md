# ADR-0031: Three contextual defaults — Glance, Cockpit, Workshop

**Status:** Accepted — recorded 2026-06-05 (design only; build is Phase 0 + Phase 3 of the [PDT 1.0 spec](../PDT-1.0-SPEC.md))
**Date:** 2026-06-05
**Deciders:** Project owner
**Related:** [ADR-0010](0010-ux-overhaul-viewer-recorder.md) (the existing five-tab UX this rehomes), [ADR-0012](0012-active-case-stamping-and-map-matrix.md) (the notation × level matrix that lives behind the Workshop toggle), [ADR-0024](0024-step-grain-as-view-time-rollup.md) (the grain slider that drives all three modes), [ADR-0030](0030-engagement-workspace.md) (the engagement scope the Cockpit also renders against), [ADR-0028](0028-ai-naming-layer.md) (the AI-named cards the Cockpit displays), [ADR-0032](0032-self-annotation-wizard.md) (the wizard that feeds Glance's corrections). Spec: [PDT-1.0-SPEC §4](../PDT-1.0-SPEC.md#4-the-cockpit--viewer-redesign).

## Context

Today's viewer opens on the **Flow tab** with a 50-node DFG ([architecture/VIEWER.md](../architecture/VIEWER.md)). It is the right surface for an analyst who lives inside the data; it is the **single biggest 30-minute prospect-collapse driver** ([PDT-1.0-SPEC §1](../PDT-1.0-SPEC.md#1-why-this-rewrite-exists)). The five top-level tabs (Flow / Steps / Map / Analysis / Compare), the notation × level matrix ([ADR-0012](0012-active-case-stamping-and-map-matrix.md)), Reference Maps ([ADR-0019](0019-reference-maps.md)), and the grain slider ([ADR-0024](0024-step-grain-as-view-time-rollup.md)) form an excellent **analyst's instrument panel** — and there are no analysts in the target user population.

The PDT 1.0 framing is *consulting augmentation*: the consultant wants summary-first review, the worker (immediately after capture) wants to confirm what was observed, and the rare depth-user wants to slice and dice. Five tabs into a DFG fits none of those.

The straightforward fix is to default to a summary surface and hide the depth behind a toggle. But the existing five-tab UX is a real investment ([ADR-0010](0010-ux-overhaul-viewer-recorder.md), [architecture/VIEWER.md](../architecture/VIEWER.md), [architecture/VIEWER-TIMELINE.md](../architecture/VIEWER-TIMELINE.md)) and a real value-add for some users. Deleting it forces a worse experience on the consultant who *does* want to verify an AI claim by drilling into the underlying trace.

## Decision

**Three contextual defaults of one app — Glance, Cockpit, Workshop — sharing state, routing, and most components.** Mode is inferred from the user's recent actions and the artefact viewed; one click in the top bar overrides; mode is persisted per Engagement.

| Default | Who lands here first | Intent |
|---|---|---|
| **Glance** | Worker, immediately after their session normalises | "Show me what I did, let me confirm or correct it" |
| **Cockpit** | Consultant (during engagement) or client champion (after) | "AI found these; review, promote, edit, export" |
| **Workshop** | Whoever needs depth — analyst, RPA dev investigating a candidate | "Slice, dice, drill, refine — the existing five-tab depth" |

The current "open on the Flow tab DFG" default is **retired.** A fresh install opens whichever default the role + recent-action heuristic infers. Workshop is always one click away.

Constraints baked into the decision:

- **Three defaults, one app.** Not five separate UIs. Glance, Cockpit, and Workshop share state, routing, the timeline subsystem ([architecture/VIEWER-TIMELINE.md](../architecture/VIEWER-TIMELINE.md)), the grain slider ([ADR-0024](0024-step-grain-as-view-time-rollup.md)), and the export pipeline. They are *layouts* over the same data, not separate products.
- **Workshop is the existing UX, rehomed.** The five tabs and the notation × level matrix ([ADR-0012](0012-active-case-stamping-and-map-matrix.md)) move behind a `[ Cockpit | Depth ]` top-bar toggle. **Nothing is deleted.** The investment is preserved; the default is changed.
- **Cockpit is the net-new surface.** One column, top-to-bottom, read like a memo: headline numbers, process candidates with confidence, "what stood out" items, self-annotation progress. Each item is a verb (click → process detail view); every claim has a confidence + provenance pop-out. Renders against both `session` and `engagement` scopes ([ADR-0030](0030-engagement-workspace.md)).
- **Glance is the worker's introspection view.** Single-column timeline-as-story, AI labels overlaid on recorded events, one-click corrections. Reuses the timeline subsystem with an AI-label overlay and inline edit affordance. The Self-Annotation Wizard ([ADR-0032](0032-self-annotation-wizard.md)) feeds Glance with confirmed labels; Glance corrections feed the Pattern Layer's disagreement loop ([ADR-0029](0029-pattern-layer.md)).
- **Mode inference, with override.** Glance for a session ≤24h old that the current user recorded; Cockpit for any other Engagement or Session view; Workshop only when explicitly toggled. The top-bar toggle is the override; the choice persists per Engagement.
- **Disagreement is first-class everywhere.** Every AI-generated label in Glance, Cockpit, and Workshop has a one-click reject / edit affordance. Rejections store as negative examples in `annotations.json`; the next normalisation pass re-mines with them as constraints. No live retraining.
- **Coherence discipline ([COHERENCE-AUDIT](../architecture/COHERENCE-AUDIT.md)).** Every new verb has its inverse (Accept ↔ Reject, Edit ↔ Revert, Promote ↔ Demote); every confidence number has its provenance pop-out as a legend; the top-bar mode toggle is the control-interaction; a real-run e2e check pins the Cockpit-first default ([PDT-1.0-SPEC §7.4](../PDT-1.0-SPEC.md#74-guard-updates-chip-guardrailsmd)).

A **Develop drawer** (RPA-bot scaffold export, selector dumps) is deferred — built on top of the process detail view the first time an actual RPA dev asks for it ([PDT-1.0-SPEC §4.1.1](../PDT-1.0-SPEC.md#411-three-contextual-defaults-of-one-app)).

## Consequences

**Positive**
- The 30-minute prospect-collapse driver is addressed. A new install opens on synthesised conclusions, not raw evidence.
- The existing depth UX is honoured — the consultant who needs Workshop is one click away, not "back to v0.22."
- Glance is the highest-leverage entry point for the largest user population (every recording worker) and the highest-quality training-signal source for the Pattern Layer ([ADR-0029](0029-pattern-layer.md)).
- Capture feels like agency, not surveillance. Workers see what was observed and choose to submit.

**Negative / accepted**
- New top-bar UI and mode-inference logic. The persistence per-Engagement keeps a returning consultant in their preferred mode without forcing a global preference.
- A returning v0.22 user has to find Workshop on the toggle. The cost is one click; the mitigation is documentation in the release notes.
- The Cockpit's "every claim has provenance" promise is load-bearing — if a number renders without a click-through to its source measurement, the integrity story leaks.

**Reversal.** The toggle is reversible by definition — the consultant can pin Workshop as their personal default, and the existing five-tab UX is unchanged behind it. If the Cockpit underperforms with real consultants, the inference rule can default to Workshop instead. The data model is untouched either way.
