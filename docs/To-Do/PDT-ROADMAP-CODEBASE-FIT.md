# PDT — Roadmap ↔ Codebase Fit Analysis

**Prepared:** 2026-05-29 · **Consolidated:** 2026-05-29 (this is the canonical fit analysis;
the parallel `PDT-ARCHITECTURE-FIT-FINDINGS.md` audit was merged in and removed)
**Status:** Living reference · **Owner:** solo owner · **Supersedes:** `PDT-ARCHITECTURE-FIT-FINDINGS.md`
(merged + removed) · **Revisit:** when Wave 0 lands, or when §11 sequencing changes.
**Question this answers:** Do the master-assessment suggestions (§11 workstreams + the
deployment/adoption tiers) require *significant* changes to the codebase? How complementary
are they? Do they fit the architecture that exists today? And what concretely must happen for
each to be introduced?
**Method:** the `PDT-MASTER-ASSESSMENT.md` roadmap read against a depth code review (the
tech-debt + correctness + security passes, three architecture grounding passes on
pluggable-storage coupling / CI-harness / pipeline-calibration, and direct file:line
verification of the load-bearing claims), then cross-checked against three further independent
audits — one contributing the workstream-internal seam mapping, hosting/engine decisions, and
signing-tier distinction below; a second (a line-by-line assessment-vs-codebase audit)
contributing the screenshot and CI-precision corrections in §15, with its byte-counts-misread-as-
line-counts slip corrected; a third (an independent claim-by-claim verification of *both* this
doc's file:line refs and the assessment's) confirming the dependency graph and refs, and
contributing the schema-versioning downgrade (§15.4), the corrected `normalize()` size
(~509 L / ~13 stages), the §11a CI-recorder obstacle (§11), and the effort bumps in §9 — with its
own slips corrected (it overcounted `except` clauses as 17, and called the two shipped sample
vocabs "a comment"). Grounded in `/architecture` (decisions + trade-offs) and
`/system-design` (requirements → components → fit → sequencing). The three source audits and the
parallel fit-findings doc have been folded into this document and retired — **this is the single
canonical fit analysis**; every divergent number across the passes was settled against code here.
**Note on "the spec":** the assessment cites a companion `PDT-CLAUDE-CODE-IMPLEMENTATION-SPEC.md`
that **does not exist in the repo**. The canonical workstream list is therefore §11 (11a–11f)
of the assessment itself; `docs/IMPLEMENTATION_SPEC.md` is the historical build spec and
`docs/To-Do/NEXT-SESSION-SPEC.md` is the current plan of record. Any future implementation spec
should be generated *from this fit analysis*, not the missing file.

---

## 1. Headline verdict

**No — the roadmap does not require a significant rewrite, and it fits the architecture well.
The single most important finding: the core data model is correct and does not change.** Every
workstream respects immutable `events.jsonl` + sidecar `annotations.json` + non-destructive
re-normalization. The architecture "already voted for this game."

The required change is **not broad — it is concentrated in three places**, and almost every
workstream funnels through the same two of them:

1. **A shared foundation that mostly doesn't exist yet** — a session-level golden/e2e gate and a
   calibration *config surface*. Both are **hard prerequisites** for §11a/§11b. Decomposing the
   `normalize()` orchestrator is *desirable alongside* (it de-risks the config work and pays down
   known debt) but is **not itself a blocker** — additive stages slot into the existing linear
   pipeline without it. ~4 of 6 workstreams depend on the foundation; the spec under-states it by
   treating the workstreams as more independent than they are.
2. **The recorder (the moat)** — §11e coverage hardening is the one genuinely large *new
   capability* build, and it touches the C# recorder, which has **zero automated tests**.
3. **The deployment layer** — the pluggable backend (§13) is the only true *architectural*
   change, and it is explicitly Tier-2/deferred. The Python compute core is already path-free,
   so it is stage-able rather than a rewrite.

Everything else (§11c insight/ROI, §11d vocab-gen, §11f borrows) is **additive** — it attaches
to seams that already exist (the analysis layer, the `app_vocab` schema, the recognition-pattern
layer, the alignment machinery). Good fit; moderate change; gated on the foundation.

---

## 2. What the codebase already gets right (so we don't "fix" it)

These are load-bearing assets the roadmap can build on as-is — verified in code:

- **Immutable-events + sidecar-annotations + non-destructive re-norm.** The roadmap's "core
  principle" is already the implemented invariant. No workstream needs to touch it.
- **The recognition layer is already shared + data-driven.** `shared/recognition-patterns.json`
  loaded by both `recognition.py` and `recognition.js`; `process_label` rules in
  `shared/process-label-patterns.json` pinned by a cross-language golden
  (`shared/process-label-golden.json`). §11d/§11e extend this pattern rather than invent one.
  *(Caveat for §11d: new vocab-derived labels will need new stripping patterns — each must be
  added to the cross-language golden, which today covers only the current rules. Grow the golden
  with the rules, or it gives false confidence; a stale golden is worse than none.)*
