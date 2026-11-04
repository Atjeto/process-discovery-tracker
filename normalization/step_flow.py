"""Step flow (contract C17): the edges of the step map, from each
transaction's step order plus the flow the analyst sets on steps.

The analyst sets the process flow while adding or reviewing steps, not
afterwards in a map editor. The default after a step is always the next step
of its transaction; on top of that a step may carry

- `only_when` (a string): the step happens only under this condition;
- `links` (a list of {"to": <step_id> or "end", "when": <string>}): after the
  step, when the condition holds, the process goes to that step (an earlier
  one: a loop back; a later one: a skip ahead) or ends.

flow_edges turns the transactions' steps and those keys into the edges of the
step map. One rule draws the viewer's live map (viewer/process-map-levels.js)
and the pipeline's step BPMN (bpmn_observed); shared/flow-links-golden.json
pins it for both:

1. Observed edges: consecutive steps of each transaction, the start to its
   first step and its last step to the end.
2. A step with `only_when`: in every transaction where its node appears, the
   edge entering it from the previous step (the start when it is first)
   carries the condition, and an edge from that previous step to the step
   after it (the end when it is last) is added, labelled "otherwise".
3. A link adds an edge from its step to the target step (the end for "end"),
   labelled with its `when`.
4. Edges are keyed by (from node, to node): a declared edge that coincides
   with an observed one is that edge, still observed, carrying the label;
   the same declaration from several transactions is one edge; different
   labels on one edge are joined with " or " in step order.

A node is the map's node of a step (node_of). A transaction's steps are in
the map's order (step_context.process_order: time, then `order`, then
neither, and contract C22: a step the analyst placed after another right
after it), and consecutive steps with one node are one visit, as on the map,
so "the previous step" and "the step after" are the neighbouring visits. A
path around a step that sits between two visits of one node would join those
into one visit, so it is not drawn. A hidden step is not on the map: it
declares nothing, and a link to it, to its own step or to a step no
transaction holds draws nothing. A condition or a `when` is one line
(whitespace collapsed); an empty `when` is an edge without a label.

A stretch of a transaction left out of the analysis (annotations
`excluded_ranges`, cut to the transaction's span: left_out_stretches) cuts
its trace (lane FX1): the steps done in it were not drafted, so the step
before it and the step after it were not done one after the other. It falls
between the steps as the differences place it (a step is before it when it
starts before the stretch starts, a placed step when the step its place
hangs from does; a step without a time is after it: cut_positions,
step_context.place_starts), and no edge crosses it: not from the step before to the step
after, not from the start into the first step after a stretch that opens the
transaction, not from the last step before a stretch that closes it into the
end. The rules above hold inside each part; a step next to a cut has no
previous step (or no step after it) on that side.

Pure: no pm4py, so the golden runs on any Python.
"""

from __future__ import annotations

from typing import Any

from _dt import parse_ts_or_none as _parse_ts
from step_context import place_starts, process_order

# The map's start and end, as edge ends. A step name never holds this control
# character (the viewer's map keys its edges with the same one).
START = "\u0001start"
END = "\u0001end"
OTHERWISE = "otherwise"


def _line(value: Any) -> str:
    """An analyst's text as one line: whitespace collapsed ("" for a
    non-string)."""
    return " ".join(value.split()) if isinstance(value, str) else ""


def node_of(step: dict) -> str:
    """The map node a step is drawn as: a drafted step is its own name,
    whatever its state (it carries a draft_key, or a drafted sub-step's
    action_key, contract C19: the viewer's mapNodeLabel draws it so, and
    step_suggest stamps that name as its process_label); any other step its
    value-free process_label, else its name (the step map's rule since
    ADR-0013)."""
    name = step.get("name")
    if ((step.get("draft_key") or step.get("action_key"))
            and isinstance(name, str) and name.strip()):
        return name.strip()
    return step.get("process_label") or step.get("name") or "(unnamed)"


def condition_of(step: Any) -> str:
    """The step's `only_when` as one line; "" when it has none."""
    return _line(step.get("only_when")) if isinstance(step, dict) else ""


