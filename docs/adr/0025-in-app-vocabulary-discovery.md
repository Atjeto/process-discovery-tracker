# ADR-0025: In-app vocabulary discovery — "point-and-learn" window snapshot

**Status:** Accepted — spec'd 2026-05-30, built 2026-05-31 (P1 recorder `snapshot` command + `Recorder.Tests`; P2 `normalization/signature_pick.py` volatility-diff picker + `app_vocab.bootstrap_from_snapshot`; P3 App Library "Discover from window" → `viewer/recorder-snapshot.js` + `normalization/discover_vocab.py`). End-to-end verified against a live window (snapshot → discover → skeleton). *(ADR number 0025 confirmed in the cross-chip sanity sweep; 0019 was later used for [ADR-0019 Reference Maps](0019-reference-maps.md), 0020–0022 remain unused — see NEXT-SESSION-SPEC §0.10.)*
**Date:** 2026-05-30
**Deciders:** Project owner, analyst (process-discovery lead)
**Related:** [ADR-0002](0002-app-vocabularies.md) (the App Vocabulary layer this populates), [ADR-0001](0001-click-recorder-sidecar-language.md) (the C# UIA recorder this extends), [ADR-0023](0023-recorder-capture-confidence.md) (the per-element `framework`/`identity_source`/`confidence` fields the snapshot reuses), [REAL-VALUE-TESTING.md](../REAL-VALUE-TESTING.md) (the manual probing this productizes), Master Assessment §11d ("new web/UIA walkers"). **Build spec:** [SELF-SERVICE-VOCAB-DISCOVERY-SPEC.md](../To-Do/SELF-SERVICE-VOCAB-DISCOVERY-SPEC.md).

## Context

The 2026-05-30 real-value cycle established that App Vocabularies must key on **real probed UIA signatures**, not demo-fiction — and proved it by hand-probing 7 apps (Office, ServiceNow, Salesforce). But the probing ran via Claude on the dev box, which **does not scale**:

- It needs the dev box + an agent; the analyst can't self-serve.
- Apps **not reachable from the dev box** — gated SaaS, internal line-of-business apps, Citrix-published apps — can't be probed by an off-box agent at all, **yet the analyst has them open on the work laptop.**
- It is a mechanical, repeatable procedure: walk a window's UIA tree → pick the *stable* signature per control → emit a skeleton → name the controls. That is a product feature, not an agent's trick.

The assets that make this cheap already exist: **the moat already walks UIA** (`capture/recorder/UiaSubscriber.cs`); **the skeleton bootstrap already exists** (`app_vocab.bootstrap_from_session`); and **the authoring UI already exists** — `viewer/views/vocab-view.js` (the App Library form editor), `viewer/views/identity-picker.js` (the per-control match-rule/signature picker, which already lifts signatures from a captured session *and files a derived rule back into the App Library*), and `canonical-author.js` (`signatureFromInteraction` / `vocabSignatureKey`).

## Decision

**Build "point-and-learn" vocabulary discovery into the product.** The analyst opens & prepares the real app, points the capture app at the window, and the recorder snapshots the live UIA tree into an auto-discovered, **stable-signature** vocabulary skeleton the analyst then names in the App Library. Entirely on-device — the air-gap moat is untouched (the recorder already runs locally; nothing leaves the box).

Four pieces. Only **one** is net-new capture code; **one** is the genuinely clever bit; the other two extend/reuse what's already there:

1. **Recorder `snapshot` command** *(net-new, small).* A new stdio command alongside `hello`/`pause`/`resume` (`capture/recorder.js`): walk the pointed-at window's UIA subtree **once** and emit **every** identifiable control with its full identity (`control_type`/`automation_id`/`name`/`class_name`/`framework_id` + ADR-0023's `framework`/`identity_source`/`confidence`/bounds) — instead of waiting for interaction events. Reuses `UiaSubscriber`'s existing tree walk.

