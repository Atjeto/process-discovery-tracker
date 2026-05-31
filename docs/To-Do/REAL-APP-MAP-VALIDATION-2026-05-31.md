# Real-app validation + map-connectivity review — 2026-05-31

**Branch:** `real-app-map-validation` · **Box:** dev box (drives real apps + the real
C# recorder) · **Headline:** the ADR-0024 screen-grain map regression is **confirmed,
root-caused, fixed, and gated**. Real desktop (Excel/Word) + web (ServiceNow) captures
were driven through the real recorder; Outlook was skipped (precondition unmet — no mail
profile). Two *deeper, pre-existing* issues the real web capture surfaced are written up
as a precise handoff (§6), not hastily fixed.

Validation harnesses (out-of-repo scratch, `_pdt_verify/`):
`map-connectivity-verify.js` (drives the viewer, pulls connectivity off the live
cytoscape graph), `real-corpus/drive-servicenow.ps1` (new web driver), `real-snow-map.js`.
Screenshots referenced below live in `_pdt_verify/`.

---

## 1. The headline: the Flow/Step maps regressed (CONFIRMED → FIXED)

**Symptom (owner):** the Flow diagram (DFG) and Step-level maps used to render a clean
`start → … → end` chain and now look tangled / disconnected / orphaned.

**Root cause.** ADR-0024 made two changes: (a) the default map grain flipped from *step*
(`process_label`) to **screen**, and (b) the screen grain key resolves to the vocab
`screen_id` **else the raw `window_title`**. A window title routinely embeds the *case
value* — `"Salesforce - Order #10900"`, `"Outlook - Order #10852 confirmation"`,
`"Create INC0010010 | Incident | ServiceNow"`. Grouping the screen notch on the raw title
makes the **same logical screen a distinct node per case**, so the default map fans out
into a per-case hairball. The `process_label` axis (old *step* default) was value-free, so
the *old* default looked clean — hence "it used to be a chain."

**Measured, on the committed 10-session demo (re-analyzed), live in the viewer:**

| grain | aggregate map nodes | end-nodes (sinks) | verdict |
|------|----|----|----|
| element (= old "step") | 21 | 1 | clean connected DAG |
| **screen (pre-fix, the new default)** | **76** | **35** | **hairball** (`mapconn-pre-aggregate-screen.png`) |
| screen (post-fix) | **6** | **1** | clean linear chain (`mapconn-post-aggregate-screen.png`) |

Single session `sess-2026-0514-0900`: screen grain 10 nodes / 3 end-nodes (pre-fix) →
**5 nodes / 1 end-node** (post-fix): `Account lookup → Salesforce Order → va01 → Excel →
Outlook confirmation`.

**Fix (committed `a64d0d4`).** A conservative value-free screen normalizer
`process-map-levels.screenType` strips embedded record numbers / id-tokens
(`#10900`, `INC0010010`, `CUST-10852`) — the same spirit as ADR-0013's `process_label`,
applied **at view time** inside `grainKey`/`grainLabel` so the Map, the Steps list, and the
Analysis "Waste by screen" itemisation all inherit it. Raw `grain_keys` untouched (detail
never destroyed); no re-normalize, no golden change. Short codes like `va01` survive
(digit-run threshold 3+). New `e2e/session-smoke.js` **map-connectivity pin**: the
screen-grain DFG must be one weakly-connected component with one start and one end.

**Gates (all green):** viewer 248 · capture 81 · pytest 336 · `golden_check` · dotnet 60 ·
`e2e` 14/14 (incl. the new connectivity pin: `nodes=5 edges=4 components=1 sources=1 sinks=1`).

---

## 2. Real captures (desktop · web · mixed)

Driven via the real C# recorder under `real-corpus/build-corpus.js` (recorder self-extract
forced to D: per the C:-space constraint).

