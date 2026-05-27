"""Seeded property-based fuzzer for the step segmenter -- the core that turns
interaction events into steps (auto_suggest_steps) and the re-analysis identity
layer (_merge_steps). This module feeds the map, the stats, AND the PDD, and is
historically the most bug-prone (step-identity inheritance, the "vanishing /
duplicated step" class), so pin its load-bearing invariants.

Headline invariant for the segmenter: every interaction lands in AT MOST one step
(disjoint) and steps reference only real event ids (subset) -- a step's evidence
can't silently double-count or invent interactions. (Not "every interaction is
stepped": flush() legitimately drops sub-min, no-typing tail candidates.)

Regimes:
  * well-formed: disjoint + subset, per-case integrity, within-case non-overlap,
    determinism (modulo the uuid step_id).
  * adversarial: events keep a dict `data` + string `timestamp` (the invariant
    _coerce_event_shape enforces before this runs) but carry corrupt VALUES
    (non-string name/control_type, bad timestamps, odd case_ids) -- robustness:
    never crash, disjoint + subset still hold.

Run: pytest normalization/test/test_step_suggest_fuzz.py
"""

from __future__ import annotations

import sys
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from step_suggest import auto_suggest_steps, _merge_steps  # noqa: E402

BASE = 0x5736
SEG_ITERS = 3000
ADV_ITERS = 2500
MERGE_ITERS = 3000

_T0 = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)
_KINDS = ["value_changed", "text_changed", "invoked", "focused", "selection_changed"]
_CTS = ["Edit", "Button", "Hyperlink", "ComboBox", "CheckBox"]
_NAMES = ["", "Search", "Save", "Submit", "Field A", "Field B", "Next", "OK"]
_AIDS = ["f1", "f2", "f3", ""]
_CASES = ["c1", "c2", None]


def _iso(t):
    return t.isoformat()


def _inter(eid, ts, *, kind, ct, name, aid, case):
    return {"event_id": eid, "type": "interaction", "timestamp": ts,
            "data": {"kind": kind, "control_type": ct, "name": name,
                     "automation_id": aid, "class_name": "", "process_name": "app.exe",
                     "window_title": "App", "case_ids": ([case] if case else [])}}


def _gen_wellformed(rng):
    n = rng.randint(0, 50)
    t = _T0
    events = []
    for i in range(n):
        t = t + timedelta(milliseconds=rng.choice([100, 500, 2000, 8000, 15000, 40000]))
        events.append(_inter("e%d" % i, _iso(t), kind=rng.choice(_KINDS), ct=rng.choice(_CTS),
                             name=rng.choice(_NAMES), aid=rng.choice(_AIDS), case=rng.choice(_CASES)))
    if rng.random() < 0.3:  # a non-interaction event must be ignored
        events.append({"event_id": "m0", "type": "marker", "timestamp": _iso(t), "data": {}})
    return events


def _corrupt_ts(rng, good):
    return rng.choice([good, good, "bad", "", "2026-13-99T00:00:00Z", str(rng.randint(0, 10 ** 9))])


def _gen_adversarial(rng):
    # Realistic corrupt-log shapes that actually reach the segmenter post-load:
    # null / missing / odd-string fields, bad timestamp CONTENT, weird case_ids,
    # out-of-order / stalled clock. (`_coerce_event_shape` guarantees a dict
    # `data` + string `timestamp`; the recorder writes string fields, so a
    # type-swapped non-string value is not a realistic scenario to assert here.)
    n = rng.randint(0, 50)
    t = _T0
    events = []
    for i in range(n):
        t = t + timedelta(milliseconds=rng.choice([-5000, 0, 0, 500, 8000, 40000]))
        d = {"kind": rng.choice(_KINDS + [None, ""]),
             "control_type": rng.choice(_CTS + [None, ""]),
             "name": rng.choice(_NAMES + [None, "  ", "x" * 150, "résumé — 文字\t"]),
             "automation_id": rng.choice(_AIDS + [None]),
             "class_name": rng.choice(["", "o365sx-Box", None]),
             "process_name": "app.exe", "window_title": "App",
             "case_ids": rng.choice([[], ["c1"], ["c1", "c2"], None])}
        if rng.random() < 0.1:
            d.pop(rng.choice(["kind", "name", "control_type"]), None)
        events.append({"event_id": "e%d" % i, "type": "interaction",
                       "timestamp": _corrupt_ts(rng, _iso(t)), "data": d})
    return events


