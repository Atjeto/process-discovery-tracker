"""Construct a step-level BPMN from a canonical step set + matched
session data. Each canonical step becomes a task; ordering from
canonical step_ids list; frequencies and average durations annotate
the tasks.
"""

from __future__ import annotations
import logging
from typing import Any
import xml.etree.ElementTree as ET

logger = logging.getLogger(__name__)


BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL"
DI_NS = "http://www.omg.org/spec/BPMN/20100524/DI"
DC_NS = "http://www.omg.org/spec/DD/20100524/DC"


def step_bpmn_from_canonical(canonical: dict, sessions: list[dict]) -> str:
    """Returns BPMN 2.0 XML string. sessions is a list of {steps:[...]}."""
    ET.register_namespace("", BPMN_NS)
    ET.register_namespace("bpmndi", DI_NS)
    ET.register_namespace("dc", DC_NS)

    defs = ET.Element(f"{{{BPMN_NS}}}definitions", {
        "id": "Definitions_1",
        "targetNamespace": "http://process-discovery-tracker/canonical",
    })
    process = ET.SubElement(defs, f"{{{BPMN_NS}}}process", {"id": "Process_1", "isExecutable": "false"})

    # Aggregate per-step stats across sessions
    step_stats: dict[str, dict] = {}
    for sess in sessions:
        for s in sess.get("steps", []) or []:
            cid = s.get("canonical_step_id")
            if not cid:
                continue
            entry = step_stats.setdefault(cid, {"count": 0, "total_ms": 0})
            entry["count"] += 1
            try:
                start = _parse(s["time_range"]["start"])
                end = _parse(s["time_range"]["end"])
                entry["total_ms"] += int((end - start).total_seconds() * 1000)
            except (KeyError, ValueError, TypeError, AttributeError) as exc:
                logger.warning(
                    "step_bpmn: skipping duration for step %s — bad time_range: %s",
                    cid, exc,
                )

    ET.SubElement(process, f"{{{BPMN_NS}}}startEvent", {"id": "StartEvent_1"})
    prev_id = "StartEvent_1"
    for cstep in canonical.get("steps", []) or []:
        sid = cstep["step_id"]
        stats = step_stats.get(sid, {"count": 0, "total_ms": 0})
        avg_ms = stats["total_ms"] // stats["count"] if stats["count"] else 0
        task_id = f"Task_{_safe_id(sid)}"
        ET.SubElement(process, f"{{{BPMN_NS}}}task", {
            "id": task_id,
            "name": f"{cstep.get('name', sid)} (n={stats['count']}, avg={_fmt_ms(avg_ms)})",
        })
        ET.SubElement(process, f"{{{BPMN_NS}}}sequenceFlow", {
            "id": f"Flow_{prev_id}_{task_id}",
            "sourceRef": prev_id, "targetRef": task_id,
        })
        prev_id = task_id
    ET.SubElement(process, f"{{{BPMN_NS}}}endEvent", {"id": "EndEvent_1"})
    ET.SubElement(process, f"{{{BPMN_NS}}}sequenceFlow", {
        "id": "Flow_to_end", "sourceRef": prev_id, "targetRef": "EndEvent_1",
    })

    return _serialize(defs)


def _safe_id(s: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in str(s))


def _parse(ts):
    from datetime import datetime
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _fmt_ms(ms):
    if ms < 1000: return f"{ms}ms"
    s = ms // 1000
    if s < 60: return f"{s}s"
    return f"{s // 60}m{s % 60}s"


def _serialize(el: ET.Element) -> str:
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(el, encoding="unicode")
