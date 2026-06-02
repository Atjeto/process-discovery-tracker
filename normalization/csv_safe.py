"""Spreadsheet formula-injection neutralization for CSV exports.

A CSV cell whose text begins with ``=``, ``+``, ``-``, ``@``, TAB or CR is
interpreted as a *formula* by Excel / LibreOffice / Google Sheets when the file
is opened -- so an untrusted window title, control name, or case value such as
``=HYPERLINK("http://evil","click")`` or ``=cmd|'/c calc'!A1`` becomes live
content in the analyst's spreadsheet (data exfiltration / command execution via
DDE). The session's raw strings come from third-party apps, so every string
cell we write is untrusted.

The OWASP-standard mitigation: prefix any such cell with a single quote so the
spreadsheet shows it literally. We do NOT modify non-string cells (numbers,
bools, None) and we leave already-safe strings untouched, so the CSV still
round-trips for non-spreadsheet consumers (the leading quote is the only
change, and only on cells that would otherwise be a formula).

stdlib-only so it runs under the bundled embeddable and a bare test Python.
"""

from __future__ import annotations

from typing import Any

# Leading characters that make a spreadsheet treat the cell as a formula.
_FORMULA_LEADERS = ("=", "+", "-", "@", "\t", "\r")


def sanitize_cell(value: Any) -> Any:
    """Return ``value`` unchanged unless it is a string that would be parsed as
    a spreadsheet formula, in which case prefix it with a single quote."""
    if isinstance(value, str) and value[:1] in _FORMULA_LEADERS:
        return "'" + value
    return value


def sanitize_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Apply :func:`sanitize_cell` to every value of every row dict, returning a
    new list of new dicts (the input is not mutated)."""
    return [{k: sanitize_cell(v) for k, v in row.items()} for row in rows]
