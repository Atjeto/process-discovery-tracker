"""Hand-off versions (contract C20): what every PDD and every Technical
details workbook says about its version.

The analyst hands a project to the developers as numbered versions (the
viewer's Export, Hand off...). Each hand-off adds one entry to
annotations.handoffs,

    {"version": 2, "handed_off_at": "2026-09-25T10:14:03.120Z",
     "by": "rasha", "note": "The credit check added"}

and the viewer then writes "<project> v2.zip" with the PDD and the Technical
details made for that version (normalize.py --handoff 2). Every document
says which version it is, in one line:

    Version 2, handed off 2026-09-25 by rasha      made for hand-off 2
    Working copy after version 2                   exported between hand-offs
    Working copy, not handed off yet               before the first hand-off

The date is the UTC date of `handed_off_at`, the words the viewer's read-only
line prints before " · Read only" (viewer/handoff.js handedOffLine). Pure
stdlib: the PDD and the workbook read it alike.
"""

from __future__ import annotations

import re
from typing import Any

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")

NOT_HANDED_OFF = "Working copy, not handed off yet"


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _version(value: Any) -> int | None:
    """A version number: a positive integer (never a bool)."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        return None
    return value


def handoff_entries(annotations: dict | None) -> list[dict]:
    """The valid entries of annotations.handoffs ({version, handed_off_at,
    by, note}, each text stripped), in version order. An entry without a
    positive integer version is left out; of two entries with one version
    (an older file edited by hand), the later one in the list counts."""
    raw = (annotations or {}).get("handoffs") if isinstance(annotations, dict) else None
    by_version: dict[int, dict] = {}
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        version = _version(entry.get("version"))
        if version is None:
            continue
        by_version[version] = {
            "version": version,
            "handed_off_at": _text(entry.get("handed_off_at")),
            "by": _text(entry.get("by")),
            "note": _text(entry.get("note")),
        }
    return [by_version[v] for v in sorted(by_version)]


def entry_date(entry: dict) -> str:
    """The date an entry was handed off: the UTC date of `handed_off_at`
    ("2026-09-25"), or "" when it is not an ISO time."""
    at = _text(entry.get("handed_off_at")) if isinstance(entry, dict) else ""
    return at[:10] if _DATE.match(at) else ""


def handed_off_line(entry: dict) -> str:
    """"Version 2, handed off 2026-09-25 by rasha": the date and the name
    left out when the entry has none."""
    line = f"Version {entry['version']}"
    date = entry_date(entry)
    by = _text(entry.get("by"))
    if date:
        line += f", handed off {date}"
    elif by:
        line += ", handed off"
    if by:
        line += f" by {by}"
    return line


def version_line(annotations: dict | None, handoff: int | None = None) -> str:
    """The one line on a document's version: made for hand-off `handoff`
    (its entry must be in annotations.handoffs), else a working copy after
    the latest version, else a working copy not handed off yet."""
    entries = handoff_entries(annotations)
    wanted = _version(handoff)
    if wanted is not None:
        for entry in entries:
            if entry["version"] == wanted:
                return handed_off_line(entry)
    if entries:
        return f"Working copy after version {entries[-1]['version']}"
    return NOT_HANDED_OFF


HISTORY_HEADER = ("Version", "Date", "By", "What changed")


def history_rows(annotations: dict | None) -> list[list[str]]:
    """The version history table's rows (HISTORY_HEADER), oldest first."""
    return [[str(e["version"]), entry_date(e), e["by"], e["note"]]
            for e in handoff_entries(annotations)]