| capture | kind | cases | interactions | result |
|---------|------|-------|--------------|--------|
| **Excel** | desktop | 3 | 40 | ✅ good — Filter/Sort/Copy/Save + cell entry |
| **Word** | desktop | 2 | 24 | ⚠️ partial — mail-merge menus reject `InvokePattern` (the known §11e gap); only `FileSave` + body edits landed |
| **Outlook** | desktop | 3 | 15 | ✅ good *(after a driver fix — see below)* — To/Cc/Subject + body across 3 cases |
| **ServiceNow** | web/SaaS | 3 | 75 | ✅ rich — created 3 real incidents (INC0010009-…) on the `dev295949` dev instance: Caller/Short-desc/Description/Category/Submit |

**Outlook driver fix (correcting an earlier wrong call).** I first reported Outlook as
"skipped — no mail profile (Welcome to Outlook wizard)." That diagnosis was **wrong**: the
classic profile `Outlook` (→ `rashapet@hotmail.com`, 672 inbox items) is configured and the
COM ProgID resolves to the current classic Outlook. Two real driver bugs caused the
failure: (1) `drive-outlook.ps1` *fetched* the MAPI namespace but never called
`Namespace.Logon()`, so a **cold** COM launch (Outlook not already running) hadn't loaded
the default profile and `CreateItem` hit the first-run wizard — it only worked yesterday
because Outlook happened to be already running; (2) the per-case create→display→discard→
create churn left Outlook rejecting subsequent `CreateItem` (cases 2..N). Fixed by logging
on to the default profile and reusing a single compose inspector (refilling To/Cc/Subject
per case). Outlook now captures cleanly.

**Mixed:** the 10-session committed demo aggregate already *is* the cross-app mixed
structure (Salesforce → SAP `va01` → Excel → Outlook); it carries the multi-app map used
for the connectivity verdict in §1. A fresh mixed live capture was not driven (Outlook leg
unavailable); the demo covers the cross-app map shape.

Web precondition was **met** (a logged-in ServiceNow dev instance was open) — the owner
confirmed the SaaS accounts are blank dev accounts, safe to mutate. A new
`drive-servicenow.ps1` was authored: it binds to the running Chrome window, wakes the lazy
a11y tree, reads the instance base URL from the omnibox, and navigates to a fresh incident
form by URL per case (robust across ServiceNow UI versions).

---

## 3. Vocab matching (Phase 2)

