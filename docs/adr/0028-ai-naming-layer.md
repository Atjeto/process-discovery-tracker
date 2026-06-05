# ADR-0028: AI Naming Layer — local LLM, structured-input-only, no-numbers-from-LLM

**Status:** Accepted — recorded 2026-06-05 (design only; build is Phase 4 of the [PDT 1.0 spec](../PDT-1.0-SPEC.md))
**Date:** 2026-06-05
**Deciders:** Project owner
**Related:** [ADR-0017](0017-suggested-markers.md) (the `auto_*` suggest-don't-mutate pattern this reuses), [ADR-0023](0023-recorder-capture-confidence.md) (the capture-confidence gate that feeds the refusal path), [ADR-0026](0026-distribution-unsigned-and-services-boutique-scope.md) (records the prior "no LLM in the product" stance this supersedes), [ADR-0029](0029-pattern-layer.md) (the upstream layer that produces what this names), [ADR-0016](0016-segment-level-automation-candidacy.md) (the €-ROI band the LLM never touches). Spec: [PDT-1.0-SPEC §3.2](../PDT-1.0-SPEC.md#32-naming-layer--local-llm-scoped-to-two-uses).

## Context

The v0.x lineage hard-coded a no-LLM stance — [ADR-0026 §2](0026-distribution-unsigned-and-services-boutique-scope.md) lists "LLM-augmented vocab labelling" as out-of-scope, and the user-facing memory pinned "no LLM in product" against early prompt-engineering tangents. That stance held while the integrity story was the load-bearing differentiator. The PDT 1.0 productisation pass ([PDT-1.0-SPEC.md](../PDT-1.0-SPEC.md)) re-opens it because the analyst-shaped hole is real: deliverables need *business-language names* the heuristics can't supply, and the visible "AI wow" that closes the 30-minute prospect-collapse comes from exactly one place — the Cockpit reading "Review incident" instead of `cluster_4_in_servicenow`.

The trap to avoid is the full version: five LLM uses (activity / screen / phase names, full PDD body, interview questions) means ~2.5 cycles of prompt engineering, an eval harness, and a hallucination surface per use. Most of the value sits in one prompt. Screen names already work via the App Vocabulary + window-title patterns. Phase names template well from the sequence of activity names. The PDD body wants templated number substitution, not generative prose. Self-annotation questions are a heuristic-template problem ([ADR-0032](0032-self-annotation-wizard.md)). Each of those, done by LLM, adds a hallucination risk for no marginal quality gain — and a hallucinated number ends the product.

## Decision

**Add a local-first LLM as a normalisation stage, scoped to exactly two uses: activity naming and the PDD executive-summary paragraph.** Everything else stays deterministic. This is a strategic reversal of the "no LLM in product" stance recorded in [ADR-0026 §2](0026-distribution-unsigned-and-services-boutique-scope.md) and the prior user-memory pin; the reversal is bounded by the hard rules below so the integrity backbone ([PDT-1.0-SPEC §9](../PDT-1.0-SPEC.md#9-integrity-backbone--what-does-not-change)) survives.

The two LLM uses:

| Input (only the derived stream) | Output | Why kept |
|---|---|---|
| Activity cluster: recognised interactions, window titles, control captions, app context, durations, frequency | Activity name + short description + confidence | Load-bearing for the Cockpit demo. |
| Process candidate: name + summary statistics + variant tree + automation candidates | Draft executive-summary **paragraph only** (PDD §1) | The one piece of prose where narrative voice matters. |

Hard rules baked into the decision:

- **Never sees raw events.** Only the derived stream — same boundary the §11f PII masking work enforces. No keystrokes, no clipboard, no value contents.
- **Never produces numbers.** All numerical content (durations, counts, €) is templated from measured quantities; the LLM produces prose *around* them. A guard parses generated PDD prose and fails if it contains numerical tokens not present in the templated number set ([PDT-1.0-SPEC §7.4](../PDT-1.0-SPEC.md#74-guard-updates-chip-guardrailsmd)).
- **Capture-confidence gates the refusal.** Below the configured threshold the layer returns `"insufficient signal"` with an explanation — same posture as [ADR-0023](0023-recorder-capture-confidence.md)'s honest degradation. No confabulation when the inputs don't support a name.
- **Suggest, don't mutate.** Every output lands in the `auto_*` namespace — the [ADR-0017](0017-suggested-markers.md) pattern. The consultant accepts, edits, or rejects; manual overrides survive re-normalisation.
- **Local-first.** Default backend is **Ollama** (`http://localhost:11434`) with a 7–14B instruct model selected in app settings, not bundled. If Ollama is unreachable the layer degrades to *"no naming"* — the Pattern Layer's structural outputs still render with cluster IDs. The integrity story is unchanged; only the visible polish degrades.
- **Cloud is opt-in only.** Anthropic / OpenAI / Azure backends are disabled by default behind an explicit "I understand this sends derived structures off-machine" consent gate. The no-cloud-by-default buyer is unaffected; the higher-quality buyer opts in.
- **Provenance on every output.** Each name carries a confidence score and the list of input cues that drove it; the Cockpit shows both, the consultant can drill in.

Module layout: `normalization/naming/` — `llm_client.py`, `activity_namer.py`, `pdd_prose.py`. Stage slot: after `segment_assembly` in `pipeline_stages.py`, behind a `--with-naming` flag (default off). The self-annotation question generator that the spec originally placed here is heuristic-templated, not LLM ([ADR-0032](0032-self-annotation-wizard.md)).

## Consequences

**Positive**
- The 30-minute prospect-collapse driver is addressed: the Cockpit reads in business language.
- Integrity unchanged. Numbers stay measured; raw events stay local; manual overrides win.
- Cost contained. ~1 cycle for scoped naming vs ~2.5 cycles for the full version; ~80% of the visible quality.
- Buyers who picked PDT for the no-cloud story still get them — the LLM is local by default and optional.

**Negative / accepted**
- New dependency surface (Ollama install) for the visible-polish path. The fall-back to cluster IDs is documented.
- Local 7–14B quality on the PDD executive-summary paragraph may be uneven; the cloud-opt-in backend is the escape hatch ([PDT-1.0-SPEC §11 open question](../PDT-1.0-SPEC.md#11-open-questions)).
- A new "AI suggested this" surface to label and explain in the UI. The Cockpit's confidence + provenance pop-out is the answer.

**Reversal.** If the no-numbers guard or the consent gate is bypassed at any point, the layer is gated off in the pipeline until the guard is restored — same posture [ADR-0017](0017-suggested-markers.md) takes for a broken signature contract.
