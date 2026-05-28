"""Observed-flow step/phase BPMN.

The activity-level `process_map.bpmn` is mined from the real event log. This
module does the same one level up: it mines the ACTUAL annotated step/phase
flow -- one trace per case, labelled by step or phase name -- into a BPMN with
branches/loops. It is the Process-diagram counterpart of the step/phase Flow
diagram (viewer/process-map-levels.js `buildAnnotationDfg`), and the two share
the same trace logic so they agree.

No Process Template is required (unlike bpmn_step/bpmn_phase, which render a
template's declared order). The model comes purely from the annotations, mined
with the same PM4Py inductive miner + pure-Python BPMNDI layout used for the
activity map (`mining.discover_inductive` + `mining.export_bpmn`).
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


def build_annotation_log(anno: dict[str, Any], level: str) -> EventLog:
    """One trace per case, events labelled by step name (level="step") or phase
    name (level="phase"), time-ordered, consecutive duplicates collapsed.

    Mirrors `buildAnnotationDfg` so the observed-flow BPMN and the Flow-diagram
    DFG describe the same flow.
    """
    steps = [s for s in (anno.get("steps") or [])
             if s and s.get("state") != "hidden"]
    phase_name: dict[Any, str] = {}
    for ph in (anno.get("phases") or []):
        phase_name[ph.get("phase_id")] = ph.get("name") or "(phase)"

    by_case: dict[str, list[dict[str, Any]]] = {}
    for s in steps:
        cid = s.get("case_id") or "__nocase__"
        by_case.setdefault(cid, []).append(s)

    log = EventLog()
    for cid, case_steps in by_case.items():
        case_steps = sorted(case_steps, key=_start_key)
        trace = Trace()
        trace.attributes["concept:name"] = cid
        trace.attributes["case:id"] = cid
        prev_label: str | None = None
        for s in case_steps:
            if level == "phase":
                pid = s.get("phase_id")
                label = (phase_name.get(pid, "(phase)") if pid else "(unphased)")
            else:
                # Value-free label so repeated work across cases collapses to
                # one node (not one per case). Falls back to name for steps
                # from a pre-process_label analyze.
                label = s.get("process_label") or s.get("name") or "(unnamed)"
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
    level: str,
    out_path: str,
    noise_threshold: float = 0.2,
) -> bool:
    """Mine the observed step/phase flow into BPMN and write it (with layout).

    Returns True if a model was written, False when there is nothing to mine
    (no non-hidden steps / no traces).

    A SINGLE case is rendered as a literal sequence rather than mined: with one
    observed path there is nothing to generalise, and the inductive miner would
    otherwise turn a repeated step label into spurious optional/loop gateways
    (see _linear_bpmn). The miner is used only when there are 2+ cases, where
    cross-case variation is a real basis for branches.
    """
    import mining  # local import: PM4Py is only needed when --mine is on

    log = build_annotation_log(anno, level)
    if len(log) == 0:
        return False
    if len(log) == 1:
        labels = [ev["concept:name"] for ev in log[0]]
        bpmn = _linear_bpmn(labels)
    else:
        bpmn = mining.discover_inductive(log, noise_threshold=noise_threshold)
    mining.export_bpmn(bpmn, out_path)
    return True
