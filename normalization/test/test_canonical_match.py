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

from canonical_match import match_canonical, rollup_phases, load_canonical


def test_load_canonical_missing_file_returns_empty(tmp_path):
    """A stale/missing template path must degrade to {} rather than raising. This
    is the FileNotFoundError that crashed analysis when a session matched on one
    machine was moved to another that lacks the template file."""
    assert load_canonical(str(tmp_path / "does-not-exist.yaml")) == {}


def test_load_canonical_malformed_returns_empty(tmp_path):
    p = tmp_path / "bad.yaml"
    p.write_text("just a scalar, not a mapping", encoding="utf-8")
    assert load_canonical(str(p)) == {}


def test_load_canonical_reads_canonical_process(tmp_path):
    p = tmp_path / "ok.yaml"
    p.write_text("canonical_process:\n  id: demo\n  version: 2\n", encoding="utf-8")
    cp = load_canonical(str(p))
    assert cp.get("id") == "demo" and cp.get("version") == 2


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


# --- Match operators (v0.13 §2) -------------------------------------------

def _inter_with_value(ts, *, window="App", name="", value="", class_name="",
                      control_type="Edit", proc="app.exe"):
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(ts),
        "data": {
            "kind": "value_changed",
            "window_title": window,
            "process_name": proc,
            "control_type": control_type,
            "name": name,
            "value": value,
            "class_name": class_name,
            "framework_id": "",
            "case_ids": ["case-1"],
        },
    }


def test_operator_starts_with_matches():
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [{
            "step_id": "s1", "name": "Resolution",
            "match": [{"interaction": {"value": {"starts_with": "**Resolution**"}}}],
        }],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    ev = _inter_with_value(base, value="**Resolution** Fixed the thing")
    steps, unmatched = match_canonical([ev], canon, session_id="s1")
    assert len(steps) == 1
    assert unmatched == []


def test_operator_starts_with_no_match():
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [{
            "step_id": "s1", "name": "Resolution",
            "match": [{"interaction": {"value": {"starts_with": "**Resolution**"}}}],
        }],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    ev = _inter_with_value(base, value="Some other text")
    steps, unmatched = match_canonical([ev], canon, session_id="s1")
    assert steps == []
    assert len(unmatched) == 1


def test_operator_contains_matches():
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [{
            "step_id": "s1", "name": "Load task",
            "match": [{"interaction": {"name": {"contains": "Load Task#"}}}],
        }],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    ev = _inter_with_value(base, name="Load Task#12345")
    steps, _ = match_canonical([ev], canon, session_id="s1")
    assert len(steps) == 1


def test_operator_matches_regex():
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [{
            "step_id": "s1", "name": "Serial",
            "match": [{"interaction": {"value": {"matches": r"^SN\d+$"}}}],
        }],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    hit = _inter_with_value(base, value="SN12345")
    miss = _inter_with_value(base + timedelta(seconds=1), value="XX12345")
    steps, unmatched = match_canonical([hit, miss], canon, session_id="s1")
    assert len(steps) == 1
    assert len(unmatched) == 1


def test_operator_on_missing_field_does_not_match():
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [{
            "step_id": "s1", "name": "Test",
            "match": [{"interaction": {"value": {"starts_with": "X"}}}],
        }],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    ev = _inter_with_value(base)
    ev["data"]["value"] = None
    steps, unmatched = match_canonical([ev], canon, session_id="s1")
    assert steps == []


# --- Span boundaries (v0.13 §3) -------------------------------------------

def test_boundary_single():
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [{
            "step_id": "s1", "name": "Single step",
            "match": [{"interaction": {"name": "trigger"}}],
            "boundary": "single",
        }],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _inter(base, window="App", name="trigger"),
        _inter(base + timedelta(seconds=1), window="App", name="trigger"),
    ]
    steps, _ = match_canonical(events, canon, session_id="s1")
    assert len(steps) == 2
    assert all(len(s["evidence"]["interaction_event_ids"]) == 1 for s in steps)


def test_boundary_until_app_change():
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [{
            "step_id": "s1", "name": "App step",
            "match": [{"interaction": {"name": "trigger"}}],
            "boundary": "until_app_change",
        }],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _inter(base, window="AppA - Detail", name="trigger"),
        _inter(base + timedelta(seconds=1), window="AppA - Other", name="trigger"),
        _inter(base + timedelta(seconds=2), window="AppB - Detail", name="trigger"),
    ]
    steps, _ = match_canonical(events, canon, session_id="s1")
    assert len(steps) == 2
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 2


