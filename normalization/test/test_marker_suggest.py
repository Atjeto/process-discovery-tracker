"""Deterministic regression tests for marker_suggest (ADR-0017).

Named scenarios against hand-built fixtures -- the seeded fuzzer in
test_marker_suggest_fuzz.py covers robustness; this file covers
behaviour. Fixtures are independent of any committed demo data so the
suite stays stable across session-folder refreshes.
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from marker_suggest import (  # noqa: E402
    merge_marker_suggestions,
    signature,
    suggest_markers,
)
from case_assignment import assign_case_ids, collect_cases  # noqa: E402

# normalize.py transitively imports pandas / pm4py via xes_export. The
# system Python the suite runs against may not have those; the end-to-end
# test that needs `apply_marker_edits` skips when the import fails. Every
# other test runs deps-free.
try:
    from normalize import apply_marker_edits  # noqa: E402
    _NORMALIZE_OK = True
    _NORMALIZE_IMPORT_ERR = None
except Exception as exc:  # pragma: no cover - optional heavy deps absent
    _NORMALIZE_OK = False
    _NORMALIZE_IMPORT_ERR = repr(exc)
    apply_marker_edits = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Fixture helpers

T0 = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)


def _iso(t: datetime) -> str:
    return t.isoformat().replace("+00:00", "Z")


def _at(seconds: float) -> str:
    return _iso(T0 + timedelta(seconds=seconds))


def _interaction(
    seconds: float, app: str, *, value: str = "", kind: str = "invoked",
    name: str = "", automation_id: str = "",
) -> dict:
    return {
        "event_id": f"i-{uuid.uuid4().hex[:8]}",
        "type": "interaction",
        "timestamp": _at(seconds),
        "data": {
            "kind": kind,
            "process_name": app,
            "window_title": app.replace(".exe", ""),
            "value": value,
            "name": name,
            "automation_id": automation_id,
            "control_type": "Edit" if kind in ("value_changed", "text_changed") else "Button",
            "case_ids": [],
        },
    }


def _activity(seconds: float, app: str) -> dict:
    return {
        "event_id": f"a-{uuid.uuid4().hex[:8]}",
        "type": "activity",
        "timestamp": _at(seconds),
        "data": {
            "process_name": app,
            "window_title": app.replace(".exe", ""),
            "case_ids": [],
        },
    }


def _start_marker(seconds: float, label: str) -> dict:
    return {
        "event_id": f"m-{uuid.uuid4().hex[:8]}",
        "type": "marker",
        "timestamp": _at(seconds),
        "data": {"marker_type": "start", "label": label},
    }


def _end_marker(seconds: float) -> dict:
    return {
        "event_id": f"m-{uuid.uuid4().hex[:8]}",
        "type": "marker",
        "timestamp": _at(seconds),
        "data": {"marker_type": "end"},
    }


def _home_return_stream(n_cases: int = 3) -> list[dict]:
    """A worker-day stream: salesforce.exe is the dashboard the worker
    returns to after each sub-task. Cases are separated by a 90 s idle.

    Pattern per case (24 events): 6 in sf, 4 in excel, 4 back in sf,
    4 in outlook, then 6 more in sf. Across cases the sf share is
    ~67% (the home-app definition wants the top app at >=40%).
    """
    events: list[dict] = []
    t = 0.0
    for _ in range(n_cases):
        # In sf (dashboard).
        for _ in range(6):
            events.append(_interaction(t, "salesforce.exe"))
            t += 2.0
        # Sub-task in excel.
        for _ in range(4):
            events.append(_interaction(t, "excel.exe"))
            t += 2.0
        # Back to sf (home-app return -- the boundary candidate).
        for _ in range(4):
            events.append(_interaction(t, "salesforce.exe"))
            t += 2.0
        # Sub-task in outlook.
        for _ in range(4):
            events.append(_interaction(t, "outlook.exe"))
            t += 2.0
        # Wrap-up in sf, then case ends in a long idle.
        for _ in range(6):
            events.append(_interaction(t, "salesforce.exe"))
            t += 2.0
        t += 90.0
    return events


# ---------------------------------------------------------------------------
# Empty / trivial inputs

def test_empty_events_returns_empty():
    assert suggest_markers([], {}) == []


def test_all_cased_events_returns_empty():
    """Events already attributed to a case must not produce suggestions
    -- the detector explicitly skips the inside of existing cases."""
    e = _interaction(0, "salesforce.exe")
    e["data"]["case_ids"] = ["case-1"]
    assert suggest_markers([e, e, e, e, e], {}) == []


# ---------------------------------------------------------------------------
# Signal coverage

def test_emits_on_transaction_id():
    """A value_changed carrying a transaction-ID-like value fires the
    txn-id signal and surfaces a Start at or near that row."""
    events = []
    t = 0.0
    # Some context.
    for _ in range(5):
        events.append(_interaction(t, "salesforce.exe"))
        t += 2.0
    # Type a customer ID.
    events.append(_interaction(t, "salesforce.exe",
                               value="ABC-12345", kind="value_changed",
                               name="customer-id", automation_id="customer-id"))
    t += 2.0
    # More work after.
    for _ in range(8):
        events.append(_interaction(t, "salesforce.exe"))
        t += 2.0

    sugs = suggest_markers(events, {})
    starts = [s for s in sugs if s["marker_type"] == "start"]
    assert any(s["reason"] == "transaction_id_typed" for s in starts), \
        f"expected at least one transaction_id_typed Start, got {[s['reason'] for s in starts]}"
    txn_start = next(s for s in starts if s["reason"] == "transaction_id_typed")
    assert txn_start["label"] == "ABC-12345", txn_start


def test_lone_long_idle_gap_fires_start():
    """H-4: a single sufficiently long idle gap, with no other signal
    (single app, no txn-id, no cluster/home boundary), MUST be able to
    surface an idle_gap Start. The pre-fix score `0.5*tanh(x)` was always
    < 0.5 while the gate was `< 0.5`, so an idle-only boundary was
    mathematically unreachable. The fix raises the idle weight above the
    threshold so a long-enough gap saturates over the gate."""
    events = []
    t = 0.0
    # Run of work in one app.
    for _ in range(8):
        events.append(_interaction(t, "salesforce.exe"))
        t += 2.0
    # One long idle gap (well above the default idle_gap_ms=60s firing point
    # of ~63s), then a fresh run -- this is the only boundary signal present.
    t += 120.0
    for _ in range(8):
        events.append(_interaction(t, "salesforce.exe"))
        t += 2.0

    sugs = suggest_markers(events, {})
    starts = [s for s in sugs if s["marker_type"] == "start"]
    assert any(s["reason"] == "idle_gap" for s in starts), \
        f"expected an idle_gap Start, got reasons={[s['reason'] for s in starts]}"


def test_short_idle_gap_stays_quiet():
    """Companion to H-4: a short idle gap alone must NOT fire -- the fix
    must not make ordinary pauses noisy. A 15s gap (0.25 * idle_gap_ms) is
    well below the firing point."""
    events = []
    t = 0.0
    for _ in range(8):
        events.append(_interaction(t, "salesforce.exe"))
        t += 2.0
    t += 15.0  # short pause, no other signal
    for _ in range(8):
        events.append(_interaction(t, "salesforce.exe"))
        t += 2.0

    sugs = suggest_markers(events, {})
    idle_starts = [s for s in sugs
                   if s["marker_type"] == "start" and s["reason"] == "idle_gap"]
    assert idle_starts == [], \
        f"short idle gap must not fire an idle_gap Start, got {idle_starts}"


def test_emits_at_home_app_return():
    """Repeated salesforce.exe stretches with outlook.exe in between
    surface Start suggestions when the worker returns to salesforce
    after an outlook detour."""
    events = _home_return_stream(n_cases=3)
    sugs = suggest_markers(events, {})
    assert any(s["marker_type"] == "start" for s in sugs), \
        f"expected at least one Start suggestion, got {len(sugs)}"
    starts = [s for s in sugs if s["marker_type"] == "start"]
    # The home-app or app-cluster signals should fire at the return.
    assert any(s["reason"] in ("home_app_return", "app_cluster_boundary", "idle_gap")
               for s in starts), \
        f"expected boundary signals, got reasons={[s['reason'] for s in starts]}"


def test_pairs_starts_with_ends():
    """Every Start in the output has an End. The viewer relies on the
    pair to render a complete suggested case."""
    events = _home_return_stream(n_cases=3)
    sugs = suggest_markers(events, {})
    starts = sum(1 for s in sugs if s["marker_type"] == "start")
    ends = sum(1 for s in sugs if s["marker_type"] == "end")
    assert starts == ends, f"unpaired markers: {starts} starts vs {ends} ends"
    assert starts >= 1


# ---------------------------------------------------------------------------
# Guards

def test_never_inside_excluded_range():
    events = _home_return_stream(n_cases=3)
    # Excluded range covering the entire stream.
    excluded = [{"start": _at(-1), "end": _at(10_000), "reason": "manual"}]
    sugs = suggest_markers(events, {}, excluded_ranges=excluded)
    assert sugs == [], f"expected no suggestions inside excluded range, got {len(sugs)}"


def test_never_inside_open_case():
    """If an existing case spans the time-range of would-be
    suggestions, the detector suppresses them."""
    events = _home_return_stream(n_cases=3)
    existing_cases = {
        "case-x": {
            "case_id": "case-x", "label": "Existing",
            "start_ts": _at(-10), "end_ts": _at(10_000),
        }
    }
    # Tag all events with a case_id so the detector sees them as cased.
    for e in events:
        if e["type"] in ("activity", "interaction"):
            e["data"]["case_ids"] = ["case-x"]
    sugs = suggest_markers(events, existing_cases)
    assert sugs == [], f"expected no suggestions inside an open case, got {len(sugs)}"


def test_never_within_window_of_real_start():
    """A real Start marker close to a candidate Start suppresses the
    suggestion -- we never duplicate a marker the worker already
    fired."""
    events = _home_return_stream(n_cases=3)
    # Prepend a real Start at the very beginning of the home-return that
    # would otherwise fire a suggestion. The first stretch starts at
    # t=0 in salesforce; the boundary at t=24 (return after outlook).
    events.insert(0, _start_marker(24.0, "Real case"))
    sugs = suggest_markers(events, {})
    # No Start should land within 5 s of t=24.
    for s in (s for s in sugs if s["marker_type"] == "start"):
        # parse the suggestion's timestamp and check
        from _dt import parse_ts
        st = parse_ts(s["timestamp"])
        rs = parse_ts(_at(24.0))
        diff_ms = abs((st - rs).total_seconds() * 1000)
        assert diff_ms > 5_000, \
            f"suggestion at {s['timestamp']} too close to real Start at t=24: {diff_ms} ms"


def test_drops_sub_min_case_interactions():
    """A proposed case spanning fewer than min_case_interactions rows
    is dropped, even if the Start scored above threshold."""
    events = []
    t = 0.0
    # 8 interactions in salesforce.
    for _ in range(8):
        events.append(_interaction(t, "salesforce.exe"))
        t += 2.0
    # Type a txn-id (would fire a Start here), but only 2 more events
    # follow -- below default min_case_interactions=5.
    events.append(_interaction(t, "salesforce.exe",
                               value="ABC-99999", kind="value_changed",
                               name="customer-id"))
    t += 2.0
    for _ in range(2):
        events.append(_interaction(t, "salesforce.exe"))
        t += 2.0

    sugs = suggest_markers(events, {})
    # The txn-id-fired Start should have been dropped as a sliver.
    txn_starts = [s for s in sugs if s.get("reason") == "transaction_id_typed"
                  and s["marker_type"] == "start"]
    assert len(txn_starts) == 0, \
        f"expected sliver Start to be dropped, got {txn_starts}"


# ---------------------------------------------------------------------------
# Idempotence + signature stability

def test_idempotence():
    events = _home_return_stream(n_cases=3)
    a = suggest_markers(events, {})
    b = suggest_markers(events, {})
    # suggestion_id and created_at are time-derived; compare the rest.
    def _key(s):
        return (s["marker_type"], s["timestamp"], s["signature"],
                s["reason"], s["label"], s["score"], s["heuristic_version"],
                tuple(sorted(s["evidence"].items())))
    assert [_key(s) for s in a] == [_key(s) for s in b]


def test_signature_is_stable_across_calls():
    events = _home_return_stream(n_cases=3)
    a = suggest_markers(events, {})
    b = suggest_markers(events, {})
    assert [s["signature"] for s in a] == [s["signature"] for s in b]


# ---------------------------------------------------------------------------
# Merge semantics

def test_merge_dismiss_persists():
    events = _home_return_stream(n_cases=3)
    fresh = suggest_markers(events, {})
    assert fresh, "fixture must produce at least one suggestion"
    target = fresh[0]
    dismissed = [{"signature": target["signature"], "dismissed_at": _at(99999),
                  "marker_type": target["marker_type"],
                  "approximate_timestamp": target["timestamp"]}]
    merged = merge_marker_suggestions(
        existing=[], fresh=fresh, dismissed=dismissed,
    )
    assert all(s["signature"] != target["signature"] for s in merged), \
        "a dismissed signature must NEVER appear in the merge output"


def test_merge_accept_persists():
    """An op:insert in marker_edits with derived_from_signature
    suppresses re-suggestion of that signature on next normalize."""
    events = _home_return_stream(n_cases=3)
    fresh = suggest_markers(events, {})
    assert fresh
    target = fresh[0]
    accepted_edits = [{
        "id": "edit-1", "op": "insert",
        "marker_type": target["marker_type"],
        "timestamp": target["timestamp"],
        "derived_from_signature": target["signature"],
    }]
    merged = merge_marker_suggestions(
        existing=[], fresh=fresh, dismissed=[], accepted_edits=accepted_edits,
    )
    assert all(s["signature"] != target["signature"] for s in merged), \
        "an accepted signature must NEVER reappear in the merge output"


def test_merge_dedupes_within_fresh():
    events = _home_return_stream(n_cases=3)
    fresh = suggest_markers(events, {})
    assert fresh
    # Inject an exact duplicate.
    duped = fresh + [dict(fresh[0])]
    merged = merge_marker_suggestions(existing=[], fresh=duped)
    sigs = [s["signature"] for s in merged]
    assert len(sigs) == len(set(sigs)), "merge must dedupe by signature"


def test_merge_handles_malformed_entries():
    """A garbage row in fresh / dismissed / accepted_edits must not
    crash the merge -- the same posture step_suggest._merge_steps takes."""
    merged = merge_marker_suggestions(
        existing=[],
        fresh=[None, {}, {"signature": ""}, {"signature": "abc"}, "not-a-dict"],
        dismissed=[None, {}, {"signature": "abc"}, "garbage"],
        accepted_edits=[None, {"op": "delete"}, {"op": "insert"},
                        {"op": "insert", "derived_from_signature": "xyz"}],
    )
    # "abc" was dismissed; nothing else is a valid signature.
    assert merged == [], merged


# ---------------------------------------------------------------------------
# End-to-end through the real pipeline

@pytest.mark.skipif(not _NORMALIZE_OK,
                    reason=f"normalize.py heavy deps unavailable: {_NORMALIZE_IMPORT_ERR}")
def test_accept_promotes_to_real_case():
    """The headline integration check: a suggestion's Start+End pair,
    once written to marker_edits[] as op:insert entries (the Accept path
    the viewer takes), feeds through apply_marker_edits -> assign_case_ids
    -> collect_cases and produces a real case.
    """
    events = _home_return_stream(n_cases=3)
    sugs = suggest_markers(events, {})
    starts = [s for s in sugs if s["marker_type"] == "start"]
    ends = [s for s in sugs if s["marker_type"] == "end"]
    assert starts and ends

    sugg_s = starts[0]
    sugg_e = ends[0]

    annotations = {
        "marker_edits": [
            {"id": "edit-s", "op": "insert",
             "marker_type": "start", "label": "Accepted case",
             "timestamp": sugg_s["timestamp"],
             "derived_from_signature": sugg_s["signature"]},
            {"id": "edit-e", "op": "insert",
             "marker_type": "end", "label": None,
             "timestamp": sugg_e["timestamp"],
             "derived_from_signature": sugg_e["signature"]},
        ],
    }
    edited, applied = apply_marker_edits(events, annotations)
    assert applied == 2, f"expected 2 inserts to apply, got {applied}"
    with_cases = assign_case_ids(edited)
    cases = collect_cases(with_cases)
    assert any(c.get("label") == "Accepted case" for c in cases.values()), \
        f"expected a real 'Accepted case' after promotion, got {[c.get('label') for c in cases.values()]}"


def test_accept_then_renormalize_drops_suggestion():
    """End-to-end: Accept records a derived_from_signature, the merge
    sees it on the next run, the suggestion is gone."""
    events = _home_return_stream(n_cases=3)
    fresh = suggest_markers(events, {})
    sugg = fresh[0]

    accepted_edits = [{
        "id": "e", "op": "insert",
        "marker_type": sugg["marker_type"],
        "timestamp": sugg["timestamp"],
        "derived_from_signature": sugg["signature"],
    }]
    # Re-run the detector (the events stream is unchanged) and merge.
    fresh2 = suggest_markers(events, {})
    merged = merge_marker_suggestions(
        existing=fresh, fresh=fresh2,
        dismissed=[], accepted_edits=accepted_edits,
    )
    assert all(s["signature"] != sugg["signature"] for s in merged)


def test_dismiss_persists_across_renormalize():
    events = _home_return_stream(n_cases=3)
    fresh = suggest_markers(events, {})
    sugg = fresh[0]

    dismissed = [{"signature": sugg["signature"],
                  "dismissed_at": _at(99999),
                  "marker_type": sugg["marker_type"],
                  "approximate_timestamp": sugg["timestamp"]}]
    # Re-run detector, merge with the persisted dismiss list -- and
    # then once more after to prove it stays gone.
    fresh2 = suggest_markers(events, {})
    merged1 = merge_marker_suggestions(
        existing=fresh, fresh=fresh2, dismissed=dismissed,
    )
    fresh3 = suggest_markers(events, {})
    merged2 = merge_marker_suggestions(
        existing=merged1, fresh=fresh3, dismissed=dismissed,
    )
    assert all(s["signature"] != sugg["signature"] for s in merged1)
    assert all(s["signature"] != sugg["signature"] for s in merged2)


# ---------------------------------------------------------------------------
# Signature semantics

def test_signature_changes_with_bucket():
    """The 5-s timestamp bucket means a 6-second drift produces a
    different signature; a 4-second drift may or may not. We pin the
    cross-bucket case so callers know the boundary."""
    t1 = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)
    t2 = t1 + timedelta(seconds=6)
    s1 = signature("start", t1, "app1", "app2", "idle_gap")
    s2 = signature("start", t2, "app1", "app2", "idle_gap")
    assert s1 != s2


def test_signature_stable_within_bucket():
    """Two timestamps in the same 5-s bucket produce the same
    signature -- the property dismissal/accept matching depends on."""
    t1 = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)
    t2 = t1 + timedelta(seconds=2)
    s1 = signature("start", t1, "app1", "app2", "idle_gap")
    s2 = signature("start", t2, "app1", "app2", "idle_gap")
    assert s1 == s2
