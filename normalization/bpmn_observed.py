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


_NOCASE = "__nocase__"


def _phase_names(anno: dict[str, Any]) -> dict[Any, str]:
    out: dict[Any, str] = {}
    for ph in (anno.get("phases") or []):
        out[ph.get("phase_id")] = ph.get("name") or "(phase)"
    return out


def _step_label(s: dict[str, Any], level: str, phase_name: dict[Any, str]) -> str:
    """The node label for a step. Value-FREE for the step level (so repeated work
    collapses to one node, not one per case) -- falls back to name for steps from
    a pre-process_label analyze."""
    if level == "phase":
        pid = s.get("phase_id")
        return phase_name.get(pid, "(phase)") if pid else "(unphased)"
    return s.get("process_label") or s.get("name") or "(unnamed)"


def _visible_steps(anno: dict[str, Any]) -> list[dict[str, Any]]:
    return [s for s in (anno.get("steps") or []) if s and s.get("state") != "hidden"]


def real_case_count(anno: dict[str, Any]) -> int:
    """How many ANCHORED cases the visible steps belong to. The synthetic
    `__nocase__` bucket (orphan steps with no case_id -- out-of-window work, or
    the now-excluded self-capture noise) is NOT a real case and must not inflate
    this, or a single-case session is wrongly mined into a flower model."""
    return len({s.get("case_id") for s in _visible_steps(anno) if s.get("case_id")})


def _collapse(labels):
    """Drop consecutive duplicate labels (the DFG's rule)."""
    out: list[str] = []
    for lab in labels:
        if not out or out[-1] != lab:
            out.append(lab)
    return out


def build_annotation_log(anno: dict[str, Any], level: str) -> EventLog:
    """One trace per case, events labelled by step name (level="step") or phase
    name (level="phase"), time-ordered, consecutive duplicates collapsed.

    Mirrors `buildAnnotationDfg` so the observed-flow BPMN and the Flow-diagram
    DFG describe the same flow.
    """
    phase_name = _phase_names(anno)
    by_case: dict[str, list[dict[str, Any]]] = {}
    for s in _visible_steps(anno):
        by_case.setdefault(s.get("case_id") or _NOCASE, []).append(s)

    log = EventLog()
    for cid, case_steps in by_case.items():
        case_steps = sorted(case_steps, key=_start_key)
        trace = Trace()
        trace.attributes["concept:name"] = cid
        trace.attributes["case:id"] = cid
        prev_label: str | None = None
        for s in case_steps:
            label = _step_label(s, level, phase_name)
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


def session_sequence(anno: dict[str, Any], level: str) -> list[str]:
    """The WHOLE session as one observed path: every visible step's label,
    time-ordered across all cases, consecutive duplicates collapsed. Used when
    there is at most one real case, so a handful of un-cased orphan steps render
    as part of the single chain instead of a second trace that tips the model
    into the inductive miner. Pure."""
    phase_name = _phase_names(anno)
    steps = sorted(_visible_steps(anno), key=_start_key)
    return _collapse(_step_label(s, level, phase_name) for s in steps)


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

    A session with at most ONE real (anchored) case is rendered as a literal
    sequence rather than mined: with one observed path there is nothing to
    generalise, and the inductive miner would otherwise turn repeated/uncollapsed
    labels into spurious branch/loop gateways and smear them across the diagram
    -- the "flower model". Critically, the case count is REAL cases only: orphan
    steps with no case_id (out-of-window work, or self-capture noise) pool into a
    synthetic __nocase__ trace, and counting that as a case used to tip a
    single-case session into the miner and explode the map into branches. The
    miner runs only with 2+ real cases, where cross-case variation is a genuine
    basis for branches.
    """
    import mining  # local import: PM4Py is only needed when --mine is on

    log = build_annotation_log(anno, level)
    if len(log) == 0:
        return False
    if real_case_count(anno) <= 1:
        # <=1 real case: one observed path. Linearise ALL visible steps in time
        # order (orphans fold into the single chain) instead of mining.
        bpmn = _linear_bpmn(session_sequence(anno, level))
    else:
        bpmn = mining.discover_inductive(log, noise_threshold=noise_threshold)
    mining.export_bpmn(bpmn, out_path)
    return True
