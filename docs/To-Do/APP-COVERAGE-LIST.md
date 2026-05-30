# App-coverage worklist (§11d real-value mapping)

**Status:** proposed — awaiting owner sign-off before we execute app-by-app.
**Method:** [REAL-VALUE-TESTING.md](../REAL-VALUE-TESTING.md) — probe live UIA / drive the
real recorder for true control identities; documentation-derived only where no
reachable free instance exists. **Owner validates last, after the mapping is built.**

This is the list we agreed to produce and "go down." For each app it records the
canonical processes worth templating and the **real-value access route** (tier A/B/C).
Nothing here is probed or written into a vocab until this list is approved.

## Access tiers

- **A — probe live now** from this dev box (installed desktop, or a fully public web UI). No owner action.
- **B — free instance the owner provisions once**, then Claude drives it from the dev box over the public internet. *(Owner can't run Claude on the locked-down work laptop, so this is how gated SaaS becomes reachable — a free public/dev instance, not the laptop.)*
- **C — documentation-derived only** (no reachable free instance) — derive identities from public docs, ship the vocab **flagged doc-derived**, refine when an instance opens up.

## Progress — 2026-05-30 real-value cycle

**Done (probed live, validated, committed to `master`):**
- **Tier A** — Outlook, Excel, Word, Chrome, Edge vocabs (real UIA); Excel proven end-to-end through the recorder.
- **Tier B** — ServiceNow (incident form) + Salesforce (New Account) vocabs, probed from the owner's live instances.
- **Process templates** — create/resolve incident, create account, send email, mail-merge (`../../normalization/process_templates/`).
- **§11b** — over-segmentation root-caused ([SEGMENTATION-CALIBRATION-FINDINGS.md](SEGMENTATION-CALIBRATION-FINDINGS.md)); flip gated on real-corpus + UI validation.

**Jira + Zendesk — DRAFT doc-derived skeletons committed; live probe pending (2026-05-30):**
- The live UIA probe was **not** available this pass (0 logged-in browser windows on the dev box;
  a headless agent can't reach the owner's bot-protected SaaS logins), so the §11d **fallback**
  ran: `app_vocabularies/{jira,zendesk}.yaml` + `process_templates/{jira-create-issue,
  zendesk-create-ticket}.yaml` authored from Atlassian/Zendesk docs, **flagged `⚠️ DRAFT —
  DOC-DERIVED, NOT LIVE-PROBED`**, all signatures label-keyed and `# PROBE:`-tagged where uncertain.
- Safe to ship because label signatures match on **exact equality** → a wrong guess under-matches,
  never mis-names (unlike the invented-`aid` fiction §11d removed). Inert on the golden demo corpus.
- Reusable foreground-watcher `_pdt_verify/probe_web_uia.ps1` + cheat-sheet
  [JIRA-ZENDESK-PROBE-CHEATSHEET.md](JIRA-ZENDESK-PROBE-CHEATSHEET.md). **Remaining = a ~2-min
  owner live probe per app** to confirm/replace the provisional signatures and drop the draft flag.

**Queued for the apps session (need driving / a reachable instance):**
- **Tier B** — SAP (Fiori trial). *(Jira/Zendesk: skeletons done; awaiting the live probe above.)*
- **Tier C** — Workday, Oracle, SAP-GUI, Concur — **deliberately NOT doc-derived**: without an instance the UIA ids would be guesses (the fiction we just removed).

---

## Ranked worklist

| # | Application | Surface | Domain | Tier | Real-value route |
|---|-------------|---------|--------|:----:|------------------|
| 1 | **Outlook (classic)** | Win32 desktop | Email/productivity | **A** | Installed (`Office16\OUTLOOK.EXE`) — probe now |
| 2 | **Excel** | Win32 desktop | Productivity/finance | **A** | Installed — probe now |
| 3 | **Word** | Win32 desktop | Productivity | **A** | Installed — probe now |
| 4 | **ServiceNow** | Web | IT service mgmt | **B** | Free Personal Developer Instance (PDI) |
| 5 | **Salesforce** | Web | CRM/sales | **B** | Free Developer Edition org |
| 6 | **SAP Fiori** | Web | ERP / O2C, P2P | **B** | S/4HANA Cloud trial or BTP trial |
| 7 | **SAP GUI (classic)** | Win32 desktop | ERP / O2C, P2P | **C** | Doc-derived (backend gated); GUI signatures from docs |
| 8 | **Jira** | Web | ITSM / work mgmt | **B** | Free tier (free forever, ≤10 users) |
| 9 | **Zendesk** | Web | Customer service | **B** | Free trial (signup) |
| 10 | **New Outlook / web M365** | Web (WebView2) | Email/productivity | **C\*** | M365 dev sandbox now gated; doc-derived unless owner has a VS sub |
| 11 | **Workday** | Web | HR / finance | **C** | No public free instance — doc-derived |
| 12 | **Oracle EBS / Fusion** | Web/Java | ERP / finance | **C** | Gated; doc-derived *(Oracle APEX is free but is the low-code platform, not the ERP UI)* |
| 13 | **SAP Concur / Coupa** | Web | Procure-to-pay / expense | **C** | Gated; doc-derived |
| 14 | **Chrome / Edge chrome** | Win32 desktop | Generic web shell | **A** | Installed — names browser chrome only (complements site vocabs) |

\* **C unless** the owner holds a Visual Studio Pro/Enterprise subscription, which would make the M365 E5 sandbox **B**.

## Tier A — probe live now (no owner action)

These are installed on this box; I drive the real recorder + a UIA tree walk to harvest
true signatures, then **replace** today's demo-derived placeholder vocabs.

| App | Canonical processes to template | Replaces |
|-----|----------------------------------|----------|
| **Outlook (classic)** | Send email · Reply / forward · Triage (flag / categorize / move to folder) · Send templated email · Create meeting/appointment | `outlook.yaml` (placeholder) |
| **Excel** | Open / save · Filter & sort · Pivot table · Formula / lookup entry · Find & replace · Export / save-as | `excel.yaml` (placeholder) |
| **Word** | Open / save · Find & replace · Mail merge · Export to PDF | *(none yet)* |
| **Chrome/Edge** | Address-bar navigate · Tab open/switch/close · Back/forward (browser chrome only) | `chrome.yaml` (placeholder) |

## Tier B — owner provisions a free instance, Claude drives it

All four are free and reachable from the dev box. **What I need from you per app: the
instance URL + a login.** I drive it with the recorder + `--force-renderer-accessibility`
(web apps are otherwise silent to UIA) and capture true `automation_id`s.

| App | Free instance — how to obtain | Canonical processes to template |
|-----|-------------------------------|----------------------------------|
| **ServiceNow** | Sign up at `developer.servicenow.com` → "Request Instance" (free PDI, wakes in 3–5 min; hibernates after ~10 days idle, data preserved) | Create incident · Work / update incident · Resolve incident · Close incident · Submit catalog request (RITM) · Create change request |
| **Salesforce** | Sign up at `developer.salesforce.com/signup` (free Developer Edition; 2 licenses, 5 MB data, 5k API/day — ample for UI mapping) | Create account · Create contact · Create opportunity · Log a case · Update case · Convert lead |
| **SAP Fiori** | `sap.com` S/4HANA Cloud Public Edition trial (30 days, extendable) **or** BTP trial (90 days) + BTP free tier | Manage Sales Orders (VA01-equiv) · Create Purchase Requisition · Post Incoming Invoice · Manage Outbound Deliveries |
| **Jira** *(easy win)* | Free plan at `atlassian.com` (free forever, ≤10 users) | Create issue · Transition issue (To-Do→In-Progress→Done) · Assign · Comment · Log work |
| **Zendesk** *(optional)* | Free trial signup | Create / respond to ticket · Assign · Apply macro · Solve ticket |

## Tier C — documentation-derived (no reachable free instance)

Ship vocabs **flagged `doc-derived`**, identities taken from public developer/admin/UI
docs; refine to real signatures whenever an instance later becomes reachable.

| App | Why C | Doc pointer for control identities |
|-----|-------|-------------------------------------|
| **SAP GUI (classic)** | Backend gated; the desktop GUI needs a live SAP system | SAP GUI scripting API + transaction (VA01/ME21N/MIRO/FB60) field-name docs |
| **New Outlook / web M365** | E5 dev sandbox now gated to VS subscribers | OWA/Outlook web UI docs; or promote to B if owner has a VS sub |
| **Workday** | No public/free tenant | Workday community UI docs / field references |
| **Oracle EBS / Fusion** | Gated ERP | Oracle Fusion Apps UI guides (APEX ≠ the ERP UI) |
| **Concur / Coupa** | Gated SaaS | Vendor admin/UI documentation |

## Recommended execution order

1. **Tier A first** (Outlook → Excel → Word → Chrome) — zero dependencies, replaces the
   fiction in the shipped vocabs immediately, and re-proves the probe + drive harness.
2. **ServiceNow + Salesforce** (Tier B) — highest-value SaaS, free instances stand up in
   minutes; the "open/close a ticket" and CRM families the rollout cares about.
3. **SAP** — Fiori (B) for real web values + GUI (C) doc-derived in parallel.
4. **Jira/Zendesk** (B) and the **Tier C** set as fill-in.

Each app, when done, lands: a real `normalization/app_vocabularies/<app>.yaml`, one or
more `canonical_process` templates, and (for A/B) a ground-truth capture in
`sessions/_real_suite/` feeding the §11b calibration corpus.

## What I need from you to start Tier B

Provision whichever you want first and paste me the **URL + login**:
- ServiceNow PDI — `developer.servicenow.com`
- Salesforce Developer Edition — `developer.salesforce.com/signup`
- (SAP trial / Jira / Zendesk as you choose)

Tier A I can begin the moment this list is approved — no input needed beyond "go."

---

### Sources (access-route facts, verified 2026-05-30)

- Microsoft 365 Developer Program — eligibility now restricted: [dev program](https://developer.microsoft.com/en-us/microsoft-365/dev-program), [join with Visual Studio](https://learn.microsoft.com/en-us/office/developer-program/join-with-visual-studio)
- ServiceNow PDI + hibernation: [PDI guide](https://developer.servicenow.com/print_page.do?release=xanadu&category=developer-program&identifier=personal-developer-instance-guide-introduction&module=guide), [hibernation](https://developer.servicenow.com/blog.do?p=%2Fpost%2Fhibernation-and-developer-instances%2F)
- Salesforce Developer Edition: [signup](https://developer.salesforce.com/), [allocations/limits](https://help.salesforce.com/s/articleView?id=xcloud.overview_limits_developer.htm&type=5)
- SAP trials: [S/4HANA Cloud trial](https://www.sap.com/products/erp/s4hana/trial.html), [BTP trial](https://www.sap.com/products/technology-platform/trial.html), [developer trials](https://developers.sap.com/trials-downloads..html)
- Oracle APEX free workspace: [apex.oracle.com](https://apex.oracle.com/en/learn/getting-started/), [Always Free APEX](https://docs.oracle.com/en/cloud/paas/apex/gsadd/always-free-oracle-apex-application-development.html)
