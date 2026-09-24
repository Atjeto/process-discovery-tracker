"""Example-based tests for marker-mode case assignment (assign_case_ids /
collect_cases), including runs whose markers were added by hand as
annotations.json marker_edits op:insert entries.

Both tests moved here from the deleted anchor-case and suggested-marker test
files when those features were removed (the second one now without the
suggestion detector). The seeded fuzzers stay in test_case_assignment_fuzz.py.

case_assignment and marker_edits are stdlib-only, so this suite runs under any
Python.

Run with:
    pytest normalization/test/test_case_assignment.py
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from case_assignment import assign_case_ids, collect_cases  # noqa: E402
from marker_edits import apply_marker_edits  # noqa: E402


def _iso(t: datetime) -> str:
    return t.replace(tzinfo=timezone.utc).isoformat()


def test_null_or_nondict_data_marker_path_degrades_not_crashes():
    """The marker path (assign_case_ids / collect_cases) shares the same
    corrupt-`data` exposure: a null or non-dict `data` on a marker/activity must
    not crash `{**ev['data']}`. Only the well-formed start opens a case."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = [
        {"event_id": "a", "type": "marker", "timestamp": _iso(base),
         "data": {"marker_type": "start", "label": "c1"}},
        {"event_id": "b", "type": "activity", "timestamp": _iso(base + timedelta(seconds=1)),
         "data": None},
        {"event_id": "c", "type": "marker", "timestamp": _iso(base + timedelta(seconds=2)),
         "data": "corrupt-not-a-dict"},
        {"event_id": "d", "type": "marker", "timestamp": _iso(base + timedelta(seconds=3)),
         "data": {"marker_type": "end", "reason": "done"}},
    ]
    out = assign_case_ids(events)                               # must not raise {**None}
    assert len(out) == len(events)
    # the corrupt-data activity is still stamped with the one open case
    assert len(out[1]["data"]["case_ids"]) == 1
    cases = collect_cases(out)                                  # must not raise
    assert len(cases) == 1


def test_hand_inserted_markers_promote_to_a_real_case():
    """A Start+End pair written to marker_edits[] as op:insert entries (how a
    missed run marker is added by hand) feeds through apply_marker_edits ->
    assign_case_ids -> collect_cases and produces a real case."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = [
        {"event_id": f"i{k}", "type": "interaction",
         "timestamp": _iso(base + timedelta(seconds=2 * k)),
         "data": {"kind": "invoked", "control_type": "Button", "name": "Work",
                  "process_name": "crm.exe"}}
        for k in range(6)
    ]
    annotations = {
        "marker_edits": [
            {"id": "edit-s", "op": "insert",
             "marker_type": "start", "label": "Hand-added run",
             "timestamp": _iso(base + timedelta(seconds=1))},
            {"id": "edit-e", "op": "insert",
             "marker_type": "end", "label": None,
             "timestamp": _iso(base + timedelta(seconds=9))},
        ],
    }
    edited, applied = apply_marker_edits(events, annotations)
    assert applied == 2, f"expected 2 inserts to apply, got {applied}"
    with_cases = assign_case_ids(edited)
    cases = collect_cases(with_cases)
    assert any(c.get("label") == "Hand-added run" for c in cases.values()), \
        f"expected a real 'Hand-added run' case, got {[c.get('label') for c in cases.values()]}"


# --- RP-01 / contract C9: deterministic case identity -----------------------


def _two_runs():
    base = datetime(2026, 5, 18, 9, 0, 0)
    return [
        {"event_id": "m-start-1", "type": "marker", "timestamp": _iso(base),
         "data": {"marker_type": "start", "label": "Order 1"}},
        {"event_id": "a1", "type": "activity", "timestamp": _iso(base + timedelta(seconds=1)),
         "data": {"app": "crm.exe", "duration_ms": 1000}},
        {"event_id": "m-end-1", "type": "marker", "timestamp": _iso(base + timedelta(seconds=2)),
         "data": {"marker_type": "end"}},
        {"event_id": "m-start-2", "type": "marker", "timestamp": _iso(base + timedelta(seconds=3)),
         "data": {"marker_type": "start", "label": "Order 2"}},
        {"event_id": "a2", "type": "activity", "timestamp": _iso(base + timedelta(seconds=4)),
         "data": {"app": "crm.exe", "duration_ms": 1000}},
    ]


def test_case_ids_are_identical_across_runs_and_derived_from_the_start_marker():
    """RP-01: the same events assigned twice give the same case ids (they used
    to be a fresh uuid4 per run), each id is uuid5 over
    "<session_id>:<start marker event_id>", and two runs never share an id."""
    import uuid
    from case_assignment import CASE_ID_NAMESPACE
    first = collect_cases(assign_case_ids(_two_runs(), session_id="sess-A"))
    second = collect_cases(assign_case_ids(_two_runs(), session_id="sess-A"))
    assert sorted(first) == sorted(second), "case ids changed between two runs"
    expected = {str(uuid.uuid5(CASE_ID_NAMESPACE, f"sess-A:{eid}"))
                for eid in ("m-start-1", "m-start-2")}
    assert set(first) == expected
    # A different session never collides with this one.
    other = collect_cases(assign_case_ids(_two_runs(), session_id="sess-B"))
    assert not set(other) & set(first)


def test_a_repeated_start_marker_line_stays_a_separate_run():
    """A corrupt log that repeats a start-marker line (same event_id) opens a
    second run; it must not silently merge into the first run's case id."""
    events = _two_runs()[:2] + [dict(_two_runs()[0], timestamp=_two_runs()[1]["timestamp"])]
    out = assign_case_ids(events, session_id="s")
    cases = collect_cases(out)
    assert len(cases) == 2
    assert assign_case_ids(events, session_id="s") == out   # still deterministic


