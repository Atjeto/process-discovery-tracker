"""XES emission (§7.3).

Maps our normalized event stream to IEEE 1849-2016 XES:

  Trace        <- top-level case (case_id with parent_case_id=None)
  Event        <- activity event after collapse
  concept:name <- activity_label
  time:timestamp <- event timestamp
  org:resource <- worker.id from session config
  Custom attrs <- app, title, transaction_id, screenshot ref, case stack

Uses pm4py's xes_exporter for the actual write so we stay on the
standard library tooling.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pandas as pd
import pm4py
from pm4py.objects.log.obj import Event, EventLog, Trace
from pm4py.objects.log.exporter.xes import exporter as xes_exporter

from _dt import parse_ts as _parse_ts  # public re-export


def build_event_log(
    events: list[dict[str, Any]],
    cases: dict[str, dict[str, Any]],
    worker_id: str = "unknown",
) -> EventLog:
    """Build a pm4py EventLog. Top-level cases become traces.

    Nested-case activities are emitted under the top-level trace with
    a `case:stack` attribute encoding the nested case_id list. This
    keeps the XES output portable (single-trace-per-top-case) while
    preserving the structural info for downstream consumers.
    """
    # Group activity events by top-level case_id
    by_top: dict[str, list[dict[str, Any]]] = {}
    no_case: list[dict[str, Any]] = []
    for ev in events:
        if ev.get("type") != "activity":
            continue
        cids = ev["data"].get("case_ids") or []
        if not cids:
            no_case.append(ev)
            continue
        # Walk up the stack to find the top-level case
        top = cids[-1]
        by_top.setdefault(top, []).append(ev)

    log = EventLog()

    # Build a trace per top-level case
    for top_id, evs in by_top.items():
        case_meta = cases.get(top_id, {})
        trace = Trace()
        trace.attributes["concept:name"] = case_meta.get("label") or top_id
        trace.attributes["case:id"] = top_id
        if case_meta.get("start_ts"):
            trace.attributes["case:start_ts"] = case_meta["start_ts"]
        if case_meta.get("end_ts"):
            trace.attributes["case:end_ts"] = case_meta["end_ts"]
        for ev in evs:
            e = Event()
            data = ev["data"]
            e["concept:name"] = data.get("activity_label") or data.get("app") or "Unknown"
            e["time:timestamp"] = _parse_ts(ev["timestamp"])
            e["org:resource"] = worker_id
            e["raw:app"] = data.get("app")
            e["raw:title"] = data.get("title")
            e["raw:pid"] = data.get("pid")
            e["raw:duration_ms"] = data.get("duration_ms")
            if data.get("transaction_id"):
                e["raw:transaction_id"] = data["transaction_id"]
            e["case:stack"] = ",".join(data.get("case_ids") or [])
            trace.append(e)
        if len(trace) > 0:
            log.append(trace)

    # No-case activities -> a single synthetic trace so they aren't lost
    if no_case:
        trace = Trace()
        trace.attributes["concept:name"] = "(no-case)"
        trace.attributes["case:id"] = "no-case"
        for ev in no_case:
            e = Event()
            data = ev["data"]
            e["concept:name"] = data.get("activity_label") or data.get("app") or "Unknown"
            e["time:timestamp"] = _parse_ts(ev["timestamp"])
            e["org:resource"] = worker_id
            e["raw:app"] = data.get("app")
            e["raw:title"] = data.get("title")
            e["raw:duration_ms"] = data.get("duration_ms")
            trace.append(e)
        log.append(trace)

    return log


def export_xes(log: EventLog, out_path: str) -> None:
    xes_exporter.apply(log, out_path)


def export_csv(events: list[dict[str, Any]], cases: dict[str, dict[str, Any]], out_path: str) -> None:
    """Flat CSV of activity events. Mirrors the XES content for analyst
    inspection in Excel and ingestion by non-XES-aware tooling.
    """
    rows = []
    for ev in events:
        if ev.get("type") != "activity":
            continue
        data = ev["data"]
        cids = data.get("case_ids") or []
        top = cids[-1] if cids else ""
        innermost = cids[0] if cids else ""
        rows.append({
            "event_id": ev["event_id"],
            "timestamp": ev["timestamp"],
            "duration_ms": data.get("duration_ms"),
            "activity_label": data.get("activity_label"),
            "app": data.get("app"),
            "title": data.get("title"),
            "pid": data.get("pid"),
            "transaction_id": data.get("transaction_id"),
            "top_case_id": top,
            "innermost_case_id": innermost,
            "case_stack": ",".join(cids),
            "top_case_label": (cases.get(top, {}) or {}).get("label", ""),
        })
    df = pd.DataFrame(rows)
    df.to_csv(out_path, index=False)
