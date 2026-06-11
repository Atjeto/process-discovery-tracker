# UI copy feedback — owner walk-through (collecting before Phase F chip)

Owner is walking the v1.1.0-clean app and flagging copy a business user
can't parse. Each item: where, what's wrong, what the writer *meant*
(ground truth for the rewrite), and a proposed plain rewrite. Phase F
chips against this file + the typography/jargon contract when collection
is done.

---

## 1. App Library — discovered-control checklist row — ✅ RESOLVED (Phase F)

> Applied on `lab-phase-f` exactly as proposed below (labels, tooltips,
> placeholder), plus the Verb/Object/Means tooltips in the same register.
> Pinned by `viewer/ui-copy-guard.test.js`; register rules now live in
> DESIGN-SYSTEM.md → *UI copy style guide*. This file stays as the
> collection point for future rounds.

**Where:** vocab review checklist (Phase C), per-control row: three
checkboxes `completes step` / `carries value` / `case-id source`, plus
the free-text input with placeholder *"e.g., closes intake and hands off
to billing"*.

**Problem:** labels are raw internal field names (`completion`,
`carries_value`, `case_id_source`); tooltips restate the mechanism, not
the meaning; the placeholder example is itself process-jargon. Owner:
"I do not know what the writer wanted to say here, and tooltips are even
more confusing."

**Intended meaning (ground truth):**
- `completes step` — clicking this control is a natural "done" moment
  (Save / Submit / Send). The step-splitter uses it to end a step there.
- `carries value` — the worker types data into this control. Used to
  spot the same value re-typed across different apps (re-keying).
- `case-id source` — what's typed here identifies WHICH ticket/order/
  customer the work belongs to; the case detector can use it to split
  the session into cases.
- `means` free-text — one plain sentence on what the action does in
  business terms.

**Proposed rewrite:**
- `completes step` → **"'Done' action"** — tooltip: *"Pressing this
  finishes a piece of work (like Save, Submit or Send). We use it to
  know where one step ends and the next begins."*
- `carries value` → **"Workers type data here"** — tooltip: *"This field
  holds typed information. We use it to notice when the same data is
  re-typed into several apps."*
- `case-id source` → **"Identifies the ticket/order"** — tooltip:
  *"What's typed here tells us which ticket, order or customer the work
  belongs to — it lets the app split a long recording into separate
  cases."*
- placeholder → *"What does this do, in plain words? e.g. 'sends the
  order to billing'"*

---

(next items appended as the owner reports them)
