"""What the recorder saw that the user did not do (lane LF-PIPE).

The recorder reports what UI Automation raises, and a real recording holds
more than the user's own actions: a web page renders its empty fields, a
dropdown reports one choice twice, the Office ribbon mirrors the selected
cell, the desktop behind the windows reports a selection, Excel opens its
formula list while a formula is typed. This stage runs on the derived event
stream right after the typing bursts are coalesced (pipeline stage 1a),
before the transactions are found and the steps drafted, so the drafts, the
fields the PDD and the Technical details list and the statistics read the
user's actions only. The raw events.jsonl is never changed.

An interaction is left out when (its reason in the report):

  no_identity    a click, choice or toggle with no automation id, name or
                 class name: it says nothing, and a web click that lost its
                 identity lost it because its page had already gone;
  empty_value    a value made only of U+FFFC (the object character Chrome
                 reads from an empty input) and whitespace: an empty field
                 is not a typed value. A value the recorder did not record
                 (no value at all: a secret) is not empty;
  office_ribbon  a change on the Office ribbon (a NetUI class) that mirrors
                 the selection: one within 1 s of a change of its program
                 outside the ribbon (a cell, a field; before or after it, as
                 a typed value is written a moment after its keys), with no
                 click on that control just before it; and any value on a
                 ribbon button or slider (the zoom saying 100 as another
                 document comes to the front). A ribbon change with nothing
                 else of its program around it is the user's own click or key
                 (Word's Bold, Ctrl+B, the Font Size typed), which the
                 recording holds no event for, and stays, as do the
                 ribbon's clicks;
  desktop        a choice on the desktop (explorer.exe, "Program Manager")
                 that no click on that item caused;
  popup          a choice in a window without a title: a transient list
                 (Excel's formula AutoComplete, a dropdown's own list);
  repeat         a second event on the same element within 50 ms: one
                 action reported twice (a radio button's toggle, click and
                 choice; a doubled click);
  render         a change in a burst (changes each within 50 ms of the one
                 before) at or after an empty field: the screen rendering;
  reaction       a change within 50 ms after the user's change on another
                 element: the user changes one element at a time, so it is
                 the screen reacting to the first;
  after_click    a choice or toggle within 150 ms after a click on another
                 element: the screen that click opened, setting its defaults;
  dropdown_echo  a list item's choice that repeats the value its dropdown
                 got within 1 s: one choice, whose field is the dropdown;
  repeat_choice  the same choice as the interaction before it in its
                 program, within 1 s;
  navigation     an address-bar value followed by another within 3 s: a
                 typed address and the page it opened are one navigation.

An interaction without a window title or a program gets them (a click that
changes the page loses both, and Excel's pasted cell arrives without them):
a title names its program (the program the recording's other interactions
with that title were in); else both come from the interaction before it in
the same transaction (the title from the last one in its program), or, for
the first ones of a transaction, from the one after them.

Pure stdlib.
"""

from __future__ import annotations

import re
from typing import Any

from _dt import parse_ts_or_none as _parse_ts
from recognition import is_browser_chrome

# U+FFFC, the object replacement character Chrome's text reads from an input.
OBJECT_CHAR = "\ufffc"

_SAME_ACTION_MS = 50      # repeat, render, reaction
_AFTER_CLICK_MS = 150     # after_click
_ECHO_MS = 1000           # dropdown_echo, repeat_choice, office_ribbon
_NAVIGATION_MS = 3000     # navigation

# The ribbon's fields a user types or picks a value into (Font, Font Size);
# a value on any other ribbon control is the state it shows.
_RIBBON_FIELDS = ("Edit", "ComboBox")

_CHANGES = ("value_changed", "selection_changed", "toggle_changed")
_CLICK_KINDS = ("invoked", "selection_changed", "toggle_changed")
# The kinds the rules read. The verbose mode's focus and text events (and a
# kind a later recorder adds) pass through untouched and are never "the
# interaction before".
_ACTIONS = ("invoked",) + _CHANGES

# The reasons, in the order the rules are tried and the report lists them.
REASONS = ("no_identity", "empty_value", "office_ribbon", "desktop", "popup", "repeat",
           "render", "reaction", "after_click", "dropdown_echo", "repeat_choice",
           "navigation")


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def is_blank_value(value: Any) -> bool:
    """True for a value that is a string made only of U+FFFC and whitespace:
    an empty field, not a typed value. False for a missing value (None)."""
    return isinstance(value, str) and not value.replace(OBJECT_CHAR, "").strip()


def _program(data: dict) -> str:
    p = _text(data.get("process_name")).lower()
    return p[:-4] if p.endswith(".exe") else p


def _identity(data: dict) -> str:
    return (_text(data.get("automation_id")) or _text(data.get("name"))
            or _text(data.get("class_name")))


def _element(data: dict) -> tuple[str, str, str]:
    return (_program(data), _text(data.get("control_type")), _identity(data))


def _same_program(a: dict, b: dict) -> bool:
    """True unless both name a program and the programs differ."""
    pa, pb = _program(a), _program(b)
    return not pa or not pb or pa == pb


