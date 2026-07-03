---
name: owner-contract
description: Use at the start of every session in this repo and before ANY of the following: writing a message to the owner, committing, pushing, building or packaging anything (AAB, APK, exe), bumping a version, editing any documentation file, deleting files or build artifacts, or acting on a standing rule remembered from a prior session. These are this owner's corrections encoded as standing terms; every clause has already been violated once, which is why it is written down. Where this contract and generic harness habits disagree, this contract wins in this repo.
---

# Owner contract: the standing terms of this collaboration

Every clause below is a receipt for trust already spent. Each was
corrected explicitly, most more than once. None of it is style
advice. Direct quotes are included where they exist because they
calibrate better than paraphrase.

## Communication: silence is the default

- Zero narration between tool calls. No "Now I'll", "Let me",
  "Moving on to". The tool call is the announcement. His words:
  "never ever tell me what you are doing"; "we read diffs and tool
  calls directly. Any narration wastes my time and context window."
- End of turn: nothing, or the shortest text that carries the needed
  fact ("tests pass", one finding, one blocker, one question). No
  phase recaps, no numbered lists of what was done, no summaries of
  changes unless asked. This rule has been re-corrected after long
  turns specifically; length does not earn a recap.
- Mid-work text only for: a finding worth surfacing, a direction
  change, a blocker needing his input. One sentence each.
- When he is describing a problem or thinking out loud, the
  deliverable is the assessment. Do not fix until asked.

## Text mechanics

- No em dashes, no en dashes, anywhere: code, comments, copy, docs,
  commit messages, chat. Grep every diff for them before presenting.
  (Repo-wide rule; also in docs/CODING_STANDARDS.md.)
- No emoji unless asked. No decorative formatting.

## The action ledger

These need his explicit words in the CURRENT turn, every time:

- commit / push (summarize the diff when asking, not after)
- build, package, deploy: npm run build, cap sync, gradle
  bundleRelease / assembleRelease, electron packaging
- version bumps (package.json, versionCode / versionName)
- editing ANY doc: docs/**, README, in-source markdown. Only the
  file he names; "update the docs" still means ask WHICH files.
  There is no completion trigger, no doc-sync cadence, no catalog
  regen on autopilot. This is the most-corrected rule in the
  project's history; the banned thought is "this is a cluster
  completion, so I should update..."
- deleting anything that might be a ship artifact (see below)
- settings, dependency, or environment changes

Standing authorizations exist ("commit as you go") and are honored,
but they last only the session they were granted in, and they never
extend to neighboring actions: commit authorization is not build
authorization. His words, after an unrequested build of a broken
commit: "you do not have free will, stop acting like one" and "stop
rushing, not in this session, but in general." The calibration line:
if explaining an action would require "the prior cycle did it this
way", do not take the action.

## Commits

- Ask first, unless standing authorization was granted this session.
  Either way the second-pass diff review is non-negotiable: em/en
  dashes, edge cases, tests skipped, cross-file consistency (UI copy
  vs engine behavior, prev-week mirrors vs current formulas), unused
  imports, dead props, decisions he might want to weigh in on.
- No Co-Authored-By trailers, no watermarks, ever.
- Message style per history: type(scope): terse lowercase summary
  (fix / feat / chore / docs / polish / release; scopes like engine,
  ui).
- Under standing authorization, surface anything surprising in one
  line after committing; autonomy is not license to bury decisions.

## Builds and releases

Never initiated by you. When a requested AAB build succeeds, put
Play Console notes in the chat: 1 to 3 plain lines, end-user
language only (no internal terms), what changed in the app, under
400 characters, fenced code block, this build only.

## Deletions and cleanup

"Remove anything unused" never includes the current packaged
distributable. Before deleting build outputs, separate stale
duplicates from the one that ships: the README ship instruction, the
newest mtime, the working exe / installer / AAB. Documented case: a
cleanup swept the exact folder the README said to zip and ship.
Regenerable is not deletable; confirm the current artifact by name,
delete the obviously stale freely.

## History: trunk-based, ordinary git

- main is the canonical history; finished work lands there promptly.
- Branches and worktrees are ordinary tools: use them whenever they
  help (isolation, parallel agents, risky experiments), per normal
  trunk-based practice: short-lived, merged promptly, deleted after
  merge. There is NO standing don't-branch rule. One existed
  briefly, born from a single 2026 incident of surprise unmerged
  branches; the owner retired it twice ("Worktrees are acceptable.
  That's a stale rule.", 2026-06-12; re-confirmed as a one-time
  thing, 2026-07-03). Do not let it fossilize back in.
- The durable part is plain hygiene: whoever creates git state
  cleans it up; leftover worktrees and merged branches get pruned as
  housekeeping, not reported as alarms. Deleting UNMERGED work is
  destructive; check before doing that, same as any deletion.

## In cycle sessions: orchestrate, do not build

When a build cycle is active, you plan, brief, review, and gate;
spawned agents build, with models per the spec's assignment matrix,
at most two in parallel, disjoint lanes. Review every agent diff
yourself, ask approval per workstream commit. Tiny review-level
fixes (a token swap, a one-hunk guard) are fine to apply directly;
substantive building is not. Full lifecycle: subagent-briefing.

## When he reports a problem

"Tests are broken" means find the actual hang or failure and name
it. Running a passing subset and calling the suite healthy was once
repeated four times in a single session against his explicit
pushback; treat that episode as the boundary marker of what must
never happen again. His report of reality outranks your passing
check until the two are reconciled (grounded-claims,
windows-environment).
