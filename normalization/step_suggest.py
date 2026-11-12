"""Draft steps from interaction events: the drafting rule (contract C1).

Within each run (case), a step is a stretch of consecutive interactions on one
screen. It ends at a commit interaction (inclusive), at the first interaction
on a different screen (exclusive), or at the end of the run. Every draft
carries a value-free `draft_key` ("<app>|<screen>|<commit>"), so a name the
analyst gives once names the project's other drafts of that key (contract
C4: the session's own names), and a run of drafts whose screens the
project's activity library knows becomes one draft named from its activity
(contract C21, library_drafts).
"""

from __future__ import annotations
import json
import re
import uuid
from collections import Counter
from pathlib import Path
from typing import Any
from datetime import datetime, timezone

from _dt import parse_ts_or_epoch as parse_ts  # public re-export
from _dt import parse_ts_or_none as _parse_ts_or_none
# A corrupt or hand-edited log can carry a non-ISO / empty / non-string
# timestamp; the epoch-fallback variant keeps segmentation sortable instead of
# crashing. The boundary (load_events) already coerces timestamp to a string;
# this guards the remaining "string but not ISO" case. Mirrors the same choice
# in case_assignment._parse_ts.
from app_names import display_name
from library import collapse
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
      app     -- the `process_name` (.exe stripped), else "(app)": one node
                 per application.

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
    # Lane LF-PIPE: the app is a program, never a word of the window title
    # nor a made-up "App" (the viewer's resolveStepGrainKeys, the same rule).
    app = _most_common(procs) or "(app)"
    return {"element": element, "screen": screen, "app": app}


# --- The drafting rule (contract C1) ------------------------------------

# Control types whose `invoked` event commits the work done on a screen: a
# button (Save, Search, Submit), a split button, a menu command, a link.
COMMIT_CONTROL_TYPES = frozenset({"Button", "SplitButton", "MenuItem", "Hyperlink"})

# The three ways a drafted step ends (C1 `end_reason`).
END_COMMIT = "commit"
END_SCREEN_CHANGE = "screen_change"
END_RUN_END = "run_end"

# The commit part of a draft_key when the step did not end on a commit.
VISIT = "(visit)"

# Lane LF-PIPE: the controls that open a record from a list (a link, a list
# item), and the words of that commit when the record is all its name says.
_RECORD_TYPES = frozenset({"Hyperlink", "ListItem"})
OPEN_A_RECORD = "Open a record"


def _has_identity(data: dict[str, Any]) -> bool:
    """True when the interaction names its control: an automation_id, a name
    or a class name."""
    return any(isinstance(data.get(f), str) and data[f].strip()
               for f in ("automation_id", "name", "class_name"))


def _is_commit(data: dict[str, Any]) -> bool:
    """C1 (a): does this interaction end its step, inclusively? An `invoked`
    event on a commit-type control that names itself, or any interaction
    whose vocab semantics carry the boolean `completion: true`. Decided by
    the control type and that flag only, never by a word inside a name: the
    old word match ended a step at a "Lookup" or "Booking" control because
    the name contains "ok". A click without identity (no automation_id, name
    or class name: a web click whose page had already gone) ends no step:
    it would end one as a commit named after nothing (lane LF-PIPE)."""
    ct = data.get("control_type")
    if (data.get("kind") == "invoked" and isinstance(ct, str)
            and ct in COMMIT_CONTROL_TYPES and _has_identity(data)):
        return True
    sem = data.get("vocab_semantics")
    return isinstance(sem, dict) and sem.get("completion") is True


def _first_text(data: dict[str, Any], fields: tuple[str, ...]) -> tuple[str, str]:
    """(field, text) of the first field in `fields` holding non-blank text,
    or ("", "") when none does."""
    for f in fields:
        v = data.get(f)
        if isinstance(v, str) and v.strip():
            return f, v.strip()
    return "", ""


def _draft_app(data: dict[str, Any]) -> str:
    """C1 app: the process name lowercased, ".exe" stripped ("" if absent)."""
    _f, p = _first_text(data, ("process_name",))
    p = p.lower()
    return p[:-4] if p.endswith(".exe") else p


def _draft_screen(data: dict[str, Any]) -> str:
    """C1 screen: the vocab `screen_id` when present, else the shared
    value-free screen-label rules applied to the window title (the rules the
    viewer's screen grain applies), else the program's readable name (lane
    LF-PIPE: shared/system-names.json, "Excel"), else "(screen)" when there
    is neither."""
    _f, sid = _first_text(data, ("screen_id",))
    if sid:
        return sid
    _f, title = _first_text(data, ("window_title",))
    if title:
        return screen_label(title)
    _f, program = _first_text(data, ("process_name",))
    return display_name(program) or "(screen)"


def _commit_part(data: dict[str, Any]) -> tuple[str, str]:
    """(commit part of the draft_key, identity rung) for a commit interaction.
    The part is "<control_type>:<identity>", identity = the automation_id,
    else the name, else the class_name, else "?"; the rung names the field
    that identified it ("?" when none did). Each rung is taken value-free
    (_value_free): a link named "INC0010010" or an automation_id
    "incident-INC0010010" must not give every run a key of its own, so a rung
    that is nothing but a record value falls through to the next one."""
    _f, ct = _first_text(data, ("control_type",))
    for rung in ("automation_id", "name", "class_name"):
        _f, text = _first_text(data, (rung,))
        ident = _value_free(text)
        if ident:
            return f"{ct or '?'}:{ident}", rung
    return f"{ct or '?'}:?", "?"


