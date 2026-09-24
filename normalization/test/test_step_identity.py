"""Re-analyze identity inheritance (_merge_steps / _inherit_step_identity).

Fresh auto steps are regenerated with new ids on every analyze: the fresh step
that re-covers the same interactions inherits the prior step's id, so anything
keyed on step_id keeps resolving. Legacy phase / template links on a prior
step (phases and canonical matching were removed) are no longer carried.

Run with:
    pytest normalization/test/test_step_identity.py
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from step_suggest import _merge_steps


def _step(step_id, state, event_ids, *, phase_id=None, canonical_step_id=None):
    s = {
        "step_id": step_id,
        "state": state,
        "evidence": {"interaction_event_ids": list(event_ids)},
        "time_range": {"start": "2026-05-18T09:00:00Z", "end": "2026-05-18T09:00:10Z"},
    }
    if phase_id is not None:
        s["phase_id"] = phase_id
    if canonical_step_id is not None:
        s["canonical_step_id"] = canonical_step_id
    return s


def test_fresh_auto_step_inherits_prior_id():
    """An auto_suggested step keeps its id when re-analyze regenerates it."""
    prior = _step("S1", "auto_suggested", ["e1", "e2", "e3"])
    fresh = _step("NEW", "auto_suggested", ["e1", "e2", "e3"])
    merged = _merge_steps([prior], [fresh])
    assert len(merged) == 1
    assert merged[0]["step_id"] == "S1"


def test_legacy_phase_and_template_links_are_not_carried():
    """Phases and canonical matching were removed: a prior step's legacy
    phase_id / canonical_step_id no longer ride onto the fresh step (they used
    to), while the step id itself is still inherited."""
    prior = _step("S1", "auto_suggested", ["e1", "e2"],
                  phase_id="P1", canonical_step_id="C9")
    fresh = _step("NEW", "auto_suggested", ["e1", "e2"])
    merged = _merge_steps([prior], [fresh])
    assert merged[0]["step_id"] == "S1"
    assert merged[0].get("phase_id") is None
    assert merged[0].get("canonical_step_id") is None


def test_step_that_grew_by_one_event_still_inherits():
    """Segmentation drift (a step gains one trailing interaction) still counts
    as the same step -- majority of both sets overlap."""
    prior = _step("S1", "auto_suggested", ["e1", "e2", "e3"])
    fresh = _step("NEW", "auto_suggested", ["e1", "e2", "e3", "e4"])
    merged = _merge_steps([prior], [fresh])
    assert merged[0]["step_id"] == "S1"


def test_no_overlap_keeps_new_id():
    """Disjoint events -> no inheritance (the prior behaviour; no false link)."""
    prior = _step("S1", "auto_suggested", ["e1", "e2"], phase_id="P1")
    fresh = _step("NEW", "auto_suggested", ["x1", "x2", "x3"])
    merged = _merge_steps([prior], [fresh])
    assert merged[0]["step_id"] == "NEW"


def test_weak_overlap_does_not_inherit():
    """A tiny shared slice is not enough -- a majority of BOTH sets is required,
    so a small fresh step does not steal a big prior step's identity."""
    prior = _step("S1", "auto_suggested", ["e1", "e2", "e3", "e4", "e5"], phase_id="P1")
    fresh = _step("NEW", "auto_suggested", ["e1"])
    merged = _merge_steps([prior], [fresh])
    assert merged[0]["step_id"] == "NEW"


def test_manual_step_preserved_and_overlapping_fresh_dropped():
    """A manually_authored prior is preserved verbatim; a fresh step overlapping
    its time range is dropped (existing I37 behaviour), not merged."""
    prior = _step("M1", "manually_authored", ["e1", "e2"], phase_id="P1")
    fresh = _step("NEW", "auto_suggested", ["e1", "e2"])
    merged = _merge_steps([prior], [fresh])
    assert len(merged) == 1
    assert merged[0]["step_id"] == "M1"
    assert merged[0]["state"] == "manually_authored"


def test_merge_stamps_value_free_process_label():
    """_merge_steps stamps a value-free process_label so the step-level map/flow
    collapses repeated work across cases instead of one node per instance."""
    fresh = _step("N1", "auto_suggested", ["e1", "e2"])
    fresh["name"] = "Salesforce: Search — CUST-10001"
    merged = _merge_steps([], [fresh])
    assert merged[0]["process_label"] == "Salesforce: Search"


def test_each_prior_claimed_at_most_once():
    """Two fresh steps cannot both inherit the same prior id."""
    prior = _step("S1", "auto_suggested", ["e1", "e2", "e3"], phase_id="P1")
    f1 = _step("N1", "auto_suggested", ["e1", "e2", "e3"])
    f2 = _step("N2", "auto_suggested", ["e1", "e2", "e3"])
    merged = _merge_steps([prior], [f1, f2])
    ids = [s["step_id"] for s in merged]
    assert "S1" in ids
    assert len(set(ids)) == 2  # no duplicate ids


# --- C2 / C9 (RP-01): confirmed steps and run restamping -------------------

