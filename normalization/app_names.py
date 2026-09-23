"""Readable application names for the deliverable (deliverable audit gap 3).

The recorder names an application by its executable ("SAPGUI.exe",
"chrome.exe", "EXCEL.EXE"): a machine token, not a name a business reader
uses. `build_app_names` gives every executable of a recording the most
specific readable name the recording itself supports, in this order:

  1. the name of a loaded app vocabulary whose scope is that executable
     ("SAP GUI", "Microsoft Excel");
  2. a recorded window-title segment that names the executable as a word
     ("Excel" in "Book1 - Excel", "Notepad" in "Untitled - Notepad");
  3. the executable name without its extension, capitalized ("Sapgui").

It never invents a product name: every result is a vocabulary name, a piece
of a recorded window title, or the executable name itself. The platform
recognition labels (shared/recognition-patterns.json) name control types,
not applications, so they are not a source.

The pipeline stores the map as stats.json `meta.app_names`; the findings
claims, the findings fact strip and the PDD read it through `display_name`.

Pure stdlib.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

# The separators an application puts between a document and its own name in
# a window title: a spaced hyphen, pipe, en dash or em dash (U+2013, U+2014,
# built with chr() so this source holds no dash characters), or "::".
_TITLE_SPLIT = re.compile(r"\s+(?:[-|" + chr(0x2013) + chr(0x2014) + r"]|::)\s+")

# An executable name shorter than this is too generic to find in a title.
_MIN_KEY_LEN = 3


def app_key(app: Any) -> str:
    """The comparison key of an executable token: lowercased, ".exe" stripped."""
    s = str(app or "").strip().lower()
    return s[:-4] if s.endswith(".exe") else s


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
    return {app: (vocab_names.get(key) or _title_name(key, titles[key])
                  or fallback_name(app))
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
    return fallback_name(app)
