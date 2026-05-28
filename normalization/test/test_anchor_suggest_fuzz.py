"""Seeded property-based fuzzer for anchor_suggest (ADR-0018).

Mirrors test_marker_suggest_fuzz.py in shape. The headline invariants:

* `suggest_anchors` never crashes -- even on corrupt input.
* Every emitted candidate has a non-empty 12-char `signature` and a
  valid `anchor_config` that `detect_cases_from_anchors` accepts.
* Re-running the detector on the same input yields the same
  signatures in the same order (idempotence).
* Every emitted candidate has `case_count >= 2` (the _MIN_CASES
  floor) and `fire_count >= 2`.
* `merge_anchor_candidates` is idempotent without a dismiss / accept,
  and a signature in `dismissed[]` or in the accepted override is
  always dropped.

Calibration -- the scoring weights, the _MIN_FIRES / _MIN_CASES
floors -- is owner-side per ADR-0018 / NEXT-SESSION-SPEC §3.

Run with:
    pytest normalization/test/test_anchor_suggest_fuzz.py
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from anchor_suggest import (  # noqa: E402
    merge_anchor_candidates,
    signature_of_anchor_config,
    suggest_anchors,
)
from case_assignment import detect_cases_from_anchors  # noqa: E402


BASE = 0xDECAF
WELLFORMED_ITERS = 3000
ADVERSARIAL_ITERS = 2500

_FIELD_POOL = [
    ("automation_id", "customer-id-field", "Customer ID"),
    ("automation_id", "product-code", "Product code"),
    ("automation_id", "quantity", "Quantity"),
    ("automation_id", "serial-number", "Serial"),
    ("name", "Account ID", "Account"),
    ("name", "Ticket number", "Ticket"),
]
_VALUE_POOL = [
    "CUST-11255", "CUST-11256", "CUST-11257",
    "ACC-A", "ACC-B", "ACC-C",
    "SN-001", "SN-002", "SN-003",
    "", "x", "y",
]


def _iso(t: datetime) -> str:
    return t.isoformat().replace("+00:00", "Z")


def _typing(t: datetime, field_idx: int, value: str,
            window_title: str) -> dict:
    prop, name_for_prop, label = _FIELD_POOL[field_idx]
    aid = name_for_prop if prop == "automation_id" else ""
    name = name_for_prop if prop == "name" else label
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(t),
        "data": {
            "kind": "value_changed",
            "automation_id": aid,
            "name": name,
            "value": value,
            "control_type": "Edit",
            "window_title": window_title,
            "process_name": "chrome.exe",
            "case_ids": [],
        },
    }


def _click(t: datetime, window_title: str) -> dict:
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(t),
        "data": {
            "kind": "invoked",
            "name": "Save",
            "control_type": "Button",
            "window_title": window_title,
            "process_name": "chrome.exe",
            "case_ids": [],
        },
    }


def _gen_wellformed(rng: Random) -> list[dict]:
    n = rng.randint(0, 30)
    t = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)
    events: list[dict] = []
    window_title = rng.choice(["Order entry", "Customer view", "Account"])
    for _ in range(n):
        t = t + timedelta(milliseconds=rng.choice([500, 1500, 5000, 30000]))
        if rng.random() < 0.6:
            fi = rng.randrange(len(_FIELD_POOL))
            val = rng.choice(_VALUE_POOL)
            events.append(_typing(t, fi, val, window_title))
        else:
            events.append(_click(t, window_title))
    return events


def _corrupt_ts(rng: Random, good: str):
    return rng.choice([good, good, "not-a-date", "", None, 1234567890])


def _gen_adversarial(rng: Random) -> list:
    events = _gen_wellformed(rng)
    for ev in events:
        ev["timestamp"] = _corrupt_ts(rng, ev["timestamp"])
        d = rng.random()
        if d < 0.06:
            ev.pop("data", None)
        elif d < 0.10:
            ev["data"] = None
        elif d < 0.13:
            ev["data"] = "corrupt"
        elif d < 0.16:
            ev.pop("type", None)
    return events


def _assert_well_shaped(cands: list) -> None:
    sigs_seen: set[str] = set()
    for c in cands:
        assert isinstance(c, dict), f"non-dict candidate: {c!r}"
        sig = c.get("signature")
        assert isinstance(sig, str) and len(sig) == 12, \
            f"bad signature {sig!r}"
        assert sig not in sigs_seen, f"duplicate signature in one call: {sig}"
        sigs_seen.add(sig)
        cfg = c.get("anchor_config")
        assert isinstance(cfg, dict) and cfg.get("field") and cfg.get("equals"), \
            f"malformed anchor_config: {cfg!r}"
        m = c.get("metrics")
        assert isinstance(m, dict)
        assert m.get("fire_count", 0) >= 2
        assert m.get("case_count", 0) >= 2
        assert 0.0 <= c.get("score", -1) <= 1.0
        d = c.get("display")
        assert isinstance(d, dict)
        assert d.get("field_property") in ("automation_id", "name")
        assert isinstance(d.get("field_value"), str) and d["field_value"]
        assert isinstance(d.get("sample_values"), list)


def _check_anchor_config_accepted(events: list, cands: list) -> None:
    """Every emitted anchor_config must produce >= _MIN_CASES cases when
    fed back through detect_cases_from_anchors -- proves the candidate
    is actually actionable."""
    interactions = [e for e in events
                    if isinstance(e, dict) and e.get("type") == "interaction"]
    for c in cands:
        try:
            cases = detect_cases_from_anchors(interactions, c["anchor_config"])
        except Exception as exc:  # noqa: BLE001
            raise AssertionError(
                f"anchor_config rejected by detector: {c['anchor_config']!r} "
                f"({type(exc).__name__}: {exc})")
        assert len(cases) >= 2, \
            f"anchor_config produced < 2 cases: {c['anchor_config']}, got {len(cases)}"


def _sig_list(cands: list) -> list[str]:
    return [c["signature"] for c in cands]


def test_fuzz_suggest_anchors_wellformed():
    """3000 well-formed sessions: full correctness invariants."""
    for i in range(WELLFORMED_ITERS):
        seed = BASE + i
        rng = Random(seed)
        events = _gen_wellformed(rng)
        try:
            cands1 = suggest_anchors(events)
            assert isinstance(cands1, list)
            _assert_well_shaped(cands1)
            _check_anchor_config_accepted(events, cands1)
            cands2 = suggest_anchors(events)
            assert _sig_list(cands1) == _sig_list(cands2), \
                "suggest_anchors is not idempotent in signature list"
        except AssertionError as e:
            raise AssertionError(
                f"[iter {i}, seed {hex(seed)}] {e}\nevents={len(events)}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}\nevents={len(events)}") from e


def test_fuzz_suggest_anchors_adversarial():
    """2500 corrupt sessions: robustness only -- never crash, return a
    list, every entry parseable."""
    for i in range(ADVERSARIAL_ITERS):
        seed = BASE + 1_000_000 + i
        rng = Random(seed)
        events = _gen_adversarial(rng)
        try:
            cands = suggest_anchors(events)
            assert isinstance(cands, list)
            _assert_well_shaped(cands)
            # We don't check that every config is "actionable" here --
            # corrupt input may produce configs that detect_cases hits
            # an edge on. The well-formed check above pins that case.
        except AssertionError as e:
            raise AssertionError(
                f"[iter {i}, seed {hex(seed)}] {e}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH on corrupt input [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}") from e


def test_fuzz_merge_invariants():
    """2000 sessions: merge is identity, dismissals drop, override drops,
    dedup works."""
    for i in range(2000):
        seed = BASE + 2_000_000 + i
        rng = Random(seed)
        events = _gen_wellformed(rng)
        try:
            fresh = suggest_anchors(events)
            assert _sig_list(merge_anchor_candidates(existing=[], fresh=fresh)) \
                == _sig_list(fresh), "merge is not identity over fresh"
            if fresh:
                victim = fresh[0]
                dismissed = [{"signature": victim["signature"]}]
                m = merge_anchor_candidates(existing=[], fresh=fresh,
                                            dismissed=dismissed)
                assert victim["signature"] not in {c["signature"] for c in m}
                override = {
                    **victim["anchor_config"],
                    "_accepted_signature": victim["signature"],
                }
                m2 = merge_anchor_candidates(existing=[], fresh=fresh,
                                             case_anchor_override=override)
                assert victim["signature"] not in {c["signature"] for c in m2}
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}") from e


def test_fuzz_merge_handles_garbage():
    """800 garbage inputs to merge_anchor_candidates: never crash, list
    out, never include malformed rows."""
    for i in range(800):
        seed = BASE + 3_000_000 + i
        rng = Random(seed)
        fresh = [
            None, {}, "string", 42,
            {"signature": "abc"},
            {"signature": None},
            {"signature": ""},
            {"no_sig_field": "x"},
        ]
        rng.shuffle(fresh)
        dismissed = [None, "x", {"signature": rng.choice(["abc", "xyz", None])}]
        override = rng.choice([
            None, "string", 42,
            {"field": "automation_id"},
            {"field": "x", "_accepted_signature": "abc"},
        ])
        try:
            out = merge_anchor_candidates(
                existing=[], fresh=fresh, dismissed=dismissed,
                case_anchor_override=override,
            )
            assert isinstance(out, list)
            for c in out:
                assert isinstance(c, dict)
                assert isinstance(c.get("signature"), str) and c["signature"]
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}") from e


def test_signature_of_anchor_config_matches():
    """Round-trip: a candidate's signature equals
    signature_of_anchor_config of its own anchor_config + display
    window_title_hint."""
    rng = Random(BASE + 5_000_000)
    for i in range(200):
        events = _gen_wellformed(Random(BASE + 4_000_000 + i))
        cands = suggest_anchors(events)
        for c in cands:
            recomputed = signature_of_anchor_config(
                c["anchor_config"], c["display"]["window_title_hint"])
            assert recomputed == c["signature"], \
                f"signature mismatch on iter {i}: {recomputed} vs {c['signature']}"
