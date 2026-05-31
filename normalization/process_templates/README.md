# Process Templates (canonical processes)

Pre-built **Process Templates** ([ADR-0002](../../docs/adr/0002-app-vocabularies.md),
§11d) — `canonical_process` definitions that map captured interactions to a known,
named step/phase set, keyed to **real probed signatures** (see
[REAL-VALUE-TESTING.md](../../docs/REAL-VALUE-TESTING.md)). They are the process-shape
counterpart to the [App Vocabularies](../app_vocabularies/) (which name individual
controls): the vocab says *what a control is*, the template says *what process the
controls belong to*.

Unlike vocabs (auto-loaded from `app_vocabularies/`), a template is applied per run:

```
viewer/python/python.exe normalization/normalize.py <session> --mine \
    --canonical normalization/process_templates/servicenow-incident.yaml
```

`match_canonical` walks interactions in time order and assigns each to the first
step whose `match` rule fires; `case_anchor` (where present) makes each repetition
(each incident / each account) its own case.

| Template | Process | Keyed on |
|----------|---------|----------|
| `servicenow-incident.yaml` | Create & Resolve Incident | ServiceNow element ids (`incident.*`, `sysverb_insert`, `resolve_incident`) |
| `servicenow-change-request.yaml` | Create Change Request (capture → assess → plan → submit) | ServiceNow `change_request.*` ids (incl. the read-only-until-typed Planning fields) + `sysverb_insert*` |
| `servicenow-catalog-request.yaml` | Submit Catalog Request | Generic catalog ids (`quantity`, `oi_add_to_cart_button`, `oi_order_now_button`) — no `case_anchor` (per-item variables are volatile) |
| `salesforce-create-account.yaml` | Create Account | Lightning field labels (aids are volatile) |
| `jira-create-issue.yaml` | Create Issue (Global Issue Create dialog) | Stable `<field>-field` aids (`summary-field`, `priority-field`); Project / Issue-type pickers via `starts_with` (volatile React suffix) |
| `zendesk-create-ticket.yaml` | Create Ticket | Accessible **names** (aids volatile); Assignee / Submit matched with `starts_with` (`Assignee*`, `Submit as <status>`) |
| `outlook-send-email.yaml` | Send Email | Outlook command ids (`4117`/`4101`/`4256`) + `_WwG` body |
| `word-mail-merge.yaml` | Mail Merge | Word `MailMerge*` idMso |

## Schema (per [canonical_match.py](../canonical_match.py))

- `id`, `name`, `version`, optional `owners`
- optional `case_anchor`: `{ field, equals|contains|starts_with|matches, case_label_from, min_case_interactions, min_case_duration_ms }`
- `phases`: `[{ phase_id, name, step_ids: [...] }]`
- `steps`: `[{ step_id, name, boundary?, match: [ rule, ... ] }]`
  - a **rule** = `{ process_name?, window_title_regex?, interaction: { <field>: <literal | {op: val}> }, end_when? }`
  - signature fields: `control_type`, `automation_id`, `name`, `value`, `class_name`, `framework_id`
  - ops: `equals`, `contains`, `starts_with`, `matches` (regex)
  - `boundary`: `group_contiguous` (default) · `single` · `until_app_change` · `until_pause` · `until_field_change` · `until_next_step`

**Scope tip:** `process_name` is matched **case-sensitively** and the recorder
reports mixed case (`EXCEL.exe`, `OUTLOOK.EXE`); prefer `window_title_regex` or a
unique `automation_id` for robust, browser/casing-agnostic matching.
