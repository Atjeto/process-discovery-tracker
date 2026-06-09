"""Tier-1 measured facts for analysis.json (lab-phase spec §A2).

Everything in this block is a direct measurement over the derived event
stream -- no heuristic judgments, no case boundaries required. It always
renders (the honesty architecture's Tier 1) and feeds the viewer's
Overview fact strip plus the memo's fact strip.

  active_ms        -- summed foreground-window time (activity duration_ms).
  idle_ms          -- summed idle_start/idle_end intervals the recorder
                      measured (0 when the session has no idle events).
  top_apps         -- top 5 apps by foreground time, each with its share.
  app_switches     -- count of foreground-app changes (+ per-hour rate).
  longest_focus_ms -- the longest unbroken same-app foreground stretch.
  rekey_count      -- distinct values typed into 2+ different apps
                      (value-equality on the derived stream; PII-masked
                      values compare by their join-preserving token).
  repeated_sequence_count -- motif count from motifs.find_motifs (§A3).

Pure stdlib.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from _dt import parse_ts_or_none as _parse_ts

# Shortest typed value considered for re-key matching -- below this,
# equal values are noise (single digits, "OK", blanks). Mirrors
# analysis_common.TRANSFER_MIN_LEN.
REKEY_MIN_LEN = 4

TOP_APPS_N = 5


def _activity_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        e for e in (events or [])
        if isinstance(e, dict) and e.get("type") == "activity"
        and isinstance(e.get("data"), dict)
    ]


def _duration_ms(data: dict) -> float:
    v = data.get("duration_ms")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return 0.0
    return float(v) if v > 0 else 0.0


def _session_span_ms(events: list[dict[str, Any]]) -> float:
    """First-to-last event timestamp, in ms. 0 when unparseable."""
    first = last = None
    for ev in events or []:
        t = _parse_ts(ev.get("timestamp")) if isinstance(ev, dict) else None
        if t is None:
            continue
        if first is None or t < first:
            first = t
        if last is None or t > last:
            last = t
    if first is None or last is None or last <= first:
        return 0.0
    return (last - first).total_seconds() * 1000.0


def _idle_ms(events: list[dict[str, Any]]) -> int:
    """Total measured idle time: paired idle_start/idle_end system events."""
    total = 0.0
    open_start = None
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "system":
            continue
        kind = (ev.get("data") or {}).get("kind")
        if kind == "idle_start":
            open_start = _parse_ts(ev.get("timestamp"))
        elif kind == "idle_end":
            end = _parse_ts(ev.get("timestamp"))
            if open_start is not None and end is not None and end > open_start:
                total += (end - open_start).total_seconds() * 1000.0
            open_start = None
    return round(total)


def _typed_value(ev: dict) -> str:
    """The non-empty stripped value typed in this interaction, or ""."""
    d = ev.get("data")
    if not isinstance(d, dict):
        return ""
    if d.get("kind") not in ("value_changed", "text_changed"):
        return ""
    val = d.get("value")
    if not isinstance(val, str):
        return ""
    return val.strip()


def rekey_details(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Values typed (value_changed/text_changed) into 2+ distinct apps.

    Compares the DERIVED stream's values literally, so a PII-masked value
    matches by its join-preserving token -- the masking deliberately keeps
    equality intact. Returns one row per re-keyed value with the apps and
    the typing event_ids, sorted by app-spread then value for stability.
    """
    by_value: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "interaction":
            continue
        val = _typed_value(ev)
        if len(val) < REKEY_MIN_LEN:
            continue
        app = ((ev.get("data") or {}).get("process_name") or "").strip().lower()
        if not app:
            continue
        by_value[val][app].append(ev.get("event_id") or "")

    out: list[dict[str, Any]] = []
    for val, apps in by_value.items():
        if len(apps) < 2:
            continue
        event_ids = [eid for ids in apps.values() for eid in ids if eid]
        out.append({
            "value": val,
            "apps": sorted(apps.keys()),
            "app_count": len(apps),
            "event_ids": event_ids,
            "entry_count": sum(len(ids) for ids in apps.values()),
        })
    out.sort(key=lambda r: (-r["app_count"], -r["entry_count"], r["value"]))
    return out


def compute_facts(
    events: list[dict[str, Any]],
    motifs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build the `analysis.facts` block. `motifs` is the find_motifs output
    (only its length is read -- the repeated-sequence count)."""
    acts = _activity_events(events)

    per_app: dict[str, float] = defaultdict(float)
    switches = 0
    longest = 0.0
    run = 0.0
    prev_app = None
    for ev in acts:
        data = ev["data"]
        app = (data.get("app") or "").strip() or "(unknown)"
        dur = _duration_ms(data)
        per_app[app] += dur
        if prev_app is not None and app != prev_app:
            switches += 1
            run = dur
        else:
            run += dur
        if run > longest:
            longest = run
        prev_app = app

    active_ms = round(sum(per_app.values()))
    top_apps = [
        {"app": app, "ms": round(ms),
         "share": round(ms / active_ms, 3) if active_ms else 0.0}
        for app, ms in sorted(per_app.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_APPS_N]
    ]

    span_ms = _session_span_ms(events)
    span_hours = span_ms / 3600000.0
    switches_per_hour = round(switches / span_hours, 1) if span_hours > 0 else 0.0

    return {
        "active_ms": active_ms,
        "idle_ms": _idle_ms(events),
        "session_span_ms": round(span_ms),
        "top_apps": top_apps,
        "app_switches": switches,
        "switches_per_hour": switches_per_hour,
        "longest_focus_ms": round(longest),
        "rekey_count": len(rekey_details(events)),
        "repeated_sequence_count": len(motifs or []),
    }
