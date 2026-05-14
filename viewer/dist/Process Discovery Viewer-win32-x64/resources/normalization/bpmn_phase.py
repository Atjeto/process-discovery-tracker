"""Phase-level BPMN: each canonical phase is a sub-process containing
its constituent steps as tasks. BPMN sub-processes render collapsible
in Adonis.
"""

from __future__ import annotations
from typing import Any
import xml.etree.ElementTree as ET

from bpmn_step import BPMN_NS, DI_NS, DC_NS, _safe_id, _parse, _fmt_ms, _serialize


def phase_bpmn_from_canonical(canonical: dict, sessions: list[dict]) -> str:
    ET.register_namespace("", BPMN_NS)
    ET.register_namespace("bpmndi", DI_NS)
    ET.register_namespace("dc", DC_NS)

    defs = ET.Element(f"{{{BPMN_NS}}}definitions", {
        "id": "Definitions_1",
        "targetNamespace": "http://process-discovery-tracker/canonical-phases",
    })
    process = ET.SubElement(defs, f"{{{BPMN_NS}}}process", {"id": "Process_1", "isExecutable": "false"})

    # Aggregate per-step stats across sessions
    step_stats: dict[str, dict] = {}
    for sess in sessions:
        for s in sess.get("steps", []) or []:
            cid = s.get("canonical_step_id")
            if not cid: continue
            entry = step_stats.setdefault(cid, {"count": 0, "total_ms": 0})
            entry["count"] += 1
            try:
                start = _parse(s["time_range"]["start"])
                end = _parse(s["time_range"]["end"])
                entry["total_ms"] += int((end - start).total_seconds() * 1000)
            except Exception:
                pass

    ET.SubElement(process, f"{{{BPMN_NS}}}startEvent", {"id": "StartEvent_1"})
    prev_id = "StartEvent_1"

    step_def_by_id = {s["step_id"]: s for s in (canonical.get("steps") or [])}

    for cphase in canonical.get("phases", []) or []:
        phase_id = f"SubProcess_{_safe_id(cphase['phase_id'])}"
        sub = ET.SubElement(process, f"{{{BPMN_NS}}}subProcess", {
            "id": phase_id,
            "name": cphase.get("name") or cphase["phase_id"],
            "triggeredByEvent": "false",
        })
        # Inside the sub-process: serialized tasks per contained step
        sub_prev = None
        sub_start = ET.SubElement(sub, f"{{{BPMN_NS}}}startEvent", {"id": phase_id + "_start"})
        sub_prev = phase_id + "_start"
        for sid in cphase.get("step_ids", []) or []:
            cdef = step_def_by_id.get(sid)
            if not cdef:
                continue
            stats = step_stats.get(sid, {"count": 0, "total_ms": 0})
            avg_ms = stats["total_ms"] // stats["count"] if stats["count"] else 0
            task_id = phase_id + "_Task_" + _safe_id(sid)
            ET.SubElement(sub, f"{{{BPMN_NS}}}task", {
                "id": task_id,
                "name": f"{cdef.get('name', sid)} (n={stats['count']}, avg={_fmt_ms(avg_ms)})",
            })
            ET.SubElement(sub, f"{{{BPMN_NS}}}sequenceFlow", {
                "id": f"Flow_{sub_prev}_{task_id}",
                "sourceRef": sub_prev, "targetRef": task_id,
            })
            sub_prev = task_id
        sub_end = phase_id + "_end"
        ET.SubElement(sub, f"{{{BPMN_NS}}}endEvent", {"id": sub_end})
        ET.SubElement(sub, f"{{{BPMN_NS}}}sequenceFlow", {
            "id": f"Flow_{sub_prev}_{sub_end}",
            "sourceRef": sub_prev, "targetRef": sub_end,
        })

        ET.SubElement(process, f"{{{BPMN_NS}}}sequenceFlow", {
            "id": f"Flow_{prev_id}_{phase_id}",
            "sourceRef": prev_id, "targetRef": phase_id,
        })
        prev_id = phase_id

    ET.SubElement(process, f"{{{BPMN_NS}}}endEvent", {"id": "EndEvent_1"})
    ET.SubElement(process, f"{{{BPMN_NS}}}sequenceFlow", {
        "id": "Flow_to_end", "sourceRef": prev_id, "targetRef": "EndEvent_1",
    })

    return _serialize(defs)
