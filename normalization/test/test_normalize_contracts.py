"""End-to-end contracts of normalize.py on a small synthetic session (the BA
helper lane L4): deterministic case ids and restamped analyst steps (RP-01,
C9), the preserved `confirmed` state (C2), hidden steps kept out of the stats
and the analysis (RP-06), stage failures recorded as null plus stage_errors
(RP-10, C12), the exit codes 1 to 3 (RP-04, RP-09, C13), and the run that
changes nothing unless it finishes (lane FX1).

The session is built in pytest's tmp_path, never in sessions/. The pipeline
imports pandas and pm4py, so this module skips where they are absent (bare
system pytest) and runs under the full-deps gate (bundled python plus the
system pytest), which is where it must be executed.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import logging
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
NORMALIZATION = HERE.parent
sys.path.insert(0, str(NORMALIZATION))

_DEPS_OK = all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py"))
pytestmark = pytest.mark.skipif(not _DEPS_OK, reason="pipeline deps (pandas/pm4py) not installed")

if _DEPS_OK:
    import normalize as normalize_mod
    import pipeline_stages

SESSION_ID = "sess-contract-test"
T0 = datetime(2026, 5, 14, 9, 0, 0, tzinfo=timezone.utc)


def _ts(sec: float) -> str:
    return (T0 + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _inter(eid, sec, kind, control_type, name):
    data = {"kind": kind, "control_type": control_type, "name": name,
            "automation_id": name.lower(), "process_name": "crm.exe",
            "window_title": "CRM - Orders"}
    if kind == "value_changed":
        data["value"] = "typed text"
    return {"event_id": eid, "type": "interaction", "timestamp": _ts(sec),
            "session_id": SESSION_ID, "data": data}


def _run(prefix, s):
    """One marked run, all on one screen: three drafted steps under the C1
    rule (typing + Find, Save, typing + Submit), because every invoked Button
    is a commit that ends its step."""
    return [
        {"event_id": f"{prefix}-start", "type": "marker", "timestamp": _ts(s),
         "session_id": SESSION_ID,
         "data": {"marker_type": "start", "label": f"Order {prefix}"}},
        {"event_id": f"{prefix}-act", "type": "activity", "timestamp": _ts(s),
         "session_id": SESSION_ID,
         "data": {"app": "crm.exe", "title": "CRM - Orders", "pid": 1,
                  "duration_ms": 9000}},
        _inter(f"{prefix}-i1", s + 1, "value_changed", "Edit", "Customer"),
        _inter(f"{prefix}-i2", s + 2, "invoked", "Button", "Find"),
        _inter(f"{prefix}-i3", s + 3, "invoked", "Button", "Save"),
        _inter(f"{prefix}-i4", s + 4, "value_changed", "Edit", "Note"),
        _inter(f"{prefix}-i5", s + 5, "invoked", "Button", "Submit"),
        {"event_id": f"{prefix}-end", "type": "marker", "timestamp": _ts(s + 9),
         "session_id": SESSION_ID, "data": {"marker_type": "end"}},
    ]


def _make_session(folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    events = ([{"event_id": "sys-0", "type": "system", "timestamp": _ts(0),
                "session_id": SESSION_ID, "data": {"kind": "session_start"}}]
              + _run("a", 1) + _run("b", 20)
              + [{"event_id": "sys-1", "type": "system", "timestamp": _ts(31),
                  "session_id": SESSION_ID, "data": {"kind": "session_end"}}])
    for seq, ev in enumerate(events):
        ev["_seq"] = seq
    (folder / "events.jsonl").write_text(
        "\n".join(json.dumps(e) for e in events) + "\n", encoding="utf-8")
    (folder / "manifest.json").write_text(json.dumps({
        "session_id": SESSION_ID, "started_at": _ts(0),
        "config": {"worker": {"id": "w1"}}}), encoding="utf-8")
    return folder


def _read(folder: Path, name: str):
    return json.loads((folder / name).read_text(encoding="utf-8"))


def _run_cli(*args):
    return subprocess.run(
        [sys.executable, str(NORMALIZATION / "normalize.py"), *map(str, args)],
        capture_output=True, text=True, cwd=str(NORMALIZATION.parent))


def _error_lines(proc) -> list[str]:
    return [ln for ln in proc.stderr.splitlines() if ln.startswith("[normalize] ERROR:")]


@pytest.fixture(autouse=True)
def _restore_root_logging():
    """normalize() attaches a file handler for <session>/normalize.log to the
    root logger; detach and close it so tmp folders are not held open."""
    root = logging.getLogger()
    before, level = list(root.handlers), root.level
    yield
    for h in list(root.handlers):
        if h not in before:
            root.removeHandler(h)
            h.close()
    root.setLevel(level)


# ---- RP-01 / C9 / C2 ---------------------------------------------------------

def test_the_same_events_normalized_twice_give_identical_case_ids(tmp_path):
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    first_cases = [c["case_id"] for c in _read(session, "stats.json")["case_stats"]]
    first_steps = {s["step_id"]: s["case_id"] for s in _read(session, "annotations.json")["steps"]}
    normalize_mod.normalize(session)
    second_cases = [c["case_id"] for c in _read(session, "stats.json")["case_stats"]]
    second_steps = {s["step_id"]: s["case_id"] for s in _read(session, "annotations.json")["steps"]}
    assert len(first_cases) == 2 and len(first_steps) == 6
    assert second_cases == first_cases, "case ids changed on re-analysis"
    assert second_steps == first_steps
    # Every analysis stage ran, so C12's stage_errors is written empty.
    analysis = _read(session, "analysis.json")
    assert analysis["stage_errors"] == []
    assert analysis["case_quality"] is not None and analysis["pdd_data"] is not None


def test_a_preserved_step_with_a_legacy_case_id_moves_to_the_run_containing_it(tmp_path):
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    runs = {c["label"]: c["case_id"] for c in _read(session, "stats.json")["case_stats"]}
    anno = _read(session, "annotations.json")
    anno["steps"].append({
        "step_id": "manual-1", "session_id": SESSION_ID,
        "case_id": "7d1e0c52-0000-4000-8000-legacy-random", "state": "manually_authored",
        "name": "Check the order total", "description": "",
        "time_range": {"start": _ts(24), "end": _ts(26)},
        "evidence": {"interaction_event_ids": [], "screenshot_refs": []},
        "flags": {},
    })
    (session / "annotations.json").write_text(json.dumps(anno), encoding="utf-8")
    normalize_mod.normalize(session)
    steps = {s["step_id"]: s for s in _read(session, "annotations.json")["steps"]}
    assert steps["manual-1"]["case_id"] == runs["Order b"]
    assert steps["manual-1"]["name"] == "Check the order total"


def test_a_confirmed_step_survives_re_normalization_unchanged(tmp_path):
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    anno = _read(session, "annotations.json")
    target = anno["steps"][0]
    target["state"] = "confirmed"
    before = copy.deepcopy(target)
    (session / "annotations.json").write_text(json.dumps(anno), encoding="utf-8")
    normalize_mod.normalize(session)
    after = [s for s in _read(session, "annotations.json")["steps"]
             if s["step_id"] == before["step_id"]]
    assert len(after) == 1
    for key in ("state", "name", "description", "case_id", "time_range", "evidence"):
        assert after[0][key] == before[key], f"confirmed step changed its {key}"
    # No fresh draft was laid over the span the analyst confirmed.
    covered = set(before["evidence"]["interaction_event_ids"])
    assert not [s for s in _read(session, "annotations.json")["steps"]
                if s["state"] == "auto_suggested"
                and covered & set(s["evidence"]["interaction_event_ids"])]


# ---- RP-06 --------------------------------------------------------------------

def test_a_hidden_step_does_not_reach_the_stats_or_the_analysis(tmp_path):
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    anno = _read(session, "annotations.json")
    hidden = anno["steps"][1]
    hidden["state"] = "hidden"
    hidden["name"] = "Hidden noise step"
    (session / "annotations.json").write_text(json.dumps(anno), encoding="utf-8")
    normalize_mod.normalize(session)
    kept = [s for s in _read(session, "annotations.json")["steps"]
            if s["step_id"] == hidden["step_id"]]
    assert kept and kept[0]["state"] == "hidden"          # still preserved
    for name in ("stats.json", "analysis.json"):
        text = (session / name).read_text(encoding="utf-8")
        assert "Hidden noise step" not in text, f"hidden step name leaked into {name}"
        assert hidden["step_id"] not in text, f"hidden step id leaked into {name}"
    # Positive control: the visible steps did reach the stats.
    assert _read(session, "stats.json")["step_stats"]


def test_the_step_state_breakdown_counts_confirmed_and_hidden_steps(tmp_path):
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    anno = _read(session, "annotations.json")
    anno["steps"][0]["state"] = "confirmed"
    anno["steps"][1]["state"] = "hidden"
    (session / "annotations.json").write_text(json.dumps(anno), encoding="utf-8")
    normalize_mod.normalize(session)
    meta = _read(session, "stats.json")["meta"]
    assert meta["step_count"] == 6
    assert meta["step_state_breakdown"] == {
        "auto_suggested": 4, "manually_authored": 0, "edited": 0,
        "confirmed": 1, "hidden": 1}


def test_readable_app_names_reach_the_stats_and_the_capture_detail(tmp_path):
    """DA gap 3 wiring: the pipeline names crm.exe from its window title
    ("CRM - Orders"), and the one check the Overview shows (the apps the
    recorder saw with less detail) uses that name."""
    session = _make_session(tmp_path / "s")
    events = [json.loads(line) for line in
              (session / "events.jsonl").read_text(encoding="utf-8").splitlines() if line]
    for ev in events:
        if ev["type"] == "interaction":
            ev["data"]["confidence"] = 0.2           # weak field identification
    (session / "events.jsonl").write_text(
        "\n".join(json.dumps(e) for e in events) + "\n", encoding="utf-8")
    normalize_mod.normalize(session)
    assert _read(session, "stats.json")["meta"]["app_names"] == {"crm.exe": "CRM"}
    caveat = _read(session, "analysis.json")["coverage_caveat"]
    assert caveat["claim"].startswith("The recorder saw less detail in 1 of 1 apps: CRM (")
    assert "crm.exe" not in caveat["claim"]


def test_analysis_json_holds_what_the_viewer_and_the_pdd_read(tmp_path):
    """Lane FX1: the analysis layer nobody read is cut. analysis.json holds
    the transaction check, the capture detail, the PDD's rows of sections 5
    and 6, the steps they were measured from, and its format (4)."""
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    analysis = _read(session, "analysis.json")
    assert set(analysis) == {"meta", "case_quality", "coverage_caveat", "pdd_data", "pdd_time",
                             "steps_signature", "stage_errors", "format"}
    assert analysis["format"] == pipeline_stages.ANALYSIS_FORMAT == 4
    assert analysis["coverage_caveat"] is None and analysis["stage_errors"] == []


# ---- RP-10 / C12 --------------------------------------------------------------

def _analysis_inputs(tmp_path):
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    events, _dropped = normalize_mod.load_events(session / "events.jsonl")
    return session, events, _read(session, "annotations.json")


def test_a_failed_capture_detail_is_null_and_named_in_stage_errors(tmp_path, monkeypatch):
    session, events, anno = _analysis_inputs(tmp_path)
    import capture_detail

    def boom(*_a, **_k):
        raise KeyError("process_name")
    monkeypatch.setattr(capture_detail, "coverage_caveat", boom)
    result = pipeline_stages._run_analysis(
        session, events, anno, {}, {"session_id": SESSION_ID}, cases={})
    assert result.get("coverage_caveat", "MISSING") is None
    assert result["stage_errors"] == [
        {"stage": "coverage_caveat", "error": "KeyError: 'process_name'"}]
    assert result["case_quality"] is not None              # the others still ran
    assert _read(session, "analysis.json") == json.loads(json.dumps(result))


def test_a_failed_case_check_is_null_and_named_in_stage_errors(tmp_path, monkeypatch):
    session, events, anno = _analysis_inputs(tmp_path)
    import case_quality

    def boom(*_a, **_k):
        raise ValueError("bad cases")
    monkeypatch.setattr(case_quality, "compute_case_quality", boom)
    result = pipeline_stages._run_analysis(
        session, events, anno, {}, {"session_id": SESSION_ID}, cases={})
    assert result.get("case_quality", "MISSING") is None
    assert result["stage_errors"] == [{"stage": "case_quality", "error": "ValueError: bad cases"}]


# ---- Lane FX1 (report 3, F4): a run that does not finish changes nothing ------

OUTPUTS = ("annotations.json", "stats.json", "analysis.json", "process_map_step.bpmn")


def _snapshot(folder: Path) -> dict:
    """Every file of the project folder but the run's log: name -> bytes."""
    return {p.name: p.read_bytes() for p in sorted(folder.iterdir())
            if p.is_file() and not p.name.startswith("normalize.log")}


