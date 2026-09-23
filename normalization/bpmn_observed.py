"""Observed-flow step BPMN.

This module mines the ACTUAL annotated step flow (one trace per case,
labelled by step name) into a BPMN with branches/loops: process_map_step.bpmn.
It is the Process-diagram counterpart of the step Flow diagram
(viewer/process-map-levels.js `buildAnnotationDfg`), and the two share the
same trace logic so they agree.

No Process Template is required. The model comes purely from the annotations, mined with the
PM4Py inductive miner + pure-Python BPMNDI layout in mining.py
(`mining.discover_inductive` + `mining.export_bpmn`).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pm4py.objects.log.obj import Event, EventLog, Trace

from _dt import parse_ts as _parse_ts  # public re-export


def _start_key(step: dict[str, Any]) -> float:
    """Sortable epoch for a step's start; missing/invalid sorts first."""
    ts = (step.get("time_range") or {}).get("start")
    if not ts:
        return 0.0
    try:
        return _parse_ts(ts).timestamp()
    except (ValueError, TypeError, OverflowError):
        return 0.0


def _step_label(s: dict[str, Any]) -> str:
    """The node label for a step. Value-FREE (so repeated work collapses to one
    node, not one per case) -- falls back to name for steps from a
    pre-process_label analyze."""
    return s.get("process_label") or s.get("name") or "(unnamed)"


def _run_steps(anno: dict[str, Any]) -> list[dict[str, Any]]:
    """The visible steps that belong to a run (they carry a case_id). A step
    outside every run (out-of-window work, or the now-excluded self-capture
    noise) is left out of the model: the viewer's map shows the runs only, and
    its Fork copies this model."""
    return [s for s in (anno.get("steps") or [])
            if s and s.get("state") != "hidden" and s.get("case_id")]


def real_case_count(anno: dict[str, Any]) -> int:
    """How many runs the visible steps belong to. Steps outside every run are
    not counted, so they can never tip a one-run session into the miner."""
    return len({s.get("case_id") for s in _run_steps(anno)})


def _collapse(labels):
    """Drop consecutive duplicate labels (the DFG's rule)."""
    out: list[str] = []
    for lab in labels:
        if not out or out[-1] != lab:
            out.append(lab)
    return out


def build_annotation_log(anno: dict[str, Any]) -> EventLog:
    """One trace per case, events labelled by step name, time-ordered,
    consecutive duplicates collapsed. Steps outside every run are left out.

    Mirrors `buildAnnotationDfg` so the observed-flow BPMN and the Flow-diagram
    DFG describe the same flow.
    """
    by_case: dict[str, list[dict[str, Any]]] = {}
    for s in _run_steps(anno):
        by_case.setdefault(s["case_id"], []).append(s)

    log = EventLog()
    for cid, case_steps in by_case.items():
        case_steps = sorted(case_steps, key=_start_key)
        trace = Trace()
        trace.attributes["concept:name"] = cid
        trace.attributes["case:id"] = cid
        prev_label: str | None = None
        for s in case_steps:
            label = _step_label(s)
            if label == prev_label:
                continue  # collapse consecutive duplicates (== the DFG's rule)
            prev_label = label
            e = Event()
            e["concept:name"] = label
            ts = (s.get("time_range") or {}).get("start")
            if ts:
                try:
                    e["time:timestamp"] = _parse_ts(ts)
                except (ValueError, TypeError):
                    pass
            trace.append(e)
        if len(trace) > 0:
            log.append(trace)
    return log


def session_sequence(anno: dict[str, Any]) -> list[str]:
    """The run's observed path: the labels of the visible steps in a run,
    time-ordered, consecutive duplicates collapsed. Used when there is at most
    one run; the steps outside every run are left out. Pure."""
    steps = sorted(_run_steps(anno), key=_start_key)
    return _collapse(_step_label(s) for s in steps)


def _linear_bpmn(labels: list[str]):
    """Render one trace as a literal chain: start -> t1 -> t2 -> ... -> end.

    A single case is one observed path, so there is nothing to generalise. Run
    through the inductive miner it would wrap any repeated label in branch/loop
    gateways the lone trace can't justify -- and, being block-structured, smear
    those diamonds across the whole diagram. A straight chain shows exactly what
    the one case did; a label that recurs simply appears again in sequence.
    """
    from pm4py.objects.bpmn.obj import BPMN
    bpmn = BPMN()
    start = BPMN.StartEvent(name="start")
    end = BPMN.EndEvent(name="end")
    bpmn.add_node(start)
    bpmn.add_node(end)
    prev = start
    for lab in labels:
        task = BPMN.Task(name=lab)
        bpmn.add_node(task)
        bpmn.add_flow(BPMN.Flow(prev, task))
        prev = task
    bpmn.add_flow(BPMN.Flow(prev, end))
    return bpmn


def write_observed_bpmn(
    anno: dict[str, Any],
    out_path: str,
    noise_threshold: float = 0.2,
) -> bool:
    """Mine the observed step flow into BPMN and write it (with layout).

    Returns True if a model was written, False when there is nothing to mine
    (no visible step in a run).

    Only the runs are modelled: a step outside every run (no case_id) is left
    out, because the viewer's map shows the runs only and its Fork copies this
    file. Such steps used to pool into a synthetic trace of their own, which
    also tipped a one-run session into the miner.

    A session with at most ONE run is rendered as a literal sequence rather
    than mined: with one observed path there is nothing to generalise, and the
    inductive miner would otherwise turn repeated/uncollapsed labels into
    spurious branch/loop gateways and smear them across the diagram (the
    "flower model"). The miner runs only with 2+ runs, where variation between
    runs is a genuine basis for branches.
    """
    import mining  # local import: PM4Py is only needed when --mine is on

    log = build_annotation_log(anno)
    if len(log) == 0:
        return False
    if real_case_count(anno) <= 1:
        # One run: one observed path. Linearise its steps in time order
        # instead of mining.
        bpmn = _linear_bpmn(session_sequence(anno))
    else:
        bpmn = mining.discover_inductive(log, noise_threshold=noise_threshold)
    mining.export_bpmn(bpmn, out_path)
    return True
