# ADR-0002: App vocabularies — per-app interaction annotations

**Status:** Accepted
**Date:** 2026-05-14
**Deciders:** Automation team lead, tracker maintainer

## Context

The tracker now has three runtime layers of "what does this mean" knowledge:

1. **Taxonomy** (`normalization/sample-taxonomy.yaml`): `(app, title_regex)` → activity label. Coarse-grained, central, mature. Operates on `activity` events (5-second active-window polls). Says "this window is Salesforce."
2. **(missing layer)** — Per-interaction meaning at the app level.
3. **Process Templates** (`normalization/canonical/*.yaml`): named processes with steps and phases, each step defined by interaction match rules. Process-scoped. Says "in Customer Onboarding, step 1 is Search Customer."

The middle layer is the one the analyst actually reaches for first. The team operates ~10 standard apps (Salesforce, Outlook, Excel, two internal portals, etc.). For each, the same buttons, fields, and menus appear across many business processes:

- The Salesforce **Search** button in window "Salesforce | Search Accounts" is always "Search customer record", whether the analyst is mapping Customer Onboarding, Account Setup, or Refund Claim.
- Outlook's **Reply** button is always "Reply to email" regardless of which process the worker is following.
- Excel's `Save As` menu item always means "Save workbook copy" regardless of which workflow uses Excel.

Today the analyst names these step-by-step inside each session's annotations. There is no place to write "Salesforce's Search button means X" once and have every future session benefit. Two consequences:

- **Repeated work.** Each session re-annotates the same buttons. With 10 apps and dozens of processes, the work compounds.
- **Process templates are forced to over-reach.** To get good step names, the template's match rules include button-level signatures that aren't really about *the process* — they're about *the app*. The template becomes a place to dump app vocabulary because there's nowhere else.

### Forces

- **Authoring is the bottleneck.** Auto-suggested step names landed in a previous round; they're better than `"App: 4 actions"` but still derived from raw UI control names ("Salesforce: Search"). The analyst wants "Salesforce: Search customer record" without retyping per session.
- **Process templates exist and work.** They handle the higher-order "this is which process and how are its phases organized" question. Replacing them is not in scope — augmenting them is.
- **The team's app inventory is bounded** (~10) and changes slowly. The cost of curating a vocabulary per app is finite; the payoff scales with every future session.
- **YAML authoring is fragile.** The existing taxonomy and canonical templates ship as YAML files the analyst edits in a text editor. Adoption is slowed by "I don't want to learn YAML." The new layer should be authorable from the viewer UI.
- **Backward compatibility.** Existing sessions and existing process templates must keep working. Vocabularies are additive enrichment, not replacement.
- **Performance.** Vocabulary lookup runs once per interaction event during normalization. A typical session has 50-2000 interactions. The lookup must be O(events) with cheap per-lookup cost.

## Decision

Add a third storage layer, the **App Vocabulary**, between the taxonomy and the canonical step set:

- One YAML file per app: `normalization/app_vocabularies/<app-id>.yaml`
- Defines a scope (which interactions belong to this app: `process_name` + optional `window_title_regex`), optional named screens, and a list of interaction annotations keyed by signature.
- Loaded during `normalize.py` after case assignment, before step matching. Enriches each interaction event with `meaningful_name`, `screen_id`, and `vocab_flags`.
- Step auto-suggestion uses `meaningful_name` when deriving step names. Canonical step matching is unaffected (matches on raw signature, not on enriched fields), so process templates and vocabularies stack cleanly.
- Authored two ways:
  1. **Bootstrap from a session.** A "Save app vocabulary from this session" button in the viewer infers signatures from the captured interactions and writes a starter YAML with `name` fields left blank for the analyst to fill.
  2. **Inline editing** (later). A future Vocabularies tab in the viewer lets the analyst edit each entry without leaving the app.

## Options considered

### Option A: Add a third layer (chosen)

A new file type and loader. Sits between taxonomy and canonical templates. Composes with both.

| Dimension | Assessment |
|---|---|
| Complexity | Medium — one new module, one new file shape, one new IPC handler. ~300 LoC. |
| Cost | Low. Pure additive: no migration of existing data. |
| Scalability | Linear in interaction count × vocab entries. Each vocab is small (10-200 entries). 10 vocabs × 50 entries = 500-entry lookup table; trivial. |
| Team familiarity | YAML + Python — same shape as taxonomy and canonical templates. No new tech to learn. |
| Reusability | Per-app artifact is process-agnostic. Same library applies to every process that touches the app. |
| Authorability | Auto-bootstrap from a captured session, then a YAML the analyst can refine. Future inline editor is straightforward. |

**Pros**
- Clean separation of concerns: taxonomy = window-level, vocabulary = element-level, template = process-level. Each has one job.
- Authoring effort matches reuse: 10 apps × one curation pass each = 100% of future sessions covered at the interaction level.
- Process templates simplify: their match rules no longer need to encode app-vocabulary knowledge; they can focus on "this step lives in Salesforce account search" without restating button names.
- Auto-bootstrap path: analyst doesn't write the YAML from scratch; the tool extracts the skeleton from a real session.