2. **Volatility-diff signature picker** *(the clever core).* The hard-won lesson of the real-value cycle was that the *stable* signature differs per platform — **idMso** (Office: `FileSave`), **DOM id** (ServiceNow: `incident.short_description`), **label** (Salesforce Lightning, because its `input-378` ids regenerate every render). Automate that judgment: **snapshot the window twice** (across a benign re-render) and **diff** — identifiers that change are volatile and demoted. Per control, pick the most-stable identity in the ADR-0023 ladder order, skipping volatile `automation_id`s. This converts the analyst's "which id is real?" guess into a *measured fact*. Augments the existing `signatureFromInteraction`.

3. **Snapshot → skeleton** *(extend existing).* Generalize `app_vocab.bootstrap_from_session` to `bootstrap_from_snapshot`: build the skeleton from the **full** control set of a live snapshot (richer than the interacted-only subset), with the picked signatures, `name` pre-filled from the accessible label, and `screens` grouped by window title.

4. **App Library import-and-name** *(reuse existing).* Surface the skeleton in `vocab-view.js` + `identity-picker.js` for the analyst to confirm names, group screens, set flags, and save — the editor, the picker, and the "file back into the App Library" flow already exist.

## Consequences

- **The "apps not readily available" problem dissolves.** The analyst has the app; the tool probes it in place. The vocab library grows by **analyst** action — not by Claude, not by a chip relay. That is the correct end state and a major value/scaling unlock.
- **The moat compounds.** The same on-device UIA capability that records *processes* now bootstraps the *vocabulary* that names them. No new trust surface; nothing leaves the box.
- **The signature picker is the new load-bearing intelligence — and it's *testable*.** Validate against this cycle's hand-probed vocabs: the auto-picker must reproduce `FileSave` / `incident.short_description` *and reject* Salesforce's `input-378` in favour of the `"Account Name"` label. If it reproduces the human probing on the four ground-truth apps, the feature is proven.
- **Naming stays human.** Auto-discovery gives identities + raw labels; the *meaningful* names, screen grouping, and automation/waste/exception flags are analyst judgment (pre-filled, then refined). That's the analyst's value-add, not something to fake.
- **Vocab vs. template split.** A static snapshot discovers the **vocabulary** (the controls). The **process template** (the step *sequence*) is still better mined from a captured *run* — `identity-picker` already lifts signatures from a session. Snapshot names the buttons; a recorded session learns the order. They feed each other.

## Coherence discipline ([COHERENCE-AUDIT](../architecture/COHERENCE-AUDIT.md))

