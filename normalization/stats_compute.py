"""Per-activity and per-case statistics (§8.2).

Computes the standard set the aggregate viewer renders:
  - Per-activity duration distribution (mean, median, p90, p99)
  - Per-activity frequency
  - Per-case duration (wall-clock AND active, per §5.4)
  - Trace variants ranked by frequency
  - App outliers (apps appearing in <5% of cases)
  - Rework loops (activity revisited within a case)
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from statistics import mean, median
from typing import Any

from _dt import parse_ts as _parse_ts  # public re-export
from analysis_common import step_group_label
from facts import _active_duration_ms, _idle_intervals
from step_context import step_duration_ms, untimed_key


def _filter_excluded(
    events: list[dict[str, Any]],
    excluded_ranges: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Drop events whose timestamp falls inside any excluded range
    (annotations.json `excluded_ranges`, set from the viewer's timeline
    selection). Statistics skip these so a lunch break or an unrelated
    detour in a long passive recording doesn't distort the numbers."""
    ranges: list[tuple[datetime, datetime]] = []
    for r in excluded_ranges or []:
        start, end = r.get("start"), r.get("end")
        if not start or not end:
            continue
        try:
            a, b = _parse_ts(start), _parse_ts(end)
        except (ValueError, TypeError):
            continue
        if b >= a:
            ranges.append((a, b))
    if not ranges:
        return events
    kept = []
    for ev in events:
        try:
            t = _parse_ts(ev.get("timestamp", ""))
        except (ValueError, TypeError):
            kept.append(ev)
            continue
        if any(a <= t <= b for a, b in ranges):
            continue
        kept.append(ev)
    return kept


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * (pct / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


def _num(x: Any) -> float:
    """A duration value from a corrupt/hand-edited log may be non-numeric or
    negative; coerce to a non-negative number so a `sum` degrades to 0 instead
    of crashing. (`_coerce_event_shape` guarantees `data` is a dict, but its
    field VALUES are validated by each consumer that interprets them.)"""
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return 0
    return x if x > 0 else 0


def _safe_parse(ts: Any) -> datetime | None:
    """Parse a timestamp, tolerating a corrupt/non-ISO value (returns None)."""
    if not ts:
        return None
    try:
        return _parse_ts(ts)
    except (ValueError, TypeError):
        return None


def activity_stats(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-activity_label statistics."""
    by_label: dict[str, list[float]] = defaultdict(list)
    for ev in events:
        if ev.get("type") != "activity":
            continue
        label = ev["data"].get("activity_label") or "Unclassified"
        dur = _num(ev["data"].get("duration_ms"))
        by_label[label].append(dur)
    rows = []
    total = sum(len(v) for v in by_label.values()) or 1
    for label, durs in sorted(by_label.items(), key=lambda kv: -sum(kv[1])):
        rows.append({
            "activity_label": label,
            "frequency": len(durs),
            "frequency_pct": round(100.0 * len(durs) / total, 2),
            "total_duration_ms": int(sum(durs)),
            "mean_ms": int(mean(durs)) if durs else 0,
            "median_ms": int(median(durs)) if durs else 0,
            "p90_ms": int(_percentile(durs, 90)),
            "p99_ms": int(_percentile(durs, 99)),
        })
    return rows


def case_stats(
    events: list[dict[str, Any]],
    cases: dict[str, dict[str, Any]],
    recorded: bool = True,
) -> list[dict[str, Any]]:
    """Per-case duration -- both wall-clock and active (§5.4).

    Active time is measured the way facts measures it (RP-07): each
    foreground run stamped to the case, minus the idle time the recorder
    measured inside it, limited to the case's own start/end span. So a run's
    active time never counts idle time and never exceeds its elapsed time.

    In a session without a recording (`recorded` False: a video or blank
    session, contract C16) nothing measured the foreground, so `active_ms`
    is None, never a measured 0. The implicit run of such a session carries
    `implicit: True` (case_assignment.add_implicit_run)."""
    windows = {cid: (_safe_parse(meta.get("start_ts")), _safe_parse(meta.get("end_ts")))
               for cid, meta in cases.items()}
    idle = _idle_intervals(events)
    active_by_case: dict[str, float] = defaultdict(float)
    for ev in events:
        if ev.get("type") != "activity":
            continue
        cids = ev["data"].get("case_ids") or []
        for cid in cids:
            active_by_case[cid] += _active_duration_ms(ev, idle, windows.get(cid))

    rows = []
    for cid, meta in cases.items():
        start, end = windows[cid]
        wall = int((end - start).total_seconds() * 1000) if (start and end and end >= start) else None
        row = {
            "case_id": cid,
            "label": meta.get("label"),
            "parent_case_id": meta.get("parent_case_id"),
            "start_ts": meta.get("start_ts"),
            "end_ts": meta.get("end_ts"),
            "wall_clock_ms": wall,
            "active_ms": round(active_by_case.get(cid, 0)) if recorded else None,
            "end_reason": meta.get("end_reason"),
        }
        if meta.get("implicit"):
            row["implicit"] = True
        rows.append(row)
    rows.sort(key=lambda r: r["start_ts"] or "")
    return rows


def trace_variants(
    events: list[dict[str, Any]],
    cases: dict[str, dict[str, Any]],
    top_n: int = 50,
) -> list[dict[str, Any]]:
    """Trace variants by frequency. A variant is the sequence of
    activity_labels for the events inside one top-level case."""
    by_top: dict[str, list[str]] = defaultdict(list)
    for ev in events:
        if ev.get("type") != "activity":
            continue
        cids = ev["data"].get("case_ids") or []
        if not cids:
            continue
        top = cids[-1]
        by_top[top].append(ev["data"].get("activity_label") or "Unclassified")

    variant_counts: Counter[tuple[str, ...]] = Counter()
    for seq in by_top.values():
        variant_counts[tuple(seq)] += 1

    rows = []
    for variant, count in variant_counts.most_common(top_n):
        rows.append({
            "variant": list(variant),
            "frequency": count,
            "length": len(variant),
        })
    return rows


def app_outliers(
    events: list[dict[str, Any]],
    cases: dict[str, dict[str, Any]],
    threshold_pct: float = 5.0,
) -> list[dict[str, Any]]:
    """Apps appearing in <threshold_pct of top-level cases."""
    apps_per_case: dict[str, set[str]] = defaultdict(set)
    for ev in events:
        if ev.get("type") != "activity":
            continue
        cids = ev["data"].get("case_ids") or []
        if not cids:
            continue
        top = cids[-1]
        app = ev["data"].get("app")
        if app:
            apps_per_case[top].add(app)
    total_cases = len(apps_per_case) or 1
    app_freq: Counter[str] = Counter()
    for apps in apps_per_case.values():
        for a in apps:
            app_freq[a] += 1
    rows = []
    for app, count in app_freq.most_common():
        pct = 100.0 * count / total_cases
        if pct < threshold_pct:
            rows.append({"app": app, "case_count": count, "case_pct": round(pct, 2)})
    return rows


def rework_loops(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Activities revisited within a single case (same activity_label
    appears more than once in the case's event sequence)."""
    by_top: dict[str, list[str]] = defaultdict(list)
    for ev in events:
        if ev.get("type") != "activity":
            continue
        cids = ev["data"].get("case_ids") or []
        if not cids:
            continue
        by_top[cids[-1]].append(ev["data"].get("activity_label") or "Unclassified")
    rework: Counter[str] = Counter()
    for seq in by_top.values():
        counts = Counter(seq)
        for label, n in counts.items():
            if n > 1:
                rework[label] += n - 1
    rows = [{"activity_label": l, "rework_count": n} for l, n in rework.most_common()]
    return rows


def step_variants(
    steps: list[dict[str, Any]],
    top_n: int = 50,
) -> list[dict[str, Any]]:
    """Variants keyed by the sequence of step *names* per case -- the
    step-level analogue of trace_variants. Where trace_variants captures
    the raw activity sequence, this captures the analyst's stepped view
    of the process, which is usually the more meaningful comparison.

    A case's variant is its steps ordered by start time, then the steps
    without a time by their `order` (contract C16). Steps with no case_id
    are skipped (they cannot be attributed to a process instance)."""
    by_case: dict[str, list[tuple[tuple, str]]] = defaultdict(list)
    for s in steps or []:
        cid = s.get("case_id")
        if not cid:
            continue
        start = ((s.get("time_range") or {}).get("start")) or ""
        key = (0, start) if start else untimed_key(s)
        by_case[cid].append((key, step_group_label(s)))

    variant_counts: Counter[tuple[str, ...]] = Counter()
    for seq in by_case.values():
        seq.sort(key=lambda pair: pair[0])
        variant_counts[tuple(name for _, name in seq)] += 1

    rows = []
    for variant, count in variant_counts.most_common(top_n):
        rows.append({
            "variant": list(variant),
            "frequency": count,
            "length": len(variant),
        })
    return rows


def step_stats(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-step-name duration distribution -- the step-level analogue of
    `activity_stats`, so the stepped view gets the SAME frequency + duration
    treatment as the activity view (resolving the activity/step stats
    split-brain, where only the activity level had a distribution). A step's
    duration is its `time_range`; an inverted range counts as 0 ms. A step
    without a time range (a step added by hand with `time_range: null`, or
    an unreadable one) is left out: these are timed statistics (contract
    C16). Same row shape as `activity_stats`, keyed on `step_name`."""
    by_name: dict[str, list[float]] = defaultdict(list)
    for s in steps or []:
        dur = step_duration_ms(s)
        if dur is None:
            continue
        by_name[step_group_label(s)].append(dur)
    rows = []
    total = sum(len(v) for v in by_name.values()) or 1
    for name, durs in sorted(by_name.items(), key=lambda kv: -sum(kv[1])):
        rows.append({
            "step_name": name,
            "frequency": len(durs),
            "frequency_pct": round(100.0 * len(durs) / total, 2),
            "total_duration_ms": int(sum(durs)),
            "mean_ms": int(mean(durs)) if durs else 0,
            "median_ms": int(median(durs)) if durs else 0,
            "p90_ms": int(_percentile(durs, 90)),
            "p99_ms": int(_percentile(durs, 99)),
        })
    return rows


def compute_all(
    events: list[dict[str, Any]],
    cases: dict[str, dict[str, Any]],
    excluded_ranges: list[dict[str, Any]] | None = None,
    steps: list[dict[str, Any]] | None = None,
    recorded: bool = True,
) -> dict[str, Any]:
    """Every statistic of stats.json. `recorded` is False for a session
    without a recording (C16): the runs' active time is then None."""
    events = _filter_excluded(events, excluded_ranges)
    return {
        "activity_stats": activity_stats(events),
        "case_stats": case_stats(events, cases, recorded=recorded),
        "trace_variants": trace_variants(events, cases),
        "step_variants": step_variants(steps or []),
        "step_stats": step_stats(steps or []),
        "app_outliers": app_outliers(events, cases),
        "rework_loops": rework_loops(events),
    }