**Cons**
- Three layers is one more concept for newcomers to learn. Mitigated by clear documentation; the layers don't overlap.
- Vocabulary drift: if an app's UI changes (button moves, automation_id renames), the vocabulary breaks for that interaction. Same fragility class as the taxonomy regex layer. Mitigated by editable YAML and the auto-rebuild path.

### Option B: Extend the taxonomy to per-interaction granularity

Add a `interactions:` block to the taxonomy YAML where each entry specifies a signature and a label, alongside the existing `(app, title_regex)` rules.

| Dimension | Assessment |
|---|---|
| Complexity | Low — extend an existing file shape. |
| Cost | Zero new files. |
| Scalability | Same lookup characteristics as Option A but the taxonomy file balloons. |
| Team familiarity | Same YAML shape. |
| Authorability | Same auto-bootstrap path is possible. |

**Pros**
- One fewer file type to think about.
- Single load point in normalize.py.

**Cons**
- Conflates two layers with different update cadences. The taxonomy's window-level rules change rarely; app vocabularies are dense and edited often.
- One giant file becomes a merge-conflict magnet when multiple analysts edit.
- The taxonomy is "central, team-shared, version-controlled, slowly curated." Vocabularies are "analyst-authored, frequently rebuilt from captures." Forcing them into the same artifact discourages experimentation.
- The taxonomy operates on activity events; vocabularies operate on interaction events. Pipeline-stage-wise they belong to different points in the normalize flow.

### Option C: Push vocabulary into process templates

Each canonical template grows a per-app `vocabularies:` sub-block. The vocabulary is scoped to the template, not the app.

| Dimension | Assessment |
|---|---|
| Complexity | Low — one schema. |
| Cost | Zero new files. |
| Scalability | Worst of the options. Vocabularies duplicate across templates. |
| Authorability | Worst — analyst has to author the vocabulary inside every template that uses the app. |

**Pros**
- One fewer layer.

**Cons**
- Misses the point. The whole reason for the new layer is that vocabularies are *cross-process*. Putting them inside a process template is exactly the wrong shape.
- N processes × M apps in the process = N × M times more vocabulary authoring than Option A.

### Option D: Replace process templates with vocabularies + simpler grouping

Drop canonical step templates. Once every interaction is richly named via a vocabulary, step names auto-suggested from interactions are good enough. Process structure (phases, ordering, drift) is captured separately by manual phase grouping.

| Dimension | Assessment |
|---|---|
| Complexity | Medium — has to deprecate and migrate canonical templates. |
| Cost | Real migration cost. Existing canonical YAML files become dead. |
| Scalability | Same lookup characteristics as Option A but step naming is brittle. |
| Authorability | Same. |

**Pros**
- Simpler mental model: one place to teach the system "what does this mean."

**Cons**
- Loses the canonical step set's value: it doesn't just *name* steps, it *recognizes* them. The match rules close the loop on "is this captured session an instance of Customer Onboarding v7?" Drift detection depends on that recognition.
- Step boundaries are still ambiguous from interactions alone. Templates encode "this step starts at the Search Edit and ends at the Search Button click." Vocabulary doesn't know about step boundaries.
- Throws away working code (Phase C+D from the implementation spec, already shipped and tested).

## Trade-off analysis

The decision hinges on whether per-app element annotations live in their own artifact or are folded into an existing one.

- **A vs B**: A keeps two concerns separate; B keeps the file count low. The team will edit vocabularies an order of magnitude more often than they edit the central taxonomy. Different cadence + different scope (interaction events vs activity events) = different artifact.
- **A vs C**: C is structurally wrong. It puts cross-process knowledge inside per-process files. The cost compounds with every new process.
- **A vs D**: D throws away working features (canonical drift detection, phase rollup, step BPMN export) to simplify the mental model. The mental model is already three layers in practice; codifying the third one is cheaper than tearing down the others.

## Schema

```yaml
# normalization/app_vocabularies/salesforce.yaml
app_vocabulary:
  id: "salesforce"                          # stable ID; referenced in stats.meta
  name: "Salesforce"
  version: 1                                # bump on edit; used for change tracking
  owner: "tooling-lead@team"

  # Scope: only interactions matching all of these enter this vocab's domain.
  scope:
    process_name: "chrome.exe"
    window_title_regex: ".*Salesforce.*"

  # Optional named screens. Useful for grouping in reports and for narrower
  # interaction signatures that want to disambiguate by screen.
  screens:
    - id: "account-search"
      name: "Account Search"
      window_title_regex: ".*Search Accounts.*"
    - id: "account-detail"
      name: "Account Detail"
      window_title_regex: ".*Account: .+ Salesforce.*"

  # Per-interaction annotations. signature fields are AND-ed. The most-specific
  # match wins (most non-empty signature fields).
  interactions:
    - signature:
        control_type: "Button"
        automation_id: "searchBtn"
      name: "Search customer record"
      screen: "account-search"
      flags:
        automation_candidate: true

    - signature:
        control_type: "Edit"
        automation_id: "accountName"
      name: "Enter account name"
      screen: "account-detail"

    - signature:
        control_type: "Button"
        name: "Save & New"
        window_title_regex: ".*Account.*"
      name: "Save account and start new"
```

