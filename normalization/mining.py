"""Process mining + BPMN export (§8).

Wraps PM4Py's discovery algorithms. Inductive miner is the default;
heuristics miner is exposed for noisier shift-review data. DFG is
the first-pass exploration view.
"""

from __future__ import annotations

from typing import Any

import pm4py
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


def export_bpmn(bpmn_obj, out_path: str) -> None:
    """Serialize a BPMN object to BPMN 2.0 XML."""
    pm4py.write_bpmn(bpmn_obj, out_path)


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