- **Inverse.** Re-snapshot *diffs/merges* into an existing vocab (don't overwrite analyst names — `identity-picker` already merges back). The auto-picked signature is reversible: the analyst overrides it in the existing picker UI.
- **Legend.** `confidence`/`identity_source` are already legended (ADR-0023); the discovery surface shows them, so the analyst sees *why* a control got the signature it did.
- **Control-interaction.** The `snapshot` command rides the existing `hello` stdio contract; the trigger sits with the capture session controls.
- **Real run.** Validate by probing real apps and diffing against the hand-probed ground-truth vocabs — never a synthetic fixture.

## Deferred / open

- **Persona & trigger placement** — the probe runs the recorder (capture-side); the naming reuses the viewer App Library. Whether the trigger lives in capture, the viewer, or both is a UX call for the spec/build (the spec recommends the viewer for v1, since the naming UI is already there and the viewer already spawns Python via `python-runner.js`).
- **Web a11y waking** — browser windows are UIA-dark until woken (`--force-renderer-accessibility` / an active FindAll); the snapshot must wake the page tree, as the manual ServiceNow probe did.
- **Coverage edges** — the §11e gaps apply (Java/Qt without their a11y bridges, Citrix); the snapshot inherits the confidence model and degrades honestly.
- **Template auto-mining from a captured run** — beyond v1 (the vocabulary is the v1 target).

## Refinement (2026-06-01) — point-and-click instead of foreground snapshot

The first build snapshotted the **foreground** window, but the act of clicking the
viewer's "Snapshot" button made the *viewer* the foreground — so it grabbed the
wrong window (a misclick/misread trap). The discovery trigger now matches this
ADR's own wording ("points the capture app at the window"): a new recorder `pick`
command (`WindowPicker.cs`) enters a brief **standby**, the analyst **clicks the
target window**, the recorder resolves the top-level window under the cursor
(`WindowFromPoint` → `GA_ROOT`) and reports its handle + title, the viewer shows a
**confirmation** ("you clicked X — capture it?"), and only then snapshots that
**specific HWND** (the `snapshot` command already accepted an HWND target). Esc or
a 35 s timeout cancels. Also: App Library entries are now **deletable** (the
missing inverse of New/Discover; `viewer:deleteVocab`, dir-guarded).

## Refinement (2026-06-01) — annotator-context enrichment + the `class_name` round-trip fix

Real-run discovery against a browser-hosted web app (Spotify in Chrome) exposed
two coupled defects in the **naming** half (the UIA walk itself was fine):

1. **The editor silently dropped `class_name`-keyed signatures.** The picker
   correctly keys a control with no stable id and no accessible name on its
   `class_name` (ADR-0023 confidence 0.4). But `vocab-view.js` modelled only
   `control_type` / `automation_id` / `name` / `window_title_regex`, so a
   `{class_name: …}` signature rendered as a blank **"(unset signature)"** *and
   was rewritten to `{}` on Save* (`collectAndMark` rebuilds the signature from
   the visible inputs, and there was no `class_name` input). Captured → shown
   blank → erased: a COHERENCE-AUDIT round-trip failure. **Fix:** `class_name` is
   now a first-class signature field (summary + editable input), and
   `canonical-author.js::vocabSignatureKey` gained the `cn` branch Python's
   `_snapshot_sig_key` already had, so re-discovery dedups it instead of
   re-adding duplicates.

2. **A row carried no context to name it by.** Discovery captures far more than
   the signature keys on; the surplus was discarded at `bootstrap_from_snapshot`.
   It now threads **annotator context** onto each entry as discovery-meta
   (stripped on save, like `confidence` / `identity_source`): the UIA **`role`**,
   the **`framework`**, a value-free on-screen **`region`** (a 3×3 bucket from the
   control's bounds), the tree **`ancestry`** (the picker already reconstructs it
   for the volatility join — it was being thrown away), an honest
   **weak-signature note**, and — the load-bearing one — **over-merge
   transparency**: a generic `class_name` with no label collapses genuinely
   *distinct* controls under one `seen_count`, so each merged member's context is
   kept and listed (`_members`) for the analyst to split a wrong bucket. The "×5"
   that hid five different controls is now legible.

Fixed in passing: the viewer split `PDT_APP_VOCABULARIES` on `/[;:]/`, which
shredded Windows drive-letter paths (`D:\…`) at the colon — the documented
extra-dirs extension point was broken on Windows. It now splits on
`path.delimiter`, matching Python's `os.pathsep`. Pinned by a new
`e2e/vocab-smoke.js` gate (real viewer: the enriched row renders legibly + the
`class_name` signature survives Save).

## Refinement (2026-06-01, v0.22.1) — recorder discovery on a deployed viewer

Running the **packaged** viewer as it would run on a destination PC exposed that
"Discover from window" only ever worked from a dev tree: the viewer ships **without**
`recorder.exe` (it's a capture-app binary), so a deployed viewer-only machine failed
with "recorder.exe not found." The resolver (`recorder-snapshot.js`) anticipated a
bundled recorder (`resources/recorder/…`) but the build never copied one, and there
was no path to a *deployed* capture. Per the owner decision, the recorder is **not**
duplicated into the viewer (that would add ~187 MB — the self-contained .NET single
file); instead the resolver now probes a **sibling capture app folder**. The deploy
contract: extract `viewer/` and `capture/` side by side, and the viewer finds
`…/capture/resources/publish/recorder.exe`. This keeps the viewer slim and the air-gap
moat intact (still on-device, nothing bundled twice). `PDT_RECORDER_PATH` overrides;
the dev tree still resolves via the repo's `capture/`. Pinned by `recorder-snapshot.test.js`.
