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
    duration = _num(_as_dict(activity_ev.get("data")).get("duration_ms"))
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


def _as_dict(x: Any) -> dict:
    """A dict view of `x`, or {} when it isn't one. A malformed taxonomy.yaml
    or an odd capture can put a non-dict where a dict is expected; guarding
    degrades (no rule / no label) instead of crashing the whole run -- the same
    posture as load_vocabularies."""
    return x if isinstance(x, dict) else {}


def _num(x: Any) -> float:
    """A numeric duration, or 0 for a non-number (a corrupt event can carry a
    list/string duration_ms; arithmetic on it would raise)."""
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) else 0


def _compile_rules(taxonomy: dict[str, Any]) -> list[dict[str, Any]]:
    """Compile regex patterns up front so we don't pay the cost per event.
    A non-list `rules` / a non-dict rule / a non-dict `match` is skipped or
    treated as empty rather than crashing on a hand-edited taxonomy."""
    compiled = []
    rules = _as_dict(taxonomy).get("rules")
    for rule in (rules if isinstance(rules, list) else []):
        if not isinstance(rule, dict):
            continue
        match = _as_dict(rule.get("match"))
        compiled_rule = {
            "label": rule.get("label", "Unclassified"),
            "app": match.get("app"),
            "title_regex": re.compile(match["title_regex"], re.IGNORECASE)
                if match.get("title_regex") else None,
        }
        extract = _as_dict(rule.get("extract"))
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
        (_ts_ms(ev.get("timestamp", "")), recognize(_as_dict(ev.get("data"))).get("category"))
        for ev in events if isinstance(ev, dict) and ev.get("type") == "interaction"
    ]
    out: list[dict[str, Any]] = []
    for ev in events:
        if not isinstance(ev, dict) or ev.get("type") != "activity":
            out.append(ev)
            continue
        data = _as_dict(ev.get("data"))
        app = str(data.get("app") or "")
        title = str(data.get("title") or "")
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
        new_data = dict(data)
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
        if not isinstance(ev, dict) or ev.get("type") != "activity":
            out.append(ev)
            continue
        if out and isinstance(out[-1], dict) and out[-1].get("type") == "activity":
            prev = out[-1]
            pd = _as_dict(prev.get("data"))
            cd = _as_dict(ev.get("data"))
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
                merged_data["duration_ms"] = _num(pd.get("duration_ms")) + _num(cd.get("duration_ms"))
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
        if not isinstance(ev, dict) or ev.get("type") != "activity":
            out.append(ev)
            continue
        if last_idx is not None:
            prev = out[last_idx]
            pd = _as_dict(prev.get("data"))
            cd = _as_dict(ev.get("data"))
            same = (
                pd.get("activity_label") == cd.get("activity_label")
                and (pd.get("case_ids") or []) == (cd.get("case_ids") or [])
            )
            if same:
                merged = dict(prev)
                merged_data = dict(pd)
                merged_data["duration_ms"] = _num(pd.get("duration_ms")) + _num(cd.get("duration_ms"))
                merged["data"] = merged_data
                out[last_idx] = merged
                continue
        out.append(ev)
        last_idx = len(out) - 1
    return out
