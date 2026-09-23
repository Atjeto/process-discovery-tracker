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
