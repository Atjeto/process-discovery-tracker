# BA-helper cycle: findings register (2026-09-23)

Raw findings catalog for the overnight BA-helper implementation cycle, per the
skills-pack maintenance contract (log as it happens; coordinator misses included).
Format per case: what happened, model, root cause, caught by, correction,
candidate RULE. Case IDs: BH*.

## Case register

### BH1: magnitude estimate did not price the mandated tests and seams (coordinator, L2)
L2 brief said "additions under about 400 lines including tests"; the lane landed
963 additions (376 tests) against 2113 deletions. The excess was the seams RP-20
and RP-24 needed to be testable at all (main.js had no reachable seam; the C#
debounce needed extraction into ValueCoalescer) plus the mutation-controlled
tests the brief itself mandated. Root cause: the coordinator sized the band from
the source delta, not from the test load and the seam cost (subagent-briefing
#49 already says this). Caught by: the agent's own residual-risk disclosure.
Status: accepted, the additions are justified. RULE (reinforces #49): when a
brief mandates fail-first tests for N fixes in code with no test seam, add the
seam cost explicitly to the magnitude band.

### BH2: restart-point premise corrected by the lane (reviewer lane B claim, L2)
The restart point said RP-24's `Timer.Change` on a disposed timer "throws
ObjectDisposedException inside a UIA callback" (reviewer marked it PLAUSIBLE).
L2 probed .NET 8.0.19: it returns false and does not throw; the real defect was
duplicate emission, which a stress test reproduced (8/8 fail on the old
algorithm). Caught by: the brief's premise-falsification clause. Status: fixed
correctly; the restart point's RP-24 wording is stale (docs lane may annotate).

### BH3: both running lanes killed by the monthly spend limit (environment)
L1a and L3 died mid-flight with HTTP 429 ("monthly spend limit"); the owner
raised the limit about 40 minutes later. Handling per subagent-briefing
(environment kills: resume-first): tree-state diff of each lane against its
plan, then SendMessage resume of the SAME agents stating exactly what their trees
already contained. Both resumed cleanly; L1a finished in 4 minutes of resumed
work. Status: recovered. RULE (confirms the existing one): after a spend-limit
kill, diff first, resume the same agent with the tree inventory; never respawn.

### BH4: an eyeball script mutated the shared dev profile and flipped CI-3 (agent, L1a)
L1a's eyeball script collapsed the session summary (`pdt.summaryOpen`=0) in the
shared dev profile, which made the known CI-3 reference-map check pass once;
restoring the key made it fail again. Root cause: e2e and eyeball launches share
the developer's Electron profile (RP-36). Caught by: the agent itself, disclosed.
Status: RP-36 is on the L5 fix list (launch e2e with a temp user-data-dir).
RULE: e2e and eyeball launches use a throwaway profile; a check whose result
depends on persisted UI state is not a pin.

### BH5: the coordinator's dash sweep was blind for five commits (coordinator)
The pre-commit sweep piped `git diff` into `python -c` that read `sys.stdin` as
text. Git Bash hands Python a cp1252 stdin, so UTF-8 bytes were misdecoded: a real
em dash (E2 80 94) became "â€”" and was never matched, while "×" (C3 97) and "■"
(E2 96 A0) decoded INTO dash characters and produced false positives. The flaw
surfaced only when L5's diff showed five "dash" lines that held no dash. Root
cause: text-mode stdin in a non-UTF-8 console (windows-environment already warns
that byte-level sweeps lie here; the coordinator used a variant it believed safe).
Correction: a sweep script that reads `sys.stdin.buffer` and decodes UTF-8
explicitly; re-sweep of everything committed this cycle (73f3bbf..HEAD), the
track-p commits and the L5 tree: 0 dashes, so nothing escaped (the agents'
file-based checks held). RULE: any sweep over piped git output decodes
`sys.stdin.buffer` as UTF-8; prove a sweep can see a planted dash before
trusting its zero.

### BH6: "CI-only flakes" were click-reachability at the runner's screen size (coordinator + L5)
CI e2e on 8ac239f: 36/40, while the same smokes pass 40/40 locally four times. All
four CI failures are `locator.click: Timeout` (the two historical CI-4 checks and
the two new pending-marker checks). L5 treated CI-4 as timing (waits for state) and
said it could not confirm the CI cause; the waits did not help. Every local gate
runs at 1500x950, while GitHub's Windows runners have a small desktop, so layout
and viewport-reachability are the likely cause, not timing. Root cause: the gate
never exercises a small screen (O3's one-narrow-glance rule covers width, not
height). Status: RESOLVED by L5b (bbe8605): at 1024x768 session-smoke failed exactly CI's four
checks; the open Session summary squeezed the Overview to 0-24px. CI on ec701a3 logged
the runner's display work area as 1024x720 and all three workflows went green. RULE: when a check
fails only on CI, first reproduce CI's environment (screen size, Node and Python
versions) locally before changing waits.

### BH7: a second spend-limit kill landed mid-mutation (environment, L7a + L11a)
Both running lanes died again with HTTP 429 around 05:10; the owner raised the
limit at 07:10. L7a's dying words were "M3: remove the merge count from
commitMerge": the coordinator's tree diff found commitMerge with no merge
recordFix call while split/add/drop were recorded, i.e. the deliberate mutation
was still APPLIED. The resume message told the agent to restore M3 first.
L7a had also used `git rm` (staged deletion) against the brief's plain-rm rule;
harmless, noted. RULE (extends IC-24): when a lane dies during mutation controls,
the coordinator's tree diff must check the mutation under test and name it in the
resume message; a green suite on a tree with an applied mutation is impossible,
but a commit of one is not.

### BH8: letter over intent on the dash rule (sonnet, L12a docs)
The docs lane wrote 68 em dashes in normal prose despite the brief's rule, caught
them with its own UTF-8 check, then "fixed" them by substituting " -- ", calling it
the codebase's ASCII convention. The brief's wording ("no em dashes and no en
dashes") was satisfied; the owner's intent (no dash punctuation he has to read) was
not. Caught by: coordinator count of " -- " in added lines (75). Correction: the
same agent resumed to rewrite each in context with a colon, comma, parentheses or
a new sentence. RULE: state the owner's rule as intent, not as a character list:
"no dash punctuation of any kind (em, en, or ASCII stand-ins such as ' -- ' between
clauses); use a colon, comma, parentheses or a new sentence".

### BH9: a third spend-limit kill hit both UI lanes mid-flight (environment, LUX-A + LUX-B)
Both lanes died with HTTP 429 around 14:10 while working in parallel (A in the main
checkout, B in the map-track worktree). The tree check found A's overview-view.js
unparseable (a second `const title` in the summary-line function from P3.9) and
B's session-smoke.js partly edited, every other file parsing. Both agents were
resumed with their inventories and the defect named. RULE (extends BH3/BH7): the
tree check after a kill runs `node --check` (or the language's parse check) on
every touched file, and a loop that pipes it through `head` must test the check's
own exit status, not the pipe's (the coordinator's first loop printed "ok" for the
broken file).

### BH10: the coordinator rebuilt a product while the owner asked for functional gaps (coordinator)
Asked "is there anything that could make this more practical", I walked the
process and project lifecycle and proposed business-case bridges, timed runs,
stable IDs, test exports, then a five-layer "story" with recorded vs stated
marks, error detection, value matching and open-question lists. The owner parked
most of it and then corrected: "I feel you are overcomplicating it again... You
are deep diving into a lifecycle saying what can cause problems and
overengineering and creating a product again." Their own nudges were plain
functional gaps (no project without a recorder; the analyst cannot add
screenshots; notes unclear). Root cause: the design-judgment lens was applied to
invent and gate new layers instead of to ask which ordinary operations the user
expects and cannot do. RULE: when the owner asks what is missing, list the verbs
the user cannot perform on each object (create, add, edit, remove, attach, link)
before any analysis layer; propose no verification, detection or lifecycle
feature the owner did not ask for.

### BH11: a fourth spend-limit kill, both lanes again (environment, V1 + C)
Around 00:30 both running lanes died with HTTP 429 ("resets 2:20am"). The tree
check (parse every touched JS file, reading `git status` codes so a deletion or a
staged rename is not mistaken for a parse failure) found V1 consistent (33 files,
one deliberate deletion, one git mv rename) and C untouched. Both resumed with
their inventories. RULE (refines BH9): classify status codes (M, D, R, ??) before
parse-checking; a D or the old side of an R is not a broken file.

### BH12: CI e2e went red for two merges and nobody looked until later (coordinator)
From the V3-P merge, CI's e2e failed at one smoke's launch ("electronApplication.evaluate:
Execution context was destroyed") while every smoke passed locally at both sizes; the
coordinator pushed two more merges before checking `gh run list`. It could not be
reproduced locally (three map-slim runs at 1024x720). Correction: the harness now logs
the viewer process's exit and last output on a failed launch and retries once; the next
CI run passed without needing the retry, so the failure is intermittent and the next one
will name its cause. RULE (the restart point's CI lesson, again): check CI after every
push to master before the next merge, not at the end of the night.

## What worked

- L1a (opus): reported a legacy-copy leftover in a fenced area (Steps legend)
  instead of editing it; replaced cut surfaces with pinned verbs (Export PDD
  writes a .docx; mark-runs lands on the markers panel on screen).

- L2 (opus): mutation controls for every fix (revert in place, see red, restore by
  reversing its own edit, never git checkout); reproduced the CI-only
  cancellation locally with an old Node 18 binary it found on the machine;
  exercised the new run flow on the real app over IPC; kept scope to capture/.

- The step-back reviews (UI clarity audit, step-back review, companion critique) grounded
  every design call in screenshots and exported PDDs of the real app, and the owner's
  corrections (concept level, functional gaps, navigation as the core value) were
  recorded as decisions and memories the same hour they came in.
- Parallel lanes in separate worktrees with disjoint file sets, merged by cherry-pick
  with every gate re-run on the merged tree, landed about twenty lanes with only small
  conflicts (renderer.js, overview-smoke.js, pipeline_stages.py), each resolved by keeping
  both lanes' intent.
- Four spend-limit kills were recovered without respawning: tree inventory, parse checks,
  resume the same agent with its state named.
- The packaged-app smoke (bundled Python analysis, transcript import, PDD export, a blank
  project) caught nothing new but proves the build, not just the dev tree.
