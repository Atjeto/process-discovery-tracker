"""Tests for observed-flow step/phase BPMN (bpmn_observed).

Run with: pytest normalization/test/test_bpmn_observed.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest

# pm4py lives only in the viewer's bundled Python, not the bare dev Python.
# Skip cleanly there (mirrors how mining/xes_export stay untested on bare Python);
# this runs under the bundled interpreter and CI where pm4py is present.
pytest.importorskip("pm4py")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bpmn_observed import build_annotation_log, write_observed_bpmn


def _step(case_id, name, start, *, phase_id=None, state="edited"):
    return {
        "step_id": f"{name}-{case_id}-{start}",
        "case_id": case_id,
        "name": name,
        "phase_id": phase_id,
        "state": state,
        "time_range": {"start": start, "end": start},
    }


def _two_case_anno():
    # Two cases that diverge in the middle and re-converge -> a branch.
    return {"steps": [
        _step("A", "Search",      "2026-05-18T09:00:00Z"),
        _step("A", "Open ticket", "2026-05-18T09:00:10Z"),
        _step("A", "Resolve",     "2026-05-18T09:00:20Z"),
        _step("B", "Search",      "2026-05-18T09:10:00Z"),
        _step("B", "Escalate",    "2026-05-18T09:10:10Z"),
        _step("B", "Resolve",     "2026-05-18T09:10:20Z"),
    ]}


def test_build_log_one_trace_per_case_collapses_consecutive_dups():
    anno = {"steps": [
        _step("A", "Search",  "2026-05-18T09:00:00Z"),
        _step("A", "Search",  "2026-05-18T09:00:05Z"),   # consecutive dup -> collapsed
        _step("A", "Resolve", "2026-05-18T09:00:10Z"),
        _step("B", "Search",  "2026-05-18T09:10:00Z"),
        _step("B", "Resolve", "2026-05-18T09:10:05Z"),
    ]}
    log = build_annotation_log(anno, "step")
    assert len(log) == 2
    a = next(t for t in log if t.attributes["case:id"] == "A")
    assert [e["concept:name"] for e in a] == ["Search", "Resolve"]


def test_build_log_excludes_hidden_steps():
    anno = {"steps": [
        _step("A", "Search",  "2026-05-18T09:00:00Z"),
        _step("A", "Noise",   "2026-05-18T09:00:05Z", state="hidden"),
        _step("A", "Resolve", "2026-05-18T09:00:10Z"),
    ]}
    labels = [e["concept:name"] for t in build_annotation_log(anno, "step") for e in t]
    assert labels == ["Search", "Resolve"]


def test_build_log_orders_by_start_time():
    # Out-of-order input is sorted by time_range.start.
    anno = {"steps": [
        _step("A", "Third",  "2026-05-18T09:00:20Z"),
        _step("A", "First",  "2026-05-18T09:00:00Z"),
        _step("A", "Second", "2026-05-18T09:00:10Z"),
    ]}
    a = next(iter(build_annotation_log(anno, "step")))
    assert [e["concept:name"] for e in a] == ["First", "Second", "Third"]


def test_phase_level_uses_phase_names_and_collapses():
    anno = {
        "phases": [{"phase_id": "p1", "name": "Investigation"},
                   {"phase_id": "p2", "name": "Resolution"}],
        "steps": [
            _step("A", "Search", "2026-05-18T09:00:00Z", phase_id="p1"),
            _step("A", "Lookup", "2026-05-18T09:00:05Z", phase_id="p1"),  # same phase
            _step("A", "Fix",    "2026-05-18T09:00:10Z", phase_id="p2"),
        ],
    }
    labels = [e["concept:name"] for t in build_annotation_log(anno, "phase") for e in t]
    assert labels == ["Investigation", "Resolution"]


def test_write_observed_step_bpmn_has_tasks_layout_and_branch():
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "process_map_step.bpmn")
        assert write_observed_bpmn(_two_case_anno(), "step", out) is True
        xml = Path(out).read_text(encoding="utf-8")
    # Every observed step is represented as a task.
    for name in ("Search", "Open ticket", "Escalate", "Resolve"):
        assert name in xml
    # Renderable in bpmn-js: a BPMNDI layout is present.
    assert "BPMNDiagram" in xml
    # Divergent cases are modelled as a branch (gateway), not a straight line.
    assert "Gateway" in xml


def test_write_returns_false_when_no_steps():
    assert write_observed_bpmn({"steps": []}, "step", "unused.bpmn") is False


def test_single_case_repeated_label_renders_without_gateways():
    # The live-session regression: one case is one observed path. A step label
    # that recurs (Open ... Open) must NOT be mined into optional/loop gateways
    # -- a single trace can't justify them. It renders as a straight chain.
    anno = {"steps": [
        _step("A", "Open",    "2026-05-18T09:00:00Z"),
        _step("A", "Enter",   "2026-05-18T09:00:10Z"),
        _step("A", "Open",    "2026-05-18T09:00:20Z"),   # label recurs
        _step("A", "Approve", "2026-05-18T09:00:30Z"),
    ]}
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "step.bpmn")
        assert write_observed_bpmn(anno, "step", out) is True
        xml = Path(out).read_text(encoding="utf-8")
    assert "Gateway" not in xml          # no invented branches from one path
    assert "BPMNDiagram" in xml          # still laid out for bpmn-js
    for name in ("Open", "Enter", "Approve"):
        assert name in xml


def test_single_case_linear_renders_without_gateways():
    anno = {"steps": [
        _step("A", "One",   "2026-05-18T09:00:00Z"),
        _step("A", "Two",   "2026-05-18T09:00:10Z"),
        _step("A", "Three", "2026-05-18T09:00:20Z"),
    ]}
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "step.bpmn")
        write_observed_bpmn(anno, "step", out)
        xml = Path(out).read_text(encoding="utf-8")
    assert "Gateway" not in xml
