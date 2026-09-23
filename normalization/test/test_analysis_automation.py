"""Tests for analysis_automation -- segment-grain candidacy (ADR-0016).

Candidacy is reported at the level of a coherent segment -- a
contiguous run of work in one app within one case -- not a single
click. `score_automation` consumes the same events + steps the rest of
the analysis layer sees and emits one row per detected segment pattern
(grouped across cases by signature).

Run with pytest:
    pytest normalization/test/test_analysis_automation.py
or directly:
    python normalization/test/test_analysis_automation.py
"""

from __future__ import annotations
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from analysis_automation import score_automation

_BASE = datetime(2026, 5, 17, 10, 0, 0, tzinfo=timezone.utc)


def _ts(sec):
    return (_BASE + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _step(sid, label, eids, canonical=None):
    return {
        "step_id": sid,
        "name": label,
        "process_label": label,
        "canonical_step_id": canonical,
        "time_range": {"start": _ts(0), "end": _ts(0)},
        "evidence": {"interaction_event_ids": list(eids)},
        "state": "auto_suggested",
    }


def _interaction(eid, sec, app, case_id):
    return {"type": "interaction", "event_id": eid, "timestamp": _ts(sec),
            "data": {"process_name": app, "window_title": app,
                     "value": "", "automation_id": "x",
                     "case_ids": [case_id] if case_id else []}}


def test_single_segment_reports_single_instance():
    # One case, one app, three steps -- one segment, one instance.
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 1, "crm.exe", "c1"),
        _interaction("i3", 2, "crm.exe", "c1"),
    ]
    steps = [
        _step("s1", "Search", ["i1"]),
        _step("s2", "Copy", ["i2"]),
        _step("s3", "Paste", ["i3"]),
    ]
    out = score_automation(steps, events)
    assert len(out) == 1
    row = out[0]
    assert row["data_sufficiency"] == "single_instance"
    assert row["instance_count"] == 1
    assert row["scores"]["confidence"] is None
    assert row["estimated_savings_ms"] is None


def test_two_matching_segments_score_as_multi_instance():
    # Same app + same step sequence across two cases -> one row,
    # 2 instances, multi_instance sufficiency.
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 1, "crm.exe", "c1"),
        _interaction("i3", 2, "crm.exe", "c1"),
        _interaction("i4", 100, "crm.exe", "c2"),
        _interaction("i5", 101, "crm.exe", "c2"),
        _interaction("i6", 102, "crm.exe", "c2"),
    ]
    steps = [
        _step("s1", "Search", ["i1"]),
        _step("s2", "Copy", ["i2"]),
        _step("s3", "Paste", ["i3"]),
        _step("s4", "Search", ["i4"]),
        _step("s5", "Copy", ["i5"]),
        _step("s6", "Paste", ["i6"]),
    ]
    out = score_automation(steps, events)
    assert len(out) == 1
    row = out[0]
    assert row["data_sufficiency"] == "multi_instance"
    assert row["instance_count"] == 2
    assert sorted(row["case_ids"]) == ["c1", "c2"]
    assert row["scores"]["confidence"] is not None


def test_automation_confirmed_from_override_keyed_by_signature():
    # The new override identity field is segment_signature, not step_id.
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 1, "crm.exe", "c1"),
        _interaction("i3", 2, "crm.exe", "c1"),
        _interaction("i4", 100, "crm.exe", "c2"),
        _interaction("i5", 101, "crm.exe", "c2"),
        _interaction("i6", 102, "crm.exe", "c2"),
    ]
    steps = [
        _step("s1", "Search", ["i1"]),
        _step("s2", "Copy", ["i2"]),
        _step("s3", "Paste", ["i3"]),
        _step("s4", "Search", ["i4"]),
        _step("s5", "Copy", ["i5"]),
        _step("s6", "Paste", ["i6"]),
    ]
    # No override -> automation_confirmed is None.
    out = score_automation(steps, events)
    sig = out[0]["segment_signature"]
    assert out[0]["automation_confirmed"] is None

    anno = {"analysis_overrides": [
        {"segment_signature": sig, "automation_confirmed": True},
    ]}
    out2 = score_automation(steps, events, annotations=anno)
    assert out2[0]["automation_confirmed"] is True

    anno2 = {"analysis_overrides": [
        {"segment_signature": sig, "automation_confirmed": False},
    ]}
    out3 = score_automation(steps, events, annotations=anno2)
    assert out3[0]["automation_confirmed"] is False


def test_total_and_mean_elapsed_are_summed_across_instances():
    # Two segments, 3s and 5s elapsed -- pooled total 8s, mean 4s.
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 1, "crm.exe", "c1"),
        _interaction("i3", 3, "crm.exe", "c1"),
        _interaction("i4", 100, "crm.exe", "c2"),
        _interaction("i5", 101, "crm.exe", "c2"),
        _interaction("i6", 105, "crm.exe", "c2"),
    ]
    steps = [
        _step("s1", "Search", ["i1"]),
        _step("s2", "Copy", ["i2"]),
        _step("s3", "Paste", ["i3"]),
        _step("s4", "Search", ["i4"]),
        _step("s5", "Copy", ["i5"]),
        _step("s6", "Paste", ["i6"]),
    ]
    out = score_automation(steps, events)
    row = out[0]
    assert row["total_elapsed_ms"] == 8000
    assert row["mean_elapsed_ms"] == 4000


