"""Coherent-segment detection -- ADR-0016.

The atomic-step view of automation candidacy (one click / keystroke /
nav at a time) is misleading: you do not automate clicking the search
button if the form fill before it is manual -- the resulting flow is
"human types, robot clicks, human continues" which is worse than fully
manual. The smallest *actionable* unit of automation is a coherent
stretch of work: open the CRM, search the customer, copy three fields,
paste into the booking screen, submit. This module detects those
stretches.

A segment, here, is a run of contiguous interactions inside ONE case
that share the SAME app and are not separated by a long idle gap. App
switches and case switches end the segment. Two segments are "the same
pattern" when they share (app, ordered list of process_labels of the
steps they cover) -- so the across-case repetition the analyst cares
about ("CRM lookup four times") still groups, while the within-step
mechanics (every individual click) do not.

Detection is intentionally conservative: a segment must touch >= 2
steps in one app run, OR be a single multi-interaction step long
enough to be worth automating (>= MIN_SEGMENT_MS); single-interaction
segments are dropped. The result is fed to analysis_automation, which
re-scores candidacy at the segment grain.
"""

from __future__ import annotations

import hashlib
from typing import Any

from _dt import parse_ts_or_none as parse_ts
from app_names import display_name


# The maximum gap inside one segment. A pause longer than this ends the
# run -- the human walked away or got pulled off, and the next batch of
# clicks is a fresh segment, not a continuation.
SEGMENT_SPLIT_IDLE_MS = 30_000

# A single-step segment below this duration is dropped -- a 0.5 s
# segment is not automation-worthy on its own. Multi-step segments are
# always kept (they carry the cross-step coherence even if short).
MIN_SEGMENT_MS = 5_000


def _interaction_app(data: dict) -> str:
    """The app key segments group by. Falls back to window_title when
    process_name is empty so a browser tab's interactions don't lump
    with the next browser tab's -- the recorder gives both."""
    p = (data.get("process_name") or "").strip().lower()
    if p:
        return p
    return (data.get("window_title") or "").strip().lower() or "(unknown)"


def _top_case_id(data: dict) -> str | None:
    """The case the interaction was stamped to during normalization. The
    INNERMOST is the most specific; `case_ids` is innermost-first."""
    cids = data.get("case_ids") or []
    return cids[0] if cids else None


def _step_index(steps: list[dict]) -> dict[str, dict]:
    """Index steps by every interaction_event_id they cover, so an
    interaction can find the step that contains it."""
    out: dict[str, dict] = {}
    for s in steps or []:
        for eid in ((s.get("evidence") or {}).get("interaction_event_ids") or []):
            if eid:
                out[eid] = s
    return out


def _step_label(step: dict | None) -> str:
    """The value-free label this step contributes to a segment's pattern.
    Mirrors analysis_common.step_group_label: a canonical-matched step
    carries a value-free name; an auto step's name embeds case values,
    so use process_label so 'Search — CUST-1' and 'Search — CUST-2'
    collapse to one label."""
    if not step:
        return ""
    if step.get("canonical_step_id"):
        return step.get("name") or step.get("process_label") or ""
    return step.get("process_label") or step.get("name") or ""


def _segment_signature(app: str, step_labels: tuple[str, ...]) -> str:
    """A stable short hash of (app, step_label_sequence) -- the cross-
    instance grouping key. Two segments with the same signature are the
    same pattern performed twice."""
    raw = app + "\x1f" + "\x1e".join(step_labels)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def _segment_label(app: str, step_labels: tuple[str, ...],
                   app_names: dict[str, str] | None = None) -> str:
    """A human-readable narrative label: 'step1 → step2 → step3 in <App>',
    the application by its readable name (stats.json meta.app_names, through
    app_names.display_name), never the process token, and no em or en dash.
    Truncates the step list after five steps, to keep rows readable without
    losing the head-of-flow detail."""
    app_pretty = display_name(app, app_names) or app
    if not step_labels:
        return app_pretty
    head = " → ".join(step_labels[:5])
    tail = "" if len(step_labels) <= 5 else f" → … (+{len(step_labels) - 5} more)"
    return f"{head}{tail} in {app_pretty}"


