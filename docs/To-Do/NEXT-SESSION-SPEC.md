# Next-Session Spec — plan of record

**Updated:** 2026-05-29 · **Branch:** `master` · **Status:** plan of record (operational).
**Source-of-truth chain:** [PDT-MASTER-ASSESSMENT.md](PDT-MASTER-ASSESSMENT.md) (strategy) →
[PDT-ROADMAP-CODEBASE-FIT.md](PDT-ROADMAP-CODEBASE-FIT.md) (engineering fit) → **this doc**
(what we're doing next). When this doc and the Fit Analysis disagree on sequencing, the Fit
Analysis wins; this doc is its operational projection.

Self-contained hand-off — read top to bottom; assumes no memory of the prior
session. Earlier specs live in git history and [Archive/](Archive/).

---

## 0. Verify UI changes in the harness — proactively, not as an offer

This project's recurring failure is shipping UI that was never eyeballed. A
Playwright harness drives the **real** viewer and screenshots it, so a headless
agent CAN see the UI. Use it to confirm every UI change before claiming it done.

- **Where:** `_pdt_verify/` (a dir *outside* the repo; `playwright-core` installed
  there, not a repo dependency) — `driver.js` plus per-task scratch drivers.
- **How:** `_electron.launch` runs the viewer's own Electron with
  `--session=<analyzed folder>` (see `main.js parseInitialSessionArg`), drives the
  page, writes `*.png` to read back. It logs `PAGE ERROR:` on any console error.
- **A loadable session:** re-analyze a bundled example —
  `viewer/python/python.exe normalization/normalize.py sessions/example-aggregate/sess-2026-0514-0900 --mine`.
  **`example-aggregate` is committed demo data — do NOT commit the regenerated files**
  (`git checkout -- ...` + `git clean -f ...` that folder when done).
- **Tests:** system Python with pytest (`python -m pytest normalization/test/`);
  the bundled `viewer/python` has the runtime deps (pm4py, python-docx) but no
  pytest, so use it for direct/`--mine` runs. Viewer: `npm test` in `viewer/`.

---

## 0.5 Real-value vocab cycle — 2026-05-30 (latest)

The §11d App-Vocabulary work was reframed and executed: **Claude probes the real
apps** (not the owner; there is no LLM in the product) and maps **real** UIA
signatures. Landed on `master`:

- **7 real App Vocabularies** replacing the demo-fiction placeholders — Excel,
  Word, Outlook, Chrome, Edge (live UIA probe) + **ServiceNow** & **Salesforce**
  (probed from the owner's live PDI / Developer-Edition). Three signature
  strategies emerged: **idMso** (Office), **stable DOM ids** (ServiceNow),
  **label-based** (Salesforce Lightning — aids are volatile). Method:
  [../REAL-VALUE-TESTING.md](../REAL-VALUE-TESTING.md).
- **4 process templates** (`normalization/process_templates/`) — create/resolve
  incident, create account, send email, mail-merge — validated through `canonical_match`.
- **Excel proven end-to-end** through the real C# recorder (it emits the probed
  ids; the vocab enriches them). Lookups + golden + fuzzers all green.
- **§11b root-caused** — the over-segmentation is `step_split_on_element` (64→15
  steps when off); flip gated on real-corpus + UI validation
  ([SEGMENTATION-CALIBRATION-FINDINGS.md](SEGMENTATION-CALIBRATION-FINDINGS.md)).

**Next (owner-gated):** apply the §11b flip against a real recorder-driven corpus +
viewer/analysis validation; cover **SAP / Jira / Zendesk** (need driving) per
[APP-COVERAGE-LIST.md](APP-COVERAGE-LIST.md); decide whether to make the demo real
(regenerate `example-aggregate` with probed ids so it re-enriches under the real vocabs).

---

## 1. Where we are

Last release **v0.18.0** (2026-05-28) — adds the in-view Session-view Map level
as a 5th entry in the level switcher (Flow / Steps / Phases / **Map** /
Analysis), retiring the v0.17.0 "View map" one-click into Compare-Sessions. The
interactive process-map UI is now a reusable controller (`viewer/map-controller.js`)
shared by both surfaces; aggregate-view.js shrunk by 208 lines, no regression in
Compare-Sessions. Also a build-pipeline hardening pass (`preflight.ps1` gates
CHANGELOG header integrity + lockfile sync; `build-distribution.ps1` retries
electron-packager on the Defender / Search-indexer temp-dir race).

Landed on `master` since v0.18.0 — Phase 0 of the ML Integration Recommendation,
shipped as two complementary chips:

- **Suggested markers** ([ADR-0017](../adr/0017-suggested-markers.md), commit
  `5ec6d54`). A hand-rolled change-point detector
  (`normalization/marker_suggest.py`) surfaces candidate Start/End boundaries
  for unbracketed sessions as dashed markers in the Flow timeline; Accept
  promotes into the existing `marker_edits[]` op:insert path; Dismiss writes
  to `marker_suggestions_dismissed[]`. Item #2 of the recommendation.
- **Anchor candidates** ([ADR-0018](../adr/0018-anchor-candidates.md),
  uncommitted at the time of writing). A pattern-mining detector
  (`normalization/anchor_suggest.py`) ranks fields that look like case
  anchors (a customer-ID search box, a serial-number entry) and surfaces them
  above the Markers list; Accept writes a session-level
  `case_anchor_override` that `normalize.py` consults before falling back to
  marker mode. Item #5 of the recommendation; closes Phase 0.

Both detectors are non-ML, zero new pip deps, regenerated wholesale each
normalize, and idempotent across re-runs via stable 12-char signatures. Total
test coverage added: 36 deterministic scenarios + 10 fuzzer regimes
(~19k randomized inputs).

v0.17.0 (same cycle) closed the **productization cycle** — PDD restructured to
a standard RPA Process Definition Document with an embedded process map,
segment-level automation candidacy
([ADR-0016](../adr/0016-segment-level-automation-candidacy.md)), the
Compare-Sessions Analysis panel + single-session Waste-by-step decluttered,
capture tray IA split by lifetime (Settings / Profile / Session setup), ~5 s
session-start freeze gone, Chromium web-content reaches the recorder out of the
box, seeded fuzzers + parse_ts consolidation + a process_label Python↔JS golden
pin the normalization pipeline. v0.17.1 was the same-day doc catch-up.

Direction: **productization toward a small internal rollout, analyst-deliverable
first**; bar = "as polished as it can be." Internal-rollout phase begins now.

**Update (2026-05-29):** now at **v0.19.0**. This session landed the fix-first review queue
(security + correctness + capture-durability fixes), the **Electron 33→42** bump + the
`dagre`→`@dagrejs/dagre` fork swap (0 npm-audit advisories), and the Session-view process-map
**overlay fix** — all verified in the harness. It also produced the consolidated review register
([CONSOLIDATED-REVIEW-2026-05.md](CONSOLIDATED-REVIEW-2026-05.md)) and the strategic→engineering
roadmap reconciliation (the Master Assessment + Fit Analysis). **The engineering roadmap is now
the Wave 0 plan in §2.**

---

## 2. Plan of record — Wave 0 (the foundation)

The Fit Analysis establishes that the strategic roadmap (§11 workstreams) is mostly *additive*
and fits the architecture — but funnels through a shared **Wave 0 foundation** that must land
first. Wave 0 is the next work. Aggregate ≈ **12–22 focused days** (Fit §9). Items are roughly
parallel; the only hard ordering is **F2 before F4** (the golden must exist to verify the
`normalize()` refactor is non-destructive).

1. **F2 — session-level golden gate.** Re-normalize the committed `example-aggregate` sessions →
   diff a lightweight *projection* (`stats.json.meta` scalars + per-case step labels / markers /
   anchor) against a committed golden. Runs on pre-recorded `events.jsonl` — **no recorder or
   Electron in CI**. The keystone that protects every later change. *(In progress — being built
   this session.)*
2. **F1 — in-repo e2e gate.** Move the assertable subset of `_pdt_verify/` into a top-level
   `e2e/`, convert eyeball drivers to `assert` + exit codes, drop `ELECTRON_SKIP_BINARY_DOWNLOAD`
   for that job, wire into CI. **Supersedes §0's out-of-repo harness note** once it lands.
3. **F4 + F3 — decompose `normalize()` + calibration config surface.** Split the ~509-line
   orchestrator into named stages; thread a `calibration` block through the two
   `auto_suggest_steps` call sites (`normalize.py:553`, `:586`) + `coalesce`. F3 unblocks §11b
   (the segmentation knobs are currently unreachable). Do **F2 first** so the golden verifies the
   refactor. F4 is debt-paydown, not strictly blocking — but don't defer it past Wave 1.
4. **§11c — €-ROI layer.** New `analysis_roi.py` (slots into `analysis.run_analysis`) +
   session-level `roi_inputs` annotation key + `_write_roi()` PDD section + viewer panel. The
   commercial closer (the Discovery-Sprint deliverable); **no §11a dependency — can run in
   parallel now** on existing analysis output (`estimated_savings_ms` is currently `None`).
5. **6b — Node-side egress guard.** `no-restricted-imports` on `http`/`https`/`net` in the
   Electron main processes + a single allowlist seam (today: localhost OBS only). Half a day;
   makes the air-gap moat provable on the Node side too (the renderer is already CSP-locked).
6. **Self-sign binaries.** Wire the internal self-sign cert into `build-distribution.ps1`
   (`-CertThumbprint` + `signtool sign` after each `.exe`). Hours, not days. **Distinct from EV
   code-signing** for unknown customers (procurement-blocked, later).
7. **`Recorder.Tests.csproj`.** xUnit on .NET 8; 3 seed tests (`BuildEvent` field set,
   keystroke-coalescing boundary, marker/system-event flush bypass). **Hard prerequisite for
   §11e**; the bus-factor mitigation for the zero-test crown jewel. (dotnet 10 SDK confirmed on
   the dev box.)

After Wave 0: **Wave 1** (§11a real-data harness, §11b calibration, §11d bootstrap vocabs), then
**Wave 2** (§11e coverage hardening, §11f borrows, §13/6a pluggable backend). Full sequencing +
effort in [Fit Analysis §7/§9](PDT-ROADMAP-CODEBASE-FIT.md).

### Wave 1 — landed (2026-05-30, branch `wave1-overnight`)

An autonomous overnight pass shipped the verifiable Wave-1 surface as six
per-phase commits (all gates green: pytest 314 / golden 10·OK / viewer 231 /
capture 78 / dotnet 12 / e2e 9·9; each UI/behaviour change real-run verified):

1. **§11c €-ROI viewer panel** — `analysis-view.js` renders `analysis.json`'s
   `roi` band (hours/yr → € net/yr once a rate is set), expected-band totals, and
   a band-encoding legend; an **Edit assumptions…** form + per-row **tune** form
   write `roi_inputs` through the undo path and trigger a re-analyze. Real-run:
   edit → persist → re-analyze → € updates; Ctrl+Z reverts.
2. **§11f automation-candidate ranking** — `score_automation` scores by
   `instance_count × mean × automatable_fraction` (roi_inputs-aware), stamps
   `rank`/`rank_score`; surfaced in the viewer table + PDD §4.3.
3. **§11f structural PII masking** — new `pii_masking.py` stage redacts sensitive
   field values in the **derived** stream only (raw `events.jsonl` untouched) with
   a join-preserving `«category#hash»` token; `pii_masking` report + analyst
   `pii_masking_config`. Pinned by a seeded fuzzer; end-to-end no-leak proven.
4. **§11f capture consent gate** — `consent-window.js` + `consent.js` +
   `manifest.consent`; `config.consent.mode` = off (default) / per_session / once;
   declining aborts the start. Real-run verified the window + IPC decision.
5. **§11d pre-built App Vocabularies** — curated `salesforce/sap-gui/excel/outlook/
   chrome` vocabs (+README) bootstrapped from the demo; the predicted-vs-actual
   diff drove a **case-insensitive `scope.process_name`** fix; demo now enriches
   at 100% per app. Golden regenerated (intentional).
6. **§11a golden corpus** — widened to all 10 `example-aggregate` sessions +
   `corpus/README.md` tier roadmap. Still no recorder/Electron in CI.

**Wave-1 remaining (next):** §11b segmentation/alignment calibration (gated on
real captures — owner), §11f cross-recording trace-merge (depends on §11b),
§11d LLM-augmented labeling (owner hosting decision). See §3.

**Handoffs / owner decisions surfaced this pass:**
- **Consent default policy** — the gate ships `mode: "off"` (no behaviour change).
  Whether the internal rollout wants `per_session` or `once` by default is an
  owner/compliance decision; flip `config.consent.mode` to enable.
- **PII rule-set calibration** — the default categories (password/SSN/card/cvv/
  pin/secret/iban/routing/account) and the redaction-vs-hash choice ship sane,
  but the *right* set for the rollout's apps is owner-side; tune via
  `pii_masking_config.custom_rules`. Bump `ruleset_version` on a breaking change.
- **App-vocab tenant tuning** — the shipped vocabs are demo-derived starters; real
  Salesforce/SAP automation_ids differ. Retune against the first real captures
  (this is the §11d/§11a real-data step, owner-gated).
- **§11b not attempted** — fuzzing ≠ calibration; needs representative real
  captures. The demo `calibration` default was left as-is (golden + step counts
  give no justification to change it provisionally).

**Still-minor follow-ups** (pre-existing, low priority, not Wave 0):
- CHANGELOG header-integrity pre-commit hook (build-time gate via `preflight.ps1` already
  suffices).
- MAX_PATH PM4Py path-shaving in `viewer/python/` (DEPLOY.md carries the user-facing mitigation).

---

## 3. Owner-blocked / calibration (cannot be done headless)

- **Calibration on real captures** — `process_label` value-stripping, the
  rare-path cutoff, the fuzzy "same step" thresholds. Needs more representative
  real captures (owner-side). Fuzzing proves robustness, NOT calibration.
- **Marker-suggestion thresholds on real captures (ADR-0017).** The detector's
  signal weights (`0.5 / 0.5 / 0.6 / 0.2`), the `0.5` score threshold, the
  `40%` home-app share, the `20%` cluster edge fraction, and the
  `min_case_interactions=5` floor ship calibrated against the seeded fuzzer
  and the bundled demo. Whether they produce the right number of suggestions
  per hour on real Salesforce / Excel / Outlook captures is owner-side. Bumping
  `heuristic_version` on `marker_suggest.py` is the contract for breaking
  recalibrations — it invalidates the prior dismiss-set.
- **Anchor-candidate scoring weights on real captures (ADR-0018).** The
  four-signal blend (coverage 0.40 / balance 0.30 / diversity 0.20 /
  focus 0.10), the `_MIN_FIRES=2` / `_MIN_CASES=2` floors, and the top-5
  cap ship calibrated against the seeded fuzzer and the unbracketed
  fixture (where `customer-id-field` ranks first at 0.935). Whether this
  ranking surfaces the right field FIRST on real captures with 30+
  candidate fields is owner-side. Same `heuristic_version` posture as
  ADR-0017.
- **Released-`.exe` smoke** on the locked-down work laptop: the packaged app's
  recognition-JSON load + the recorder's single-monitor screenshot occlusion.
- **PDD "living projection"** — still undefined; needs a concrete owner definition.

---

## 4. Environment & conventions

- **Two machines:** dev box (node / python / git / .NET) vs. the locked-down work
  laptop (released `.exe` only — never suggest installs there).
- **Company captures stay local.** Use `scripts/inspect-events.js` /
  `scripts/count-cases.js`; never read a real `events.jsonl` into the assistant.
- **Validate via the packaged app *and* the §0 harness**, not just green tests —
  UI bugs are invisible to the unit suites.
- **Commit style:** imperative subject; **no Co-Authored-By trailer**; quote-safe
  body. Branch `master`; `gh` authed as `Atjeto`. For `.ps1`, scope-set
  `RemoteSigned`, not `-ExecutionPolicy Bypass`.
