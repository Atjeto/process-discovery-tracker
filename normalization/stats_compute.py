"""Per-activity and per-case statistics (§8.2).

Computes the standard set the aggregate viewer renders:
  - Per-activity duration distribution (mean, median, p90, p99)
  - Per-activity frequency
  - Per-case duration (wall-clock AND active, per §5.4)
  - Trace variants ranked by frequency
  - App outliers (apps appearing in <5% of cases)
  - Rework loops (activity revisited within a case)

The stretches the analyst left out of the analysis (annotations.json
`excluded_ranges`) are cut out of the recorded activity rows first, each row
losing exactly the part inside a stretch (clip_excluded), and only then are
the rows merged into activity occurrences: a stretch takes out its own time,
never a whole merged occurrence that starts inside it.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean, median
from typing import Any

from _dt import parse_ts as _parse_ts  # public re-export
from step_context import step_duration_ms, untimed_key


def step_group_label(step: dict[str, Any]) -> str:
    """Display name for a grouped step. A template-matched step already
    carries a value-free canonical name; an auto step's name embeds the
    case's values ("Search — CUST-10852"), so fall back to the value-free
    `process_label` ("Search") instead so the group reads as one thing."""
    if step.get("canonical_step_id"):
        return step.get("name") or step.get("process_label") or "(unnamed step)"
    return step.get("process_label") or step.get("name") or "(unnamed step)"


def _excluded_spans(excluded_ranges: list[dict[str, Any]] | None) -> list[tuple[datetime, datetime]]:
    """The readable stretches of annotations.json `excluded_ranges` as
    (start, end) datetimes; a range that cannot be read, or ends before it
    starts, is left out."""
    ranges: list[tuple[datetime, datetime]] = []
    for r in excluded_ranges or []:
        if not isinstance(r, dict):
            continue
        start, end = r.get("start"), r.get("end")
        if not start or not end:
            continue
        try:
            a, b = _parse_ts(start), _parse_ts(end)
        except (ValueError, TypeError):
            continue
        if b >= a:
            ranges.append((a, b))
    return ranges


def _filter_excluded(
    events: list[dict[str, Any]],
    excluded_ranges: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Drop events whose timestamp falls inside any excluded range
    (annotations.json `excluded_ranges`, set from the viewer's timeline
    selection). The checks that read single moments (the transaction check,
    the capture detail) skip these, as the drafting does."""
    ranges = _excluded_spans(excluded_ranges)
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