def detect_segments(
    events: list[dict[str, Any]],
    steps: list[dict[str, Any]],
    app_names: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Return a list of coherent segments across the session.

    Each segment carries the IDs of its constituent steps, the bounding
    timestamps, the app, the case it belongs to, and a (app,
    step_labels) signature that groups same-pattern instances across
    cases.

    A segment is closed (and a new one started) on a case switch, an
    app switch, an idle gap > SEGMENT_SPLIT_IDLE_MS, or end of stream.
    Segments shorter than MIN_SEGMENT_MS that cover < 2 distinct steps
    are dropped -- they are too small to be an automation candidate on
    their own.

    `app_names` is stats.json `meta.app_names` (app_names.build_app_names);
    it only names the application in each segment's `label`.
    """
    step_by_eid = _step_index(steps)
    interactions = [e for e in events if e.get("type") == "interaction"]
    interactions.sort(key=lambda e: (e.get("timestamp") or "", e.get("_seq") or 0))

    segments: list[dict[str, Any]] = []
    cur_eids: list[str] = []
    cur_steps: list[dict] = []      # constituent steps, in first-seen order
    cur_steps_seen: set[str] = set()
    cur_app: str | None = None
    cur_case: str | None = None
    cur_start_ts = None
    cur_end_ts = None
    last_ts = None

    def _flush():
        if not cur_eids or cur_start_ts is None or cur_end_ts is None:
            return
        elapsed = (cur_end_ts - cur_start_ts).total_seconds() * 1000.0
        step_labels = tuple(_step_label(s) for s in cur_steps if _step_label(s))
        distinct_labels = len(set(step_labels))
        # Drop single-step, short segments -- they are not actionable.
        if distinct_labels < 2 and elapsed < MIN_SEGMENT_MS:
            return
        sig = _segment_signature(cur_app or "", step_labels)
        segments.append({
            "segment_id": sig + ":" + (cur_case or "_") + ":" +
                          (cur_start_ts.isoformat() if cur_start_ts else "_"),
            "signature": sig,
            "app": cur_app or "",
            "case_id": cur_case,
            "start": cur_start_ts.isoformat().replace("+00:00", "Z"),
            "end": cur_end_ts.isoformat().replace("+00:00", "Z"),
            "elapsed_ms": round(elapsed),
            "interaction_count": len(cur_eids),
            "step_ids": [s.get("step_id") for s in cur_steps if s.get("step_id")],
            "step_labels": list(step_labels),
            "label": _segment_label(cur_app or "", step_labels, app_names),
        })

    for ev in interactions:
        data = ev.get("data") or {}
        ts = parse_ts(ev.get("timestamp"))
        if ts is None:
            continue
        app = _interaction_app(data)
        case = _top_case_id(data)
        eid = ev.get("event_id")
        step = step_by_eid.get(eid) if eid else None

        if cur_eids:
            gap_ms = (ts - last_ts).total_seconds() * 1000.0 if last_ts else 0
            boundary = (
                app != cur_app
                or case != cur_case
                or gap_ms > SEGMENT_SPLIT_IDLE_MS
            )
            if boundary:
                _flush()
                cur_eids = []
                cur_steps = []
                cur_steps_seen = set()
                cur_app = None
                cur_case = None
                cur_start_ts = None
                cur_end_ts = None

        if not cur_eids:
            cur_app = app
            cur_case = case
            cur_start_ts = ts
        cur_eids.append(eid)
        cur_end_ts = ts
        last_ts = ts
        if step is not None:
            sid = step.get("step_id")
            if sid and sid not in cur_steps_seen:
                cur_steps.append(step)
                cur_steps_seen.add(sid)

    _flush()
    return segments


def group_segments(segments: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Group segments by signature: same app + same step_label sequence
    across instances. Returns { signature: { label, app, step_labels,
    instances: [...] } } -- each `instances` entry has the per-segment
    timing/case fields, so the automation scorer can compute pooled
    metrics."""
    groups: dict[str, dict[str, Any]] = {}
    for seg in segments:
        sig = seg["signature"]
        g = groups.get(sig)
        if g is None:
            g = {
                "signature": sig,
                "label": seg["label"],
                "app": seg["app"],
                "step_labels": list(seg.get("step_labels") or []),
                "instances": [],
            }
            groups[sig] = g
        g["instances"].append({
            "segment_id": seg["segment_id"],
            "case_id": seg.get("case_id"),
            "start": seg["start"],
            "end": seg["end"],
            "elapsed_ms": seg["elapsed_ms"],
            "interaction_count": seg["interaction_count"],
            "step_ids": list(seg.get("step_ids") or []),
        })
    return groups
