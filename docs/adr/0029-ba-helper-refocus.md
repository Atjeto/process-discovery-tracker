# ADR-0029: BA-helper refocus

**Status:** Accepted
**Date:** 2026-09-23
**Deciders:** Project owner
**Related:** [ADR-0026](0026-distribution-unsigned-and-services-boutique-scope.md) (the services-boutique scope this narrows further), [ADR-0028](0028-case-screen-work-items.md) (the case-scoped screen visit this replaces), [ADR-0025](0025-in-app-vocabulary-discovery.md) (the discovery workbench this replaces with light vocab), [ADR-0017](0017-suggested-markers.md) and [ADR-0018](0018-anchor-candidates.md) (the unbracketed-session detectors this cuts), [ADR-0012](0012-active-case-stamping-and-map-matrix.md) (the anchor case-detection mode and map matrix this narrows), [ADR-0016](0016-segment-level-automation-candidacy.md) (the automation-candidacy layer whose ROI extension this cuts), [ADR-0024](0024-step-grain-as-view-time-rollup.md) (the grain slider this narrows), [ADR-0013](0013-value-free-grouping-and-map-readability.md) (the value-free labels this reuses), [ADR-0015](0015-intra-session-repetition-alignment.md) (the alignment engine this supersedes: the runs are compared by draft key instead), [docs/To-Do/BA-HELPER-PLAN-2026-09-22.md](../To-Do/BA-HELPER-PLAN-2026-09-22.md) (the plan of record this closes out), [.claude/agent-findings/2026-09-23_ba-helper-contracts.md](../../.claude/agent-findings/2026-09-23_ba-helper-contracts.md) (the data-shape contracts, C1 to C16 as of 2026-09-24).

## Context

PDT was built as a product for a buyer: a consultant hands a findings memo and
a PDD to an operations leader, and the app is the assembly line behind a
services offering. After a three-month pause, a restart review
([RESTART-POINT-2026-09-22.md](../To-Do/RESTART-POINT-2026-09-22.md)) found
that shape had not served the owner: in the 3.5 months after the first real
company session (2026-06-10) the app produced no real deliverable. That
session produced 8 defect reports; every later cycle was tuned against demo
data. The owner is not taking a product to market. On 2026-09-22 and
2026-09-23 the owner decided to refocus the app on the owner's own internal
work as a process manager / business analyst, and approved
[docs/To-Do/BA-HELPER-PLAN-2026-09-22.md](../To-Do/BA-HELPER-PLAN-2026-09-22.md)
for full autonomous implementation.

The complete product as of that decision is preserved on branch
`product-edition`, tagged `product-edition-v1.5.0`. It is not deleted; it is
shelved. This ADR records the decisions behind the rebuild that follows,
consolidating the plan's decisions (D1 to D9) and the cycle's implementation
choices (AD-1 to AD-15, recorded in
[.claude/agent-findings/2026-09-23_ba-helper-cycle-resume-state.md](../../.claude/agent-findings/2026-09-23_ba-helper-cycle-resume-state.md))
into one place, as the release documentation. The later decisions, AD-16
to AD-28 and what the owner parked, are summarized in the plan's
implementation notes.

## Decision

### The scenario

1. A process manager / BA gives the capture app to a subject-matter expert
   (SME).
2. The SME turns it on, performs the process a few times, and stops it,
   bracketing each run with the run hotkey, alone or during a call in which
   the SME describes the process.
