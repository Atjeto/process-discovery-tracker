"""Tests for xes_export -- the XES EventLog build + the flat activity CSV
(review coverage gap #16).

xes_export imports pandas + pm4py at module top, which the SYSTEM Python used
for pytest does not have. So this module SKIPS loudly under bare pytest and is
meant to run where the pipeline deps exist:
    viewer/python/python.exe normalization/test/test_xes_export.py   (direct)
    pytest (CI env with requirements.txt installed)
The skip is explicit (not a silent pass) so it never masquerades as coverage.
"""

from __future__ import annotations
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_HAVE_DEPS = all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py"))
try:
    import pytest
    if not _HAVE_DEPS:
        pytest.skip(
            "pandas/pm4py not installed (system Python) -- run via the bundled "
            "python or a CI env with requirements.txt",
            allow_module_level=True,
        )
except ImportError:
    pass  # not running under pytest (e.g. direct run by the bundled python)

from xes_export import build_event_log, export_csv


def _activity(eid, ts, label, case_ids, app="chrome.exe", title="T"):
    return {"event_id": eid, "type": "activity", "timestamp": ts,
            "data": {"activity_label": label, "app": app, "title": title,
                     "case_ids": case_ids, "duration_ms": 1000}}


def test_build_event_log_one_trace_per_top_level_case():
    events = [
        _activity("e1", "2026-05-18T09:00:00Z", "Search", ["CUST-1"]),
        _activity("e2", "2026-05-18T09:00:02Z", "Create", ["CUST-1"]),
        _activity("e3", "2026-05-18T09:01:00Z", "Search", ["CUST-2"]),
    ]
    cases = {"CUST-1": {"label": "Cust 1"}, "CUST-2": {"label": "Cust 2"}}
    log = build_event_log(events, cases, worker_id="w-1")
    assert len(log) == 2                       # two top-level cases -> two traces
    by_name = {t.attributes["concept:name"]: t for t in log}
    assert "Cust 1" in by_name and "Cust 2" in by_name
    assert len(by_name["Cust 1"]) == 2         # CUST-1 has two events
    assert by_name["Cust 1"][0]["concept:name"] == "Search"
    assert by_name["Cust 1"][0]["org:resource"] == "w-1"


def test_build_event_log_groups_nested_under_top_level_case():
    # case_ids = [innermost, ..., top]; the trace is keyed by the top (last).
    events = [_activity("e1", "2026-05-18T09:00:00Z", "Sub", ["SUB-9", "TOP-1"])]
    log = build_event_log(events, {"TOP-1": {"label": "Top"}})
    assert len(log) == 1
    assert log[0].attributes["concept:name"] == "Top"


def test_build_event_log_no_case_events_go_to_a_synthetic_trace():
    events = [_activity("e1", "2026-05-18T09:00:00Z", "Orphan", [])]
    log = build_event_log(events, {})
    assert len(log) == 1
    assert log[0].attributes["concept:name"] == "(no-case)"


def test_export_csv_writes_rows_and_neutralizes_formula_injection():
    events = [
        _activity("e1", "2026-05-18T09:00:00Z", "=cmd|'/c calc'!A1", ["C-1"]),
        _activity("e2", "2026-05-18T09:00:02Z", "Create", ["C-1"]),
    ]
    cases = {"C-1": {"label": "Cust"}}
    fd, path = tempfile.mkstemp(suffix=".csv"); os.close(fd)
    try:
        export_csv(events, cases, path)
        import csv
        with open(path, encoding="utf-8", newline="") as f:
            rows = list(csv.DictReader(f))
        assert len(rows) == 2
        labels = [r["activity_label"] for r in rows]
        # The formula-leading label is quoted by csv_safe; the plain one is not.
        assert any(v.startswith("'=") for v in labels), labels
        assert "Create" in labels
        assert rows[0]["top_case_id"] == "C-1"
    finally:
        os.remove(path)


if __name__ == "__main__":
    if not _HAVE_DEPS:
        print("SKIP: pandas/pm4py not available")
        sys.exit(0)
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
