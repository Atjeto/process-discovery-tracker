"""The activity library, the pipeline's half (contract C21, lane LIB-P).

The loader and its checks (library.py), the copy a project keeps
(project_library, normalize.py --library), the drafting that makes a run of
drafts one draft named from an activity (step_suggest.library_drafts), the
links that follow it, and where the library shows: the PDD's code and
description, the Technical details' Activity and Code columns and the step
map's colour order.

The loader, the copy and the drafting are stdlib only. The PDD needs
python-docx and the pipeline and the step map need pandas and pm4py; those
tests skip without them (the full-deps gate runs them).
"""

from __future__ import annotations

import copy
import importlib.util
import json
import logging
import os
import sys
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
NORMALIZATION = HERE.parent
REPO = NORMALIZATION.parent
sys.path.insert(0, str(NORMALIZATION))

import library as L  # noqa: E402
from library import Library, load_library, project_library  # noqa: E402
from session_io import Staging  # noqa: E402
from step_suggest import _merge_steps, auto_suggest_steps  # noqa: E402

APP_LIBRARY = REPO / "library" / "activities.json"
_PIPELINE_OK = all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py"))
_DOCX_OK = importlib.util.find_spec("docx") is not None
_needs_pipeline = pytest.mark.skipif(not _PIPELINE_OK, reason="pipeline deps not installed")

T0 = datetime(2026, 9, 25, 9, 0, 0, tzinfo=timezone.utc)
FIND = "crm|CRM - Orders|Button:find"
SAVE = "crm|CRM - Orders|Button:save"
PRINT = "crm|CRM - Orders|Button:print"
LOG = "excel|Excel - Tracking|Button:log"