- **Renderer egress is structurally locked, not conventional.** *(Corrects an earlier claim.)*
  `viewer/index.html:5` and `capture/main.js:605,1123` set CSP `connect-src 'none'`;
  `setWindowOpenHandler → deny` + `will-navigate` preventDefault on every window in both apps.
  The only network client in app code is localhost OBS (`obs.js:22`). The air-gap moat is real
  in the renderer.
- **The Python compute core is path-free.** `stats_compute`, `mining`, `case_assignment`,
  `coalesce`, the `analysis*` family take in-memory data and return structures; only
  `normalize.py` touches disk (~19 of 38 Python I/O calls). This is why a pluggable store is a
  *seam*, not a rewrite, in the Python layer.
- **The analysis layer already produces the raw material for the €-ROI close.**
  `analysis.run_analysis` emits variant/rework/timing; `stats.json.meta` already exposes
  `step_count`, `match_rate`, `case_count`, `step_state_breakdown`. §11c is a new *consumer*, not
  new measurement.

---

## 3. Per-workstream fit

Change magnitude: **Seam** (inject an interface / thread a param) · **Moderate** (new module on
existing seams) · **Major** (substantial new capability) · **Rewrite** (re-architecture).

| WS | What it asks | Change | Fits? | Chokepoint it touches | Hard prerequisite |
|----|--------------|:------:|:-----:|----------------------|-------------------|
| **§11a** Real-data harness + 3-tier calibration + e2e CI gate | Drive real apps → real recorder captures → ground-truth data; gate merges; diff maps vs expected | **Moderate** | ✅ Yes | CI (`js.yml` skips Electron) + out-of-repo harness | Session-level golden mechanism (none exists); in-repo `e2e/` + `playwright-core` dep |
| **§11b** Segmentation / alignment calibration | Tune coalescing, anchors, boundaries, segmentation against ground truth; kill the 308-step class | **Moderate→Major** | 🟡 With plumbing | `normalize()` god fn + locked knobs | **11a golden** + a **calibration config surface** (knobs are unreachable today) |
| **§11c** Automated insight + €-ROI layer | Rule-based findings + €-quantified business case | **Moderate** | ✅ Yes | `analysis` modules + `normalize()` | None hard (rides existing stats); benefits from §11f ranking |
| **§11d** App Vocabulary generation | Real-data + LLM-assisted labeling; structured state-clustering; pre-built vocabs | **Moderate→Major** | ✅ Yes | `app_vocab.py` (schema exists) | **11a** for labeled real data; new web/UIA walkers |
| **§11e** Desktop coverage hardening | Framework detection, identity ladder, value-recovery, OCR last-resort, Citrix rule, video backstop | **Major** | ✅ (extends recognition layer) | **The C# recorder (zero tests)** + recognition layer | **11a** recorder coverage first (don't harden an untested moat blind) |
| **§11f** UiPath borrows | Cross-recording trace merge; automation-candidate ranking; structural PII masking; consent UX | **Mixed** | 🟡 Split | `step-alignment.js` (merge); recognition layer (PII); capture (consent) | **merge ⇒ §11b** (alignment must work); **ranking ⇒ feeds §11c**; PII/consent additive |

### Notes that change the reading
- **§11b is the one with hidden cost.** The decisive segmentation knobs
  (`step_split_on_element=True`, `step_split_idle_ms`, `step_max_interactions`) exist only as
  `auto_suggest_steps` keyword defaults (`step_suggest.py:90-98`), and **both call sites pass
  none of them** (`normalize.py:553`, `:586` — verified directly). You cannot sweep the knob that
  causes the 308-step explosion without editing a function default. Calibration is blocked by
  *plumbing*, not only by data. Knobs are also homed three inconsistent ways (template-dict for
  canonical/anchor, module-const for the suggest detectors, function-default for the segmenter) —
  a config surface must unify them.
- **§11e is the highest-risk build** — it adds real capability to the recorder, the one true
  moat, which today has no automated tests. It fits the existing per-framework recognition
  architecture, but it must come *after* §11a gives the recorder coverage, or you're hardening a
  black box.
- **§11f is not one thing.** Trace-merge is the high-value borrow but sits on unproven alignment
  (⇒ §11b). Ranking is cheap and feeds the €-ROI close (⇒ §11c). PII-by-UIA-field and consent UX
  are independent and additive.
