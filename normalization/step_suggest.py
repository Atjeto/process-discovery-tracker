"""Auto-suggest steps from interaction events. See annotation-model.md §4.1.
"""

from __future__ import annotations
import json
import re
import uuid
from pathlib import Path
from typing import Any
from datetime import datetime, timezone

from _dt import parse_ts_or_epoch as parse_ts  # public re-export
# A corrupt or hand-edited log can carry a non-ISO / empty / non-string
# timestamp; the epoch-fallback variant keeps segmentation sortable instead of
# crashing. The boundary (load_events) already coerces timestamp to a string;
# this guards the remaining "string but not ISO" case. Mirrors the same choice
# in case_assignment._parse_ts.
from recognition import is_browser_chrome


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


_COMPLETION_WORDS = frozenset(
    "search submit save apply ok close confirm send next finish done".split()
)

# G-4 label hygiene: a PII-masked value token («password#3f9a1c0e», written by
# the former structural masking stage) must never render raw in a user-facing
# step name/description, and literal junk an old recorder emits as a "value"
# must not leak in either.
_MASKED_VALUE_RE = re.compile(r"^«[^»]*»$")
_NOISE_VALUES = frozenset({"null", "(null)", "undefined", "(undefined)"})
MASKED_VALUE_DISPLAY = "(masked value)"


def _display_value(v: str | None) -> str:
    """The user-facing form of a typed value: '' for noise junk ('null'),
    '(masked value)' for a redaction token, else the value unchanged."""
    v = (v or "").strip()
    if not v or v.lower() in _NOISE_VALUES:
        return ""
    if _MASKED_VALUE_RE.match(v):
        return MASKED_VALUE_DISPLAY
    return v


def _element_key(data: dict[str, Any]) -> tuple:
    """Identity of the UI element an interaction targeted, for A4
    element-boundary step splitting. A stable automation id wins, else the
    visible name; the control type and window title disambiguate same-named
    controls across windows. Identityless web-app fields (no id, no name)
    collapse to the same key -- they are genuinely indistinguishable, so they
    are not force-split."""
    return (
        data.get("window_title") or "",
        (data.get("automation_id") or data.get("name") or ""),
        data.get("control_type") or "",
    )


def _most_common(values: list[str]) -> str:
    """Most frequent non-empty string, ties broken by first appearance.
    A small stdlib-only mode so step_grain_keys imports nothing heavy."""
    counts: dict[str, int] = {}
    order: list[str] = []
    for v in values:
        v = (v or "").strip()
        if not v:
            continue
        if v not in counts:
            counts[v] = 0
            order.append(v)
        counts[v] += 1
    if not counts:
        return ""
    return max(order, key=lambda v: counts[v])


def step_grain_keys(interactions: list[dict[str, Any]]) -> dict[str, str]:
    """Resolve the UI-containment keys for one step from its constituent
    interaction events, for the view-time grain roll-up (ADR-0024). A step is
    tagged with the keys that a node/step at each notch groups on:

      element -- the field/control the step acted on (automation_id, else the
                 visible name): the finest notch, one node per field.
      screen  -- the vocab `screen_id` an App Vocabulary named for the form,
                 else the `window_title` (a decent screen proxy), else
                 "(screen)": the DEFAULT resting notch ("one step per screen").
      app     -- the `process_name` (.exe stripped), else the window-title app
                 prefix: one node per application.

    The phase and case notches read the step's existing `phase_id` / `case_id`,
    so they are not duplicated here. Raw `events.jsonl` is untouched -- these
    keys live on the step (the annotation sidecar), recomputed every analyze so
    they track analyst renames the way `process_label` does. `interactions` are
    the step's interaction EVENTS (each carrying a `data` dict). A step with no
    interactions (a hand-authored step) falls back to the "(element/screen/app)"
    placeholders, which the viewer's view-time resolver can still refine."""
    datas = [(ev.get("data") or {}) for ev in (interactions or [])]
    # element: prefer the field the step TYPED into (value/text gestures) over
    # incidental navigation (a tab click, a focus) so "fill the To field" keys
    # on the To field, not the Message tab it passed through; fall back to every
    # interaction when the step typed nothing (a pure click step).
    _eid = lambda d: (d.get("automation_id") or d.get("name") or "")
    typed = [_eid(d) for d in datas
             if d.get("kind") in ("value_changed", "text_changed")]
    element = (_most_common(typed)
               or _most_common([_eid(d) for d in datas])
               or "(element)")
    screen = (
        _most_common([(d.get("screen_id") or "") for d in datas])
        or _most_common([(d.get("window_title") or "") for d in datas])
        or "(screen)"
    )
    procs = []
    for d in datas:
        p = (d.get("process_name") or "").strip()
        if p.lower().endswith(".exe"):
            p = p[:-4]
        if p:
            procs.append(p)
    app = _most_common(procs) or (_short_app(datas[-1]) if datas else "") or "(app)"
    return {"element": element, "screen": screen, "app": app}