def _iso(t: datetime) -> str:
    """An ISO timestamp in the recorder's form (UTC, "Z")."""
    return t.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def clip_excluded(
    events: list[dict[str, Any]],
    excluded_ranges: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """The event stream with the stretches left out of the analysis cut out
    of its activity rows: a row inside a stretch is dropped, a row across a
    stretch's start or end loses the part inside it, and a row around a
    stretch becomes two rows, before and after it. Each part keeps the row's
    data with its own timestamp and duration. A row whose time cannot be read
    stays as it is (it cannot be placed), and every other event passes
    through: the idle events keep their pairs. Without a stretch the stream
    is returned as it is."""
    ranges = sorted(_excluded_spans(excluded_ranges))
    if not ranges:
        return events
    out: list[dict[str, Any]] = []
    for ev in events:
        if not isinstance(ev, dict) or ev.get("type") != "activity":
            out.append(ev)
            continue
        data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
        start = _safe_parse(ev.get("timestamp"))
        if start is None:
            out.append(ev)
            continue
        dur = _duration_ms(data)
        end = start + timedelta(milliseconds=dur)
        if dur <= 0:
            if not any(a <= start <= b for a, b in ranges):
                out.append(ev)
            continue
        pieces = [(start, end)]
        for a, b in ranges:
            nxt = []
            for lo, hi in pieces:
                if b <= lo or a >= hi:
                    nxt.append((lo, hi))
                    continue
                if lo < a:
                    nxt.append((lo, a))
                if b < hi:
                    nxt.append((b, hi))
            pieces = nxt
        if pieces == [(start, end)]:
            out.append(ev)
            continue
        for i, (lo, hi) in enumerate(pieces):
            piece = dict(ev)
            piece["timestamp"] = ev.get("timestamp") if lo == start else _iso(lo)
            piece["data"] = {**data, "duration_ms": (hi - lo).total_seconds() * 1000.0}
            if i and isinstance(ev.get("event_id"), str):
                piece["event_id"] = f"{ev['event_id']}#{i + 1}"
            out.append(piece)
    return out


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


def _duration_ms(data: dict) -> float:
    """An activity row's measured duration_ms, 0 for a missing, negative or
    non-numeric one."""
    return float(_num((data or {}).get("duration_ms")))


def _safe_parse(ts: Any) -> datetime | None:
    """Parse a timestamp, tolerating a corrupt/non-ISO value (returns None)."""
    if not ts:
        return None
    try:
        return _parse_ts(ts)
    except (ValueError, TypeError):
        return None


def _idle_intervals(events: list[dict[str, Any]]) -> list[tuple[datetime, datetime]]:
    """The idle intervals the recorder measured: paired idle_start/idle_end
    system events, as (start, end) datetimes, in time order."""
    intervals = []
    open_start = None
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "system":
            continue
        kind = (ev.get("data") or {}).get("kind") if isinstance(ev.get("data"), dict) else None
        if kind == "idle_start":
            open_start = _safe_parse(ev.get("timestamp"))
        elif kind == "idle_end":
            end = _safe_parse(ev.get("timestamp"))
            if open_start is not None and end is not None and end > open_start:
                intervals.append((open_start, end))
            open_start = None
    return sorted(intervals)


def _active_ms(lo: datetime, hi: datetime, idle: list[tuple[datetime, datetime]]) -> float:
    """The time between `lo` and `hi` that is not idle, in ms."""
    if hi <= lo:
        return 0.0
    ms = (hi - lo).total_seconds() * 1000.0
    for i0, i1 in idle:
        if i0 >= hi:
            break
        a, b = max(lo, i0), min(hi, i1)
        if b > a:
            ms -= (b - a).total_seconds() * 1000.0
    return max(0.0, ms)


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

    A transaction's active time is the recorded foreground time inside its
    span: every activity row counts by its overlap with the transaction,
    clipped to the transaction's start and end (a transaction left open runs
    to the end of the recording), minus the idle time the recorder measured
    in that overlap. So a stretch in front that starts a moment before the
    transaction's start marker (the capture app writes the first stretch's
    start just before its Transaction 1 marker) counts from the marker on,
    a stretch across the boundary of two transactions counts in each for its
    part, and a transaction's active time never counts idle time and never
    exceeds its elapsed time. A row whose time cannot be read, and every row
    of a transaction whose span cannot be read, count by the transaction
    their start was filed under (`case_ids`), as far as they are known.

    `events` are the recorded rows themselves (not merged into occurrences:
    merging stamps a row's time at the first row it holds), with the
    stretches left out of the analysis already cut out (clip_excluded).

    In a session without a recording (`recorded` False: a video or blank
    session, contract C16) nothing measured the foreground, so `active_ms`
    is None, never a measured 0. The same holds for a recording without a
    single activity row: its capture app never saw the foreground window
    (the packaged capture app before 2.0.0 shipped without a package its
    window reader needs), so the PDD says "Not recorded", not 0s. The
    implicit run of a session without a recording carries `implicit: True`
    (case_assignment.add_implicit_run)."""
    idle = _idle_intervals(events)
    rows_in = [ev for ev in events or []
               if isinstance(ev, dict) and ev.get("type") == "activity"
               and isinstance(ev.get("data"), dict)]
    measured = recorded and bool(rows_in)
    spans = []          # (start, end, case_ids) of the rows whose time can be read
    unplaced = []       # the rows whose time cannot be read
    for ev in rows_in:
        start = _safe_parse(ev.get("timestamp"))
        dur = _duration_ms(ev["data"])
        if start is None:
            unplaced.append(ev)
        elif dur > 0:
            spans.append((start, start + timedelta(milliseconds=dur),
                          ev["data"].get("case_ids") or []))

    rows = []
    for cid, meta in cases.items():
        start, end = _safe_parse(meta.get("start_ts")), _safe_parse(meta.get("end_ts"))
        wall = int((end - start).total_seconds() * 1000) if (start and end and end >= start) else None
        span_known = start is not None and (meta.get("end_ts") is None or end is not None)
        active = 0.0
        for a, b, cids in spans:
            if span_known:
                active += _active_ms(max(a, start), min(b, end) if end is not None else b, idle)
            elif cid in cids:
                active += _active_ms(a, b, idle)
        for ev in unplaced:
            if cid in (ev["data"].get("case_ids") or []):
                active += _duration_ms(ev["data"])
        row = {
            "case_id": cid,
            "label": meta.get("label"),
            "parent_case_id": meta.get("parent_case_id"),
            "start_ts": meta.get("start_ts"),
            "end_ts": meta.get("end_ts"),
            "wall_clock_ms": wall,
            "active_ms": round(active) if measured else None,
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
    """Every statistic of stats.json. `events` is the classified event
    stream as recorded (one activity row per foreground stretch, not merged):
    the stretches left out (`excluded_ranges`) are cut out of its rows first
    (clip_excluded), then the rows are merged into activity occurrences for
    the activity statistics, while the transactions' active time reads the
    rows themselves (case_stats). `recorded` is False for a session without a
    recording (C16): the runs' active time is then None."""
    from classification import collapse_activity_occurrences
    rows = clip_excluded(events, excluded_ranges)
    occurrences = collapse_activity_occurrences(rows)
    return {
        "activity_stats": activity_stats(occurrences),
        "case_stats": case_stats(rows, cases, recorded=recorded),
        "trace_variants": trace_variants(occurrences, cases),
        "step_variants": step_variants(steps or []),
        "step_stats": step_stats(steps or []),
        "app_outliers": app_outliers(occurrences, cases),
        "rework_loops": rework_loops(occurrences),
    }
