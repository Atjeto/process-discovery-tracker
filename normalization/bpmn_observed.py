"""Observed-flow step BPMN.

This module draws the ACTUAL annotated step flow (one trace per case,
labelled by step name) as a BPMN with branches and loops:
process_map_step.bpmn. It is the Process-diagram counterpart of the step Flow
diagram (viewer/process-map-levels.js `buildAnnotationDfg`), and the two
share the same edges so they agree.

No Process Template is required. The model comes purely from the
annotations: the step flow edges (step_flow.flow_edges, the rule the
viewer's live map shares: each transaction's steps one after another, plus
the flow the analyst set on steps, contract C17: a condition, a loop back, a
skip ahead, an early end), drawn with sequence flows and exclusive gateways
(_flow_bpmn: a gateway after a step with several ways out and before a step
with several ways in, each declared label the name of its flow), laid out
by mining.export_bpmn. One transaction is a chain of its steps. Lane LF-PIPE
(#9): the inductive miner is gone; it read the varying order of steps
between transactions as work done in parallel, while every recorded
transaction is one sequential trace. Each task carries its step's
description and context as documentation, the start and end events take the
document's Trigger and Result, and each branch says in how many
transactions it was taken (write_observed_bpmn). The names and the
documentation a person reads say "transaction" for a run (AD-29).

Contract C18 draws the map the way BPM tools do, from what the session
already holds: the main end event is named by the outcome (the Result, else
"End") and each link to the end ends at an end event of its own, named by
its `when`; a step done in a system (recorded, or added by hand with its
system set) is a plain task and a step done outside every system a manual
task, the hand marker (C18 as lane CL amended it: the same person marker on
every box said nothing); the analyst's notes on a step are a text annotation
joined to its task, and the files attached to it data objects joined to it;
the system a task is done in is a short text annotation above it (2.0.1: a
process manager changes it by typing in any BPMN tool, which a colour
allowed in none), said once for a map whose every task is done in one
system (_map_extras).

Contract C19 splits a process into sub-processes: every map of
sub_process_maps.map_tree is a plane of the one file. A sub-process node is
a collapsed bpmn:subProcess in its parent's map, holding its own map, chosen,
documented and dressed as the main one from the visits that ran it
(_sub_process_planes).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from pm4py.objects.log.obj import Event, EventLog, Trace

import step_flow
from _dt import parse_ts as _parse_ts  # public re-export
from step_context import fmt_ms, process_order, step_duration_ms, step_sort_key, step_system


def _start_key(step: dict[str, Any]) -> tuple[int, float]:
    """A run's step order (contract C16, step_context.step_sort_key): the
    steps with a start time by that time, then the steps without one (added
    by hand, `time_range: null`) by their `order`."""
    return step_sort_key(step)


def _in_process_order(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Steps of several runs, each run's in its process order (contract C22,
    step_context.process_order: time, then `order`, a step the analyst placed
    after another right after it), the runs by their first step's place."""
    by_case: dict[Any, list[dict[str, Any]]] = {}
    for s in sorted(steps, key=_start_key):
        by_case.setdefault(s.get("case_id"), []).append(s)
    return [s for run in by_case.values() for s in process_order(run)]


def _step_label(s: dict[str, Any]) -> str:
    """The node label for a step. Value-FREE (so repeated work collapses to one
    node, not one per case) -- falls back to name for steps from a
    pre-process_label analyze. The step flow's node rule (step_flow.node_of)."""
    return step_flow.node_of(s)


def _run_steps(anno: dict[str, Any]) -> list[dict[str, Any]]:
    """The visible steps that belong to a run (they carry a case_id). A step
    outside every run (out-of-window work, or the now-excluded self-capture
    noise) is left out of the model: the viewer's map shows the runs only, and
    its Fork copies this model."""
    return [s for s in (anno.get("steps") or [])
            if s and s.get("state") != "hidden" and s.get("case_id")]


def real_case_count(anno: dict[str, Any]) -> int:
    """How many runs the visible steps belong to. Steps outside every run are
    not counted, so they can never turn a one-run session's chain into a
    map of several runs."""
    return len({s.get("case_id") for s in _run_steps(anno)})


def _transactions(anno: dict[str, Any], run_order: Any = None) -> list[list[dict[str, Any]]]:
    """Each run's visible steps, the runs in `run_order` (case ids, the
    order the viewer lists the transactions in: by start, then case id),
    any other run after them by its first step (step_sort_key), then its
    case id. The step flow edges read them (step_flow.flow_edges)."""
    by_case: dict[str, list[dict[str, Any]]] = {}
    for s in _run_steps(anno):
        by_case.setdefault(s["case_id"], []).append(s)
    first = [c for c in dict.fromkeys(run_order or []) if c in by_case]
    rest = sorted((c for c in by_case if c not in first),
                  key=lambda c: (min(step_sort_key(s) for s in by_case[c]), str(c)))
    return [by_case[c] for c in first + rest]


