# Subagent delegation post-mortem — disclosure pass, v1.4.0 (2026-07-02)

> **Purpose.** The v1.4.0 disclosure pass was implemented by two delegated
> subagents (Opus: critique items 1–6, 8, 9, 21 · Sonnet: items 7, 10–20),
> supervised and validated by the orchestrating session, and released. This doc
> extracts **every deviation, near-miss, and supervisor-side error** from that
> run — each with root cause, how it was (or wasn't) caught, and the rule that
> prevents it — so the lessons consolidate into reusable guidance instead of
> being re-learned. Evidence: the agents' final reports, the supervisor's
> independent re-validation (smokes re-run, full-surface screenshot/density
> probe), and the shipped code at `62020bf` (v1.4.0).
>
> **Honest headline first:** across ~30 implemented items there were **zero
> hard-invariant breaches, zero gate failures, zero data-handling violations**,
> and both agents ran the full pre-commit gate and reported exact counts. The
> register below is deliberately exhaustive about what *did* go wrong; it is a
> polish list, not a disaster report — and two of the findings are the
> supervisor's own errors, one of which wrongly accused the Sonnet agent.

## Case register

Format: what happened → root cause → caught by → status → **rule**.

### S1 — Doubled disclosure marker (Sonnet · items 10, 11) — *shipped defect*

All three new `▸ How this works` / `▸ Why these sessions don't compare yet`
disclosures put a literal `▸` inside the `<summary>` while `.how-this-works >
summary` never suppresses the native `<details>` marker — so every instance
renders a doubled chevron (`▶ ▸`). Root cause: the summary-glyph pattern was
copied from the Machine-drawer style without checking how the source pattern
handles the native marker. Caught by the supervisor's post-commit eyeball on
Compare only; **both** the agent's eyeball and the supervisor's first pass
missed it on Template / App Library. Shipped in v1.4.0; fix chip spawned.
**Rule:** a `<summary>` may carry its own chevron glyph only together with
native-marker suppression (`list-style: none` + `::-webkit-details-marker`);
"no doubled disclosure markers" belongs on the eyeball checklist.

### S2 — Clipping-probe false positive in a new e2e pin (Sonnet · item 20) — *self-caught*

The first draft of the agent's own item-20 pin used the standard
`scrollWidth > clientWidth` clipping heuristic — which is **true by design**
whenever `text-overflow: ellipsis` legitimately elides a label. The agent
caught this itself before committing and re-based the pin on
label-box-vs-band geometry. The supervisor's density probe had the **same
blind spot** (it reported Flow's ellipsized `.tl-act-app` labels as "clipped"
both before and after the fix, requiring manual eyeballing to disambiguate) —
and CHIP-GUARDRAILS itself taught the naive heuristic. **Rule:** ellipsis ≠
clipping. The probe must either exclude `text-overflow: ellipsis` elements or
assert box-vs-container geometry. (Guardrails doc amended in this commit.)

### S3 — Arbitrary target for a multi-candidate action (Sonnet · item 11) — *accepted*

The Compare empty-state CTA drills into `sessions[0]` — arbitrary among ≥ 2
loaded, unrelated sessions. The agent flagged the arbitrariness itself; the
spec had said only "targets a session". Root cause: **under-specified
delegation prompt**, not agent judgment. **Rule:** any action with multiple
plausible targets gets an explicit selection rule in the spec ("first by
capture date", "the session whose badge is furthest from Tier 2", …) — or the
agent should ask/flag, which this one did.

### O1 — De-dup satisfied in letter, not in look (Opus · item 8) — *shipped, owner-optional*

Item 8 ("merge the duplicate case-state chips — one badge, subtitle carries
the second clause") landed as one badge **element** whose subtitle is styled
as a bordered uppercase mono chip (`.ov-badge-sub`) — visually still two
chips glued together, saying "✓ 4 cases — marked by the worker | CASE
ANALYSIS ON". The motivation (one fact, one voice) was in the critique doc;
the acceptance line was DOM-shaped, so a DOM-shaped fix passed. **Rule:**
de-duplication acceptance criteria must be stated as the *visual outcome*
("reads as one element with one phrasing"), and review judges the screenshot,
not the DOM.

### O2 — Dead CSS left behind after removing a component (Opus · item 8) — *shipped debris*

The `.ov-tier2` chip was removed from the Overview render, but its three CSS
rules remain in `styles.css` with zero remaining references (verified by
grep). **Rule:** removing a component includes grepping its class names for
now-dead styles in the same commit.

### O3 — Disclosed residual risk, never verified (Opus · item 9) — *open*

The agent's report honestly flagged "the Session-summary teaser line is
longer now … worth a glance at very narrow widths" — and no one ever glanced:
every eyeball ran at 1500×950. The disclosure worked; the supervision
dropped it. **Rule:** every residual risk a subagent discloses gets an
explicit disposition (verify now, or log as an open item) — a disclosed risk
that nobody owns is functionally undisclosed. Added to the fix chip as a
verification step.

### F1 — Supervisor mis-flag: the agent was right (supervisor) — *review error*

The release review flagged "the Compare CTA renders as an underlined link
rather than a button-styled control — not the treatment the map's CTA uses."
Wrong: the referenced `data-map-cta` pattern **is** `<button class="link-btn">`
— underlined link styling (`renderer.js`, `styles.css`). Sonnet mirrored the
pattern faithfully; the reviewer compared against an imagined pattern instead
of opening the real one. Cost: a false defect reported to the owner.
**Rule:** before flagging "doesn't match pattern X", open X. Corollary for
spec-writing: if a specific look is wanted, describe the look — "mirror X"
inherits whatever X actually is.

### F2 — Guessed DOM handles + silent skips (supervisor, then found enshrined in the docs)

The first screenshot-drive script guessed the top-nav handles
(`data-view="template"|"library"`); the real values are
`"canonical"|"vocabularies"`, and the `if (count())` guards skipped both
surfaces **silently**, costing a second full drive pass. Worse:
CHIP-GUARDRAILS' DOM-handle map documented the **same wrong values**, so
every future context-blind chip would hit the identical trap. (Guardrails doc
corrected in this commit.) **Rule:** grep the selector from `index.html`
before driving; absent-selector paths in drive scripts fail loud, never
silent-skip.

### F3 — Committed demo session regenerates on every viewer launch (process near-miss)

Both agents correctly reverted `sessions/example-aggregate/` after their
runs, but the viewer re-analyzes the session **on load**, so the
owner-facing launch ("run the app so I can see") silently dirtied the tree
again — discovered only during release prep, reverted before the release
commit; `publish-release.ps1`'s clean-tree provenance guard was the last-line
backstop. **Rule:** eyeball launches load a **temp copy** of the demo session
(exactly what `e2e/session-smoke.js`'s `freshenSession()` does) or are
immediately followed by the revert pair. Never leave a launch-against-the-
committed-session un-reverted, even "just to show the owner".

### F4 — Shell/env drift between orchestrator and agents (supervisor, minor)

After the agent runs, a repo-relative PowerShell invocation
(`viewer/python/python.exe …`) failed on a drifted working directory;
switching to Bash with an explicit `cd` fixed it. Consistent with the
existing lesson that PS 5.1 also mangles quoted native args (`git commit -F`
convention). **Rule:** repo-relative tool invocations use Bash with an
explicit `cd "<repo>"` prefix; PowerShell is for Windows-specific tooling.

## What worked — encode it, don't regress it

- **The honest skip (item 7).** Sonnet investigated, found the existing
  add-to-library flow needs ONE interaction signature while the Analysis row
  aggregates many, and skipped with a documented reason instead of inventing
  pick-a-representative logic. This is the stop-when-precondition-unmet
  discipline working in a subagent. Skips of this quality are a *success*.
- **Self-catch S2** — the agent questioned its own pin's heuristic before
  committing. The behavior to preserve: treat a new guard's first failure as
  "is my assertion right?" before "is the code wrong?".
- **Full gate + exact counts in both reports; pins updated deliberately and
  named in the commit messages** — made independent re-validation cheap.
- **Sequential same-layer delegation** (both agents touched `styles.css`,
  `index.html`, view modules) — zero merge conflicts, zero collisions.
- **Model tiering** — Opus on the architectural re-altitude, Sonnet on the
  mechanical polish list: both came back gate-green; the only shipped defect
  (S1) is cosmetic and model-agnostic (the supervisor missed it too).
- **Self-contained prompts** (read-first list, DOM handles, guarded files,
  gate contract, report format) — neither agent flailed on navigation or
  invariants; neither touched guarded files (`process-map-levels.js`,
  `dfg-viewer.js`, pipeline).

## Consolidation — where each rule now lives

**Landed with this commit (guidance fixes):**

1. CHIP-GUARDRAILS DOM-handle map corrected (`canonical` / `vocabularies`) — F2.
2. CHIP-GUARDRAILS clipping check gains the ellipsis caveat — S2.
3. CHIP-GUARDRAILS gains a compact **UI-verification pitfalls** list
   (marker doubling · ellipsis-vs-clip · mirror-the-real-pattern ·
   dead-CSS grep · temp-copy sessions · loud-fail selectors ·
   one narrow-width glance) — S1, S2, F1, O2, F3, F2, O3.

**Skill candidates (next step, per the owner's intent):**

- **`delegate-ui-pass`** — the delegation prompt template that worked here
  (read-first list → scoped items with acceptance stated as *visual
  outcomes* → guarded files → pin policy → gate contract → report format),
  plus the new clauses: selection rules for multi-candidate actions (S3),
  "mirror X" ⇒ side-by-side screenshot of X and the new instance in the
  agent's eyeball (F1/O1), removals include a dead-style grep (O2).
- **`review-subagent-ui-work`** — the supervisor checklist: re-run the
  smokes independently; eyeball with the referenced patterns *open* (F1);
  disposition every disclosed residual risk (O3); diff the report's claims
  against the shipped DOM before repeating them to the owner.

**Fix chip spawned** for the shipped debris: S1 (marker suppression on all
three surfaces), O2 (dead `.ov-tier2` rules), O3 (narrow-width glance at the
summary teaser), and the owner-optional O1 phrasing softening.
