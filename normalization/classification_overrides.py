"""Analyst classification overrides (design §6.1 / §7.2).

After taxonomy classification stamps `activity_label`, the analyst may
correct a mislabelled or Unclassified activity from the viewer. The
correction is stored in annotations.json as a `classification_overrides`
entry and applied here, so it reaches every downstream surface -- CSV,
XES, the DFG and BPMN process maps, and the statistics.

Two scopes:

  instance -- one specific activity event, by `event_id`.
  rule     -- every activity event whose app + window title match a
              {app, title_regex} pattern. A rule entry also carries a
              `candidate_rule` block: the §6.1 "candidate taxonomy
              update" an owner can later promote into taxonomy.yaml.

Raw events.jsonl is never modified -- this builds a derived stream, the
same contract as apply_marker_edits.
"""

from __future__ import annotations

import re
from typing import Any


def apply_classification_overrides(
    events: list[dict[str, Any]],
    annotations: dict[str, Any],
) -> tuple[list[dict[str, Any]], int]:
    """Rewrite `activity_label` on activity events from annotations'
    `classification_overrides`. Returns (events, applied_count). An
    instance override wins over a rule override for the same event;
    among rule overrides, first match wins.
    """
    overrides = (annotations or {}).get("classification_overrides") or []
    if not overrides:
        return events, 0

    instance_label: dict[str, str] = {}        # event_id -> label
    rule_overrides: list[dict[str, Any]] = []  # [{app, title_re, label}]
    for ov in overrides:
        label = ov.get("label")
        if not label:
            continue
        scope = ov.get("scope")
        if scope == "instance":
            evid = ov.get("event_id")
            if evid:
                instance_label[evid] = label   # last write wins
        elif scope == "rule":
            match = ov.get("match") or {}
            pat = match.get("title_regex")
            try:
                title_re = re.compile(pat, re.IGNORECASE) if pat else None
            except re.error:
                # A malformed analyst-authored regex must not crash
                # normalization -- skip the override, keep going.
                continue
            rule_overrides.append({
                "app": match.get("app"),
                "title_re": title_re,
                "label": label,
            })

    if not instance_label and not rule_overrides:
        return events, 0

    applied = 0
    out: list[dict[str, Any]] = []
    for ev in events:
        if ev.get("type") != "activity":
            out.append(ev)
            continue
        data = ev.get("data") or {}
        new_label = None
        evid = ev.get("event_id")
        if evid and evid in instance_label:
            new_label = instance_label[evid]
        else:
            app = data.get("app") or ""
            title = data.get("title") or ""
            for r in rule_overrides:
                if r["app"] and r["app"].lower() != app.lower():
                    continue
                if r["title_re"] and not r["title_re"].search(title):
                    continue
                new_label = r["label"]
                break
        if new_label is None or new_label == data.get("activity_label"):
            out.append(ev)
            continue
        new_ev = dict(ev)
        new_data = dict(data)
        new_data["activity_label"] = new_label
        new_ev["data"] = new_data
        out.append(new_ev)
        applied += 1
    return out, applied