3. The recorder always runs; it is the primary input. Optionally, a video
   (the SME's own screen recording, or a recording of the call) and
   optionally the call's transcript.
4. The analyst opens the session, confirms the recorder's drafted steps for
   one run, reviews how the other runs differ, finishes the process map, and
   exports a PDD.

### The outputs

- A **process map**, mined from the confirmed runs and finished in the map
  editor (As-Is, and a To-Be when wanted).
- A **PDD** (process definition document), tool neutral, usable for any
  automation technology or none.
- **Business-case inputs** for the owner's existing QB project-management
  app, which holds the business-case formula. PDT does not compute money.

Cases that are business-app requirements or integrations are out of scope:
they go through the existing requirements process, not PDT.

## Key choices

**D1. The recorder drafts every run's steps; the analyst confirms run 1.**
The drafting rule (contract C1, `normalization/step_suggest.py`) walks each
run's interactions in time order: a step is a run of consecutive
interactions on one screen, ending at a commit interaction (a button, split
button, menu item or link invocation, or any interaction whose vocabulary
entry marks `completion: true`), inclusive; or at the first interaction on a
different screen, exclusive; or at the end of the run. This replaces an
earlier plan revision that had the analyst mark every run by hand on the
video: manual marking reduces the recorder to a stopwatch and fails when
there is no video. Step drafting is the plan's load-bearing assumption; the
[P1 draft-probe runbook](../To-Do/P1-DRAFT-PROBE-RUNBOOK.md) is the owner's
instrument to validate it on a real recording, with a kill/tune rule (more
than 2 boundary fixes per 10 drafted steps means the rule needs tuning before
anything is built on top of it).

**D2. One active video per session.** When both an SME-side video and a
meeting video exist, the meeting video is preferred, because it carries
narration and a transcript. This avoids a dual-player surface for a case
that does not earn it.

**D3. The business-case formula stays in the owner's QB app.** PDT exports
measured inputs (a later phase, once the field list is settled with the
owner); it does not compute a savings figure itself. The in-app EUR-ROI
module and the PDD's ROI table are cut with their inputs
(`normalization/analysis_roi.py`, the `roi` key in `analysis.json`, and the
`roi_inputs` annotations block, which is now a legacy key per contract C10).

**D6 / AD-7. Light vocab: a remembered-names store keyed by `draft_key`.**
The plan's "name it once" idea (section 6) originally described reusing the
in-app vocabulary discovery engine and its volatility picker
(`normalization/signature_pick.py`) to derive a control signature per named
step. The cycle's implementation choice narrowed this: step names are not
control-level vocabulary entries, so an exact-key lookup is simpler and
cannot drift. A step's `draft_key` (`"<app>|<screen>|<commit>"`, value free
by construction) is the key; the analyst's name for one drafted step is
stored once, in `<viewer userData>/pdt-library/remembered-names.json`
(contract C4), and reapplied to every future draft carrying the same key,
within the session immediately and across sessions through the pipeline's
`--names` flag. The point-and-learn discovery engine
([ADR-0025](0025-in-app-vocabulary-discovery.md), `discover_vocab.py`,
`signature_pick.py`) and the App Library workbench it fed are cut along with
it: `normalization/app_vocab.py`'s matching engine stays, so the shipped
vocabularies (`normalization/app_vocabularies/*.yaml`) still enrich control
names, but nothing derives or edits new vocabulary entries in the app
anymore.

**D6 / AD-8. Light template: a saved-process store, matched in the viewer.**
The plan's "run 1 is the pattern" idea similarly described reusing the
pipeline's canonical-step matching
(`normalization/canonical_match.py`) and the Process Template editor. The
cycle narrowed this too: a saved process (contract C5,
`<viewer userData>/pdt-library/processes.json`) is the confirmed pattern
run's steps, written by "Save as this process"; on opening a session with no
confirmed pattern run, the viewer matches it against saved processes by
`draft_key` overlap (Jaccard similarity, minimum 0.5) and offers the closest
one as the comparison pattern, visibly and reversibly. `canonical_match.py`,
the Process Template editor, and `viewer/canonical-author.js` are cut: there
is no second segmentation path. Within a session, runs 2 to N are compared
with the confirmed pattern run by draft key (a merged step by its members'
keys, a step added by hand by its label; contract C3): the viewer's
differences view (`viewer/run-differences.js`) and the PDD use that one
rule, pinned by `shared/run-differences-golden.json`. The earlier alignment
engine (`viewer/step-alignment.js`,
[ADR-0015](0015-intra-session-repetition-alignment.md)) was removed in lane
L7b.

**D7. No privacy masking for internal use; password redaction stays.**
Structural PII masking (`normalization/pii_masking.py`, the derived-stream
token redaction) is cut: for an internal tool, real example values (a
customer name, an order number) make a PDD more useful, not less, and there
is no external audience to mask them from. Password redaction at capture
time stays (`UiaSubscriber.IsSecretValueElement` in the C# recorder): a
credential landing in a file is a security issue regardless of audience, so
`events.jsonl` still never carries a plaintext secret. The capture consent
gate stays configurable (`off` / `per_session` / `once` in
`capture/config.js`).

**D8. Two supported input modes.** Recorder only, and recorder plus video
(plus an optional transcript). A video-only mode (steps marked by hand
against a video, no recorder) was a deferred fallback, built only if a real
SME turned out unable to run the recorder. AD-25 and AD-27 reversed this:
sessions started from a video or from nothing are part of the release
(contract C16; the pipeline half has landed, the viewer half has not).

**AD-9.** The view-time grain slider ([ADR-0024](0024-step-grain-as-view-time-rollup.md))
and the notation-by-level map matrix ([ADR-0012](0012-active-case-stamping-and-map-matrix.md))
are cut together with the surfaces that exposed them (the map editor now
mines one map, at step grain, from the confirmed runs). The `grain_keys`
data model (`element` / `screen` / `app`, stamped on every step) stays: the
drafting rule's `screen` component and `draft_key` are built on it.

**AD-14.** A session with no run markers shows an instruction to mark runs
on the Timeline (the level was then called Flow), in place of the
anchor-candidate hero and the anchor-based lock copy: case detection is
markers only now (see "What was cut" below).

## What was cut

Removed from `master` (preserved in full on `product-edition`):

- **Unbracketed-session recovery.** Suggested markers
  ([ADR-0017](0017-suggested-markers.md), `marker_suggest.py`) and anchor
  candidates ([ADR-0018](0018-anchor-candidates.md), `anchor_suggest.py`).
  Anchor-based case detection itself
  ([ADR-0012](0012-active-case-stamping-and-map-matrix.md)) is also gone:
  `case_assignment.py` no longer has an anchor code path at all. Case
  detection is markers only; a missed run marker is added by hand in Flow.
- **Canonical / Process Template matching**, its editor, and
  `viewer/canonical-author.js` (see D6 / AD-8 above).
- **In-app vocabulary discovery** and the App Library match workbench (see
  D6 / AD-7 above).
- **Structural PII masking** and the analyst data-posture setting (see D7
  above).
- **The EUR-ROI layer**, its PDD table, and the `roi_inputs` annotations
  block (see D3 above).
- **Phases.** No phase entity, no phase-level map, no phase BPMN export.
- **Compare Sessions**, the Process Template editor, the App Library
  workbench, and the case x screen work-item view
  ([ADR-0028](0028-case-screen-work-items.md)): the runs-and-steps view
  (confirm the pattern run, then a differences view for the other runs)
  replaces the work-item case tree, so `group_annotations[]` is now a legacy
  key (contract C10).
- **Exports**: the standalone findings memo (`.docx`), the HTML findings
  report, and their CLI flags. The memo's findings first moved into the
  PDD's section 1; AD-24 then cut that section, so the PDD prints no
  findings. `normalization/memo_export.py` keeps the helpers the PDD still
  uses (the run rows).
- **Capture**: cross-machine sync markers, app-vocabulary prep sessions, the
  worker close-out wizard's observed-value questions (`self_annotations`,
  `manifest.worker_review`), and the label picker. The recorder's own
  reliability behaviors (per-session supervision, dropped-batch accounting,
  spawn-error handling, close-based stop) are kept and, where the restart
  point found them broken, fixed in the same cycle.