def test_confirmed_step_survives_merge_unchanged():
    """C2: a draft the analyst confirmed is preserved exactly like an edited
    step. It used to be treated as an auto step: re-analysis replaced it with
    a fresh auto_suggested draft that took over its id."""
    import copy
    prior = _step("C1", "confirmed", ["e1", "e2", "e3"])
    prior["name"] = "Look up customer"
    prior["case_id"] = "run-1"
    before = copy.deepcopy(prior)
    fresh = _step("NEW", "auto_suggested", ["e1", "e2", "e3"])
    fresh["name"] = "CRM: Search"
    merged = _merge_steps([prior], [fresh])
    assert [s["step_id"] for s in merged] == ["C1"]
    for key in ("state", "name", "case_id", "evidence", "time_range"):
        assert merged[0][key] == before[key], f"confirmed step changed its {key}"


def _timed(step_id, state, case_id, start, end):
    s = _step(step_id, state, [])
    s["case_id"] = case_id
    s["time_range"] = {"start": start, "end": end}
    return s


def _run(cid, start, end, parent=None):
    return {"case_id": cid, "parent_case_id": parent, "start_ts": start, "end_ts": end}


def test_preserved_step_with_a_legacy_case_id_moves_to_the_run_containing_it():
    """C9: a preserved analyst step whose case_id is not a current run id (a
    legacy random id) is restamped by time containment; no containing run
    gives None. Current ids and auto steps are never touched."""
    from step_suggest import restamp_preserved_case_ids
    cases = {
        "run-1": _run("run-1", "2026-05-18T09:00:00Z", "2026-05-18T09:05:00Z"),
        "run-2": _run("run-2", "2026-05-18T09:10:00Z", "2026-05-18T09:15:00Z"),
    }
    legacy = _timed("M1", "manually_authored", "0b6f3c9e-legacy-random",
                    "2026-05-18T09:11:00Z", "2026-05-18T09:12:00Z")
    outside = _timed("M2", "edited", "0b6f3c9e-legacy-random",
                     "2026-05-18T09:06:00Z", "2026-05-18T09:07:00Z")
    current = _timed("M3", "confirmed", "run-1",
                     "2026-05-18T09:11:00Z", "2026-05-18T09:12:00Z")
    auto = _timed("A1", "auto_suggested", "0b6f3c9e-legacy-random",
                  "2026-05-18T09:11:00Z", "2026-05-18T09:12:00Z")
    moved = restamp_preserved_case_ids([legacy, outside, current, auto], cases)
    assert legacy["case_id"] == "run-2"
    assert outside["case_id"] is None
    assert current["case_id"] == "run-1"
    assert auto["case_id"] == "0b6f3c9e-legacy-random"
    assert moved == 2


def test_restamp_prefers_the_outermost_run_and_an_open_run_spans_to_the_end():
    """Nested runs both contain the step: the outermost wins, as for auto
    steps. A run with no end marker contains everything after its start."""
    from step_suggest import restamp_preserved_case_ids
    cases = {
        "outer": _run("outer", "2026-05-18T09:00:00Z", "2026-05-18T09:30:00Z"),
        "inner": _run("inner", "2026-05-18T09:10:00Z", "2026-05-18T09:15:00Z",
                      parent="outer"),
        "open": _run("open", "2026-05-18T10:00:00Z", None),
    }
    nested = _timed("M1", "hidden", None,
                    "2026-05-18T09:11:00Z", "2026-05-18T09:12:00Z")
    late = _timed("M2", "manually_authored", "gone",
                  "2026-05-18T11:00:00Z", "2026-05-18T11:01:00Z")
    restamp_preserved_case_ids([nested, late], cases)
    assert nested["case_id"] == "outer"
    assert late["case_id"] == "open"


def test_the_implicit_run_takes_every_step_whose_run_is_gone_timed_or_not():
    """C16: the implicit run of a video or blank session covers the whole
    session, so a preserved step with no current run (a null case_id, or a
    run removed with its markers) joins it, a step without a time too."""
    from step_suggest import restamp_preserved_case_ids
    cases = {"imp": {**_run("imp", "2026-05-18T09:00:00Z", None), "implicit": True}}
    untimed = _step("M1", "manually_authored", [])
    untimed["case_id"], untimed["time_range"], untimed["order"] = None, None, 1
    early = _timed("M2", "edited", "a-removed-run",
                   "2026-05-18T08:00:00Z", "2026-05-18T08:01:00Z")
    current = _timed("M3", "confirmed", "imp",
                     "2026-05-18T09:11:00Z", "2026-05-18T09:12:00Z")
    moved = restamp_preserved_case_ids([untimed, early, current], cases)
    assert [s["case_id"] for s in (untimed, early, current)] == ["imp", "imp", "imp"]
    assert moved == 2


def test_without_the_implicit_run_a_step_without_a_time_is_in_no_run():
    """A recording (or a session whose runs were marked by hand) restamps by
    time, so a step without one belongs to no run."""
    from step_suggest import restamp_preserved_case_ids
    cases = {"run-1": _run("run-1", "2026-05-18T09:00:00Z", None)}
    untimed = _step("M1", "manually_authored", [])
    untimed["case_id"], untimed["time_range"] = "gone", None
    restamp_preserved_case_ids([untimed], cases)
    assert untimed["case_id"] is None