def _commit_label(data: dict[str, Any]) -> str:
    """The commit's words in a default name: the vocab meaningful_name, else
    the control's name, else its control type. The two names are taken
    value-free like the identity (_commit_part), so a draft name never
    carries the record a link opened; a link or list item whose name is
    nothing but a record's number ("INC0010010" in a ServiceNow list) is
    "Open a record" (lane LF-PIPE)."""
    for field in ("meaningful_name", "name"):
        _f, text = _first_text(data, (field,))
        label = _value_free(text)
        if label:
            return label
    _f, ct = _first_text(data, ("control_type",))
    if ct in _RECORD_TYPES and _first_text(data, ("name",))[1]:
        return OPEN_A_RECORD
    return ct or "?"


def _screenshot_index(events: list[dict[str, Any]]) -> tuple[list[datetime], list[str]]:
    """(times, paths) of the session's screenshot events, sorted by time."""
    shots: list[tuple[datetime, str]] = []
    for ev in events:
        if ev.get("type") != "system":
            continue
        d = ev.get("data")
        if not isinstance(d, dict) or d.get("kind") not in ("screenshot", "screenshot_manual"):
            continue
        path = d.get("path")
        if isinstance(path, str) and path.strip():
            shots.append((parse_ts(ev.get("timestamp")), path))
    shots.sort(key=lambda s: s[0])
    return [t for t, _p in shots], [p for _t, p in shots]


def _attach_screenshots(drafts: list[dict[str, Any]],
                        index: tuple[list[datetime], list[str]],
                        excluded: list[tuple[datetime, datetime]]) -> None:
    """Lane LF-PIPE: every screenshot goes to one draft, the recorder's and
    the SME's own (the screenshot key) alike: the draft whose time range
    holds it; else the draft it precedes (the next to start after it: a
    transaction's first screenshot comes a moment before its first action);
    else, taken after every draft, the last one. A screenshot inside a
    stretch left out of the analysis goes to none."""
    times, paths = index
    spans = []
    for d in drafts:
        tr = d.get("time_range") or {}
        start, end = _parse_ts_or_none(tr.get("start")), _parse_ts_or_none(tr.get("end"))
        if start is not None:
            spans.append((start, end if end is not None and end >= start else start, d))
    spans.sort(key=lambda s: (s[0], s[1]))
    for t, path in zip(times, paths):
        if not spans or any(a <= t <= b for a, b in excluded):
            continue
        holder = (next((d for a, b, d in spans if a <= t <= b), None)
                  or next((d for a, _b, d in spans if a > t), None)
                  or spans[-1][2])
        holder["evidence"]["screenshot_refs"].append(path)


def _draft_step(stretch: list[dict[str, Any]], end_reason: str, *,
                case_id: str | None, session_id: str) -> dict[str, Any]:
    """One drafted step (C1) from a stretch of interactions on one screen,
    without its name and key yet (_name_drafts gives them, once the
    screens are value-free across the transactions, and its screenshots
    come from _attach_screenshots). Its parts are kept in `_parts` until
    then: (app, screen, commit, commit label, whether its name identified
    the commit)."""
    first, last = stretch[0]["data"], stretch[-1]["data"]
    app = _draft_app(first) or "(app)"
    screen = _draft_screen(first)
    if end_reason == END_COMMIT:
        commit, rung = _commit_part(last)
        label = _commit_label(last)
    else:
        commit, label, rung = VISIT, "", ""
    start, end = stretch[0]["timestamp"], stretch[-1]["timestamp"]
    return {
        "step_id": str(uuid.uuid4()),
        "session_id": session_id,
        "case_id": case_id,
        "name": "",
        "description": _default_step_description(stretch),
        "time_range": {"start": start, "end": end},
        "evidence": {
            "interaction_event_ids": [ev["event_id"] for ev in stretch],
            "screenshot_refs": [],
            "video_timecode_range": None,
            "manual_notes": "",
        },
        "state": "auto_suggested",
        "canonical_step_id": None,
        "flags": _aggregate_vocab_flags(stretch),
        "phase_id": None,
        # ADR-0024 containment keys; the viewer still groups on them.
        "grain_keys": step_grain_keys(stretch),
        "draft_key": "",
        "name_source": "draft",
        "end_reason": end_reason,
        "_parts": (app, screen, commit, label, rung == "name"),
    }


# The ellipsis that stands for the value a screen's title held (U+2026), and
# the separators of a title's segments (a hyphen, a pipe, a colon, an en or
# em dash, built with chr() so this source holds no dash characters).
VALUE_MARK = "\u2026"
_SEPARATORS = {"-", "|", ":", "::", chr(0x2013), chr(0x2014)}


def _common_screen(screens: list[str]) -> str:
    """The words a screen's titles share at their start and at their end,
    with an ellipsis where the words that differ were: "New order for
    Contoso Ltd | Order Desk" and "New order for Northwind Traders | Order
    Desk" are "New order for ... | Order Desk". A value that was a whole
    segment at an end goes with its separator: "Contoso Ltd | Account |
    Salesforce" and "Fabrikam | Account | Salesforce" are "Account |
    Salesforce". "" when the titles share no word, or one of them has
    nothing between the shared words: then they are not one screen."""
    words = [s.split() for s in screens]
    prefix = 0
    while all(len(w) > prefix for w in words) and len({w[prefix] for w in words}) == 1:
        prefix += 1
    suffix = 0
    while (all(len(w) > prefix + suffix for w in words)
           and len({w[len(w) - 1 - suffix] for w in words}) == 1):
        suffix += 1
    if not prefix + suffix or any(len(w) <= prefix + suffix for w in words):
        return ""
    head = words[0][:prefix]
    tail = words[0][len(words[0]) - suffix:] if suffix else []
    if head and tail:
        return " ".join(head + [VALUE_MARK] + tail)
    if head:
        kept = head[:-1] if head[-1] in _SEPARATORS else head + [VALUE_MARK]
    else:
        kept = tail[1:] if tail[0] in _SEPARATORS else [VALUE_MARK] + tail
    return " ".join(kept) if any(w not in _SEPARATORS and w != VALUE_MARK for w in kept) else ""


