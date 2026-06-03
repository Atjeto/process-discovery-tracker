"""Tests for process_filter -- drop PDT's own interactions + analyst-excluded
apps from the derived stream (the self-capture / 'PDT Live Session' phantom
steps). Pure stdlib, so it runs under a bare Python.
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from process_filter import filter_excluded, collect_exclusions


def _inter(eid, process_name, window_title="W", value="x"):
    return {"event_id": eid, "type": "interaction",
            "data": {"kind": "value_changed", "process_name": process_name,
                     "window_title": window_title, "value": value}}


def _activity(eid, app, title="T"):
    return {"event_id": eid, "type": "activity",
            "data": {"app": app, "title": title, "duration_ms": 1000}}


def test_pdt_capture_app_interactions_are_dropped_by_default():
    evs = [
        _inter("i1", "Process Discovery Tracker.exe", "Process Discovery -- Live session"),
        _inter("i2", "chrome.exe", "Salesforce"),
    ]
    out, report = filter_excluded(evs, manifest={}, annotations={})
    ids = [e["event_id"] for e in out]
    assert ids == ["i2"], ids                       # PDT interaction dropped, work kept
    assert report["excluded_count"] == 1
    assert "process discovery tracker" in report["by_process"]


def test_pdt_activity_events_also_dropped():
    evs = [_activity("a1", "Process Discovery Tracker.exe"), _activity("a2", "excel.exe")]
    out, _ = filter_excluded(evs)
    assert [e["event_id"] for e in out] == ["a2"]   # activity for PDT dropped too


def test_exe_suffix_is_insensitive():
    # Excluded with ".exe", event without it (and vice versa) still matches.
    evs = [_inter("i1", "Process Discovery Tracker")]   # no .exe on the event
    out, _ = filter_excluded(evs)
    assert out == []


def test_system_and_marker_events_always_pass():
    evs = [
        {"event_id": "s1", "type": "system", "data": {"kind": "session_start"}},
        {"event_id": "m1", "type": "marker", "data": {"marker_type": "start", "label": "x"}},
        _inter("i1", "Process Discovery Tracker.exe"),
    ]
    out = filter_excluded(evs)[0]
    assert [e["event_id"] for e in out] == ["s1", "m1"]   # lifecycle kept, PDT interaction dropped


def test_config_exclude_processes_is_honoured():
    evs = [_inter("i1", "legacy-crm.exe"), _inter("i2", "chrome.exe")]
    manifest = {"config": {"exclude_processes": ["legacy-crm"]}}   # no .exe in config
    out, _ = filter_excluded(evs, manifest=manifest)
    assert [e["event_id"] for e in out] == ["i2"]


def test_manifest_tool_process_name_excluded_for_dev_electron():
    # In dev the capture app is electron.exe; the default set won't catch it, but
    # the capture app's self-recorded process name (manifest.tool) does.
    evs = [_inter("i1", "electron.exe"), _inter("i2", "chrome.exe")]
    out, _ = filter_excluded(evs, manifest={"tool": {"process_name": "electron.exe"}})
    assert [e["event_id"] for e in out] == ["i2"]


def test_analyst_window_substring_filter():
    evs = [_inter("i1", "broker.exe", "Internal Admin Console"),
           _inter("i2", "broker.exe", "Customer Order")]
    anno = {"step_filters": {"ignored_window_titles": ["Admin Console"]}}
    out, _ = filter_excluded(evs, annotations=anno)
    assert [e["event_id"] for e in out] == ["i2"]


def test_input_not_mutated_and_default_set_reported():
    evs = [_inter("i1", "Process Discovery Tracker.exe"), _inter("i2", "chrome.exe")]
    snapshot = [dict(e) for e in evs]
    out, report = filter_excluded(evs)
    assert evs == snapshot                          # input untouched
    assert "process discovery tracker" in report["process_names"]


def test_collect_exclusions_unions_all_sources():
    procs, windows = collect_exclusions(
        manifest={"config": {"exclude_processes": ["a.exe"]}, "tool": {"process_name": "b.exe"}},
        annotations={"step_filters": {"ignored_processes": ["c"], "ignored_window_titles": ["W"]}},
    )
    assert {"process discovery tracker", "a", "b", "c"} <= procs
    assert "w" in windows


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
