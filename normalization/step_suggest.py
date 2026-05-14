"""Auto-suggest steps from interaction events when no canonical set
exists or no canonical match fires. See annotation-model.md §4.1.
"""

from __future__ import annotations
import uuid
from typing import Any
from datetime import datetime


def parse_ts(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def auto_suggest_steps(
    events: list[dict[str, Any]],
    *,
    step_split_idle_ms: int = 3000,
    step_max_interactions: int = 12,
    step_min_interactions: int = 2,
    step_max_idle_ms: int = 5000,
    session_id: str = "",
) -> list[dict[str, Any]]:
    """Walk interaction events in time order within each case. Produce
    auto_suggested steps per the algorithm in annotation-model.md §4.1.
    """
    # Group by top-level case (last case_id in case_ids list, or None)
    by_case: dict[str | None, list[dict[str, Any]]] = {}
    for ev in events:
        if ev.get("type") != "interaction":
            continue
        cids = ev.get("data", {}).get("case_ids") or []
        top = cids[-1] if cids else None
        by_case.setdefault(top, []).append(ev)

    steps: list[dict[str, Any]] = []
    for case_id, case_events in by_case.items():
        case_events.sort(key=lambda e: e["timestamp"])
        candidate: list[dict[str, Any]] = []
        last_ts: datetime | None = None
        last_window: str | None = None
        last_process: str | None = None

        def flush():
            if len(candidate) < step_min_interactions:
                candidate.clear()
                return
            steps.append({
                "step_id": str(uuid.uuid4()),
                "session_id": session_id,
                "case_id": case_id,
                "name": _default_step_name(candidate),
                "description": "",
                "time_range": {
                    "start": candidate[0]["timestamp"],
                    "end": candidate[-1]["timestamp"],
                },
                "evidence": {
                    "interaction_event_ids": [ev["event_id"] for ev in candidate],
                    "screenshot_refs": [],
                    "video_timecode_range": None,
                    "manual_notes": "",
                },
                "state": "auto_suggested",
                "canonical_step_id": None,
                "flags": _aggregate_vocab_flags(candidate),
                "phase_id": None,
            })
            candidate.clear()

        for ev in case_events:
            data = ev["data"]
            ts = parse_ts(ev["timestamp"])
            window = data.get("window_title") or ""
            proc = data.get("process_name") or ""
            split = False
            if candidate:
                gap_ms = (ts - last_ts).total_seconds() * 1000
                if gap_ms > step_split_idle_ms: split = True
                elif window != last_window: split = True
                elif proc != last_process: split = True
                elif len(candidate) >= step_max_interactions: split = True
            if split:
                flush()
            candidate.append(ev)
            last_ts = ts
            last_window = window
            last_process = proc
        flush()

    return steps


def _default_step_name(interactions: list[dict[str, Any]]) -> str:
    """Derive a useful name from the actual interactions captured.

    Strategy, in priority order:
      0. If any interaction carries an App Vocabulary `meaningful_name`
         and it's an Invoked action, use it directly -- analyst-curated
         names always beat heuristics.
      1. The window title's app prefix + the most semantically loaded
         interaction's control name. Most of the time the last
         user-meaningful interaction is an Invoked Button -- that's the
         step's purpose ("Save", "Submit", "Search").
      2. If a value_changed shows the most recent typed value, use
         "App: Enter <value>" (clamped).
      3. If the cluster is all selection_changed (drop-down picks),
         report the selected values.
      4. Final fallback: a count-based summary.
    """
    last = interactions[-1]["data"]
    app = _short_app(last)

    # 0. Analyst-curated meaningful name on an Invoked action wins.
    for ev in reversed(interactions):
        d = ev["data"]
        if d.get("kind") == "invoked" and d.get("meaningful_name"):
            return _trim(f"{app}: {d['meaningful_name']}")

    # 1. Last invoked button's raw name.
    for ev in reversed(interactions):
        d = ev["data"]
        if d.get("kind") == "invoked" and d.get("name"):
            ctl = d.get("control_type") or ""
            verb = _verb_for_control(ctl, d.get("name"))
            return _trim(f"{app}: {verb}")

    kinds = [i["data"].get("kind") for i in interactions]

    # All typed-in-fields cluster: "App: Fill 3 fields (last: Email)"
    if all(k in ("value_changed", "text_changed") for k in kinds):
        last_val = ""
        for ev in reversed(interactions):
            v = (ev["data"].get("value") or "").strip()
            if v:
                last_val = v[:40]
                break
        # Prefer meaningful_name (analyst-curated) over raw control name.
        named_fields = [
            ((i["data"].get("meaningful_name") or i["data"].get("name") or "").strip())
            for i in interactions
            if (i["data"].get("meaningful_name") or i["data"].get("name") or "").strip()
        ]
        if named_fields:
            uniq = list(dict.fromkeys(named_fields))  # preserve order, dedup
            if len(uniq) == 1:
                return _trim(f"{app}: Fill {uniq[0]}")
            if len(uniq) <= 3:
                return _trim(f"{app}: Fill " + ", ".join(uniq))
            return _trim(f"{app}: Fill {len(interactions)} fields ({uniq[0]}, ...)")
        if last_val:
            return _trim(f"{app}: Enter {last_val}")
        return _trim(f"{app}: Fill {len(interactions)} fields")

    # All selection_changed: "App: Select Foo, Bar"
    if all(k == "selection_changed" for k in kinds):
        vals = [
            (i["data"].get("selected_value") or "").strip()
            for i in interactions if (i["data"].get("selected_value") or "").strip()
        ]
        vals = list(dict.fromkeys(vals))
        if vals:
            if len(vals) == 1: return _trim(f"{app}: Select {vals[0]}")
            if len(vals) <= 3: return _trim(f"{app}: Select " + ", ".join(vals))
            return _trim(f"{app}: Select {len(vals)} options")

    # Mixed cluster: lead with the most informative non-focus interaction.
    for ev in interactions:
        d = ev["data"]
        if d.get("kind") in ("focus_changed", "text_changed"):
            continue
        name = (d.get("name") or "").strip()
        val = (d.get("value") or "").strip()
        if name:
            return _trim(f"{app}: {name}")
        if val:
            return _trim(f"{app}: {val[:40]}")
        break

    return _trim(f"{app}: {len(interactions)} interactions")


# --- Helpers -----------------------------------------------------------

def _aggregate_vocab_flags(interactions: list[dict[str, Any]]) -> dict[str, Any]:
    """Roll up vocab_flags from constituent interactions into a step flag
    set. Any interaction flagged as automation_candidate or waste lifts
    the whole step (it's the conservative interpretation; analyst can
    override per-step)."""
    out = {
        "conditional": False, "condition_text": None,
        "exception_path": False, "waste": False,
        "automation_candidate": False,
    }
    for ev in interactions:
        vf = (ev.get("data") or {}).get("vocab_flags") or {}
        for k in ("exception_path", "waste", "automation_candidate", "conditional"):
            if vf.get(k):
                out[k] = True
    return out


_VERB_HINTS = {
    "Button": None,             # the button's name is the verb already
    "MenuItem": "open",
    "TabItem": "switch to",
    "TreeItem": "select",
    "ListItem": "select",
    "Hyperlink": "follow",
    "RadioButton": "choose",
    "CheckBox": "toggle",
}

def _verb_for_control(control_type: str, name: str) -> str:
    """Most controls' names already read like verbs ("Save", "Search").
    For containers (MenuItem, TabItem) the name is a noun -- prefix a
    verb so the step reads as an action."""
    hint = _VERB_HINTS.get(control_type)
    if hint:
        return f"{hint} {name}"
    return name


def _short_app(data: dict) -> str:
    """Pull a short readable app or window label.

    Prefers a leading non-punctuation token of the window title (which
    is usually the app name on Windows: "Salesforce | Search Accounts"
    becomes "Salesforce"). Falls back to process_name without .exe.
    """
    title = (data.get("window_title") or "").strip()
    if title:
        # Common Windows separators: " - ", " | ", " :: "
        for sep in (" — ", " - ", " | ", " :: ", " : "):
            head, _, _rest = title.partition(sep)
            if head and head != title:
                head = head.strip()
                # Reject leading separators like asterisks (unsaved indicator)
                if head.startswith("*"):
                    head = head.lstrip("*").strip()
                if head:
                    return head
        # No separator: use the title up to ~40 chars
        return title[:40]
    proc = (data.get("process_name") or "").strip()
    if proc.lower().endswith(".exe"):
        proc = proc[:-4]
    return proc or "App"


def _trim(s: str, limit: int = 80) -> str:
    s = (s or "").strip().strip(":").strip()
    return s if len(s) <= limit else s[: limit - 1] + "…"
