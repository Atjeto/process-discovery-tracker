"""Rule-based activity classification (§7.2).

Loads a taxonomy YAML, applies app + window-title regex rules to
each activity event, and assigns `activity_label`. First match wins.
Unmatched events get a fallback `Unclassified -- <app>` label that
preserves the raw signals for analyst correction in the viewer.

Also extracts transaction identifiers from window titles where the
matching rule defines an `extract.transaction_id` regex.
"""

from __future__ import annotations

import re
from typing import Any

import yaml


def load_taxonomy(taxonomy_path: str) -> dict[str, Any]:
    with open(taxonomy_path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _compile_rules(taxonomy: dict[str, Any]) -> list[dict[str, Any]]:
    """Compile regex patterns up front so we don't pay the cost per event."""
    compiled = []
    for rule in taxonomy.get("rules", []):
        match = rule.get("match", {})
        compiled_rule = {
            "label": rule.get("label", "Unclassified"),
            "app": match.get("app"),
            "title_regex": re.compile(match["title_regex"], re.IGNORECASE)
                if match.get("title_regex") else None,
        }
        extract = rule.get("extract", {})
        if extract.get("transaction_id"):
            compiled_rule["transaction_id_regex"] = re.compile(extract["transaction_id"])
        compiled.append(compiled_rule)
    return compiled


def classify_events(
    events: list[dict[str, Any]],
    taxonomy: dict[str, Any],
) -> list[dict[str, Any]]:
    """Stamp `activity_label` and optional `transaction_id` on activity events."""
    rules = _compile_rules(taxonomy)
    out: list[dict[str, Any]] = []
    for ev in events:
        if ev.get("type") != "activity":
            out.append(ev)
            continue
        app = ev["data"].get("app", "") or ""
        title = ev["data"].get("title", "") or ""
        label = f"Unclassified -- {app}"
        transaction_id = None
        for rule in rules:
            if rule["app"] and rule["app"].lower() != app.lower():
                continue
            if rule["title_regex"] and not rule["title_regex"].search(title):
                continue
            label = rule["label"]
            tx_re = rule.get("transaction_id_regex")
            if tx_re:
                m = tx_re.search(title)
                if m:
                    transaction_id = m.group(1) if m.groups() else m.group(0)
            break
        new_ev = dict(ev)
        new_data = dict(ev["data"])
        new_data["activity_label"] = label
        if transaction_id is not None:
            new_data["transaction_id"] = transaction_id
        new_ev["data"] = new_data
        out.append(new_ev)
    return out


def collapse_adjacent(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """§7.1 step 7 -- merge adjacent activity events with the same app,
    title, activity_label, AND case_ids into single events with summed
    duration. Non-activity events are pass-through and break the run.
    """
    out: list[dict[str, Any]] = []
    for ev in events:
        if ev.get("type") != "activity":
            out.append(ev)
            continue
        if out and out[-1].get("type") == "activity":
            prev = out[-1]
            pd = prev["data"]
            cd = ev["data"]
            same = (
                pd.get("app") == cd.get("app")
                and pd.get("title") == cd.get("title")
                and pd.get("activity_label") == cd.get("activity_label")
                and (pd.get("case_ids") or []) == (cd.get("case_ids") or [])
            )
            if same:
                # Merge into previous
                merged = dict(prev)
                merged_data = dict(pd)
                merged_data["duration_ms"] = (pd.get("duration_ms") or 0) + (cd.get("duration_ms") or 0)
                merged["data"] = merged_data
                out[-1] = merged
                continue
        out.append(ev)
    return out