- **§11c implementation specifics.** Lands precisely on existing seams: a new
  `normalization/analysis_roi.py` slots into `analysis.run_analysis`'s try/except loop; a new
  `_write_roi()` section inserts after `_write_automation()` in `pdd_export.py`'s linear flow;
  the per-step `automatable_fraction` / `realism_factor` analyst verdicts reuse the existing
  `analysis_overrides[]` schema (no new array key); the analyst's *non-observed* inputs (annual
  volume confirmation, loaded €/hr, amortized automation cost) live in a new session-level
  `roi_inputs` annotations key — same precedent as `case_anchor_override`. No annotation
  schema design needed; per SCHEMA.md "When the schema changes," additive keys are
  non-breaking and don't bump `version`.
- **§11e local-OCR engine.** When the §11e identity ladder reaches its last rung, the choice is
  **Windows.Media.Ocr** (Win10+ system API, free, on-device, zero bundle inflation) — *not*
  Tesseract (cross-platform later but multi-MB bundle). Invariant: Windows-only is deep
  (`runs-on: windows-latest`, `platform: "win32"`, `net8.0-windows`, `-embed-amd64.zip`); the
  cross-platform argument for Tesseract has no buyer. Wire it as a thin C# bridge invoked
  on-demand by the recorder, never on every event. One-line decision, not a debate.

---

## 4. Complementarity — they reinforce, they don't conflict

The workstreams are **strongly complementary** and share a foundation. The dependency graph:

```
        ┌─────────────────────── FOUNDATION (shared prerequisite) ───────────────────────┐
        │  F1 in-repo e2e + CI gate     F2 session-level golden     F3 calibration config │
        │  F4 decompose normalize()  ───────────── (F2,F3,F4 all live in normalize.py) ───┤
        └───────┬───────────────────────────────┬───────────────────────┬────────────────┘
                │                                │                        │
            §11a (assembles F1+F2)           §11b (needs F2+F3; F4 alongside)   §11d (needs §11a data)
                │                                │                        │
                ▼                                ▼                        ▼
   recorder coverage ⇒ §11e        §11f-merge (needs §11b)        zero-config first run (WS8)
                                                 │
                                                 ▼
                              §11c €-ROI  ◄── §11f-ranking (feeds it)
                              (can start NOW on existing stats; the commercial close)
```

**Reading the graph:**
- **§11a is the keystone** — it self-describes as solving four problems at once (calibration
  data, the e2e regression gate, recorder coverage, vocab labeling). It is the unlock for §11b,
  §11d, and §11e. Build it first.
- **The critical path is `§11a → §11b → §11f-merge`** — the crown-jewel chain. Each link is
  blocked until the prior lands. This is where schedule risk concentrates.
- **§11c can start immediately, in parallel** — it consumes data that already exists
  (`analysis` + `stats.json.meta`). It is also the **commercial closer** (the €-ROI the
  Discovery Sprint sells). Highest value-to-prerequisite ratio. Do it alongside §11a.
- **No workstream conflicts with another.** They share prerequisites and feed each other; none
  pulls the architecture in an opposing direction. The only tension is *sequencing* (the
  foundation must precede the chain), not *fit*.

---

## 5. The shared foundation (what "what needs to happen" actually is)

Three foundational items (F1–F3) are **hard prerequisites** that gate most of the roadmap; a
fourth (F4) is a **strongly-recommended risk-reducer, not a blocker.** F1–F3 are also exactly the
structural-debt items the code review flagged — **the prerequisite cleanup and the roadmap's
Wave 0 are the same work.**

