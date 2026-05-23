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
from collections import Counter
from datetime import datetime
from typing import Any

import yaml

from recognition import recognize


def load_taxonomy(taxonomy_path: str) -> dict[str, Any]:
    with open(taxonomy_path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def upsert_taxonomy_rules(taxonomy_path: str, rules: list[dict[str, Any]]) -> int:
    """Promote analyst rules into the SHARED taxonomy YAML so they classify
    every future session team-wide -- the direct-write companion to the
    viewer's hand-merged "promote to taxonomy" export. Loads the file, appends
    each rule not already present (matched by label + app + title_regex), and
    writes it back, preserving the file's other keys. Returns the count added;
    a missing file is created with a `rules:` list. Each rule is
    `{label, match: {app?, title_regex?}}`."""
    try:
        doc = load_taxonomy(taxonomy_path)
    except FileNotFoundError:
        doc = {}
    rules_list = doc.get("rules") or []

    def _key(r: dict[str, Any]) -> tuple:
        m = r.get("match") or {}
        return (r.get("label"), m.get("app"), m.get("title_regex"))

    present = {_key(r) for r in rules_list}
    added = 0
    for r in rules or []:
        if not r.get("label"):
            continue
        k = _key(r)
        if k in present:
            continue
        rules_list.append({"label": r["label"], "match": dict(r.get("match") or {})})
        present.add(k)
        added += 1
    doc["rules"] = rules_list
    with open(taxonomy_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(doc, f, sort_keys=False, allow_unicode=True)
    return added


# ADR-0011 follow-up 3: when the window-title taxonomy does not match an
# activity, lead with FRAMEWORK RECOGNITION of the interactions inside that
# activity's window. The dominant semantic category becomes a real label
# ("Form entry -- chrome.exe") instead of the useless "Unclassified -- app" --
# so the map/lane shows meaningful activity even with zero taxonomy. The
# taxonomy still owns BUSINESS labels (it wins; this is fallback only). Generic
# categories (a bare button "action", browser chrome, "unknown") are
# deliberately excluded -- they carry no activity meaning on their own.
_CATEGORY_ACTIVITY_PHRASE = {
    "form_field": "Form entry",
    "text_entry": "Text entry",
    "grid_cell": "Data grid",
    "rich_text": "Rich text",
    "comment": "Comments",
    "search": "Search",
    "primary_action": "Form submit",
    "selection": "Selection",
    "toggle": "Toggles",
    "tab_nav": "Tab navigation",
    "tree_nav": "Tree navigation",
}


def _ts_ms(s: str) -> float | None:
    """Parse an ISO-8601 timestamp to epoch milliseconds, or None when absent
    or malformed (e.g. the timestamp-less events some unit tests build)."""
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s).timestamp() * 1000
    except (ValueError, TypeError):
        return None


def _recognition_activity_label(
    activity_ev: dict[str, Any],
    recognised: list[tuple[float | None, str]],
    app: str,
) -> str | None:
    """A semantic activity label from the dominant recognised category among
    the interactions inside this activity's [start, start+duration) window, or
    None when there is no usable signal (no timestamp, no in-window
    interactions, or only generic ones) -- so the caller keeps the Unclassified
    fallback."""
    a_ts = _ts_ms(activity_ev.get("timestamp", ""))
    if a_ts is None:
        return None
    duration = activity_ev["data"].get("duration_ms") or 0
    end = a_ts + max(duration, 1)
    counts: Counter[str] = Counter()
    for its, category in recognised:
        if its is None or its < a_ts or its >= end:
            continue
        phrase = _CATEGORY_ACTIVITY_PHRASE.get(category)
        if phrase:
            counts[phrase] += 1
    if not counts:
        return None
    return f"{counts.most_common(1)[0][0]} -- {app}"


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
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Stamp `activity_label` and optional `transaction_id` on activity
    events.

    Returns `(classified_events, taxonomy_report)`. The report carries a
    per-rule match count so a rule that fires on nothing -- usually a
    typo in its `title_regex` -- is surfaced instead of failing silently
    (§I67). One report entry per taxonomy rule, in declaration order.
    """
    rules = _compile_rules(taxonomy)
    counts = [0] * len(rules)
    # Recognise every interaction's semantic category once, paired with its
    # timestamp, for the no-taxonomy-match fallback below.
    recognised = [
        (_ts_ms(ev.get("timestamp", "")), recognize(ev.get("data") or {}).get("category"))
        for ev in events if ev.get("type") == "interaction"
    ]
    out: list[dict[str, Any]] = []
    for ev in events:
        if ev.get("type") != "activity":
            out.append(ev)
            continue
        app = ev["data"].get("app", "") or ""
        title = ev["data"].get("title", "") or ""
        label = f"Unclassified -- {app}"
        transaction_id = None
        matched = False
        for idx, rule in enumerate(rules):
            if rule["app"] and rule["app"].lower() != app.lower():
                continue
            if rule["title_regex"] and not rule["title_regex"].search(title):
                continue
            label = rule["label"]
            counts[idx] += 1
            matched = True
            tx_re = rule.get("transaction_id_regex")
            if tx_re:
                m = tx_re.search(title)
                if m:
                    transaction_id = m.group(1) if m.groups() else m.group(0)
            break
        if not matched:
            recognised_label = _recognition_activity_label(ev, recognised, app)
            if recognised_label:
                label = recognised_label
        new_ev = dict(ev)
        new_data = dict(ev["data"])
        new_data["activity_label"] = label
        if transaction_id is not None:
            new_data["transaction_id"] = transaction_id
        new_ev["data"] = new_data
        out.append(new_ev)
    report = [
        {
            "label": rule["label"],
            "app": rule["app"],
            "title_regex": rule["title_regex"].pattern if rule["title_regex"] else None,
            "matches": counts[idx],
            "zero_match": counts[idx] == 0,
        }
        for idx, rule in enumerate(rules)
    ]
    return out, report


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


def collapse_activity_occurrences(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse consecutive activity events sharing `activity_label` and
    `case_ids` into a single activity occurrence, summing duration.

    Unlike `collapse_adjacent` -- which keys on app + title + label +
    case_ids and is broken by any interleaved non-activity event -- this
    keys on the activity label alone and skips over interleaved
    interaction / marker events when judging adjacency.

    Rationale: the process-mining event log treats one continuous run of an
    activity as one occurrence. Two consecutive same-label events differ
    only in sub-activity detail (a window-title change) or are separated
    only by capture noise (interactions, a marker) -- neither is a real
    transition. Feeding the event log through this collapse makes a
    directly-follows self-loop structurally impossible. `collapse_adjacent`
    is left untouched so events.csv keeps the finer per-window rows.
    """
    out: list[dict[str, Any]] = []
    last_idx: int | None = None  # index in `out` of the most recent activity event
    for ev in events:
        if ev.get("type") != "activity":
            out.append(ev)
            continue
        if last_idx is not None:
            prev = out[last_idx]
            pd = prev["data"]
            cd = ev["data"]
            same = (
                pd.get("activity_label") == cd.get("activity_label")
                and (pd.get("case_ids") or []) == (cd.get("case_ids") or [])
            )
            if same:
                merged = dict(prev)
                merged_data = dict(pd)
                merged_data["duration_ms"] = (pd.get("duration_ms") or 0) + (cd.get("duration_ms") or 0)
                merged["data"] = merged_data
                out[last_idx] = merged
                continue
        out.append(ev)
        last_idx = len(out) - 1
    return out