def _two_patterns():
    """A frequent-but-short crm pattern (3 instances, ~1s each) and a
    rarer-but-long sap pattern (2 instances, ~5s each). Old instance-count-first
    ordering would rank crm first; priority ordering ranks sap first."""
    events = [
        # c1: short crm seg, then long sap seg
        _interaction("a1", 0, "crm.exe", "c1"), _interaction("a2", 1, "crm.exe", "c1"),
        _interaction("b1", 10, "sap.exe", "c1"), _interaction("b2", 15, "sap.exe", "c1"),
        # c2: same two patterns
        _interaction("a3", 100, "crm.exe", "c2"), _interaction("a4", 101, "crm.exe", "c2"),
        _interaction("b3", 110, "sap.exe", "c2"), _interaction("b4", 115, "sap.exe", "c2"),
        # c3: only the crm pattern (3rd instance)
        _interaction("a5", 200, "crm.exe", "c3"), _interaction("a6", 201, "crm.exe", "c3"),
    ]
    steps = [
        _step("p1", "Search", ["a1"]), _step("p2", "Copy", ["a2"]),
        _step("q1", "Open", ["b1"]), _step("q2", "Submit", ["b2"]),
        _step("p3", "Search", ["a3"]), _step("p4", "Copy", ["a4"]),
        _step("q3", "Open", ["b3"]), _step("q4", "Submit", ["b4"]),
        _step("p5", "Search", ["a5"]), _step("p6", "Copy", ["a6"]),
    ]
    return events, steps


def test_rank_orders_by_priority_not_instance_count():
    events, steps = _two_patterns()
    out = score_automation(steps, events)
    multi = [r for r in out if r["data_sufficiency"] == "multi_instance"]
    assert len(multi) == 2
    by_app = {r["app"]: r for r in multi}
    crm, sap = by_app["crm.exe"], by_app["sap.exe"]
    # crm is more frequent (3 vs 2) but sap's mean time dominates the priority.
    assert crm["instance_count"] == 3 and sap["instance_count"] == 2
    assert sap["rank_score"] > crm["rank_score"]
    assert sap["rank"] == 1 and crm["rank"] == 2
    # rank_score = instance_count × mean × automatable_fraction (default 0.7).
    assert sap["rank_score"] == round(sap["instance_count"] * sap["mean_elapsed_ms"] * 0.7, 2)


def test_legacy_roi_inputs_no_longer_move_the_rank():
    """The ROI layer and its per-segment automatable-fraction overrides were
    removed: a legacy roi_inputs block in an old annotations.json is carried
    along untouched but no longer read, so the fraction stays at the 0.7
    default and the priority order is unchanged."""
    events, steps = _two_patterns()
    base = score_automation(steps, events)
    sap_sig = next(r["segment_signature"] for r in base if r["app"] == "sap.exe")
    # This override used to knock sap down so crm's priority won.
    anno = {"roi_inputs": {"automatable_fraction_overrides": {sap_sig: 0.1}}}
    out = score_automation(steps, events, annotations=anno)
    multi = [r for r in out if r["data_sufficiency"] == "multi_instance"]
    by_app = {r["app"]: r for r in multi}
    assert by_app["sap.exe"]["automatable_fraction"] == 0.7
    assert by_app["sap.exe"]["rank"] == 1
    assert by_app["crm.exe"]["rank"] == 2


def test_single_instance_has_no_rank():
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 1, "crm.exe", "c1"),
    ]
    steps = [_step("s1", "Search", ["i1"]), _step("s2", "Copy", ["i2"])]
    row = score_automation(steps, events)[0]
    assert row["data_sufficiency"] == "single_instance"
    assert row["rank"] is None
    assert row["rank_score"] == 0.0


def test_atomic_step_signal_does_not_appear():
    # The old per-step output keys are gone -- no step_id, no
    # sequence_signature, no per-step repetitiveness/rule_based scores.
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 1, "crm.exe", "c1"),
        _interaction("i3", 2, "crm.exe", "c1"),
    ]
    steps = [
        _step("s1", "Search", ["i1"]),
        _step("s2", "Copy", ["i2"]),
        _step("s3", "Paste", ["i3"]),
    ]
    row = score_automation(steps, events)[0]
    assert "step_id" not in row
    assert "sequence_signature" not in row
    assert "repetitiveness" not in (row.get("scores") or {})
    assert "rule_based" not in (row.get("scores") or {})
    assert "segment_signature" in row
    assert "label" in row


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
