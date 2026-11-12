# Disclosure Model — where content renders

> The presentation ruleset for every viewer surface. It applies the Honesty
> Redesign's Memo / Evidence / Machine layers ([LAB-PHASE-SPEC.md](../LAB-PHASE-SPEC.md) §1)
> as *mechanical* placement rules, so disclosure is uniform instead of
> re-invented per surface. It introduces no new taxonomy; tier gates always
> outrank everything here. Companion worklist:
> [DESIGN-CRITIQUE-2026-07-01.md](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/To-Do/DESIGN-CRITIQUE-2026-07-01.md)
> (on branch `product-edition`).

## The model

For every piece of content ask one question: **does the reader need this to
believe the claim?**

| Altitude | Reader | Renders as | Cost to reach |
|---|---|---|---|
| **Memo** | business user — "what did we find" | resident card / tile / badge; a claim sentence + the one number that carries it | zero |
| **Evidence** | analyst — "show me" | expand-in-place (chevron / card click, inline, no navigation) | one click, stays on page |
| **Machine** | specialist — "let me tune it" | named drawer at the bottom of the surface, collapsed by default, state persisted | a deliberate act |

Exactly **four mechanics** — never invent a fifth:

1. **Resident** — no interaction. Memo only.
2. **Expand-in-place** — Evidence only. Opens inline below the claim.
3. **Named drawer** — Machine only (`▸ ADVANCED VIEWS`, `▸ MACHINE LAYER: …`).
4. **Export** — files, memo, Copy-for-AI-review. Anything deeper than Machine
   never renders at all.

Plus the existing **replace-pattern** for tier gates: gated content is
*replaced* by its call-to-action — never rendered grayed, empty, or
default-filled.

## The ten rules

1. **Lead with the sentence.** Every resident block opens with a claim in
   business English. Number grids, mono strips, and charts are Evidence — one
   click behind.
2. **One fact, one place.** Two chrome elements stating the same fact merge.
3. **Methodology renders once** — at the detector/section group, or behind ⓘ.
   Never repeated per instance.
4. **Raw tokens are never resident.** Paths, regexes, snake_case field names,
   transaction codes get a friendly rendering (chip, thumbnail, "unnamed
   control" treatment with the one-click cure attached). The raw value stays
   reachable one layer down.
5. **Empty ≠ zero-information.** A module with nothing judged or measured yet
   renders its CTA (replace-pattern), never a default-filled chart.
6. **Hero weight is earned.** Hero type (34px) only when the magnitude
   survives it; below a floor, a sentence carries the number instead.
7. **Static chrome demotes.** Anything that cannot change while the analyst
   works lives in the collapsed summary band, not a resident chip row.
8. **Landings are one sentence + actions.** Long conceptual prose goes behind
   a `▸ How this works` disclosure.
9. **Preference collapses, gates decide.** Analysts may collapse any Evidence
   module; the state persists per analyst (`localStorage`, `pdt.*` keys, same
   pattern as `pdt.theme`). A tier gate always wins: a gated module shows its
   CTA even when expanded, and a collapse never hides a CTA.
10. **Every disclosure has an inverse and remembers** — open/close, persisted
    drawer state, dismissed helpers stay dismissed (the COHERENCE-AUDIT
    checklist applied to disclosure).

## Surface mapping

- **Overview** — the Memo layer. Finding cards: claim + include-in-memo
  resident; evidence numbers, screenshot thumbnail, methodology behind
  expand-in-place.
- **Analysis** — Evidence modules under a uniform header: *title + one-line
  takeaway + chevron*. The takeaway renders even when collapsed (it is the
  module's Memo altitude, e.g. "not judged yet — click to set"). Bodies
  expand; collapse state persists per analyst; gates keep their CTA.
- **Flow / Steps / Phases**: Evidence. Space follows data: without a video,
  the video stage of a recording shows its screen from its screenshots (its
  header reads SCREEN), and collapses to a slim band only when there is
  nothing to show (rule 5 applied spatially).
- **Map** — the reference implementation: calm resident chain, expert content
  in the named drawer. When in doubt on a new surface, copy the Map.
- **Template / App Library** — Machine-heavy surfaces with a Memo-altitude
  header (rule 8); raw signature fields collapse per row (rule 4).

## Trade-offs (accepted)

- One click to Evidence beats everything-visible: the default screen must be
  readable by the business user standing behind the analyst.
- Persistence is per analyst, not per session — sessions are many, analysts
  are few.
- Expand-in-place beats detail pages — context (timeline, case filter) stays.
- Deliberately out of scope: module marketplaces, layout designers,
  user-defined metrics. The honesty architecture stays the single authority
  on what may render. Revisit a module picker only if Analysis grows past ~7
  modules.