def _left_out(anno: dict[str, Any], transactions: list[list[dict[str, Any]]],
              run_spans: Any) -> list[list[tuple]]:
    """Each transaction's stretches left out of the analysis
    (annotations.excluded_ranges cut to its span, step_flow.left_out_stretches),
    in the order of `transactions`; `run_spans` is {case id: (start, end)}
    (ISO, end None for a transaction left open). [] for a transaction whose
    span is not given."""
    ranges = anno.get("excluded_ranges")
    spans = run_spans if isinstance(run_spans, dict) else {}
    out: list[list[tuple]] = []
    for steps in transactions:
        span = spans.get(steps[0].get("case_id")) if steps else None
        if not ranges or not isinstance(span, (list, tuple)) or len(span) != 2:
            out.append([])
            continue
        start = _parse_or_none(span[0])
        end = _parse_or_none(span[1])
        out.append(step_flow.left_out_stretches(ranges, start, end))
    return out


def _parse_or_none(ts: Any):
    """An ISO timestamp as a datetime, or None."""
    try:
        return _parse_ts(ts) if isinstance(ts, str) and ts else None
    except (ValueError, TypeError):
        return None


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
        case_steps = process_order(case_steps)
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
    in its process order (time order, a step the analyst placed after another
    right after it, contract C22), consecutive duplicates collapsed. Used when
    there is at most one run; the steps outside every run are left out. Pure."""
    steps = _in_process_order(_run_steps(anno))
    return _collapse(_step_label(s) for s in steps)


def _linear_bpmn(labels: list[str]):
    """Render one trace as a literal chain: start -> t1 -> t2 -> ... -> end.

    A single case is one observed path, so there is nothing to generalise:
    drawn from its edges, a label that recurs would become a loop the lone
    trace cannot justify (the inductive miner, gone since lane LF-PIPE,
    smeared such gateways across the whole diagram). A straight chain shows
    exactly what the one case did; a label that recurs simply appears again
    in sequence.
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


def _pattern_case(anno: dict[str, Any]) -> Any:
    """The case id of the reference transaction the analyst chose
    (annotations.pattern_run), or None."""
    chosen = anno.get("pattern_run")
    return chosen.get("case_id") if isinstance(chosen, dict) else None


