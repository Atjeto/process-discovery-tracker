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

## What worked

- L1a (opus): reported a legacy-copy leftover in a fenced area (Steps legend)
  instead of editing it; replaced cut surfaces with pinned verbs (Export PDD
  writes a .docx; mark-runs lands on the markers panel on screen).

- L2 (opus): mutation controls for every fix (revert in place, see red, restore by
  reversing its own edit, never git checkout); reproduced the CI-only
  cancellation locally with an old Node 18 binary it found on the machine;
  exercised the new run flow on the real app over IPC; kept scope to capture/.
