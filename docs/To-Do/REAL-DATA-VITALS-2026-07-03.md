# Real-data vitals — structure-only read (2026-07-03)

> **What this is.** A structure-only vitals pass over the captures under
> `sessions/_real-capture/` (and the `sessions/_real_suite/` fixtures), to decide
> whether a real recording folds to human-sized units and whether the L0/L1
> semantics of [APPROACHABILITY-REDESIGN-2026-07-03.md](APPROACHABILITY-REDESIGN-2026-07-03.md)
> §2 can be measured on it. **Governance:** no captured strings entered this
> analysis — only counts, durations, timestamps, allow-listed enums
> (event type, kind, control_type, framework, identity_source, value_source,
> confidence), and app process (exe) names. Derived keys are reported as
> *distinct-key counts*, never as keys. Analysis ran on **scratchpad copies**;
> the real folders are byte-untouched (verified below).

## Gate 1 — Vitals (all folders)

Structure-only, via the strict inspector (a stricter sibling of
`scripts/inspect-events.js` — omits even `automation_id`/`class_name`/`name`
string tallies) plus `manifest.json` metadata.

### `sessions/_real-capture/` — the two named targets

| Capture | Wall-clock span | Raw events | Interactions | Markers | Screenshots | Distinct apps | Apps (exe) |
|---|---|---|---|---|---|---|---|
| `real-2026-06-05T13-56-07` | **0m 26s** | 8 | **0** | 2 | 0 | 0 | — (no interaction events) |
| `real-2026-06-05T13-57-30` | **0m 24s** | 13 | **5** | 2 | 0 | 2 | `Notepad.exe` (4), `claude.exe` (1) |

Manifest provenance (both): `worker_id = "e2e-driver"`,
`engagement_id = "real-capture-validation"`,
`config_snapshot.driver = "e2e/real-capture.js"`.

### `sessions/_real_suite/T05-agg-10/*` — suite artifacts (flagged, not targets)

Synthetic aggregate-test fixtures (folder name = "aggregate of 10"; single
`chrome.exe` process; control mix `Edit`/`RadioButton`/`CheckBox`; no `framework`
field — the pre-§11e demo-generator shape). One-line vitals each:

| Folder | Raw events | Interactions | Markers | Span | Distinct apps | Kind |
|---|---|---|---|---|---|---|
| `sess-01` | 25 | 13 | 2 | 0m 11s | 1 | suite artifact |
| `sess-02` | 25 | 13 | 2 | 0m 11s | 1 | suite artifact |
| `sess-03` | 40 | 25 | 4 | 0m 17s | 1 | suite artifact |
| `sess-04` | 26 | 13 | 2 | 0m 11s | 1 | suite artifact |
| `sess-05` | 24 | 13 | 2 | 0m 10s | 1 | suite artifact |
| `sess-06` | 42 | 25 | 4 | 0m 16s | 1 | suite artifact |
| `sess-07` | 26 | 13 | 2 | 0m 11s | 1 | suite artifact |
| `sess-08` | 24 | 13 | 2 | 0m 10s | 1 | suite artifact |
| `sess-09` | 42 | 25 | 4 | 0m 16s | 1 | suite artifact |
| `sess-10` | 24 | 13 | 2 | 0m 10s | 1 | suite artifact |

## Gate verdict: **STOP — these are not representative work captures.**

Every folder here is a plumbing/fixture recording, not a real business process.
Applying the L0/L1 semantic analysis (element-grain step count, distinct
screen-key count, work-item collapse ratio, case coverage, anchor viability,
estate/vocab coverage) to them would be forcing analysis onto empty space — the
numbers would describe the e2e driver, not the estate the redesign is trying to
serve.

Why each capture fails the honesty floor (span < ~10 min **OR** only
notepad/calc/explorer-class apps **OR** interactions < ~100 → not meaningful):

- **`real-2026-06-05T13-56-07`** — 26-second span; **0 interaction events** at
  all (only `system`/`activity`/`marker`). Nothing to analyze. This capture
  exercised the recorder's session/marker plumbing, and the UIA interaction
  stream was empty (the recorder sidecar produced no interactions in this run).
- **`real-2026-06-05T13-57-30`** — 24-second span; **5 interactions** across
  `Notepad.exe` + `claude.exe`. Notepad is the textbook dev-box-test app; five
  events is two orders of magnitude below the ~100 floor. The manifest names it a
  `real-capture-validation` run of `e2e/real-capture.js`.
- **`_real_suite/T05-agg-10/*`** — 10 synthetic fixtures, 10-17 s each, one
  `chrome.exe`, 13-25 interactions; the demo-generator shape used to exercise the
  Compare/aggregate path. Not real work.

These captures **do** prove the recorder end-to-end (session open/close, markers
flushing, a chromium-framed + win32 interaction both classified at
`identity_source = name`, `confidence` in the 0.3-0.7 band). That is a valid
recorder-validation result — it is just not a *process* to mine.

## What to capture next (for the L0/L1 analysis to run)

One real recording that clears the honesty floor, so the folded-units and
estate-coverage questions become answerable:

- **Apps:** one (or a few) of the **real estate** apps named in the redesign
  diagnosis — TAMBA / SNFI / ES Call Management — i.e. the line-of-business
  desktop/web apps the shipped SaaS/Office vocabs do **not** cover. Not
  Notepad/Chrome-scratch.
- **Length:** a genuine sitting — **≥ ~10 minutes**, ideally 20-45 (the
  redesign's success metric is "one real session → ≤ 45 min of analyst work → a
  2-page memo").
- **Volume:** aim for **≥ ~100 interactions** and **≥ 2 complete cases** of the
  same process (so case coverage, work-item collapse, and — if unsegmented —
  anchor viability can be measured; a single case can't unlock any across-case
  statistic).
- **Markers:** **yes** — fire Start/End (or a per-case marker) around each case.
  With markers, `case_quality.mode = markers` and Tier-2 surfaces unlock honestly
  without needing the anchor-candidate fallback; without them, the anchor path is
  the only route and this doc would report its top-candidate score/coverage
  instead.

With a capture of that shape on the scratchpad, re-run this pass and Gate 2
(A: L1 semantics via `normalize --mine` + `build_work_items`; B: estate/vocab
coverage per app) produces numbers that actually describe the estate.

---

### Method / leak-check (how the no-strings guarantee was verified)

- **Precedent mirrored.** Started from `scripts/inspect-events.js` +
  `scripts/count-cases.js` (the structure-only precedents). The vitals script is
  **stricter** than `inspect-events.js`: it prints no `automation_id`,
  `class_name`, or `name` string tallies — only counts, durations, timestamps,
  exe process names, and the allow-listed enums (event type, kind, control_type,
  framework, identity_source, value_source, confidence buckets).
- **Demo dry-run first.** Ran the script on the committed demo
  (`sessions/example-aggregate/sess-2026-0514-0900`) and reviewed the full output
  shape **before** running on real data: every emitted value was a count, an exe
  name, or an enum key — zero captured free-text. Only then was it run on the
  real copies.
- **Copies only.** Real folders were copied into the session scratchpad; every
  script ran against the copy. `normalize` was **not** run (Gate 1 stopped
  before Gate 2), so no derived files were generated anywhere.
- **Byte-untouched, verified.** Before/after `git status` identical (no entries
  under `sessions/`); real-folder + `events.jsonl` mtimes and sizes byte-for-byte
  unchanged (`13-56-07/events.jsonl` = 1157 B, `13-57-30/events.jsonl` = 3947 B,
  mtimes unchanged).
