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
_XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"

_XML_ID_BAD = re.compile(r"[^A-Za-z0-9_\-]")


def _safe_id(prefix: str, idx: int, raw: str | None) -> str:
    """XML ids must start with a letter. Keep them short and stable."""
    base = (raw or "").strip()
    if base:
        base = _XML_ID_BAD.sub("_", base)[:32]
        return f"{prefix}_{idx}_{base}" if base else f"{prefix}_{idx}"
    return f"{prefix}_{idx}"


def export_bpmn(bpmn_obj, out_path: str) -> None:
    """Serialize a BPMN object to BPMN 2.0 XML without layout info.

    PM4Py's built-in `write_bpmn` invokes Graphviz `dot` to compute
    BPMNDI coordinates. That makes BPMN export a hard binary
    dependency, which is a no-go on locked-down machines. We emit a
    layout-free BPMN 2.0 file instead -- bpmn-js and Adonis both
    auto-layout on import, so the visual result is identical for the
    downstream consumers we care about.
    """
    ET.register_namespace("bpmn", _BPMN_NS)
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
    node_id = {}
    for i, n in enumerate(nodes):
        name = n.get_name() if hasattr(n, "get_name") else ""
        node_id[id(n)] = _safe_id("node", i, name)

    for n in nodes:
        cls = type(n).__name__
        tag = _NODE_TAG.get(cls, "task")
        attrs = {"id": node_id[id(n)]}
        name = n.get_name() if hasattr(n, "get_name") else ""
        if name:
            attrs["name"] = name
        ET.SubElement(proc, f"{{{_BPMN_NS}}}{tag}", attrs)

    for i, f in enumerate(flows):
        src, tgt = f.get_source(), f.get_target()
        if id(src) not in node_id or id(tgt) not in node_id:
            continue
        ET.SubElement(
            proc,
            f"{{{_BPMN_NS}}}sequenceFlow",
            {
                "id": f"flow_{i}",
                "sourceRef": node_id[id(src)],
                "targetRef": node_id[id(tgt)],
            },
        )

    tree = ET.ElementTree(defs)
    # ElementTree 3.9+ supports indent for readable output.
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
