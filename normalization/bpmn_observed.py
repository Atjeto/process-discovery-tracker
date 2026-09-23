"""Observed-flow step BPMN.

This module mines the ACTUAL annotated step flow (one trace per case,
labelled by step name) into a BPMN with branches/loops: process_map_step.bpmn.
It is the Process-diagram counterpart of the step Flow diagram
(viewer/process-map-levels.js `buildAnnotationDfg`), and the two share the
same trace logic so they agree.

No Process Template is required. The model comes purely from the annotations, mined with the
PM4Py inductive miner + pure-Python BPMNDI layout in mining.py
(`mining.discover_inductive` + `mining.export_bpmn`). Each task carries its
step's description and context as documentation, the start and end events
take the document's Trigger and Result, and each branch says in how many runs
it was taken (write_observed_bpmn).
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


def _first_line(text: Any, limit: int = 80) -> str:
    """The first non-blank line of an analyst's text, cut at `limit`
    characters: an event's name on the map."""
    for line in str(text or "").splitlines():
        line = line.strip()
        if line:
            return line if len(line) <= limit else line[:limit - 1].rstrip() + "…"
    return ""


def _document_field(anno: dict[str, Any], key: str) -> str:
    doc = anno.get("document")
    value = doc.get(key) if isinstance(doc, dict) else None
    return value if isinstance(value, str) else ""


def _duration(ms: float) -> str:
    from findings import _fmt_ms
    return "under 1s" if ms < 500 else _fmt_ms(ms)


def _analyst_description(step: dict[str, Any], context: Any) -> str:
    """The step's description when the analyst wrote it: a draft's
    description is the drafting's narration of its interactions (recomputed
    with the same function to tell them apart). Without the interactions,
    only a step the analyst added counts as described."""
    desc = step.get("description")
    desc = desc.strip() if isinstance(desc, str) else ""
    if not desc:
        return ""
    ids = (step.get("evidence") or {}).get("interaction_event_ids") or []
    inter = getattr(context, "interactions", None) or {}
    datas = [inter.get(eid) for eid in ids if isinstance(eid, str)]
    if ids and datas and all(isinstance(d, dict) for d in datas):
        from step_suggest import is_drafted_description
        return "" if is_drafted_description(desc, [{"data": d} for d in datas]) else desc
    return desc if step.get("state") == "manually_authored" else ""


def task_documentation(anno: dict[str, Any], context: Any = None) -> dict[str, str]:
    """{task label: documentation} for the step map: the step's description
    (the analyst's, from the pattern run's step with that label first, else
    any step with it), then one line with its system and screen, in how many
    runs it happened and its average time. `context` is a
    step_context.StepContext (system, screen, interactions), optional."""
    from step_context import step_ms
    steps = sorted(_run_steps(anno), key=_start_key)
    runs = len({s.get("case_id") for s in steps})
    chosen = anno.get("pattern_run")
    pattern = chosen.get("case_id") if isinstance(chosen, dict) else None
    groups: dict[str, list[dict[str, Any]]] = {}
    for s in steps:
        groups.setdefault(_step_label(s), []).append(s)
    out: dict[str, str] = {}
    for label, group in groups.items():
        ordered = ([s for s in group if s.get("case_id") == pattern]
                   + [s for s in group if s.get("case_id") != pattern])
        desc = next((d for d in (_analyst_description(s, context) for s in ordered) if d), "")
        system, screen = context.where(ordered[0]) if context is not None else ("", "")
        n = len({s.get("case_id") for s in group})
        avg = sum(step_ms(s) for s in group) / len(group)
        where = ", ".join(x for x in (system, screen) if x)
        facts = (f"In {n} of {runs} run{'' if runs == 1 else 's'}, "
                 f"{_duration(avg)} on average.")
        lines = [desc] if desc else []
        lines.append(f"{where}. {facts}" if where else facts)
        out[label] = "\n".join(lines)
    return out


