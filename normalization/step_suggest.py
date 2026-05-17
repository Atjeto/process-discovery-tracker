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


def _is_ignored(data: dict, ignored: list[str] | None) -> bool:
    """True if this interaction belongs to a denylisted app. Matches a
    case-insensitive substring against both process_name and
    window_title, so a denylist of ["obs"] catches both "obs64.exe"
    (process) and "OBS 31.0.1" (window-title-derived app name)."""
    if not ignored:
        return False
    proc = (data.get("process_name") or "").lower()
    title = (data.get("window_title") or "").lower()
    for term in ignored:
        t = (term or "").strip().lower()
        if t and (t in proc or t in title):
            return True
    return False


def _parse_excluded_ranges(
    excluded_ranges: list[dict] | None,
) -> list[tuple[datetime, datetime]]:
    """Pre-parse the annotations.json `excluded_ranges` start/end ISO
    strings into datetime pairs, dropping any malformed entry."""
    out: list[tuple[datetime, datetime]] = []
    for r in excluded_ranges or []:
        start, end = (r or {}).get("start"), (r or {}).get("end")
        if not start or not end:
            continue
        try:
            a, b = parse_ts(start), parse_ts(end)
        except (ValueError, TypeError):
            continue
        if b >= a:
            out.append((a, b))
    return out


def _ts_excluded(ts_str: str, ranges: list[tuple[datetime, datetime]]) -> bool:
    """True if `ts_str` falls inside any excluded range."""
    if not ranges:
        return False
    try:
        t = parse_ts(ts_str)
    except (ValueError, TypeError):
        return False
    return any(a <= t <= b for a, b in ranges)


def auto_suggest_steps(
    events: list[dict[str, Any]],
    *,
    step_split_idle_ms: int = 3000,
    step_max_interactions: int = 12,
    step_min_interactions: int = 2,
    step_max_idle_ms: int = 5000,
    session_id: str = "",
    ignored_processes: list[str] | None = None,
    excluded_ranges: list[dict] | None = None,
) -> list[dict[str, Any]]:
    """Walk interaction events in time order within each case. Produce
    auto_suggested steps per the algorithm in annotation-model.md §4.1.

    `ignored_processes` is a denylist of substrings: any interaction
    whose process_name or window_title contains one of these terms is
    dropped before step suggestion. This is how an analyst suppresses
    noise apps (OBS, the tracker UI itself, Teams) that the UIA
    recorder picks up but that aren't part of the process being
    discovered.

    `excluded_ranges` is the annotations.json `excluded_ranges` list:
    any interaction whose timestamp falls inside one is dropped, so an
    analyst can cut a break or an unrelated detour out of a long
    passive recording before step suggestion runs.
    """
    excluded = _parse_excluded_ranges(excluded_ranges)
    # Group by top-level case (last case_id in case_ids list, or None)
    by_case: dict[str | None, list[dict[str, Any]]] = {}
    for ev in events:
        if ev.get("type") != "interaction":
            continue
        if _is_ignored(ev.get("data", {}), ignored_processes):
            continue
        if _ts_excluded(ev.get("timestamp", ""), excluded):
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
                "suggestion_reason": _suggestion_reason(candidate, step_split_idle_ms),
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


def _suggestion_reason(interactions: list[dict[str, Any]], threshold_ms: int) -> str:
    """One-line explanation of why these interactions were grouped into a
    step -- shown to the analyst so an auto-detected step is not a black
    box. The largest within-step gap is always below `threshold_ms` (a
    bigger gap would have split the step)."""
    app = _short_app(interactions[-1]["data"])
    max_gap_ms = 0.0
    if len(interactions) >= 2:
        ts = [parse_ts(ev["timestamp"]) for ev in interactions]
        max_gap_ms = max(
            (ts[i + 1] - ts[i]).total_seconds() * 1000
            for i in range(len(ts) - 1)
        )
    return (
        f"Grouped {len(interactions)} interactions in {app}, "
        f"max gap {max_gap_ms / 1000:.0f}s (threshold {threshold_ms // 1000}s)"
    )


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


# --- Step overlap (I37) ------------------------------------------------

def _step_bounds(step: dict) -> tuple[datetime, datetime] | None:
    """(start, end) datetimes for a step's time_range, or None when the
    range is missing or inverted."""
    tr = step.get("time_range") or {}
    s, e = tr.get("start"), tr.get("end")
    if not s or not e:
        return None
    try:
        a, b = parse_ts(s), parse_ts(e)
    except (ValueError, TypeError):
        return None
    return (a, b) if b >= a else None


def steps_overlap_seconds(a: dict, b: dict) -> float:
    """Seconds of time-range overlap between two steps; 0 when disjoint
    or either range is unusable."""
    ba, bb = _step_bounds(a), _step_bounds(b)
    if not ba or not bb:
        return 0.0
    lo = max(ba[0], bb[0])
    hi = min(ba[1], bb[1])
    return max(0.0, (hi - lo).total_seconds())


def drop_overlapping_auto_steps(
    fresh: list[dict],
    preserved: list[dict],
    threshold: float = 0.5,
) -> tuple[list[dict], list[dict]]:
    """Drop a freshly-suggested auto step when it overlaps an
    analyst-owned (manually_authored / edited / hidden) step by more than
    `threshold` of the fresh step's own duration.

    A re-analyze regenerates auto steps from the raw interaction stream,
    independent of where the analyst has authored steps -- so a fresh
    auto step can land on top of a span the analyst already owns. Without
    this the analyst inherits a duplicate to notice and delete (§I37).

    Returns `(kept, dropped)`.
    """
    kept: list[dict] = []
    dropped: list[dict] = []
    for f in fresh or []:
        fb = _step_bounds(f)
        f_dur = (fb[1] - fb[0]).total_seconds() if fb else 0.0
        overlapped = False
        if f_dur > 0:
            for p in preserved or []:
                if steps_overlap_seconds(f, p) > threshold * f_dur:
                    overlapped = True
                    break
        (dropped if overlapped else kept).append(f)
    return kept, dropped
