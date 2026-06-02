"""Tests for bpmn_phase -- phase-level (sub-process) BPMN emission
(review coverage gap #16). Pure (stdlib xml.etree only)."""

from __future__ import annotations
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bpmn_phase import phase_bpmn_from_canonical
from bpmn_step import BPMN_NS


def _q(tag):
    return f"{{{BPMN_NS}}}{tag}"


CANON = {
    "steps": [
        {"step_id": "S1", "name": "Search"},
        {"step_id": "S2", "name": "Create"},
        {"step_id": "S3", "name": "Close"},
    ],
    "phases": [
        {"phase_id": "P1", "name": "Intake", "step_ids": ["S1", "S2"]},
        {"phase_id": "P2", "name": "Resolution", "step_ids": ["S3"]},
    ],
}


def _root(xml):
    return ET.fromstring(xml.split("?>", 1)[1])


def test_each_phase_becomes_a_subprocess_with_its_steps():
    xml = phase_bpmn_from_canonical(CANON, [])
    proc = _root(xml).find(_q("process"))
    subs = proc.findall(_q("subProcess"))
    assert len(subs) == 2
    names = [s.get("name") for s in subs]
    assert "Intake" in names and "Resolution" in names
    # P1 contains 2 step tasks, P2 contains 1.
    by_name = {s.get("name"): s for s in subs}
    assert len(by_name["Intake"].findall(_q("task"))) == 2
    assert len(by_name["Resolution"].findall(_q("task"))) == 1


def test_subprocess_has_its_own_start_and_end_events():
    xml = phase_bpmn_from_canonical(CANON, [])
    sub = _root(xml).find(_q("process")).find(_q("subProcess"))
    assert sub.find(_q("startEvent")) is not None
    assert sub.find(_q("endEvent")) is not None


def test_step_ids_not_in_canonical_steps_are_skipped():
    canon = {
        "steps": [{"step_id": "S1", "name": "Search"}],
        "phases": [{"phase_id": "P1", "name": "Intake", "step_ids": ["S1", "ghost"]}],
    }
    xml = phase_bpmn_from_canonical(canon, [])
    sub = _root(xml).find(_q("process")).find(_q("subProcess"))
    # Only the resolvable step becomes a task; "ghost" is dropped.
    assert len(sub.findall(_q("task"))) == 1


def test_stats_aggregate_into_phase_tasks():
    sessions = [{"steps": [
        {"canonical_step_id": "S1", "time_range": {"start": "2026-05-18T09:00:00Z",
                                                   "end": "2026-05-18T09:00:02Z"}},
    ]}]
    xml = phase_bpmn_from_canonical(CANON, sessions)
    assert "Search" in xml and "n=1" in xml


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
