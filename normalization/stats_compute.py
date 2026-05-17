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
from datetime import datetime
from statistics import mean, median
from typing import Any


def _parse_ts(ts: str) -> datetime:
    s = ts.rstrip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


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


def activity_stats(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-activity_label statistics."""
    by_label: dict[str, list[float]] = defaultdict(list)
    for ev in events:
        if ev.get("type") != "activity":
            continue
        label = ev["data"].get("activity_label") or "Unclassified"
        dur = ev["data"].get("duration_ms") or 0
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
) -> list[dict[str, Any]]:
    """Per-case duration -- both wall-clock and active (§5.4)."""
    active_by_case: dict[str, int] = defaultdict(int)
    for ev in events:
        if ev.get("type") != "activity":
            continue
        cids = ev["data"].get("case_ids") or []
        dur = ev["data"].get("duration_ms") or 0
        for cid in cids:
            active_by_case[cid] += dur

    rows = []
    for cid, meta in cases.items():
        start = _parse_ts(meta["start_ts"]) if meta.get("start_ts") else None
        end = _parse_ts(meta["end_ts"]) if meta.get("end_ts") else None
        wall = int((end - start).total_seconds() * 1000) if (start and end) else None
        rows.append({
            "case_id": cid,
            "label": meta.get("label"),
            "parent_case_id": meta.get("parent_case_id"),
            "start_ts": meta.get("start_ts"),
            "end_ts": meta.get("end_ts"),
            "wall_clock_ms": wall,
            "active_ms": active_by_case.get(cid, 0),
            "end_reason": meta.get("end_reason"),
        })
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

    A case's variant is its steps ordered by start time. Steps with no
    case_id are skipped (they cannot be attributed to a process
    instance)."""
    by_case: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for s in steps or []:
        cid = s.get("case_id")
        if not cid:
            continue
        start = ((s.get("time_range") or {}).get("start")) or ""
        by_case[cid].append((start, s.get("name") or "(unnamed step)"))

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


def compute_all(
    events: list[dict[str, Any]],
    cases: dict[str, dict[str, Any]],
    excluded_ranges: list[dict[str, Any]] | None = None,
    steps: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    events = _filter_excluded(events, excluded_ranges)
    return {
        "activity_stats": activity_stats(events),
        "case_stats": case_stats(events, cases),
        "trace_variants": trace_variants(events, cases),
        "step_variants": step_variants(steps or []),
        "app_outliers": app_outliers(events, cases),
        "rework_loops": rework_loops(events),
    }
