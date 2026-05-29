# PDT — Master Assessment: Strategy, Market, Product & Technical Roadmap

**Prepared:** 2026-05-29
**What this is:** A single consolidated document folding the full session's analysis into one coherent reference — strategy, market positioning, competitive reality, enterprise readiness, product and usability review, business models, the Discovery Sprint offer, the cloud/deployment strategy, the technical roadmap, blind spots, and next steps. It reflects the corrections made during the session (the IP-ownership concern was withdrawn; the cloud position was revised; synthetic data was reframed as an accelerant, not a data source).
**Companion:** `PDT-CLAUDE-CODE-IMPLEMENTATION-SPEC.md` holds the implementation-level workstreams and acceptance criteria for an AI coding agent; this document is the strategic + technical reference behind it.

---

## 1. The verdict (read this first)

**PDT is real — but as one specific thing, and a dead end as another.** As a generic, multi-tenant SaaS product you license and scale against UiPath/Celonis, it is mostly a dead end: you cannot meter an air-gapped tool, the mining layer is open-source (no moat there), the platform market is moving away from on-prem, and AI is coming for the manual-curation value. As a **privacy-first, vertically-focused, services-led specialist practice with proprietary tooling** — selling documented processes and automation business cases as outcomes, with the tool as a margin-and-speed weapon — it is genuinely real and defensible: a high-margin boutique with optional larger upside via BYOC, OEM, or open-core. Not a fart; not a rocket. A protected niche with captive, underserved, high-value buyers.

Ownership is clean (solo owner, full commercialization rights) — the precondition most solo-founder situations fail, and it clears. The single most important strategic move is to stop asking "how do I make this a product" and start asking "which captive, regulated buyer can't use anyone else, and what bounded outcome will they pay €30–80k for?"

---

## 2. What PDT is, and where it stands today

**What it is.** An internal-grade Windows task-/process-discovery tool: a UI-Automation recorder (structured events, not screenshots) plus optional local OBS video on the worker's PC, feeding a bundled-Python (PM4Py) normalization pipeline and an Electron viewer on the analyst's PC. Output: BPMN/DFG process maps, step/phase breakdowns, statistics, an HTML findings report, and a Word PDD. Deliberately air-gapped — no network egress, no telemetry, no installer, no admin.

**Maturity, read honestly.** Early but disciplined: ~0.1→0.19 in roughly two weeks of intense solo iteration, with unusually strong hygiene for the stage (ADRs, semantic versioning, a maintained changelog, a non-destructive immutable-events data model, and a genuinely thorough security threat model). That security/architecture hygiene is the strongest asset and is well ahead of where most tools this young sit.

**The core unsolved problem (self-diagnosed).** The value chain captures and exports well but **leaks meaning in the middle** — classification, segmentation, annotation, deliverable. The headline failure is the 308-step ATM session (one recording shattered into ~308 unusable atomic steps, a collapsed map). The intra-session alignment work (anchor-based case detection + "curate one, apply to all") is the right fix, is built and harness-verified, but is **calibration-blocked on real data** — the central product risk (addressed in §11).

**Accepted blind spots (correct, not bugs):** Citrix/RDP is invisible to UIA (video covers it), custom grids like AG-Grid are identityless (though typed values are recoverable — see §11), and the heuristics need a calibration loop.

---

## 3. Market positioning & competitive reality

**The category, precisely.** PDT is **task mining / process discovery**, not process mining. Process mining analyzes system event logs at ERP/CRM scale (Celonis, SAP Signavio); task mining captures how a person performs a task at the desktop. PDT's true peers are the task-mining and RPA-discovery tools, with PM4Py giving it a light process-mining tail.

**Four grounded findings that decide whether this is a business:**

1. **The niche is real, underserved at PDT's end, and protected by a receding tide.** The platform market is consolidating toward cloud — Celonis is deprecating its on-prem extractor by end of 2026; IBM is the heavyweight regulated/data-residency play. At the small/mid, desktop-task, fully air-gapped, affordable end, the giants won't bother and the cloud-native challengers structurally can't go. That is PDT's white space. It is a *protected* market, not a growing one — good for a boutique, bad for a product chasing a wave.

