# Documentation Coverage & Consistency Audit

> **Update — 2026-06-02 (reconcile to v0.22.2).** A pass over the whole doc set
> against the code landed since v0.20.0 (now **v0.22.2**: v0.20.1 polish, v0.21.0
> Compare drill-downs + [ADR-0027](adr/0027-retire-per-step-path-flags.md), and the
> v0.22.0–0.22.2 App Library discovery hardening). **Fixed:** the stale "Active
> direction" / "What's new" framing in `CLAUDE.md` + `README.md` (now v0.22.2 with
> a *Since v0.20.0* increment group); the docs index gained the **ADR-0027** row +
> a refresh marker; `architecture/OVERVIEW.md` marker bumped; the **vocab README**
> "Author your own" flag guidance corrected to `waste`-only (ADR-0027 — it still
> told authors to set the retired `automation_candidate` / `exception_path`);
> `FEATURES.md` App Library bullet gained the **delete** verb + the enriched
> discovered-row context; `architecture/VALUE-CHAIN-REVIEW.md` SEAM 4 got an
> ADR-0027 resolution note (the four-flag "write-only" leak is closed); and
> `DEPLOY.md` now documents that "Discover from window" needs the capture app in a
> **sibling folder** (previously only in the CHANGELOG). **Found already current:**
> `shared/SCHEMA.md` (already reconciled to ADR-0027 — `flags.waste` is the only
> per-step flag) and `adr/README.md` (already registers 0027). **Flagged, not a doc
> edit:** two stray empty vocab files (`app_vocabularies/discord.yaml` is an empty
> stub, `spotify.yaml` is whitespace-only) left over from 0.22.2 stress-testing —
> untracked, not catalogue-worthy, candidates for cleanup; and a release-tag drift
> (`package.json` is 0.22.2 but the latest git tag is `v0.21.0` — the CHANGELOG
> already records 0.22.0–0.22.2, but no `Release v0.22.x` commit/tag was cut).
>
> **Update — 2026-05-31 (v0.20.0 release prep).** A full doc-reconciliation pass
> ran the whole doc set against the code for the v0.20.0 release (this session,
> branch `docs-and-release-v0.20.0`). Closed the v0.20.0 coverage gaps:
> CLAUDE.md "Active direction" + README "What's new" rewritten to the v0.20.0
> story; FEATURES.md gained €-ROI / grain slider / Reference Maps / PII+consent /
> recorder-confidence / point-and-learn / map-readability; the architecture set
> (VIEWER, VIEWER-TIMELINE, NORMALIZATION, CAPTURE, DATA-MODEL) brought current
> (incl. the stale CAPTURE window table — `status-window` / `obs-settings-window`
> were already removed in code — and the dropped standalone `dagre` script tag);
> hardcoded line/test counts removed where found; the docs index + ADR listing
> updated; ADR-0025 flipped Proposed→Accepted; **ADR-0026** recorded the
> ship-unsigned + services-boutique-scope decisions. `shared/SCHEMA.md` was
> re-audited and found already complete. The 2026-05-23 findings below remain the
> historical record of the prior pass.

**Date:** 2026-05-23 · **Status:** RESOLVED (worked through 2026-05-23; the branch this was performed on, `viewer-refactor`, was merged into `master` at v0.17.0) · **Method:** a full pass across
everything delivered — the capture component, the CHANGELOG/git delivery record vs.
the ADRs + architecture reference, and ADRs 0001–0009 plus the architecture docs not
refreshed in the v0.15.0 pass — cross-checked against the on-disk code. Every finding
below was verified against the source; one agent claim was checked and **dropped as
false** (see end).

This is a worklist for the next documentation pass, grouped as the three buckets
requested: **NOT COVERED**, **SHOULD BE COVERED**, **INCONSISTENT**. IDs are stable
references.

> **RESOLVED — 2026-05-23.** All 30 findings were worked in the six-step order below.
> Two deviated from the literal suggestion (both re-verified against source): **IN-9**
> — the "missing `[0.11.0]`" was a *renumber* to 0.12.0 (a version note now explains
> the gap, rather than duplicating content); **SC-6** — Studio Dark was already fully
> documented in `architecture/DESIGN-SYSTEM.md`, so no ADR was written. The SC-7…SC-9
> judgment calls landed as **[ADR-0014](adr/0014-distribution-model.md)** (distribution),
> **[ADR-0015](adr/0015-intra-session-repetition-alignment.md)** (intra-session
> alignment), and a closure table in `architecture/VALUE-CHAIN-REVIEW.md`.

---

## NOT COVERED — in the code / delivered, absent from the docs

