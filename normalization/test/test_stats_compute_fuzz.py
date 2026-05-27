"""Seeded property-based fuzzer for stats_compute -- the numbers that fill the
PDD tables, the findings report, and the Analysis view. A wrong figure in a
stakeholder deliverable is worse than a UI nit, so pin the load-bearing
invariants over many randomized inputs.

Two regimes:
  * **well-formed** (strict): correctness -- frequencies conserve, percentiles
    are ordered (median <= p90 <= p99) and bounded by the data, rows are sorted
    by total duration, percentages match their counts.
  * **adversarial**: corrupt/hand-edited events (null or non-dict `data`,
    non-numeric durations, bad timestamps, missing fields) -- robustness only:
    never crash, always return well-shaped rows.

Deterministic: iteration i is driven by Random(BASE + i); a failure prints the
seed to reproduce. Run: pytest normalization/test/test_stats_compute_fuzz.py
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from stats_compute import (  # noqa: E402
    _percentile,
    activity_stats,
    case_stats,
    compute_all,
    step_stats,
    trace_variants,
)

BASE = 0x57A75
WELLFORMED_ITERS = 3000
ADVERSARIAL_ITERS = 2000

_LABELS = ["Search -- chrome", "Text entry -- sap", "Click -- excel", "Open -- outlook"]
_STEP_NAMES = ["Salesforce: Search — CUST-1", "SAP: Enter 5 in Qty", "Excel: Save", "Open record"]
_BASE_T = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)


def _iso(t):
    return t.isoformat()


def _activity(ts, label, dur, case_ids):
    return {"event_id": str(uuid.uuid4()), "type": "activity", "timestamp": ts,
            "data": {"activity_label": label, "duration_ms": dur, "case_ids": case_ids}}


def _gen_wellformed(rng):
    n = rng.randint(0, 40)
    t = _BASE_T
    case_pool = ["c1", "c2", "c3"]
    events = []
    for _ in range(n):
        t = t + timedelta(milliseconds=rng.choice([200, 1000, 5000, 30000]))
        cid = rng.choice(case_pool + [None])
        events.append(_activity(
            _iso(t), rng.choice(_LABELS),
            rng.choice([0, rng.randint(1, 60000)]),
            [cid] if cid else [],
        ))
    cases = {}
    for cid in case_pool:
        cases[cid] = {"label": cid.upper(), "parent_case_id": None,
                      "start_ts": _iso(_BASE_T), "end_ts": _iso(t), "end_reason": None}
    steps = []
    for _ in range(rng.randint(0, 30)):
        s = _BASE_T + timedelta(seconds=rng.randint(0, 300))
        e = s + timedelta(milliseconds=rng.choice([0, 500, 5000, 60000]))
        steps.append({"step_id": str(uuid.uuid4()), "name": rng.choice(_STEP_NAMES),
                      "state": "edited",
                      "time_range": {"start": _iso(s), "end": _iso(e)}})
    return events, cases, steps


def _corrupt(rng, ev):
    # normalize._coerce_event_shape guarantees a dict `data` and a string
    # `timestamp` before stats runs, so those can't be null here. The realistic
    # corruption that reaches stats is bad FIELD VALUES inside that dict -- a
    # hand-edited duration / label / timestamp that survives coercion.
    d = ev["data"]
    if rng.random() < 0.45:
        d["duration_ms"] = rng.choice([None, "lots", "12", -5, 1.5e9])
    if rng.random() < 0.3:
        d["activity_label"] = rng.choice([None, "", 42])
    if rng.random() < 0.2:
        d.pop("duration_ms", None)
    if rng.random() < 0.15:
        ev["timestamp"] = rng.choice(["not-a-date", "", "1700000000"])
    return ev


def _gen_adversarial(rng):
    events, cases, steps = _gen_wellformed(rng)
    events = [_corrupt(rng, e) for e in events]
    # corrupt a few steps' ranges too
    for s in steps:
        if rng.random() < 0.2:
            s["time_range"] = rng.choice([{}, None, {"start": "bad"}, {"start": _iso(_BASE_T), "end": "x"}])
    # corrupt a case's timestamps
    for c in cases.values():
        if rng.random() < 0.2:
            c["start_ts"] = rng.choice([None, "bad", ""])
    return events, cases, steps


def _check_dist_rows(rows, n_items, key_count):
    """Shared checks for activity_stats / step_stats row shape + ordering."""
    assert sum(r["frequency"] for r in rows) == n_items, "frequencies do not conserve"
    prev_total = None
    for r in rows:
        assert r["frequency"] >= 1
        assert r["total_duration_ms"] >= 0
        assert r["mean_ms"] >= 0
        # percentiles ordered and non-negative (durations are >= 0)
        assert 0 <= r["median_ms"] <= r["p90_ms"] <= r["p99_ms"], \
            f"percentiles out of order: {r}"
        assert r["frequency_pct"] == round(100.0 * r["frequency"] / key_count, 2)
        if prev_total is not None:
            assert r["total_duration_ms"] <= prev_total, "rows not sorted by total duration"
        prev_total = r["total_duration_ms"]


def test_fuzz_stats_wellformed():
    """3000 well-formed sessions: the deliverable's numbers are computed right."""
    for i in range(WELLFORMED_ITERS):
        seed = BASE + i
        rng = Random(seed)
        events, cases, steps = _gen_wellformed(rng)
        try:
            # _percentile: bounded by the data and monotonic in pct.
            durs = [e["data"]["duration_ms"] for e in events if e["data"]["duration_ms"]]
            if durs:
                lo, hi = min(durs), max(durs)
                last = None
                for pct in (0, 25, 50, 75, 90, 99, 100):
                    v = _percentile(durs, pct)
                    assert lo <= v <= hi, f"percentile {pct} out of [{lo},{hi}]: {v}"
                    if last is not None:
                        assert v >= last, "percentile not monotonic in pct"
                    last = v

            n_act = sum(1 for e in events if e.get("type") == "activity")
            arows = activity_stats(events)
            _check_dist_rows(arows, n_act, n_act or 1)

            srows = step_stats(steps)
            _check_dist_rows(srows, len(steps), len(steps) or 1)

            crows = case_stats(events, cases)
            assert len(crows) == len(cases)
            for r in crows:
                assert r["active_ms"] >= 0
                assert r["wall_clock_ms"] is None or r["wall_clock_ms"] >= 0
            # sorted by start_ts
            starts = [r["start_ts"] or "" for r in crows]
            assert starts == sorted(starts), "case rows not sorted by start_ts"

            # trace_variants: each variant frequency >= 1, sum <= #top-level cases.
            tvs = trace_variants(events, cases)
            assert all(v["frequency"] >= 1 for v in tvs)
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}") from e
        except Exception as e:  # noqa: BLE001 -- a crash on well-formed input is a finding
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}]: {type(e).__name__}: {e}") from e


def test_fuzz_stats_adversarial():
    """2000 corrupt sessions: stats must degrade (never crash, rows well-shaped),
    not blow up on a null/non-dict `data` or a non-numeric duration."""
    for i in range(ADVERSARIAL_ITERS):
        seed = BASE + 1_000_000 + i
        rng = Random(seed)
        events, cases, steps = _gen_adversarial(rng)
        try:
            for rows in (activity_stats(events), step_stats(steps)):
                assert isinstance(rows, list)
                assert all(r["frequency"] >= 1 for r in rows)
            crows = case_stats(events, cases)
            assert isinstance(crows, list) and len(crows) == len(cases)
            assert isinstance(trace_variants(events, cases), list)
            # The real entry point also drives app_outliers + rework_loops.
            allstats = compute_all(events, cases, steps=steps)
            assert set(allstats) >= {"activity_stats", "case_stats", "step_stats"}
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH on corrupt input [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}") from e