2. **Open-source tells you where your moat isn't.** PM4Py (which PDT uses), ProM, Apromore, and bupaR solve *mining* (event log → map) for free. None solve *air-gapped desktop capture + curation + a client-ready deliverable*. **The UIA recorder is the crown jewel; the BPMN/DFG matrix is the commodity.** Do not anchor PDT's identity on process maps.

3. **The services money is large and proven.** Standalone process-discovery consulting bills ~€18–90k+ per engagement (discovery a 2–4 week phase); full RPA engagements run €50–300k+, of which licensing is only ~25–30% — the rest is services and discovery. "RPA Discovery Assessment" already sells as a productized fixed-price service. A solo operator doing 4–8 discovery sprints/year at €30–80k each, tool-accelerated, is a real business now.

4. **AI makes PDT more defensible, not less.** Agentic-AI process discovery is demonstrably feasible but degrades sharply on complex setups — and every approach is cloud-dependent. You cannot send classified or works-council-protected recordings to a cloud model, so AI eating the generic market makes the air-gapped segment *harder* for AI-natives to enter. Lean into AI assistance, kept local (the Copilot/video bridge is exactly right). Window to establish the position: ~18–36 months.

**Positioning to own:** *"Process discovery for work that can't leave the building."* Privacy-first, air-gapped, open-format, AI-assisted *locally* — for the regulated, classified, sovereign, and works-council environments the cloud platforms structurally can't serve. Lead with the moat (nothing leaves the building; you own the open-format output; AI-assisted but not cloud-dependent), not the maps. Never position as "a cheaper UiPath" or "a Celonis alternative."

---

## 4. The UiPath comparison (technical)

PDT is **architecturally opposite** to UiPath Task Mining on the two axes that matter, and that opposition is the wedge.

| Dimension | UiPath Task Mining | PDT |
|---|---|---|
| Capture primitive | Screenshot of the active window per click/keystroke + metadata | Structured UIA event; no screenshot in the stream; OBS video optional & local |
| Element/text identity | Derived from screenshots; OCR extracts on-screen text | Read directly from UIA properties (AutomationId, ControlType, Name, window title, edit values) |
| Processing locus | Cloud (Automation Cloud); local raw data deleted after upload | Local / air-gapped; nothing transmitted |
| Core IP | ML clustering of screenshots + OCR PII masking | Heuristic + analyst-curated normalization (PM4Py); structural identity |
| Scale model | Fleet, unassisted, multi-user auto-merge | Single-analyst, curated (today) |
| Privacy posture | Screenshots → encrypted cloud → OCR masking (misses PII if OCR fails) | No screenshots leave the device; structured-only; works-council-friendly |
| Ecosystem | Locked to UiPath Automation Cloud/Studio | Standalone; open formats (XES/BPMN/CSV) |

UiPath is the more mature *automated* product (fleet-scale, AI clustering, multi-user merge). But its entire model rests on sending screenshots of employee work to its cloud and OCR-ing them — exactly what PDT's target buyers cannot accept. PDT's structured, on-device architecture is the feature they're buying, and it is a *better substrate* for several of UiPath's own techniques (see §11 borrows).

---

## 5. Enterprise-readiness checklist

"Enterprise grade" for a desktop-capture tool is ~80% the security/procurement/operability gauntlet, ~20% features. Ordered by what actually blocks deployment. Legend: ✅ done · 🟡 partial · ❌ missing · ⛔ blocker for selling outside the originating org.