def value_free_screens(drafts: list[dict[str, Any]]) -> dict[tuple[str, str], str]:
    """Lane LF-PIPE (#8): {(app, screen): its value-free screen} for the
    screens whose window title carries a value the shared rules cannot see
    (a customer's name: "New order for Contoso Ltd"). Screens are one screen
    with a value in its title when drafts of different transactions end at
    the same commit control of one app on them, and no transaction was on
    two of them; the screen then is the words their titles share
    (_common_screen). Every draft on such a screen takes it, its visits
    included."""
    seen: dict[tuple[str, str], set] = {}
    groups: dict[tuple[str, str], dict[str, set]] = {}
    for d in drafts:
        app, screen, commit, _label, _by_name = d["_parts"]
        seen.setdefault((app, screen), set()).add(d.get("case_id"))
        if commit != VISIT and not commit.endswith(":?"):
            groups.setdefault((app, commit), {}).setdefault(screen, set()).add(d.get("case_id"))
    out: dict[tuple[str, str], str] = {}
    for (app, _commit), screens in groups.items():
        if len(screens) < 2:
            continue
        names = list(screens)
        cases = [seen[(app, s)] for s in names]
        if any(cases[a] & cases[b] for a in range(len(cases)) for b in range(a + 1, len(cases))):
            continue
        common = _common_screen(names)
        if common:
            for s in names:
                out.setdefault((app, s), common)
    return out


def value_free_commits(drafts: list[dict[str, Any]],
                       screens: dict[tuple[str, str], str]) -> dict[int, tuple[str, str]]:
    """Lane LF-PIPE: {index of a draft: (commit part, commit label)} for the
    drafts that end on a link or a list item named by a record ("VPN drops
    every hour (In progress)" in a ticket queue, an account in a list view).
    Such commits are one commit when their names identify them, they are on
    one screen of one app (value_free_screens), their names differ, drafts
    of two transactions or more end on them, and the step after each is on
    one screen (the record they open). The commit is then named by the
    words the names share (_common_screen), else "Open a record", and the
    draft_key takes that name. A link with an automation id, and links that
    lead to different screens (a menu's Reports and Settings), keep theirs."""
    def where(d: dict[str, Any]) -> tuple[str, str]:
        app, screen = d["_parts"][0], d["_parts"][1]
        return app, screens.get((app, screen), screen)

    groups: dict[tuple, dict[str, list[int]]] = {}
    for n, d in enumerate(drafts):
        commit, by_name = d["_parts"][2], d["_parts"][4]
        ct, _sep, name = commit.partition(":")
        after = drafts[n + 1] if n + 1 < len(drafts) else None
        if (not by_name or ct not in _RECORD_TYPES or after is None
                or after.get("case_id") != d.get("case_id")):
            continue
        groups.setdefault((where(d), ct, where(after)), {}).setdefault(name, []).append(n)
    out: dict[int, tuple[str, str]] = {}
    for (_here, ct, _there), names in groups.items():
        cases = {drafts[n].get("case_id") for found in names.values() for n in found}
        if len(names) < 2 or len(cases) < 2:
            continue
        label = _common_screen(list(names)) or OPEN_A_RECORD
        for found in names.values():
            for n in found:
                out[n] = (f"{ct}:{label}", label)
    return out


def _name_drafts(drafts: list[dict[str, Any]], remembered: dict[str, str]) -> None:
    """Give each draft its screen, name and draft_key (C1): the screen made
    value-free across the transactions (value_free_screens), and a commit
    that opens one record or another named by what the records share
    (value_free_commits); the name the analyst gave to its key in this
    session (C4), else "<screen>: <commit label>", or "<screen>" for a step
    that did not end on a commit."""
    screens = value_free_screens(drafts)
    commits = value_free_commits(drafts, screens)
    for n, d in enumerate(drafts):
        app, screen, commit, label, _by_name = d.pop("_parts")
        screen = screens.get((app, screen), screen)
        commit, label = commits.get(n, (commit, label))
        draft_key = f"{app}|{screen}|{commit}"
        remembered_name = remembered.get(draft_key)
        d["name"] = remembered_name or (f"{screen}: {label}" if commit != VISIT else screen)
        d["draft_key"] = draft_key
        d["name_source"] = "remembered" if remembered_name else "draft"