def test_a_run_that_fails_leaves_every_output_as_it_was(tmp_path, monkeypatch):
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session, mine=True)
    anno = _read(session, "annotations.json")
    anno["steps"][0]["state"] = "hidden"                    # the next run would change the outputs
    (session / "annotations.json").write_text(json.dumps(anno), encoding="utf-8")
    before = _snapshot(session)
    assert set(OUTPUTS) <= set(before)

    def boom(*_a, **_k):
        raise RuntimeError("the map could not be laid out")
    # The last stage fails, after every other output was staged.
    monkeypatch.setattr(pipeline_stages, "_run_mining_exports", boom)
    monkeypatch.setattr(normalize_mod, "_run_mining_exports", boom)
    with pytest.raises(RuntimeError):
        normalize_mod.normalize(session, mine=True)
    assert _snapshot(session) == before, "a failed run changed the project"


def test_a_failed_pdd_export_exits_3_and_changes_nothing(tmp_path):
    session = _make_session(tmp_path / "s")
    _run_cli(session, "--mine")                              # a project analyzed before
    before = _snapshot(session)
    pdd_out = tmp_path / "missing-folder" / "pdd.docx"    # the save must fail

    proc = _run_cli(session, "--mine", "--pdd-out", pdd_out)

    assert proc.returncode == 3, proc.stdout[-2000:] + proc.stderr[-2000:]
    errors = _error_lines(proc)
    assert len(errors) == 1 and "PDD export" in errors[0] and str(pdd_out) in errors[0]
    assert "Nothing in the project was changed." in errors[0]
    assert _snapshot(session) == before, "a failed export changed the project"
    assert not pdd_out.exists()