def _replay(start_nodes, out_arcs, trace: list[str]):
    """The flows one run's steps take through the model: a breadth-first
    search from a start event to an end event that meets the model's tasks
    in exactly the run's order (gateways and events pass through). None
    when the model does not fit the run (the miner's noise filter can leave
    out a rare path)."""
    from collections import deque
    from pm4py.objects.bpmn.obj import BPMN
    parent: dict[tuple[int, int], Any] = {}
    queue: deque = deque()
    for st in start_nodes:
        parent[(id(st), 0)] = None
        queue.append((st, 0))
    while queue:
        node, i = queue.popleft()
        if isinstance(node, BPMN.EndEvent) and i == len(trace):
            path, state = [], (id(node), i)
            while parent[state] is not None:
                state, flow = parent[state]
                path.append(flow)
            return path
        for flow in out_arcs.get(id(node), []):
            target = flow.get_target()
            if isinstance(target, BPMN.Activity):
                if i >= len(trace) or target.get_name() != trace[i]:
                    continue
                nxt = (id(target), i + 1)
            else:
                nxt = (id(target), i)
            if nxt in parent:
                continue
            parent[nxt] = ((id(node), i), flow)
            queue.append((target, nxt[1]))
    return None


def branch_names(bpmn, traces: list[list[str]]) -> dict[int, str]:
    """{id(flow): "N of M runs"} for every branch of the model: each flow
    leaving a gateway that splits (two or more outgoing flows), with N the
    runs whose steps take it (_replay) and M the runs. A branch no run took
    stays unnamed."""
    from collections import Counter
    from pm4py.objects.bpmn.obj import BPMN
    nodes = list(bpmn.get_nodes())
    out_arcs: dict[int, list] = {}
    for flow in bpmn.get_flows():
        out_arcs.setdefault(id(flow.get_source()), []).append(flow)
    starts = [n for n in nodes if isinstance(n, BPMN.StartEvent)]
    used: Counter = Counter()
    for trace in traces:
        path = _replay(starts, out_arcs, trace)
        for flow in set(path or []):
            used[id(flow)] += 1
    runs = len(traces)
    names: dict[int, str] = {}
    for node in nodes:
        arcs = out_arcs.get(id(node), [])
        if isinstance(node, BPMN.Gateway) and len(arcs) >= 2:
            for flow in arcs:
                if used[id(flow)]:
                    names[id(flow)] = f"{used[id(flow)]} of {runs} run{'' if runs == 1 else 's'}"
    return names


def write_observed_bpmn(
    anno: dict[str, Any],
    out_path: str,
    noise_threshold: float = 0.2,
    *,
    context: Any = None,
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

    What a process manager moving the map into a BPMN tool gets besides the
    shapes: each task carries its step's description, system, screen, run
    count and average time as <bpmn:documentation> (task_documentation); the
    start and end events are named from the document's Trigger and Result
    (annotations.document, the first line of each), and are unnamed while
    those are empty; each branch is named "N of M runs" (branch_names).
    `context` (a step_context.StepContext) supplies the system and screen.
    """
    import mining  # local import: PM4Py is only needed when --mine is on
    from pm4py.objects.bpmn.obj import BPMN

    log = build_annotation_log(anno)
    if len(log) == 0:
        return False
    if real_case_count(anno) <= 1:
        # One run: one observed path. Linearise its steps in time order
        # instead of mining.
        bpmn = _linear_bpmn(session_sequence(anno))
    else:
        bpmn = mining.discover_inductive(log, noise_threshold=noise_threshold)
    trigger = _first_line(_document_field(anno, "trigger"))
    result = _first_line(_document_field(anno, "result"))
    docs_by_label = task_documentation(anno, context)
    documentation: dict[int, str] = {}
    for node in bpmn.get_nodes():
        if isinstance(node, BPMN.StartEvent):
            node.set_name(trigger)
        elif isinstance(node, BPMN.EndEvent):
            node.set_name(result)
        elif isinstance(node, BPMN.Activity) and node.get_name() in docs_by_label:
            documentation[id(node)] = docs_by_label[node.get_name()]
    traces = [[e["concept:name"] for e in trace] for trace in log]
    mining.export_bpmn(bpmn, out_path, documentation=documentation,
                       flow_names=branch_names(bpmn, traces))
    return True