def auto_suggest_steps(
    events: list[dict[str, Any]],
    *,
    step_split_idle_ms: int = 10000,
    step_max_interactions: int = 60,
    step_min_interactions: int = 2,
    step_max_idle_ms: int = 5000,
    step_split_on_element: bool = True,
    filter_browser_chrome: bool = True,
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

    `step_split_on_element` (default True) additionally ends a step when
    typing moves to a DIFFERENT field, so filling several fields yields one
    step per field instead of a single glued blob (ADR-0010 A4). value->action
    transitions are left intact ("type a serial then click Search" stays one
    named step). Set False to restore the pre-A4 grouping.

    `filter_browser_chrome` (default True) drops interactions on the browser's
    own UI -- address bar, toolbar buttons, tab strip -- which are navigation
    noise, not process steps (ADR-0009 fact-find). Web-app content is kept.
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
        if filter_browser_chrome and is_browser_chrome(ev.get("data", {})):
            continue
        cids = ev.get("data", {}).get("case_ids") or []
        top = cids[-1] if cids else None
        by_case.setdefault(top, []).append(ev)

    steps: list[dict[str, Any]] = []
    for case_id, case_events in by_case.items():
        case_events.sort(key=lambda e: e["timestamp"])
        candidate: list[dict[str, Any]] = []
        last_ts: datetime | None = None

        def flush():
            has_typing = any(
                ev["data"].get("kind") in ("value_changed", "text_changed")
                for ev in candidate
            )
            if len(candidate) < step_min_interactions and not has_typing:
                candidate.clear()
                return
            steps.append({
                "step_id": str(uuid.uuid4()),
                "session_id": session_id,
                "case_id": case_id,
                "name": _default_step_name(candidate),
                "description": _default_step_description(candidate),
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
                # ADR-0024: the UI-containment keys the view-time grain roll-up
                # groups on (element ⊂ screen ⊂ app). Phase/case read the
                # step's phase_id/case_id, so they are not duplicated here.
                "grain_keys": step_grain_keys(candidate),
            })
            candidate.clear()

        for ev in case_events:
            data = ev["data"]
            ts = parse_ts(ev["timestamp"])
            split = False
            if candidate:
                gap_ms = (ts - last_ts).total_seconds() * 1000
                if gap_ms > step_split_idle_ms:
                    split = True
                elif len(candidate) >= step_max_interactions:
                    split = True
                elif step_split_on_element:
                    # A4: a value gesture (typing into a field) ends the step
                    # when the next typing lands on a DIFFERENT element -- so
                    # filling three separate fields yields three steps, not one
                    # glued blob. value->action transitions are left intact so
                    # "type a serial then click Search" stays one named step.
                    prev = candidate[-1]["data"]
                    prev_is_value = prev.get("kind") in ("value_changed", "text_changed")
                    cur_is_value = data.get("kind") in ("value_changed", "text_changed")
                    if (prev_is_value and cur_is_value
                            and _element_key(prev) != _element_key(data)):
                        split = True
            if split:
                flush()
            candidate.append(ev)
            last_ts = ts
            # Completion-action boundary: an invoked Button/Hyperlink
            # with a completion word closes the current step. A vocab
            # entry that declares `completion: true` (lab-phase C1) is an
            # explicit analyst/discovery hint and closes the step without
            # the word heuristic -- enrichment stamps it as
            # data.vocab_semantics.completion.
            if data.get("kind") == "invoked":
                if (data.get("vocab_semantics") or {}).get("completion") is True:
                    flush()
                elif data.get("control_type") in ("Button", "Hyperlink"):
                    name_lower = (data.get("name") or "").lower()
                    if any(w in name_lower for w in _COMPLETION_WORDS):
                        flush()
        flush()

    return steps


def _primary_value(interactions: list[dict[str, Any]]) -> str:
    """The most identifying value a step typed -- the field content that
    says *which item* the step acted on. Newest-first, so the final
    (complete) value wins. Empty when the step typed nothing."""
    for ev in reversed(interactions):
        d = ev["data"]
        if d.get("kind") in ("value_changed", "text_changed"):
            v = _display_value(d.get("value"))
            if v:
                return v[:39] + "…" if len(v) > 40 else v
    return ""


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

    # 1. Last invoked button -- its verb, plus the value the step acted
    #    on if there is one ("Search — SN12345" beats a bare "Search").
    for ev in reversed(interactions):
        d = ev["data"]
        if d.get("kind") == "invoked" and d.get("name"):
            ctl = d.get("control_type") or ""
            verb = _verb_for_control(ctl, d.get("name"))
            obj = _primary_value(interactions)
            if obj and obj.lower() not in verb.lower():
                return _trim(f"{app}: {verb} — {obj}")
            return _trim(f"{app}: {verb}")

    kinds = [i["data"].get("kind") for i in interactions]

    # All typed-in-fields cluster: "App: Fill 3 fields (last: Email)"
    if all(k in ("value_changed", "text_changed") for k in kinds):
        last_val = ""
        for ev in reversed(interactions):
            v = _display_value(ev["data"].get("value"))
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
                if last_val:
                    return _trim(f"{app}: Enter {last_val} in {uniq[0]}")
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

    # Mixed cluster: no completion button -- lead with the value typed,
    # else the first clearly-named control.
    obj = _primary_value(interactions)
    if obj:
        return _trim(f"{app}: Enter {obj}")
    for ev in interactions:
        d = ev["data"]
        if d.get("kind") in ("focus_changed", "text_changed"):
            continue
        # A browser tab switch is navigation, not the step's purpose,
        # and its name is the window title -- which would only echo the
        # `app` prefix (the "TAMBA: TAMBA -  " bug).
        if (d.get("kind") == "selection_changed"
                and d.get("control_type") in ("TabItem", "Tab")):
            continue
        name = (d.get("meaningful_name") or d.get("name") or "").strip()
        if name and name.lower() != app.strip().lower():
            return _trim(f"{app}: {name}")
        break

    return _trim(f"{app}: {len(interactions)} interactions")


def _describe_interaction(data: dict[str, Any]) -> str | None:
    """A short human phrase for one interaction ('entered "X" into Y',
    'clicked Search', 'turned Remember me on'), or None for interactions
    not worth narrating in a step summary (focus changes). Covers every
    recorder event kind; an unrecognised future kind degrades to a
    generic phrase rather than being dropped."""
    kind = data.get("kind")
    name = (data.get("meaningful_name") or data.get("name") or "").strip()
    ctl = data.get("control_type") or ""
    target = name or (data.get("automation_id") or "").strip()
    field = target or "a control"

    if kind == "value_changed":
        raw = (data.get("value") or "").strip()
        value = _display_value(raw)
        if len(value) > 160:
            value = value[:159] + "…"
        count = data.get("_coalesced_count") or 0
        keys = f" ({count} keystrokes)" if count > 1 else ""
        if value == MASKED_VALUE_DISPLAY:
            return f"entered a masked value into {field}{keys}"
        if value:
            return f'entered "{value}" into {field}{keys}'
        if raw:
            # A junk literal ("null") -- the recorder saw an edit but no
            # readable value; don't echo the junk into the narration.
            return f"edited {field}{keys}"
        return f"cleared {field}{keys}"

    if kind == "text_changed":
        return f"edited {field}"

    if kind == "invoked":
        if not name:
            return None
        if ctl == "MenuItem":
            return f"opened {name}"
        if ctl == "Hyperlink":
            return f"followed {name}"
        return f"clicked {name}"

    if kind == "selection_changed":
        sel = (data.get("selected_value") or "").strip()
        if ctl in ("TabItem", "Tab"):
            return f"switched to {sel or name}" if (sel or name) else None
        if sel:
            return f'selected "{sel}" in {name}' if name else f'selected "{sel}"'
        return None

    if kind == "toggle_changed":
        state = (data.get("toggle_state") or "").strip().lower()
        if state == "on":
            return f"turned {field} on"
        if state == "off":
            return f"turned {field} off"
        if state == "indeterminate":
            return f"set {field} to indeterminate"
        return f"toggled {field}"

    if kind == "focus_changed":
        return None  # navigation noise -- never narrated in the summary

    if kind:
        # kind is normally a string enum, but a corrupt log may carry a
        # non-string; coerce so the narration never crashes on .replace.
        return f"{str(kind).replace('_', ' ')} on {target}" if target else None
    return None


def _default_step_description(interactions: list[dict[str, Any]]) -> str:
    """A prose summary of what a step did, built from its interactions,
    so an auto-suggested step reads meaningfully without the analyst
    drilling into the raw events. Each interaction is framed as its own
    sentence. The name stays terse; this carries the detail."""
    phrases: list[str] = []
    for ev in interactions:
        phrase = _describe_interaction(ev.get("data") or {})
        if phrase:
            phrases.append(phrase)
    if not phrases:
        n = len(interactions)
        return f"{n} interaction{'' if n == 1 else 's'} with no recorded detail."
    cap = 6
    shown = phrases[:cap]
    sentences = [p[0].upper() + p[1:] + "." for p in shown]
    extra = len(phrases) - len(shown)
    if extra > 0:
        sentences.append(f"Plus {extra} more action{'' if extra == 1 else 's'}.")
    return " ".join(sentences)


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
    """Roll up the per-step `waste` vocab flag from constituent interactions.

    ADR-0027 retired the per-step `conditional` / `exception_path` /
    `automation_candidate` flags as mis-scoped (a single step is not an exception
    path or an automation candidate — those are properties of a PATH or a
    coherent multi-step SEGMENT). Only `waste` is a genuine per-step judgment, so
    it is the only flag rolled up here; any interaction flagged waste lifts the
    step (conservative; the analyst can override per-step)."""
    out = {"waste": False}
    for ev in interactions:
        vf = (ev.get("data") or {}).get("vocab_flags") or {}
        if vf.get("waste"):
            out["waste"] = True
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
    # A corrupt/old capture can carry a non-dict `data` or a non-string
    # window_title / process_name; `str(... or "")` keeps `.strip()` safe.
    if not isinstance(data, dict):
        data = {}
    title = str(data.get("window_title") or "").strip()
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
                    # ADR-0024 §6a: strip embedded record values so the prefix is
                    # value-free and the SAME step type collapses across cases at
                    # the element grain (browser titles put the record id in the
                    # head: 'Create INC0010010 | Incident | ServiceNow').
                    return screen_label(head)
        # No separator: use the title up to ~40 chars
        return screen_label(title[:40])
    proc = str(data.get("process_name") or "").strip()
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


def _inherit_step_identity(fresh: list, existing: list, preserved: list) -> list:
    """Carry a prior step's IDENTITY onto the fresh auto step that re-covers
    the same interactions, so a re-analyze does not orphan relationships keyed
    on `step_id`: without it the regenerated step would get a NEW uuid4 id.

    Matching is by interaction_event_id overlap -- event ids are STABLE because
    events.jsonl is immutable -- and requires a MAJORITY of BOTH the fresh and
    the prior step's events in common, so only a genuine "same step" inherits.
    Each prior is claimed at most once. Purely additive: a fresh step with no
    confident match keeps its new id (the prior behaviour)."""
    preserved_ids = {s.get("step_id") for s in preserved}
    priors: list[tuple[dict, set]] = []
    for s in existing or []:
        if s.get("step_id") in preserved_ids:
            continue  # preserved steps are kept verbatim; their ids are safe
        evs = set((s.get("evidence") or {}).get("interaction_event_ids") or [])
        if evs:
            priors.append((s, evs))
    claimed: set = set()
    for f in fresh:
        f_evs = set((f.get("evidence") or {}).get("interaction_event_ids") or [])
        if not f_evs:
            continue
        best, best_overlap, best_p_evs = None, 0, set()
        for prior, p_evs in priors:
            if prior.get("step_id") in claimed:
                continue
            overlap = len(f_evs & p_evs)
            if overlap > best_overlap:
                best, best_overlap, best_p_evs = prior, overlap, p_evs
        if best is not None and best_overlap * 2 > len(f_evs) \
                and best_overlap * 2 > len(best_p_evs):
            claimed.add(best.get("step_id"))
            f["step_id"] = best.get("step_id")
    return fresh


def _merge_steps(existing: list, fresh: list,
                 interactions_by_id: dict | None = None) -> list:
    """Preserve manually_authored, edited, and hidden steps. Replace auto_*
    steps with the latest fresh suggestions. A `hidden` step is one the analyst
    manually suppressed -- preserving it means a re-analyze won't resurrect it
    as a fresh auto_suggested row.

    Fresh auto steps that overlap an analyst-owned (manual / edited / hidden)
    step are dropped: the analyst already owns that span, and an overlapping
    auto step is a duplicate they would otherwise have to find and delete by
    hand (§I37). The remaining fresh steps inherit the identity of the prior
    step they re-cover, so a re-analyze keeps relationships keyed on
    `step_id`, not just rows.

    `interactions_by_id` (event_id -> interaction event) lets every step --
    auto and preserved -- get its ADR-0024 `grain_keys` recomputed from its
    evidence, so the view-time grain roll-up has the containment keys even on
    manual steps. Optional: absent it, only
    steps that already carry `grain_keys` (the auto ones, stamped in flush())
    keep them, and the viewer resolves the rest at view time."""
    by_state = {"manually_authored": [], "edited": [], "hidden": []}
    for s in existing or []:
        st = s.get("state")
        if st in by_state:
            by_state[st].append(s)
    preserved = (by_state["manually_authored"] + by_state["edited"]
                 + by_state["hidden"])
    kept, dropped = drop_overlapping_auto_steps(fresh or [], preserved)
    if dropped:
        print(f"[normalize] dropped {len(dropped)} auto step(s) "
              f"overlapping analyst-owned steps")
    kept = _inherit_step_identity(kept, existing or [], preserved)
    result = preserved + kept
    # Stamp a value-free process_label for the step-level maps (recomputed
    # every analyze, so it tracks analyst renames).
    for s in result:
        s["process_label"] = process_label(s.get("name") or "")
        # ADR-0024: (re)resolve the grain-roll-up containment keys. Auto steps
        # already carry them (flush()); preserved steps get them here when
        # the interaction map is supplied. Recomputed every
        # analyze so they track the current evidence.
        if interactions_by_id is not None:
            evs = [interactions_by_id.get(eid)
                   for eid in ((s.get("evidence") or {}).get("interaction_event_ids") or [])]
            evs = [e for e in evs if e]
            if evs or not s.get("grain_keys"):
                s["grain_keys"] = step_grain_keys(evs)
    return result


# A step's auto name embeds the case's values ("Search — CUST-10001",
# "Enter 25 in Quantity"), so on the step-level process map / flow EVERY case
# yields a different node and the diagram explodes into one node per instance.
# `process_label` strips those values to the step TYPE so the same kind of step
# collapses to one node. The rewrite RULES are the SINGLE SOURCE in
# shared/process-label-patterns.json, shared with the viewer's
# process-map-levels.processLabel (JS) so the mined BPMN, the live DFG, and the
# stats collapse identically -- no second hand-synced regex to drift.
_LABEL_PATTERNS_PATH = (
    Path(__file__).resolve().parent.parent / "shared" / "process-label-patterns.json"
)


def _load_label_rules() -> tuple[list[tuple[Any, str]], list[tuple[Any, str]]]:
    with open(_LABEL_PATTERNS_PATH, encoding="utf-8") as fh:
        doc = json.load(fh)

    def compile_rules(raw):
        rules: list[tuple[Any, str]] = []
        for r in raw or []:
            # The shared file uses JS-style $1/$2 capture refs; map them to
            # Python backreferences (\1/\2) for re.sub.
            repl = re.sub(r"\$(\d+)", r"\\\1", r["replacement"])
            rules.append((re.compile(r["pattern"]), repl))
        return rules

    # pre_rules (G-4): artifact scrubbers, applied first, always, globally.
    return compile_rules(doc.get("pre_rules")), compile_rules(doc["rules"])


_LABEL_PRE_RULES, _LABEL_RULES = _load_label_rules()


# Value-free SCREEN/window strip (ADR-0024 §6a/§6b), shared with the viewer's
# process-map-levels.js `screenType` via shared/screen-label-patterns.json -- so
# the screen-grain key and the window-title-derived step prefix strip embedded
# record tokens identically, no hand-synced regex to drift. Applied IN ORDER,
# each a GLOBAL replace (unlike process_label's first-rule-wins), then end-trim.
_SCREEN_PATTERNS_PATH = (
    Path(__file__).resolve().parent.parent / "shared" / "screen-label-patterns.json"
)


def _load_screen_rules() -> list[tuple[Any, str]]:
    with open(_SCREEN_PATTERNS_PATH, encoding="utf-8") as fh:
        raw = json.load(fh)["rules"]
    return [(re.compile(r["pattern"]), r["replacement"]) for r in raw]


_SCREEN_RULES = _load_screen_rules()
_SCREEN_END_TRIM = re.compile(r"^[\s#:\-–—|]+|[\s#:\-–—|]+$")


def screen_label(name: str) -> str:
    """Value-free window/screen string: strip embedded record numbers / id tokens
    (the JS `screenType` twin). Used for the window-title-derived step-name prefix
    so the SAME step type collapses across cases at the element grain instead of
    fanning out per record ('Create INC0010010 | Incident | ServiceNow' ->
    'Create | Incident | ServiceNow'). Never blanks an all-value string."""
    s = (name or "").strip()
    if not s:
        return s
    for rx, repl in _SCREEN_RULES:
        s = rx.sub(repl, s)
    s = _SCREEN_END_TRIM.sub("", s).strip()
    return s or (name or "").strip()


def process_label(name: str) -> str:
    """Value-free label for the step-level process map + flow, so repeated work
    across cases collapses to one node instead of one-per-instance. Shared by
    the observed-flow BPMN (`bpmn_observed`) and the DFG (`process-map-levels`),
    which must agree -- the rules live in shared/process-label-patterns.json.
    Conservative: returns the name unchanged when no rule matches."""
    s = (name or "").strip()
    if not s:
        return s
    # G-4 pre_rules: scrub editing artifacts ('(split N)' stacks) first --
    # always, globally -- so they never reach the grouping key.
    for rx, repl in _LABEL_PRE_RULES:
        s = rx.sub(repl, s).strip()
    if not s:
        return (name or "").strip()
    # First rule that CHANGES the name wins (enter-in rewrite, else value-tail strip).
    for rx, repl in _LABEL_RULES:
        out = rx.sub(repl, s)
        if out != s:
            return out.strip()
    return s
