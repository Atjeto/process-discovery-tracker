"""Readable application names and business system names (deliverable
audit gap 3; one vocabulary of systems, AD-28).

The recorder names an application by its executable ("SAPGUI.exe",
"chrome.exe", "EXCEL.EXE"): a machine token, not a name a business reader
uses. The known systems are named by shared/system-names.json, the one list
the viewer reads too: ordered rules from an application (and, for a
browser, the window title) to the system's name ("SAP", "Excel",
"Salesforce" for a Chrome window on Salesforce).

`build_app_names` gives every executable of a recording its readable name,
in this order:

  1. the system-names rule for that application alone (a rule without a
     title: "SAPGUI.exe" is "SAP", "chrome.exe" is "Google Chrome");
  2. the name of a loaded app vocabulary whose scope is that executable;
  3. a recorded window-title segment that names the executable as a word
     ("Excel" in "Book1 - Excel", "Notepad" in "Untitled - Notepad");
  4. the executable name without its extension, capitalized ("Erpclient").

`system_name` names the system one application and window title belong to:
the first system-names rule that matches both, else the application's
readable name. A browser is only where a web system ran: a browser window on
a site no rule names is named by the site its title ends with (the rule with
`site`, site_name), "Order Desk" for "Customer lookup - Order Desk - Google
Chrome", and by the browser only when the title names no site.

It never invents a product name: every result is a listed system name, a
vocabulary name, a piece of a recorded window title, or the executable name
itself. The platform recognition labels (shared/recognition-patterns.json)
name control types, not applications, so they are not a source.

The pipeline stores the per-application map as stats.json `meta.app_names`;
the capture detail (capture_detail.py) and the PDD read it through
`display_name` and `system_name`.

Pure stdlib.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

# The separators an application puts between a document and its own name in
# a window title: a spaced hyphen, pipe, en dash or em dash (U+2013, U+2014,
# built with chr() so this source holds no dash characters), or "::".
_TITLE_SPLIT = re.compile(r"\s+(?:[-|" + chr(0x2013) + chr(0x2014) + r"]|::)\s+")

# An executable name shorter than this is too generic to find in a title.
_MIN_KEY_LEN = 3


def app_key(app: Any) -> str:
    """The comparison key of an executable token: lowercased, ".exe"
    stripped. A program's own name as Windows gives it, which the capture
    app records for the window in front ("Google Chrome"), is the key of
    its executable ("chrome": system-names.json `program_names`, 2.0.1)."""
    s = str(app or "").strip().lower()
    s = s[:-4] if s.endswith(".exe") else s
    return _PROGRAM_NAMES.get(" ".join(s.replace("\u200b", "").split()), s)


# The one vocabulary of systems, shared with the viewer.
_SYSTEMS_PATH = Path(__file__).resolve().parent.parent / "shared" / "system-names.json"


def _load_program_names(path: Path = _SYSTEMS_PATH) -> dict[str, str]:
    """system-names.json `program_names`: {a program's name as Windows gives
    it, lowercased, zero-width spaces taken out: its application key}."""
    with open(path, encoding="utf-8") as fh:
        names = json.load(fh).get("program_names")
    if not isinstance(names, dict):
        return {}
    return {" ".join(k.replace("\u200b", "").split()).lower(): v.strip().lower()
            for k, v in names.items()
            if isinstance(k, str) and isinstance(v, str) and k.strip() and v.strip()
            and not k.startswith("_")}


_PROGRAM_NAMES = _load_program_names()


def _load_system_rules(path: Path = _SYSTEMS_PATH) -> list[tuple[frozenset, Any, str, Any]]:
    """The system-names rules, in order: (application keys, compiled title
    pattern or None, system name, None) for a named rule, and (application
    keys, None, "", the names to drop) for a site rule (`site`: true, 2.0.1,
    site_name). A rule without applications, a named rule without a name,
    or one with a pattern that does not compile, is skipped."""
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    rules = []
    for r in doc.get("rules") or []:
        if not isinstance(r, dict):
            continue
        procs = r.get("process")
        procs = [procs] if isinstance(procs, str) else procs
        keys = frozenset(app_key(p) for p in procs or [] if isinstance(p, str) and p.strip())
        if keys and r.get("site") is True:
            drop = r.get("drop") if isinstance(r.get("drop"), list) else []
            rules.append((keys, None, "", frozenset(_plain(d).lower() for d in drop
                                                     if isinstance(d, str) and d.strip())))
            continue
        system = r.get("system")
        title = r.get("title")
        try:
            rx = re.compile(title, re.IGNORECASE) if isinstance(title, str) and title else None
        except re.error:
            continue
        if keys and isinstance(system, str) and system.strip():
            rules.append((keys, rx, system.strip(), None))
    return rules


# An ending a browser puts on a window's title when it holds several tabs
# ("Order Desk and 3 more pages").
_MORE_PAGES = re.compile(r"\s+and\s+\d+\s+more\s+pages?$", re.IGNORECASE)


def _plain(text: str) -> str:
    """`text` without zero-width spaces (Edge writes "Microsoft\u200b Edge"),
    its whitespace collapsed."""
    return " ".join(str(text).replace("\u200b", "").split())


def site_name(title: Any, drop: Any = ()) -> str:
    """The web system a browser window's title names (2.0.1): its last
    segment once a last segment naming the browser (`drop`, lowercase) is
    dropped, an ending "and N more pages" cut, when at least two segments
    are left and the shared value rules leave the segment as it is; else
    "". "Order Desk" for "Customer lookup - Order Desk - Google Chrome";
    "" for "New Tab - Google Chrome" (a page, not a site)."""
    from step_suggest import _value_free   # step_suggest imports this module
    if not isinstance(title, str):
        return ""
    segs = [_plain(s) for s in _TITLE_SPLIT.split(title.strip())]
    segs = [s for s in segs if s]
    while segs and segs[-1].lower() in drop:
        segs.pop()
    if len(segs) < 2:
        return ""
    site = _MORE_PAGES.sub("", segs[-1]).strip()
    if not site or not re.search(r"[A-Za-z]", site) or _value_free(site) != site:
        return ""
    return site


def fallback_name(app: Any) -> str:
    """The executable name without its extension, capitalized when it is a
    machine token ("EXCEL.EXE" -> "Excel", "sapgui.exe" -> "Sapgui"). A token
    in mixed case ("Google Chrome") is already a name and is kept."""
    s = str(app or "").strip()
    if s.lower().endswith(".exe"):
        s = s[:-4]
    return s.capitalize() if (s.isupper() or s.islower()) else s


def _title_name(key: str, titles: list[str]) -> str:
    """The window-title segment that names the executable as a whole word,
    the most frequent one across the app's titles (ties: the shorter)."""
    if len(key) < _MIN_KEY_LEN:
        return ""
    word = re.compile(r"\b" + re.escape(key) + r"\b")
    counts: Counter[str] = Counter()
    for title in titles:
        for seg in _TITLE_SPLIT.split(title.strip()):
            seg = seg.strip()
            if seg and word.search(seg.lower()):
                counts[seg] += 1
    if not counts:
        return ""
    return min(counts, key=lambda seg: (-counts[seg], len(seg), seg))


