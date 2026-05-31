# App Vocabularies

Pre-built **App Vocabularies** ([ADR-0002](../../docs/adr/0002-app-vocabularies.md))
that name raw UIA interactions in plain English during normalization. Every
`*.yaml` in this folder is loaded automatically (`app_vocab.load_vocabularies`);
a malformed file is skipped, never fatal.

A vocabulary matches an interaction by **scope** (process name + window-title
regex) and then by the most-specific **signature** (`control_type` +
`automation_id` + `name`, optionally a `window_title_regex`). Matches add
`meaningful_name`, `screen_id`, and `vocab_flags` to the event — they are
**signatures on UIA properties, never CSS selectors**.

## Shipped vocabularies (§11d)

Most of these are **real-value mappings** — their signatures were probed live from
the running app's UI-Automation tree and cross-checked against vendor docs (see
[REAL-VALUE-TESTING.md](../../docs/REAL-VALUE-TESTING.md)), so they enrich as
shipped. Each app family keys its signatures on whatever is **stable** in that app's
UIA tree (the *Keyed on* column): desktop Office exposes language-independent Office
`idMso` automation_ids; ServiceNow and Jira expose stable semantic element ids;
Salesforce and Zendesk auto-generate volatile ids, so those key on the accessible
**name** (the field label); the Chromium browser-chrome vocabs key on the control's
`class_name`. The one exception is `sap-gui.yaml` — still a demo-bootstrapped
**starter** whose `automation_id` values model the `sessions/example-aggregate/`
order-to-cash demo and should be retuned to your system before a real engagement.

| File | App / coverage | Scope | Keyed on |
|------|----------------|-------|----------|
| `excel.yaml`      | Microsoft Excel (desktop) | `excel.exe`, title `… - Excel` | Office `idMso` aids (`FileSave`, `Filter`, `SortDialog`) |
| `outlook.yaml`    | Microsoft Outlook (classic desktop) — compose + explorer | `outlook.exe` | Classic command-ids (`To`=4117, `Subject`=4101, `Send`=4256) + compose-ribbon `idMso` aids |
| `word.yaml`       | Microsoft Word (desktop) — Save, Find & Replace, Mail Merge, Envelopes/Labels | `winword.exe`, title `… - Word` | Office `idMso` aids (the `MailMerge*` family) |
| `sap-gui.yaml`    | SAP GUI (VA01 Create Sales Order) — **demo starter, retune first** | `sapgui.exe`, title `SAP -…` | `control_type` + `automation_id` + `name` (demo controls) |
| `chrome.yaml`     | Google Chrome **browser chrome** (address bar, tabs, nav) — names no web-app content | `chrome.exe` | Stable `class_name` + `control_type` (`OmniboxViewViews`); Chromium aids are volatile view-ids |
| `edge.yaml`       | Microsoft Edge **browser chrome** (address bar, tabs, nav) | `msedge.exe` | Stable `class_name` + `control_type` (+ `name` to split Back/Forward) |
| `salesforce.yaml` | Salesforce (Lightning) — New Account form | title `Salesforce` (any browser) | Accessible **name** / field label (Lightning aids are volatile) |
| `servicenow.yaml` | ServiceNow (ITSM) v2 — Incident, Change Request, Catalog item / REQ, + generic platform layer | title `ServiceNow` (any browser) | Stable element ids as `automation_id` (`incident.*`, `change_request.*`, `sc_request.*`, `sysverb_*`); list/nav controls fall back to `name` |
| `jira.yaml`       | Jira (Cloud) — Create-issue (GIC), issue detail, list | title `Jira` (any browser) | Stable `<field>-field` aids; controls without a stable aid key on `name` |
| `zendesk.yaml`    | Zendesk (Support / Agent Workspace) — ticket, views, search, customers/orgs | title `Zendesk` (any browser) | Accessible **name** (every aid is auto-generated and per-load volatile) |

## Author your own

1. Capture a session of the target app.
2. Bootstrap a starter (signatures with empty names + `seen_count` hints):

   ```
   python normalize.py <session_folder> --bootstrap-vocab-out myapp.yaml \
       --vocab-id myapp --vocab-name "My App"
   ```

3. Fill in each `name:` with a plain-English action, group controls into
   `screens`, drop the `seen_count` comments, and set `flags` (`waste`,
   `automation_candidate`, `exception_path`) where useful.
4. Drop the file here and re-normalize — `stats.json.meta` reports
   `app_vocabulary_matches` and per-app `vocab_coverage`.

Or edit any of these as a form in the viewer's **App Library** tab.
