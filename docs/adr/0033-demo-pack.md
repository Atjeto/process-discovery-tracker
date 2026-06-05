# ADR-0033: Demo Pack — one polished Engagement shipped with the installer

**Status:** Accepted — recorded 2026-06-05 (design only; build is Phase 1 of the [PDT 1.0 spec](../PDT-1.0-SPEC.md))
**Date:** 2026-06-05
**Deciders:** Project owner
**Related:** [ADR-0002](0002-app-vocabularies.md) (the ServiceNow vocabulary that makes this demo's named activities credible), [ADR-0026](0026-distribution-unsigned-and-services-boutique-scope.md) (the services-boutique scope that frames "demo = sales artefact"), [ADR-0030](0030-engagement-workspace.md) (the engagement structure the Demo Pack populates), [ADR-0031](0031-cockpit-and-workshop-modes.md) (the Cockpit the demo opens against). Spec: [PDT-1.0-SPEC §6.4](../PDT-1.0-SPEC.md#64-demo-pack).

## Context

The 30-minute prospect interest-collapse ([PDT-1.0-SPEC §1](../PDT-1.0-SPEC.md#1-why-this-rewrite-exists)) is the single biggest funnel leak: a skeptical buyer who opens a raw session sees event-fog and decides the tool is for someone else. The fix has two halves — the Cockpit-as-default ([ADR-0031](0031-cockpit-and-workshop-modes.md)) handles the structural side, but the buyer still needs *something to open* that demonstrates the deliverable shape without first running a real engagement.

Today's closest equivalent is `sessions/example-aggregate/` — committed demo data the analyst uses for development. It is one *session*, not one *engagement*, and it is shaped for testing rather than persuasion: not curated, not polished, not buyer-facing.

A prospect demo wants:

- An **engagement-shaped** artefact (multiple sessions, pooled cases, a ranked Process Backlog, finished PDDs, insight cards). The deliverable is the product ([PDT-1.0-SPEC §6](../PDT-1.0-SPEC.md#6-deliverables--what-we-hand-to-the-client)); the demo has to *be* a deliverable.
- **Defensible content.** Anonymised real data, not synthesised demo-fiction. A buyer who notices the demo is fake stops believing the numbers.
- **One excellent example, not three mediocre ones.** Three demos was the original plan; production-quality polish on one demo at launch is the cheaper path to the same funnel outcome.

## Decision

**Ship a pre-canned polished Engagement bundled with the installer at `sessions/demo-pack/`.** One launch engagement at v1.0; more added after the first proves the format. Loaded via **Demo mode** in the engagement Cockpit.

### The launch engagement: ServiceNow IT Service — incident handling

Chosen because the App Vocabulary for ServiceNow is the strongest in repo (the §11d real-value pass calibrated against live ServiceNow sessions). The named activities in the demo will look most credible there; a demo whose activity names render as cluster IDs because the vocab is thin fails the very test it exists to pass.

Contents:

- The engagement Cockpit populated against pooled sessions.
- A 5-row Process Backlog ranked by `(frequency × time × confidence)`.
- Two finished PDDs (Review incident, Reassign incident).
- Three insight cards (PNG) — the slide-ready single-claim deliverables ([PDT-1.0-SPEC §6.3](../PDT-1.0-SPEC.md#63-insight-card-png-one-per-insight)).

Constraints baked into the decision:

- **Real-but-anonymised pilot data, not synthesised.** The Demo Pack is built from actual recordings, with embedded record numbers, names, and identifiers replaced via the §11f PII masking pipeline. Synthesised data fails the integrity test ([PDT-1.0-SPEC §10](../PDT-1.0-SPEC.md#10-success-criteria--how-we-know-this-lands)) — a buyer who pokes at the numbers and notices they don't trace to anything believable walks away convinced PDT confabulates. Anonymised real data traces all the way down.
- **Rebuilt every release.** The Demo Pack is committed under `sessions/demo-pack/` the same way `sessions/example-aggregate/` is, and regenerated as part of the release build. The session golden ([CHIP-GUARDRAILS](../CHIP-GUARDRAILS.md)) is extended to cover the Demo Pack — a regression there fails the gate the same way the existing 10 demo sessions do.
- **One excellent at launch, more later.** Finance and HR demos ship in a later cycle, once the format is validated against real prospect reactions ([PDT-1.0-SPEC §6.4](../PDT-1.0-SPEC.md#64-demo-pack)). Three demos was the original plan; one polished demo lands harder than three mediocre ones at one-third the cost.
- **Demo mode is explicit.** A clearly-labelled "Demo mode" entry point in the engagement Cockpit opens the Demo Pack. The demo is never confused with a real engagement — the Cockpit chrome distinguishes it (same posture [ADR-0019](0019-reference-maps.md) takes for hand-authored vs. mined evidence).
- **Closes the 30-minute test.** The de-risking metric ([PDT-1.0-SPEC §10](../PDT-1.0-SPEC.md#10-success-criteria--how-we-know-this-lands)): a skeptical prospect, no onboarding, opens the Demo Pack and within 30 minutes says *"can we try this on one of our processes."* If the demo fails that test, the demo is the bug — not the rest of the product.

## Consequences

**Positive**
- The funnel-opening artefact is in the box. A prospect demo no longer requires the consultant to run a real engagement first.
- Buyer-visible deliverables (Backlog XLSX, PDD bundle, insight cards) are exercised in the build pipeline every release — they cannot silently rot.
- One credible demo beats three thin ones at the same total cost. Finance / HR are deferred until the format is validated, not abandoned.
- The Demo Pack doubles as training corpus for the deferred Operate-path content ([PDT-1.0-SPEC §6.5](../PDT-1.0-SPEC.md#65-the-configured-tool-itself-the-leave-behind)) — a client champion learning the Cockpit can do so against the demo before their own engagement ships.

**Negative / accepted**
- Bundle weight grows. The Demo Pack is multiple sessions of recorded data + the engagement's pooled artefacts + the rendered deliverables. Acceptable — the installer is unsigned and unzip-and-run ([ADR-0026](0026-distribution-unsigned-and-services-boutique-scope.md)), so a one-time bundle delta is cheap.
- Sourcing the pilot data has to happen before each release. The anonymisation pipeline ([PDT-1.0-SPEC §11f](../PDT-1.0-SPEC.md)) makes this routine, but it is a real per-release task — added to the release checklist.
- A buyer's home turf (Finance, HR) is *not* in the demo at launch. Mitigation: the consultant's own deck + the prospect's own first capture covers that — the Demo Pack is the door-opener, not the close.

**Reversal.** The Demo Pack is a `sessions/<id>/` directory and a Cockpit entry point; removing it is removing the directory. The build pipeline reverts to producing an installer without it. No data-model or code surface depends on the Demo Pack existing.