- **Team taxonomy, project layer, command palette, "Copy for LLM."** Not on
  the path; no AI ships inside the product.

The CLI surface after this cycle (contract C11,
`normalization/normalize.py`) keeps `session_folder`, `--taxonomy` (pending
a decision on whether drafting or analysis still need activity
classification), `--mine`, `--pdd-out`, `--pdd-map-image`, `--pdd-tobe-image`,
and adds `--names` (C4). It drops `--canonical`, `--phase-bpmn-out`,
`--step-csv-out`, `--memo-out`, `--bootstrap-vocab-out`, `--vocab-id`,
`--vocab-name`, `--bootstrap-vocabs-json`, and `--step-bpmn-out`.

## Consequences

**Positive**

- Step drafting turns "author every step by hand" into "confirm one run,
  review the differences," which is the plan's central time saving, if the
  P1 probe validates draft quality on a real recording.
- One engine per job: light vocab renames by exact `draft_key`, in the
  viewer, at draft time; light template matches saved processes, in the
  viewer, by `draft_key` overlap. The former viewer-side advisory matcher
  (`viewer/vocab-match.js`) and the JS-versus-Python regex drift it risked
  (RP-17) are gone with the workbench it served.
- A materially smaller app: about half of the restart point's fix list
  (RP-02, RP-03, RP-05, RP-08, RP-11 to RP-17, RP-19, RP-25, RP-26, RP-28 to
  RP-31, RP-33, RP-35) becomes moot because the surface it described no
  longer exists.
- Raw data immutability, suggest-don't-mutate, and non-destructive
  re-normalization are unchanged: every cut removes a suggestion engine or a
  view, never a guarantee about `events.jsonl` or analyst-owned
  `annotations.json` state.

**Negative / accepted**

- A session with no fired run markers has no case detection at all now
  (previously an accepted anchor candidate could still segment it). Accepted
  because the scenario the plan targets always uses the run hotkey.
- The value-add of light vocab and light template is unproven at the scale
  of a real engagement until the P1 probe and the
  [P5 real-session gate](../To-Do/P5-REAL-SESSION-GATE.md) run; both are
  owner-gated steps this cycle could build up to but not close.
- Legacy `annotations.json` keys from every cut feature (`marker_suggestions`,
  `anchor_candidates`, `case_anchor_override`, `roi_inputs`, `phases`,
  `drift_markers`, `group_annotations`, and their dismiss/override
  siblings) round-trip verbatim forever (contract C10) rather than being
  migrated or deleted, so an old session's `annotations.json` keeps growing
  keys nothing reads. Accepted: migrating them destructively risks losing
  analyst work the pipeline cannot tell apart from noise.
- The complete, unreduced product remains real and valuable IP on
  `product-edition`; reviving it later means re-merging two branches that
  will have diverged, not flipping a flag.

**Reversal.** Any single cut in this ADR can be reversed by cherry-picking
its removal commit's parent tree for that path back onto `master`; the full
product is one `git merge product-edition` away, conflicts notwithstanding.
Reversing D1 (recorder-drafted steps) specifically is the plan's own
kill/tune rule: if the P1 probe cannot bring the drafting rule under 2
boundary fixes per 10 drafted steps after tuning, the owner revisits D1
directly.