def _node_steps(anno: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """{task label: its steps}: the visible steps of the runs grouped by map
    node, those of the reference transaction first, then the others, each
    part in time order (then `order`, C16)."""
    pattern = _pattern_case(anno)
    groups: dict[str, list[dict[str, Any]]] = {}
    for s in sorted(_run_steps(anno), key=_start_key):
        groups.setdefault(_step_label(s), []).append(s)
    return {label: ([s for s in group if s.get("case_id") == pattern]
                    + [s for s in group if s.get("case_id") != pattern])
            for label, group in groups.items()}


def task_documentation(anno: dict[str, Any], context: Any = None,
                       implicit_runs: Any = ()) -> dict[str, str]:
    """{task label: documentation} for the step map: the step's description
    (the analyst's, from the pattern run's step with that label first, else
    any step with it), then one line with its system and screen, in how many
    transactions it happened ("In 3 of 4 transactions") and its average
    time. `context` is a
    step_context.StepContext (system, screen, interactions), optional.

    Contract C16: the average leaves out the steps without a time range,
    and a label no timed step has says no time; the implicit run of a
    session without a recording (`implicit_runs`, its case id) was not
    marked, so the line does not count runs there. A step with no system,
    no screen, no time and no description gets no documentation."""
    steps = sorted(_run_steps(anno), key=_start_key)
    runs = len({s.get("case_id") for s in steps})
    groups: dict[str, list[tuple[Any, dict[str, Any]]]] = {}
    for s in steps:
        groups.setdefault(_step_label(s), []).append((s.get("case_id"), s))
    return _documented(groups, runs, _pattern_case(anno), set(implicit_runs or ()), context)


def _documented(groups: dict[str, list[tuple[Any, dict[str, Any]]]], runs: int,
                pattern: Any, implicit: set, context: Any) -> dict[str, str]:
    """{task label: documentation} of `groups` ({label: [(case id, step)]},
    each in order) over `runs` transactions, in task_documentation's words:
    the analyst's description (the `pattern` transaction's step first), the
    system and screen, in how many transactions (not said when each is in
    `implicit`) and the average time. A sub-process's map (contract C19)
    passes its own steps and the transactions that ran it."""
    out: dict[str, str] = {}
    for label, pairs in groups.items():
        group = [s for _c, s in pairs]
        ordered = ([s for c, s in pairs if c == pattern]
                   + [s for c, s in pairs if c != pattern])
        desc = next((d for d in (_analyst_description(s, context) for s in ordered) if d), "")
        system, screen = context.where(ordered[0]) if context is not None else ("", "")
        cases = {c for c, _s in pairs}
        n = len(cases)
        timed = [ms for ms in (step_duration_ms(s) for s in group) if ms is not None]
        where = ", ".join(x for x in (system, screen) if x)
        facts = []
        if not (cases <= implicit):
            facts.append(f"in {n} of {runs} transaction{'' if runs == 1 else 's'}")
        if timed:
            facts.append(f"{fmt_ms(sum(timed) / len(timed))} on average")
        said = ", ".join(facts)
        said = said[:1].upper() + said[1:] + "." if said else ""
        lines = [desc] if desc else []
        if where or said:
            lines.append(" ".join(x for x in (f"{where}." if where else "", said) if x))
        if lines:
            out[label] = "\n".join(lines)
    return out


def _replay(start_nodes, out_arcs, trace: list[str]):
    """The flows one run's steps take through the model: a breadth-first
    search from a start event to an end event that meets the model's tasks
    in exactly the run's order (gateways and events pass through). None
    when the model does not fit the run."""
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


def branch_names(bpmn, traces: list[list[str]], groups: list | None = None) -> dict[int, str]:
    """{id(flow): "N of M transactions"} for every branch of the model: each flow
    leaving a gateway that splits (two or more outgoing flows), with N the
    runs whose steps take it (_replay) and M the runs. A branch no run took
    stays unnamed. `groups` names the transaction of each trace when one
    transaction can have several (contract C19: a sub-process's map has a
    trace per visit, and its counts are over the transactions that ran it);
    by default each trace is a transaction of its own."""
    from pm4py.objects.bpmn.obj import BPMN
    nodes = list(bpmn.get_nodes())
    out_arcs: dict[int, list] = {}
    for flow in bpmn.get_flows():
        out_arcs.setdefault(id(flow.get_source()), []).append(flow)
    starts = [n for n in nodes if isinstance(n, BPMN.StartEvent)]
    groups = list(range(len(traces))) if groups is None else list(groups)
    used: dict[int, set] = {}
    for trace, group in zip(traces, groups):
        path = _replay(starts, out_arcs, trace)
        for flow in set(path or []):
            used.setdefault(id(flow), set()).add(group)
    runs = len(set(groups))
    names: dict[int, str] = {}
    for node in nodes:
        arcs = out_arcs.get(id(node), [])
        if isinstance(node, BPMN.Gateway) and len(arcs) >= 2:
            for flow in arcs:
                if used.get(id(flow)):
                    names[id(flow)] = _taken(len(used[id(flow)]), runs)
    return names


def _taken(n: int, runs: int) -> str:
    """How many transactions took a branch: "2 of 3 transactions"."""
    return f"{n} of {runs} transaction{'' if runs == 1 else 's'}"


# The longest flow name the map shows: bpmn-js wraps a name at 90 px, about
# 16 characters, so this keeps a label about three lines tall.
_FLOW_NAME_MAX = 48


def _cut(text: str, limit: int) -> str:
    """`text` when it holds at most `limit` characters, else cut after the
    last whole word that fits in `limit` characters, with an ellipsis."""
    if len(text) <= limit:
        return text
    cut = text[:limit - 1]
    at = max(cut.rfind(" "), cut.rfind("\n"))
    if at > 0:
        cut = cut[:at]
    return cut.rstrip(" ,;:.\n") + "…"


def _flow_name(label: str) -> str:
    """A declared label as the map names its flow: one line, cut after the
    last whole word that fits in _FLOW_NAME_MAX characters, with an ellipsis.
    The whole label is the flow's documentation and the PDD prints it. An
    early end event (C18) and a data object are named the same way."""
    return _cut(" ".join(label.split()), _FLOW_NAME_MAX)


class _OrderedModel:
    """The step flow map as mining.export_bpmn reads it: its nodes and flows
    in the order they were added. pm4py's BPMN keeps them in sets, whose
    order changes from run to run; this model is written the same way every
    time."""

    def __init__(self):
        self._nodes: list = []
        self._flows: list = []

    def add_node(self, node):
        self._nodes.append(node)
        return node

    def add_flow(self, flow):
        self._flows.append(flow)
        return flow

    def get_nodes(self):
        return list(self._nodes)

    def get_flows(self):
        return list(self._flows)


def _arcs(edges: list[dict]) -> list[tuple[Any, Any, Any, dict]]:
    """The step flow edges as the map's arcs, (from, to, label, edge).
    Contract C18: an edge into the end that no transaction took and that a
    link to the end declared is one arc per label: each link's `when` to an
    end event of its own (the key (END, n)), "otherwise" (the path around a
    last step that happens only under a condition) to the main end. Every
    other edge is one arc, its labels joined as the edge's label."""
    arcs: list[tuple[Any, Any, Any, dict]] = []
    early = 0
    for e in edges:
        parts = e.get("labels") or []
        if (e["to"] == step_flow.END and not e["observed"]
                and any(p != step_flow.OTHERWISE for p in parts)):
            for part in parts:
                if part == step_flow.OTHERWISE:
                    arcs.append((e["from"], step_flow.END, part, e))
                else:
                    arcs.append((e["from"], (step_flow.END, early), part, e))
                    early += 1
        else:
            arcs.append((e["from"], e["to"], e["label"], e))
    return arcs


def _flow_bpmn(edges: list[dict], runs: int, count_runs: bool = True):
    """(model, {id(flow): name}, {id(flow or end event): documentation},
    {id(early end event)}) of the step flow edges (contract C17,
    step_flow.flow_edges): a start event, one task per node, the main
    end event and (C18) an end event for each link to the end (_arcs), named
    by its `when` (_flow_name; the whole `when` its documentation when cut);
    an exclusive gateway after a node with several ways out (a split) and
    before a node with several ways in (a join); each arc one sequence flow
    from its source's split (else the source) to its target's join (else the
    target). A flow is named by the arc's declared label (_flow_name; a
    label cut for the map is whole in the flow's documentation), except a
    flow into an early end, which carries no name: its end event says the
    `when` once (the viewer's live map keeps the label on its line into its
    one End). An observed branch leaving a split without a label says how
    many of the `runs` transactions took it, unless `count_runs` is off (the
    implicit run of a session without a recording is not a marked
    transaction, C16)."""
    from pm4py.objects.bpmn.obj import BPMN
    model = _OrderedModel()
    arcs = _arcs(edges)
    outs: dict[Any, list] = {}
    ins: dict[Any, list] = {}
    for arc in arcs:
        outs.setdefault(arc[0], []).append(arc)
        ins.setdefault(arc[1], []).append(arc)
    names: dict[int, str] = {}
    docs: dict[int, str] = {}
    early: set[int] = set()
    nodes: dict[Any, Any] = {}
    for key in [step_flow.START] + [k for arc in arcs for k in (arc[0], arc[1])]:
        if key not in nodes:
            if key == step_flow.START:
                node = BPMN.StartEvent(name="start")
            elif key == step_flow.END:
                node = BPMN.EndEvent(name="end")
            elif isinstance(key, tuple):
                when = ins[key][0][2]
                node = BPMN.EndEvent(name=_flow_name(when))
                early.add(id(node))
                if node.get_name() != when:
                    docs[id(node)] = when
            else:
                node = BPMN.Task(name=key)
            nodes[key] = model.add_node(node)
    entry, exit_ = dict(nodes), dict(nodes)
    for key, node in nodes.items():
        if len(ins.get(key, [])) > 1:
            join = model.add_node(BPMN.ExclusiveGateway(
                gateway_direction=BPMN.Gateway.Direction.CONVERGING))
            model.add_flow(BPMN.Flow(join, node))
            entry[key] = join
        if len(outs.get(key, [])) > 1:
            split = model.add_node(BPMN.ExclusiveGateway(
                gateway_direction=BPMN.Gateway.Direction.DIVERGING))
            model.add_flow(BPMN.Flow(node, split))
            exit_[key] = split
    for source, target, label, e in arcs:
        flow = model.add_flow(BPMN.Flow(exit_[source], entry[target]))
        name = _flow_name(label) if label and not isinstance(target, tuple) else ""
        if name and name != label:
            docs[id(flow)] = label
        if not name and e["observed"] and count_runs and len(outs[source]) > 1:
            name = _taken(e["transactions"], runs)
        if name:
            names[id(flow)] = name
    return model, names, docs, early


# ---- contract C18: what the map shows beside its tasks -------------------------

# The main end's name while the document's Result is empty.
_MAIN_END = "End"
# The longest text a note shows on the map (about five lines of the note,
# mining._NOTE_W wide); the whole notes are the annotation's documentation.
_NOTE_MAX = 90
_ID_BAD = re.compile(r"[^A-Za-z0-9_\-]")


def _hand_added(step: dict[str, Any]) -> bool:
    """True for a step the analyst added by hand: manually authored, with no
    recorded interaction."""
    evidence = step.get("evidence")
    ids = evidence.get("interaction_event_ids") if isinstance(evidence, dict) else None
    return step.get("state") == "manually_authored" and not ids


def _outside_systems(step: dict[str, Any], context: Any) -> bool:
    """True for a step done outside every system: added by hand, with no
    recorded interaction and no system (none set by the analyst, none
    derived). Its task is a manual task, BPMN's hand marker; a step done in a
    system, recorded or added by hand with its system set, is a plain task
    (C18 as lane CL amended it). A sub-process is never one: it is drawn as
    a collapsed sub-process (C19)."""
    return (_hand_added(step) and not isinstance(step.get("sub_steps"), list)
            and not _system_of(step, context))


def _system_of(step: dict[str, Any], context: Any) -> str:
    """A step's system as its task's documentation names it
    (StepContext.where); without a context, the one the analyst set (C16)."""
    return context.where(step)[0] if context is not None else step_system(step)


def _notes_of(anno: dict[str, Any], steps: list[dict[str, Any]]) -> str:
    """The analyst's notes on these steps (analyst_notes with their step_id,
    C16) in the steps' order, then the list's: one line each, its whitespace
    collapsed, a note written twice once."""
    by_step: dict[str, list[str]] = {}
    for note in anno.get("analyst_notes") or []:
        if not (isinstance(note, dict) and isinstance(note.get("step_id"), str)
                and isinstance(note.get("text"), str)):
            continue
        text = " ".join(note["text"].split())
        if text:
            by_step.setdefault(note["step_id"], []).append(text)
    texts: list[str] = []
    for s in steps:
        for text in by_step.get(s.get("step_id"), []):
            if text not in texts:
                texts.append(text)
    return "\n".join(texts)


def _file_name(value: Any) -> str:
    """The file name of an attachment's `file` without any folder part, or ""
    when it is not a usable name (the PDD's rule, C16)."""
    if not isinstance(value, str):
        return ""
    name = re.split(r"[\\/]", value.strip())[-1]
    return "" if name in ("", ".", "..") else name


def _data_objects(anno: dict[str, Any], steps: list[dict[str, Any]],
                  used: set[str]) -> list[tuple[str, str, str]]:
    """[(key, name, documentation)] of the files attached to these steps
    (attachments with their step_id, C16), in the steps' order, then the
    list's. The name is the label, else the file name (_flow_name); the
    documentation is the whole label when the name was cut, then the file's
    place in the project folder. The key is the attachment's id, fit for an
    XML id and unique (`used`)."""
    by_step: dict[str, list[dict]] = {}
    for att in anno.get("attachments") or []:
        if isinstance(att, dict) and isinstance(att.get("step_id"), str) and _file_name(att.get("file")):
            by_step.setdefault(att["step_id"], []).append(att)
    out = []
    for s in steps:
        for att in by_step.get(s.get("step_id"), []):
            file = _file_name(att.get("file"))
            label = att.get("label")
            label = " ".join(label.split()) if isinstance(label, str) else ""
            name = _flow_name(label or file)
            doc = f"attachments/{file}"
            if label and name != label:
                doc = f"{label}\n{doc}"
            key = _ID_BAD.sub("_", str(att.get("id") or ""))[:40] or "file"
            base, n = key, 1
            while key in used:
                n += 1
                key = f"{base}_{n}"
            used.add(key)
            out.append((key, name, doc))
    return out


def _map_extras(anno: dict[str, Any], model: Any, context: Any, *,
                used: set | None = None) -> dict[str, Any]:
    """What contract C18 puts beside the map's tasks, as mining.export_bpmn
    takes it (keyed by a task's id()): its kind (a manual task when every
    step it stands for was done outside every system, _outside_systems;
    else a plain task); the system it is done in (2.0.1), as a label above
    it, or once for the map when every task of it is done in one system
    (_extras_of); its steps' notes (one text annotation, cut at _NOTE_MAX
    characters, whole in its documentation when cut); the files attached
    to its steps (a data object each, _data_objects). A task's system is
    the one its documentation names (its reference transaction's step
    first). When one label is on several tasks (a transaction that came
    back to a step), the first holds its notes and files.

    `used` (the data objects' keys) is shared with the sub-processes' maps
    of the file (contract C19, _sub_process_planes)."""
    by_label = _node_steps(anno)
    node_system = {label: _system_of(steps[0], context) for label, steps in by_label.items()}
    return _extras_of(anno, model, by_label, node_system, context,
                      set() if used is None else used)


def _wasted(steps: list[dict[str, Any]]) -> bool:
    """True when a visible step of `steps` is flagged as waste: the rule of
    the live map's boxes (viewer/process-map-levels.js wasteNodes, lane FX2):
    a hidden step marks nothing."""
    return any(s.get("state") != "hidden" and isinstance(s.get("flags"), dict)
               and s["flags"].get("waste") is True for s in steps)


def _extras_of(anno: dict[str, Any], model: Any, by_label: dict[str, list[dict[str, Any]]],
               node_system: dict[str, str], context: Any, used: set) -> dict[str, Any]:
    """_map_extras for one map: `by_label` its steps by task label (the
    reference transaction's first), `node_system` each label's system. Each
    task done in a system is labelled with it (`systems`, 2.0.1: a text
    annotation above the task, which a process manager changes by typing
    in any BPMN tool, where a colour could be changed in none), unless every
    task of the map that is done in a system is done in the same one: the
    map then says it once (`map_system`) and labels no task. A manual task
    (done outside every system) carries the hand marker and no label.
    `waste` holds the tasks a step of which is flagged as waste (_wasted),
    each of them, as the live map marks its box (lane FX3)."""
    from pm4py.objects.bpmn.obj import BPMN
    task_tags: dict[int, str] = {}
    systems: dict[int, str] = {}
    notes: dict[int, tuple[str, str | None]] = {}
    data: dict[int, list[tuple[str, str, str]]] = {}
    waste: set[int] = set()
    done: set[str] = set()
    for node in model.get_nodes():
        label = node.get_name() if isinstance(node, BPMN.Activity) else None
        if label not in by_label:
            continue
        steps = by_label[label]
        manual = all(_outside_systems(s, context) for s in steps)
        task_tags[id(node)] = "manualTask" if manual else "task"
        if not manual and node_system.get(label):
            systems[id(node)] = node_system[label]
        if _wasted(steps):
            waste.add(id(node))
        if label in done:
            continue
        done.add(label)
        text = _notes_of(anno, steps)
        if text:
            shown = _cut(text, _NOTE_MAX)
            notes[id(node)] = (shown, text if shown != text else None)
        objects = _data_objects(anno, steps, used)
        if objects:
            data[id(node)] = objects
    named = set(systems.values())
    map_system = next(iter(named)) if len(named) == 1 else None
    if map_system:
        systems = {}
    return {"task_tags": task_tags, "systems": systems, "map_system": map_system,
            "notes": notes, "data": data, "waste": waste}


# ---- contract C19: a map per sub-process, each a plane of the one file ----------

def _per_transaction(edges: list[dict], traces: list[list[dict[str, Any]]],
                     tx: list[int]) -> list[dict]:
    """The step flow edges of a sub-process's map, each counting the
    transactions that took it in place of its traces: one transaction can
    visit a sub-process twice, and the map's counts are over the
    transactions that ran it (contract C19). `tx` names each trace's
    transaction."""
    import sub_process_maps
    taken: dict[tuple[str, str], set] = {}
    for t, trace in zip(tx, traces):
        path = ([step_flow.START] + [node for node, _s in sub_process_maps.visits(trace)]
                + [step_flow.END])
        for a, b in zip(path, path[1:]):
            taken.setdefault((a, b), set()).add(t)
    return [dict(e, transactions=len(taken.get((e["from"], e["to"]), ()))) for e in edges]


def _plane_model(traces: list[list[dict[str, Any]]], tx: list[int], marked: bool):
    """(model, {id(flow): name}, {id(flow or end event): documentation},
    {id(early end)}, label room) of a sub-process's map, chosen as the main
    map's is (contract C19): a chain for one trace without flow set on its
    steps, else the step flow edges (_flow_bpmn, with label room when the
    flow set on its steps changes the map); a sub-process with no steps is a
    start joined to an end. Its counts are over the transactions `tx` of
    its traces, and none is said unless one of them is `marked` (not the
    implicit run of a session without a recording, C16)."""
    from pm4py.objects.bpmn.obj import BPMN
    if not traces:
        model = _OrderedModel()
        start = model.add_node(BPMN.StartEvent(name=""))
        end = model.add_node(BPMN.EndEvent(name=""))
        model.add_flow(BPMN.Flow(start, end))
        return model, {}, {}, set(), False
    edges = step_flow.flow_edges(traces)
    declared = step_flow.changes_map(edges)
    if declared or len(traces) > 1:
        model, names, docs, early = _flow_bpmn(_per_transaction(edges, traces, tx),
                                               len(set(tx)), count_runs=marked)
        return model, names, docs, early, declared
    labels = [_collapse(_step_label(s) for s in trace) for trace in traces]
    model = _linear_bpmn(labels[0])
    names = branch_names(model, labels, groups=tx) if marked else {}
    return model, names, {}, set(), False


def _sub_process_planes(anno: dict[str, Any], task_tags: dict[int, str], model: Any,
                        transactions: list[list[dict[str, Any]]], *, context: Any = None,
                        implicit_runs: Any = (), used: set | None = None) -> dict[int, dict]:
    """Contract C19: every map of sub_process_maps.map_tree below the main
    one, as mining.export_bpmn takes it (its `sub_planes`): {id(task): the
    sub-process's map}. Each task of a sub-process node is tagged
    "subProcess" in `task_tags` (a collapsed sub-process, in place of the
    task); the first of them holds the map (as the first holds a label's
    notes and files, C18), which holds its own sub-processes' maps the same
    way, at any depth.

    A map is chosen, documented and dressed as the main one is
    (_plane_model, _documented, _extras_of) from its own traces: its start
    and main end are unnamed and its early ends keep their `when`; its
    counts ("In N of M transactions", the branch names) are over the
    transactions that ran the sub-process; its tasks are labelled with
    their systems as the main map's are (said once when it is done in one
    system); its data objects' keys stay unique (`used`). Its ids start with
    "Sub<n>_", n its place in map_tree's list, unique in the file. {} when
    no step is a sub-process."""
    import sub_process_maps
    from pm4py.objects.bpmn.obj import BPMN
    pattern = _pattern_case(anno)
    case_of = [steps[0].get("case_id") if steps else None for steps in transactions]
    reference = next((i for i, c in enumerate(case_of) if c == pattern), 0)
    children: dict[tuple, list[tuple[int, dict]]] = {}
    for index, m in enumerate(sub_process_maps.map_tree(transactions, reference)):
        if m["path"]:
            children.setdefault(tuple(m["path"][:-1]), []).append((index, m))
    implicit = set(implicit_runs or ())
    used = set() if used is None else used

    def attach(model, tags, path) -> dict[int, dict]:
        planes: dict[int, dict] = {}
        for index, m in children.get(path, []):
            tasks = [n for n in model.get_nodes()
                     if isinstance(n, BPMN.Activity) and n.get_name() == m["path"][-1]]
            if not tasks:
                continue        # a node the map does not draw: no task holds its map
            for task in tasks:
                tags[id(task)] = "subProcess"
            planes[id(tasks[0])] = plane(index, m)
        return planes

    def plane(index, m) -> dict:
        traces, tx = m["traces"], m["transactions"]
        cases = [case_of[t] for t in tx]
        model, flow_names, documentation, early, label_room = _plane_model(
            traces, tx, not set(cases) <= implicit)
        groups: dict[str, list[tuple[Any, dict[str, Any]]]] = {}
        for c, trace in zip(cases, traces):
            for s in trace:
                groups.setdefault(_step_label(s), []).append((c, s))
        docs = _documented(groups, len(set(tx)), pattern, implicit, context)
        for node in model.get_nodes():
            if isinstance(node, BPMN.StartEvent):
                node.set_name("")
            elif isinstance(node, BPMN.EndEvent):
                if id(node) not in early:
                    node.set_name("")
            elif isinstance(node, BPMN.Activity) and node.get_name() in docs:
                documentation[id(node)] = docs[node.get_name()]
        by_label = {label: ([s for c, s in pairs if c == pattern]
                            + [s for c, s in pairs if c != pattern])
                    for label, pairs in groups.items()}
        node_system = {label: _system_of(steps[0], context) for label, steps in by_label.items()}
        extras = _extras_of(anno, model, by_label, node_system, context, used)
        spec = {"model": model, "prefix": f"Sub{index}_", "documentation": documentation,
                "flow_names": flow_names, "label_room": label_room, **extras}
        nested = attach(model, extras["task_tags"], tuple(m["path"]))
        if nested:
            spec["sub_planes"] = nested
        return spec

    return attach(model, task_tags, ())


def write_observed_bpmn(
    anno: dict[str, Any],
    out_path: str,
    *,
    context: Any = None,
    implicit_runs: Any = (),
    run_order: Any = None,
    run_spans: Any = None,
) -> bool:
    """Draw the observed step flow as BPMN and write it (with layout).

    Returns True if a model was written, False when there is nothing to mine
    (no visible step in a run).

    Only the runs are modelled: a step outside every run (no case_id) is left
    out, because the viewer's map shows the runs only and its Fork copies this
    file. Such steps used to pool into a synthetic trace of their own, which
    also tipped a one-run session into the miner.

    A session with at most ONE run is rendered as a literal sequence: with
    one observed path there is nothing to generalise, and a label that recurs
    simply appears again in sequence. With 2+ runs the map is drawn from the
    step flow edges (_flow_bpmn): sequence flows and exclusive gateways where
    the transactions went different ways, never a parallel split (lane
    LF-PIPE, #9: the inductive miner that drew them is gone; every recorded
    transaction is one sequential trace).

    What a process manager moving the map into a BPMN tool gets besides the
    shapes: each task carries its step's description, system, screen, run
    count and average time as <bpmn:documentation> (task_documentation); the
    start event is named from the first line of the document's Trigger
    (annotations.document; unnamed while it is empty) and the main end event
    from the first line of its Result, else "End" (C18); each branch is
    named "N of M transactions" (branch_names). Contract C18 adds the task
    kinds, the system each task is done in (a label above it, or once for a
    map done in one system), the notes and the data objects (_map_extras).
    `context` (a step_context.StepContext) supplies the system and screen.
    `implicit_runs` holds the case id of a session's implicit run (C16),
    whose steps the documentation does not count in runs.

    A run's steps are in time order, then the steps without a time by
    their `order` (C16), both here and in the viewer's map.

    When the analyst has set the flow on steps (contract C17) and it changes
    the map (step_flow.changes_map), the map is drawn from the step flow
    edges even for one run (_flow_bpmn): the same edges the viewer's live
    map draws, with the declared labels as flow names and room for them
    (mining.export_bpmn label_room). `run_order` lists the case
    ids in the viewer's transaction order, the order the labels of one flow
    are joined in. Each link to the end ends at an end event of its own,
    named by its `when` (C18, _arcs).

    A stretch left out of the analysis (annotations.excluded_ranges) cuts
    the trace of the transaction it falls in (lane FX1, step_flow's rule):
    `run_spans` ({case id: (start, end)}, the transactions' spans in
    stats.json) place the stretches. When the cuts change the map, a whole
    trace would draw a path no transaction took (the start straight into
    the first step after a stretch that opens a transaction), so the map is
    drawn from the cut edges (_flow_bpmn), as for a flow the analyst set.

    Contract C19: a step that carries `sub_steps` is a sub-process. Its node
    is a collapsed bpmn:subProcess in place of its task, holding its own map
    (sub_process_maps.map_tree), drawn in a plane of its own, at any depth
    (_sub_process_planes). Without a sub-process the file is what it was.
    """
    import mining  # local import: PM4Py is only needed when --mine is on
    from pm4py.objects.bpmn.obj import BPMN

    log = build_annotation_log(anno)
    if len(log) == 0:
        return False
    transactions = _transactions(anno, run_order)
    left_out = _left_out(anno, transactions, run_spans)
    edges = step_flow.flow_edges(transactions, left_out)
    declared = (step_flow.changes_map(edges)
                or step_flow.cuts_change_map(transactions, left_out))
    flow_names = None
    documentation: dict[int, str] = {}
    early_ends: set[int] = set()
    if declared or real_case_count(anno) > 1:
        implicit = set(implicit_runs or ())
        marked = not {s.get("case_id") for t in transactions for s in t} <= implicit
        bpmn, flow_names, documentation, early_ends = _flow_bpmn(
            edges, len(transactions), count_runs=marked)
    else:
        # One run: one observed path, its steps in time order.
        bpmn = _linear_bpmn(session_sequence(anno))
    trigger = _first_line(_document_field(anno, "trigger"))
    result = _first_line(_document_field(anno, "result")) or _MAIN_END
    docs_by_label = task_documentation(anno, context, implicit_runs)
    for node in bpmn.get_nodes():
        if isinstance(node, BPMN.StartEvent):
            node.set_name(trigger)
        elif isinstance(node, BPMN.EndEvent):
            if id(node) not in early_ends:
                node.set_name(result)
        elif isinstance(node, BPMN.Activity) and node.get_name() in docs_by_label:
            documentation[id(node)] = docs_by_label[node.get_name()]
    if flow_names is None:
        traces = [[e["concept:name"] for e in trace] for trace in log]
        flow_names = branch_names(bpmn, traces)
    # One set of data object keys for every map of the file.
    used: set = set()
    extras = _map_extras(anno, bpmn, context, used=used)
    planes = _sub_process_planes(anno, extras["task_tags"], bpmn, transactions,
                                 context=context, implicit_runs=implicit_runs, used=used)
    mining.export_bpmn(bpmn, out_path, documentation=documentation,
                       flow_names=flow_names, label_room=declared,
                       sub_planes=planes or None, **extras)
    return True