# --- Runs never nest: a Start while a run is open ends that run first --------


def _marker(eid, t, mtype, label=None, reason=None):
    data = {"marker_type": mtype, "label": label}
    if reason:
        data["reason"] = reason
    return {"event_id": eid, "type": "marker", "timestamp": _iso(t), "data": data}


def _activity(eid, t):
    return {"event_id": eid, "type": "activity", "timestamp": _iso(t),
            "data": {"app": "crm.exe", "duration_ms": 1000}}


def test_a_start_while_a_run_is_open_ends_that_run_first():
    """The capture app's run hotkey ends the open run (an End with reason
    auto_close_for_sibling) before it starts the next one. A Start that
    arrives while a run is open ends that run the same way; an End marker
    still ends the open run, and work after it is outside every run."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    t = [base + timedelta(seconds=k) for k in range(6)]
    events = [
        _marker("s1", t[0], "start", "Run 1"),
        _activity("a1", t[1]),
        _marker("s2", t[2], "start", "Run 2"),      # run 1 is still open
        _activity("a2", t[3]),
        _marker("e2", t[4], "end", reason="done"),
        _activity("a3", t[5]),
    ]
    out = assign_case_ids(events, session_id="s")
    assert len(out) == len(events), "no marker may be invented"
    cases = collect_cases(out)
    by_label = {c["label"]: c for c in cases.values()}
    run1, run2 = by_label["Run 1"], by_label["Run 2"]
    stamped = {e["event_id"]: e["data"]["case_ids"] for e in out if e["type"] == "activity"}
    assert stamped == {"a1": [run1["case_id"]], "a2": [run2["case_id"]], "a3": []}
    assert run1["parent_case_id"] is None and run2["parent_case_id"] is None
    assert (run1["end_ts"], run1["end_reason"]) == (_iso(t[2]), "auto_close_for_sibling")
    assert (run2["end_ts"], run2["end_reason"]) == (_iso(t[4]), "done")


def test_a_start_inserted_inside_a_run_splits_it_instead_of_nesting_later_runs():
    """A Start added in the viewer (marker_edits op:insert) inside run 1 of a
    three-run recording used to nest every later run inside run 1. It now
    splits run 1, and all four runs are top-level runs with an end."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = []
    for n in range(3):
        t0 = base + timedelta(minutes=10 * n)
        events += [
            _marker(f"s{n}", t0, "start", f"Run {n + 1}"),
            _activity(f"a{n}-1", t0 + timedelta(seconds=10)),
            _activity(f"a{n}-2", t0 + timedelta(seconds=30)),
            _marker(f"e{n}", t0 + timedelta(seconds=40), "end"),
        ]
    for i, e in enumerate(events):
        e["_seq"] = i
    annotations = {"marker_edits": [
        {"id": "split", "op": "insert", "marker_type": "start", "label": "Inserted",
         "timestamp": _iso(base + timedelta(seconds=20))},
    ]}
    edited, applied = apply_marker_edits(events, annotations)
    assert applied == 1
    cases = collect_cases(assign_case_ids(edited, session_id="s"))
    assert sorted(c["label"] for c in cases.values()) == ["Inserted", "Run 1", "Run 2", "Run 3"]
    assert all(c["parent_case_id"] is None for c in cases.values()), "a run was nested"
    assert all(c["end_ts"] for c in cases.values()), "a run was left without an end"


def test_a_session_without_a_recording_and_without_a_start_has_one_implicit_run():
    """C16: a video or blank session with no start marker gets one implicit
    run covering the session: a deterministic id from the session id and a
    fixed name, open, flagged `implicit`, holding every event there is. A
    recording never gets one, and a start marker (inserted by hand) replaces
    it."""
    import uuid
    from case_assignment import add_implicit_run, implicit_case_id, needs_implicit_run
    base = datetime(2026, 5, 18, 9, 0, 0)
    assert implicit_case_id("sess-1") == str(uuid.uuid5(
        uuid.UUID("c35db218-e350-4efb-ae74-37c31a4f697a"), "sess-1:implicit-run"))
    assert needs_implicit_run([], recorded=False)
    assert not needs_implicit_run([], recorded=True)
    end_only = [{"event_id": "e", "type": "marker", "timestamp": _iso(base),
                 "data": {"marker_type": "end"}}]
    assert needs_implicit_run(end_only, recorded=False)      # an end opens no run
    edited, _n = apply_marker_edits([], {"marker_edits": [
        {"id": "m1", "op": "insert", "marker_type": "start", "timestamp": _iso(base)}]})
    assert not needs_implicit_run(edited, recorded=False)

    events = [{"event_id": "i1", "type": "interaction", "timestamp": _iso(base),
               "data": {"kind": "invoked", "case_ids": []}}]
    stamped, cases = add_implicit_run(events, {}, "sess-1", "2026-05-18T08:59:00Z")
    cid = implicit_case_id("sess-1")
    assert cases == {cid: {"case_id": cid, "label": None, "parent_case_id": None,
                           "start_ts": "2026-05-18T08:59:00Z", "end_ts": None,
                           "end_reason": None, "implicit": True}}
    assert stamped[0]["data"]["case_ids"] == [cid]
    assert events[0]["data"]["case_ids"] == [], "the input was changed"