| ID | Where | Gap |
|----|-------|-----|
| NC-1 | `capture/config.js` → CAPTURE.md | Config keys present in `DEFAULTS` but undocumented: `interactions.exclude_processes`, `interactions.verbose`, `idle_threshold_seconds`, `taxonomy_version`, `storage_warn_gb`, `screenshots.quality` / `on_idle_resume_minutes` / `display`. |
| NC-2 | `capture/session.js` → SCHEMA.md | `manifest.json` writes `purpose` (`process` / `app_prep`) and `prep_app`; neither is in SCHEMA's manifest shape. |
| NC-3 | `capture/main.js` → CAPTURE.md / FEATURES.md | The **App-Vocabulary prep-session** flow (`startAppPrepSession`, `vocab-prep` engagement parking, starter marker) is undocumented. |
| NC-4 | `capture/main.js` → SCHEMA.md | `marker.reason` value `auto_close_for_sibling` is emitted but SCHEMA lists only `auto_end_idle`. |
| NC-5 | NORMALIZATION.md module map | Omits `coalesce.py` (the stage-4 collapse) and `classification_overrides.py`. |
| NC-6 | VIEWER.md module maps | Omits `report-html.js`, `canonical-author.js`, and `views/identity-picker.js`. |
| NC-7 | FEATURES.md (exports) | The **HTML findings report** (`report-html.js`, shipped v0.8/0.9) is missing from the exports list. *(Flagged independently by the CHANGELOG audit and the module-map sweep.)* |
| NC-8 | FEATURES.md / architecture | The Markdown report's **Step-statistics table** (Unreleased) is in no architecture doc or FEATURES. |
| NC-9 | VIEWER.md / DESIGN-SYSTEM.md | The hand-written **DFG → SVG serializer** behind "process-map SVG" export is undocumented beyond the bare `exportSvg` mention. |

---

## SHOULD BE COVERED — decisions / statuses that need a record

**Stale ADR status lines / unchecked-but-done action items:**

| ID | ADR | Issue |
|----|-----|-------|
| SC-1 | ADR-0001 | Status still **"Proposed (revised 2026-05-14)"**, all 8 action items `[ ]` — the C# UIA recorder (`capture/recorder/*`) fully shipped. No record marks it Accepted/closed. |
| SC-2 | ADR-0002 | "Accepted" but all 10 action items `[ ]`, though `app_vocab.py`, `app_vocabularies/sample-*.yaml`, `views/vocab-view.js`, and the SCHEMA vocab fields all exist. *(Uncertain: the "save vocabulary from this session" button — not confirmed.)* |
| SC-3 | ADR-0006 | Status **"Accepted — Phase A in progress"**; Phases A–I shipped (0.7.0+). Items 2/3 `[ ]`. Its governing docs (`IMPROVEMENTS.md`, `IMPLEMENTATION-SPEC.md`) moved to `docs/To-Do/Archive/` — premise + path mentions stale. |
| SC-4 | ADR-0009 | All 10 action items `[ ]`, but the code confirms #2 (`coalesce.py`), #3 (`detect_cases_from_anchors`/`stamp_anchor_cases`), #4 (extended `canonical_match` operators), #6 (taxonomy schema), #8 (`canonical/atm-ticket-handling.yaml`). The redirect note doesn't reconcile the boxes. |
| SC-5 | ADR-0007 | Action item 5 (screenshot on web-app title change) dangling `[ ]` — record as done or dropped. |

**Significant decisions with no ADR at all:**

