"""Tests for csv_safe -- spreadsheet formula-injection neutralization.

A CSV cell beginning with = + - @ TAB or CR is run as a formula by Excel /
Sheets. Untrusted session strings (window titles, control names, case values)
flow into the step and XES CSV exports, so they must be neutralized.
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from csv_safe import sanitize_cell, sanitize_rows


def test_formula_leaders_are_quoted():
    for leader in ("=", "+", "-", "@", "\t", "\r"):
        payload = leader + "HYPERLINK(\"http://evil\")"
        out = sanitize_cell(payload)
        assert out == "'" + payload, f"leader {leader!r} not neutralized"


def test_classic_dde_payload_is_neutralized():
    out = sanitize_cell('=cmd|\'/c calc\'!A1')
    assert out.startswith("'="), "DDE payload must be prefixed with a quote"


def test_safe_strings_are_untouched():
    for ok in ("Search", "CUST-10852", "Incident form", "", "0.5 ratio", "už"):
        assert sanitize_cell(ok) == ok


def test_non_string_cells_pass_through():
    for v in (42, 3.14, True, False, None):
        assert sanitize_cell(v) is v


def test_sanitize_rows_does_not_mutate_input():
    rows = [{"name": "=BAD()", "n": 1}, {"name": "ok", "n": 2}]
    snapshot = [dict(r) for r in rows]
    out = sanitize_rows(rows)
    assert rows == snapshot, "input rows must not be mutated"
    assert out[0]["name"] == "'=BAD()"
    assert out[1]["name"] == "ok"
    assert out[0]["n"] == 1 and out[1]["n"] == 2


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