def _ts(sec: float) -> str:
    return (T0 + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _ev(eid, sec, aid, *, case="run-1", proc="crm.exe", window="CRM - Orders",
        kind="invoked", ct="Button", **data):
    """One interaction; an invoked Button is a commit, so one draft each."""
    return {"event_id": eid, "type": "interaction", "timestamp": _ts(sec), "session_id": "s1",
            "data": {"kind": kind, "control_type": ct, "automation_id": aid,
                     "name": aid.capitalize(), "window_title": window, "process_name": proc,
                     "case_ids": [case] if case else [], **data}}


def _act(aid, name, *runs, code=None, description=None):
    act = {"id": aid, "name": name}
    if runs:
        act["screens"] = [list(r) for r in runs]
    if code is not None:
        act["code"] = code
    if description is not None:
        act["description"] = description
    return act


def _doc(*activities, app="CRM", version="7"):
    return {"format": 1, "version": version, "applications": [
        {"name": app, "activities": list(activities)}]}


def _lib(*activities, **kw) -> Library:
    return L.parse_library(_doc(*activities, **kw))


def _write(path: Path, doc) -> Path:
    path.write_text(doc if isinstance(doc, str) else json.dumps(doc), encoding="utf-8")
    return path


def _drafted(events, lib=None, existing=()):
    """The steps one analysis leaves: the C1 drafts, merged with `existing`
    and named from `lib`."""
    by_id = {e["event_id"]: e for e in events}
    return _merge_steps(list(existing), auto_suggest_steps(events), by_id, library=lib)


def _ids(step):
    return step["evidence"]["interaction_event_ids"]


# ---- the loader and its checks -------------------------------------------------

def test_the_shipped_library_lists_the_known_systems_and_no_activity():
    lib = load_library(APP_LIBRARY)
    assert lib.problem is None and lib.version == "1"
    assert lib.activities == {} and lib.runs == {}
    rules = json.loads((REPO / "shared" / "system-names.json").read_text(encoding="utf-8"))["rules"]
    # A site rule (2.0.1) names a site from the title, not one system.
    assert sorted(lib.applications) == sorted({r["system"] for r in rules if "system" in r})
    assert len(set(lib.applications)) == len(lib.applications)
    doc = json.loads(APP_LIBRARY.read_text(encoding="utf-8"))
    assert doc["format"] == 1 and all(app["activities"] == [] for app in doc["applications"])


def test_a_valid_library_loads_with_its_order_codes_and_runs(tmp_path):
    doc = {"format": 1, "version": "2026-09 v3", "applications": [
        {"name": "Salesforce", "activities": [
            _act("sf-find", "Find the account", [FIND], [SAVE, PRINT], code=" SF-01 ",
                 description="Look the customer up."),
            _act("sf-call", "Call the customer")]},             # a name only
        {"name": "SAP", "activities": [_act("sap-find", "Find the account", [LOG, LOG, PRINT])]},
        {"name": "Excel"}]}
    lib = load_library(_write(tmp_path / "lib.json", doc))
    assert lib.problem is None and lib.version == "2026-09 v3"
    assert lib.applications == ("Salesforce", "SAP", "Excel")
    assert lib.activities["sf-find"] == L.Activity("sf-find", "Find the account", "SF-01",
                                                   "Look the customer up.", "Salesforce")
    call = lib.activities["sf-call"]
    assert (call.code, call.description, call.application) == ("", "", "Salesforce")
    # A repeated screen counts once; one name may be used in two applications.
    assert lib.runs == {(FIND,): "sf-find", (SAVE, PRINT): "sf-find", (LOG, PRINT): "sap-find"}
    assert lib.raw == (tmp_path / "lib.json").read_bytes()


def _empty_because(lib: Library, *words) -> None:
    assert lib.activities == {} and lib.applications == () and lib.runs == {}
    assert lib.version is None and lib.problem
    for word in words:
        assert word in lib.problem, (word, lib.problem)


def test_a_broken_file_is_an_empty_library_that_says_why(tmp_path):
    cases = {
        "missing": (tmp_path / "nope.json", "was not found"),
        "bad json": (_write(tmp_path / "bad.json", "{not json"), "is not a JSON file"),
        "not utf-8": (tmp_path / "latin.json", "is not a JSON file"),
        "not an object": (_write(tmp_path / "list.json", [1, 2]), "format 1"),
        "format 2": (_write(tmp_path / "f2.json", dict(_doc(), format=2)), "format 1"),
        "applications": (_write(tmp_path / "apps.json", {"format": 1, "applications": {}}),
                         "applications are not a list"),
        "no name": (_write(tmp_path / "noname.json", {"format": 1, "applications": [{}]}),
                    "application 1 has no name"),
        "no id": (_write(tmp_path / "noid.json", _doc({"name": "Find"})), "no id or no name"),
        "code": (_write(tmp_path / "code.json", _doc(_act("a", "Find", code=7))),
                 "code of the activity 'a'"),
        "empty run": (_write(tmp_path / "run.json", _doc(_act("a", "Find", []))),
                      "not runs of draft keys"),
        "a key": (_write(tmp_path / "key.json", _doc({"id": "a", "name": "F", "screens": [FIND]})),
                  "not runs of draft keys"),
    }
    (tmp_path / "latin.json").write_bytes(b'{"format": 1, "version": "\xe9"}')
    for label, (path, why) in cases.items():
        _empty_because(load_library(path), str(path), why)
    assert load_library(None).problem == "no library file was given"


def test_duplicates_leave_the_whole_library_empty(tmp_path):
    twice_id = {"format": 1, "applications": [
        {"name": "CRM", "activities": [_act("a", "Find", [FIND])]},
        {"name": "Excel", "activities": [_act("a", "Log", [LOG])]}]}
    _empty_because(load_library(_write(tmp_path / "id.json", twice_id)), "'a' is used twice")
    twice_name = _doc(_act("a", "Find", [FIND]), _act("b", "Find", [SAVE]))
    _empty_because(load_library(_write(tmp_path / "name.json", twice_name)),
                   "'Find' is used twice in CRM")
    # A run belongs to one activity; its repeats count once.
    twice_run = _doc(_act("a", "Find", [FIND, SAVE]), _act("b", "Save", [FIND, FIND, SAVE]))
    _empty_because(load_library(_write(tmp_path / "run.json", twice_run)), "'a' and 'b'")
    # Nothing is half applied: a good activity before the bad one is not kept.
    half = _doc(_act("a", "Find", [FIND]), _act("b", "Save", [SAVE], code=["x"]))
    _empty_because(load_library(_write(tmp_path / "half.json", half)))
    # The same run twice in one activity is no duplicate.
    ok = load_library(_write(tmp_path / "ok.json", _doc(_act("a", "Find", [FIND], [FIND]))))
    assert ok.problem is None and ok.runs == {(FIND,): "a"}


# ---- a project keeps its library -------------------------------------------------

def test_the_first_analysis_copies_the_app_library_and_never_replaces_it(tmp_path):
    folder = tmp_path / "project"
    folder.mkdir()
    app = _write(tmp_path / "app.json", _doc(_act("a", "Find", [FIND]), version="1"))
    lib = project_library(folder, app)
    assert lib.version == "1" and lib.problem is None
    copied = (folder / "library.json").read_bytes()
    assert copied == app.read_bytes()
    newer = _write(tmp_path / "newer.json", _doc(_act("b", "Save", [SAVE]), version="2"))
    again = project_library(folder, newer)
    assert again.version == "1" and set(again.activities) == {"a"}
    assert (folder / "library.json").read_bytes() == copied
    # Without the flag the project's copy is still the one used.
    assert project_library(folder).version == "1"
    # A copy that cannot be used stays as it is: the library is empty.
    (folder / "library.json").write_text("{broken", encoding="utf-8")
    broken = project_library(folder, newer)
    _empty_because(broken, "library.json")
    assert (folder / "library.json").read_text(encoding="utf-8") == "{broken"


def test_an_app_library_that_fails_a_check_is_not_copied(tmp_path, capsys):
    folder = tmp_path / "project"
    folder.mkdir()
    bad = _write(tmp_path / "bad.json", _doc(_act("a", "Find", [FIND]), _act("a", "Save", [SAVE])))
    _empty_because(project_library(folder, bad), "used twice")
    assert not (folder / "library.json").exists()
    warnings = [ln for ln in capsys.readouterr().err.splitlines() if "WARNING" in ln]
    assert len(warnings) == 1 and str(bad) in warnings[0]
    # No library asked for: none, and nothing to say.
    assert project_library(folder) == Library()
    assert capsys.readouterr().err == ""


def test_the_copy_is_staged_with_the_run(tmp_path):
    folder = tmp_path / "project"
    folder.mkdir()
    app = _write(tmp_path / "app.json", _doc(version="1"))
    staging = Staging(folder)
    project_library(folder, app, staging)
    assert not (folder / "library.json").exists()
    assert staging.names() == ["library.json"]
    staging.discard()
    assert list(folder.iterdir()) == []
    staging = Staging(folder)
    project_library(folder, app, staging)
    staging.commit()
    assert (folder / "library.json").read_bytes() == app.read_bytes()


# ---- drafting with the library ------------------------------------------------------

def test_a_single_screen_names_its_draft():
    events = [_ev("e1", 1, "find"), _ev("e2", 2, "save")]
    lib = _lib(_act("find-1", "Look up the order", [FIND]))
    steps = _drafted(events, lib)
    named = next(s for s in steps if _ids(s) == ["e1"])
    assert named["name"] == "Look up the order" and named["name_source"] == "library"
    assert named["library_activity"] == "find-1" and named["draft_keys"] == [FIND]
    assert "draft_key" not in named and named["state"] == "auto_suggested"
    save = next(s for s in steps if _ids(s) == ["e2"])
    assert save["draft_key"] == SAVE and save["name_source"] == "draft"


def test_a_run_of_screens_becomes_one_draft_with_the_span_and_evidence_of_the_run():
    def shot(eid, sec, path):
        return {"event_id": eid, "type": "system", "timestamp": _ts(sec),
                "data": {"kind": "screenshot", "path": path}}
    events = [_ev("e0", 1, "customer", kind="value_changed", ct="Edit", value="C-1"),
              _ev("e1", 2, "find"), shot("s1", 2, "screenshots/a.jpg"),
              _ev("e2", 5, "save", vocab_flags={"waste": True}), shot("s2", 5, "screenshots/b.jpg"),
              _ev("e3", 9, "print")]
    lib = _lib(_act("order", "Enter the order", [FIND, SAVE], code="ORD-1"))
    steps = _drafted(events, lib)
    assert len(steps) == 2
    order = next(s for s in steps if s.get("library_activity") == "order")
    assert order["name"] == "Enter the order" and order["draft_keys"] == [FIND, SAVE]
    assert _ids(order) == ["e0", "e1", "e2"]
    assert order["time_range"] == {"start": _ts(1), "end": _ts(5)}
    assert order["evidence"]["screenshot_refs"] == ["screenshots/a.jpg", "screenshots/b.jpg"]
    assert order["flags"] == {"waste": True} and order["end_reason"] == "commit"
    assert order["case_id"] == "run-1" and order["process_label"] == "Enter the order"
    # Its description is the narration of its actions, as for any draft.
    from step_suggest import is_drafted_description
    assert is_drafted_description(order["description"], events[:2] + events[3:4])
    printed = next(s for s in steps if s is not order)
    assert printed["draft_key"] == PRINT and _ids(printed) == ["e3"]


def test_a_repeated_screen_counts_once():
    events = [_ev("e1", 1, "find"), _ev("e2", 2, "find"), _ev("e3", 3, "save"),
              _ev("e4", 4, "save")]
    lib = _lib(_act("order", "Enter the order", [FIND, SAVE]))
    (order,) = _drafted(events, lib)
    assert order["draft_keys"] == [FIND, SAVE] and _ids(order) == ["e1", "e2", "e3", "e4"]
    # One screen repeated is a run of one screen.
    (found,) = _drafted(events[:2], _lib(_act("find", "Look up", [FIND])))
    assert found["draft_keys"] == [FIND] and _ids(found) == ["e1", "e2"]


def test_the_longest_run_wins_left_to_right():
    lib = _lib(_act("find", "Look up", [FIND]), _act("order", "Enter the order", [FIND, SAVE]),
               _act("print", "Print it", [SAVE, PRINT]))
    events = [_ev("e1", 1, "find"), _ev("e2", 2, "save"), _ev("e3", 3, "print"),
              _ev("e4", 4, "find"), _ev("e5", 5, "print")]
    steps = sorted(_drafted(events, lib), key=lambda s: s["time_range"]["start"])
    # Find then Save is the longer run at e1, so Save cannot start Print it;
    # Find alone at e4 is a run of one; Print alone matches nothing.
    assert [(s["name"], _ids(s)) for s in steps] == [
        ("Enter the order", ["e1", "e2"]), ("CRM - Orders: Print", ["e3"]),
        ("Look up", ["e4"]), ("CRM - Orders: Print", ["e5"])]


def test_drafts_no_run_matches_are_unchanged():
    events = [_ev("e1", 1, "find"), _ev("e2", 2, "save")]
    fresh = auto_suggest_steps(events)
    by_id = {e["event_id"]: e for e in events}
    plain = _merge_steps([], copy.deepcopy(fresh), by_id)
    lib = _lib(_act("log", "Log it", [LOG]), _act("both", "Save then find", [SAVE, FIND]))
    assert _merge_steps([], copy.deepcopy(fresh), by_id, library=lib) == plain
    # An empty library, the shipped one included, changes nothing.
    assert _merge_steps([], copy.deepcopy(fresh), by_id, library=Library()) == plain
    assert _merge_steps([], copy.deepcopy(fresh), by_id, library=load_library(APP_LIBRARY)) == plain


def test_a_run_broken_by_another_app_or_by_a_step_of_the_analyst_does_not_match():
    lib = _lib(_act("order", "Enter the order", [FIND, SAVE]))
    other_app = [_ev("e1", 1, "find"),
                 _ev("e2", 2, "log", proc="excel.exe", window="Excel - Tracking"),
                 _ev("e3", 3, "save")]
    assert not any(s.get("library_activity") for s in _drafted(other_app, lib))
    # Two transactions: the end of one and the start of the next are no run.
    two_runs = [_ev("e1", 1, "find"), _ev("e2", 2, "save", case="run-2")]
    assert not any(s.get("library_activity") for s in _drafted(two_runs, lib))
    # The analyst confirmed the Save between two Finds: no run reaches across it.
    events = [_ev("e1", 1, "find"), _ev("e2", 2, "save"), _ev("e3", 3, "find"), _ev("e4", 4, "save")]
    first = _drafted(events)
    kept = next(s for s in first if _ids(s) == ["e2"])
    kept["state"] = "confirmed"
    again = _drafted(events, lib, existing=first)
    assert [(s.get("library_activity"), _ids(s)) for s in again
            if s["state"] == "auto_suggested"] == [(None, ["e1"]), ("order", ["e3", "e4"])]


def test_the_named_draft_keeps_its_id_from_one_analysis_to_the_next():
    events = [_ev("e1", 1, "find"), _ev("e2", 2, "save")]
    lib = _lib(_act("order", "Enter the order", [FIND, SAVE]))
    (first,) = _drafted(events, lib)
    (again,) = _drafted(events, lib, existing=[first])
    assert again["step_id"] == first["step_id"] and again["library_activity"] == "order"


def test_a_link_to_a_draft_the_run_took_in_points_at_the_named_draft():
    """A project analyzed before its library had activities: a kept step
    links to the Save draft and to the Find draft; the next analysis makes
    Find and Save one draft, and both links point at it. A link to the end
    and a link to a step that is still there stay as they are."""
    events = [_ev("e0", 0, "customer", kind="value_changed", ct="Edit", value="C-1"),
              _ev("e1", 1, "find"), _ev("e2", 2, "save"), _ev("e3", 3, "print")]
    first = _drafted(events)
    by_ids = {tuple(_ids(s)): s for s in first}
    find, save, printed = by_ids[("e0", "e1")], by_ids[("e2",)], by_ids[("e3",)]
    printed["links"] = [{"to": save["step_id"], "when": "a line changed"},
                        {"to": find["step_id"], "when": "the customer changed"},
                        {"to": "end", "when": "the order is cancelled"}]
    lib = _lib(_act("order", "Enter the order", [FIND, SAVE]))
    again = _drafted(events, lib, existing=first)
    order = next(s for s in again if s.get("library_activity") == "order")
    kept = next(s for s in again if s.get("links"))
    assert kept["state"] == "edited" and kept["step_id"] == printed["step_id"]
    # The named draft holds most of Find's actions, so it keeps Find's id.
    assert order["step_id"] == find["step_id"]
    assert [link["to"] for link in kept["links"]] == [order["step_id"], order["step_id"], "end"]
    # With no draft holding most of the run, the link still follows.
    first = _drafted(events[1:])
    by_ids = {tuple(_ids(s)): s for s in first}
    by_ids[("e3",)]["links"] = [{"to": by_ids[("e2",)]["step_id"], "when": ""}]
    again = _drafted(events[1:], lib, existing=first)
    order = next(s for s in again if s.get("library_activity") == "order")
    assert order["step_id"] not in {by_ids[("e1",)]["step_id"], by_ids[("e2",)]["step_id"]}
    assert next(s for s in again if s.get("links"))["links"][0]["to"] == order["step_id"]


# ---- the pipeline ------------------------------------------------------------------

def _session(folder: Path) -> Path:
    """Two marked transactions of Find, Save and Print on one screen."""
    folder.mkdir(parents=True)
    events = [{"event_id": "sys-0", "type": "system", "timestamp": _ts(0),
               "data": {"kind": "session_start"}}]
    for run, start in (("a", 1), ("b", 20)):
        events += [
            {"event_id": f"{run}-start", "type": "marker", "timestamp": _ts(start),
             "data": {"marker_type": "start", "label": f"Order {run}"}},
            {"event_id": f"{run}-act", "type": "activity", "timestamp": _ts(start),
             "data": {"app": "crm.exe", "title": "CRM - Orders", "pid": 1, "duration_ms": 9000}},
            _ev(f"{run}-1", start + 1, "customer", case=None, kind="value_changed", ct="Edit",
                value="C-1"),
            _ev(f"{run}-2", start + 2, "find", case=None),
            _ev(f"{run}-3", start + 3, "save", case=None),
            _ev(f"{run}-4", start + 4, "print", case=None),
            {"event_id": f"{run}-end", "type": "marker", "timestamp": _ts(start + 9),
             "data": {"marker_type": "end"}}]
    for seq, ev in enumerate(events):
        ev["session_id"] = "sess-lib"
        ev["_seq"] = seq
    (folder / "events.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n",
                                         encoding="utf-8")
    (folder / "manifest.json").write_text(json.dumps({
        "session_id": "sess-lib", "started_at": _ts(0), "config": {"worker": {"id": "w1"}}}),
        encoding="utf-8")
    return folder


@pytest.fixture
def _restore_root_logging():
    root = logging.getLogger()
    before, level = list(root.handlers), root.level
    yield
    for h in list(root.handlers):
        if h not in before:
            root.removeHandler(h)
            h.close()
    root.setLevel(level)


def _read(folder: Path, name: str):
    return json.loads((folder / name).read_text(encoding="utf-8"))


_ORDER = _act("order", "Enter the order", [FIND, SAVE], code="ORD-1",
              description="Find the customer and save the order.")


@_needs_pipeline
def test_the_pipeline_uses_the_library_the_project_started_with(tmp_path, _restore_root_logging):
    import normalize as normalize_mod
    session = _session(tmp_path / "s")
    app = _write(tmp_path / "app.json", _doc(_ORDER, app="Crm", version="1"))
    normalize_mod.normalize(session, library_path=str(app))
    assert (session / "library.json").read_bytes() == app.read_bytes()
    assert _read(session, "analysis.json")["library_version"] == "1"
    steps = _read(session, "annotations.json")["steps"]
    named = [s for s in steps if s.get("library_activity") == "order"]
    assert len(named) == 2 and all(s["name"] == "Enter the order" for s in named)
    assert len(steps) == 4
    # The P1 probe counts the rule's own drafts, before the library named them.
    assert _read(session, "stats.json")["meta"]["draft_summary"]["name_source"] == {
        "remembered": 0, "draft": 6}
    # A newer app library changes nothing in this project.
    newer = _write(tmp_path / "newer.json", _doc(version="2"))
    normalize_mod.normalize(session, library_path=str(newer))
    assert _read(session, "analysis.json")["library_version"] == "1"
    assert [s["step_id"] for s in _read(session, "annotations.json")["steps"]] == [
        s["step_id"] for s in steps]
    # Without a library anywhere, the version is null.
    bare = _session(tmp_path / "bare")
    normalize_mod.normalize(bare)
    assert _read(bare, "analysis.json")["library_version"] is None
    assert not (bare / "library.json").exists()


@_needs_pipeline
def test_a_run_that_fails_leaves_no_copy_of_the_library(tmp_path, monkeypatch,
                                                        _restore_root_logging):
    import normalize as normalize_mod
    import pipeline_stages
    session = _session(tmp_path / "s")
    app = _write(tmp_path / "app.json", _doc(_ORDER, version="1"))

    def boom(*_a, **_k):
        raise RuntimeError("the map could not be laid out")
    monkeypatch.setattr(pipeline_stages, "_run_mining_exports", boom)
    monkeypatch.setattr(normalize_mod, "_run_mining_exports", boom)
    with pytest.raises(RuntimeError):
        normalize_mod.normalize(session, library_path=str(app))
    assert sorted(p.name for p in session.iterdir()) == ["events.jsonl", "manifest.json",
                                                         "normalize.log"]


@_needs_pipeline
def test_the_cli_takes_the_library_flag(tmp_path):
    import subprocess
    session = _session(tmp_path / "s")
    proc = subprocess.run([sys.executable, str(NORMALIZATION / "normalize.py"), str(session),
                           "--library", str(APP_LIBRARY)],
                          capture_output=True, text=True, cwd=str(REPO))
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert "copied" in proc.stdout and "library.json" in proc.stdout
    assert (session / "library.json").read_bytes() == APP_LIBRARY.read_bytes()
    assert _read(session, "analysis.json")["library_version"] == "1"


# ---- the PDD, the Technical details and the step map ------------------------------------

def _fixture(tmp_path):
    """(annotations, stats, manifest, events) of one transaction: a step
    named from the library, one the analyst described, one of no activity."""
    events = [_ev("e1", 1, "find"), _ev("e2", 2, "save"), _ev("e3", 3, "print"),
              _ev("e4", 4, "log", proc="excel.exe", window="Excel - Tracking")]
    lib = _lib(_ORDER, _act("print", "Print the order", [PRINT], code="ORD-2",
                            description="Print it for the file."))
    steps = _drafted(events[:3], lib) + _drafted(events[3:])
    printed = next(s for s in steps if s.get("library_activity") == "print")
    printed["description"] = "The analyst's own words."
    printed["state"] = "edited"
    annotations = {"steps": steps, "pattern_run": {"case_id": "run-1"}}
    stats = {"case_stats": [{"case_id": "run-1", "label": "Order", "parent_case_id": None,
                             "start_ts": _ts(0), "end_ts": _ts(9), "wall_clock_ms": 9000,
                             "active_ms": 8000}], "meta": {"app_names": {}}}
    manifest = {"session_id": "s1", "started_at": _ts(0)}
    return annotations, stats, manifest, events, lib


def test_the_pdd_prints_the_code_and_the_activitys_description(tmp_path):
    import pdd_export
    annotations, stats, manifest, events, lib = _fixture(tmp_path)
    s = pdd_export._Session(tmp_path, annotations, stats, manifest, events, library=lib)
    order, printed, log = s.run_steps(0)
    assert s.context_line(order).startswith("Code ORD-1 · ")
    assert s.description(order) == "Find the customer and save the order."
    # The analyst's own description wins over the activity's.
    assert s.context_line(printed).startswith("Code ORD-2 · ")
    assert s.description(printed) == "The analyst's own words."
    assert not s.context_line(log).startswith("Code") and s.description(log) == ""
    # Without a library passed, the project's library.json is read.
    (tmp_path / "library.json").write_text(json.dumps(_doc(_ORDER)), encoding="utf-8")
    s = pdd_export._Session(tmp_path, annotations, stats, manifest, events)
    assert s.context_line(s.run_steps(0)[0]).startswith("Code ORD-1 · ")
    # A step whose activity the library does not hold prints no code.
    assert s.activity(printed) is None and s.description(printed) == "The analyst's own words."


@pytest.mark.skipif(not _DOCX_OK, reason="python-docx not installed")
def test_the_written_pdd_holds_the_code_and_the_description(tmp_path):
    import pdd_export
    from docx import Document
    annotations, stats, manifest, events, lib = _fixture(tmp_path)
    out = tmp_path / "pdd.docx"
    pdd_export.write_pdd(out, session_folder=tmp_path, annotations=annotations, stats=stats,
                         manifest=manifest, events=events, library=lib)
    text = [p.text for p in Document(str(out)).paragraphs]
    at = text.index("Step 1: Enter the order")
    assert text[at + 1].startswith("Code ORD-1 · ")
    assert text[at + 2] == "Find the customer and save the order."
    assert "Print it for the file." not in text


def test_the_technical_details_name_each_rows_activity_and_code(tmp_path):
    import tech_details as TD
    annotations, stats, manifest, events, lib = _fixture(tmp_path)
    sheets = TD.tech_sheets(session_folder=tmp_path, annotations=annotations, stats=stats,
                            manifest=manifest, events=events, library=lib)
    steps = next(sh for sh in sheets if sh.name == TD.STEPS).rows
    assert steps[0][-4:-2] == ["Activity", "Code"]
    assert [(r[0], r[-4], r[-3]) for r in steps[1:]] == [
        ("Step 1", "Enter the order", "ORD-1"), ("Step 1", "Enter the order", "ORD-1"),
        ("Step 2", "Print the order", "ORD-2"), ("Step 3", "", "")]


