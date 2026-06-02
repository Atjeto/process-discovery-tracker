"""Tests for bpmn_step -- step-level BPMN emission (review coverage gap #16).
Pure (stdlib xml.etree only), so it runs under a bare Python.
"""

from __future__ import annotations
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bpmn_step import step_bpmn_from_canonical, _safe_id, _fmt_ms, _parse, BPMN_NS


def _q(tag):
    return f"{{{BPMN_NS}}}{tag}"


# --- pure helpers ------------------------------------------------------

def test_safe_id_replaces_non_alnum():
    assert _safe_id("Step A/B-1") == "Step_A_B_1"
    assert _safe_id("abc123") == "abc123"


def test_fmt_ms_buckets():
    assert _fmt_ms(0) == "0ms"
    assert _fmt_ms(999) == "999ms"
    assert _fmt_ms(1000) == "1s"
    assert _fmt_ms(59000) == "59s"
    assert _fmt_ms(60000) == "1m0s"
    assert _fmt_ms(95000) == "1m35s"


def test_parse_handles_zulu_and_offset():
    a = _parse("2026-05-18T09:00:00Z")
    b = _parse("2026-05-18T09:00:01+00:00")
    assert (b - a).total_seconds() == 1.0


# --- step_bpmn_from_canonical -----------------------------------------

CANON = {"steps": [{"step_id": "S1", "name": "Search"},
                   {"step_id": "S2", "name": "Create"}]}


def test_bpmn_has_start_tasks_end_and_chained_flows():
    sessions = [{"steps": [
        {"canonical_step_id": "S1", "time_range": {"start": "2026-05-18T09:00:00Z",
                                                   "end": "2026-05-18T09:00:02Z"}},
        {"canonical_step_id": "S2", "time_range": {"start": "2026-05-18T09:00:02Z",
                                                   "end": "2026-05-18T09:00:04Z"}},
    ]}]
    xml = step_bpmn_from_canonical(CANON, sessions)
    root = ET.fromstring(xml.split("?>", 1)[1])   # drop the XML declaration line
    proc = root.find(_q("process"))
    tasks = proc.findall(_q("task"))
    assert len(tasks) == 2
    assert proc.find(_q("startEvent")) is not None
    assert proc.find(_q("endEvent")) is not None
    # n= reflects the one observed instance per canonical step.
    names = [t.get("name") for t in tasks]
    assert any("Search" in n and "n=1" in n for n in names)
    # One sequenceFlow per hop: start->S1->S2->end == 3.
    assert len(proc.findall(_q("sequenceFlow"))) == 3


def test_bpmn_aggregates_count_across_sessions():
    sessions = [
        {"steps": [{"canonical_step_id": "S1", "time_range": {"start": "2026-05-18T09:00:00Z",
                                                              "end": "2026-05-18T09:00:02Z"}}]},
        {"steps": [{"canonical_step_id": "S1", "time_range": {"start": "2026-05-18T10:00:00Z",
                                                              "end": "2026-05-18T10:00:04Z"}}]},
    ]
    xml = step_bpmn_from_canonical(CANON, sessions)
    # S1 seen twice; avg of 2s and 4s = 3s.
    assert "n=2" in xml and "avg=3s" in xml


def test_bpmn_tolerates_bad_time_range_without_crashing():
    sessions = [{"steps": [{"canonical_step_id": "S1", "time_range": {"start": "nope"}}]}]
    xml = step_bpmn_from_canonical(CANON, sessions)   # must not raise
    assert "n=1" in xml and "avg=0ms" in xml          # counted, duration skipped


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
