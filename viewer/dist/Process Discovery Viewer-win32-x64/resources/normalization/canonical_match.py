"""Match captured interactions against a canonical step set. Produces
auto_matched steps per annotation-model.md §3.5.
"""

from __future__ import annotations
import re
import uuid
from typing import Any
import yaml


def load_canonical(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f).get("canonical_process", {})


def _interaction_matches(rule: dict, ev: dict) -> bool:
    """Check whether one match rule fires on a single interaction event."""
    data = ev.get("data", {})
    pn = rule.get("process_name")
    if pn and data.get("process_name") != pn:
        return False
    wtr = rule.get("window_title_regex")
    if wtr and not re.search(wtr, data.get("window_title") or ""):
        return False
    irule = rule.get("interaction")
    if irule:
        for k in ("control_type", "automation_id", "name"):
            if k in irule and data.get(k) != irule[k]:
                return False
    return True


def match_canonical(
    events: list[dict[str, Any]],
    canonical: dict[str, Any],
    *,
    session_id: str = "",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Walk interaction events in time order. Assign each to the first
    canonical step whose match rules fire. Group contiguous interactions
    sharing the same canonical_step_id into one step. Honors `end_when`
    when present to close a step explicitly.

    Returns (steps, unmatched_interactions).
    """
    cstep_defs = {s["step_id"]: s for s in canonical.get("steps", [])}
    order = [s["step_id"] for s in canonical.get("steps", [])]

    interactions = [
        e for e in events
        if e.get("type") == "interaction"
    ]
    interactions.sort(key=lambda e: e["timestamp"])

    steps: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    open_step = None  # { step_id, canonical_step_id, events, end_when_rule }

    def close_open():
        nonlocal open_step
        if not open_step or not open_step["events"]:
            open_step = None
            return
        evs = open_step["events"]
        cdef = cstep_defs[open_step["canonical_step_id"]]
        cids = evs[0]["data"].get("case_ids") or []
        steps.append({
            "step_id": str(uuid.uuid4()),
            "session_id": session_id,
            "case_id": (cids[-1] if cids else None),
            "name": cdef.get("name") or open_step["canonical_step_id"],
            "description": cdef.get("description", ""),
            "time_range": {
                "start": evs[0]["timestamp"],
                "end": evs[-1]["timestamp"],
            },
            "evidence": {
                "interaction_event_ids": [e["event_id"] for e in evs],
                "screenshot_refs": [],
                "video_timecode_range": None,
                "manual_notes": "",
            },
            "state": "auto_matched",
            "canonical_step_id": open_step["canonical_step_id"],
            "flags": {
                "conditional": False, "condition_text": None,
                "exception_path": False, "waste": False,
                "automation_candidate": False,
            },
            "phase_id": None,
        })
        open_step = None

    for ev in interactions:
        # Did the open step's end_when fire?
        if open_step and open_step.get("end_when_rule") and _interaction_matches(
            open_step["end_when_rule"], ev
        ):
            open_step["events"].append(ev)
            close_open()
            continue

        # Find canonical step
        matched_step_id = None
        end_when = None
        for sid in order:
            for rule in cstep_defs[sid].get("match", []):
                if _interaction_matches(rule, ev):
                    matched_step_id = sid
                    end_when = rule.get("end_when")
                    break
            if matched_step_id:
                break

        if matched_step_id is None:
            unmatched.append(ev)
            continue

        if open_step and open_step["canonical_step_id"] == matched_step_id:
            open_step["events"].append(ev)
        else:
            close_open()
            open_step = {
                "step_id": str(uuid.uuid4()),
                "canonical_step_id": matched_step_id,
                "events": [ev],
                "end_when_rule": end_when,
            }
    close_open()

    return steps, unmatched


def rollup_phases(
    canonical: dict,
    steps: list[dict],
    session_id: str = "",
) -> list[dict]:
    """For each canonical phase definition, build a phase containing the
    matched steps whose canonical_step_id is in the phase's step_ids list.
    """
    cphases = canonical.get("phases", []) or []
    phases = []
    for cp in cphases:
        target_step_ids = set(cp.get("step_ids", []))
        contained = [
            s for s in steps
            if s.get("canonical_step_id") in target_step_ids
        ]
        if not contained:
            continue
        phases.append({
            "phase_id": str(uuid.uuid4()),
            "session_id": session_id,
            "case_id": contained[0].get("case_id"),
            "name": cp.get("name") or cp.get("phase_id"),
            "description": cp.get("description", ""),
            "step_ids": [s["step_id"] for s in contained],
            "state": "auto_matched",
            "canonical_phase_id": cp.get("phase_id"),
        })
    return phases
