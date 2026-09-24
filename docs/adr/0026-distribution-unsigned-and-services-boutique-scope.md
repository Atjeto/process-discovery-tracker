# ADR-0026: Ship unsigned, by design; scope as a services boutique, not an enterprise product

**Status:** Accepted, recorded 2026-05-31. Decision 1 (ship unsigned) stands. Decision 2 (the scope) is narrowed by [ADR-0029](0029-ba-helper-refocus.md): PDT is an internal helper for the owner's own work as a process manager, not a services-boutique offering.
**Date:** 2026-05-31
**Deciders:** Project owner
**Related:** [ADR-0014](0014-distribution-model.md) (the distribution model this constrains), [BUILD-AND-DIST.md](../BUILD-AND-DIST.md) + [DEPLOY.md](../DEPLOY.md) (where the unsigned posture surfaces), [NEXT-SESSION-SPEC](../To-Do/NEXT-SESSION-SPEC.md) (the plan of record this prunes), [VALUE-CHAIN-REVIEW](../architecture/VALUE-CHAIN-REVIEW.md) (the strategic frame).

## Context

Two questions kept resurfacing in the backlog as "remaining work" without ever
being decided — so each release-prep pass re-litigated them. They are not
engineering questions; they are **owner scope decisions**, and recording them
here stops the churn.

1. **Code-signing.** [ADR-0014](0014-distribution-model.md) ships unzip-and-run
   binaries that are not code-signed, and the Wave-0 plan queued "wire the
   internal self-sign cert into `build-distribution.ps1`" as a few-hours task.
   The build script grew that scaffolding (`-CertThumbprint` + `signtool sign`
   after each `.exe`). The open question was *whose* certificate signs the
   release.

2. **Product surface.** The strategic roadmap (§11 workstreams, the Master
   Assessment, the Fit Analysis) sketched a broad enterprise-product surface —
   BYOC / web viewer / multi-user, LLM-augmented vocab labeling, cross-recording
   trace-merge, a "living projection" deliverable, MDM/Intune packaging,
   third-party pentest, security questionnaires (SIG-Lite / CAIQ), AV/EDR fleet
   validation, recorder-in-CI. Treated as backlog, this list keeps re-appearing
   as deferred-but-planned work that an autonomous pass might pick up.

## Decision

### 1. Distribution: ship UNSIGNED, by design.

**Code-signing with the *company* certificate is declined.** PDT is the **owner's
intellectual property**; it is not to be signed under the employer's
code-signing license. The Windows "unknown publisher" / SmartScreen prompt on
first launch from a fresh machine is **accepted** as the cost of that boundary.

- The `-CertThumbprint` scaffolding in `scripts/build-distribution.ps1` **stays**
  — it is correct, tested, and ready for a *future owner-held* certificate — but
  it is **not used now**. The release build runs **without** `-CertThumbprint`,
  so every `.exe` ships unsigned.
- This supersedes the Wave-0 "self-sign the binaries with the internal cert"
  item and ADR-0014's "production deployment should add EV code signing" aside:
  the deployment is internal, the prompt is acceptable, and signing under the
  employer's cert is off the table for IP reasons. EV signing for unknown
  external customers remains a non-goal (see decision 2).

### 2. Scope: services-boutique, not enterprise-product.

PDT is the engine behind an **owner-run process-discovery service**, not a
self-serve enterprise product. The deliverable is an analyst report (process
maps, a PDD, an automation/ROI assessment) produced by the owner on real
engagements — not a platform other teams provision and operate.

The following are therefore **out-of-scope / deferred — not backlog.** They are
not "remaining work"; they are explicitly off the table for this product shape,
and an autonomous pass should **not** pick them up:

- **BYOC / web viewer / multi-user.** The two-machine, air-gapped, single-analyst
  model is the product, not a stepping stone.
- **LLM-augmented vocab labeling.** There is no LLM in the product (Claude does
  development-time probing; the shipped pipeline is deterministic). Vocab
  authoring is the point-and-learn discovery flow ([ADR-0025](0025-in-app-vocabulary-discovery.md)) plus hand curation.
- **§11f cross-recording trace-merge.** Stitching cases across separate
  recordings.
- **The "living-projection" deliverable.** Never concretely defined; dropped.
- **MDM / Intune packaging.** Unzip-and-run is the install story (ADR-0014).
- **Third-party penetration test.**
- **Security questionnaires (SIG-Lite / CAIQ).**
- **AV / EDR fleet validation.**
- **Recorder-in-CI.** CI stays recorder-free and Electron-free (the golden gate
  runs on pre-recorded `events.jsonl`); the recorder is validated by
  `Recorder.Tests` + owner-run real captures, not a self-hosted desktop runner.

The calibration and validation those items assumed (real Salesforce / ServiceNow
/ SAP / Office captures, threshold tuning, coverage hardening on hard frameworks)
is covered by **real engagements** — owner-run, with ~10 applications prepped —
not by building enterprise-grade automated infrastructure to simulate them.

## Consequences

**Positive**
- Two recurring "remaining work" items stop resurfacing; the plan of record
  shrinks to what the product actually is.
- The IP boundary is explicit: the company cert never touches an owner-IP binary.
- CI stays light (no recorder, no signing infra, no questionnaire upkeep).

**Negative / accepted**
- First launch on a fresh machine shows the SmartScreen / unknown-publisher
  prompt. Mitigation is documentation (DEPLOY.md), not signing.
- The product cannot be handed to another team to operate without re-opening the
  scope decision. That is intended.

**Reversal.** If the owner acquires a personal code-signing certificate, decision
1 reverses by passing its thumbprint to the (already-present) build scaffolding —
no code change. Decision 2 reverses item-by-item only on an explicit owner call,
not by an agent inferring it from the old roadmap.
