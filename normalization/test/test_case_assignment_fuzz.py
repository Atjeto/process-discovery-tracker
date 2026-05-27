"""Seeded property-based fuzzer for case assignment (anchor + marker paths).

Companion to the example-based `test_anchor_cases.py`. Where those pin specific
scenarios, this generates thousands of randomized sessions and asserts the
*invariants* that must hold for any input -- the class of bug that hand-written
examples and the demo session miss (the project's recurring failure mode).

Deterministic by construction: every iteration is driven by `Random(BASE + i)`,
so a failure prints the exact iteration/seed to reproduce in isolation. Pair any
finding here with a named regression test in `test_anchor_cases.py`.

Two regimes, per the robustness-vs-calibration distinction:
  * **well-formed** (strict): monotonic, distinct, ISO timestamps + well-shaped
    events. Full correctness invariants -- the headline one being that the two
    independent attributions agree (`interaction_count` from active-case
    accounting == events stamped to that case by segment membership).
  * **adversarial**: corrupt/truncated/hand-edited logs (bad timestamps, missing
    or null `data`, wrong types, out-of-order). Assert only *robustness*: never
    crash, never lose/duplicate/reorder an event, never emit >1 case per event.

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
    _ANCHOR_NS,
    _parse_ts,
    assign_case_ids,
    collect_cases,
    detect_cases_from_anchors,
    stamp_anchor_cases,
)

BASE = 0xC0FFEE
DETECT_STAMP_ITERS = 4000
ADVERSARIAL_ITERS = 3000
MARKER_ITERS = 3000

_LABELS = ["SN-A", "SN-B", "SN-C", "SN-D"]
_MAX_DT = datetime.max.replace(tzinfo=timezone.utc)

EXPLICIT_CFG = {
    "field": "automation_id",
    "equals": "txtsr",
    "case_label_from": "value",
    "min_case_interactions": 2,
    "min_case_duration_ms": 1000,
}
RECOGNIZED_CFG = {
    "recognized": "search",
    "case_label_from": "value",
    "min_case_interactions": 2,
    "min_case_duration_ms": 1000,
}


def _iso(t: datetime) -> str:
    return t.replace(tzinfo=timezone.utc).isoformat()


def _anchor_inter(ts: str, cfg_kind: str, label: str) -> dict:
    """An interaction that FIRES the anchor for the given cfg kind."""
    data = {"kind": "value_changed", "control_type": "Edit", "value": label}
    if cfg_kind == "explicit":
        data["automation_id"] = "txtsr"
    else:  # recognized "search" -- an Office 365 search box (class o365sx-)
        data["class_name"] = "o365sx-SearchBox"
    return {"event_id": str(uuid.uuid4()), "type": "interaction", "timestamp": ts, "data": data}


def _plain_inter(ts: str) -> dict:
    """An interaction that does NOT fire either anchor (plain Edit, no id/class)."""
    return {
        "event_id": str(uuid.uuid4()), "type": "interaction", "timestamp": ts,
        "data": {"kind": "value_changed", "control_type": "Edit",
                 "automation_id": "", "class_name": "", "value": "work"},
    }


def _activity(ts: str) -> dict:
    return {
        "event_id": str(uuid.uuid4()), "type": "activity", "timestamp": ts,
        "data": {"app": "chrome.exe", "title": "App", "duration_ms": 1000},
    }


def _passthrough(ts: str, rng: Random) -> dict:
    """A non-interaction/non-activity event -- stamp_anchor_cases must pass it
    through verbatim and never attach a case_id."""
    return {"event_id": str(uuid.uuid4()), "type": rng.choice(["system", "screenshot"]),
            "timestamp": ts, "data": {"note": "passthrough"}}


def _gen_wellformed(rng: Random, cfg_kind: str) -> list[dict]:
    """Strictly-increasing, well-shaped event stream (interactions, activities,
    passthroughs). Anchors fire on a small label pool so re-hits + interleaves
    happen; empty-label fires (the empty search box) are mixed in."""
    n = rng.randint(0, 30)
    t = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)
    events: list[dict] = []
    for _ in range(n):
        t = t + timedelta(milliseconds=rng.choice([200, 500, 1000, 2000, 5000, 30000, 120000]))
        ts = _iso(t)
        roll = rng.random()
        if roll < 0.15:
            events.append(_passthrough(ts, rng))
        elif roll < 0.35:
            events.append(_activity(ts))
        elif rng.random() < 0.45:
            label = rng.choice(_LABELS + [""])  # "" == empty-box fire
            events.append(_anchor_inter(ts, cfg_kind, label))
        else:
            events.append(_plain_inter(ts))
    return events


def _corrupt_ts(rng: Random, good: str):
    """A timestamp from a corrupt/hand-edited log."""
    return rng.choice([good, good, "not-a-date", "", None, 1234567890,
                       "2026-13-99T99:99:99Z"])


def _gen_adversarial(rng: Random, cfg_kind: str) -> list[dict]:
    """Like well-formed but with the damage a truncated/hand-edited log carries:
    bad/duplicate/out-of-order timestamps, missing or null `data`, wrong value
    types, unknown event types."""
    n = rng.randint(0, 30)
    t = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)
    events: list[dict] = []
    for _ in range(n):
        # Clock may stall, jump, or run backwards.
        t = t + timedelta(milliseconds=rng.choice([-5000, 0, 0, 500, 2000, 90000]))
        ts = _corrupt_ts(rng, _iso(t))
        roll = rng.random()
        if roll < 0.12:
            ev = _passthrough(_iso(t), rng)
            ev["timestamp"] = ts
            events.append(ev)
            continue
        if roll < 0.30:
            ev = _activity(_iso(t))
            ev["timestamp"] = ts
            events.append(ev)
        elif rng.random() < 0.5:
            label = rng.choice(_LABELS + ["", None, 42])
            ev = _anchor_inter(ts, cfg_kind, label if isinstance(label, str) else "")
            ev["data"]["value"] = label  # may be None / int
            events.append(ev)
        else:
            events.append(_plain_inter(ts))
        # Damage the just-appended event's `data`.
        d = rng.random()
        if d < 0.06:
            events[-1].pop("data", None)
        elif d < 0.10:
            events[-1]["data"] = None
        elif d < 0.13:
            events[-1]["data"] = "corrupt-not-a-dict"
        elif d < 0.16:
            events[-1].pop("type", None)
    return events


def _cases_repr(cases: list[dict]):
    return tuple(
        (c["case_id"], c["label"], c["start_ts"], c["end_ts"],
         tuple(tuple(s) for s in c["segments"]), c["interaction_count"])
        for c in cases
    )


def _stamp_repr(stamped: list[dict]):
    return tuple(
        (e.get("event_id"), e.get("type"),
         tuple(e.get("data", {}).get("case_ids", [])) if isinstance(e.get("data"), dict) else None)
        for e in stamped
    )


def _compact(events: list[dict]) -> str:
    rows = []
    for e in events:
        d = e.get("data") if isinstance(e.get("data"), dict) else {}
        rows.append((e.get("type"), e.get("timestamp"),
                     d.get("automation_id"), d.get("class_name"), d.get("value")))
    return repr(rows)


def _check_detect_stamp(events: list[dict], cfg: dict, *, strict: bool) -> None:
    interactions = [e for e in events if e.get("type") == "interaction"]

    cases = detect_cases_from_anchors(interactions, cfg)
    # Determinism: identical input -> byte-identical result.
    assert _cases_repr(cases) == _cases_repr(detect_cases_from_anchors(interactions, cfg)), \
        "detect_cases_from_anchors is not deterministic"

    min_int = cfg.get("min_case_interactions", 2)
    min_dur = cfg.get("min_case_duration_ms", 1000)

    seen_ids: set[str] = set()
    for c in cases:
        assert c["label"], "kept case has an empty label"
        assert c["case_id"] == str(uuid.uuid5(_ANCHOR_NS, c["label"])), \
            "case_id is not uuid5(NS, label) -- per-label stability broken"
        assert c["case_id"] not in seen_ids, "duplicate case_id among kept cases"
        seen_ids.add(c["case_id"])
        assert c["interaction_count"] >= min_int, \
            f"kept case {c['label']} below min_case_interactions ({c['interaction_count']} < {min_int})"
        assert c["segments"], "kept case has no active segments"
    assert len({c["label"] for c in cases}) == len(cases), "label collision among kept cases"

    if strict:
        # Each kept case cleared BOTH guard thresholds.
        for c in cases:
            dur = (_parse_ts(c["end_ts"]) - _parse_ts(c["start_ts"])).total_seconds() * 1000
            assert dur >= min_dur, f"kept case {c['label']} below min_case_duration_ms ({dur} < {min_dur})"
        # Active segments tile the timeline without overlap (the property
        # stamp_anchor_cases relies on for single-attribution).
        flat = []
        for c in cases:
            prev_end = None
            for s, e in c["segments"]:
                ps, pe = _parse_ts(s), (_parse_ts(e) if e else _MAX_DT)
                assert ps <= pe, f"segment start after end in {c['label']}"
                if prev_end is not None:
                    assert prev_end <= ps, f"a case's own segments overlap ({c['label']})"
                prev_end = pe
                flat.append((ps, pe))
        flat.sort()
        for (s1, e1), (s2, e2) in zip(flat, flat[1:]):
            assert e1 <= s2, "active segments of different cases overlap"

    stamped, cases_map = stamp_anchor_cases(events, cases)
    assert _stamp_repr(stamped) == _stamp_repr(stamp_anchor_cases(events, cases)[0]), \
        "stamp_anchor_cases is not deterministic"

    # Conservation: every event preserved, in order, with identity intact.
    assert len(stamped) == len(events), "stamp_anchor_cases changed the event count"
    valid_ids = {c["case_id"] for c in cases}
    for orig, st in zip(events, stamped):
        assert orig.get("event_id") == st.get("event_id"), "event reordered or identity lost"
        assert orig.get("type") == st.get("type"), "event type changed"
        if st.get("type") in ("interaction", "activity"):
            cids = st["data"]["case_ids"]
            assert isinstance(cids, list) and len(cids) <= 1, "an event got more than one case_id"
            if cids:
                assert cids[0] in valid_ids, "event stamped with an unknown case_id"
        else:
            assert st["data"] == orig.get("data"), "a passthrough event's data was mutated"

    if strict:
        # The headline cross-check: the two INDEPENDENT attributions agree.
        # interaction_count comes from active-case accounting during detection;
        # the stamp count comes from segment membership. They must match per case.
        stamped_int: dict[str, int] = {}
        for st in stamped:
            if st.get("type") == "interaction":
                cids = st["data"]["case_ids"]
                if cids:
                    stamped_int[cids[0]] = stamped_int.get(cids[0], 0) + 1
        for c in cases:
            assert stamped_int.get(c["case_id"], 0) == c["interaction_count"], (
                f"attribution disagreement for {c['label']}: "
                f"detect counted {c['interaction_count']}, stamp attributed "
                f"{stamped_int.get(c['case_id'], 0)}")
        assert sum(stamped_int.values()) == sum(c["interaction_count"] for c in cases), \
            "total stamped interactions != sum of kept interaction_counts (work lost or double-counted)"

        # cases_map.activity_event_ids must equal the activities actually stamped.
        stamped_act: dict[str, int] = {}
        for st in stamped:
            if st.get("type") == "activity":
                cids = st["data"]["case_ids"]
                if cids:
                    stamped_act[cids[0]] = stamped_act.get(cids[0], 0) + 1
        for cid, rec in cases_map.items():
            assert len(rec["activity_event_ids"]) == stamped_act.get(cid, 0), \
                f"activity_event_ids for {rec['label']} disagrees with stamped activities"


def test_fuzz_anchor_detect_and_stamp_wellformed():
    """4000 well-formed sessions across both anchor kinds: full correctness."""
    for i in range(DETECT_STAMP_ITERS):
        seed = BASE + i
        rng = Random(seed)
        cfg_kind = "explicit" if i % 2 == 0 else "recognized"
        cfg = EXPLICIT_CFG if cfg_kind == "explicit" else RECOGNIZED_CFG
        events = _gen_wellformed(rng, cfg_kind)
        try:
            _check_detect_stamp(events, cfg, strict=True)
        except AssertionError as e:
            raise AssertionError(
                f"[iter {i}, seed {hex(seed)}, cfg={cfg_kind}] {e}\nEVENTS={_compact(events)}") from e
        except Exception as e:  # noqa: BLE001 -- a crash on well-formed input is itself a finding
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}, cfg={cfg_kind}]: "
                f"{type(e).__name__}: {e}\nEVENTS={_compact(events)}") from e


def test_fuzz_anchor_detect_and_stamp_adversarial():
    """3000 corrupt/hand-edited sessions: robustness only -- never crash, never
    lose/duplicate/reorder an event, never emit >1 case per event."""
    for i in range(ADVERSARIAL_ITERS):
        seed = BASE + 1_000_000 + i
        rng = Random(seed)
        cfg_kind = "explicit" if i % 2 == 0 else "recognized"
        cfg = EXPLICIT_CFG if cfg_kind == "explicit" else RECOGNIZED_CFG
        events = _gen_adversarial(rng, cfg_kind)
        try:
            _check_detect_stamp(events, cfg, strict=False)
        except AssertionError as e:
            raise AssertionError(
                f"[iter {i}, seed {hex(seed)}, cfg={cfg_kind}] {e}\nEVENTS={_compact(events)}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH on corrupt input [iter {i}, seed {hex(seed)}, cfg={cfg_kind}]: "
                f"{type(e).__name__}: {e}\nEVENTS={_compact(events)}") from e


# --- Marker-based case nesting (assign_case_ids + collect_cases) ---


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
    """Replay the marker stack to predict each activity's case-id depth."""
    depths, depth = [], 0
    for ev in events:
        if ev["type"] == "marker":
            mt = ev["data"].get("marker_type")
            if mt == "start":
                depth += 1
            elif mt == "end" and depth > 0:
                depth -= 1
        elif ev["type"] == "activity":
            depths.append(depth)
    return depths


def test_fuzz_marker_case_assignment():
    """3000 marker streams: assign_case_ids must preserve every event, stamp
    activities with the correct nesting depth (innermost first), and never
    crash on an unbalanced stream (a stray end / a marker left open)."""
    for i in range(MARKER_ITERS):
        seed = BASE + 2_000_000 + i
        rng = Random(seed)
        events = _gen_markers(rng)
        try:
            out = assign_case_ids(events)
            assert len(out) == len(events), "assign_case_ids changed the event count"
            # Determinism modulo the fresh uuid4 on start markers: check structure
            # (types/order preserved, activity depths correct).
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
