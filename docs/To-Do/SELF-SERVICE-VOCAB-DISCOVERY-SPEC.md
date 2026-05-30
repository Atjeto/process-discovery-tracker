# Self-service vocabulary discovery — feature spec

**Implements:** [ADR-0025](../adr/0025-in-app-vocabulary-discovery.md) · **Status:** spec, not built · **Date:** 2026-05-30

**One line:** the analyst opens a prepared app, points at the window, and gets an
auto-discovered, **stable-signature** vocabulary skeleton to name in the App
Library — on-device, self-service. Turns the manual real-value probing
([REAL-VALUE-TESTING.md](../REAL-VALUE-TESTING.md)) into a shipped feature.

## Why this is mostly wiring

| Piece | Status today | This feature |
|-------|--------------|--------------|
| Walk a window's UIA tree | `UiaSubscriber.cs` walks it (for events + §11e framework detection) | add a one-shot **`snapshot`** that emits *all* controls |
| Build a vocab skeleton | `app_vocab.bootstrap_from_session` (interacted controls only) | generalize to **`bootstrap_from_snapshot`** (full control set) |
| Pick a control's signature | `canonical-author.signatureFromInteraction` + `identity-picker.js` (manual, per control) | add the **volatility-diff auto-picker** + bulk pre-selection |
| Name / group / flag / save a vocab | `vocab-view.js` (App Library form editor) + IPC `listAppVocabs`/`readVocab`/`writeVocab` | reuse as-is; add a **"Discover from window"** entry |

Net-new code: **the recorder `snapshot` command** and **the volatility-diff picker**. Everything else extends or reuses what shipped.

## Build pieces

### 1. Recorder `snapshot` command (C#, `capture/recorder/` + `capture/recorder.js`)
- **Protocol:** add `{cmd:"snapshot", target:"foreground"|<hwnd>, passes:2}` to the stdio command set (`recorder.js` `safeWrite` already sends `hello`/`pause`/`resume`/`shutdown`).
- **Behavior:** for each pass, walk the target window's UIA subtree (reuse `UiaSubscriber`'s walker); for every control with a non-empty identity emit
  `{v:1, type:"snapshot_control", data:{ control_type, automation_id, name, class_name, framework_id, framework, identity_source, confidence, bounds, depth, role, pass }}`,
  then `{v:1, type:"snapshot_done", data:{ window_title, count, pass }}`.
- `passes:2` walks twice ≥1s apart (optionally after a benign focus toggle) so the picker can diff. Bounded (cap ~2000 controls; skip pure decoration). Reuses the ADR-0023 confidence/identity model.
- **Tests** (`Recorder.Tests`): snapshot a synthetic UIA tree → assert the control set; a two-pass tree with a mutated id → assert both passes captured.

### 2. Volatility-diff signature picker (Python, new `normalization/signature_pick.py`)
- **Input:** the two passes' control lists.
- **Join** controls across passes by a *stability-independent* key (role + accessible label + ancestry path + bounds bucket — **never** the candidate id).
- **Volatility test** per control: mark `automation_id` volatile if it (a) changed across passes for the same joined control, or (b) matches a volatility pattern — `^input-\d+$`, `^view_\d+$`, `^combobox-(input|button)-\d+$`, `^[a-z]+-\d{2,}$`, a bare GUID.
- **Pick** the signature in ADR-0023 ladder order, skipping volatile fields: stable `automation_id` → `name`+`class_name` → `class_name` → label-only. Return `{signature, identity_source, confidence, volatile_aids:[...]}`.
- **Ground-truth test** (the killer test — see Validation): assert it reproduces `FileSave` (Excel), `incident.short_description` (ServiceNow), and **demotes** Salesforce `input-378` → the `"Account Name"` label.

### 3. `bootstrap_from_snapshot` (Python, extend `app_vocab.py`)
- Mirror `bootstrap_from_session`'s dedup + emission, but over the snapshot's **full** control set, using the picker's signatures; pre-fill `name` from the accessible label; group `screens` by window title; carry `_hint` (raw label + identity_source + confidence + any `volatile_aids`).

### 4. App Library "Discover from window" (JS, viewer)
- `vocab-view.js`: a **"Discover from window"** button → spawn the recorder (the viewer already spawns Python via `python-runner.js`; spawn the recorder the same way, or proxy through capture) → send `snapshot` → run `signature_pick` + `bootstrap_from_snapshot` → load the skeleton into the editor.
- `identity-picker.js`: surface each control's picked signature + `confidence` + the volatility note; the analyst confirms/overrides (the override UI exists).
- **Merge-aware:** if a vocab for this scope exists, *diff* the discovery into it (new controls added, analyst-named ones preserved) — `identity-picker` already files derived rules back into the App Library.

## Trigger placement (decision)
- **v1 — viewer App Library** (recommended): the analyst probes from the authoring surface; the viewer spawns the recorder. The naming UI is already there.
- **Later — capture tray "Learn this app"** fast-path: probe during session prep ("run the capture session, point to the window"). Same `snapshot` command.

## Phasing
- **P1** — recorder `snapshot` command + `Recorder.Tests` (the only net-new capture code; ships behind the §11e gates).
- **P2** — `signature_pick.py` + `bootstrap_from_snapshot` + the **ground-truth validation** (P2 is done when the auto-picker reproduces the four hand-probed vocabs).
- **P3** — the App Library "Discover from window" UI + identity-picker surfacing + merge-aware re-discovery; eyeball in the `_pdt_verify` harness.

## Validation — the ground-truth test
Point discovery at the four apps this cycle hand-probed and assert the **auto-discovered vocab matches the hand-authored one**:

| App | Must reproduce | Must reject (volatile) |
|-----|----------------|------------------------|
| Excel | `FileSave`, `Filter`, `SortDialog` (idMso) | — |
| Outlook (classic) | `4117`/`4101`/`4256` + `_WwG` body | — |
| ServiceNow incident | `incident.short_description`, `sysverb_insert` | — |
| Salesforce New Account | `"Account Name"` **label** | `input-378` auto-ids |

If the auto-picker reproduces the human probing on all four (esp. the Salesforce volatility rejection), the feature is proven — the existing `normalization/app_vocabularies/*.yaml` are the regression fixtures.

## Non-goals (v1)
- Template *sequence* auto-mining (vocabulary only; the template still comes from a captured run via `identity-picker`).
- Name automation beyond accessible-label pre-fill (naming is the analyst's judgment).
- Non-Windows surfaces.