def _check_segmentation(events, *, strict):
    steps = auto_suggest_steps(events)
    input_ids = {e["event_id"] for e in events if e.get("type") == "interaction"}
    seen = set()
    for s in steps:
        eids = s["evidence"]["interaction_event_ids"]
        assert eids, "a step has no interactions"
        assert s["state"] == "auto_suggested"
        assert "step_id" in s and "name" in s and "time_range" in s
        for eid in eids:
            assert eid in input_ids, "step references an event id not in the input (invented)"
            assert eid not in seen, "event id appears in two steps (double-count / vanish)"
            seen.add(eid)
    if not strict:
        return
    id_to_case = {}
    for e in events:
        if e.get("type") == "interaction":
            cids = e["data"].get("case_ids") or []
            id_to_case[e["event_id"]] = cids[-1] if cids else None
    by_case = defaultdict(list)
    for s in steps:
        for eid in s["evidence"]["interaction_event_ids"]:
            assert id_to_case[eid] == s["case_id"], "a step mixes interactions from different cases"
        assert s["time_range"]["start"] <= s["time_range"]["end"], "step start after end"
        by_case[s["case_id"]].append(s)
    for cs in by_case.values():
        cs.sort(key=lambda s: s["time_range"]["start"])
        for a, b in zip(cs, cs[1:]):
            assert a["time_range"]["end"] <= b["time_range"]["start"], "steps overlap within a case"
    # Determinism (modulo the uuid4 step_id).
    sig = lambda ss: [(s["case_id"], tuple(s["evidence"]["interaction_event_ids"]), s["name"]) for s in ss]
    assert sig(steps) == sig(auto_suggest_steps(events)), "auto_suggest_steps is not deterministic"


def test_fuzz_auto_suggest_wellformed():
    for i in range(SEG_ITERS):
        seed = BASE + i
        rng = Random(seed)
        events = _gen_wellformed(rng)
        try:
            _check_segmentation(events, strict=True)
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(f"CRASH [iter {i}, seed {hex(seed)}]: {type(e).__name__}: {e}") from e


def test_fuzz_auto_suggest_adversarial():
    for i in range(ADV_ITERS):
        seed = BASE + 1_000_000 + i
        rng = Random(seed)
        events = _gen_adversarial(rng)
        try:
            _check_segmentation(events, strict=False)
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH on corrupt input [iter {i}, seed {hex(seed)}]: {type(e).__name__}: {e}") from e


# --- _merge_steps: re-analysis preserves analyst work + stable identity --------


def _mstep(rng, eids, state, sid=None):
    s0 = rng.randint(0, 1000)
    return {"step_id": sid or str(uuid.uuid4()), "state": state,
            "name": rng.choice(["S", "Search", "Save order"]),
            "evidence": {"interaction_event_ids": list(eids)},
            "time_range": {"start": _iso(_T0 + timedelta(seconds=s0)),
                           "end": _iso(_T0 + timedelta(seconds=s0 + rng.randint(0, 30)))},
            "phase_id": None, "canonical_step_id": None}


def test_fuzz_merge_steps():
    """A re-analyze must never lose an analyst-owned step (manually_authored /
    edited / hidden), the merged result must have unique step_ids (the curated-
    relationship fix), and every result step gets a process_label."""
    for i in range(MERGE_ITERS):
        seed = BASE + 2_000_000 + i
        rng = Random(seed)
        pool = ["x%d" % j for j in range(rng.randint(1, 20))]

        def _some():
            k = rng.randint(0, min(5, len(pool)))
            return rng.sample(pool, k)

        existing = [_mstep(rng, _some(),
                           rng.choice(["auto_suggested", "manually_authored", "edited", "hidden"]))
                    for _ in range(rng.randint(0, 10))]
        fresh = [_mstep(rng, _some(), "auto_suggested") for _ in range(rng.randint(0, 10))]
        try:
            result = _merge_steps(existing, fresh)
            preserved_ids = {s["step_id"] for s in existing
                             if s["state"] in ("manually_authored", "edited", "hidden")}
            result_ids = [s["step_id"] for s in result]
            for pid in preserved_ids:
                assert pid in result_ids, "a preserved (analyst-owned) step was lost"
            assert len(result_ids) == len(set(result_ids)), "duplicate step_id in merge result"
            for s in result:
                assert "process_label" in s, "merge result missing process_label"
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(f"CRASH [iter {i}, seed {hex(seed)}]: {type(e).__name__}: {e}") from e
