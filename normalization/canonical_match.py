"""Match captured interactions against a canonical step set. Produces
auto_matched steps per annotation-model.md §3.5.
"""

from __future__ import annotations
import re
import sys
import uuid
from datetime import datetime, timezone
from typing import Any
import yaml


def load_canonical(path: str) -> dict[str, Any]:
    """Load the ``canonical_process`` block from a Process Template YAML.

    Degrades to ``{}`` (with a warning) when the file is missing, unreadable, or
    malformed instead of raising. A stale or missing template reference -- e.g. a
    session matched on another machine, then moved -- must not crash the whole
    normalization run; it just means "analyze without a template".
    """
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except (OSError, yaml.YAMLError) as e:
        print(f"[normalize] WARNING: could not read Process Template {path!r}: {e}",
              file=sys.stderr)
        return {}
    if not isinstance(data, dict):
        return {}
    cp = data.get("canonical_process", {})
    return cp if isinstance(cp, dict) else {}


INTERACTION_FIELDS = (
    "control_type", "automation_id", "name",
    "value", "class_name", "framework_id",
)


def _op_match(spec: dict, actual) -> bool:
    if actual is None:
        return False
    actual = str(actual)
    if "equals"      in spec: return actual == spec["equals"]
    if "contains"    in spec: return spec["contains"] in actual
    if "starts_with" in spec: return actual.startswith(spec["starts_with"])
    if "matches"     in spec: return re.search(spec["matches"], actual) is not None
    return False


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
        for k in INTERACTION_FIELDS:
            if k not in irule:
                continue
            expected, actual = irule[k], data.get(k)
            if isinstance(expected, dict):
                if not _op_match(expected, actual):
                    return False
            elif actual != expected:
                return False
    return True


from _dt import parse_ts as _parse_ts  # public re-export


def _event_case(ev: dict) -> str | None:
    cids = ev.get("data", {}).get("case_ids") or []
    return cids[-1] if cids else None


def match_canonical(
    events: list[dict[str, Any]],
    canonical: dict[str, Any],
    *,
    session_id: str = "",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Walk interaction events in time order.  Assign each to the first
    canonical step whose match rules fire.  Group interactions into steps
    using the step's ``boundary`` mode (default ``group_contiguous``).

    Returns (steps, unmatched_interactions).
    """
    from step_suggest import _short_app

    cstep_defs = {s["step_id"]: s for s in canonical.get("steps", [])}
    order = [s["step_id"] for s in canonical.get("steps", [])]

    interactions = [
        e for e in events
        if e.get("type") == "interaction"
    ]
    interactions.sort(key=lambda e: e["timestamp"])

    steps: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    open_step: dict[str, Any] | None = None

    def close_open():
        nonlocal open_step
        if not open_step or not open_step["events"]:
            open_step = None
            return
        evs = open_step["events"]
        cdef = cstep_defs[open_step["canonical_step_id"]]
        cids = evs[0]["data"].get("case_ids") or []
        step_dict: dict[str, Any] = {
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
            "flags": {"waste": False},   # ADR-0027: waste is the only per-step flag
            "phase_id": None,
        }
        if open_step["boundary"] == "until_next_step":
            apps = set()
            for e in evs:
                apps.add(_short_app(e.get("data", {})))
            step_dict["scope"] = {
                "apps": sorted(apps),
                "interaction_count": len(evs),
            }
        steps.append(step_dict)
        open_step = None

    def _should_close(ev: dict) -> bool:
        """Evaluate whether the open step should close BEFORE absorbing ev."""
        if open_step is None:
            return False

        boundary = open_step["boundary"]
        data = ev.get("data", {})

        # Universal: case_id change always closes
        if _event_case(ev) != open_step.get("open_case"):
            return True

        # end_when fires
        ew = open_step.get("end_when_rule")
        if ew and _interaction_matches(ew, ev):
            open_step["events"].append(ev)
            close_open()
            return False  # already closed and consumed

        if boundary == "single":
            return True

        if boundary == "until_app_change":
            if _short_app(data) != open_step.get("open_app"):
                return True

        if boundary == "until_pause":
            pause_ms = open_step.get("pause_ms", 5000)
            gap = (_parse_ts(ev["timestamp"])
                   - _parse_ts(open_step["events"][-1]["timestamp"])
                   ).total_seconds() * 1000
            if gap > pause_ms:
                return True

        if boundary == "until_field_change":
            prev_d = open_step["events"][-1].get("data", {})
            ft_prev = (prev_d.get("window_title"), prev_d.get("automation_id"),
                       prev_d.get("class_name"))
            ft_cur = (data.get("window_title"), data.get("automation_id"),
                      data.get("class_name"))
            if ft_cur != ft_prev:
                return True

        if boundary == "until_next_step":
            elapsed = (_parse_ts(ev["timestamp"])
                       - _parse_ts(open_step["events"][0]["timestamp"])
                       ).total_seconds() * 1000
            if elapsed > open_step.get("max_span_ms", 1800000):
                return True

        return False

    for ev in interactions:
        # Check if open step should close before this event
        if open_step is not None:
            result = _should_close(ev)
            if open_step is None:
                # end_when consumed the event and closed the step
                continue
            if result:
                close_open()

        # Span-boundary modes absorb interleaved interior events. The real
        # boundary was already evaluated by `_should_close` above (app change,
        # pause, field change, max span); if it returned False the open step
        # must keep collecting events -- including interior interactions that
        # do NOT re-match its trigger and interactions that match a DIFFERENT
        # step but have not yet hit the boundary. Without this, a non-matching
        # interior event leaks to `unmatched` (truncating the span) and a
        # different-step interior event prematurely closes it. Originally only
        # `until_next_step` did this; the other three span modes share the
        # same need.
        if open_step is not None and open_step["boundary"] in (
                "until_next_step", "until_app_change",
                "until_pause", "until_field_change"):
            # For `until_next_step` the boundary IS a different step's trigger,
            # so a different-step match closes-and-reopens here. For the other
            # three span modes the boundary is app-change / pause / field-change
            # (already checked by `_should_close`), so a different-step trigger
            # fired mid-span is just an interior event and must be absorbed too.
            if open_step["boundary"] == "until_next_step":
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
                if matched_step_id and matched_step_id != open_step["canonical_step_id"]:
                    close_open()
                    cdef = cstep_defs[matched_step_id]
                    open_step = {
                        "step_id": str(uuid.uuid4()),
                        "canonical_step_id": matched_step_id,
                        "events": [ev],
                        "end_when_rule": end_when,
                        "boundary": cdef.get("boundary", "group_contiguous"),
                        "open_case": _event_case(ev),
                        "open_app": _short_app(ev.get("data", {})),
                        "pause_ms": cdef.get("pause_ms", 5000),
                        "max_span_ms": cdef.get("max_span_ms", 1800000),
                    }
                else:
                    # Same step re-trigger or unmatched — absorb
                    open_step["events"].append(ev)
            else:
                # until_app_change / until_pause / until_field_change:
                # `_should_close` said this event is interior, so absorb it
                # regardless of whether it re-matches the trigger.
                open_step["events"].append(ev)
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
            cdef = cstep_defs[matched_step_id]
            open_step = {
                "step_id": str(uuid.uuid4()),
                "canonical_step_id": matched_step_id,
                "events": [ev],
                "end_when_rule": end_when,
                "boundary": cdef.get("boundary", "group_contiguous"),
                "open_case": _event_case(ev),
                "open_app": _short_app(ev.get("data", {})),
                "pause_ms": cdef.get("pause_ms", 5000),
                "max_span_ms": cdef.get("max_span_ms", 1800000),
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
