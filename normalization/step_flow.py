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
the map's order (step_context.step_sort_key: time, then `order`, then
neither), and consecutive steps with one node are one visit, as on the map,
so "the previous step" and "the step after" are the neighbouring visits. A
path around a step that sits between two visits of one node would join those
into one visit, so it is not drawn. A hidden step is not on the map: it
declares nothing, and a link to it, to its own step or to a step no
transaction holds draws nothing. A condition or a `when` is one line
(whitespace collapsed); an empty `when` is an edge without a label.

Pure: no pm4py, so the golden runs on any Python.
"""

from __future__ import annotations

from typing import Any

from step_context import step_sort_key

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


def _visits(steps: Any) -> list[tuple[str, list[dict]]]:
    """A transaction's visible steps in the map's order, as visits: (node,
    steps) for each stretch of consecutive steps with one node."""
    visible = [s for s in steps or [] if isinstance(s, dict) and s.get("state") != "hidden"]
    visible.sort(key=step_sort_key)
    visits: list[tuple[str, list[dict]]] = []
    for step in visible:
        node = node_of(step)
        if visits and visits[-1][0] == node:
            visits[-1][1].append(step)
        else:
            visits.append((node, [step]))
    return visits


def flow_edges(transactions: Any) -> list[dict]:
    """The step map's edges (the rule in the module docstring) of
    `transactions`, a list of step lists in transaction order.

    Each edge is {"from", "to", "label", "labels", "observed",
    "transactions"}: the ends are nodes, START or END; label is the declared
    text (labels on one edge joined with " or ") or None; labels is the same
    texts one by one, in that order ([] when none: the step BPMN gives each
    link to the end its own end event, contract C18); observed is True when
    at least one transaction took the edge; transactions is how many did.
    The observed edges come first, in transaction order, then the declared
    ones in step order."""
    runs = [v for v in (_visits(steps) for steps in transactions or []) if v]
    node_by_id: dict[str, str] = {}
    conditions: dict[str, list[str]] = {}
    for visits in runs:
        for node, steps in visits:
            for step in steps:
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

    paths = [[START] + [node for node, _steps in visits] + [END] for visits in runs]
    for t, path in enumerate(paths):
        for a, b in zip(path, path[1:]):
            add(a, b, taken_in=t)
    for visits, path in zip(runs, paths):
        for i, (node, steps) in enumerate(visits, start=1):
            prev, after = path[i - 1], path[i + 1]
            for cond in conditions.get(node, []):
                add(prev, node, cond)
                if after != prev:
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


def changes_map(edges: list[dict]) -> bool:
    """True when the declarations change the map: an edge carries a label or
    no transaction took it. Without such an edge the map is the observed one
    alone."""
    return any(e["label"] is not None or not e["observed"] for e in edges)
