"""Process mining + BPMN export (§8).

Wraps PM4Py's discovery algorithms. Inductive miner is the default;
heuristics miner is exposed for noisier shift-review data. DFG is
the first-pass exploration view.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any

import pm4py
from pm4py.objects.bpmn.obj import BPMN
from pm4py.objects.log.obj import EventLog


def discover_inductive(log: EventLog, noise_threshold: float = 0.2):
    """Inductive miner with noise filtering. Returns a BPMN object."""
    return pm4py.discover_bpmn_inductive(log, noise_threshold=noise_threshold)


def discover_heuristics(log: EventLog, dependency_threshold: float = 0.5):
    """Heuristics miner -- returns a heuristic net. More tolerant of
    unusual sequences than inductive."""
    return pm4py.discover_heuristics_net(log, dependency_threshold=dependency_threshold)


def discover_dfg(log: EventLog):
    """Directly-Follows Graph -- returns (dfg, start_activities, end_activities).
    Useful as a first-pass exploration before formal mining."""
    return pm4py.discover_directly_follows_graph(log)


# Map PM4Py BPMN node classes -> BPMN 2.0 XML element local-names.
_NODE_TAG = {
    "StartEvent":             "startEvent",
    "EndEvent":               "endEvent",
    "Task":                   "task",
    "UserTask":               "userTask",
    "ServiceTask":            "serviceTask",
    "SendTask":               "sendTask",
    "ReceiveTask":            "receiveTask",
    "ManualTask":             "manualTask",
    "ScriptTask":             "scriptTask",
    "BusinessRuleTask":       "businessRuleTask",
    "SubProcess":             "subProcess",
    "CallActivity":           "callActivity",
    "ExclusiveGateway":       "exclusiveGateway",
    "ParallelGateway":        "parallelGateway",
    "InclusiveGateway":       "inclusiveGateway",
    "EventBasedGateway":      "eventBasedGateway",
    "ComplexGateway":         "complexGateway",
    "IntermediateCatchEvent": "intermediateCatchEvent",
    "IntermediateThrowEvent": "intermediateThrowEvent",
    "BoundaryEvent":          "boundaryEvent",
}

_BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL"
_BPMNDI_NS = "http://www.omg.org/spec/BPMN/20100524/DI"
_DC_NS = "http://www.omg.org/spec/DD/20100524/DC"
_DI_NS = "http://www.omg.org/spec/DD/20100524/DI"
_XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"

_XML_ID_BAD = re.compile(r"[^A-Za-z0-9_\-]")

# Shape dimensions for the layout. Tasks and subprocesses get one
# rectangle; events get a square; gateways get a diamond bbox.
_NODE_W = 110
_NODE_H = 70
_EVENT_SIZE = 36
_GW_SIZE = 50
_H_GAP = 80
_V_GAP = 30


def _safe_id(prefix: str, idx: int, raw: str | None) -> str:
    """XML ids must start with a letter. Keep them short and stable."""
    base = (raw or "").strip()
    if base:
        base = _XML_ID_BAD.sub("_", base)[:32]
        return f"{prefix}_{idx}_{base}" if base else f"{prefix}_{idx}"
    return f"{prefix}_{idx}"


def _shape_size(node_cls: str) -> tuple[int, int]:
    """Pick a sensible bbox per BPMN element family."""
    if "Event" in node_cls:
        return _EVENT_SIZE, _EVENT_SIZE
    if "Gateway" in node_cls:
        return _GW_SIZE, _GW_SIZE
    return _NODE_W, _NODE_H


def _layout(node_ids: list[str],
            edges: list[tuple[str, str]],
            sizes: dict[str, tuple[int, int]]) -> dict[str, tuple[int, int, int, int]]:
    """Hierarchical left-to-right Sugiyama-style layout.

    1. Topologically rank nodes by max-depth from a root (a node with
       no incoming edge). Cycles fall back to rank 0.
    2. Group nodes by rank into columns.
    3. Within a column, distribute vertically. X is rank * (col_width).
       Column width tracks the widest node in that rank.

    Output: { node_id: (x, y, w, h) } -- top-left corner + bbox.
    Adequate for the inductive-miner output sizes (under ~50 nodes)
    and good enough for Adonis or bpmn-js to render without further
    layout work.
    """
    in_edges: dict[str, list[str]] = {nid: [] for nid in node_ids}
    out_edges: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for src, tgt in edges:
        if src in in_edges and tgt in in_edges:
            out_edges[src].append(tgt)
            in_edges[tgt].append(src)

    rank: dict[str, int] = {}
    roots = [n for n in node_ids if not in_edges[n]]
    if not roots and node_ids:
        roots = [node_ids[0]]
    for r in roots:
        rank[r] = 0
    # Iterate until stable, capped to avoid pathological cycles.
    for _ in range(len(node_ids) + 1):
        changed = False
        for nid in node_ids:
            parent_ranks = [rank[p] for p in in_edges[nid] if p in rank]
            if not parent_ranks:
                continue
            new_rank = max(parent_ranks) + 1
            if rank.get(nid, -1) < new_rank:
                rank[nid] = new_rank
                changed = True
        if not changed:
            break
    for nid in node_ids:
        rank.setdefault(nid, 0)

    by_rank: dict[int, list[str]] = {}
    for nid in node_ids:
        by_rank.setdefault(rank[nid], []).append(nid)

    positions: dict[str, tuple[int, int, int, int]] = {}
    x_cursor = 50
    for r in sorted(by_rank.keys()):
        col_nodes = by_rank[r]
        col_w = max(sizes[n][0] for n in col_nodes)
        # Center each column's nodes around y=200.
        total_h = sum(sizes[n][1] for n in col_nodes) + _V_GAP * (len(col_nodes) - 1)
        y_cursor = max(50, 200 - total_h // 2)
        for nid in col_nodes:
            w, h = sizes[nid]
            x = x_cursor + (col_w - w) // 2
            positions[nid] = (x, y_cursor, w, h)
            y_cursor += h + _V_GAP
        x_cursor += col_w + _H_GAP
    return positions


def export_bpmn(bpmn_obj, out_path: str) -> None:
    """Serialize a BPMN 2.0 file with a computed BPMNDI layout.

    PM4Py's built-in `write_bpmn` invokes Graphviz `dot` to compute
    BPMNDI coordinates, which makes BPMN export a hard binary
    dependency we can't rely on (IT-locked machines). This emits the
    semantic process plus a hierarchical Sugiyama-style layout
    computed in pure Python -- enough for bpmn-js Viewer to render
    and Adonis to display without re-layout.
    """
    ET.register_namespace("bpmn", _BPMN_NS)
    ET.register_namespace("bpmndi", _BPMNDI_NS)
    ET.register_namespace("dc", _DC_NS)
    ET.register_namespace("di", _DI_NS)
    ET.register_namespace("xsi", _XSI_NS)
    defs = ET.Element(
        f"{{{_BPMN_NS}}}definitions",
        {
            "id": "Definitions_1",
            "targetNamespace": "http://process-discovery-tracker/bpmn",
        },
    )
    proc = ET.SubElement(
        defs,
        f"{{{_BPMN_NS}}}process",
        {"id": "Process_1", "isExecutable": "false"},
    )

    nodes = list(bpmn_obj.get_nodes())
    flows = list(bpmn_obj.get_flows())

    # Stable id per node so flows can reference them.
    node_id: dict[int, str] = {}
    node_cls: dict[str, str] = {}
    for i, n in enumerate(nodes):
        name = n.get_name() if hasattr(n, "get_name") else ""
        nid = _safe_id("node", i, name)
        node_id[id(n)] = nid
        node_cls[nid] = type(n).__name__

    # First pass: resolve every flow's (id, src, tgt) so we can attach
    # <bpmn:incoming>/<bpmn:outgoing> children to each flow node. BPMN
    # 2.0 requires each flowNode to declare which sequence flows enter
    # and leave it -- bpmn-js emits a parse warning per missing pair
    # if these references are absent.
    flow_records: list[tuple[str, str, str]] = []
    incoming: dict[str, list[str]] = {nid: [] for nid in node_id.values()}
    outgoing: dict[str, list[str]] = {nid: [] for nid in node_id.values()}
    for i, f in enumerate(flows):
        src, tgt = f.get_source(), f.get_target()
        if id(src) not in node_id or id(tgt) not in node_id:
            continue
        sid, tid = node_id[id(src)], node_id[id(tgt)]
        fid = f"flow_{i}"
        flow_records.append((fid, sid, tid))
        outgoing[sid].append(fid)
        incoming[tid].append(fid)

    for n in nodes:
        cls = type(n).__name__
        tag = _NODE_TAG.get(cls, "task")
        nid = node_id[id(n)]
        attrs = {"id": nid}
        name = n.get_name() if hasattr(n, "get_name") else ""
        if name:
            attrs["name"] = name
        node_el = ET.SubElement(proc, f"{{{_BPMN_NS}}}{tag}", attrs)
        # BPMN spec order: <incoming> before <outgoing>.
        for fid in incoming[nid]:
            inc = ET.SubElement(node_el, f"{{{_BPMN_NS}}}incoming")
            inc.text = fid
        for fid in outgoing[nid]:
            out = ET.SubElement(node_el, f"{{{_BPMN_NS}}}outgoing")
            out.text = fid

    for fid, sid, tid in flow_records:
        ET.SubElement(
            proc,
            f"{{{_BPMN_NS}}}sequenceFlow",
            {"id": fid, "sourceRef": sid, "targetRef": tid},
        )

    # ---- BPMNDI layout ----
    sizes = {nid: _shape_size(node_cls[nid]) for nid in node_id.values()}
    layout = _layout(
        node_ids=list(node_id.values()),
        edges=[(s, t) for (_, s, t) in flow_records],
        sizes=sizes,
    )

    diagram = ET.SubElement(
        defs, f"{{{_BPMNDI_NS}}}BPMNDiagram", {"id": "BPMNDiagram_1"})
    plane = ET.SubElement(
        diagram, f"{{{_BPMNDI_NS}}}BPMNPlane",
        {"id": "BPMNPlane_1", "bpmnElement": "Process_1"})

    for nid in node_id.values():
        x, y, w, h = layout[nid]
        shape = ET.SubElement(
            plane, f"{{{_BPMNDI_NS}}}BPMNShape",
            {"id": f"Shape_{nid}", "bpmnElement": nid})
        ET.SubElement(shape, f"{{{_DC_NS}}}Bounds",
                      {"x": str(x), "y": str(y), "width": str(w), "height": str(h)})

    for fid, sid, tid in flow_records:
        sx, sy, sw, sh = layout[sid]
        tx, ty, tw, th = layout[tid]
        # Edge from right-middle of source to left-middle of target.
        edge = ET.SubElement(
            plane, f"{{{_BPMNDI_NS}}}BPMNEdge",
            {"id": f"Edge_{fid}", "bpmnElement": fid})
        ET.SubElement(edge, f"{{{_DI_NS}}}waypoint",
                      {"x": str(sx + sw), "y": str(sy + sh // 2)})
        ET.SubElement(edge, f"{{{_DI_NS}}}waypoint",
                      {"x": str(tx),      "y": str(ty + th // 2)})

    tree = ET.ElementTree(defs)
    if hasattr(ET, "indent"):
        ET.indent(tree, space="  ")
    tree.write(out_path, xml_declaration=True, encoding="utf-8")


def dfg_to_dict(dfg, starts, ends) -> dict[str, Any]:
    """Convert a PM4Py DFG to a JSON-serializable dict for the viewer."""
    edges = [
        {"source": s, "target": t, "frequency": int(c)}
        for (s, t), c in dfg.items()
    ]
    return {
        "edges": edges,
        "start_activities": {k: int(v) for k, v in starts.items()},
        "end_activities": {k: int(v) for k, v in ends.items()},
    }
