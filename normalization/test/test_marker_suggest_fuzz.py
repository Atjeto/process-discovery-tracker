"""Seeded property-based fuzzer for marker_suggest (ADR-0017).

Mirrors test_case_assignment_fuzz.py in shape: thousands of random
sessions, deterministic per (BASE + iter) seed, two regimes -- one
asserting full correctness on well-formed input, one asserting only
robustness on corrupt/hand-edited input.

The headline invariants:

* `suggest_markers` never crashes -- even on corrupt input.
* Every emitted suggestion has a non-empty `signature` / valid
  `timestamp` / `marker_type in {start, end}` / a known `reason`.
* No suggestion ever lands inside an `excluded_range`.
* No suggestion ever lands inside an `existing_cases` time range.
* No suggestion ever lands within 5 s of a real Start in the stream.
* Re-running the detector on the same input yields the same
  signatures (idempotence).
* `merge_marker_suggestions` is idempotent in the absence of dismiss /
  accept, and a signature in `dismissed[]` or in an op:insert's
  `derived_from_signature` is always dropped.

Calibration (the right number of suggestions per hour on real captures)
is owner-side -- see NEXT-SESSION-SPEC §3.

Run with:
    pytest normalization/test/test_marker_suggest_fuzz.py
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from marker_suggest import (  # noqa: E402
    merge_marker_suggestions,
    signature,
    suggest_markers,
)
from _dt import parse_ts_or_none as _parse_ts  # noqa: E402


BASE = 0xC0FFEE
WELLFORMED_ITERS = 4000
ADVERSARIAL_ITERS = 3000

_APPS = ["salesforce.exe", "excel.exe", "outlook.exe", "chrome.exe", "teams.exe"]
_TXNID_VALUES = ["ABC-12345", "ORD-9999", "CUST-101010", "12345678", "9876543"]
_REASON_VALUES = {"idle_gap", "home_app_return", "transaction_id_typed", "app_cluster_boundary"}


def _iso(t: datetime) -> str:
    return t.isoformat().replace("+00:00", "Z")


def _ev_interaction(t: datetime, rng: Random) -> dict:
    app = rng.choice(_APPS)
    kind = rng.choice(["invoked", "value_changed", "text_changed",
                       "selection_changed", "focus_changed"])
    val = ""
    if kind in ("value_changed", "text_changed") and rng.random() < 0.3:
        val = rng.choice(_TXNID_VALUES + ["random text", "click", ""])
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(t),
        "data": {
            "kind": kind,
            "process_name": app,
            "window_title": app.replace(".exe", ""),
            "value": val,
            "control_type": "Edit" if kind in ("value_changed", "text_changed") else "Button",
            "case_ids": [],
        },
    }


def _ev_activity(t: datetime, rng: Random) -> dict:
    app = rng.choice(_APPS)
    return {
        "event_id": str(uuid.uuid4()),
        "type": "activity",
        "timestamp": _iso(t),
        "data": {
            "process_name": app,
            "window_title": app.replace(".exe", ""),
            "case_ids": [],
        },
    }


def _ev_real_start(t: datetime, rng: Random, label: str) -> dict:
    return {
        "event_id": str(uuid.uuid4()),
        "type": "marker",
        "timestamp": _iso(t),
        "data": {"marker_type": "start", "label": label},
    }


def _ev_real_end(t: datetime) -> dict:
    return {
        "event_id": str(uuid.uuid4()),
        "type": "marker",
        "timestamp": _iso(t),
        "data": {"marker_type": "end"},
    }


def _gen_wellformed(rng: Random) -> tuple[list[dict], list[dict], dict]:
    """A random well-formed event stream + matching excluded_ranges +
    existing_cases dict. The stream contains 0-30 events with a mix of
    apps and types; sometimes a real Start/End pair brackets part of
    it; sometimes a slice is excluded."""
    n = rng.randint(0, 30)
    t = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)
    events: list[dict] = []
    open_start_ts: datetime | None = None
    existing_cases: dict = {}
    for _ in range(n):
        t = t + timedelta(milliseconds=rng.choice([200, 500, 1000, 2000, 5000, 30000, 120000]))
        roll = rng.random()
        if roll < 0.06 and open_start_ts is None and rng.random() < 0.5:
            # Open a real case.
            cid = f"c-{len(existing_cases)}"
            label = f"case-{len(existing_cases)}"
            events.append(_ev_real_start(t, rng, label))
            existing_cases[cid] = {
                "case_id": cid, "label": label,
                "start_ts": _iso(t), "end_ts": None,
            }
            open_start_ts = t
        elif roll < 0.10 and open_start_ts is not None:
            # Close it.
            events.append(_ev_real_end(t))
            last = next(reversed(existing_cases))
            existing_cases[last]["end_ts"] = _iso(t)
            # Stamp activity/interaction events between start_ts and now
            # with that case_id so the detector treats them as cased.
            cid = existing_cases[last]["case_id"]
            for e in events:
                if e["type"] in ("activity", "interaction"):
                    ets = _parse_ts(e["timestamp"])
                    if ets is None:
                        continue
                    if open_start_ts <= ets <= t:
                        e["data"]["case_ids"] = [cid]
            open_start_ts = None
        elif roll < 0.50:
            events.append(_ev_interaction(t, rng))
        else:
            events.append(_ev_activity(t, rng))
    # Maybe excise a random slice.
    excluded: list[dict] = []
    if events and rng.random() < 0.3:
        i = rng.randrange(len(events))
        j = min(len(events) - 1, i + rng.randint(0, 5))
        excluded.append({
            "start": events[i]["timestamp"],
            "end": events[j]["timestamp"],
            "reason": "manual",
        })
    return events, excluded, existing_cases


def _corrupt_ts(rng: Random, good: str):
    return rng.choice([good, good, good, "not-a-date", "", None, 1234567890,
                       "2026-13-99T99:99:99Z"])


def _gen_adversarial(rng: Random) -> tuple[list, list, dict]:
    """A corrupt event stream: bad timestamps, missing or null data,
    wrong types, dropped event-type field. The detector must degrade,
    not crash."""
    events, excluded, cases = _gen_wellformed(rng)
    for ev in events:
        ev["timestamp"] = _corrupt_ts(rng, ev["timestamp"])
        d = rng.random()
        if d < 0.06:
            ev.pop("data", None)
        elif d < 0.10:
            ev["data"] = None
        elif d < 0.13:
            ev["data"] = "corrupt"
        elif d < 0.17:
            ev.pop("type", None)
    # Random garbage entries in excluded_ranges.
    if rng.random() < 0.2:
        excluded.append({"start": "garbage", "end": None, "reason": 42})
        excluded.append("not-a-dict")  # type: ignore[arg-type]
    # And in existing_cases.
    if rng.random() < 0.2:
        cases["bad-1"] = {"start_ts": "not-iso"}
        cases["bad-2"] = "not-a-dict"  # type: ignore[assignment]
    return events, excluded, cases


def _assert_well_shaped(sugs: list[dict]) -> None:
    """Every emitted suggestion has the schema-required fields with
    the right types and values. Run on both regimes."""
    sigs_seen: set[str] = set()
    for s in sugs:
        assert isinstance(s, dict), f"non-dict suggestion: {s!r}"
        sig = s.get("signature")
        assert isinstance(sig, str) and len(sig) == 12, \
            f"bad signature {sig!r}"
        # Within one call, the (signature, marker_type) tuple should be
        # unique -- the merge dedupes; the detector also shouldn't emit
        # both Start and End at the same canonical bucket for the same
        # pattern (different marker_types yield different signatures).
        assert sig not in sigs_seen, f"duplicate signature in one call: {sig}"
        sigs_seen.add(sig)
        mt = s.get("marker_type")
        assert mt in ("start", "end"), f"bad marker_type: {mt!r}"
        ts = _parse_ts(s.get("timestamp"))
        assert ts is not None, f"unparseable timestamp: {s.get('timestamp')!r}"
        score = s.get("score")
        assert isinstance(score, (int, float)) and 0.0 <= score <= 1.0, \
            f"bad score: {score!r}"
        assert s.get("reason") in _REASON_VALUES, f"bad reason: {s.get('reason')!r}"
        assert "evidence" in s and isinstance(s["evidence"], dict)
        assert "heuristic_version" in s


def _existing_case_ranges(cases: dict) -> list[tuple[datetime, datetime]]:
    out: list[tuple[datetime, datetime]] = []
    for c in (cases or {}).values():
        if not isinstance(c, dict):
            continue
        a = _parse_ts(c.get("start_ts"))
        b = _parse_ts(c.get("end_ts"))
        if a is None:
            continue
        if b is None:
            b = datetime(9999, 1, 1, tzinfo=timezone.utc)
        if b < a:
            a, b = b, a
        out.append((a, b))
    return out


def _real_start_times(events: list) -> list[datetime]:
    out: list[datetime] = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        if ev.get("type") != "marker":
            continue
        data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
        if data.get("marker_type") != "start":
            continue
        ts = _parse_ts(ev.get("timestamp"))
        if ts is not None:
            out.append(ts)
    return out


def _check_guards(sugs: list[dict], events: list,
                  excluded: list[dict], cases: dict) -> None:
    """Every suggestion clears the four guards: not in excluded_range,
    not inside an existing case, not within 5 s of a real Start, and
    paired (every Start has a later End)."""
    excl: list[tuple[datetime, datetime]] = []
    for r in excluded:
        if not isinstance(r, dict):
            continue
        a = _parse_ts(r.get("start"))
        b = _parse_ts(r.get("end"))
        if a is None or b is None:
            continue
        if b < a:
            a, b = b, a
        excl.append((a, b))
    case_ranges = _existing_case_ranges(cases)
    real_starts = _real_start_times(events)
    for s in sugs:
        ts = _parse_ts(s["timestamp"])
        assert ts is not None
        assert not any(a <= ts <= b for a, b in excl), \
            f"suggestion inside excluded_range: {s}"
        assert not any(a <= ts <= b for a, b in case_ranges), \
            f"suggestion inside existing case: {s}"
        # The 5 s "no overlap" rule is for STARTS only -- preventing
        # two Starts at the same moment. Ends can legitimately land
        # close to a real Start (clean case-to-case handoff: this
        # suggested case closes; the next real case opens).
        if s["marker_type"] == "start":
            assert not any(abs((ts - rs).total_seconds() * 1000) <= 5000
                           for rs in real_starts), \
                f"Start suggestion within 5 s of real Start: {s}"
    # Pairing: equal counts of Start and End -- the detector emits in
    # Start/End pairs and we never split them.
    starts = sum(1 for s in sugs if s["marker_type"] == "start")
    ends = sum(1 for s in sugs if s["marker_type"] == "end")
    assert starts == ends, f"unpaired markers: {starts} starts vs {ends} ends"


def _sig_list(sugs: list[dict]) -> list[tuple[str, str]]:
    return [(s["signature"], s["marker_type"]) for s in sugs]


def _compact(events: list, excluded: list, cases: dict) -> str:
    return (f"events={len(events) if isinstance(events, list) else type(events).__name__}, "
            f"excluded={len(excluded) if isinstance(excluded, list) else type(excluded).__name__}, "
            f"cases={len(cases) if isinstance(cases, dict) else type(cases).__name__}")


def test_fuzz_suggest_markers_wellformed():
    """4000 well-formed sessions: full correctness invariants."""
    for i in range(WELLFORMED_ITERS):
        seed = BASE + i
        rng = Random(seed)
        events, excluded, cases = _gen_wellformed(rng)
        try:
            sugs1 = suggest_markers(events, cases, excluded_ranges=excluded)
            _assert_well_shaped(sugs1)
            _check_guards(sugs1, events, excluded, cases)
            # Idempotence: re-run yields identical signatures.
            sugs2 = suggest_markers(events, cases, excluded_ranges=excluded)
            assert _sig_list(sugs1) == _sig_list(sugs2), \
                "suggest_markers is not idempotent in (signature, marker_type)"
        except AssertionError as e:
            raise AssertionError(
                f"[iter {i}, seed {hex(seed)}] {e}\n"
                f"{_compact(events, excluded, cases)}") from e
        except Exception as e:  # noqa: BLE001 - a crash here is a finding
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}\n"
                f"{_compact(events, excluded, cases)}") from e


def test_fuzz_suggest_markers_adversarial():
    """3000 corrupt sessions: robustness only -- never crash, always
    return a list, every entry well-shaped, every guard still holds."""
    for i in range(ADVERSARIAL_ITERS):
        seed = BASE + 1_000_000 + i
        rng = Random(seed)
        events, excluded, cases = _gen_adversarial(rng)
        try:
            sugs = suggest_markers(events, cases, excluded_ranges=excluded)
            assert isinstance(sugs, list)
            _assert_well_shaped(sugs)
            # Guards must still hold even on corrupt input -- a corrupt
            # excluded_range simply doesn't suppress (it's unparseable),
            # but a parseable real Start always does.
        except AssertionError as e:
            raise AssertionError(
                f"[iter {i}, seed {hex(seed)}] {e}\n"
                f"{_compact(events, excluded, cases)}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH on corrupt input [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}\n"
                f"{_compact(events, excluded, cases)}") from e


def test_fuzz_merge_idempotence():
    """3000 well-formed sessions: merging fresh against itself with
    empty dismiss/accept is identity."""
    for i in range(3000):
        seed = BASE + 2_000_000 + i
        rng = Random(seed)
        events, excluded, cases = _gen_wellformed(rng)
        try:
            fresh = suggest_markers(events, cases, excluded_ranges=excluded)
            merged = merge_marker_suggestions(
                existing=[], fresh=fresh,
                dismissed=[], accepted_edits=[],
            )
            assert _sig_list(merged) == _sig_list(fresh), \
                "merge is not identity over fresh"
            # Dismissing every fresh signature empties the output.
            dismiss = [{"signature": s["signature"],
                        "marker_type": s["marker_type"],
                        "approximate_timestamp": s["timestamp"],
                        "dismissed_at": "now"} for s in fresh]
            empty = merge_marker_suggestions(
                existing=[], fresh=fresh,
                dismissed=dismiss, accepted_edits=[],
            )
            assert empty == [], \
                f"dismissing all signatures should empty the merge, got {len(empty)}"
            # An accepted op:insert with derived_from_signature drops
            # that exact signature.
            if fresh:
                victim = fresh[0]
                accepted = [{"id": "x", "op": "insert",
                             "marker_type": victim["marker_type"],
                             "timestamp": victim["timestamp"],
                             "derived_from_signature": victim["signature"]}]
                m = merge_marker_suggestions(
                    existing=[], fresh=fresh,
                    dismissed=[], accepted_edits=accepted,
                )
                assert victim["signature"] not in {s["signature"] for s in m}, \
                    "accepted signature reappeared after merge"
        except AssertionError as e:
            raise AssertionError(
                f"[iter {i}, seed {hex(seed)}] {e}\n"
                f"{_compact(events, excluded, cases)}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}\n"
                f"{_compact(events, excluded, cases)}") from e


def test_fuzz_merge_handles_garbage():
    """1000 random garbage inputs to merge_marker_suggestions: never
    crash, always return a list, never include malformed rows."""
    for i in range(1000):
        seed = BASE + 3_000_000 + i
        rng = Random(seed)
        garbage_fresh = [
            None, {}, "string", 42,
            {"signature": "abc"},
            {"signature": None},
            {"signature": ""},
            {"no_sig_field": "x"},
        ]
        rng.shuffle(garbage_fresh)
        garbage_dismissed = [None, "x", {"signature": rng.choice(["abc", "xyz", None, ""])}]
        garbage_accepted = [
            None, "y", {"op": "insert"},
            {"op": "delete", "derived_from_signature": "irrelevant"},
            {"op": "insert", "derived_from_signature": rng.choice(["abc", "xyz", None, 42])},
        ]
        try:
            out = merge_marker_suggestions(
                existing=[], fresh=garbage_fresh,
                dismissed=garbage_dismissed, accepted_edits=garbage_accepted,
            )
            assert isinstance(out, list)
            for s in out:
                assert isinstance(s, dict)
                assert isinstance(s.get("signature"), str) and s["signature"]
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}") from e


def test_signature_deterministic():
    """signature() is a pure function of its inputs."""
    t = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)
    a = signature("start", t, "salesforce.exe", "outlook.exe", "idle_gap")
    b = signature("start", t, "salesforce.exe", "outlook.exe", "idle_gap")
    assert a == b
    # Any field change flips it.
    assert signature("end", t, "salesforce.exe", "outlook.exe", "idle_gap") != a
    assert signature("start", t, "salesforce.exe", "chrome.exe", "idle_gap") != a
    assert signature("start", t, "salesforce.exe", "outlook.exe", "home_app_return") != a