_STOP_BEFORE_COMMIT = r"""
import pathlib, sys, time
sys.path.insert(0, sys.argv[1])
import session_io
flag = pathlib.Path(sys.argv[2])
def stop_here(self):
    flag.write_text("staged", encoding="utf-8")
    time.sleep(600)                                   # killed here, as Cancel kills it
session_io.Staging.commit = stop_here
import normalize
sys.argv = ["normalize.py", sys.argv[3], "--mine"]
normalize.main()
"""


def test_a_run_stopped_before_its_commit_leaves_every_output_as_it_was(tmp_path):
    """The viewer's Cancel kills normalize.py (python-runner.js: SIGTERM,
    then SIGKILL; on Windows both end the process at once, so nothing runs
    after). A run killed at its last moment, every output staged and none
    committed, leaves the project as it was; the next run removes what it
    staged and commits its own."""
    session = _make_session(tmp_path / "s")
    _run_cli(session, "--mine")
    anno = _read(session, "annotations.json")
    anno["steps"][0]["state"] = "hidden"
    (session / "annotations.json").write_text(json.dumps(anno), encoding="utf-8")
    before = _snapshot(session)
    flag = tmp_path / "staged.flag"
    proc = subprocess.Popen(
        [sys.executable, "-c", _STOP_BEFORE_COMMIT, str(NORMALIZATION), str(flag), str(session)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(NORMALIZATION.parent))
    try:
        deadline = time.monotonic() + 120
        while not flag.exists():
            assert proc.poll() is None, "the run ended before it reached its commit"
            assert time.monotonic() < deadline, "the run never reached its commit"
            time.sleep(0.1)
        staged = sorted(p.name for p in session.glob("*.pdt-staged"))
        assert staged == sorted(f"{name}.pdt-staged" for name in OUTPUTS), staged
    finally:
        proc.kill()
        proc.wait(timeout=30)
    after = {k: v for k, v in _snapshot(session).items() if not k.endswith(".pdt-staged")}
    assert after == before, "a stopped run changed an output"

    proc = _run_cli(session, "--mine")
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert not list(session.glob("*.pdt-staged")), "the next run left the staged files"
    hidden = [s for s in _read(session, "annotations.json")["steps"] if s["state"] == "hidden"]
    assert len(hidden) == 1                                  # the next run committed its own
# ---- C13 exit codes (RP-04, RP-09) and the CLI surface (C11) -------------------

def test_an_unreadable_annotations_file_exits_2_and_nothing_is_written(tmp_path):
    session = _make_session(tmp_path / "s")
    good = json.dumps({"steps": [{"step_id": "m1", "state": "manually_authored",
                                  "name": "Analyst work"}]}, indent=2).encode("utf-8")
    truncated = good[: len(good) // 2]
    (session / "annotations.json").write_bytes(truncated)
    before = sorted(p.name for p in session.iterdir())

    proc = _run_cli(session)

    assert proc.returncode == 2, proc.stdout[-2000:] + proc.stderr[-2000:]
    assert (session / "annotations.json").read_bytes() == truncated
    assert sorted(p.name for p in session.iterdir()) == before, "normalize wrote a file"
    errors = _error_lines(proc)
    assert len(errors) == 1
    assert "annotations.json" in errors[0] and "annotations.json.2" in errors[0]


def test_the_removed_step_bpmn_flag_is_a_usage_error_not_exit_2(tmp_path):
    """C11 removed --step-bpmn-out; argparse would exit 2 on it, which C13
    reserves for an unreadable annotations.json, so usage errors exit 1."""
    session = _make_session(tmp_path / "s")
    proc = _run_cli(session, "--step-bpmn-out", tmp_path / "x.bpmn")
    assert proc.returncode == 1
    errors = _error_lines(proc)
    assert len(errors) == 1 and "--step-bpmn-out" in errors[0]
    assert not (session / "annotations.json").exists()


def test_a_missing_folder_is_a_usage_error_the_viewer_can_show(tmp_path):
    """The viewer shows the ERROR line; it names the folder a person opened
    as a project (AD-29)."""
    missing = tmp_path / "no-such-project-folder"
    proc = _run_cli(missing)
    assert proc.returncode == 1
    assert _error_lines(proc) == [f"[normalize] ERROR: {missing} is not a project folder"]


def test_help_lists_exactly_the_c11_options():
    """C11's options, plus C19's manifest of the maps' pictures and C20's
    Technical details workbook and hand-off version."""
    proc = _run_cli("--help")
    assert proc.returncode == 0
    import re
    options = set(re.findall(r"(?<![\w-])--[a-z][a-z-]*", proc.stdout))
    assert options == {"--help", "--taxonomy", "--mine", "--pdd-out",
                       "--pdd-map-image", "--pdd-map-images", "--pdd-tobe-image", "--names",
                       "--tech-out", "--handoff"}
    assert "session_folder" in proc.stdout


# ---- C1 drafting, C4 remembered names, P1 draft_summary --------------------

FIND_KEY = "crm|CRM - Orders|Button:find"


def _names_store(path: Path, names: dict) -> Path:
    path.write_text(json.dumps({"version": 1, "names": {
        k: {"name": v, "updated_at": "2026-09-23T09:00:00Z"} for k, v in names.items()}}),
        encoding="utf-8")
    return path


def _warning_lines(proc) -> list[str]:
    return [ln for ln in proc.stderr.splitlines() if ln.startswith("[normalize] WARNING:")]


def test_the_names_flag_applies_a_remembered_name(tmp_path):
    session = _make_session(tmp_path / "s")
    store = _names_store(tmp_path / "remembered-names.json",
                         {FIND_KEY: "Look up the customer"})
    proc = _run_cli(session, "--names", store)
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert _warning_lines(proc) == []
    steps = _read(session, "annotations.json")["steps"]
    named = [s for s in steps if s["draft_key"] == FIND_KEY]
    assert len(named) == 2                      # one per run
    for s in named:
        assert s["name"] == "Look up the customer"
        assert s["name_source"] == "remembered"
    others = [s for s in steps if s["draft_key"] != FIND_KEY]
    assert others and all(s["name_source"] == "draft" for s in others)
    assert _read(session, "stats.json")["meta"]["draft_summary"]["name_source"] == {
        "remembered": 2, "draft": 4}


def test_an_unreadable_names_file_warns_once_and_drafts_default_names(tmp_path):
    session = _make_session(tmp_path / "s")
    store = tmp_path / "remembered-names.json"
    store.write_text("{not json", encoding="utf-8")
    proc = _run_cli(session, "--names", store)
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert _error_lines(proc) == []
    warnings = _warning_lines(proc)
    assert len(warnings) == 1 and str(store) in warnings[0]
    steps = _read(session, "annotations.json")["steps"]
    assert len(steps) == 6
    assert all(s["name_source"] == "draft" for s in steps)
    assert {s["name"] for s in steps if s["draft_key"] == FIND_KEY} == {"CRM - Orders: Find"}


def test_confirmed_run_1_survives_re_analysis_while_run_2_is_re_drafted(tmp_path):
    """Item 4 of the drafting lane: the analyst confirms every draft of run 1;
    re-analysis (now with a remembered name) leaves run 1 exactly as it was,
    one-interaction steps included, and re-drafts run 2 under the same ids.
    F1 (C4): run 2's draft takes the name the analyst confirmed for its key
    in this session, before the remembered-names file's name."""
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    runs = {c["label"]: c["case_id"] for c in _read(session, "stats.json")["case_stats"]}
    anno = _read(session, "annotations.json")
    for s in anno["steps"]:
        if s["case_id"] == runs["Order a"]:
            s["state"] = "confirmed"
    run1_before = sorted((s for s in anno["steps"] if s["case_id"] == runs["Order a"]),
                         key=lambda s: s["step_id"])
    run2_ids_before = sorted(s["step_id"] for s in anno["steps"]
                             if s["case_id"] == runs["Order b"])
    assert len(run1_before) == 3 and len(run2_ids_before) == 3
    (session / "annotations.json").write_text(json.dumps(anno), encoding="utf-8")

    store = _names_store(tmp_path / "names.json", {FIND_KEY: "Look up the customer"})
    normalize_mod.normalize(session, names_path=str(store))

    steps = _read(session, "annotations.json")["steps"]
    run1_after = sorted((s for s in steps if s["case_id"] == runs["Order a"]),
                        key=lambda s: s["step_id"])
    assert run1_after == run1_before, "a confirmed step changed on re-analysis"
    run2 = [s for s in steps if s["case_id"] == runs["Order b"]]
    assert sorted(s["step_id"] for s in run2) == run2_ids_before
    assert all(s["state"] == "auto_suggested" for s in run2)
    find2 = [s for s in run2 if s["draft_key"] == FIND_KEY]
    assert [s["name"] for s in find2] == ["CRM - Orders: Find"]
    assert [s["name_source"] for s in find2] == ["remembered"]
    # The confirmed Find step kept its confirmed name: re-drafting run 2
    # never reaches into run 1.
    assert [s["name"] for s in run1_after if s["draft_key"] == FIND_KEY] == [
        "CRM - Orders: Find"]
    assert len(steps) == 6


def test_the_draft_summary_in_stats_is_numbers_only(tmp_path):
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    summary = _read(session, "stats.json")["meta"]["draft_summary"]
    assert summary == {
        "runs": 2,
        "steps_per_run": [3, 3],
        "out_of_run_steps": 0,
        "end_reason": {"commit": 6, "screen_change": 0, "run_end": 0},
        "name_source": {"remembered": 0, "draft": 6},
        "commit_identity": {"automation_id": 6, "name": 0, "class_name": 0, "?": 0},
    }

    def leaves(x):
        if isinstance(x, dict):
            for v in x.values():
                yield from leaves(v)
        elif isinstance(x, list):
            for v in x:
                yield from leaves(v)
        else:
            yield x
    assert all(type(v) is int for v in leaves(summary))


# ---- C17: the flow the analyst sets on steps -----------------------------------

def test_the_flow_set_on_steps_round_trips_and_reaches_the_step_map(tmp_path):
    """A draft whose flow was set is kept as edited, a confirmed and an
    edited step keep theirs, a second analysis changes none of them, and
    the step map draws every label."""
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    anno = _read(session, "annotations.json")
    run_a = sorted((s for s in anno["steps"]
                    if s["evidence"]["interaction_event_ids"][0].startswith("a-")),
                   key=lambda s: s["time_range"]["start"])
    draft, confirmed, edited = run_a
    confirmed["state"], edited["state"] = "confirmed", "edited"
    draft["only_when"] = "the customer is new"
    confirmed["links"] = [{"to": "end", "when": "the order is on hold"}]
    edited["links"] = [{"to": draft["step_id"], "when": "a note is missing"}]
    (session / "annotations.json").write_text(json.dumps(anno), encoding="utf-8")
    keys = ("state", "name", "only_when", "links")
    for _ in range(2):
        normalize_mod.normalize(session, mine=True)
        after = {s["step_id"]: s for s in _read(session, "annotations.json")["steps"]}
        assert {k: after[draft["step_id"]].get(k) for k in keys} == {
            "state": "edited", "name": draft["name"],
            "only_when": "the customer is new", "links": None}
        for step in (confirmed, edited):
            assert {k: after[step["step_id"]].get(k) for k in keys} == {
                k: step.get(k) for k in keys}
    bpmn = (session / "process_map_step.bpmn").read_text(encoding="utf-8")
    for label in ("the customer is new", "otherwise", "the order is on hold",
                  "a note is missing"):
        assert f'name="{label}"' in bpmn, label