**A. Trust on the machine**
- ⛔ EV code-signing of all binaries — ❌ (unsigned; SmartScreen/AV warnings on every fresh machine; non-negotiable #1)
- ⛔ AV/EDR allow-listing validated on a managed fleet — 🟡 (shape chosen for AV compatibility; never validated)
- Packaged-app smoke test on the actual locked-down deployment laptop — ❌
- MDM/Intune/SCCM deployment package — ❌
- Documented uninstall / data-removal — 🟡

**B. Security & compliance assurance**
- Self-authored threat model — ✅ (strong; best asset here)
- Third-party penetration test — ❌
- Standard questionnaire pack (SIG-Lite / CAIQ) — ❌
- DPIA / privacy impact assessment (employee-monitoring) — ❌ (critical in the EU — see §13)
- DPA + retention policy template — 🟡
- Clean runtime dependency audit — ✅

**C. Reliability & maintainability**
- ⛔ CI that gates merge (units + e2e) — 🟡 (pytest exists; e2e harness outside the repo, gates nothing — addressed in §11/WS1)
- Recorder (C#) automated tests — ❌ (addressed by WS1)
- Bus-factor > 1 / build-from-clean — 🟡 (solo velocity; see §13)
- Crash/degradation observability for support — 🟡
- Versioned schema + migration — ✅

**D. The core capability**
- ⛔ Segmentation proven on real multi-app variance — 🟡 (built, calibration-blocked; biggest product risk)
- Out-of-box classification for a new deployment — 🟡
- €-quantified ROI findings — ❌ (the sale-closer; still missing)
- Living-projection deliverable — ❌

**Scorecard:** as an internal tool for one org, ~80% there (sign binaries, smoke-test the real laptop, calibrate on one engagement). As a product sellable to other enterprises, ~35% there.

---

## 6. Product review & feature value mapping

The critical lens: **engineering difficulty and customer value are nearly inversely correlated here.** The hardest, cleverest work is the least differentiating and least proven; the "boring" parts are where the money is.

| Capability | Customer value | Differentiation | Proven | Effort sunk | Read |
|---|---|---|---|---|---|
| Air-gapped / zero-egress capture | High | High | High | Low–Med | The real moat; underexploited in positioning |
| Structured UIA capture (no screenshots) | High | High | High | Med | The privacy story; lead with it |
| PDD + findings deliverable | High | Med | Med | Med | *The product* to a buyer; needs the ROI mile |
| Open-format exports (XES/BPMN/CSV) | Med–High | High (anti-lock-in) | High | Low | Wedge vs incumbent lock-in |
| OBS video + timestamp bridge | Med | Med–High | High | Med | Covers UIA blind spots |
| Analyst curation loop | Med | Low | Med | High | Necessary, but market may reframe as *cost* |
| Intra-session alignment | High *if proven* | Med | Low ⛔ | Very High | Crown jewel that isn't validated; risk concentrated here |
| Process-mining map matrix | Med | Low | Med | High | Impressive; incumbents do richer at scale — don't compete here |
| App Vocabularies / Libraries | Med | Med | Med | Med | Quietly your best services hook; compounds per vertical |
| Heuristic analysis (waste/automation) | High *if €-quantified* | Med | Low | Med | One step from valuable; currently descriptive |
| State/anchor candidate detection | Med | Med | Med | Med | Pragmatic cold-start fix |

Implications: stop treating the algorithmic frontier (alignment calibration, mining matrix) as a *precondition* to going to market; the sellable core (air-gap + structured capture + a fast credible deliverable) is mature *enough* for a paid engagement in the short/single-process regime now; and the **recorder is the moat** — don't spend cycles hardening the commodity maps.

---

## 7. Usability review

The analyst's path to a clean deliverable is the weak surface, and it's self-diagnosed in the coherence audit: verbs without inverses, encodings without legends, controls without IA.

Ranked by impact on time-to-deliverable:
1. **Over-segmentation + weak repair** — the biggest usability tax (the 308-step day). Alignment is the cure if it works; until then the short regime is where usability is acceptable.
2. **First-run emptiness** — a new deployment opens near-blank (taxonomy mismatch) with no signpost; the "label your apps" prompt is the fix (and §11/WS8 makes the first run produce value with zero config).
3. **No comprehension affordances by default** (legends, repeat badges) — cheap to fix, disproportionately damaging.
4. **Silent deployment failures** (e.g. Windows MAX_PATH on deep PM4Py paths) — a credibility killer in the first five minutes.
5. **No worker-end "did I do this right?" feedback** — manageable in a services model where you coach; a problem for self-serve.

Strengths to preserve: non-destructive everything (raw immutable, sidecar annotations, re-norm preserves curation, undo/redo) — trust *is* usability; the video-synced timeline; the Live Session window.

**Verdict:** usable by an expert (you, in a services context); not yet usable by an untrained analyst at arm's length — which again points to services-led, not shrink-wrapped product.

---

## 8. Adoption priorities

Your earlier 10-point product-gap list is good and sorts cleanly. Adoption is won by *removing required expertise and setup*, not by adding scale infrastructure first.

**Tier 1 — build now (friction/expertise removers; help services *and* product):**
- **Automated insight layer** ("here's what we found", rule-based) — highest leverage-to-effort; also the ROI deliverable.
- **Consent/privacy as a visible feature** — #1 objection-killer and sharpest differentiator; EU door-opener.
- **Zero-config first session** (record → stop → result, <5 min) — the flywheel; powered by pre-built vocabs (§11/WS4, WS8).

**Tier 2 — the BYOC/product stage (infrastructure for scale; fund from services revenue):**
- **Backend / server** — substrate for multi-user; build BYOC/customer-VPC-deployable, not multi-tenant-SaaS-first.
- **Web viewer** — table-stakes for product distribution; architecture supports the port.
- **Multi-user / collaboration** — accounts, workspaces, and (key for adoption) manager read-only visibility without installing.

**Tier 3 — settle, decide, or message:**
- **Windows-only** — correct call for v1; be explicit.
- **Pricing/value metric** — per "discovery project" or per capture-seat, viewer/analysis unlimited; metering only enforceable at the backend/BYOC stage.
- **Competitive positioning** — messaging, per §3.

---

## 9. Business plan & models

**The three you named, compared:**
- **Consulting** — sell expertise by the day/engagement; tool incidental. Revenue now, no productization cost, generates calibration data; doesn't scale past your hours; not a sellable asset. Readiness needed: low.
- **Feature-segmentation (tiered product)** — license editions. Scalable in theory; but unenforceable (no telemetry), un-moated (open-source mining), against the market tide, and against the AI curve. Readiness needed: very high; 12–18+ months and a team. **The hardest, riskiest path for this architecture as an opening move.**
- **Professional services / done-for-you** — sell the outcome; you run capture, build the client's App Vocabulary/Library, annotate, map, hand over PDD + findings + open artifacts. Plays to every strength, hides every weakness, generates calibration data legitimately, and the vocab/library IP compounds. Readiness needed: low–medium. **The smart opening.**

**Additional models proposed (ranked by fit):**

*Tier 1 — do these:*
- **M1. Productized "Discovery Sprint"** (fixed-scope service product) — see §10. Sharpest near-term model.
- **M2. Pre-migration "as-is" discovery** — bounded project tied to ERP/core-system replacement; a top industry use case; regulated migrations often can't use cloud capture.

*Tier 2 — build toward:*
- **M3. Compliance / audit-evidence tooling** — reposition immutable-events + air-gap + video as controls attestation ("timestamps + structured capture prove a step executed"). Recurring; different, often bigger budget (Risk/Audit).
- **M4. OEM / white-label the capture engine** — license the UIA recorder + normalization as an on-prem capture component to SIs/RPA shops who can't use cloud CV tools. Leverages the one true moat.

*Tier 3 — optional/later:*
- **M5. Privacy-first, on-prem AI-assisted discovery** — the Copilot/video bridge against a *local* model. The model that survives the AI wave; likely the real product in 2–3 years.
- **M6. Open-core** — open-source capture+normalization to become the privacy-first standard; monetize enterprise viewer + support + services. Neutralizes the open-source-substitute threat.
- **M7. Train-and-equip internal CoE teams** — license tool + methodology + training to a large regulated org's internal team; lands-and-expands, sidesteps self-serve usability.

*Don't do:* generic per-seat multi-tenant SaaS as the opening move — unenforceable, un-moated, against the tide and the AI curve.

**Recommended sequence:** services-led (M1/M2) now → harden the *accelerator* (ROI layer, vocab/library, living-projection) at 6–18 months → conditional BYOC product / bigger bets (M3–M6) only after the core is proven and there's self-serve demand. It is entirely legitimate to run a high-margin boutique and never do the product stage.

---

## 10. The Discovery Sprint offer

**Promise:** *"In three weeks, we'll show you exactly how this process actually runs, where the time and money go, and what to automate first — with a business case your CFO will sign — and your data never leaves the building."*

**Who for:** ops/shared-services/back-office leaders in regulated or data-sensitive orgs; stalled RPA programs lacking documented processes; teams facing an ERP/core-system migration. Qualifying question: *"Is this a process where the data or employee activity can't go to a third-party cloud?"* — if yes, you may be the only credible vendor.

**Engagement flow:** scope & consent → capture (light touch; you coach, they work) → build the client's App Vocabulary/Library (reusable asset you keep) → curate/annotate/map → quantify (the ROI analysis) → handover & readout.

**Tiers (EUR anchors; price on value, not days):**

| Tier | Scope | Duration | Indicative price | Purpose |
|---|---|---|---|---|
| Pilot / Proof | 1 process, 1 SME | ~1 week | €6–12k | Land the logo; harvest first calibration data |
| Standard Sprint | 3–5 processes | 2–3 weeks | €18–38k | Bread-and-butter; full business case |
| Department Deep-Dive | 5–8 processes / a sub-function | 3–4 weeks | €40–80k+ | Anchor engagement; sets up the automation roadmap |

**Recurring/add-on lines:** maintained App Vocabulary/Library (€3–10k/yr, near-pure margin); re-discovery retainer; automation business-case refresh. **Explicitly out of scope** (sell separately): building the automations, change management, production monitoring.

**The €-ROI methodology (the close).** Your structural edge: you **measure observed time and real frequency from the recording** — you don't estimate them. Per candidate step: `gross = V × T_saved × C` where `T_saved = T_manual × automatable_fraction × realism_factor`; `net = gross − amortized automation cost`; `payback = automation_cost ÷ monthly_net`. Present a conservative/expected/optimistic band, lead with conservative, and tie every € to a specific observed step (traceable to a video frame). Always attach qualitative value (error/rework reduction, compliance evidence, capacity release, cycle-time). Division of inputs is itself a selling point: you supply observed time/frequency/feasibility; the client supplies only volume confirmation and loaded cost.

**What to build to sell it:** the consent/DPIA kit; the ROI model as a reusable template; a 2-page one-pager + an anonymized sample deliverable; signed binaries (prerequisite to the capture-install step).

---

## 11. Technical roadmap

(Implementation-level workstreams with acceptance criteria are in the Claude Code spec; this is the rationale and architecture.)

**Core principles.** Capture is always local and privacy-preserving (structured UIA, no screenshots leaving the device — the moat, identical across all deployment modes); processing/storage/collaboration is a *pluggable* deployment choice; non-destructive immutable events with sidecar curation; **graceful, honest degradation** over universal capture; **real data, not synthetic**; **human captures remain essential**.

**11a. Test-suite-driven real-data harness + three-tier calibration + e2e CI (the primary investment).** Extend the developer test suites to launch real apps and drive them with automated scripts while the *actual recorder* captures the real UIA stream — producing ground-truth-labeled real data on demand. The data is real (real app, real UIA, real values); only the actor is automated. This single investment solves four problems: it generates the calibration data the alignment work is blocked on; it is the missing merge-gating e2e regression (diff produced maps against expected) that closes the "UI bug invisible to green unit tests" failure mode; it gives the untested recorder coverage; and it auto-labels vocab/template data with ground truth.
- **Three tiers:** *narrow/controlled* (one scripted workflow, exact ground truth — calibrates mechanics deterministically and gates CI) → *bounded-variance* (parameterized scripts injecting *known* variations, testing robustness one kind at a time) → *wide* (real human captures; exploratory; the source of new controlled cases).
- **Feedback loop:** distill each wide-capture failure into a controlled case with known expected output.
- **Overfitting caution:** keep the controlled set *representative* of field variance on the dimensions that actually vary — not the convenient happy path.

**11b. Segmentation / intra-session alignment calibration.** Using the controlled + bounded corpus, calibrate each mechanic against ground truth (keystroke coalescing, anchor detection, case boundaries, step segmentation, canonical matching incl. `contains`/`starts_with`/`matches` and span-based boundaries, repetition/alignment). Resolve the 308-step failure class on the controlled corpus, then validate on real captures. This is what unblocks the stuck calibration — you can start now instead of waiting for real data.

**11c. Automated insight + €-ROI layer.** Turn existing variant/rework/timing stats into a rule-based findings summary and the €-quantified business case of §10. No ML needed. Highest adoption leverage and the Discovery Sprint close.

**11d. App Vocabulary generation (real data; LLM-assisted, not synthetic-data).** Primary source: the WS1 harness's real, ground-truth-labeled captures (web via Playwright, native via a UIA-tree walker). An LLM assists *labeling* and *authoring the test scripts faster* (reading app docs) — it does not fabricate data. Key vocabularies on the properties the recorder reports (ControlType + Name + nearby-text + window-title; AutomationId where stable), never CSS selectors; run a mandatory predicted-vs-actual diff against real recorder output for any docs/DOM-derived vocabulary. Add **structured state-clustering** (cluster element signatures to discover recurring screens unsupervised — the UiPath idea, done better on structured data). Emit into existing schemas; ship pre-built vocabs for common apps to enable the zero-config first run.

**11e. Desktop coverage hardening.** Coverage is framework-bound: WPF/WinForms/UWP/modern-Win32/Electron reliable; Java needs the Java Access Bridge enabled; Qt needs its a11y plugin; custom grids, legacy Win32, terminals, and Citrix/RDP are the gaps (custom controls expose nothing to UIA unless the app implements a provider). Build: framework detection + per-framework extraction; a layered identity ladder (AutomationId → ControlType+Name+ancestry → local-region OCR); a value-recovery layer generalizing the AG-Grid fix (edit element / UIA Value pattern / keystroke coalescing / clipboard); per-element capture-confidence flags; the run-the-recorder-inside-the-Citrix-session deployment rule; and the local video backstop wherever both structured capture and value recovery fail. Target: graceful honest degradation, all on-device — not 100% structured capture.

**11f. UiPath borrows (analysis layer, not the camera).** Cross-recording trace merge (record several SMEs of the same process → one canonical map + variant overlay — highest-value borrow for the Discovery Sprint; builds on the alignment machinery); automation-candidate ranking (frequency × observed-time × automatable-fraction → feeds the ROI layer); structural PII masking (redact by UIA field — better than OCR; powers the consent UX); the consent + capture-prep UX pattern. Borrow local-region OCR *only* surgically, on-device, as a last resort. Never borrow the screenshot-to-cloud capture model.

---

## 12. Blind spots

(The IP-ownership concern raised earlier is **withdrawn** — clean sole ownership, a positive. The cloud concern is **revised** — see §13's spectrum.)

1. **The air-gapped architecture is simultaneously the moat and the monetization ceiling** — no network = no telemetry = no usage metering = no SaaS upsell. Fine for services; fatal for venture-scale product. Decide which game consciously; the deployment-flexibility path (§13) is how you uncap it without losing the moat.
2. **You're proving the tool on the hardest possible case** (a 1h33m six-app session). Task mining struggles most on long, multi-app work. Sell where it already works (short/single-process); mature the hard case with paid data.
3. **Your security doc is a sales asset filed as an engineering doc.** "We never transmit a screenshot, never touch your network, and hand you open-format artifacts you own" belongs at the top of the pitch.
4. **"Manual curation" is a feature to you and a cost to the buyer.** Reframe the human as judgment/defensibility; make the local AI bridge the acceleration story before the curation narrative dates.
5. **EU employee-monitoring law is a deal-maker and a deal-breaker.** Your consent-based, on-device, no-image design is a strong answer — but only once it's an artifact (DPIA/consent kit), not a sentence.
6. **There is no €-denominated business case in the output — and that's what closes sales.** Probably the highest-ROI build; still missing (§10/§11c).
7. **Bus-factor of one is enterprise-disqualifying, and velocity disguises it.** Survivable for services; a hard blocker for a product sold to enterprises (WS1 begins to address the test/CI side).
8. **You can't enforce a license you can't meter** — design pricing around engagements/per-site/BYOC, not per-seat SaaS.
9. **The deliverable, not the tool, is the product.** Price the deliverable; the tool is the margin lever.
10. **First-touch failures will sink pilots** (unsigned-binary warnings, empty first run, silent MAX_PATH). Fix the first-ten-minutes path before any unattended prospect use.
11. **Your crown-jewel capability (alignment) is unproven and is where most effort went.** "It's built" ≠ "it works." De-risk with real-data engagements before betting positioning on it.

**Additional reframes:** the receding on-prem tide is your *friend* (stranded, captive buyers) — plan a boutique, not a rocket; the moat is the *recorder*, so don't polish the commodity maps; discovery is a *purchasable line item* (€20–100k), your fastest revenue and calibration pipeline; AI raises both the floor and the ceiling of your moat (commoditizes generic recording-to-doc, but can't follow you on-prem); you have an ~18–36 month window with a solo bus-factor inside it.

---

## 13. Cloud / deployment strategy

**Correction:** "cloud" was conflated with "generic multi-tenant SaaS." Those aren't the same, and most of the spectrum isn't the trap. The objection holds only for launching an undifferentiated multi-tenant SaaS into the mainstream now.

**The deployment spectrum is your tiering strategy:**

| Model | Data lives | Managed by | Best-fit buyer |
|---|---|---|---|
| Multi-tenant SaaS | Vendor cloud, shared | Vendor | Mainstream/SMB (contested, low-moat) |
| **BYOC (customer VPC)** | Customer's own cloud | Vendor | **Regulated-but-cloud-OK — the growth tier** |
| On-premise | Customer servers | Customer/assisted | Data-sovereignty mandates |
| Air-gapped | Fully isolated | Customer | Defense/classified/ITAR/SCIF (premium halo) |

**The key insight:** BYOC is the model gaining the most traction in regulated industries in 2026 — vendor manages the application layer, data never leaves the customer's VPC. GDPR fines exceeded €3B in H1 2025; data residency is board-level; deployment-flexible products (one product, SaaS-style UI + on-prem/BYOC storage) are an established pattern. This *softens* the receding-tide pessimism: the tide is going to data-residency-controlled cloud, exactly where a privacy-first capture tool with deployment flexibility wins.

**Architecture principle:** capture always local and privacy-preserving (the constant); storage/processing/collaboration a deployment *choice* (the variable). **Staged:** services-led on-prem now (architect capture to emit to a pluggable backend so the option stays cheap) → **BYOC/customer-VPC** as the first cloud step and the real growth tier, once the core is proven and funds it → air-gapped as the premium halo nobody cloud-native can match → multi-tenant SaaS only if you deliberately chase the mainstream with help.

**What cloud/BYOC unlocks:** multi-analyst collaboration + central repository, continuous monitoring (recurring revenue), fleet capture, an enforceable meter, easier (local-VPC) AI acceleration, the larger "regulated but cloud-OK" market, and a scalable asset. **What it costs:** a real backend, the bigger security/compliance gauntlet (SOC 2, internet-facing surface, SLAs), and substantial new build against an unproven core — the point where solo stops being viable. **Bottom line:** cloud is how you uncap the ceiling, done as deployment flexibility with local capture as the constant — not as the opening move.

---

## 14. Next steps (ordered)

**Sprint 1 — make it real for one paying engagement (0–6 weeks):**
1. EV code-sign all binaries; smoke-test the packaged app on the actual locked-down laptop.
2. Fix the first-ten-minutes path (signing, first-run "label your apps", MAX_PATH-safe packaging).
3. Verify the coherence pass (split/merge symmetry, legends, IA) landed and holds.
4. Package the privacy/air-gap posture as a one-page commercial differentiator + a starter DPIA/consent kit.
5. Stand up the **test-suite real-data harness + e2e CI gate** (§11a) — the foundation that unblocks everything.

**Sprint 2 — land services revenue + harvest calibration data (6–16 weeks):**
6. Sell 1–3 fixed-price Discovery Sprints (short regime; regulated/air-gap-sensitive client).
7. Build the repeatable engagement playbook (capture → vocab/library → annotate → map → PDD + findings).
8. Calibrate alignment on controlled data, then validate on the engagements' real captures (§11b).

**Sprint 3 — harden the services engine (3–6 months):**
9. Build the €-ROI layer (§11c) — highest-leverage.
10. Build the App Vocabulary generation pipeline (§11d) and desktop coverage hardening (§11e).
11. Add the UiPath borrows (§11f), the consent UX, and the zero-config first run.
12. Define + build the living-projection deliverable.

**Decision gate (6+ months):** pursue the BYOC product stage (backend, web viewer, multi-user) only after the core is proven and there's self-serve demand — committing to the full readiness gauntlet and a team. Running a high-margin boutique instead is a legitimate end state.

---

## 15. Bottom line

This is a real, defensible, high-margin specialist business — not a fart, not a unicorn — provided it's pursued as privacy-first, services-led, vertically focused discovery, with the tool as the weapon. The architecture already voted for that game; the research confirms it's a court the giants have left and the AI-natives can't enter. Lead with services and the privacy moat, let the engagements prove and fund the product, build the €-ROI layer because it's what closes deals, prove the recorder (your only real moat) with real data via the test harness, and keep the bigger bets — BYOC, OEM, compliance-evidence, local-AI, open-core — as options you earn into rather than the opening move.