| ID | Foundation item | Today | Effort | Unblocks | Maps to |
|----|-----------------|-------|:------:|----------|---------|
| **F1** | In-repo `e2e/` harness as a merge gate | Unit CI **does** gate master (`js.yml` Node 20 + `pytest.yml`), but skips Electron (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`, `js.yml:29,37`); the **e2e** harness is out-of-repo, eyeball-only, and gates nothing | Moderate | §11a, all UI safety | proposed ADR-0019 |
| **F2** | Session-level golden diff (re-norm → diff `stats.json.meta`/`annotations.json:steps`/`dfg.json`) | None — only a unit-level `process-label-golden.json` | Moderate | §11a, §11b | proposed ADR-0019 |
| **F3** | Calibration **config surface** threaded into `normalize()` | Knobs locked as fn defaults; call sites pass none | Moderate | §11b, §11d | proposed ADR-0022 |
| **F4** | Decompose `normalize()` (**~509-line fn, ~13 try/except stages** — lines 381–889) | God function; additive stages still slot in, but it's where F3's threading + future stages land | Moderate | **Risk-reducer for F3** + debt paydown (*not* a hard blocker) | tech-debt **#11** |

**The key systems-design point:** F2/F3/F4 all live inside `normalize.py`. F3 is **surgical** — a
`calibration`/`segmentation` config block threaded through the two `auto_suggest_steps` call
sites (`:553`, `:586`) + `coalesce` — and does **not** require F4. F4 (splitting the ~509-line
function into named stages) is the higher-quality way to land F3 and exposes clean stage outputs
to the golden-diff harness, so **do F4 *with* F3 if you can — but F3 can ship without it.** F1+F2
pair together. Either way, the rest of §11 is additive.

**Don't defer F4 indefinitely, though.** §11c, §11d, and §11f each add at least one new stage to
the ~509-line function; every addition makes the eventual decomposition harder. If F4 isn't taken
in Wave 0, make it a **hard prerequisite for Wave 1** — not open-ended debt.

---

## 6. The two genuine architectural changes (beyond the foundation)

These are the only items that change *architecture*, not just add modules:

### 6a. Pluggable session-storage backend (§13 — deferred, Tier 2)
- **Magnitude:** Seam in Python (cheap) → Moderate in capture → **Major in the viewer.**
- **Why staged works:** Python compute is path-free; wrap `normalize.py`'s ~6 load/write fns
  behind a `SessionStore` protocol (cheap). Capture has one existing seam
  (`tracker.appendFile`). The viewer is the expensive part — the path-string IPC contract
  (`ipc.js`) + direct local-fs use in **both** `main.js` and `renderer.js` (**~88 `fs.*` calls +
  ~47 `path.join`**) assume a mountable local folder. *(Sizing note: these are line/site counts —
  `renderer.js` is **1,681 lines**, `main.js` **954**; an earlier audit misread the ~73 KB / ~39 KB
  file *sizes* as "73.3k / 38.9k lines." The viewer is the costly layer, but ~2.6k lines, not 112k.)*
- **What must happen:** land the Python + capture seams *now while they're small* (stops the
  ~250 inlined-`fs` assumptions from growing in the hardest-to-retrofit layer); defer the viewer
  IPC rework until BYOC demand is real. **Prerequisite: 6b.**
- **Cheap insurance to take now (~½ day).** Introduce a `SessionRepository` Strategy
  abstraction in the viewer (today: implicit filesystem in `session.js` plus the `fs` sites in
  `renderer.js`/`main.js`) with `LocalFsRepository` as the only implementation in v1.
  Isolates the viewer from the substrate so the BYOC decision later is "implement the other
  adapter" rather than "rewrite the viewer's I/O layer." Pairs with F4 — the same Strategy /
  Repository discipline applied to the analyst-side I/O. Costs almost nothing now; saves the
  v2-viewer rebuild later.

### 6b. Extend the air-gap invariant to the Node layer (corrected; cheap; prerequisite to 6a)
- **Finding (corrected):** renderer egress *is* structurally blocked (CSP `connect-src 'none'`
  in both apps). The **Node main process is not** — no `no-restricted-imports` on `http`/`net`,
  no egress guard. A backend transport added in `main.js` would bypass the renderer CSP entirely.
- **What must happen:** add a Node-side egress allowlist (today: only localhost OBS) + a lint
  rule, **before** 6a introduces a transport there. Small change; converts the "air-gapped tier"
  from provable-in-renderer to provable-everywhere.
- **Why it matters commercially:** the premium air-gapped/SCIF tier is unsellable the day a
  networked deployment mode shares unguarded code paths with it.

### 6c. Workstream-internal structural decisions (not architectural changes, but moat-defining)

Two design choices hide *inside* workstreams §11d and §11e. Both must be made before
implementation starts; neither is a change of architecture (6a/6b are), but each determines
whether the workstream preserves the privacy moat or hollows it.

**6c.i — Local LLM hosting (§11d).** §11d's "LLM-assisted vocab labeling, local-only" cannot
start without picking a hosting model. There is zero LLM dependency in the tree today (no
`ollama` / `llama` / `anthropic` / `openai` references anywhere in `capture/`, `viewer/`, or
`normalization/`). Three options:

- **Option A — Bundled local LLM** (Ollama, llama.cpp, ONNX runtime). Preserves the moat
  (nothing leaves the building). Inflates the bundled-Python footprint from ~237 MB to
  multi-GB; updates and AV/EDR allowlisting become heavier.
- **Option B — Sidecar process the analyst hosts separately.** Preserves the moat; defers
  bundling to the analyst's existing infrastructure. Matches the services-led posture and
  the boutique stage.
- **Option C — Off-device cloud LLM.** Contradicts the moat. Even "labeling against app
  docs only" leaks vocab-relevant terminology that may be exactly what the regulated buyer
  cares about. **Do not do this option.**

**Recommendation:** Option B for the first cut. Option A only if/when a self-serve product
tier is committed to.

**6c.ii — Auxiliary-engine sidecar pattern (cross-cuts §11d and §11e).** Today's only sidecar
is `capture/recorder/` — a long-lived child process that owns one structural concern (UIA
capture), communicates over stdio NDJSON, and was validated under the threat model. §11d's
LLM and §11e's Windows.Media.Ocr bridge both want long-lived processes for the same reasons
(model-load cost, native-API initialization, no spawn-per-call). **Reuse the recorder sidecar
pattern for both rather than inventing a new IPC channel.** The viewer's existing
`python-runner.js` shape is correct for synchronous analyst-paced normalization runs but
mis-shaped for long-lived auxiliary engines. One proven pattern, two new consumers — not
three patterns.

### (Web viewer port — §8 Tier 2)
Not analyzed in depth here, but flagged: it starts in `flow-view.js` (**3,811-line** god file) and
inherits the shared-singleton DFG/BPMN viewer issue (code-review M-23). Treat as its own
system-design exercise when the BYOC stage is funded; do not let it ride in implicitly.

---

## 7. What needs to happen — sequenced introduction

Grounded in the dependency graph (§4) and the foundation (§5). Three waves.

**Wave 0 — Foundation + the free win (do first, mostly in parallel):**
1. **F1 + F2** — in-repo `e2e/` gate + session-golden diff on the committed `example-aggregate`.
   (Drivers exist out-of-repo; `stats.json.meta` already exposes the metrics; `capture-smoke.js`
   is the assert+exit template. Mostly assembly.)
2. **F4 + F3** — decompose `normalize()` into named stages and thread a calibration config block.
   (Same edit; pairs tech-debt #11 with the §11b prerequisite.)
3. **§11c (start now)** — rule-based insight + €-ROI on existing analysis output. Parallel to the
   foundation; it's the commercial closer and needs no prerequisite.
4. **6b** — Node-side egress guard. Cheap; unblocks 6a later.
5. **Self-sign all binaries (immediate, hours not days).** Use the existing internal cert per
   the memory note ("Signing capability is internal — company has a self-sign cert"). Sufficient
   for the originating-org pilot in §10 and the locked-down deployment laptop in §14 Sprint 1.
   **Do not conflate this with EV code-signing for unknown customer environments** — that is
   procurement-blocked (cert acquisition + key-management policy) and is a separate later step.
   The master assessment's §5⛔#1 and §14 Sprint 1.1 read these as one item; they are two.
6. **`Recorder.Tests.csproj`** — stand up the C# recorder's first test project (xUnit on
   .NET 8). Three seed tests: `BuildEvent` field set for a synthetic UIA element, the
   keystroke-coalescing path at `debounce_ms` boundary, the marker/system-event immediate-flush
   bypass. **Hard prerequisite for any §11e work** — listed here so the order is unambiguous;
   adds the fuzzer-equivalent discipline on the only language Python fuzzers don't reach.

**Wave 1 — light up the chain (after Wave 0):**
7. **§11a** — turn the foundation into the real-data calibration harness (3 tiers).
8. **§11b** — calibrate segmentation/alignment against the golden corpus; resolve the 308-step
   class. (Now possible — knobs are reachable via F3, golden exists via F2.)
9. **§11d bootstrap-only first cut** — pre-built vocabs from `--bootstrap-vocab-out` against
   the §11a corpus, no LLM required. Five to ten seed apps (Outlook, Salesforce, Excel,
   Chrome, SAP GUI) cover most of the zero-config-first-run promise (WS8). Ship this *before*
   the §6c.i hosting decision is made; the LLM-augmented piece comes in Wave 2.

**Wave 2 — capability + crown jewel (after the chain proves out):**
10. **§11e** — desktop-coverage hardening (identity ladder, value recovery, framework
    detection, Windows.Media.Ocr last-resort per §6c, video backstop). Safe now: the recorder
    has the `Recorder.Tests.csproj` from Wave 0 item 6 plus the §11a real-data coverage.
    **Recorder-side landed 2026-05-30** ([ADR-0023](../adr/0023-recorder-capture-confidence.md)):
    framework detection, identity ladder, per-element confidence, TextPattern value recovery, and
    the default-off Windows.Media.Ocr bridge — all additive, analyst-facing, pinned by
    `Recorder.Tests`, pipeline-neutral. **Still deferred:** live validation against real
    Java/Qt/Citrix/terminal apps (the §11a real-data step) and calibration of the confidence/cap
    constants (§11b).
11. **§11f** — trace-merge (now that §11b alignment is proven), automation-candidate ranking
    (feeds §11c), structural PII masking + consent UX.
12. **6a** — pluggable storage: Python + capture seams (the `SessionRepository` viewer shell
    from §6a was taken as half-day insurance in Wave 0); full viewer IPC rework only at the
    BYOC decision gate.
13. **§11d LLM-augmented piece** — once the §6c.i hosting decision is made and §6c.ii
    sidecar shape is wired. Vocab labeling assistance and structured state-clustering on top
    of the bootstrap vocabs from Wave 1 item 9.

---

## 8. Risks & where the design fights itself

1. **The spec treats workstreams as independent; they share a critical path.** If §11b/§11d/§11e
   are attempted before the foundation (F1–F4), each re-pays the scaffolding cost and they will
   collide in `normalize.py`. *Mitigation: Wave 0 is non-negotiable first.*
2. **Effort has historically flowed away from value** (assessment §6): most went to alignment
   (unproven, no scaffolding) while the moat (recorder) is untested and the closer (€-ROI)
   doesn't exist. *Mitigation: §11c in Wave 0; recorder coverage before §11e.*
3. **The crown jewel is still unproven AND plumbing-blocked.** "Built" ≠ "works" ≠ "calibratable."
   Until F2+F3 land, §11b cannot even begin properly. *This is the central schedule risk.*
4. **§11e hardens the untested moat.** Adding capability to the zero-test C# recorder without
   §11a coverage first is the highest-defect-risk move in the plan.
5. **Bus-factor of one** (assessment §13) — the foundation (F1/F2 CI gate, recorder tests) is
   also the bus-factor mitigation. Same work, double payoff.
6. **`obs.js` (176 lines) is also zero-test** — not just the C# recorder. OBS scene-bootstrap /
   recording-lifecycle / clock-sync failures are a "first-ten-minutes" reliability risk
   (assessment §12 #10). *Mitigation: cover it alongside the recorder test project in Wave 0.*

---

## 9. Indicative effort (order-of-magnitude, solo)

Rough sizing for planning only — *not* commitments. "d" = focused days, "wk" = weeks.

| Item | Size | Note |
|------|:----:|------|
| F1 in-repo e2e gate | 2–4 d | Relocate existing drivers + assert/exit-code conversion |
| F2 session-golden diff | 2–3 d | Projection format decision + diff logic + CI wiring on committed `example-aggregate` |
| F3 calibration config surface | 2–3 d | Thread a config block through ~3 call sites |
| F4 decompose `normalize()` *(optional)* | 3–5 d | Debt paydown; do alongside F3 if taken |
| 6b Node egress guard | <1 d | Allowlist + lint rule |
| Self-sign binaries | hours | Internal cert exists (memory note) |
| `Recorder.Tests.csproj` + 3 seed tests | 1–2 d | Hard prereq for §11e |
| §11c €-ROI layer | 5–8 d | Arithmetic module ~3 d; + viewer panel, analyst-input flow, PDD section, findings narrative ~2–3 d |
| §11a real-data harness (3 tiers) | 1–2 wk | Largest net-new: corpus + scripts + CI job (see §11 CI-driving caveat) |
| §11b calibration loop | 1–2 wk | Sweep + validate; bounded by corpus quality |
| §11d bootstrap vocabs (no LLM) | 2–4 d | Uses `--bootstrap-vocab-out`; two *sample* vocabs ship (outlook, salesforce) but **no validated production set** — estimate assumes authoring+validation against real captures, untested |
| §11e coverage hardening | 2–4 wk | Recorder strategy refactor + identity ladder + OCR bridge |
| §11f cross-recording merge | 1–2 wk | New subsystem on top of §11b |
| 6a pluggable backend (full) | wk–months | Viewer IPC rework; defer to the BYOC gate |
| **Wave 0 total** | **~12–22 d (3–5 wk solo)** | F1+F2+F3 (+F4) + §11c + 6b + self-sign + recorder-tests — a substantial phase, not a sprint; size it as one |

---

## 10. Decisions to make before implementation

Open choices, each gating a specific workstream. Roughly in the order they bite:

1. **Test-corpus location + "expected output" format** — see §11. *Gates §11a.*
2. **€-ROI input ownership** — recommend a new session-level `roi_inputs` key (precedent:
   `case_anchor_override`); per-step verdicts reuse the existing `analysis_overrides[]`.
   *Gates §11c's analyst surface.*
3. **Self-sign vs EV signing** — self-sign now (internal cert) for the originating-org pilot; EV
   is a separate procurement-blocked step for unknown customers. Don't conflate (master §5⛔#1 /
   §14 do). *Gates the first paid pilot.*
4. **Recorder test framework** — xUnit on .NET 8 (matches the node:test/pytest
   low-friction-per-language convention). First call: synthetic UIA tree vs. spawn a real app.
   *Gates §11e.*
5. **Local-LLM hosting** — Option B (analyst-hosted sidecar) for the first cut; Option A
   (bundled) only at a self-serve product tier; never Option C (cloud). See §6c.i. *Gates §11d's
   LLM-augmented piece — not the bootstrap first cut.*
6. **OCR engine** — Windows.Media.Ocr (system API, no bundle inflation). One-line decision. See
   §3 note / §6c.ii. *Gates §11e's last identity-ladder rung.*
7. **Cross-recording project model** — extend `aggregate-view.js`'s compare-sessions surface vs.
   a formal project-above-session container. *Gates §11f-merge; downstream of §11b.*
8. **BYOC commitment timing** — whether to take the `SessionRepository` half-day insurance now
   (§6a) even if BYOC is a year out. Recommend yes.

---

## 11. Test-corpus convention (§11a prerequisite detail)

§11a needs a home for ground-truth data; none exists. `sessions/example-aggregate/` is *demo*
data, `sessions/_fixtures/` + `sessions/_real_suite/` exist but are sparse, and CLAUDE.md forbids
committing regenerated outputs of the demo set.

**Recommended layout** — a top-level `corpus/` with three tiers mirroring §11a:
- `corpus/narrow/` — one scripted workflow, exact ground truth; committed; gates CI.
- `corpus/bounded/` — parameterized scripts injecting *known* variations; committed.
- `corpus/wide/` — real human captures; held **out-of-repo** (CLAUDE.md "company captures stay
  local"); exploratory, the source of new narrow cases.

Each scenario carries `script.{ps1,playwright.ts}` (the driver), `expected.json` (the diff
target), and `README.md` (what bug class it pins — the 308-step pattern is the obvious first).

**"Expected output" format** — diff a **lightweight projection**, not full artifacts or pixels:
- ✅ **Projection (recommended):** a small JSON of `case_count`, per-case `step_count`, canonical
  step labels, markers, the anchor — the same shape the seeded fuzzers already assert against, and
  `stats.json.meta` already exposes most of these scalars.
- ⚠️ Full-artifact verbatim — drifts on every benign pipeline tune; high-maintenance.
- ⚠️ Pixel-diff PNGs — theme/zoom/font-fragile; keep screenshots as failure *artifacts* only,
  never assertions. (This is exactly the trap the map-overlay bug exposed — a *visual* regression
  that a data-projection diff would miss but a DOM-geometry assertion catches; the harness should
  assert geometry/DOM facts, per §11a.)

**CI-driving caveat (both earlier passes missed this).** The narrow tier's golden gate runs on a
**pre-recorded, committed `events.jsonl`** — re-normalize → diff the projection — so it needs **no
recorder in CI** and gates on `windows-latest` today. Driving the **real C# recorder** in CI (live
UIA capture against a foreground app) is a separate, harder problem: `windows-latest` UIA/desktop
support is limited and likely needs a **self-hosted runner with a desktop session**, which changes
the cost and maintenance of §11a. **Keep recorder-in-CI out of the Wave-0 gate** — the
normalization golden on pre-recorded data is what gates merges; live-recorder CI is a Wave-1+
self-hosted-runner concern (or stays a documented manual pre-release check).

---

## 12. What does NOT need to change

Load-bearing and stable — safe to build on; do **not** refactor for §11:

- `shared/SCHEMA.md` for `events.jsonl` / `annotations.json` — additive-only; no breaking edits
  required by any workstream. *(One caveat for §11a: only `annotations.json` carries a `version`
  field; `events.jsonl` and `manifest.json` carry none, and there's no migration code — so the
  golden harness's projection must tolerate/encode capture-version drift or it will mis-read
  sessions produced by a future capture build. See §15.4.)*
- The **linear stage sequence** in `normalize.py` — new stages are call insertions; the F4
  decomposition is optional debt paydown, not a re-architecture.
- The recognition-layer file format (`shared/recognition-patterns.json`) — the right shape for
  §11e framework-signature additions (a JSON edit, not code).
- The PDD section model (`pdd_export.py`) — new sections are programmatic insertions.
- Undo/redo (`viewer/state.js` + `viewer/session.js`) — every new annotation-touching action
  inherits undo/redo for free.
- The viewer↔Python subprocess contract for §11a–c — the LLM/OCR sidecars of §11d/e want the
  separate auxiliary-engine shape (§6c.ii); the existing contract stays.
- The **seven seeded fuzzers** — protect the detector mechanics §11b will tune. *Re-run them
  before merging any §11b change.*
- The build-distribution chain — signing is an additive script step; procurement is the
  bottleneck, not architecture.

---

## 13. Cross-cutting: `annotations.json` is the system's nervous system

The sidecar already carries ~20 documented top-level keys; §11 plausibly adds `roi_inputs`,
`roi_findings`, `framework_recognition`, `merge_metadata`, `pii_masking_config`,
`consent_record`. The schema is explicitly additive (SCHEMA.md "When the schema changes"), so each
drops in without a `version` bump. Two disciplines to hold as it grows:

- **Single-writer ownership per key** — Python regenerates `auto_*` keys; JS owns analyst keys.
  Ambiguous ownership caused the worst v0.17-era bugs and is documented per-key in SCHEMA.
- **Watch p99 size** — if a real engagement's `annotations.json` crosses multi-MB, split into
  related files (`annotations/roi.json`, …) under one versioned envelope. Not a problem today; a
  tripwire to watch, not to pre-build.

---

## 14. Related documents

- [PDT-MASTER-ASSESSMENT.md](PDT-MASTER-ASSESSMENT.md) — the strategy + §11 roadmap this analyzes.
- [CONSOLIDATED-REVIEW-2026-05.md](CONSOLIDATED-REVIEW-2026-05.md) — the merged code-review
  register; origin of tech-debt #11 (F4), M-23 (web-viewer note), and the F-items' debt lineage.
- [../architecture/COHERENCE-AUDIT.md](../architecture/COHERENCE-AUDIT.md) — the "UI bugs invisible
  to green tests" failure that F1/F2 exist to close.
- [../architecture/OVERVIEW.md](../architecture/OVERVIEW.md) + [../../shared/SCHEMA.md](../../shared/SCHEMA.md)
  — the three-layer data model the analysis leans on.
- [NEXT-SESSION-SPEC.md](NEXT-SESSION-SPEC.md) — current plan of record; Wave 0 here should fold
  into it.
- **Proposed ADRs (not yet written):** 0019 e2e gate + golden (F1/F2) · 0020 Node egress guard
  (6b) · 0021 pluggable storage (6a) · 0022 calibration config surface (F3).

---

## 15. Corrections the Master Assessment needs

The *strategy* in [PDT-MASTER-ASSESSMENT.md](PDT-MASTER-ASSESSMENT.md) is sound; three *factual*
claims in it are off and should be fixed before it's used in a sales or planning context (all
verified in code). Recorded here because this doc is the assessment-vs-code reconciliation point;
none of these changes any §11 fit conclusion.

1. **"No screenshot in the stream" (§2, §4 UiPath table) is wrong.** Capture *does* take local
   screenshots — `fireScreenshot()` (`capture/main.js:133`) via Electron `desktopCapturer`, fired
   on app-switch / idle-resume / marker / manual hotkey, written as JPEGs to `screenshots/`
   (`screenshots.js:131`) with average-hash near-dup detection. The accurate claim is **"no
   screenshots *leave* the device; structured UIA is the *primary* substrate, screenshots are a
   local sidecar."** The §4 UiPath row should read *"Structured UIA event primary; optional local
   screenshots + OBS video,"* not *"no screenshot in the stream."* The moat itself is intact —
   egress is CSP-blocked (§2) and screenshots are written locally only, no network path
   (verified: `screenshots.js` does `desktopCapturer` → `fs.writeFileSync`, no `fetch`/`http`).

2. **"CI gates nothing" (§5, §12) is stale.** `js.yml` (Node 20; syntax + `node:test` for both
   apps) and `pytest.yml` (Python 3.12) **do** gate merges to master. The gap is narrower: no
   e2e/Playwright gate (harness out-of-repo), no C# recorder CI, no session-level golden diff.
   State the gap precisely.

3. **"~0.1→0.19 in roughly two weeks" (§2) strains credibility.** 18 ADRs, a ~955-line
   orchestrator, 7,100+ lines of fuzzer-tested Python, a cross-language golden, an 813-line
   schema. "Early but disciplined" is accurate; the two-week timeline undersells the maturity and
   would invite skepticism in a buyer conversation. Drop or soften it.

4. **"Versioned schema + migration ✅" (§5) is overclaimed — it's 🟡.** Only `annotations.json`
   carries a `version` field (`SCHEMA.md:150`); `events.jsonl` and `manifest.json` carry none, and
   there is **no migration code** — evolution is additive-by-convention, not enforced. Re-rate the
   enterprise-checklist line to 🟡. This also gives §11a a real obstacle (§12 caveat): the golden
   harness can't tell which capture build produced a session, so its projection must be
   version-tolerant.

---

## 16. Bottom line for the decision

- **Significant change? No — not to the architecture or the data model.** The data model is
  right and untouched. The change is *concentrated*, not *broad*: one config-surface threading
  (F3, ~3 call sites — ideally alongside the optional `normalize()` decomposition F4), one
  test/CI foundation (F1+F2), one large recorder build (§11e), and one deferred, stage-able
  deployment change (6a).
- **Complementary? Strongly.** No workstream fights another; they share a foundation and feed
  each other. The only real constraint is sequencing.
- **Fit? Good.** Every additive workstream attaches to a seam that already exists (analysis,
  `app_vocab`, recognition patterns, alignment). The architecture was built for this direction.
- **What must happen first?** Wave 0: the `normalize()` refactor + config surface (F3/F4), the
  in-repo e2e + session-golden gate (F1/F2), §11c in parallel, and the cheap Node egress guard.
  Everything else is gated on that and becomes additive once it lands.

**The prerequisite cleanup and the commercial roadmap are the same work.** That is the most
actionable conclusion: standing up the e2e/golden gate (F1/F2) and threading the calibration
config surface (F3) — with the `normalize()` decomposition (F4) riding alongside as high-value
debt paydown — isn't maintenance you do *instead of* the roadmap; it *is* the roadmap's Wave 0.