Per-app enrichment (`app_vocabulary_matches` / interaction count = the viewer's "VOCAB
COVERAGE"):

| app | vocab hits / interactions | coverage | notes |
|-----|---------------------------|----------|-------|
| Outlook | 9 / 9 | **100 %** | every To/Cc/Subject entry matched `outlook.yaml`; screen resolved to the value-free vocab `compose` → screen grain is ONE clean node (no fan-out). The happy-path contrast to ServiceNow. |
| ServiceNow | 38 / 72 | **53 %** | strong — `incident.short_description`, `incident.description`, `incident.category`, `sys_display.incident.caller_id`, `sysverb_insert` all matched the live form by stable `automation_id`; live aids matched the committed `servicenow.yaml` exactly. |
| Excel | 12 / 40 | **30 %** | ribbon Invokes (`Filter`, `SortAscendingExcel`, `Copy`, `FileSave`) enrich; raw cell entries (`A1`…`A6`) do not — expected (cells aren't vocab controls). |
| Word | 2 / 24 | **8 %** | coverage gap — the §11e mail-merge `InvokePattern` rejection + verbose-gated document text leave little for the vocab to key on. Flagged. |

Enrichment confirmed qualitatively: matched steps take their names/`process_label` from the
vocab, not raw control text. **Outlook (100 %)** is the clean case — full vocab match gives
a value-free `compose` screen with no fan-out, validating that the screen-axis problem only
bites where the vocab *doesn't* attach (§6). Coverage gap to flag: **Word** (8 %) is bounded
by the recorder seeing little (the §11e capture gap), not by a vocab defect.

---

## 4. Segmentation / grain (Phase 3) + €-ROI invariance

Per-notch consolidation on real captures (element = finest, screen/app coarser):

| capture | element steps | screen steps (DFG nodes) | app |
|---------|--------------|--------------------------|-----|
| demo `sess-0514` | 64 | 19 list rows / 5 map nodes | ~4 |
| Excel | 17 | 3 list / 2 map | 1 |
| ServiceNow | 44 | 5 list / 3 map | 1 |
| Word | 16 | 2 list / 3 map | 1 |

The element notch reproduces the fine count; coarser notches consolidate — the ADR-0024
over-segmentation story holds on real data. **€-ROI total is notch-invariant** (e2e pin:
`0.01 h` at both the screen and app notch) — the grain is a view control and never
re-runs the pipeline, so it cannot move the headline total.

---

## 5. Map visual validation (Phase 4) — the verdict

Read back every screenshot. **Verdict: the screen-grain regression is real and the fix
restores a clean connected chain.** Evidence:

- `mapconn-pre-aggregate-screen.png` — the 76-node / 35-end-node hairball (pre-fix default).
- `mapconn-post-aggregate-screen.png` — a clean 6-node start→end chain (post-fix).
- `mapconn-pre-session-screen.png` / `mapconn-post-session-screen.png` — single-session fan
  → linear chain.
- `real-snow-screen.png` — **real ServiceNow**, post-fix: the three per-case
  `Create INC001001x | Incident` titles collapse to ONE `Create | Incident | ServiceNow`
  node (the fix working on live web data).
- `real-snow-element.png` — real ServiceNow at the element grain: still a 44-node
  3-comb tangle — see §6 (a separate, deeper issue the screen fix does not address).

The grain roll-up does **not** break edge connectivity in the engine (`buildAnnotationDfg`
builds edges correctly from the per-case sequence). The tangle was entirely the **node
identity** problem — non-value-free screen labels splitting one screen into many — not
dropped/mis-joined edges.

### 5b. Process diagram (BPMN) step ORDER — checked, was scrambled, FIXED

Full notation × level × zoom pass driven (`full-map-pass.js`): Process diagram (BPMN) +
Flow diagram (DFG) at Activity / element / phase / screen / app, single-session AND
aggregate, fit + zoomed. BPMN is mined at element(=step) + activity (phase BPMN isn't
mined — a minor gap, the level shows an empty-state; screen/app correctly fall back to
the Flow diagram).

**Found:** the step BPMN rendered with steps **out of execution order** —
`Outlook: Send` left of `Outlook: Enter To`, and the `end` event stranded **mid-flow**
(`fullmap-session-element-bpmn-ZOOM.png`, pre-fix). The *topology* (sequence flows) was
correct; the *layout* was wrong. Root cause: `mining._layout` ranked nodes by longest-path
over the **raw** edge set, and the inductive miner emits a loop/redo gateway with a
back-edge (`SAP: Create sales order → <upstream gateway>`); that single back-edge inflated
the rank of every node past the loop, smearing the columns. (The DFG was already correct —
this was a Process-diagram-only layout bug, pre-existing, not the ADR-0024 regression.)

**Fixed:** `mining._forward_edges` strips DFS back-edges before ranking, so columns are
assigned over the acyclic forward set (back-edges still drawn). Post-fix the step BPMN is a
clean left→right chain — single session and **10-session aggregate**: `start → Salesforce:
Search → ⬦{Open record / Approve credit} → Quantity → Unit price → Shipping → Save order →
SAP: Enter OR → Sales org → Material → Excel: Create → Status → Date → Save → Outlook: To →
Subject → Send → end`. Golden-neutral (the projection never read BPMN DI); pinned by a new
`test_bpmn_observed` cycle test. Evidence: `fullmap-{session,agg}-element-bpmn.png`,
`fullmap-session-element-bpmn-ZOOM.png` (post-fix).

**Verdict:** both notations now render a linear, connected, human-discernible step order.

---

## 6. Deeper issues the real web capture surfaced (HANDOFF — diagnosed, not yet fixed)

The ServiceNow capture exposed two related, **pre-existing** problems (not the ADR-0024
regression; the screen-axis fix deliberately scopes to the screen grain). Both share one
root: **`window_title` leaks in where the vocab did not fully attach to a step**, and a
window title carries the case value.

### 6a. Element-grain window-title-PREFIX fan-out
Step auto-names are `"{screen-or-window}: {action}"`. When the screen falls back to the
window title (`"Create INC0010009 | Incident | ServiceNow"`), the step **name and
`process_label`** embed the incident number in the **prefix**. `process_label` only strips
value **tails** (`— CUST-x`, `Enter N in Field`), so the prefix survives → the *element*
grain fans out (real ServiceNow: **44 nodes, 3 sources, 3 sinks** = three disconnected
per-case combs; `real-snow-element.png`).
- **Where:** `normalization/step_suggest.py` step-naming (the `{screen}:` prefix) +
  `process_label` rules (`shared/process-label-patterns.json` only handles tails).
- **Fix direction:** either (i) make `process_label` also strip value tokens mid-string /
  in the prefix (careful — must not over-collapse), or (ii) name steps with the *vocab*
  screen / a value-free screen (the §6b consistency fix would feed this). Touches Python +
  goldens → **regenerate goldens as an intentional change**; do not rush.

### 6b. Vocab-vs-window_title screen duplication
Within one logical screen, interactions that match the vocab get the value-free vocab
`screen_id` (`incident`, `workbook`, `document`) while interactions that don't match fall
back to the window title — so one screen becomes **two screen nodes** and a small loop:
- ServiceNow: `incident` ⇄ `Create | Incident | ServiceNow` (`real-snow-screen.png`)
- Excel: `workbook` + `_excel_corpus.xlsx - Excel`
- Word: `document` + `(screen)` + `_word_corpus.docx - Word`

On these small captures it's a 2-3-node loop, not a hairball — but on a long session it
would re-introduce clutter. **Fix direction:** make a step's `grain_keys.screen` consistent
— if *any* interaction in the step resolved a vocab `screen_id`, use it for the whole step
(the step is on one screen by construction). Lives in `step_suggest.step_grain_keys`
(Python) + the `resolveStepGrainKeys` view-time twin (JS); additive to `grain_keys`, so
likely golden-neutral. **Recommended next** — it is the higher-leverage of the two and
feeds 6a.

---

## 7. New-features sweep (Phase 5) — status

- **Point-and-learn vocab discovery (ADR-0025):** the live UIA probe path is exercised by
  `drive-servicenow.ps1 -Probe` (dumps the live form's `automation_id`s) — it confirmed the
  committed `servicenow.yaml` signatures match the live `dev295949` instance exactly. The
  in-app "Discover from window" snapshot flow itself was not re-screenshotted this session
  (deferred to the feature sweep).
- **€-ROI panel + invariance:** validated via `e2e/session-smoke.js` (legend, edit
  assumptions, autorank present; total invariant across notches).
- **Full view/level/control nav:** the Session map matrix (Flow/Process × element/screen/
  app/phase) was driven and screenshotted across the connectivity runs; the broader
  per-view eyeball sweep is partially covered and the remainder is queued.

---

## 8. Done / not-done

- ✅ Headline map regression: confirmed, root-caused, fixed, gated, screenshotted (real +
  demo), with a new e2e connectivity assertion.
- ✅ Real captures: Excel (good), Outlook (good — 100 % vocab, after a `drive-outlook.ps1`
  MAPI-logon + single-inspector fix), Word (partial, §11e gap), ServiceNow (rich, real
  incidents). *(Earlier "Outlook skipped — no profile" call was wrong and is corrected
  above.)*
- ✅ Vocab rates per app; coverage gap (Word) flagged.
- ✅ Grain consolidation + €-ROI invariance on real data.
- ⏭️ §6a / §6b deeper window-title issues — diagnosed with evidence, handed off (Python +
  goldens, do not rush).
- ⏭️ Full ADR-0025 in-app discovery screenshot sweep + exhaustive per-view eyeball.
