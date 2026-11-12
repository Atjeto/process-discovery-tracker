"""Contract C25: what the automation does with a step (`step.automation`) and
who does it (`step.done_by`), as the pipeline reads them (step_context): the
choice a step reads as, the recording's role, who does a step, and a draft
given either kept as the analyst's by the next analysis.

Pure stdlib, so this suite runs under any pytest.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from step_context import (AUTOMATION_WORDS, DONE_BY_MAX, StepContext, declares_scope,
                          recording_role, step_automation, step_done_by)


def test_the_four_choices_read_in_the_words_of_c25():
    assert AUTOMATION_WORDS == {"undecided": "Not decided yet", "automated": "The automation does it",
                                "person": "Stays with a person", "not_needed": "No longer needed"}


def test_a_step_reads_as_its_choice():
    assert step_automation({}) == "undecided"                       # absent
    for value in AUTOMATION_WORDS:
        assert step_automation({"automation": value}) == value
    assert step_automation(None) == "undecided"


def test_an_older_waste_flag_without_a_choice_reads_no_longer_needed():
    assert step_automation({"flags": {"waste": True}}) == "not_needed"
    assert step_automation({"flags": {"waste": False}}) == "undecided"
    # A choice wins over the flag (the viewer keeps them in step).
    assert step_automation({"automation": "automated", "flags": {"waste": True}}) == "automated"


def test_an_unknown_value_reads_not_decided_yet():
    assert step_automation({"automation": "robot"}) == "undecided"
    assert step_automation({"automation": "robot", "flags": {"waste": True}}) == "undecided"
    assert step_automation({"automation": 3}) == "undecided"


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


def test_a_draft_given_a_choice_or_a_done_by_is_the_analysts_and_survives_the_analysis():
    from step_suggest import _merge_steps
    assert declares_scope({"automation": "person"}) and declares_scope({"done_by": "Ana"})
    assert not declares_scope({"done_by": "  "}) and not declares_scope({}) and not declares_scope(None)
    drafts = [{"step_id": f"d{k}", "case_id": "c1", "name": "Save", "state": "auto_suggested",
               "time_range": {"start": f"2026-09-01T09:00:0{k}Z", "end": f"2026-09-01T09:00:0{k}Z"},
               "evidence": {"interaction_event_ids": []}, **extra}
              for k, extra in enumerate(({"automation": "automated"}, {"done_by": "Ana"}, {}))]
    kept = _merge_steps(drafts, [])
    assert [(s["step_id"], s["state"]) for s in kept] == [("d0", "edited"), ("d1", "edited")]
    assert kept[0]["automation"] == "automated" and kept[1]["done_by"] == "Ana"