### Signature matching

A signature entry's fields are intersected; an interaction event matches when every present signature field equals the corresponding event field (with `window_title_regex` matched as a regex against `data.window_title`). The fields available are: `control_type`, `automation_id`, `name`, `class_name`, `framework_id`, `window_title_regex`.

Specificity score = count of non-empty fields. Ties broken by first-defined.

### Multiple vocabularies match the same event

Library scope (`process_name` + optional `window_title_regex`) is matched first. Multiple libraries scoping the same event is rare in practice (an event is "in chrome.exe with Salesforce in the title"; only the Salesforce vocab will scope it). If it happens, first-loaded wins. Library load order = filesystem order, which is alphabetical, which is predictable.

### Enrichment fields added to each matched interaction event

- `data.meaningful_name`: from the matching entry's `name` field
- `data.screen_id`: from the entry's `screen` field if set
- `data.vocab_flags`: from the entry's `flags` block (carried forward to step flags during auto-suggestion)
- `data.vocab_source`: `{vocab_id, vocab_version}` for traceability

## Pipeline integration

```
events.jsonl
  ↓ load + sort
apply marker edits
  ↓
assign case_ids
  ↓
[NEW] enrich interactions via app vocabularies
  ↓
classify activities via taxonomy
  ↓
collapse adjacent activity events
  ↓
step layer:
  if canonical template: match_canonical
  else: auto_suggest_steps (uses meaningful_name now)
  ↓
phase layer: rollup_phases (only with canonical template)
  ↓
write annotations.json, stats.json, exports
```

Vocabulary enrichment is non-destructive. The raw `name`, `control_type`, etc. remain on each event; `meaningful_name` is additive. Step auto-suggestion prefers `meaningful_name` when present; falls back to existing logic.

## Storage location

Default: `normalization/app_vocabularies/*.yaml`, shipped with the tool, version-controlled with the rest of the repo.

Override: `PDT_APP_VOCABULARIES` env var pointing at one or more directories (semicolon-separated on Windows). When set, normalize.py loads vocabularies from those directories in addition to the default. Enables a team to keep their growing vocabularies in a shared share without rebuilding the tool.

## Consequences

**Becomes easier:**
- Naming steps becomes a one-time-per-app investment rather than a per-session burden.
- Process templates lose accidental complexity — their match rules can focus on "this step happens on this screen" instead of restating every button name.
- Step BPMN and PDD exports get human-readable names without analyst intervention.
- New process discovery starts faster: bootstrap vocabularies from the first session of a new project, refine over time.

**Becomes harder:**
- Three layers to teach instead of two. Mitigated by orthogonal concerns and clear docs.
- Vocabulary drift: if an app's UI changes (re-themed Salesforce release, Outlook ribbon rearrangement), the vocab breaks for affected interactions. Mitigated by auto-bootstrap from a fresh session and editable YAML.
- One more thing to keep version-controlled.

**Revisit when:**
- App count grows beyond ~30 (the team curation model assumes ~10).
- Vocabulary drift becomes a meaningful drag on analysts (warrants a UI for diffing v1 vs v2).
- Process templates become a thin wrapper around vocabularies (warrants a refactor — possibly Option D in a later round).

## Action items

1. [ ] `normalization/app_vocab.py`: schema, loader, signature-match engine, event-enrichment pass.
2. [ ] `normalize.py` integration: load vocabularies from default dir + `PDT_APP_VOCABULARIES`, enrich interaction events before step suggestion.
3. [ ] Step auto-suggestion uses `meaningful_name` when present.
4. [ ] `normalization/app_vocabularies/sample-salesforce.yaml`: a small worked example for the team to copy.
5. [ ] Viewer: "Save app vocabulary from this session" button (in Steps view or under Process Template tab).
6. [ ] Viewer: surface `meaningful_name` in the raw events table and the step detail evidence list.
7. [ ] `shared/SCHEMA.md`: document the new `data.meaningful_name`, `data.screen_id`, `data.vocab_flags`, `data.vocab_source` fields.
8. [ ] Stats meta: add `app_vocabularies_applied` (list of `{id, version}`) so re-analysis can detect vocab drift.
9. [ ] User Guide: chapter on app vocabularies — what they are, when to use, how to bootstrap from a session.
10. [ ] Pytest smoke for app_vocab.py: scope-match, signature-match, specificity tiebreak, multi-vocab load order.
