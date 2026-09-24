"""Contract C19 in re-analysis: sub-processes survive every analysis.

A step is a sub-process when it carries `sub_steps` (a list, possibly
empty). `annotations.steps` stays the main level; the pipeline keeps every
subtree as it is, promotes a draft carrying `sub_steps` to `edited` (next to
the C17 `declares_flow` rule), gives every sub-step its parent's case_id and
a process_label by the main level's rule, and a group (a manually authored
step whose span and evidence are its members') makes the next analysis drop
fresh drafts of the grouped interactions.

The unit tests are stdlib only; the end-to-end ones run normalize() on a
synthetic session in pytest's tmp_path (never in sessions/) and need the
pipeline deps (the full-deps gate).
"""

from __future__ import annotations

import copy
import importlib.util
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from step_suggest import _merge_steps, restamp_preserved_case_ids  # noqa: E402

_DEPS_OK = all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py"))
deps = pytest.mark.skipif(not _DEPS_OK, reason="pipeline deps (pandas/pm4py) not installed")

T0 = datetime(2026, 9, 24, 9, 0, 0, tzinfo=timezone.utc)
SESSION_ID = "sess-sub-process-test"


def _ts(sec: float) -> str:
    return (T0 + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _sub(sid, name, sec, eids, **extra):
    """A drafted sub-step: its action_key, name_source "action", a draft."""
    step = {"step_id": sid, "name": name, "state": "auto_suggested",
            "action_key": f"crm|CRM - Orders|click:{name}", "name_source": "action",
            "description": "", "time_range": {"start": _ts(sec), "end": _ts(sec + 1)},
            "evidence": {"interaction_event_ids": list(eids), "screenshot_refs": []}}
    step.update(extra)
    return step


# ---- unit: the merge and the restamp ------------------------------------------------

def _draft(sid, eids, *, state="auto_suggested", **extra):
    step = {"step_id": sid, "state": state, "name": "CRM - Orders: Find",
            "draft_key": "crm|CRM - Orders|Button:find", "case_id": "run-1",
            "evidence": {"interaction_event_ids": list(eids)},
            "time_range": {"start": _ts(1), "end": _ts(2)}}
    step.update(extra)
    return step


@pytest.mark.parametrize("sub_steps", [[], "subtree"], ids=["empty", "subtree"])
def test_a_draft_opened_as_a_sub_process_is_kept_as_edited(sub_steps):
    subtree = [] if sub_steps == [] else [
        _sub("s1", "Enter Customer", 1, ["e1"]),
        _sub("s2", "Click Find", 2, ["e2"], sub_steps=[_sub("s3", "Read the list", 2, [])])]
    opened = _draft("D1", ["e1", "e2"], sub_steps=subtree)
    before = copy.deepcopy(subtree)
    fresh = _draft("NEW", ["e1", "e2"], case_id=None)
    merged = _merge_steps([opened], [fresh])
    # Kept as the analyst's, with its sub-steps; no fresh draft over it.
    assert [s["step_id"] for s in merged] == ["D1"]
    assert merged[0]["state"] == "edited"
    assert merged[0]["sub_steps"] is subtree

    def strip(steps):
        return [{k: (strip(v) if k == "sub_steps" else v) for k, v in s.items()
                 if k != "process_label"} for s in steps]
    assert strip(merged[0]["sub_steps"]) == before


def test_a_draft_without_sub_steps_is_still_drafted_again():
    """Positive control: only `sub_steps` (or the C17 flow) keeps a draft."""
    prior = _draft("D1", ["e1", "e2"])
    fresh = _draft("NEW", ["e1", "e2"], name="CRM - Orders: Search")
    merged = _merge_steps([prior], [fresh])
    assert [(s["step_id"], s["state"], s["name"]) for s in merged] == [
        ("D1", "auto_suggested", "CRM - Orders: Search")]


def test_every_sub_step_gets_a_process_label_by_the_main_rule_at_every_depth():
    """The main level's rule (step_suggest._step_process_label): a drafted
    sub-step (action_key) is its own name, as a drafted step is; any other
    sub-step its name with the shared value rules applied."""
    parent = _draft("P1", ["e1"], state="edited", sub_steps=[
        _sub("s1", "Enter Ship to - Street", 1, ["e1"]),
        {"step_id": "h1", "name": "Call the bank - Anna", "state": "manually_authored",
         "sub_steps": [{"step_id": "h2", "name": "Ask - twice", "state": "hidden"}]}])
    merged = _merge_steps([parent], [])
    subs = merged[0]["sub_steps"]
    assert [s["process_label"] for s in subs] == ["Enter Ship to - Street", "Call the bank"]
    assert subs[1]["sub_steps"][0]["process_label"] == "Ask"


def _run(cid, start, end):
    return {"case_id": cid, "parent_case_id": None, "start_ts": start, "end_ts": end}


def test_sub_steps_take_their_parents_transaction_at_every_depth():
    cases = {"run-1": _run("run-1", _ts(0), _ts(60)), "run-2": _run("run-2", _ts(100), _ts(160))}
    moved = _draft("M1", [], state="edited", case_id="a-removed-run",
                   time_range={"start": _ts(110), "end": _ts(120)},
                   sub_steps=[_sub("s1", "Enter Customer", 111, [], case_id="a-removed-run",
                                   sub_steps=[_sub("s2", "Type", 112, [])])])
    kept = _draft("K1", [], state="confirmed", case_id="run-1",
                  sub_steps=[_sub("s3", "Click Find", 2, [], case_id="stale")])
    count = restamp_preserved_case_ids([moved, kept], cases)
    assert count == 1                                     # sub-steps are not counted
    assert moved["case_id"] == "run-2"
    assert moved["sub_steps"][0]["case_id"] == "run-2"
    assert moved["sub_steps"][0]["sub_steps"][0]["case_id"] == "run-2"
    assert kept["sub_steps"][0]["case_id"] == "run-1"


# ---- end to end: normalize() twice ------------------------------------------------

def _inter(eid, sec, kind, control_type, name):
    data = {"kind": kind, "control_type": control_type, "name": name,
            "automation_id": name.lower(), "process_name": "crm.exe",
            "window_title": "CRM - Orders"}
    if kind == "value_changed":
        data["value"] = "typed text"
    return {"event_id": eid, "type": "interaction", "timestamp": _ts(sec),
            "session_id": SESSION_ID, "data": data}


def _events(prefix, s):
    """One marked run on one screen: three drafts under the C1 rule (typing
    and Find, Save, typing and Submit)."""
    return [
        {"event_id": f"{prefix}-start", "type": "marker", "timestamp": _ts(s),
         "session_id": SESSION_ID, "data": {"marker_type": "start", "label": f"Order {prefix}"}},
        {"event_id": f"{prefix}-act", "type": "activity", "timestamp": _ts(s),
         "session_id": SESSION_ID,
         "data": {"app": "crm.exe", "title": "CRM - Orders", "pid": 1, "duration_ms": 9000}},
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
    events = _events("a", 1) + _events("b", 20)
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


def _write(folder: Path, anno: dict) -> None:
    (folder / "annotations.json").write_text(json.dumps(anno), encoding="utf-8")


@pytest.fixture(autouse=True)
def _restore_root_logging():
    """normalize() attaches <session>/normalize.log to the root logger;
    detach and close it so tmp folders are not held open."""
    root = logging.getLogger()
    before, level = list(root.handlers), root.level
    yield
    for h in list(root.handlers):
        if h not in before:
            root.removeHandler(h)
            h.close()
    root.setLevel(level)


def _by_run(anno):
    """{run label letter: the run's top-level steps in time order}."""
    out: dict[str, list] = {}
    for s in sorted(anno["steps"], key=lambda s: s["time_range"]["start"]):
        first = s["evidence"]["interaction_event_ids"][0]
        out.setdefault(first[0], []).append(s)
    return out


def _projection(steps):
    """The subtree as the analyst left it: every key but the two the
    pipeline stamps (process_label, case_id)."""
    return [{k: (_projection(v) if k == "sub_steps" else v) for k, v in s.items()
             if k not in ("process_label", "case_id")} for s in steps]


def _walk(steps):
    for s in steps:
        yield s
        yield from _walk(s.get("sub_steps") or [])


@deps
def test_opened_and_confirmed_sub_processes_keep_their_subtrees_across_re_analysis(tmp_path):
    import normalize as normalize_mod
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    anno = _read(session, "annotations.json")
    runs = _by_run(anno)
    opened, confirmed = runs["a"][0], runs["b"][0]
    # Run a's first draft opened as a sub-process (still a draft: the
    # pipeline promotes it), a drafted sub-step per action and a nested
    # sub-process added by hand; run b's first draft confirmed with its own.
    opened["sub_steps"] = [
        _sub("sa1", "Enter Customer", 2, ["a-i1"]),
        _sub("sa2", "Click Find", 3, ["a-i2"]),
        {"step_id": "sa3", "name": "Check the credit", "state": "manually_authored",
         "time_range": None, "order": 1, "description": "Only for new customers.",
         "evidence": {"interaction_event_ids": [], "screenshot_refs": []},
         "sub_steps": [{"step_id": "sa4", "name": "Call the bank", "state": "manually_authored",
                        "time_range": None, "order": 1,
                        "evidence": {"interaction_event_ids": [], "screenshot_refs": []}}]}]
    confirmed["state"] = "confirmed"
    confirmed["sub_steps"] = [_sub("sb1", "Enter Customer", 21, ["b-i1"]),
                              _sub("sb2", "Click Find", 22, ["b-i2"])]
    before = {s["step_id"]: _projection(s["sub_steps"]) for s in (opened, confirmed)}
    _write(session, anno)
    for _ in range(2):
        normalize_mod.normalize(session, mine=True)
        steps = _read(session, "annotations.json")["steps"]
        by_id = {s["step_id"]: s for s in steps}
        assert len(steps) == 6                                   # no fresh draft over them
        assert by_id[opened["step_id"]]["state"] == "edited"
        assert by_id[confirmed["step_id"]]["state"] == "confirmed"
        for sid, subtree in before.items():
            parent = by_id[sid]
            assert _projection(parent["sub_steps"]) == subtree
            for sub in _walk(parent["sub_steps"]):
                assert sub["case_id"] == parent["case_id"]
                assert isinstance(sub["process_label"], str) and sub["process_label"]
        covered = {"a-i1", "a-i2", "b-i1", "b-i2"}
        assert not [s for s in steps if s["state"] == "auto_suggested"
                    and covered & set(s["evidence"]["interaction_event_ids"])]
    # The main level is what the stats read: six steps, none of the sub-steps.
    assert _read(session, "stats.json")["meta"]["step_count"] == 6
    bpmn = (session / "process_map_step.bpmn").read_text(encoding="utf-8")
    assert bpmn.count("<bpmn:subProcess ") == 2                  # the opened one, the nested one
    assert 'name="Check the credit"' in bpmn and 'isExpanded="false"' in bpmn


@deps
def test_a_group_makes_the_next_analysis_drop_fresh_drafts_of_its_members(tmp_path):
    import normalize as normalize_mod
    session = _make_session(tmp_path / "s")
    normalize_mod.normalize(session)
    anno = _read(session, "annotations.json")
    runs = _by_run(anno)
    members = runs["a"][1:]                                      # Save; Note and Submit
    ids = [e for m in members for e in m["evidence"]["interaction_event_ids"]]
    group = {"step_id": "G1", "name": "Save and submit", "group": True,
             "state": "manually_authored", "case_id": members[0]["case_id"],
             "time_range": {"start": members[0]["time_range"]["start"],
                            "end": members[-1]["time_range"]["end"]},
             "evidence": {"interaction_event_ids": ids,
                          "screenshot_refs": [r for m in members
                                              for r in m["evidence"]["screenshot_refs"]]},
             "description": "", "sub_steps": members}
    anno["steps"] = [s for s in anno["steps"] if s not in members] + [group]
    before = _projection(members)
    _write(session, anno)
    normalize_mod.normalize(session, mine=True)
    steps = _read(session, "annotations.json")["steps"]
    # No fresh draft of the grouped interactions came back at the main level.
    assert not [s for s in steps if s.get("step_id") != "G1"
                and set(ids) & set(s["evidence"]["interaction_event_ids"])]
    assert len(steps) == 5
    kept = next(s for s in steps if s["step_id"] == "G1")
    assert kept["state"] == "manually_authored" and kept["group"] is True
    assert kept["process_label"] == "Save and submit"
    assert _projection(kept["sub_steps"]) == before
    assert [s["state"] for s in kept["sub_steps"]] == ["auto_suggested", "auto_suggested"]
    assert all(s["case_id"] == kept["case_id"] for s in kept["sub_steps"])
    bpmn = (session / "process_map_step.bpmn").read_text(encoding="utf-8")
    assert '<bpmn:subProcess id="' in bpmn and 'name="Save and submit"' in bpmn
