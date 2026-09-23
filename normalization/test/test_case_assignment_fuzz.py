"""Seeded property-based fuzzer for marker-based case assignment.

Companion to the example-based `test_case_assignment.py`. Where that pins
specific scenarios, this generates thousands of randomized marker streams and
asserts the *invariants* that must hold for any input -- the class of bug that
hand-written examples and the demo session miss (the project's recurring
failure mode).

Deterministic by construction: every iteration is driven by `Random(BASE + i)`,
so a failure prints the exact iteration/seed to reproduce in isolation. Pair any
finding here with a named regression test in `test_case_assignment.py`.

Two regimes, per the robustness-vs-calibration distinction:
  * **well-formed** (strict): every event preserved, each activity stamped
    with the case-id depth the replayed markers predict (runs never nest), and
    collect_cases neither losing nor inventing a case.
  * **adversarial**: corrupt/truncated/hand-edited logs (bad timestamps,
    missing or null `data`, dropped type). Assert only *robustness*: never
    crash, never lose an event.

Run with:
    pytest normalization/test/test_case_assignment_fuzz.py
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from case_assignment import (  # noqa: E402
    assign_case_ids,
    collect_cases,
)

BASE = 0xC0FFEE
MARKER_ITERS = 3000


def _iso(t: datetime) -> str:
    return t.replace(tzinfo=timezone.utc).isoformat()


def _corrupt_ts(rng: Random, good: str):
    """A timestamp from a corrupt/hand-edited log."""
    return rng.choice([good, good, "not-a-date", "", None, 1234567890,
                       "2026-13-99T99:99:99Z"])


def _compact(events: list[dict]) -> str:
    rows = []
    for e in events:
        d = e.get("data") if isinstance(e.get("data"), dict) else {}
        rows.append((e.get("type"), e.get("timestamp"),
                     d.get("automation_id"), d.get("class_name"), d.get("value")))
    return repr(rows)


# --- Marker-based runs (assign_case_ids + collect_cases) ---


def _gen_markers(rng: Random) -> list[dict]:
    """A random start/end-marker + activity stream, deliberately unbalanced
    (stray ends, markers left open) to probe the stack walk."""
    n = rng.randint(0, 30)
    t = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)
    events: list[dict] = []
    label_n = 0
    for _ in range(n):
        t = t + timedelta(seconds=rng.choice([1, 5, 30]))
        ts = _iso(t)
        roll = rng.random()
        if roll < 0.4:
            label_n += 1
            events.append({"event_id": str(uuid.uuid4()), "type": "marker", "timestamp": ts,
                           "data": {"marker_type": "start", "label": f"case-{label_n}"}})
        elif roll < 0.7:  # end (possibly with an empty stack -> stray end)
            events.append({"event_id": str(uuid.uuid4()), "type": "marker", "timestamp": ts,
                           "data": {"marker_type": "end", "reason": "done"}})
        else:
            events.append({"event_id": str(uuid.uuid4()), "type": "activity", "timestamp": ts,
                           "data": {"app": "x", "title": "y", "duration_ms": 100}})
    return events


def _expected_depths(events: list[dict]) -> list[int]:
    """Replay the markers to predict each activity's case-id depth. Runs never
    nest: a start ends the open run first, so the depth is 0 or 1."""
    depths, depth = [], 0
    for ev in events:
        if ev["type"] == "marker":
            mt = ev["data"].get("marker_type")
            if mt == "start":
                depth = 1
            elif mt == "end" and depth > 0:
                depth -= 1
        elif ev["type"] == "activity":
            depths.append(depth)
    return depths


def test_fuzz_marker_case_assignment():
    """3000 marker streams: assign_case_ids must preserve every event, stamp
    activities with the open run's case id (runs never nest), and never crash
    on an unbalanced stream (a stray end / a marker left open)."""
    for i in range(MARKER_ITERS):
        seed = BASE + 2_000_000 + i
        rng = Random(seed)
        events = _gen_markers(rng)
        try:
            out = assign_case_ids(events)
            assert len(out) == len(events), "assign_case_ids changed the event count"
            # Check structure (types/order preserved, activity depths correct);
            # case-id determinism is pinned in test_case_assignment.py.
            expected = _expected_depths(events)
            act_depths = [len(e["data"]["case_ids"]) for e in out if e["type"] == "activity"]
            assert act_depths == expected, \
                f"activity case-id depths {act_depths} != replayed stack {expected}"
            for e in out:
                if e["type"] == "activity":
                    cids = e["data"]["case_ids"]
                    assert len(set(cids)) == len(cids), "duplicate case_id in an activity's stack"
            cases = collect_cases(out)
            # Every started case is collected; every collected activity id is real.
            started = sum(1 for e in events
                          if e["type"] == "marker" and e["data"].get("marker_type") == "start")
            assert len(cases) == started, "collect_cases lost or invented a case"
            # Runs never nest: every run but the last one started has an end.
            assert all(c["end_ts"] for c in list(cases.values())[:-1]), \
                "a run was left open under a later run"
            real_ids = {e["event_id"] for e in out if e["type"] == "activity"}
            for c in cases.values():
                for aid in c.get("activity_event_ids", []):
                    assert aid in real_ids, "collect_cases referenced a non-existent activity"
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}\nEVENTS={_compact(events)}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}]: {type(e).__name__}: {e}\n"
                f"EVENTS={_compact(events)}") from e


def _gen_markers_adversarial(rng: Random) -> list[dict]:
    """Marker/activity stream with corrupt-log damage (bad timestamps, missing
    or null/non-dict `data`, dropped type)."""
    events = _gen_markers(rng)
    for ev in events:
        ev["timestamp"] = _corrupt_ts(rng, ev["timestamp"])
        d = rng.random()
        if d < 0.10:
            ev.pop("data", None)
        elif d < 0.18:
            ev["data"] = None
        elif d < 0.24:
            ev["data"] = "corrupt-not-a-dict"
        elif d < 0.30:
            ev.pop("type", None)
    return events


def test_fuzz_marker_case_assignment_adversarial():
    """3000 corrupt marker streams: assign_case_ids and collect_cases must
    degrade (never crash, every event preserved), not blow up on a null/non-dict
    `data` -- the sibling of the anchor-path crash this suite first found."""
    for i in range(MARKER_ITERS):
        seed = BASE + 3_000_000 + i
        rng = Random(seed)
        events = _gen_markers_adversarial(rng)
        try:
            out = assign_case_ids(events)
            assert len(out) == len(events), "assign_case_ids changed the event count"
            collect_cases(out)  # must not crash on degraded data
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}\nEVENTS={_compact(events)}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH on corrupt input [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}\nEVENTS={_compact(events)}") from e
