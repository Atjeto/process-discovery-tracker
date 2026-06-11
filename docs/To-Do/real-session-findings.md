# Real-session findings — owner's 1h30m company session (2026-06-10)

First real-data run of v1.1.0 + the Copy-for-LLM round-trip (reviewable
data-sharing mode; owner reviewed the export and shared it deliberately).
Worker machine runs **capture v0.9.0** — an old capture build. Each item
below is ground truth for the Phase G hardening chip.

## G-1. Map editor: Fork map broken (owner-reported regression)

"The map editor fails to load. Fork map doesn't create a copy, and never
opens the editor." Likely cause: Phase B2 map slimming removed the
inductive-miner BPMN cell from the UI; `refmap-ui.js` forks from
`_deps.sourceBpmnPath({notation:"bpmn", level})` (refmap-ui.js:44-45,
170-175) — if the resolved source cell no longer renders/exists (or the
gated/Advanced-drawer DOM changed what `state` resolves to), fork gets a
null/missing path and silently does nothing. Must fail LOUD (toast) when
the source is unavailable, and fork must work from the step-grain
observed BPMN (the supported cell post-B2). Add an e2e pin: fork from the
default map state creates a copy + opens the editor (the session-smoke
refmap checks passed on demo data — find why they didn't catch this;
likely they pre-selected a cell that still exists).

## G-2. Tier-1 facts all zero on the real session

Export showed `active_ms: 0, top_apps: [], app_switches: 0,
longest_focus_ms: 0` while `idle_ms` and `session_span_ms` were correct
and step_groups carry real durations. facts.py evidently keys on a field
the old capture (v0.9.0) doesn't emit (probably `activity` events /
`duration_ms` shape differences). Fix: derive app time/switches from
whatever is present (fall back to interaction `process_name` + timestamps
when activity events are absent/old-shape); add a pytest fixture
mimicking the v0.9.0 event shape; facts must never render a confident
zero when the underlying signal was absent — say "not available from
this recording" instead (honesty rule).

## G-3. Tier 2 unlocked on case_count = 1

`mode: markers, case_count: 1, coverage 0.999 → tier2_unlocked: true`.
One case means cycle-time/variant/repetition-across-cases analysis is
meaningless. Gate should require case_count >= 2 (variants already need
3). Update case_quality.py + the badge copy ("1 case marked — case
comparisons need at least 2").

## G-4. Step-label quality on real data

Labels leak segmentation artifacts and value fragments:
- `"AMPLIFY FCU: Fill 8 fields (Specifics in Billing process due to contract detail… (split 1) (split 1) + AMPLIFY FCU"` — "(split N)" suffixes stack and concatenate; cap/clean.
- `"TAMBA: Enter .19"`, `"TAMBA: Enter null"`, `"App: Enter 3498796"`, `"TAMBA: Enter **Problem** ProblemDesc"` — typed-value fragments and literal "null" in labels; the value-free labeling rules miss these shapes.
- `"ES CALL MANAGEMENT: Enter «password#f02847ea»"` — masking worked, but the masked token renders raw in a user-facing label; display as "Enter (masked value)".
- Many step_groups with `instances > 0, total_ms: 0` — zero-duration instant steps clutter ranking; floor or aggregate them.
- `capture-v0.9.0` folder browsing shows as steps — the worker browsing the capture tool's own folder; self-exclusion misses explorer paths containing the capture install.

## G-5. Copy-for-LLM export gaps (design)

- `row_key` collides across vocabs (chrome and edge both emit
  `cn|OmniboxViewViews`, `ctn|Button|Back`): the flat
  `suggestions.<row_key>` response shape can't address one browser only.
  Key as `<vocab_id>|<row_key>` in v2 of the export + import.
- The export only carries EXISTING vocab skeletons (browser chrome +
  Outlook — already well named). The apps that actually need naming help
  (TAMBA, ES CALL MANAGEMENT, SNFI, Account View, Knowledge Management)
  have no vocab, so nothing was sent. The export should also include
  top un-vocabbed controls/screens observed in the session (derived
  labels only) as `candidate_rows`, so the LLM round-trip helps where
  the gap is. Short-term workaround for the owner: run "Discover from
  window" on TAMBA + ES CALL MANAGEMENT, then re-export.
- Window-title-derived labels in the export carry business identifiers
  (site/customer names). Working as designed for the reviewable mode
  (owner reads before sharing), but the export header should say so
  explicitly so the reviewer knows to look at labels, not just values.

## Round-trip verdict (what worked)

Findings read well on real data (waiting/repetition/backtracking/rekey/
coverage all plausible and plain-language); masking held (values appear
only as tokens); case marking + markers mode detected; the export was
reviewable in one read. The loop is viable — the gaps above are
hardening, not redesign.

## G-6. The arrival session is the PRIMARY workflow — reframe (owner walk-through)

The first real session arrived as a folder from a remote worker: the
analyst has no vocabs for the recorded apps, no access to the live apps,
and one recording. Every designed assist (Discover-from-window,
Copy-for-LLM over loaded vocabs, manual vocab authoring) assumes the
analyst sits in front of the live applications — which is backwards for
the consulting model the product exists for. The owner was walked into
building five vocabs "just to maybe partially understand one 1.5h log"
before the workflow conceded. Requirements:

- **Understanding a received session must require ZERO vocab / CLI /
  Discover work.** Overview memo + findings + step groups must stand
  alone (they nearly do — G-2 and G-4 close the gaps).
- Copy-for-LLM v2's `candidate_rows` from the session itself (already in
  G-5) is hereby the feature's PRIMARY purpose, not an addition — the
  loaded-vocab skeletons are the secondary payload.
- Reposition vocab building in UI copy and docs as "worth it when you'll
  record this process again" — an asset for repeat recordings, never a
  prerequisite to reading a session.

## G-7. One-click "Bootstrap vocab from this session" (App Library)

`normalize.py --bootstrap-vocab-out` exists; a consultant should never
need a terminal. App Library button: pick a session folder (default: the
currently open session) → writes a skeleton vocab per observed app
(scope inferred from process_name + the session's window-title pattern)
→ opens it in the review checklist. Plain-language copy per the style
guide.

## G-8. Right-click "Add to vocab" from a step (Workshop → Steps)

The step detail pane already shows each interaction's signature
(control_type + automation_id/name/class_name). Context-menu action:
"Add to vocab…" → choose/create target vocab → row added with the label
prefilled from the step name. Kills the hand-copying of identifiers that
manual vocab curation currently requires.
