"""End-to-end contracts of normalize.py on a small synthetic session (the BA
helper lane L4): deterministic case ids and restamped analyst steps (RP-01,
C9), the preserved `confirmed` state (C2), hidden steps kept out of the stats
and the analysis (RP-06), stage failures recorded as null plus stage_errors
(RP-10, C12), and the exit codes 1 to 3 (RP-04, RP-09, C13).

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
    assert analysis["facts"] is not None and analysis["findings"] is not None


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


def test_readable_app_names_reach_the_stats_and_the_claims(tmp_path):
    """DA gap 3 wiring: the pipeline names crm.exe from its window title
    ("CRM - Orders") and the findings claims use that name."""
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    assert _read(session, "stats.json")["meta"]["app_names"] == {"crm.exe": "CRM"}
    claims = [f["claim"] for f in _read(session, "analysis.json")["findings"]]
    assert any(c.startswith("CRM takes") for c in claims)
    assert not any("crm.exe" in c for c in claims)


# ---- RP-10 / C12 --------------------------------------------------------------

def _analysis_inputs(tmp_path):
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    events, _dropped = normalize_mod.load_events(session / "events.jsonl")
    return session, events, _read(session, "annotations.json")


def test_a_failed_facts_stage_is_null_and_named_in_stage_errors(tmp_path, monkeypatch):
    session, events, anno = _analysis_inputs(tmp_path)
    import facts as facts_mod

    def boom(*_a, **_k):
        raise KeyError("duration_ms")
    monkeypatch.setattr(facts_mod, "compute_facts", boom)
    result = pipeline_stages._run_analysis(
        session, events, anno, {}, {"session_id": SESSION_ID}, cases={})
    assert result.get("facts", "MISSING") is None
    assert {"stage": "facts", "error": "KeyError: 'duration_ms'"} in result["stage_errors"]
    # The findings read the facts, so they could not run either.
    assert result["findings"] is None
    assert any(e["stage"] == "findings" and "facts" in e["error"]
               for e in result["stage_errors"])
    assert _read(session, "analysis.json") == json.loads(json.dumps(result))


def test_a_failed_findings_stage_is_null_and_named_in_stage_errors(tmp_path, monkeypatch):
    session, events, anno = _analysis_inputs(tmp_path)
    import findings as findings_mod

    def boom(*_a, **_k):
        raise RuntimeError("detector table broke")
    monkeypatch.setattr(findings_mod, "detect_findings", boom)
    result = pipeline_stages._run_analysis(
        session, events, anno, {}, {"session_id": SESSION_ID}, cases={})
    assert result.get("findings", "MISSING") is None
    assert result["stage_errors"] == [
        {"stage": "findings", "error": "RuntimeError: detector table broke"}]
    assert result["facts"] is not None                     # facts still measured


def test_one_failed_detector_fails_the_findings_stage(tmp_path, monkeypatch):
    """A detector that raises used to vanish silently, so a missing finding
    read as "nothing stood out". Now the findings stage is marked failed."""
    session, events, anno = _analysis_inputs(tmp_path)
    import findings as findings_mod

    def boom(*_a, **_k):
        raise ZeroDivisionError("division by zero")
    monkeypatch.setattr(findings_mod, "_detect_fragmentation", boom)
    result = pipeline_stages._run_analysis(
        session, events, anno, {}, {"session_id": SESSION_ID}, cases={})
    assert result["findings"] is None
    assert result["stage_errors"] == [{
        "stage": "findings",
        "error": "fragmentation: ZeroDivisionError: division by zero"}]


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


def test_a_failed_pdd_export_exits_3_after_writing_the_analysis(tmp_path):
    session = _make_session(tmp_path / "s")
    pdd_out = tmp_path / "missing-folder" / "pdd.docx"    # the save must fail

    proc = _run_cli(session, "--pdd-out", pdd_out)

    assert proc.returncode == 3, proc.stdout[-2000:] + proc.stderr[-2000:]
    errors = _error_lines(proc)
    assert len(errors) == 1 and "PDD export" in errors[0] and str(pdd_out) in errors[0]
    for name in ("annotations.json", "stats.json", "analysis.json"):
        assert (session / name).exists(), f"{name} was not written"
    assert not pdd_out.exists()


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
    proc = _run_cli("--help")
    assert proc.returncode == 0
    import re
    options = set(re.findall(r"(?<![\w-])--[a-z][a-z-]*", proc.stdout))
    assert options == {"--help", "--taxonomy", "--mine", "--pdd-out",
                       "--pdd-map-image", "--pdd-tobe-image", "--names"}
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
