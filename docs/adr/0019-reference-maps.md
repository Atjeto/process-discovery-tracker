# ADR-0019: Reference Maps — decoupled, editable BPMN copies of a mined map

**Status:** Accepted — implemented 2026-05-31 (`viewer/reference-maps.js`, `viewer/refmap-ui.js`, `editable` mode in `viewer/bpmn-viewer.js`, the To-Be section in `normalization/pdd_export.py`, `shared/SCHEMA.md` §`reference_maps`)
**Date:** 2026-05-31
**Deciders:** Project owner, analyst (process-discovery lead)
**Related:** [ADR-0012](0012-active-case-stamping-and-map-matrix.md) (the notation × level map matrix the fork snapshots from), [ADR-0013](0013-value-free-grouping-and-map-readability.md) (the mined Process/Flow diagrams), [ADR-0017](0017-suggested-markers.md) / [ADR-0018](0018-anchor-candidates.md) (the suggest-don't-mutate precedent this extends), [COHERENCE-AUDIT](../architecture/COHERENCE-AUDIT.md), [VALUE-CHAIN-REVIEW](../architecture/VALUE-CHAIN-REVIEW.md) (where meaning leaks).

## Context

The process map is **mined evidence**: the Process diagram (BPMN) and Flow diagram (DFG) are projections of the annotations, regenerated non-destructively on every `normalize --mine`. Today the viewer renders the mined `.bpmn` through the **bpmn-js modeler** but hides its palette/context-pad in CSS (`.map-host .djs-palette { display:none }`), so the analyst can only drag nodes; those nudges persist back to the generated file.

Analysts asked for **real editing** — reshape the map, add steps the capture can't see (a phone call, a paper form, a decision), draw a proposed future state. The naive version (un-hide the palette on the live map) collides head-on with the architecture: a generated artifact cannot also be a hand-authored document, and re-mining would either clobber the edits or be clobbered by them. That tension — *what an edit means under re-normalization* — is the hard 90%, not the drawing surface.

The reframing that dissolves it: don't edit the live map — **fork a decoupled copy**. A reference map is a standalone, fully-editable BPMN that data flows *into* once (at the fork) and never out of. The pipeline never re-mines, merges, or regenerates it. This is the same posture as ADR-0017/0018's "suggest, don't mutate," taken one step further: *author freely, but in a leaf that can't lie about being evidence.*

## Decision

**Add "Fork to reference map": from the current Process-diagram cell, snapshot the live (laid-out) view into a standalone, fully-editable `.bpmn` copy stored under the session folder, surfaced in a per-session Maps gallery, typed As-Is / To-Be / Reference, and selectable to embed into the PDD.**

Constraints baked into the decision:

- **One-way leaf.** A reference map never feeds analysis, is never re-mined, never merged. The only "update" path for staleness is **Re-fork from current** (a *new* copy); merge is deliberately absent.
- **What you see is what you fork.** The fork snapshots the live viewer's current XML (`bpmn-viewer.exportXml()`, post-dagre + any drags), not the raw on-disk `.bpmn` (whose mined coordinates are poor). The copy opens identical to what the analyst was looking at; the editor skips dagre-on-open so the saved hand-layout is never re-flowed.
- **Reuse, don't rebuild.** The editor is the existing bpmn-js modeler in a host that is *not* `.map-host` (so the palette shows) with an `editable` flag; `saveXML`-to-path already persists every change. The PDD image bridge already exists for the DFG (`exportPng → --pdd-map-image → add_picture`); the To-Be path adds only an off-screen `saveSVG → PNG` rasteriser and a `--pdd-tobe-image` arg.
- **Storage = sidecar + blob.** Metadata lives in `annotations.json reference_maps[]` (the established analyst sidecar; preserved verbatim by re-normalize via one `setdefault`). The `.bpmn` blobs live in `<session>/derived_maps/<map_id>.bpmn`, mirroring the per-case `process_maps/` convention. Both are post-capture, so they correctly fall outside `session-integrity.json`.
- **Provenance is mandatory (the honesty invariant).** A reference map can never be mistaken for the live mined map. Every copy carries its lineage — forked-from cell, fork date, a blake2b hash of the source for drift detection — shown as a badge in the editor + gallery ("hand-edited, not updated by analysis"), and stamped into the PDD as a caption ("analyst-authored, NOT mined from the captured events"). A detached copy mistaken for current evidence is the textbook meaning-leak; the labelling is what prevents it.
- **Coherence discipline.** New verbs and their inverses: **Fork ↔ Delete**; **Edit** (bpmn-js command stack = in-editor Ctrl+Z; whole-copy inverse = Delete); **Set kind**, **Set PDD role** (exclusive per slot — selecting steals it), **Re-fork** (the staleness escape hatch); every metadata verb persists through `Session.saveAnnotationsWithUndo`, so app-level Ctrl+Z reverts it. Legend: the editor's distinct chrome + warning badge; the gallery's kind/PDD/drift chips. Real-run: fork a copy, edit, reopen → the live map and `analysis.json` are unchanged; the copy survives a re-analyze.

### Annotations schema

One additive key, `reference_maps[]`; each entry: `map_id`, `name`, `kind` (`as_is`|`to_be`|`reference`), `file` (relative path under `derived_maps/`), `source` (`{notation, level, scope}` it was forked from), `forked_from_hash`, `forked_from_sig`, `forked_at`, `edited_at`, `pdd_role` (`null`|`as_is`|`to_be`), `notes`. See [SCHEMA](../../shared/SCHEMA.md) §`reference_maps`.

**Drift (amended 2026-09-24).** `forked_from_hash` hashes the source file's bytes. Every analysis writes the same step map in a new element order, so a byte hash called every copy stale. `forked_from_sig` is a signature of the process the source draws (`reference-maps.js` `processSignature`): its tasks, events, flows, gateways by their neighbours, and data objects and notes with their task; ids, layout and documentation are ignored. A copy that stores `forked_from_sig` is stale when the current source's signature differs; a copy made before it keeps the byte rule.

### Re-normalize contract

`pipeline_stages._init_existing_anno` adds `setdefault("reference_maps", …)` and **no stage ever writes the key**. Because the pipeline copies the prior annotations forward and only regenerates the `auto_*`/suggestion keys, `reference_maps[]` and the `derived_maps/*.bpmn` blobs round-trip every `--mine` untouched.

## Consequences

**Positive**
- Full BPMN authoring (the entire bpmn-js palette) with **zero** risk to mined evidence — the copy is inert.
- A genuine consulting deliverable: a hand-authored **To-Be** map embeds in the PDD beside the automation assessment, captioned so it can't be confused with the As-Is.
- Portable: a saved `.bpmn` opens in any bpmn.io tool (Adonis, Camunda Modeler, the bpmn.io demo) — "export copy" is free.
- Tiny new surface area: a store module, a UI controller, a CSS-scoped editor flag, an SVG→PNG rasteriser, a PDD section.

**Negative / accepted**
- A copy can go stale as the live map is re-mined. Mitigated by the drift chip + Re-fork; not auto-reconciled (by design — merge is the trap).
- The bpmn-viewer is a singleton, so the editor is a separate full-screen surface (can't show the live map and editor side-by-side). Acceptable; a `createBpmnViewer(host)` factory is the future move if side-by-side is wanted.
- An analyst can still select a stale/wrong map for the PDD. The provenance caption makes it loud but cannot fully prevent it.

## Alternatives considered

- **Un-hide the palette on the live map.** Rejected: severs the evidence link and forces a destructive re-normalize merge. The hard problem, taken head-on instead of designed around.
- **Store reference maps as their own manifest file.** Rejected: duplicates the proven `annotations.json` preserve path for no gain.
- **SVG-native PDD embed.** `python-docx add_picture` can't embed SVG; rasterising to PNG in the renderer is the pragmatic bridge (EMF for crisp vector is a future option).
- **Bidirectional sync / conformance feedback (compare To-Be against the mined As-Is).** Tempting but re-introduces coupling; deferred, and if built must stay a read-only diff that writes nothing back.