| ID | Decision | Where it lives now |
|----|----------|--------------------|
| SC-6 | **"Studio Dark" theme** (v0.6.0) — a whole second theme system + runtime toggle + pre-paint application | CHANGELOG + a one-line `theme.js` mention only |
| SC-7 | **Distribution pivot** (v0.2.0 — GitHub Releases, drop in-repo `dist/`, electron-packager) | CHANGELOG + README + BUILD-AND-DIST (mechanics) — no decision record |
| SC-8 | **Intra-session repetition alignment** (ADR-0009's stated *replacement* for cross-session canonical templates) | VALUE-CHAIN-REVIEW prose only; `step-alignment.js` exists but appears partial — no accepted ADR |
| SC-9 | **VALUE-CHAIN-REVIEW Decisions 1/2/3 + the 6 gaps** — several shipped (stats split-brain, re-norm relationship preservation) and are now in ADR-0013, but the review's own items aren't tied back/closed | VALUE-CHAIN-REVIEW.md |

---

## INCONSISTENT — a doc contradicts the code or another doc

| ID | Where | Contradiction |
|----|-------|---------------|
| IN-1 | CAPTURE.md:31-32 | "Events appended **synchronously** (per-event `appendFileSync`), so a crash loses at most the in-flight event." **Wrong** — `tracker.js` (I47) batches activity/interaction on a 500 ms timer (only markers/system flush immediately); the real loss bound is "< 500 ms of queued activity/interaction." |
| IN-2 | SCHEMA.md:507 | "The merge order in `[normalize.py _merge_steps]`" — `_merge_steps` moved to `step_suggest.py`; the link target is also wrong. |
| IN-3 | SCHEMA.md:423 | Invariants say "marker edit / merge / split UIs are **deferred**" — all shipped (Steps-view split/merge, marker edits). |
| IN-4 | SCHEMA.md (interaction kinds) | `focus_changed` / `text_changed` are listed as plain emitted kinds, but the recorder only emits them in **verbose** mode — needs the caveat. |
| IN-5 | OVERVIEW.md:86 | Repo layout calls the viewer "renderer.js + **Pdt\*** modules"; the `window.Pdt*` globals were removed (CommonJS now). |
| IN-6 | interaction-recorder.md:3 | **"Status: Proposed"** though the recorder shipped; its §6.7 DEFAULTS omits `verbose` / `debounce_ms` / `exclude_processes`. |
| IN-7 | CAPTURE.md:43, :87 | "main.js is now ~1,210 lines" (actual **1,532**); "59 tests" (actual **65**). CAPTURE-ARCHITECTURE-ISSUES C1 says "41" — also stale. |
| IN-8 | README.md | Tops out at **"What's new in v0.5.0"**; CHANGELOG + CLAUDE.md + both `package.json` are **0.15.0**. ~10 versions stale. |
| IN-9 | CHANGELOG.md | **No `[0.11.0]` section** — sequence jumps `0.12.0 → 0.10.0` though a `Release v0.11.0` commit exists. |
| IN-10 | SPEC-DEFERRED.md | Context frame stale ("v0.2.0 shipped, nothing since," UX overhaul "uncommitted," source on `master`) — reality is v0.15.0 on `viewer-refactor`. Items listed deferred that shipped: P1.1 (range selection), P1.3 (minimap), P1.4 (per-step lane), P1.10 (persistent zoom/scroll), P2.8 (scope-to-playhead), P2.12 (window-title lane). |
| IN-11 | COHERENCE-AUDIT.md | The "recognition built viewer-side only; Python still uses old logic" cascade point is outdated — `normalization/recognition.py` + `shared/recognition-patterns.json` + recognition-led classification shipped (ADR-0011 #3/#4/#5). |
| IN-12 | ADR-0008:105 | Markdown link `[…](../To-Do/ANALYSIS-LAYER-FOLLOWUPS.md)` is **broken** — the file is now in `docs/To-Do/Archive/`. ADR-0006's prose paths to `IMPROVEMENTS.md` / `IMPLEMENTATION-SPEC.md` are stale for the same move. |

---

## Suggested order for the fix pass

1. **Correctness-first (IN-1, IN-2, IN-3, IN-4, IN-5):** these mislead a reader about how the system behaves (crash-loss bound, where code lives, what UIs exist). Cheap, high-value.
2. **Version truth (IN-8, IN-9):** refresh README to v0.15.0; add the missing `[0.11.0]` CHANGELOG section (or note the skipped tag).
3. **ADR hygiene (SC-1…SC-5, IN-12, IN-6, IN-7):** flip stale statuses, tick done action items, fix the broken/stale links and counts.
4. **Stale-frame docs (IN-10, IN-11):** refresh SPEC-DEFERRED's context + mark shipped items; update the COHERENCE-AUDIT recognition point.
5. **Coverage fills (NC-1…NC-9):** add the missing config keys, manifest fields, modules, and export surfaces to CAPTURE.md / SCHEMA.md / NORMALIZATION.md / VIEWER.md / FEATURES.md.
6. **New ADRs (SC-6…SC-9):** decide whether the dark theme, the distribution pivot, intra-session alignment, and the value-chain decisions each warrant a short retroactive ADR.

## Checked and dropped (not a real finding)

- The audit flagged VIEWER-TIMELINE.md / DESIGN-SYSTEM.md as citing wrong **flat** viewer paths and claimed `step-editor.js` / `phase-editor.js` don't exist. **Verified false:** both files exist flat in `viewer/`, DESIGN-SYSTEM.md:16 correctly cites `viewer/views/flow-view.js`, and the `step-editor.js` / `phase-editor.js` links resolve. No action.