def auto_suggest_steps(
    events: list[dict[str, Any]],
    *,
    filter_browser_chrome: bool = True,
    session_id: str = "",
    ignored_processes: list[str] | None = None,
    excluded_ranges: list[dict] | None = None,
    session_names: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Draft every run's steps with the drafting rule (contract C1).

    Within each run (the outermost case an interaction belongs to), walk the
    interactions in time order. A step is a stretch of consecutive
    interactions on one screen, and it ends
      (a) at a commit interaction, inclusive (see _is_commit);
      (b) at the first interaction on a different screen, exclusive;
      (c) at the end of the run.
    A screen belongs to its app: the same screen label in another app is a
    different screen. Interactions outside any run are drafted the same way
    with `case_id: None`. Every interaction that passes the filters below lands
    in exactly one draft; nothing is dropped for being short.

    Filters, applied before the rule and unchanged from the old suggester:
    `ignored_processes` (denylist substrings of process_name / window_title),
    `excluded_ranges` (annotations.json `excluded_ranges`) and
    `filter_browser_chrome` (the browser's own address bar, tabs and toolbar,
    ADR-0009). Typing bursts are coalesced before this runs (coalesce.py).

    A draft takes the name the analyst gave to a step with the same
    draft_key in this session (contract C4: `session_names`, from
    session_names() on the session's own annotations, so the names travel
    with the session folder), with `name_source: "remembered"`. Otherwise
    the default name is "<screen>: <commit label>", or "<screen>" for a step
    that did not end on a commit, with `name_source: "draft"`. (The
    remembered-names store and its `--names` flag were removed with contract
    C21; the project's activity library names runs of drafts afterwards,
    in _merge_steps.) Lane LF-PIPE: a screen whose window title carries a
    value (a customer's name) is named by the words its titles share across
    the transactions (value_free_screens), a link that opens one record or
    another by the words their names share, else "Open a record"
    (value_free_commits), and every screenshot goes to one draft
    (_attach_screenshots)."""
    remembered = dict(session_names or {})
    excluded = _parse_excluded_ranges(excluded_ranges)
    shots = _screenshot_index(events)
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
        stretch: list[dict[str, Any]] = []
        where: tuple[str, str] | None = None

        def close(end_reason: str) -> None:
            steps.append(_draft_step(list(stretch), end_reason, case_id=case_id,
                                     session_id=session_id))
            stretch.clear()

        for ev in case_events:
            data = ev["data"]
            here = (_draft_app(data), _draft_screen(data))
            if stretch and here != where:
                close(END_SCREEN_CHANGE)       # (b): exclusive
            if not stretch:
                where = here
            stretch.append(ev)
            if _is_commit(data):
                close(END_COMMIT)              # (a): inclusive
        if stretch:
            close(END_RUN_END)                 # (c)
    _name_drafts(steps, remembered)
    _attach_screenshots(steps, shots, excluded)
    return steps


def draft_summary(
    drafts: list[dict[str, Any]],
    cases: dict[str, dict[str, Any]] | None,
    interactions_by_id: dict[str, dict[str, Any]] | None,
) -> dict[str, Any]:
    """Structure-only numbers about this analyze's drafts, for stats.json
    `meta.draft_summary` (the plan's P1 probe). Counts only, never a name, a
    key or a value:
      runs              top-level runs (marker cases) in the session;
      steps_per_run     drafted steps per run, in run start order;
      out_of_run_steps  drafted steps outside any run;
      end_reason        counts per C1 end_reason;
      name_source       remembered / draft counts;
      commit_identity   how the commit interactions were identified:
                        automation_id / name / class_name / "?" counts.
    It counts the rule's own output (the drafts before the merge with the
    analyst's steps), so the numbers do not move when the analyst confirms or
    edits a run."""
    cases = cases or {}
    runs = sorted((cid for cid, c in cases.items()
                   if not (c or {}).get("parent_case_id")),
                  key=lambda cid: (parse_ts((cases[cid] or {}).get("start_ts")), cid))
    per_case = Counter(s.get("case_id") for s in drafts)
    end_reason = dict.fromkeys((END_COMMIT, END_SCREEN_CHANGE, END_RUN_END), 0)
    name_source = dict.fromkeys(("remembered", "draft"), 0)
    identity = dict.fromkeys(("automation_id", "name", "class_name", "?"), 0)
    for s in drafts:
        end_reason[s["end_reason"]] += 1
        name_source[s["name_source"]] += 1
        if s["end_reason"] == END_COMMIT:
            last_id = s["evidence"]["interaction_event_ids"][-1]
            ev = (interactions_by_id or {}).get(last_id) or {}
            identity[_commit_part(ev.get("data") or {})[1]] += 1
    return {
        "runs": len(runs),
        "steps_per_run": [per_case.get(cid, 0) for cid in runs],
        "out_of_run_steps": per_case.get(None, 0),
        "end_reason": end_reason,
        "name_source": name_source,
        "commit_identity": identity,
    }


# The step states whose names a draft with the same key takes (C4, F1): the
# analyst confirmed, renamed or added the step. A hidden step names nothing.
NAMING_STATES = ("confirmed", "edited", "manually_authored")


def session_names(annotations: dict | None) -> dict[str, str]:
    """The names the analyst gave in this session, by draft_key (contract C4,
    F1): {draft_key: name} from the session's steps in NAMING_STATES, so the
    drafts of runs 2 to N read the same on every machine: the names travel
    with the project folder.

    A name the analyst typed (a step `edited` or `manually_authored`) comes
    before a name the analyst accepted (`confirmed`, usually the drafted or
    remembered name the step had when its run was confirmed): a rename in run
    2 names the other runs' drafts even when the pattern run was confirmed
    under the drafted name, as the viewer's rename does at once. Within each,
    a step's draft_key names that key, then a merged step names each of its
    draft_keys (a single step's own name is the more specific one); among
    steps of one key the pattern run's step (annotations.pattern_run) comes
    first, then the others in time order. Blank names are skipped."""
    ann = annotations if isinstance(annotations, dict) else {}
    chosen = ann.get("pattern_run")
    pattern = chosen.get("case_id") if isinstance(chosen, dict) else None
    steps = [s for s in (ann.get("steps") or [])
             if isinstance(s, dict) and s.get("state") in NAMING_STATES]

    def order(s):
        t = _parse_ts_or_none((s.get("time_range") or {}).get("start"))
        in_pattern = pattern is not None and s.get("case_id") == pattern
        return (not in_pattern, t is None, t.timestamp() if t else 0.0)

    names: dict[str, str] = {}
    for typed in (True, False):
        single: dict[str, str] = {}
        merged: dict[str, str] = {}
        for s in sorted(steps, key=order):
            if (s.get("state") != "confirmed") != typed:
                continue
            name = s.get("name")
            name = name.strip() if isinstance(name, str) else ""
            if not name:
                continue
            dk = s.get("draft_key")
            if isinstance(dk, str) and dk:
                single.setdefault(dk, name)
                continue
            keys = s.get("draft_keys")
            if isinstance(keys, list):
                for k in keys:
                    if isinstance(k, str) and k:
                        merged.setdefault(k, name)
        for tier in (single, merged):
            for k, name in tier.items():
                names.setdefault(k, name)
    return names


def _describe_interaction(data: dict[str, Any], legacy: bool = False) -> str | None:
    """A short human phrase for one interaction ('entered "X" into Y',
    'clicked Search', 'turned Remember me on'), or None for interactions
    not worth narrating in a step summary (focus changes). Covers every
    recorder event kind; an unrecognised future kind degrades to a
    generic phrase rather than being dropped.

    A secret the recorder redacted (`value_redacted`) reads 'typed Password
    (hidden)', and a value the recorder did not record (no value at all)
    'edited Password', never 'cleared' (lane LF-PIPE). `legacy` narrates
    both as the drafting did before, 'cleared Password', so a description
    drafted then still reads as the drafting's (is_drafted_description)."""
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
        if not legacy and data.get("value_redacted") is True:
            return f"typed {field} (hidden){keys}"
        if value == MASKED_VALUE_DISPLAY:
            return f"entered a masked value into {field}{keys}"
        if value:
            return f'entered "{value}" into {field}{keys}'
        if raw or (not legacy and data.get("value") is None):
            # A junk literal ("null") or no value at all: the recorder saw
            # an edit but no readable value; don't echo the junk.
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


def _default_step_description(interactions: list[dict[str, Any]], legacy: bool = False) -> str:
    """A prose summary of what a step did, built from its interactions,
    so an auto-suggested step reads meaningfully without the analyst
    drilling into the raw events. Each interaction is framed as its own
    sentence. The name stays terse; this carries the detail. `legacy`: the
    wording before lane LF-PIPE (_describe_interaction)."""
    phrases: list[str] = []
    for ev in interactions:
        phrase = _describe_interaction(ev.get("data") or {}, legacy)
        if phrase:
            phrases.append(phrase)
    if not phrases:
        n = len(interactions)
        return f"{n} action{'' if n == 1 else 's'} with no recorded detail."
    cap = 6
    shown = phrases[:cap]
    sentences = [p[0].upper() + p[1:] + "." for p in shown]
    extra = len(phrases) - len(shown)
    if extra > 0:
        sentences.append(f"Plus {extra} more action{'' if extra == 1 else 's'}.")
    return " ".join(sentences)


# The drafting's wording before lane LUX-P for a step with nothing to narrate.
_OLD_NO_DETAIL = re.compile(r"^\d+ interactions? with no recorded detail\.$")


def is_drafted_description(description: str, interactions: list[dict[str, Any]]) -> bool:
    """True when `description` is what the drafting writes for these
    interaction events (_default_step_description, its wording before lane
    LF-PIPE, or its older wording for a step with nothing to narrate), so it
    is not the analyst's text."""
    desc = (description or "").strip()
    return (desc == _default_step_description(interactions).strip()
            or desc == _default_step_description(interactions, legacy=True).strip()
            or bool(_OLD_NO_DETAIL.match(desc)))


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
    analyst-owned (PRESERVED_STATES) step by more than
    `threshold` of the fresh step's own duration.

    A re-analyze regenerates auto steps from the raw interaction stream,
    independent of where the analyst has authored steps -- so a fresh
    auto step can land on top of a span the analyst already owns. Without
    this the analyst inherits a duplicate to notice and delete (§I37).

    A fresh step with no duration (one interaction, or several sharing one
    timestamp: common under the drafting rule, which keeps one-interaction
    steps) has no share to measure. It counts as overlapping when its instant
    lies strictly inside an analyst-owned step, or on that step's boundary
    while the analyst step also lists one of its interactions. So a hidden or
    confirmed one-interaction step is not re-drafted next to itself, while a
    draft that only touches a boundary timestamp is kept.

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
        elif fb is not None:
            f_evs = _evidence_ids(f)
            overlapped = any(_covers_instant(p, fb[0], f_evs) for p in preserved or [])
        (dropped if overlapped else kept).append(f)
    return kept, dropped


def _evidence_ids(step: dict) -> set:
    return set((step.get("evidence") or {}).get("interaction_event_ids") or [])


def _covers_instant(step: dict, t: datetime, event_ids: set) -> bool:
    """True when `step`'s time range holds instant `t` strictly inside, or on
    its boundary while the step also lists one of `event_ids`."""
    b = _step_bounds(step)
    if b is None:
        return False
    if b[0] < t < b[1]:
        return True
    return b[0] <= t <= b[1] and bool(event_ids & _evidence_ids(step))


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


# Analyst-owned step states: re-normalization keeps these steps verbatim and
# regenerates only the auto_* set. `confirmed` (contract C2) is a draft the
# analyst accepted unchanged; it is preserved exactly like `edited`.
PRESERVED_STATES = ("manually_authored", "edited", "confirmed", "hidden")


def restamp_preserved_case_ids(steps: list, cases: dict, recorded: bool = True) -> int:
    """Contract C9 (RP-01): give every preserved analyst step whose `case_id`
    is not a current case id (a legacy random id, an id from a removed run, or
    no id at all) the run that holds the step's start, or `case_id: None`
    when no run holds it. A step that runs on past the run's end still
    belongs to the run it started in (lane FX1: a step across the start of a
    run marked later stays in the run it began in). Steps whose case_id is
    current are left alone. Returns how many steps were restamped.

    `cases` is collect_cases() output. A run left open (no end marker) spans
    to the end of the recording. When nested runs both hold the step, the
    outermost wins, matching auto_suggest_steps, which files steps under the
    outermost case. Among sibling runs that both hold it (a step that starts
    on the boundary), the one that opened last wins.

    The implicit run of a session without a recording (contract C16,
    case_assignment.add_implicit_run) covers the whole session, so it
    holds every step, one without a time included. When start markers
    replace it (`recorded` False and no implicit run), a step without a time
    whose run is gone joins the first run (by start, then case id): it has no
    time to place it, and no act brings a step without a time into a
    transaction afterwards (lane FX1). In a recording, a step without a time
    whose run is gone belongs to no run.

    Contract C19: then every sub-step takes its parent's case_id, at every
    depth, whatever the parent's state (the count leaves sub-steps out)."""
    cases = cases or {}
    implicit = next((cid for cid, c in cases.items()
                     if isinstance(c, dict) and c.get("implicit")), None)
    spans = []
    for cid, c in cases.items():
        start = _parse_ts_or_none(c.get("start_ts"))
        end = _parse_ts_or_none(c.get("end_ts"))
        if start is None or (c.get("end_ts") is not None and end is None):
            continue    # a run whose span cannot be read holds nothing
        spans.append((cid, c.get("parent_case_id"), start, end))
    # The first run, for the steps without a time of a session without a
    # recording: the viewer's order of the runs (start, then case id).
    tops = sorted(((start, cid) for cid, parent, start, _end in spans if not parent),
                  key=lambda t: (t[0], str(t[1])))
    first_run = tops[0][1] if tops else None
    restamped = 0
    for s in steps or []:
        cid_now = s.get("case_id")
        if s.get("state") not in PRESERVED_STATES or (
                isinstance(cid_now, str) and cid_now in cases):
            continue
        if implicit is not None:
            restamped += 1
            s["case_id"] = implicit
            continue
        bounds = _step_bounds(s)
        if bounds is None:
            timed = _parse_ts_or_none((s.get("time_range") or {}).get("start")
                                      if isinstance(s.get("time_range"), dict) else None)
            start_at = timed
        else:
            start_at = bounds[0]
        if start_at is None:
            new_cid = None if recorded else first_run
        else:
            holding = [(cid, parent, start) for cid, parent, start, end in spans
                       if start <= start_at and (end is None or start_at <= end)]
            ids = {cid for cid, _p, _s in holding}
            outermost = [c for c in holding if c[1] not in ids]
            new_cid = max(outermost, key=lambda c: c[2])[0] if outermost else None
        if new_cid != cid_now:
            restamped += 1
        s["case_id"] = new_cid
    restamped += _follow_placement_case(steps)
    _follow_parent_case(steps)
    return restamped


def _follow_placement_case(steps: list) -> int:
    """Contract C22: a step the analyst placed after another (`placed_after`
    naming a visible step of the same list) belongs to that step's
    transaction, wherever its own time is; a chain follows the step it
    hangs from. The viewer keeps it so as it edits (steps-view.js); this
    holds it when a marker change gave the step it comes after another
    transaction. Returns how many steps changed transaction."""
    items = [s for s in steps or [] if isinstance(s, dict)]
    by_id: dict = {}
    for s in items:
        sid = s.get("step_id")
        if isinstance(sid, str) and sid and sid not in by_id:
            by_id[sid] = s
    changed = 0
    for _ in range(len(items) + 1):
        moved = False
        for s in items:
            a = s.get("placed_after")
            t = by_id.get(a) if isinstance(a, str) else None
            if t is None or t is s or t.get("state") == "hidden":
                continue
            if s.get("case_id") != t.get("case_id"):
                s["case_id"] = t.get("case_id")
                changed += 1
                moved = True
        if not moved:
            break
    return changed


def _step_process_label(step: dict) -> str:
    """The value-free grouping label stamped on a step. A step that carries a
    draft_key is its own label, whatever its state (a draft, or a draft the
    analyst confirmed, edited, renamed or hid): a drafted name is value-free
    by construction (C1), and an analyst's rename is the name chosen for every
    step with that key (C4). The rule-based strip is for names that embed case
    values; its value-tail rule would cut a window-derived screen label such as
    "Salesforce - Order: Save order" down to "Salesforce", so an edited draft
    that kept its drafted name split from its identical drafts in the step map
    and the repeat counts. A drafted sub-step's action_key (contract C19)
    counts like a draft_key: its name is value-free by construction too. A
    step without either (hand-authored, a group, pre-draft legacy) keeps the
    rule-based strip."""
    name = step.get("name")
    if (step.get("draft_key") or step.get("action_key")) and isinstance(name, str):
        return name.strip()
    return process_label(step.get("name") or "")


def _stamp_sub_steps(step: dict) -> None:
    """Contract C19: stamp process_label on every sub-step of `step`, at
    every depth, by the rule of the main level (_step_process_label), so a
    sub-process's map groups its steps as the main map does."""
    subs = step.get("sub_steps")
    for sub in subs if isinstance(subs, list) else []:
        if isinstance(sub, dict):
            sub["process_label"] = _step_process_label(sub)
            _stamp_sub_steps(sub)


def _follow_parent_case(steps: list) -> None:
    """Contract C19: every sub-step takes its parent's case_id, at every
    depth (a sub-step belongs to its parent's transaction)."""
    for step in steps or []:
        subs = step.get("sub_steps") if isinstance(step, dict) else None
        if isinstance(subs, list):
            for sub in subs:
                if isinstance(sub, dict):
                    sub["case_id"] = step.get("case_id")
            _follow_parent_case(subs)


# --- The activity library (contract C21) --------------------------------------

def library_drafts(fresh: list, kept: list, library: Any = None,
                   interactions_by_id: dict | None = None) -> list:
    """Contract C21: `kept` with each run of consecutive drafts whose
    draft_keys equal the screens of an activity of the project's `library`
    (library.Library) made one draft named from that activity
    (_library_draft); a draft no run matches is kept as it is.

    `fresh` is the C1 drafts in their order (a run's in time order) and
    `kept` the ones left once the drafts overlapping the analyst's steps
    were dropped (drop_overlapping_auto_steps). Drafts are consecutive when
    they are kept, in one run, with no dropped draft between them, so a run
    of screens never reaches across one of the analyst's steps. A screen
    repeated back to back counts once. Read left to right: at each draft the
    longest run that equals an activity's screens wins. A library without
    screens (the shipped one, or none) returns `kept` unchanged."""
    runs = getattr(library, "runs", None) or {}
    if not runs:
        return kept
    longest = max(len(r) for r in runs)
    keep = {id(d) for d in kept}
    out: list = []
    stretch: list = []

    def name_stretch() -> None:
        i = 0
        while i < len(stretch):
            size, found, screens = 0, None, []
            for j in range(i, len(stretch)):
                key = stretch[j].get("draft_key")
                if not isinstance(key, str) or not key:
                    break
                if not screens or screens[-1] != key:
                    screens.append(key)
                    if len(screens) > longest:
                        break
                if tuple(screens) in runs:
                    size, found = j - i + 1, runs[tuple(screens)]
            if found is None:
                out.append(stretch[i])
                i += 1
            else:
                out.append(_library_draft(stretch[i:i + size], library.activities[found],
                                          interactions_by_id))
                i += size
        stretch.clear()

    for d in fresh or []:
        if id(d) not in keep:
            name_stretch()               # a dropped draft ends the stretch
            continue
        if stretch and d.get("case_id") != stretch[-1].get("case_id"):
            name_stretch()
        stretch.append(d)
    name_stretch()
    return out


def _library_draft(run: list, activity: Any, interactions_by_id: dict | None) -> dict:
    """The one draft a run of drafts becomes (contract C21): named from the
    activity (`name_source: "library"`, `library_activity` its id), its
    `draft_keys` the run's screens (a repeat once, so the activity reads the
    same in every transaction) and no draft_key (it is no longer one
    draft, as after the viewer's merge), the span and the evidence of the
    run. Like any draft its description is the narration of its
    interactions (the PDD and the step pane read that as no description),
    it takes their grain keys, the waste flag of any draft of the run and
    the end_reason of the last."""
    first, last = run[0], run[-1]
    ids = [eid for d in run for eid in (d.get("evidence") or {}).get("interaction_event_ids") or []]
    shots = list(dict.fromkeys(ref for d in run
                               for ref in (d.get("evidence") or {}).get("screenshot_refs") or []))
    events = [(interactions_by_id or {}).get(eid) for eid in ids]
    if ids and all(events):
        description, grain = _default_step_description(events), step_grain_keys(events)
    else:       # without the interactions: the drafts' own narrations
        description = " ".join(str(d.get("description") or "").strip() for d in run).strip()
        grain = first.get("grain_keys")
    return {
        "step_id": str(uuid.uuid4()),
        "session_id": first.get("session_id"),
        "case_id": first.get("case_id"),
        "name": activity.name,
        "description": description,
        "time_range": {"start": first["time_range"]["start"], "end": last["time_range"]["end"]},
        "evidence": {"interaction_event_ids": ids, "screenshot_refs": shots,
                     "video_timecode_range": None, "manual_notes": ""},
        "state": "auto_suggested",
        "canonical_step_id": None,
        "flags": {"waste": any((d.get("flags") or {}).get("waste") is True for d in run)},
        "phase_id": None,
        "grain_keys": grain,
        "draft_keys": list(collapse(d["draft_key"] for d in run)),
        "name_source": "library",
        "library_activity": activity.id,
        "end_reason": last.get("end_reason"),
    }


def _repoint_links(preserved: list, drafts: list, existing: list) -> int:
    """Contract C21: a link (C17) of a kept step to a draft that a run of the
    library made part of one draft points at that draft. The link names a
    step of the previous analysis by its step_id; when no step of this one
    has that id any more and every interaction of that step is in a draft
    the library named here, the link takes that draft's id. Returns how many
    links moved."""
    named = [(d, _evidence_ids(d)) for d in drafts if d.get("name_source") == "library"]
    if not named:
        return 0
    present = {s.get("step_id") for s in list(preserved) + list(drafts)}
    before = {s.get("step_id"): _evidence_ids(s) for s in existing or [] if isinstance(s, dict)}
    moved = 0
    for step in preserved:
        links = step.get("links")
        for link in links if isinstance(links, list) else []:
            to = link.get("to") if isinstance(link, dict) else None
            target = to.strip() if isinstance(to, str) else ""
            if not target or target == "end" or target in present:
                continue
            evs = before.get(target)
            into = next((d for d, d_evs in named if evs and evs <= d_evs), None)
            if into is not None and into.get("step_id") != step.get("step_id"):
                link["to"] = into["step_id"]
                moved += 1
    return moved


def _merge_steps(existing: list, fresh: list,
                 interactions_by_id: dict | None = None,
                 library: Any = None) -> list:
    """Preserve manually_authored, edited, confirmed, and hidden steps
    (PRESERVED_STATES). Replace auto_* steps with the latest fresh
    suggestions. A `hidden` step is one the analyst
    manually suppressed -- preserving it means a re-analyze won't resurrect it
    as a fresh auto_suggested row.

    Fresh auto steps that overlap an analyst-owned (PRESERVED_STATES)
    step are dropped: the analyst already owns that span, and an overlapping
    auto step is a duplicate they would otherwise have to find and delete by
    hand (§I37). The remaining fresh steps inherit the identity of the prior
    step they re-cover, so a re-analyze keeps relationships keyed on
    `step_id`, not just rows.

    `interactions_by_id` (event_id -> interaction event) lets every step --
    auto and preserved -- get its ADR-0024 `grain_keys` recomputed from its
    evidence, so the view-time grain roll-up has the containment keys even on
    manual steps. Optional: absent it, only
    steps that already carry `grain_keys` (the drafts, stamped in _draft_step)
    keep them, and the viewer resolves the rest at view time.

    Contract C17: a draft the analyst set the flow on (`only_when`, `links`)
    is theirs; the viewer marks it `edited`, and so does this merge when it
    finds one still `auto_suggested`, so a re-analysis never drafts the flow
    away. Every preserved step keeps both keys as they are.

    Contract C22: so is a draft the analyst placed elsewhere in the process
    (it carries `placed_after`), kept as `edited` by the same rule, and
    (contract C25) a draft given an `automation` or a `done_by`.

    Contract C19: a draft opened as a sub-process (it carries `sub_steps`,
    even an empty list) is the analyst's too, kept as `edited` by the same
    rule. A preserved step keeps its sub-steps as they are; each sub-step,
    at every depth, gets its process_label here (the main level's rule) and
    its parent's case_id in restamp_preserved_case_ids. The merge reads no
    sub-step otherwise: the main level stays what the statistics and the
    analysis see.

    Contract C21: once the overlapping drafts are dropped, each run of
    consecutive drafts whose screens an activity of the project's `library`
    lists becomes one draft named from it (library_drafts). That happens
    before the drafts inherit their identities, so the named draft keeps its
    step_id from one analysis to the next; a kept step's link to a draft the
    run took in then points at the named draft (_repoint_links). An empty
    library changes nothing."""
    from step_flow import declares_flow   # step_flow reads step_context, which imports this module
    from step_context import declares_place, declares_scope
    by_state = {st: [] for st in PRESERVED_STATES}
    for s in existing or []:
        st = s.get("state")
        if st not in by_state and (declares_flow(s) or declares_place(s) or declares_scope(s)
                                   or isinstance(s.get("sub_steps"), list)):
            s["state"] = st = "edited"
        if st in by_state:
            by_state[st].append(s)
    preserved = [s for st in PRESERVED_STATES for s in by_state[st]]
    kept, dropped = drop_overlapping_auto_steps(fresh or [], preserved)
    if dropped:
        print(f"[normalize] dropped {len(dropped)} auto step(s) "
              f"overlapping analyst-owned steps")
    kept = library_drafts(fresh or [], kept, library, interactions_by_id)
    named = sum(1 for d in kept if d.get("name_source") == "library")
    if named:
        print(f"[normalize] library: {named} draft(s) named from its activities")
    kept = _inherit_step_identity(kept, existing or [], preserved)
    moved = _repoint_links(preserved, kept, existing or [])
    if moved:
        print(f"[normalize] library: {moved} link(s) now point at the draft "
              f"their target became part of")
    result = preserved + kept
    # Stamp a value-free process_label for the step-level maps (recomputed
    # every analyze, so it tracks analyst renames).
    for s in result:
        s["process_label"] = _step_process_label(s)
        _stamp_sub_steps(s)
        # ADR-0024: (re)resolve the grain-roll-up containment keys. Drafts
        # already carry them (_draft_step); preserved steps get them here when
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
# the screen-grain key and the drafted step's screen strip embedded record
# tokens (and the browser's name) identically, no hand-synced regex to drift. Applied IN ORDER,
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
    (the JS `screenType` twin). Used for the drafted step's screen (_draft_screen)
    so the SAME step type collapses across cases instead of fanning out per
    record ('Create INC0010010 | Incident | ServiceNow' -> 'Create | Incident |
    ServiceNow'). Never blanks an all-value string."""
    s = (name or "").strip()
    if not s:
        return s
    for rx, repl in _SCREEN_RULES:
        s = rx.sub(repl, s)
    s = _SCREEN_END_TRIM.sub("", s).strip()
    return s or (name or "").strip()


def _value_free(text: str) -> str:
    """`text` with the shared screen-label value rules applied (the rules and
    the end trim of screen_label), or "" when nothing but values remains.
    screen_label never blanks, it falls back to the raw text; a commit
    control's identity or label must not (C1 draft_key, draft name), so this
    is the one local rule on top of the shared ones: an all-value string
    blanks, and the caller moves on to its next rung."""
    s = (text or "").strip()
    for rx, repl in _SCREEN_RULES:
        s = rx.sub(repl, s)
    return _SCREEN_END_TRIM.sub("", s).strip()


def step_identity(step: dict) -> str:
    """What makes two steps the same step, whatever they are called: the
    step's value-free draft_key ("draft:" and the key); for merged drafts,
    their draft_keys in order ("merge:" and a JSON array); else, for a step
    with no draft identity (added by hand), the process_label of its name
    ("label:"). The alignment key of the differences between runs
    (pdd_export._align_key, viewer/run-differences.js, pinned by
    shared/run-differences-golden.json), and the grouping key of the repeats
    and the automation groupings, so their counts do not move with names."""
    step = step if isinstance(step, dict) else {}
    dk = step.get("draft_key")
    if isinstance(dk, str) and dk:
        return "draft:" + dk
    keys = step.get("draft_keys")
    if (isinstance(keys, list) and keys
            and all(isinstance(k, str) and k for k in keys)):
        return "merge:" + json.dumps(keys, ensure_ascii=False, separators=(",", ":"))
    return "label:" + process_label(str(step.get("name") or ""))


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