def _application_rule(key: str) -> str:
    """The system name a rule without a title gives this application, or ""."""
    for keys, rx, system, site in _SYSTEM_RULES:
        if rx is None and site is None and key in keys:
            return system
    return ""


def build_app_names(events: list[dict[str, Any]] | None,
                    vocabs: list[dict[str, Any]] | None = None) -> dict[str, str]:
    """{executable as recorded: readable name} for every application in the
    recording (interaction `process_name`, activity `app`)."""
    vocab_names: dict[str, str] = {}
    for v in vocabs or []:
        scope = v.get("scope") if isinstance(v, dict) else None
        proc = scope.get("process_name") if isinstance(scope, dict) else None
        name = v.get("name") if isinstance(v, dict) else None
        if isinstance(proc, str) and proc.strip() and isinstance(name, str) and name.strip():
            vocab_names.setdefault(app_key(proc), name.strip())

    apps: dict[str, str] = {}
    titles: dict[str, list[str]] = defaultdict(list)
    for ev in events or []:
        data = ev.get("data") if isinstance(ev, dict) else None
        if not isinstance(data, dict):
            continue
        if ev.get("type") == "interaction":
            app, title = data.get("process_name"), data.get("window_title")
        elif ev.get("type") == "activity":
            app, title = data.get("app"), data.get("title")
        else:
            continue
        if not isinstance(app, str) or not app.strip():
            continue
        key = apps.setdefault(app.strip(), app_key(app))
        if isinstance(title, str) and title.strip():
            titles[key].append(title)
    return {app: (_application_rule(key) or vocab_names.get(key)
                  or _title_name(key, titles[key]) or fallback_name(app))
            for app, key in apps.items()}


def display_name(app: Any, names: dict[str, str] | None = None) -> str:
    """The readable name of one executable token (with or without ".exe",
    any case), from a `build_app_names` map; the capitalized executable name
    when the map does not know it."""
    if not isinstance(app, str) or not app.strip():
        return ""
    names = names if isinstance(names, dict) else {}
    hit = names.get(app.strip())
    if isinstance(hit, str) and hit.strip():
        return hit
    key = app_key(app)
    for raw, name in names.items():
        if app_key(raw) == key and isinstance(name, str) and name.strip():
            return name
    return _application_rule(key) or fallback_name(app)


def system_name(app: Any, title: Any = "", names: dict[str, str] | None = None) -> str:
    """The business system one application and window title belong to: the
    first shared/system-names.json rule whose applications include `app`
    and whose title pattern (when it has one) matches `title`, a site rule
    naming the site the title ends with (site_name); else the application's
    readable name (display_name). "" for no application."""
    if not isinstance(app, str) or not app.strip():
        return ""
    key = app_key(app)
    text = title if isinstance(title, str) else ""
    for keys, rx, system, site in _SYSTEM_RULES:
        if key not in keys:
            continue
        if site is not None:
            found = site_name(text, site)
            if found:
                return found
            continue
        if rx is None or rx.search(text):
            return system
    return display_name(app, names)


_SYSTEM_RULES = _load_system_rules()