def links_of(step: Any) -> list[tuple[str, str]]:
    """The step's links as (to, when): `to` a step id or "end", `when` one
    line ("" when it has none). An entry without a target is left out."""
    links = step.get("links") if isinstance(step, dict) else None
    out = []
    for link in links if isinstance(links, list) else []:
        to = link.get("to") if isinstance(link, dict) else None
        if isinstance(to, str) and to.strip():
            out.append((to.strip(), _line(link.get("when"))))
    return out


def declares_flow(step: Any) -> bool:
    """True when the analyst set the step's flow: a condition, or a links
    list with an entry. Re-normalization keeps such a draft as `edited`
    (step_suggest._merge_steps), so the flow is never drafted away."""
    if not isinstance(step, dict):
        return False
    links = step.get("links")
    return bool(condition_of(step)) or (isinstance(links, list) and len(links) > 0)


def left_out_stretches(ranges: Any, start: Any, end: Any) -> list[tuple]:
    """The stretches of one transaction left out of the analysis: each
    excluded range (annotations.excluded_ranges, {"start", "end"} ISO) cut to
    the transaction's span (`start`, `end` datetimes; `end` None for a
    transaction left open), in time order, overlapping ones joined; a range
    outside the span, or one that cannot be read, is dropped, and without a
    `start` nothing is placed. [(start, end)]. The rule of
    viewer/run-differences.js leftOutStretches, pinned with it by
    shared/run-differences-golden.json."""
    if start is None:
        return []
    cut = []
    for r in ranges if isinstance(ranges, list) else []:
        if not isinstance(r, dict):
            continue
        a, b = _parse_ts(r.get("start")), _parse_ts(r.get("end"))
        if a is None or b is None or b < a:
            continue
        s, e = max(a, start), (min(b, end) if end is not None else b)
        if e > s:
            cut.append((s, e))
    out: list[list] = []
    for s, e in sorted(cut):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(s, e) for s, e in out]


def cut_positions(starts: list, stretches: Any) -> list[int]:
    """Where the stretches left out fall among a transaction's steps, given
    the steps' start times in the map's order (None for a step without a
    time): for each stretch, how many steps start before it starts (a step
    without a time is after every stretch), sorted, each position once. The
    placement rule of the differences (pdd_export._inside_stretches,
    viewer/run-differences.js)."""
    positions = set()
    for s, _e in stretches or []:
        positions.add(sum(1 for t in starts if t is not None and t < s))
    return sorted(positions)


def _visit_list(steps: list[dict]) -> list[tuple[str, list[dict]]]:
    """Steps (in the map's order) as visits: (node, steps) for each stretch
    of consecutive steps with one node."""
    visits: list[tuple[str, list[dict]]] = []
    for step in steps:
        node = node_of(step)
        if visits and visits[-1][0] == node:
            visits[-1][1].append(step)
        else:
            visits.append((node, [step]))
    return visits


def _visible(steps: Any) -> list[dict]:
    """A transaction's visible steps in the map's order (its process order,
    contract C22)."""
    return process_order([s for s in steps or [] if isinstance(s, dict) and s.get("state") != "hidden"])


def _visits(steps: Any) -> list[tuple[str, list[dict]]]:
    """A transaction's visible steps in the map's order, as visits: (node,
    steps) for each stretch of consecutive steps with one node."""
    return _visit_list(_visible(steps))


def _paths(steps: Any, stretches: Any) -> list[list[tuple[str, Any]]]:
    """A transaction's trace as the map draws it: its visible steps in the
    map's order, cut where a stretch was left out (cut_positions), each part
    a list of (node, steps) visits; the first part opens with (START, None)
    unless a stretch comes before every step, and the last part closes with
    (END, None) unless a stretch comes after every step. [] for a
    transaction with no visible step."""
    visible = _visible(steps)
    if not visible:
        return []
    n = len(visible)
    at = place_starts(visible)
    cuts = cut_positions([at.get(id(s)) for s in visible], stretches)
    bounds = [0] + [c for c in cuts if 0 < c < n] + [n]
    parts = [_visit_list(visible[a:b]) for a, b in zip(bounds, bounds[1:])]
    out: list[list[tuple[str, Any]]] = []
    for k, visits in enumerate(parts):
        path: list[tuple[str, Any]] = []
        if k == 0 and 0 not in cuts:
            path.append((START, None))
        path.extend(visits)
        if k == len(parts) - 1 and n not in cuts:
            path.append((END, None))
        out.append(path)
    return out


