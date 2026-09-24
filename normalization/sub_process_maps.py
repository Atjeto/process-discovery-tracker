"""Sub-processes (contract C19): the maps a project holds and what each one
is drawn from.

One project holds one main map plus one map per sub-process, at any depth. A
step is a sub-process when it carries `sub_steps` (a list, possibly empty):
its sub-steps, each the same shape as a step, recursively.
`annotations.steps` stays the main level, so a reader that does not look for
`sub_steps` sees the main level only.

map_tree lists the maps. One rule for the pipeline (the step BPMN's planes,
bpmn_observed; the PDD's chapters, pdd_export) and the viewer
(viewer/sub-process-maps.js mapTree), pinned for both by
shared/sub-process-maps-golden.json:

- The main map (path []) is drawn from one trace per transaction: its
  visible steps in the map's order (step_context.step_sort_key: time, then
  `order`, then the list's order).
- A level below is reached through visits: consecutive visible steps with
  one map node (step_flow.node_of) are one visit, and a visit of a
  sub-process node gives one trace, the visible sub_steps of its steps in
  order. A visit whose steps carry no sub_steps gives none, and an empty
  trace is left out (at the main level too), so a sub-process with no
  visible sub-steps has a map with no traces.
- The map of a sub-process node at path P is drawn from the traces of every
  visit of that node at level P, in transaction order; its path is P plus
  the node. Its edges follow contract C17 on those traces
  (step_flow.flow_edges), so an end inside a sub-process ends the
  sub-process only.
- A hidden step is left out with everything under it.
- number: the position of the node's first step among the visible steps of
  the reference transaction's first trace at that level (steps are counted,
  not visits), after the parent's number and a dot ("2", "2.4"); None when
  the node is not in that trace or the parent has no number. A map without
  a number gets no PDD chapter.
- The maps are listed depth first; at each level the sub-process nodes come
  in the order they first appear, the reference transaction's traces first,
  then the others in transaction order.

The map node is the main rule at every level: a drafted sub-step (it
carries `action_key`) is its name, as a drafted step (`draft_key`) is.

Pure: no pm4py, so the golden runs on any Python.
"""

from __future__ import annotations

from typing import Any

from step_context import step_sort_key
from step_flow import node_of


def is_sub_process(step: Any) -> bool:
    """True when the step is a sub-process: it carries `sub_steps`, a list
    (an empty one too)."""
    return isinstance(step, dict) and isinstance(step.get("sub_steps"), list)


def visible(steps: Any) -> list[dict]:
    """The visible steps of a step list in the map's order: a hidden step is
    left out (with everything under it), the others sorted by time, then
    `order`, then the list's order."""
    out = ([s for s in steps if isinstance(s, dict) and s.get("state") != "hidden"]
           if isinstance(steps, list) else [])
    out.sort(key=step_sort_key)
    return out


def visits(steps: list[dict]) -> list[tuple[str, list[dict]]]:
    """A trace's visits: (node, steps) for each stretch of consecutive steps
    with one map node. `steps` are visible and in order."""
    out: list[tuple[str, list[dict]]] = []
    for step in steps:
        node = node_of(step)
        if out and out[-1][0] == node:
            out[-1][1].append(step)
        else:
            out.append((node, [step]))
    return out


def _trace_of(visit: list[dict]) -> list[dict] | None:
    """The trace one visit gives: the visible sub_steps of its steps, each
    step's in order, the steps in order; None when none of its steps
    carries sub_steps."""
    if not any(is_sub_process(s) for s in visit):
        return None
    out: list[dict] = []
    for step in visit:
        out.extend(visible(step.get("sub_steps")))
    return out


def map_tree(transactions: Any, reference: int = 0) -> list[dict]:
    """The maps of a project (the rule in the module docstring), depth first,
    the main map first. `transactions` is a list of step lists in
    transaction order (bpmn_observed._transactions gives them); `reference`
    is the index of the reference transaction.

    Each map is {"path": [node, ...], "number": str or None, "traces":
    [[step, ...], ...], "transactions": [index, ...]}: the traces it is
    drawn from (step dicts, never empty) and, one per trace, the index of
    the transaction the trace comes from (the step BPMN and the PDD count
    the transactions that ran a sub-process with them)."""
    traces = []
    for t, steps in enumerate(transactions if isinstance(transactions, list) else []):
        trace = visible(steps)
        if trace:
            traces.append((t, trace))
    maps: list[dict] = []
    _walk([], None, traces, reference, maps)
    return maps


def _walk(path: list[str], number: str | None, traces: list[tuple[int, list[dict]]],
          reference: int, maps: list[dict]) -> None:
    """Add the map at `path` (drawn from `traces`, (transaction, steps)
    pairs) to `maps`, then the maps of its sub-process nodes, depth first."""
    maps.append({"path": list(path), "number": number,
                 "traces": [trace for _t, trace in traces],
                 "transactions": [t for t, _trace in traces]})
    by_trace = [(t, visits(trace)) for t, trace in traces]
    subs = {node for _t, vs in by_trace for node, steps in vs
            if any(is_sub_process(s) for s in steps)}
    if not subs:
        return
    order: list[str] = []
    # The reference transaction's traces first (a stable sort keeps the
    # rest in transaction order).
    for _t, vs in sorted(by_trace, key=lambda tv: tv[0] != reference):
        for node, _steps in vs:
            if node in subs and node not in order:
                order.append(node)
    first = next((trace for t, trace in traces if t == reference), None)
    numbered = not path or number is not None
    for node in order:
        child = []
        for t, vs in by_trace:
            for n, steps in vs:
                if n == node:
                    trace = _trace_of(steps)
                    if trace:
                        child.append((t, trace))
        child_number = None
        if numbered and first is not None:
            position = next((i for i, s in enumerate(first, start=1) if node_of(s) == node), None)
            if position is not None:
                child_number = f"{number}.{position}" if path else str(position)
        _walk(path + [node], child_number, child, reference, maps)
