"""Smoke tests for the canonical matching layer.

Run with:
    pytest normalization/test/test_canonical_match.py
"""

from __future__ import annotations
import sys
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from canonical_match import match_canonical, rollup_phases


def _iso(t: datetime) -> str:
    return t.replace(tzinfo=timezone.utc).isoformat()


def _inter(ts, *, window, name, control_type="Button", proc="chrome.exe"):
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(ts),
        "data": {
            "kind": "invoked",
            "window_title": window,
            "process_name": proc,
            "control_type": control_type,
            "name": name,
            "case_ids": ["case-1"],
        },
    }


CANONICAL = {
    "id": "p1",
    "version": 1,
    "phases": [
        {"phase_id": "ph1", "name": "Phase one", "step_ids": ["search"]},
    ],
    "steps": [
        {
            "step_id": "search",
            "name": "Search customer",
            "match": [
                {
                    "process_name": "chrome.exe",
                    "window_title_regex": ".*Salesforce.*Search.*",
                    "interaction": {"control_type": "Button"},
                }
            ],
        },
        {
            "step_id": "verify",
            "name": "KYC verify",
            "match": [{"window_title_regex": ".*KYC.*"}],
        },
    ],
}


def test_matches_consecutive_interactions_into_one_step():
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _inter(base, window="Salesforce - Search", name="Lookup"),
        _inter(base + timedelta(seconds=1), window="Salesforce - Search", name="Find"),
    ]
    steps, unmatched = match_canonical(events, CANONICAL, session_id="s1")
    assert len(steps) == 1
    assert steps[0]["canonical_step_id"] == "search"
    assert steps[0]["state"] == "auto_matched"
    assert unmatched == []


def test_unmatched_returns_unmatched_list():
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _inter(base, window="Some other app", name="Foo"),
    ]
    steps, unmatched = match_canonical(events, CANONICAL, session_id="s1")
    assert steps == []
    assert len(unmatched) == 1


def test_phase_rollup_groups_steps():
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _inter(base, window="Salesforce - Search", name="Lookup"),
        _inter(base + timedelta(seconds=1), window="Salesforce - Search", name="Find"),
    ]
    steps, _ = match_canonical(events, CANONICAL, session_id="s1")
    phases = rollup_phases(CANONICAL, steps, session_id="s1")
    assert len(phases) == 1
    assert phases[0]["canonical_phase_id"] == "ph1"
    assert phases[0]["step_ids"] == [steps[0]["step_id"]]