def _ms(a, b) -> float | None:
    if a is None or b is None:
        return None
    return (b - a).total_seconds() * 1000.0


# A time with a fraction of a second. The recorder stamps milliseconds; a
# log without them (a hand-made demo) cannot tell 50 ms from a second, so
# the rules measured in milliseconds leave its events alone.
_FRACTION = re.compile(r":\d{2}\.\d")


def _time(ev: dict):
    """The event's time, or None when it has no fraction of a second."""
    ts = ev.get("timestamp")
    return _parse_ts(ts) if isinstance(ts, str) and _FRACTION.search(ts) else None


def _empty(data: dict) -> bool:
    return (data.get("kind") == "value_changed" and data.get("value_redacted") is not True
            and is_blank_value(data.get("value")))


def _ribbon(data: dict) -> bool:
    """True for the Office ribbon and status bar (a NetUI class)."""
    return _text(data.get("class_name")).startswith("NetUI")


def _is_address_bar(data: dict) -> bool:
    return data.get("kind") == "value_changed" and is_browser_chrome(data)


def _desktop(data: dict) -> bool:
    """True for the desktop: explorer.exe's "Program Manager" window (or
    its window without a title), or the Progman and WorkerW classes."""
    return _program(data) == "explorer" and (
        _text(data.get("window_title")).lower() in ("program manager", "")
        or _text(data.get("class_name")) in ("Progman", "WorkerW"))


def _fill_windows(events: list[dict]) -> dict[int, dict]:
    """{event index: the window title and program an interaction lacks}. A
    title names its program: an interaction with a title and no program
    takes the program the recording's other interactions with that title
    were in. Otherwise both come from the interaction before it in the same
    transaction (a marker starts a new one): the program from the last
    interaction, the title from the last one in the same program; for the
    first interactions of a transaction, from the one after them."""
    inter = [(i, ev["data"]) for i, ev in enumerate(events)
             if ev.get("type") in ("interaction", "marker") and isinstance(ev.get("data"), dict)]
    program_of: dict[str, str] = {}
    for _i, data in inter:
        if _text(data.get("process_name")) and _text(data.get("window_title")):
            program_of.setdefault(_text(data.get("window_title")), _text(data.get("process_name")))
    filled: dict[int, dict] = {}

    def fill(order) -> None:
        titles: dict[str, str] = {}
        last_program = ""
        for i, data in order:
            if events[i].get("type") == "marker":
                titles, last_program = {}, ""
                continue
            got = {**data, **filled.get(i, {})}
            program = _text(got.get("process_name"))
            title = _text(got.get("window_title"))
            add: dict[str, str] = {}
            if not program and (program_of.get(title) or last_program):
                program = add["process_name"] = program_of.get(title) or last_program
            key = program.lower()
            if not title and titles.get(key):
                title = add["window_title"] = titles[key]
            if add:
                filled[i] = {**filled.get(i, {}), **add}
            if program:
                last_program = program
                if title:
                    titles[key] = title

    fill(inter)                  # from the interaction before
    fill(list(reversed(inter)))  # what is still missing, from the one after
    return filled


