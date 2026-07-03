---
name: subagent-briefing
description: Use whenever delegating implementation, audit, review, or polish work to subagents (sonnet or opus) in Claude Code, and whenever accepting or reviewing a subagent's deliverable. Covers writing the brief, picking and sequencing models, verifying completion, the supervisor review checklist, risk disposition, and the postmortem loop. Consult it before EVERY delegation, even small ones; most documented failures came from briefs that skipped one clause. Distilled from the 2026-07 audit cycle (C1-C9, catalog in .claude/agent-findings/) and the v1.4.0 disclosure-pass postmortem.
---

# Subagent delegation: brief, supervise, review

Two sources of evidence: nine documented failures and five zero-correction
lanes from the 2026-07 audit cycle (catalog:
.claude/agent-findings/2026-07-02_subagent-failures_audit-cycle.md), and
the v1.4.0 disclosure-pass postmortem (3 agent findings, 4 supervisor
findings, and a list of behaviors that worked). Case IDs: C* = audit
cycle, S* = Sonnet findings, O* = Opus findings, F* = supervisor/process
findings.

## Operating principles

These are the reasons behind every rule below. When a situation is not
covered by a specific rule, decide from these.

1. **The brief is the agent's entire world.** A subagent has no memory of
   prior sessions, cannot ask questions mid-flight, and will fill every gap
   with a plausible guess. Write the brief as a contract a stranger could
   execute: context, scope, acceptance, verification, report format. If you
   find yourself thinking "it will figure that part out", that part is where
   it will fail.
