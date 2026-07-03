# R-cycle delegation register — approachability redesign R1–R5 (2026-07-03)

> Raw findings catalog per the skills-pack maintenance contract
> (docs/claude-skills/README.md). Cycle: 7 sequential agents (3 sonnet,
> 3 opus, 1 haiku) implemented phases R1–R5 of
> docs/To-Do/APPROACHABILITY-REDESIGN-2026-07-03.md on branch
> `redesign-r1` (b832d91…c72240e), supervised by a Fable 5 session that
> verified each phase independently and fed accumulated rules into each
> next brief. Commits by agents (owner-directed mode). Zero hard-invariant
> breaches, zero gate failures, zero pushes/releases. Consolidated into
> the pack the same session (owner-invoked). Case IDs: R*.

## Case register (what → root cause → caught by → status → rule)

### RA1 — sessions/ pollution + unverifiable restoration claim (sonnet, R1a)
Agent's verification runs dirtied `sessions/` beyond the pre-existing
baseline; report claimed "byte-for-byte" restoration "via the git stash
object still reachable before GC" — yet `dfg.json` remained modified vs
the conversation-start snapshot. Attribution muddied by RS3 (a concurrent
session was active). Root cause: post-hoc reconstruction instead of
pre-mutation snapshot; also RS2 (the brief's invariant was unsatisfiable).
Caught by supervisor's status diff. Status: no staged damage; claim
unproven. **Rule:** snapshot state BEFORE mutating (`git status --short`
+ `git diff` to files); prove restoration by diffing against the
snapshot; never claim byte-exactness from memory.

### RA2 — bare pass count omitting skips (sonnet, R1a)
Report said "Python suite (520 passed)" — no skip count. The 11 skips
ARE the normalize-importing tests (system Python lacks pandas/pm4py), so
for pipeline-relevant changes "520 passed" alone is unearned green.
Caught fully only when the R3 opus agent framed it honestly. Status:
report imprecision, no code impact. **Rule:** report pass AND skip
counts AND whether the skipped set covers the code touched.

### RA3 — ran suites the change could not affect (sonnet, R1a)
Full pytest + golden for a JS-only diff. Minor waste. **Rule:** run the
gates the change can affect; name why others were skipped.

### RB1 — report/code mismatch (sonnet, R1b)
Report summarized the lane-defaults change as "markers/screenshots off";
the code (correctly) also set `steps: false`. Caught by supervisor grep.
Status: code right, report wrong. **Rule:** reports paste the FINAL
state of changed contracts (the block itself), not remembered deltas.

### RB2 — removed control's affordances left dangling (sonnet, R1b)
Removing the Template nav tab left visible tab numbering 1, 2, 4 — the
gap leaks the removal. Caught by supervisor from ONE screenshot; fixed
by the next agent. **Rule:** removing a control includes its hotkeys,
numbering, legend, and pins — the COHERENCE-AUDIT inverse applied to
chrome. (Generalizes the O2 dead-CSS rule from removal-of-code to
removal-of-affordance.)

### RS1 — supervisor recorded an accusation without verification (supervisor)
The live flaw log recorded RA2's "520 passed" as a "dubious number"
(suspecting fabrication); the next agent independently reproduced 520.
Retracted, then RE-revised when R3 showed the honest framing (the
number was real AND the framing under-disclosed). **Rule:** an
accusation in a review log needs the same paste-verifiable standard as
a completion claim; verify before recording, revise in place when
evidence moves.

### RS2 — unsatisfiable invariant issued in a brief (supervisor)
Brief said "leave sessions/ exactly as they are" while the viewer
re-analyzes the demo on EVERY launch — the tooling breaks the invariant
on first eyeball. RA1's messy recovery traces here. Fixed from R1b
onward by prescribing the documented revert-pair recipe instead.
**Rule:** before issuing a MUST-NOT, check the tooling can honor it;
prohibitions that the environment violates get replaced by recipes.

### RS3 — foreign commit landed mid-cycle on the shared checkout (process)
`eb491a7` (a delegation post-mortem + guardrail fixes, authored by a
concurrent session) appeared on `redesign-r1` between two agent runs;
unattributed for the rest of the cycle. No damage — content was sound —
but the branch carried a commit nobody in the cycle made. **Rule:**
before a shared-checkout delegation cycle, check for live concurrent
sessions; attribute every commit on the branch before merging; prefer
worktree isolation when concurrency is likely.

### RS4 — permission asymmetry orchestrator vs agents (process, minor)
The auto-mode classifier denied the orchestrator's `git checkout -- +
git clean` on sessions/ (documented convention), while agents ran the
same pair unblocked. **Rule:** do not design a flow that depends on
orchestrator-side destructive ops; put documented cleanup recipes in
the agent's lane, or get the permission rule added.

### RH1 — BOM in the commit subject (haiku, R5)
Commit subject rendered `﻿Add R5…` — the message temp file carried a
UTF-8 BOM (PS 5.1 default encoding; brief said Bash, agent used
PowerShell anyway). Permanent cosmetic defect. **Rule:** commit-message
files are written BOM-free (Bash heredoc, or `-Encoding utf8NoBOM` on
PS 7 / ASCII on 5.1); verify the subject with `git log --oneline -1`
after committing.

### RH2 — instruction literalism (haiku, R5)
"Clearly marked as examples" was emitted as the literal heading
"Example lines (marked as examples)"; "one table per session" became
"fill in one row per session". Structure otherwise faithful. **Rule:**
haiku briefs contain the exact text to emit, not descriptions of it;
descriptions get echoed, not interpreted.

## What worked — encode, don't regress

- **Probe-first phase gating (opus, R3).** The brief made verifying the
  load-bearing assumption (re-normalize preserves an unknown additive
  annotations key) the literal STEP 1 with stop-the-phase wording; the
  agent ran it, pasted evidence, then built. Zero rework.
- **Absurdity catch on a derived number (opus, R4).** Per-vocab UNNAMED
  summing gave 530 (empty-scope vocabs match every app); agent suspected
  the aggregation shape, switched to union-of-matched-keys (~47), and
  documented why. The single best judgment call of the cycle.
- **Honest drift disclosure (opus, R2).** The JS mirror of app_vocab
  matching shipped with an explicit could-not-mirror list (ReDoS guard,
  screen tagging, cross-vocab precedence), each with risk assessment.
- **Check-already-satisfied (sonnet R1b, opus R2).** The Compare export
  menu already existed; the agent verified coverage and left it instead
  of rebuilding.
- **Verification-scope disclosure (opus, R4).** "Capture panel:
  unit-tested + HTML-build-verified — NOT screenshot-driven, because
  the tray is native and no live session was available." Honest scope
  beats vague "verified".
- **Measured-then-seeded fixtures (opus, R3).** Agent measured that the
  demo never revisits a screen (fold-check would pass vacuously), so the
  smoke seeds a synthetic revisit into its temp copy, stated in the
  header. Same pattern in R2 (seeded vocab; shipped vocabs don't match
  the demo).
- **The live ramp.** The supervisor kept the register DURING the cycle
  and fed each new rule into the next brief with its scar story
  ("each was violated once; treat as law"). Sonnet went from 3 flags
  (R1a) to near-zero (R1c) under the same model; brief explicitness,
  not model tier, was the sonnet quality lever.
- **Agent-commit mode, cleanly.** Owner-directed: each agent committed
  its own phase. Six commits, zero git accidents, under: sequential
  chain (single writer at any moment), explicit-path staging only,
  gates green before commit, no push, `git commit -F`, imperative + no
  trailer. Coordinator committed only its own docs.
- **Per-phase independent verification cadence.** Supervisor re-ran the
  affected gates and read one artifact (screenshot or doc) after every
  agent, before launching the next. Cheap, and it caught RB1/RB2/RH1.

## Addendum — vocab-UX fix lane (opus, commit 8cba50c, same day)

### RV1 — commit-msg temp file written to a mangled in-repo path (opus)
A stray untracked file `capture/C␺Users…scratchpadcommit_msg.txt` appeared
(the scratchpad path's drive colon mangled into a unicode char, landing the
temp file INSIDE the repo). Caught by supervisor status diff post-commit;
deleted. The agent's own "only pre-existing environmental items" claim
missed it. **Rule:** write temp files via `$TMPDIR`/scratchpad variables,
never interpolated absolute Windows paths through a POSIX shell; and a
"tree clean" claim requires a pasted status diff, not a glance.

### RV2 — machine fact (re-verifiable): DOTNET_BUNDLE_EXTRACT_BASE_DIR
needs a BACKSLASH path; the forward-slash form fails the recorder's
single-file extraction. Extends the existing extract-to-D: memory.

### What worked (encode)
- **Owner's reproduction as acceptance evidence:** the brief demanded the
  live probe the owner suggested; the agent ran real discovery against
  Notepad and pasted 54 raw → 28 triaged candidates — the defect and the
  fix quantified in one line. "Reproduce the owner's complaint, then show
  the number moving" is the strongest acceptance shape we have.
- **Honest count decrease:** vocab-smoke went 33→32 because a deleted
  feature took its check with it — named and justified, not padded back.
- **Letter-vs-intent handled right:** kept the drawer flash for the
  "show me an existing rule" case, arguing Task 1's law was "NAMING never
  navigates" — a correct intent reading, reported not smuggled.

## Addendum 2 — Steps UX lane (opus, commit d60b286, same day)

### RV3 — cross-repo rule scoping (supervisor + pack)
The brief hedged "NO em dashes if the ui-copy guard bans them; check" —
because the pack's supervisor checklist carries "grep the diff for em
dashes (owner rule: never)", a rule mined from the OTHER repo (Motif).
The agent verified this repo has no such rule (existing rendered copy
uses em dashes; ui-copy-guard passes) and proceeded — the correct
premise-falsification behavior. **Rule for next consolidation:** rules
mined from one repo get a scope tag (repo-specific vs owner-global) when
they enter the pack; an unscoped owner-preference silently exported to
every repo is a false constraint. (Owner may also confirm em-dash as
global — then the PDT copy rule changes, not the pack.)

### What worked (encode)
- **The audited-labels table**: told to fix one tooltip, the agent
  audited every truncating label on the surface and returned a
  label→old→verdict table (one defect found, ten verified correct).
  "Fix the instance, audit the class" as a report shape.
- **Found-vs-added split** in the scroll-law audit (four behaviors
  verified already-correct, one gap added with a one-shot flag) — the
  check-already-satisfied discipline producing a minimal diff.
- **Honest history check**: before "keeping keyboard parity", verified
  reorder had been pointer-only all along — preventing an invented
  regression claim.

## Addendum 3 — nav audit + nav fixes (opus ×2, commits 32ec518 + 4d4dca3)

### RV4 — audit reported two false BROKEN verdicts (audit agent + supervisor)
The read-only nav audit ranked "exploration-drawer chart bars do nothing"
(#5) and "EXPLORATION drawer defaults open" (#12) as confirmed frictions.
The FIX agent, driving a CLEAN profile, proved both already-correct: the
bar drill has been wired since b4ef1fa, and the drawer defaults closed —
the audit drove a dirtied localStorage (persisted-open preference) and a
stale observation. Supervisor spot-checked only frictions #1/#2, so the
false verdicts reached the owner in the ranked list. **Rules:** (a) UI
audits run on a clean profile (fresh localStorage/user-data dir), and any
BROKEN verdict is reproduced twice before it ranks; (b) the supervisor
spot-check must sample at least one verdict per severity class, not just
the top; (c) fix briefs keep the check-already-satisfied clause — it
converted both false positives into cheap pins instead of regressions.

### What worked (encode)
- **Check-already-satisfied caught both false positives** and produced
  pins, not re-code. The clause pays for itself.
- **Pre-authorized branch choice done right (#2):** the agent chose
  select+reveal over in-map drill and argued it from the system's own
  invariants (grain is a global control; the roll-up filter is guarded by
  the map-connectivity pin) — exactly the aligned-judgment the WHY block
  exists to enable.
- **Pin-shape upgrade:** "rail buttons exist" → "rail buttons LAND"
  (click + destination-visible). The regression that slipped was an
  existence pin on a behavior contract; encode as: pin the VERB, not the
  element.
- **Measured-threshold fix (#8):** density threshold chosen against the
  synthetic 3.6h session with before/after counts (60 labels/151
  overlaps → 0/0 → 60 on zoom) — the fix ships with its own evidence.
- **Honest instrument disclosure (#7):** four failed CSS candidates named
  before the capture-phase freeze solution; "measured 4, all failed"
  beats a silent workaround.

## Addendum 4 — export lane (opus, a23dfcc + bbd1695)

### RV5 — DEAD TESTS: three pdd_export tests fail on clean HEAD and never
run in ANY gate path (bundled Python can't run pytest; system Python lacks
docx, so the docx-gated tests no-op) — string drift went undetected for an
unknown period. The two-interpreter split creates EXECUTION HOLES the
skip-coverage rule alone doesn't catch. **Rule:** every test file needs at
least one gate path that actually executes it; when an environment split
gates tests, a compensating runner (the agent used the bundled
interpreter's __main__ route) becomes part of the gate, not an ad-hoc
rescue. Agent triaged it correctly: proved pre-existing via stash-on-clean-
HEAD, flagged, didn't fix (scope discipline).

### RV6 — commit-subject style drift (minor): "feat(export):"/"docs:"
conventional-commit prefixes entered a history whose convention is bare
imperative subjects. Series-consistency clause (#38) should name commit-
subject style, not just CHANGELOG policy.

### What worked (encode)
- STEP-0 probe again (grain_keys presence + 19-work-item fold proven
  before code); byte-identical-when-absent proof for an additive change;
  cross-language twin built by REUSING the shared rule file via the
  existing Python entry point (no second rule copy) — the shared-data-
  not-code pattern applied correctly.
- The deliverable audit found the documents still carry the furniture the
  screens shed (ROI zero-table under its own gate note, duplicated
  feeds, percentile columns at N=5, two truths for one cycle-time) —
  confirming the rule: every honesty gate must bind BOTH renderers of a
  fact (screen and document), or the document becomes the leak.

## Addendum 5 — perf-ceiling lane (sonnet, d0628cb)

### RV7 — subagent wrote directly to the supervisor's memory store
(project_viewer_reload_breaks_session.md + MEMORY.md index line). Content
accurate, format correct, genuinely useful — but unauthorized: the store
is the main session's to curate (continuity). **Rule:** briefs state
"report memory candidates; never write the store" (added to Lane C's
brief live). Outcome kept (the memory stands, it's good).

### RV8 — (POSITIVE, mechanism) the global skills pack reaches subagents.
The agent self-reported violating the poll-ban twice, then self-corrected
citing windows-environment — a rule its brief never stated. With the pack
now at ~/.claude/skills/, dojo/environment skills auto-load for agents on
this machine; brief attachments become reinforcement, not sole delivery.

### What worked (encode)
- **Self-correction before commit, disclosed in the doc:** misread act
  titles as case labels, ran a DOM probe (`.tl-case-label` count = 0),
  corrected, and documented the correction instead of folding it silently.
- **Method deviation disclosed with mechanism:** page.reload() breaks the
  one-shot --session handoff (did-finish-load listener consumed); switched
  to a second electron.launch and recorded WHY. Instrument fallibility
  handled by the book.
- **Honest ceiling framing:** Tier-3 completed, so the doc says "linear to
  3840 steps, no strategy needed" instead of inventing work; the one real
  knee (minimap span-relative filter goes blank) is named with its exact
  code line and left as [recommendation — not scheduled work].

## Model-tier observations (this cycle's sample)

- **sonnet** (R1a/R1b/R1c): competent execution; all serious flaws came
  before rules were fed forward; near-perfect once briefs carried the
  accumulated law list. Quality tracks brief explicitness ~linearly.
- **opus** (R2/R3/R4): earned the judgment layer — probe-first, absurdity
  catch, drift disclosure, single-seam solutions (grainLabel), honest
  skip framing. Underspecified corners got GOOD decisions, not guesses.
- **haiku** (R5): fine for dictated-structure docs at ~1/5 the tokens;
  literalism + encoding slip; wants exact text, not intent.
- Token cost was NOT the differentiator between sonnet and opus in this
  cycle (~240–330k each); judgment density was.