def clean_recorder_noise(events: list[dict[str, Any]] | None
                         ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """(events, report): `events` without the interactions the user did not
    make (the rules in the module docstring) and with the window title and
    program an interaction lacks filled in; the input is not changed.
    report: {"dropped": {reason: count}, "filled": count}."""
    events = list(events or [])
    filled = _fill_windows(events)
    idx = [i for i, ev in enumerate(events) if ev.get("type") == "interaction"
           and isinstance(ev.get("data"), dict) and ev["data"].get("kind") in _ACTIONS]
    # What the rules read: the data with the window filled in; the popup rule
    # reads the title as recorded.
    datas = {i: {**events[i]["data"], **filled.get(i, {})} for i in idx}
    times = {i: _time(events[i]) for i in idx}

    # render: in a burst of changes (each within 50 ms of the one before, in
    # one program), the changes from its first empty field on. A change
    # before it can be the user's (the field typed, then the screen clearing
    # another one).
    render: set[int] = set()
    burst: list[int] = []

    def close_burst() -> None:
        first = next((k for k, j in enumerate(burst) if _empty(datas[j])), None)
        if first is not None:
            render.update(burst[first:])
        burst.clear()

    for i in idx:
        if datas[i].get("kind") not in _CHANGES:
            continue
        if burst:
            gap = _ms(times[burst[-1]], times[i])
            if gap is None or gap > _SAME_ACTION_MS or not _same_program(datas[burst[-1]], datas[i]):
                close_burst()
        burst.append(i)
    close_burst()

    reasons: dict[int, str] = {}
    prev: int | None = None           # the interaction before, any
    prev_in: dict[str, int] = {}      # the interaction before, per program
    on_element: dict[tuple, int] = {}  # the last interaction on each element
    last_kept_change: int | None = None
    last_click: int | None = None
    for n, i in enumerate(idx):
        d, t = datas[i], times[i]
        kind = d.get("kind")
        program = _program(d)
        element = _element(d)
        before = prev_in.get(program) if program else prev
        same = on_element.get(element)
        reason = None
        if kind in _CLICK_KINDS and not _identity(d):
            reason = "no_identity"
        elif _empty(d):
            reason = "empty_value"
        elif kind in _CHANGES and _ribbon(d) and _ribbon_echo(idx, n, datas, times):
            reason = "office_ribbon"
        elif (kind == "selection_changed" and _desktop(d)
              and not (last_click is not None and _element(datas[last_click]) == _element(d)
                       and (_ms(times[last_click], t) or 0) <= _ECHO_MS)):
            reason = "desktop"
        elif kind == "selection_changed" and not _text(events[i]["data"].get("window_title")):
            reason = "popup"
        elif (same is not None and _identity(d)
              and (gap := _ms(times[same], t)) is not None and gap <= _SAME_ACTION_MS):
            reason = "repeat"
        elif i in render:
            reason = "render"
        elif (kind in _CHANGES and last_kept_change is not None
              and _same_program(datas[last_kept_change], d)
              and _element(datas[last_kept_change]) != _element(d)
              and (gap := _ms(times[last_kept_change], t)) is not None
              and 0 <= gap <= _SAME_ACTION_MS):
            reason = "reaction"
        elif (kind in ("selection_changed", "toggle_changed") and last_click is not None
              and _element(datas[last_click]) != _element(d)
              and (gap := _ms(times[last_click], t)) is not None
              and 0 <= gap <= _AFTER_CLICK_MS):
            reason = "after_click"
        elif kind == "selection_changed" and _dropdown_echo(idx, n, datas, times):
            reason = "dropdown_echo"
        elif (kind == "selection_changed" and before is not None
              and datas[before].get("kind") == "selection_changed"
              and _text(datas[before].get("selected_value")) == _text(d.get("selected_value"))
              and (gap := _ms(times[before], t)) is not None and gap <= _ECHO_MS):
            reason = "repeat_choice"
        elif _is_address_bar(d) and _next_address_bar(idx, n, datas, times):
            reason = "navigation"
        if reason:
            reasons[i] = reason
        elif kind in _CHANGES:
            last_kept_change = i
        if kind == "invoked":
            last_click = i
        prev = i
        on_element[element] = i
        if program:
            prev_in[program] = i

    dropped = {r: 0 for r in REASONS}
    for r in reasons.values():
        dropped[r] += 1
    out: list[dict[str, Any]] = []
    for i, ev in enumerate(events):
        if i in reasons:
            continue
        if i in filled:
            ev = {**ev, "data": {**ev["data"], **filled[i]}}
        out.append(ev)
    kept_filled = sum(1 for i in filled if i not in reasons)
    return out, {"dropped": {r: c for r, c in dropped.items() if c},
                 "dropped_total": len(reasons), "filled": kept_filled}


def _near(idx: list[int], n: int, times: dict, within_ms: float):
    """The positions of idx before and after n whose time is within
    `within_ms` of idx[n]'s, nearest first on each side (the stream is in
    time order)."""
    t = times[idx[n]]
    for step in (-1, 1):
        m = n + step
        while 0 <= m < len(idx):
            gap = _ms(t, times[idx[m]])
            if gap is None or abs(gap) > within_ms:
                break
            yield m
            m += step


def _ribbon_echo(idx: list[int], n: int, datas: dict, times: dict) -> bool:
    """True when the ribbon change at idx[n] mirrors the selection: a value
    on a ribbon button or slider, or a change with another change of its
    program outside the ribbon within 1 s before or after it and no click on
    the same control within 1 s before it."""
    d = datas[idx[n]]
    if d.get("kind") == "value_changed" and _text(d.get("control_type")) not in _RIBBON_FIELDS:
        return True
    echoed = clicked = False
    for m in _near(idx, n, times, _ECHO_MS):
        o = datas[idx[m]]
        if _program(o) != _program(d):
            continue
        if m < n and o.get("kind") == "invoked" and _element(o) == _element(d):
            clicked = True
        elif o.get("kind") in _CHANGES and not _ribbon(o):
            echoed = True
    return echoed and not clicked


def _dropdown_echo(idx: list[int], n: int, datas: dict, times: dict) -> bool:
    """True when the list item's choice at idx[n] repeats the value a dropdown
    (ComboBox) of the same program got within 1 s before or after it."""
    d = datas[idx[n]]
    if _text(d.get("control_type")) != "ListItem":
        return False
    value = _text(d.get("selected_value")) or _text(d.get("name"))
    if not value:
        return False
    for m in _near(idx, n, times, _ECHO_MS):
        o = datas[idx[m]]
        if (o.get("kind") == "value_changed" and _text(o.get("control_type")) == "ComboBox"
                and _same_program(o, d) and _text(o.get("value")) == value):
            return True
    return False


def _next_address_bar(idx: list[int], n: int, datas: dict, times: dict) -> bool:
    """True when the next interaction of the same program, within 3 s, is an
    address-bar value: the one at idx[n] was an address on the way."""
    d = datas[idx[n]]
    for m in _near(idx, n, times, _NAVIGATION_MS):
        if m < n:
            continue
        o = datas[idx[m]]
        if _program(o) == _program(d):
            return _is_address_bar(o)
    return False