2. **Acceptance criteria live at the layer the owner cares about.** A
   DOM-shaped acceptance line gets a DOM-shaped fix that can still look
   wrong (O1). For UI work, state the visual outcome ("reads as one element
   with one phrasing"); for logic, state the observable behavior; review
   judges the screenshot or the runtime, not the diff.
3. **Volatile facts do not belong in briefs or guidance docs; methods do.**
   Line numbers drift, DOM handles drift, and a wrong value enshrined in a
   doc traps every future agent (F2: CHIP-GUARDRAILS documented wrong
   nav handles). Give quoted strings to grep, name the file that is the
   source of truth, and require the agent to grep it fresh. This applies to
   this skill too: verify any repo fact named here before relying on it.
4. **An agent's report is a claim, not evidence.** Verify deliverables
   independently: re-run the checks, open the files, look at the surface.
   The two shipped defects in the v1.4.0 pass were both missed by the agent
   AND the supervisor's first pass; independent re-derivation is the only
   reviewer that scales.
5. **Documented skips are successes.** An agent that investigates, finds a
   precondition unmet, and skips with a written reason (Sonnet, item 7) is
   worth more than one that invents bridge logic to force completion. Say
   so in the brief explicitly, or agents will treat completion rate as the
   goal.
6. **The supervisor is also a failure source.** Two of the v1.4.0 findings
   were supervisor errors, one a false accusation of a correct agent (F1).
   The review rules below bind the reviewer as hard as the brief binds the
   agent.
7. **Intent outranks specification.** A spec enumerates the cases you
   thought of; stated intent lets the agent resolve the cases you did
   not. Lead every item with WHY, then what. O1 is the proof: the
   motivation lived in a different doc, the acceptance line was
   DOM-shaped, and the letter got satisfied while the intent did not.
8. **The brief encodes the supervisor's fallible beliefs.** Every factual
   premise in a brief ("expect three rules", "the pattern is X") is a
   claim that might be wrong (F1, F2). Attach a falsification trigger to
   each: "if you find a live reference, STOP; the premise is wrong;
   report instead of proceeding." Agents that obey a wrong premise
   silently are executing the supervisor's error at machine speed.

## Model selection and sequencing

- opus: anything involving API design, cross-file state interaction,
  engine surgery, or a seam between two waves. Opus still shipped two
  interaction-seam bugs (C5, C6) and one letter-not-look fix (O1), so
  review is not optional.
- sonnet: fully-specified mechanical work where every change has a named
  file:line, a quoted string to grep, and a stated acceptance check.
  Observed failures cluster in process discipline, cross-state reasoning,
  and display-format edges. Update from the v1.4.0 pass: sonnet also
  handles scoped UI polish lists well WHEN the brief carries a read-first
  list, DOM handles, guarded files, and a report contract; it produced a
  quality self-catch (S2) and the model-worthy honest skip (item 7) under
  that brief shape. The brief quality, not the item count, is the limiter.
- haiku: dictated-structure documents and mechanical transcription, at
  a fraction of the tokens (R-cycle: a 6-section runbook for ~51k
  tokens vs ~240–330k for code lanes). Two failure modes to brief
  around: instruction literalism ("clearly marked as examples" emitted
  as a literal heading, RH2) and environment slips (a BOM in the commit
  subject, RH1). Give haiku the exact text to emit, never a description
  of it; descriptions get echoed, not interpreted.
- Update from the 2026-07-03 R-cycle (7 sequential agents, R1–R5):
  sonnet quality tracks brief explicitness almost linearly — every
  serious sonnet flaw (RA1 state hygiene, RB1 report/code drift)
  happened BEFORE the accumulated rules were fed forward; the same tier
  under a rules-carrying brief was near-perfect. Opus earned the
  judgment layer: probe-first verification (R3), an absurdity catch on
  a derived count (530→47, R4), honest drift disclosure (R2). Token
  cost was NOT the sonnet/opus differentiator; judgment density was.
  Spend opus where underspecified corners will be met with decisions;
  spend sonnet where the brief can enumerate; spend haiku where the
  brief can dictate.
- Never trade the review checklist for a bigger model.
- **Sequencing:** agents that touch the same layer (same stylesheet, same
  index.html, same view modules) run sequentially, never in parallel.
  Sequential same-layer delegation in v1.4.0 produced zero collisions.
  Parallel delegation only for disjoint lanes, and then each brief names
  the other agent's lane so overlap is checkable (C8).
- **Feed the log forward (multi-agent cycles).** Keep the case register
  LIVE during the cycle, not post-hoc: after each agent, verify, log the
  flaws, and put every new rule into the NEXT brief's law list with its
  scar story ("each was violated once; treat as law"). Rules carrying
  provenance get obeyed; bare imperatives get weighed. The R-cycle
  measured the effect: same model, three briefs apart, flags dropped
  from three to zero. This composes with (does not replace) attaching
  dojo skills.
- **Hard cap: two agents in parallel, never more**, however disjoint the
  lanes look (owner rule, 2026-06-12). Review capacity, not lane
  geometry, is the binding constraint; every parallel agent's diff still
  gets a full coordinator review.

## The brief (every delegation)

Copy the skeleton in [BRIEF-TEMPLATE.md](BRIEF-TEMPLATE.md) rather than
writing a new shape. Every brief contains all of the following.

### Context and orientation

1. A **read-first list**: the files the agent must read before changing
   anything, in order. Orient the agent's attention before it acts; both
   v1.4.0 agents navigated cleanly because the brief did this.
2. The **source-of-truth pointers** for anything volatile: "DOM handles:
   grep index.html, do not trust remembered values" (F2). Per task, a
   file:line pointer plus a QUOTED string to grep (line numbers drift;
   strings survive).
3. For any harness or fixture: name a canonical call site to copy
   VERBATIM, never a prose description of parameters. Require an early
   magnitude sanity check ("expect roughly N outputs; stop and
   investigate if far off"). (C2, coordinator miss)

### Scope and fences

4. Process fences, verbatim: "No subagents, no background tasks,
   foreground only. Your final message IS the deliverable." (C1) Then
   pick ONE git mode and state it explicitly — both are validated, and
   the single-writer PRINCIPLE (one writer at any moment) holds in both:
   - **Coordinator-commits** (default for parallel lanes, mixed-trust
     work, or anything the coordinator will amend): "Do NOT commit;
     leave git state (branches, worktrees, stashes) to the coordinator."
   - **Agent-commits** (owner-directed, or sequential phase-per-agent
     cycles; the 2026-07-03 R-cycle ran 6 agent commits with zero git
     accidents): each agent commits its own lane at the end, under ALL
     of: sequential chain (no concurrent writer), explicit-path staging
     only (never `git add -A`/`.`/`-am`), gates green before the commit,
     no push, message via `git commit -F` with the repo's subject/
     trailer conventions stated in the brief. The coordinator still
     verifies each commit independently before the next launch.
5. Exactly ONE lane list, stated once. Tasks reference files but never
   restate lane membership. Name the parallel agent's lane so overlap
   is checkable. (C8)
6. Standing ignore clause: "Pre-existing untracked files and
   .claude/settings.local.json are environmental; do not touch or
   report on them." (C8)
7. **Guarded files named explicitly** (for the viewer repo:
   process-map-levels.js, dfg-viewer.js, the pipeline). Neither v1.4.0
   agent touched a guarded file because the brief listed them.
8. **Permission to skip**: "If a task's precondition does not hold,
   investigate, skip, and document the reason in your report. A justified
   skip is an acceptable outcome; invented workarounds are not."

### Acceptance criteria

9. State acceptance as the observable outcome at the owner's layer, never
   as DOM shape or diff shape (O1). De-duplication acceptance reads "one
   element, one phrasing, judged on the screenshot".
10. Any action with multiple plausible targets gets an explicit selection
    rule ("first by capture date", "the session furthest from Tier 2"),
    or an instruction to flag and ask (S3).
11. "Mirror pattern X" inherits whatever X actually is. Either describe
    the intended look directly, or require the agent to put X and the new
    instance side by side in its own verification (F1, O1).
12. For warning/error classes: "count the occurrences and account for
    each; acceptance is zero at runtime, not one fixed instance." (C4)
13. Removals include cleanup: removing a component includes grepping its
    class names and deleting now-dead styles in the same change (O2).

### Verification the agent must run

14. Mandatory self-verification: a temp script with named assertions,
    deleted afterward, plus per-file foreground vitest commands spelled
    out. Full-suite runs are forbidden in the brief (Windows reporter
    hang).
15. Tests: every behavior change needs a positive control AND a
    suppression/mutation control. Snapshot regens only with "read the
    new strings and justify each delta."
16. New-pattern hygiene for summary/disclosure elements: a <summary> may
    carry its own chevron glyph only together with native-marker
    suppression (list-style: none plus ::-webkit-details-marker) (S1).
    Generalized: when copying a visual pattern, check how the source
    handles the pieces the browser draws for free.
17. When a NEW guard or pin fails for the first time, the agent's first
    question is "is my assertion right?" before "is the code wrong?"
    (S2: the standard scrollWidth > clientWidth clipping heuristic is
    true by design on legitimate text-overflow: ellipsis; assert
    box-vs-container geometry instead).
18. Run the full pre-commit gate and report exact counts (tests run,
    passed, pins updated by name). Exact counts made independent
    re-validation cheap in v1.4.0; vague "all green" does not.

### Report contract

19. Require this exact report structure so review is mechanical:
    - Per item: what changed, files touched, verification evidence with
      exact counts.
    - "Found but did NOT change" section. (mandatory, C-series)
    - "Skipped, with reason" section.
    - "Residual risks" section: anything the agent noticed but could not
      verify (narrow widths, timing, real-data cardinalities).
    - Pins/snapshots updated, each named and justified.

### Calibration layer (extracted 2026-07-03: a real brief was written,
### then mined; see EXAMPLE-BRIEF.md for all of these in situ)

20. **Intent line first on every item.** One sentence of WHY before any
    mechanics. This is the cheapest ambiguity-resolver in the whole
    brief (Principle 7).
21. **Per-item anti-goals.** Lane fences stop cross-file drift; they do
    not stop "while I am here" drift inside an allowed file. Every item
    states what NOT to do ("delete nothing else, however dead it
    looks"; "do not restyle otherwise").
22. **Expected change magnitude with a stop trigger.** "Under 10 lines
    of CSS; if you are writing more, stop and re-read the intent."
    Generalizes the C2 output sanity check to the diff itself: the
    biggest silent failure of a weaker model is a misunderstanding that
    produces a plausible LARGE change.
23. **One worked example per pattern.** When an item applies a known
    pattern, paste the exact before/after or the exact code shape once;
    the agent replicates it. Few-shot inside the brief beats prose
    description every time (C2's copy-VERBATIM rule, extended from
    call sites to any transformation).
24. **Decision budget.** State explicitly what the agent decides alone
    and what it must flag ("you decide what the screenshots show; the
    owner decides whether it needs fixing"). S3's selection rule is one
    instance; the general form is an autonomy ledger per item.
25. **Priority order plus graceful degradation.** Mark items mandatory
    or optional and define the behavior under time pressure ("if
    anything runs long, skip item 4 and say so"). Undefined time
    pressure degrades everything a little; defined pressure degrades
    the chosen item completely and nothing else.
26. **Premise falsification triggers.** Every factual claim the brief
    makes gets a "if this does not hold, STOP and report" clause
    (Principle 8).
27. **Verification-only items are legitimate items.** An item whose
    deliverable is a verdict plus evidence ("two screenshots and one
    sentence; 'no change needed' is a success") closes disclosed risks
    (O3) without inviting unrequested fixes.
28. **Environment preamble as positive facts.** What is installed, what
    runs on launch, what must NOT be set up. C1-class stalls and
    F3-class dirty trees both start as environment confusion.
29. **Glossary of house terms.** Two lines defining chip / pin / gate /
    surface cost nothing and remove a whole class of silent
    misreadings; a weaker model does not know the house jargon.
30. **Report tone contract.** Plain and factual, no adjectives about
    the agent's own work, and "unverified" is an explicitly acceptable
    status. Confidence-padding in reports is what makes review
    expensive; permission to be uncertain is what makes reports honest.
31. **Mission anchor.** One closing sentence restating the entire task
    in plain words, for the agent to re-read when it loses the thread.
    Long-context drift is the top weak-model failure mode; the anchor
    is the cheapest countermeasure that exists.
32. **Attach counter-skills per model and task risk.** The dojo layer
    (verified-completion, debugging-discipline, scope-discipline,
    test-integrity, no-silent-failures, grounded-claims, seam-checking)
    exists to be attached in the brief's read-first list. Defaults per
    model and the full mapping live in the pack README. Keep it to 4-5
    per brief: attaching everything dilutes everything.

### Calibration additions (extracted 2026-07-03 from the R-cycle briefs;
### EXAMPLE-BRIEF-R3.md shows most of these in situ)

33. **No unsatisfiable invariants.** Before issuing a MUST-NOT, check
    the tooling can honor it. "Leave sessions/ exactly as-is" while the
    app regenerates that folder on every launch forced an agent into
    improvised recovery (RS2→RA1). Prohibitions the environment breaks
    become recipes: "expect churn there; run the documented revert pair
    before commit; never stage it."
34. **Probe gate for the load-bearing assumption.** When a whole phase
    rests on one premise, make verifying it the brief's literal STEP 1
    with stop-the-whole-phase wording and a pasted-evidence requirement
    — before any code is written. Strongest observed form of the
    premise-falsification trigger (#26): R3's agent probed annotation
    preservation first, pasted the result, built with zero rework.
35. **Pre-authorized decision points.** For every fork the supervisor
    can foresee, name the condition, the approved fallback, and require
    "state exactly what you did" ("if the slider isn't available on
    that view, give the module the local toggle the P6 machinery
    already supports, and say so"). Extends the decision budget (#24)
    from who-decides to here-is-the-approved-branch.
36. **Reports paste final contracts.** Any constant, schema block, or
    config the agent changed appears in the report as the FINAL block,
    pasted — not a remembered delta. RB1: a summary said "markers/
    screenshots off" while the code (correctly) also set steps:false;
    trust erodes even when the code is right.
37. **Pass AND skip counts, plus coverage of the skips.** "520 passed"
    is not green if 11 skips are exactly the tests covering the layer
    touched (RA2 — system-Python deps gate the pipeline tests). Reports
    state pass count, skip count, and whether the skipped set covers
    the changed code; if it does, name the compensating check run
    instead (R3 ran the bundled-interpreter golden).
38. **Series-consistency clause.** Anything cycle-wide agents could
    plausibly touch divergently — CHANGELOG, version files, doc
    registries — gets its policy stated once in EVERY brief of the
    cycle ("do not touch CHANGELOG; the release cut updates it"). Two
    agents made opposite reasonable calls in one cycle.
39. **Sanity-check derived aggregates before shipping them.** Any
    computed count/sum a surface will display gets one absurdity check
    against the data's shape ("~530 unnamed controls in a 155-event
    session — suspect the aggregation, not the data"). R4's union-vs-
    sum catch is the model; the failure mode it prevents is a plausible
    number computed with the wrong shape.

## Launch and completion (before treating it as done)

- A "completed" notification is not a deliverable. Confirm the report
  text exists and the claimed files changed (git status). Empty
  scratchpad = stalled agent; resume it with "everything is prepared,
  do ONLY X, end your turn with the report." (C1)
- Teardown after any agent chain: git worktree list and git branch,
  looking for leftovers; prune merged debris, ask before touching
  anything unmerged. (C9: a stalled agent left a stray worktree.)
- Branches and worktrees are ordinary tools the coordinator uses freely
  when isolation helps; there is no standing don't-branch rule (a
  one-time 2026 incident briefly hardened into one; the owner retired
  it on 2026-06-12 and re-confirmed on 2026-07-03 that it was a
  one-time thing). Agents leave git state to the coordinator
  (single-writer); finished work lands on main promptly
  (owner-contract).
- **Risk ledger (O3):** copy every residual risk from the agent's report
  into a ledger and give each one a disposition: verified now (say how),
  or logged as a named open item. A disclosed risk nobody owns is
  functionally undisclosed; O3 shipped because the disclosure worked and
  the supervision dropped it.

## Supervisor review checklist

Bind yourself first:

- Before flagging "doesn't match pattern X", OPEN X. The v1.4.0 review
  falsely accused a correct agent by comparing against an imagined
  pattern (F1). Review with the referenced patterns open on screen.
- An accusation in your review log is a claim: it needs the same
  paste-verifiable standard as a completion claim. The R-cycle log
  recorded a "dubious number" that the next agent independently
  reproduced (RS1); verify before recording, and revise the log in
  place when evidence moves — a review log with unretracted false
  entries poisons the skills it feeds.
- **Per-phase cadence for multi-agent cycles:** after EVERY agent,
  before launching the next — re-run the gates its change can affect
  yourself, read one artifact (a screenshot, the new doc, the changed
  constant), diff its report against the tree. This caught a
  report/code mismatch, a leaked affordance gap, and a BOM'd commit
  subject (RB1, RB2, RH1) at the cheapest possible moment. Do not
  batch verification to the end; regressions compound across phases.
- **Shared-checkout concurrency:** before a cycle on a shared working
  directory, check for live concurrent sessions; expect that foreign
  commits CAN land mid-cycle (RS3: an unattributed commit appeared
  between two agent runs), attribute every commit on the branch before
  merging, and prefer worktree isolation when concurrency is likely.
  Also: permission contexts differ between the orchestrator and its
  agents (RS4) — never design a flow that depends on orchestrator-side
  destructive ops; put documented cleanup recipes in the agent's lane.
- Treat your own probes as fallible instruments: the supervisor's density
  probe had the same ellipsis blind spot as the agent's first pin (S2).
  When a probe and an eyeball disagree, the eyeball wins pending a better
  probe.
- Diff the report's claims against the shipped DOM/behavior before
  repeating any claim to the owner.
- Drive scripts: grep every selector from index.html before driving;
  absent-selector paths fail LOUD, never silent-skip (F2 cost a full
  second drive pass).

Then the observed failure classes:

- Interaction positive controls: for every expand / toggle / show-more,
  does a test assert the POST-interaction state contains something the
  pre-state did not? An existing button is not a working reveal. (C5)
- Cap-and-reveal pairing: whoever ships a cap must ship the uncapped
  data in the same payload. (C5)
- Fallback buckets: is there a test with at least TWO distinct
  unmapped inputs? Synthetic fixtures gravitate to one. (C6)
- Hidden controls: does hiding a control neutralize the state it
  governs? Test: below threshold, data outside the hidden filter's
  window must still be reachable. (C7)
- Display formats: for every changed value source, read the render
  site; integers stay integers, units stay attached. (C3)
- Test honesty: if a regression test cannot reproduce the original
  failure (jsdom vs React scheduling, for example), the test header
  must say so and name the authoritative control. (C4)
- Marker doubling: every new <details>/<summary> checked on EVERY surface
  it ships to, not just one (S1 was caught on one surface and missed on
  two).
- Ellipsis is not clipping (S2): exclude text-overflow: ellipsis elements
  from clipping probes or assert geometry.
- Dead styles: grep the class names of anything removed (O2).
- One narrow-width glance whenever text got longer (O3): eyeballs at a
  single 1500x950 viewport miss every width-dependent risk by
  construction.
- Grep the whole diff for em dashes (owner rule: never).

## After UI restructures: live walkthrough is mandatory

Synthetic fixtures miss real cardinalities (C6) and real timing (C4).
Walk the changed surfaces with a realistic profile and read the console.

- Motif: seed the preview with the 90-day demo profile (fetch
  /Data/motif-demo-*.json into IndexedDB, set onboarded + legacyPro,
  reload). For untraceable console warnings, temporarily prepend a
  console.error interceptor to src/main.jsx, reload, read the captured
  stacks, revert.
- Viewer repo: eyeball launches load a TEMP COPY of the demo session
  (exactly what e2e/session-smoke.js's freshenSession() does) or are
  immediately followed by the revert pair. The viewer re-analyzes on
  load, so launching against the committed session silently dirties the
  tree, even "just to show the owner" (F3). publish-release.ps1's
  clean-tree guard is the last line, not the plan.

## Environment rules

- Repo-relative tool invocations use Bash with an explicit
  cd "<repo>" prefix; PowerShell is for Windows-specific tooling only.
  PS 5.1 mangles quoted native args (git commit -F convention) and
  drifted working directories break repo-relative paths (F4).
- Full-suite vitest is forbidden in briefs (Windows reporter hang);
  spell out per-file foreground commands instead.
- The full machine catalog (MSIX shadow reads, poll-loop bans, desktop
  tracker facts) lives in the windows-environment skill; restate its
  relevant lines in any brief whose lane touches tests or files outside
  the repo.

## Close the loop: postmortem every delegation cycle

This skill exists because two cycles were postmortemed. Keep the flywheel:

1. After each delegation cycle, write the case register: what happened,
   root cause, caught by, status, rule. Include supervisor errors and
   near-misses, not just agent defects, and include a "what worked" list
   so good behavior gets encoded rather than regressed.
2. Land guidance fixes in the same commit as the postmortem (wrong values
   in docs are traps for every future agent, F2).
3. Per-session registers land in .claude/agent-findings/ as raw dated
   catalogs; a later dedicated consolidation session lands each RULE
   here, in the matching lifecycle section, with its case ID (see the
   continuity skill). Rules that live only in a postmortem file get
   re-learned; rules promoted from a single session's sample get demoted
   (it happened, 2026-07-02).

## Known-good brief skeletons

The zero-correction lanes (engine window refactor, evidence gates,
deferred-clear waves, docs, review) and both v1.4.0 briefs all used the
shape in [BRIEF-TEMPLATE.md](BRIEF-TEMPLATE.md): read-first list, scoped
items with acceptance stated as visual outcomes, guarded files, pin
policy, gate contract, report format. When in doubt, copy that structure
rather than writing a new shape.

[EXAMPLE-BRIEF.md](EXAMPLE-BRIEF.md) is a complete, real brief (the
v1.4.1 fix chip) with every clause of this skill instantiated, including
the calibration layer. Prefer adapting it over adapting the abstract
template when the work resembles it.

[EXAMPLE-BRIEF-R3.md](EXAMPLE-BRIEF-R3.md) is the second worked example
(the R-cycle's zero-correction opus lane): a multi-phase feature brief
in agent-commits mode, with the probe gate (#34), scar-story law list,
WHY block, pre-authorized decision points (#35), and the
paste-final-contracts report clause (#36) all in situ. Prefer it when
delegating a feature phase rather than a polish list.

## References

- .claude/agent-findings/2026-07-02_subagent-failures_audit-cycle.md:
  full evidence for C1-C9 (formerly CASES.md, demoted to raw findings
  per the owner's consolidation process).
- AGENT-DELEGATION-POSTMORTEM-2026-07-02.md (viewer repo docs): full
  evidence for S*, O*, F* and the v1.4.0 "what worked" list.
- [BRIEF-TEMPLATE.md](BRIEF-TEMPLATE.md): copy-paste delegation skeleton.
- [EXAMPLE-BRIEF.md](EXAMPLE-BRIEF.md): a real, complete brief with all
  clauses in situ.
- Sibling skill delegation-postmortem: run it after every cycle; its
  output is where new rules for THIS skill come from.