def test_boundary_until_pause():
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [{
            "step_id": "s1", "name": "Pause step",
            "match": [{"interaction": {"name": "trigger"}}],
            "boundary": "until_pause",
            "pause_ms": 3000,
        }],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _inter(base, window="App", name="trigger"),
        _inter(base + timedelta(seconds=1), window="App", name="trigger"),
        _inter(base + timedelta(seconds=10), window="App", name="trigger"),
    ]
    steps, _ = match_canonical(events, canon, session_id="s1")
    assert len(steps) == 2


def test_boundary_until_field_change():
    """until_field_change closes when (window_title, automation_id, class_name)
    changes — here the automation_id changes on the third event."""
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [{
            "step_id": "s1", "name": "Field step",
            "match": [{"interaction": {"class_name": "cell-editor"}}],
            "boundary": "until_field_change",
        }],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    ev1 = _inter_with_value(base, class_name="cell-editor", window="App")
    ev1["data"]["automation_id"] = "field1"
    ev2 = _inter_with_value(base + timedelta(seconds=1), class_name="cell-editor",
                            window="App")
    ev2["data"]["automation_id"] = "field1"
    ev3 = _inter_with_value(base + timedelta(seconds=2), class_name="cell-editor",
                            window="App")
    ev3["data"]["automation_id"] = "field2"
    steps, _ = match_canonical([ev1, ev2, ev3], canon, session_id="s1")
    assert len(steps) == 2


def test_boundary_until_next_step():
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [
            {
                "step_id": "investigate",
                "name": "Investigate",
                "match": [{"interaction": {"automation_id": "serial"}}],
                "boundary": "until_next_step",
            },
            {
                "step_id": "resolve",
                "name": "Resolve",
                "match": [{"interaction": {"name": "resolve-btn"}}],
            },
        ],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _inter_with_value(base, name="serial-field"),
        _inter_with_value(base + timedelta(seconds=1)),
        _inter_with_value(base + timedelta(seconds=2)),
    ]
    events[0]["data"]["automation_id"] = "serial"
    steps, unmatched = match_canonical(events, canon, session_id="s1")
    assert len(steps) == 1
    assert steps[0]["canonical_step_id"] == "investigate"
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 3
    assert unmatched == []


def test_boundary_until_next_step_closes_on_different_trigger():
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [
            {
                "step_id": "investigate",
                "name": "Investigate",
                "match": [{"interaction": {"automation_id": "serial"}}],
                "boundary": "until_next_step",
            },
            {
                "step_id": "resolve",
                "name": "Resolve",
                "match": [{"interaction": {"name": "resolve-btn"}}],
            },
        ],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _inter_with_value(base),
        _inter_with_value(base + timedelta(seconds=1)),
        _inter(base + timedelta(seconds=2), window="App", name="resolve-btn"),
    ]
    events[0]["data"]["automation_id"] = "serial"
    steps, _ = match_canonical(events, canon, session_id="s1")
    assert len(steps) == 2
    assert steps[0]["canonical_step_id"] == "investigate"
    assert steps[1]["canonical_step_id"] == "resolve"


def test_boundary_closes_at_case_change():
    """A step never spans two cases."""
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [{
            "step_id": "s1", "name": "Span step",
            "match": [{"interaction": {"automation_id": "serial"}}],
            "boundary": "until_next_step",
        }],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    ev1 = _inter_with_value(base)
    ev1["data"]["automation_id"] = "serial"
    ev1["data"]["case_ids"] = ["case-A"]
    ev2 = _inter_with_value(base + timedelta(seconds=5))
    ev2["data"]["case_ids"] = ["case-B"]
    steps, _ = match_canonical([ev1, ev2], canon, session_id="s1")
    assert len(steps) == 1
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 1


def test_until_next_step_carries_scope_metadata():
    """until_next_step steps carry scope.apps and scope.interaction_count."""
    canon = {
        "id": "p1", "version": 1, "phases": [],
        "steps": [{
            "step_id": "investigate",
            "name": "Investigate",
            "match": [{"interaction": {"automation_id": "serial"}}],
            "boundary": "until_next_step",
        }],
    }
    base = datetime(2026, 5, 14, 9, 0, 0)
    ev1 = _inter_with_value(base, window="SNFI - Chrome")
    ev1["data"]["automation_id"] = "serial"
    ev2 = _inter_with_value(base + timedelta(seconds=1), window="TAMBA - Chrome")
    steps, _ = match_canonical([ev1, ev2], canon, session_id="s1")
    assert len(steps) == 1
    assert "scope" in steps[0]
    assert steps[0]["scope"]["interaction_count"] == 2
    assert len(steps[0]["scope"]["apps"]) == 2