def flow_edges(transactions: Any, left_out: Any = None) -> list[dict]:
    """The step map's edges (the rule in the module docstring) of
    `transactions`, a list of step lists in transaction order. `left_out`,
    when given, is each transaction's stretches left out of the analysis
    (left_out_stretches), in the same order: they cut its trace.

    Each edge is {"from", "to", "label", "labels", "observed",
    "transactions"}: the ends are nodes, START or END; label is the declared
    text (labels on one edge joined with " or ") or None; labels is the same
    texts one by one, in that order ([] when none: the step BPMN gives each
    link to the end its own end event, contract C18); observed is True when
    at least one transaction took the edge; transactions is how many did.
    The observed edges come first, in transaction order, then the declared
    ones in step order."""
    cuts = list(left_out) if isinstance(left_out, (list, tuple)) else []
    runs = []
    for t, steps in enumerate(transactions or []):
        paths = _paths(steps, cuts[t] if t < len(cuts) else None)
        if paths:
            runs.append((t, paths))
    node_by_id: dict[str, str] = {}
    conditions: dict[str, list[str]] = {}
    for _t, paths in runs:
        for path in paths:
            for node, steps in path:
                for step in steps or []:
                    sid = step.get("step_id")
                    if isinstance(sid, str) and sid:
                        node_by_id.setdefault(sid, node)
                    cond = condition_of(step)
                    if cond and cond not in conditions.setdefault(node, []):
                        conditions[node].append(cond)

    edges: dict[tuple[str, str], dict] = {}

    def add(a: str, b: str, label: str | None = None, taken_in: int | None = None) -> None:
        edge = edges.setdefault((a, b), {"from": a, "to": b, "labels": [], "taken": set()})
        if taken_in is not None:
            edge["taken"].add(taken_in)
        if label and label not in edge["labels"]:
            edge["labels"].append(label)

    for t, paths in runs:
        for path in paths:
            nodes = [node for node, _steps in path]
            for a, b in zip(nodes, nodes[1:]):
                add(a, b, taken_in=t)
    for _t, paths in runs:
        for path in paths:
            for i, (node, steps) in enumerate(path):
                if steps is None:
                    continue
                prev = path[i - 1][0] if i > 0 else None
                after = path[i + 1][0] if i + 1 < len(path) else None
                if prev is not None:
                    for cond in conditions.get(node, []):
                        add(prev, node, cond)
                        if after is not None and after != prev:
                            add(prev, after, OTHERWISE)
                for step in steps:
                    own = step.get("step_id")
                    for to, when in links_of(step):
                        target = END if to == "end" else (None if to == own else node_by_id.get(to))
                        if target is not None:
                            add(node, target, when or None)
    return [{"from": e["from"], "to": e["to"],
             "label": " or ".join(e["labels"]) or None, "labels": list(e["labels"]),
             "observed": bool(e["taken"]), "transactions": len(e["taken"])}
            for e in edges.values()]


def cuts_change_map(transactions: Any, left_out: Any) -> bool:
    """True when the stretches left out change the map: the edges with the
    traces cut there differ from the edges of the whole traces. The traces
    then cannot be mined or chained whole (that would draw a path no
    transaction took), so the step map is drawn from the cut edges."""
    if not any(left_out or []):
        return False

    def shape(edges):
        return {(e["from"], e["to"]): (e["observed"], e["label"]) for e in edges}
    return shape(flow_edges(transactions, left_out)) != shape(flow_edges(transactions))


def changes_map(edges: list[dict]) -> bool:
    """True when the declarations change the map: an edge carries a label or
    no transaction took it. Without such an edge the map is the observed one
    alone."""
    return any(e["label"] is not None or not e["observed"] for e in edges)
