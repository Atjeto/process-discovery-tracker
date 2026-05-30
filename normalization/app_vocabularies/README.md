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

## Shipped starters (§11d)

These were bootstrapped from the committed `sessions/example-aggregate/`
order-to-cash demo and then curated. They are **starters** — the
`automation_id` values model the demo's controls and should be retuned to your
tenant/system before a real engagement:

| File | App | Scope |
|------|-----|-------|
| `salesforce.yaml` | Salesforce (web, in Chrome) | `chrome.exe` + `Salesforce -` |
| `sap-gui.yaml`    | SAP GUI (VA01 Create Sales Order) | `sapgui.exe` + `SAP -` |
| `excel.yaml`      | Microsoft Excel (desktop) | `excel.exe` + `Excel -` |
| `outlook.yaml`    | Microsoft Outlook (desktop) | `outlook.exe` |
| `chrome.yaml`     | Google Chrome **browser chrome** (address bar, tabs, nav) — complements site vocabs, names no web-app content | `chrome.exe` |

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
