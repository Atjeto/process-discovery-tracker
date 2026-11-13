"""Contract C25 (as amended 2026-11-13): whether a step is no longer needed
(`flags.waste`, a stored `automation: "not_needed"` read the same) and who
does it (`step.done_by`), as the pipeline reads them (step_context): the
tick a step reads as, the recording's role, who does a step, and a draft
given a Done by kept as the analyst's by the next analysis.

Pure stdlib, so this suite runs under any pytest.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from step_context import (DONE_BY_MAX, StepContext, declares_scope, recording_role,
                          step_done_by, step_not_needed)


def test_a_step_is_no_longer_needed_when_its_waste_flag_is_set():
    assert step_not_needed({"flags": {"waste": True}})
    assert not step_not_needed({"flags": {"waste": False}})
    assert not step_not_needed({}) and not step_not_needed({"flags": {}})
    assert not step_not_needed(None) and not step_not_needed("step")
    assert not step_not_needed({"flags": {"waste": "yes"}})


def test_the_choice_a_project_saved_on_2026_11_12_reads_as_ticked():
    # A stored "not_needed" without a waste flag reads as ticked...
    assert step_not_needed({"automation": "not_needed"})
    assert step_not_needed({"automation": "not_needed", "flags": {}})
    # ...but the flag, once written (the tick), decides: an untick holds.
    assert not step_not_needed({"automation": "not_needed", "flags": {"waste": False}})
    assert step_not_needed({"automation": "person", "flags": {"waste": True}})


def test_the_other_stored_choices_are_ignored():
    for value in ("automated", "person", "undecided", "robot", 3, None):
        assert not step_not_needed({"automation": value}), value


def test_the_recordings_role_is_the_capture_profiles_with_a_capital():
    assert recording_role({"config": {"worker": {"id": "mk", "role": "sales  assistant "}}}) == "Sales assistant"
    assert recording_role({"config": {"worker": {"id": "mk"}}}) == ""
    assert recording_role({"config": {"worker": {"role": None}}}) == ""
    assert recording_role({}) == "" and recording_role(None) == ""


def test_who_does_a_step_its_own_else_the_role_else_nobody():
    assert step_done_by({"done_by": "  Finance\nclerk "}, "Sales assistant") == "Finance clerk"
    assert step_done_by({"done_by": "   "}, "Sales assistant") == "Sales assistant"
    assert step_done_by({}, "Sales assistant") == "Sales assistant"
    assert step_done_by({}, "") == "" and step_done_by(None) == ""
    assert step_done_by({"done_by": "x" * 120}) == "x" * DONE_BY_MAX
    ctx = StepContext({}, {}, vocabs=[], role="Order processor")
    assert ctx.done_by({}) == "Order processor" and ctx.done_by({"done_by": "Maria"}) == "Maria"
    assert StepContext({}, {}, vocabs=[]).done_by({}) == ""


def test_a_draft_given_a_done_by_is_the_analysts_and_survives_the_analysis():
    from step_suggest import _merge_steps
    assert declares_scope({"done_by": "Ana"})
    assert not declares_scope({"automation": "person"})
    assert not declares_scope({"done_by": "  "}) and not declares_scope({}) and not declares_scope(None)
    drafts = [{"step_id": f"d{k}", "case_id": "c1", "name": "Save", "state": "auto_suggested",
               "time_range": {"start": f"2026-09-01T09:00:0{k}Z", "end": f"2026-09-01T09:00:0{k}Z"},
               "evidence": {"interaction_event_ids": []}, **extra}
              for k, extra in enumerate(({"done_by": "Ana"}, {"automation": "automated"}, {}))]
    kept = _merge_steps(drafts, [])
    assert [(s["step_id"], s["state"]) for s in kept] == [("d0", "edited")]
    assert kept[0]["done_by"] == "Ana"
