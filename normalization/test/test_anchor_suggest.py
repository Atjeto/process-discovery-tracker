"""Deterministic regression tests for anchor_suggest (ADR-0018).

Named scenarios against hand-built fixtures. The fuzzer in
test_anchor_suggest_fuzz.py covers robustness; this file pins
behaviour. Fixtures don't touch committed demo data.
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from anchor_suggest import (  # noqa: E402
    coerce_anchor_override,
    merge_anchor_candidates,
    signature_of_anchor_config,
    suggest_anchors,
)
from case_assignment import detect_cases_from_anchors  # noqa: E402


# ---------------------------------------------------------------------------
# Fixture helpers

T0 = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)


def _iso(t: datetime) -> str:
    return t.isoformat().replace("+00:00", "Z")


def _at(seconds: float) -> str:
    return _iso(T0 + timedelta(seconds=seconds))


def _typing(
    seconds: float, value: str, *,
    automation_id: str = "", name: str = "",
    window_title: str = "App",
    kind: str = "value_changed",
) -> dict:
    return {
        "event_id": f"i-{uuid.uuid4().hex[:8]}",
        "type": "interaction",
        "timestamp": _at(seconds),
        "data": {
            "kind": kind,
            "automation_id": automation_id,
            "name": name,
            "value": value,
            "control_type": "Edit",
            "window_title": window_title,
            "process_name": "chrome.exe",
            "case_ids": [],
        },
    }


def _click(seconds: float, *, name: str = "Save", window_title: str = "App") -> dict:
    return {
        "event_id": f"c-{uuid.uuid4().hex[:8]}",
        "type": "interaction",
        "timestamp": _at(seconds),
        "data": {
            "kind": "invoked",
            "control_type": "Button",
            "name": name,
            "window_title": window_title,
            "process_name": "chrome.exe",
            "case_ids": [],
        },
    }


def _typical_case(start_s: float, customer_id: str) -> list[dict]:
    """One case: type a customer ID, do some work (typing fields,
    clicking buttons), 30 s of activity. Returns 9 events."""
    events: list[dict] = []
    t = start_s
    # The would-be case anchor.
    events.append(_typing(t, customer_id, automation_id="customer-id-field",
                          name="Customer ID", window_title="Order entry"))
    t += 2.0
    events.append(_typing(t, "Widget-" + customer_id[-4:],
                          automation_id="product-code", name="Product code",
                          window_title="Order entry"))
    t += 2.0
    events.append(_typing(t, "10", automation_id="quantity", name="Quantity",
                          window_title="Order entry"))
    t += 2.0
    events.append(_typing(t, "100.00", automation_id="unit-price",
                          name="Unit price", window_title="Order entry"))
    t += 2.0
    events.append(_click(t, name="Save order", window_title="Order entry"))
    t += 2.0
    return events


# ---------------------------------------------------------------------------
# Empty / trivial inputs

def test_empty_events_returns_empty():
    assert suggest_anchors([]) == []


def test_single_typing_returns_empty():
    """One typed event can't split the session into cases."""
    e = _typing(0, "ABC-1", automation_id="x", name="X")
    assert suggest_anchors([e]) == []


def test_focus_only_events_returns_empty():
    """A focus_changed event with no typed value doesn't count as a
    candidate fire."""
    events = [
        {"event_id": f"f-{i}", "type": "interaction",
         "timestamp": _at(i),
         "data": {"kind": "focus_changed", "automation_id": "x",
                  "name": "X", "window_title": "App",
                  "process_name": "chrome.exe", "case_ids": []}}
        for i in range(5)
    ]
    assert suggest_anchors(events) == []


# ---------------------------------------------------------------------------
# Headline scenario -- recovers the case anchor on a 3-case session

def test_recovers_customer_id_field_in_3_case_session():
    events = (_typical_case(0,    "CUST-11255")
              + _typical_case(60,  "CUST-11256")
              + _typical_case(120, "CUST-11257"))
    cands = suggest_anchors(events)
    assert cands, "expected at least one anchor candidate"
    # The customer-id-field is the strongest because it splits into 3
    # well-balanced cases with 3 distinct labels.
    top = cands[0]
    assert top["display"]["field_value"] == "customer-id-field", \
        f"expected customer-id-field first, got {top['display']}"
    assert top["metrics"]["case_count"] == 3
    assert top["metrics"]["distinct_labels"] == 3
    assert set(top["display"]["sample_values"]) == {
        "CUST-11255", "CUST-11256", "CUST-11257"
    }


def test_top_candidate_anchor_config_actually_splits():
    """The anchor_config the detector emits must be acceptable to
    detect_cases_from_anchors and produce the same case structure."""
    events = (_typical_case(0,    "CUST-11255")
              + _typical_case(60,  "CUST-11256")
              + _typical_case(120, "CUST-11257"))
    cands = suggest_anchors(events)
    interactions = [e for e in events if e["type"] == "interaction"]
    cases = detect_cases_from_anchors(interactions, cands[0]["anchor_config"])
    assert len(cases) == 3
    assert {c["label"] for c in cases} == {"CUST-11255", "CUST-11256", "CUST-11257"}


def test_window_title_hint_set():
    events = (_typical_case(0,    "CUST-11255")
              + _typical_case(60,  "CUST-11256"))
    cands = suggest_anchors(events)
    assert cands[0]["display"]["window_title_hint"] == "Order entry"


# ---------------------------------------------------------------------------
# Ranking

def test_field_with_distinct_per_case_outranks_field_with_repeats():
    """A field typed with a fresh value per case (good anchor) outranks
    a field repeatedly typed with the same value (bad anchor -- doesn't
    distinguish cases)."""
    events: list[dict] = []
    for i, cid in enumerate(["CUST-1", "CUST-2", "CUST-3"]):
        t = i * 30.0
        events.append(_typing(t, cid, automation_id="customer-id", name="cid"))
        events.append(_typing(t + 1, "ALWAYS-SAME",
                              automation_id="environment", name="env"))
        events.append(_typing(t + 2, "x", automation_id="other", name="oth"))
    cands = suggest_anchors(events)
    # customer-id should be the top -- it has 3 distinct labels;
    # environment has 1, which would never split anything.
    top = cands[0]
    assert top["display"]["field_value"] == "customer-id"
    # environment shouldn't even appear -- it produces 1 case (all-same
    # label collapses), below the _MIN_CASES=2 floor.
    field_values = [c["display"]["field_value"] for c in cands]
    assert "environment" not in field_values


def test_returns_at_most_top_n():
    """Many candidate fields -- detector returns only the top 5."""
    events: list[dict] = []
    for i in range(8):
        for j in range(3):
            events.append(_typing(i * 5 + j * 0.5, f"v{i}-{j}",
                                  automation_id=f"field-{i}",
                                  name=f"f{i}"))
    cands = suggest_anchors(events)
    assert len(cands) <= 5


# ---------------------------------------------------------------------------
# Signature stability + merge

def test_signature_stable_across_runs():
    events = (_typical_case(0,    "CUST-11255")
              + _typical_case(60,  "CUST-11256"))
    a = suggest_anchors(events)
    b = suggest_anchors(events)
    assert [c["signature"] for c in a] == [c["signature"] for c in b]


def test_signature_of_anchor_config_matches_candidate():
    events = (_typical_case(0,    "CUST-11255")
              + _typical_case(60,  "CUST-11256"))
    cand = suggest_anchors(events)[0]
    recomputed = signature_of_anchor_config(
        cand["anchor_config"], cand["display"]["window_title_hint"])
    assert recomputed == cand["signature"]


def test_merge_dismiss_drops_signature():
    events = (_typical_case(0,    "CUST-11255")
              + _typical_case(60,  "CUST-11256"))
    fresh = suggest_anchors(events)
    target = fresh[0]
    dismissed = [{"signature": target["signature"],
                  "dismissed_at": "now"}]
    merged = merge_anchor_candidates(existing=[], fresh=fresh,
                                     dismissed=dismissed)
    assert all(c["signature"] != target["signature"] for c in merged)


def test_merge_drops_override_signature():
    """A candidate whose signature is the accepted override doesn't
    re-appear in the live list."""
    events = (_typical_case(0,    "CUST-11255")
              + _typical_case(60,  "CUST-11256"))
    fresh = suggest_anchors(events)
    target = fresh[0]
    override = {
        "field": "automation_id",
        "equals": "customer-id-field",
        "case_label_from": "value",
        "_accepted_signature": target["signature"],
        "_accepted_at": "now",
    }
    merged = merge_anchor_candidates(
        existing=[], fresh=fresh, case_anchor_override=override)
    assert all(c["signature"] != target["signature"] for c in merged)


def test_merge_dedupes_within_fresh():
    events = (_typical_case(0,    "CUST-11255")
              + _typical_case(60,  "CUST-11256"))
    fresh = suggest_anchors(events)
    duped = fresh + [dict(fresh[0])]
    merged = merge_anchor_candidates(existing=[], fresh=duped)
    sigs = [c["signature"] for c in merged]
    assert len(sigs) == len(set(sigs))


def test_merge_handles_malformed_entries():
    merged = merge_anchor_candidates(
        existing=[],
        fresh=[None, {}, {"signature": ""}, {"signature": "abc"}, "string"],
        dismissed=[None, {}, "garbage", {"signature": "abc"}],
        case_anchor_override="not-a-dict",  # type: ignore[arg-type]
    )
    assert merged == [], merged


# ---------------------------------------------------------------------------
# coerce_anchor_override

def test_coerce_override_strips_audit_fields():
    raw = {
        "field": "automation_id", "equals": "x",
        "_accepted_signature": "abc", "_accepted_at": "now",
    }
    out = coerce_anchor_override(raw)
    assert out is not None
    assert "_accepted_signature" not in out
    assert "_accepted_at" not in out
    assert out["field"] == "automation_id"
    assert out["equals"] == "x"
    assert out["case_label_from"] == "value"  # defaulted


def test_coerce_override_rejects_malformed():
    assert coerce_anchor_override(None) is None
    assert coerce_anchor_override("not-a-dict") is None
    assert coerce_anchor_override({"no_field_or_recognized": "x"}) is None
    # A `recognized` rule (no `field`) is valid.
    out = coerce_anchor_override({"recognized": "search"})
    assert out == {"recognized": "search", "case_label_from": "value"}


# ---------------------------------------------------------------------------
# End-to-end: override actually applies through detect_cases_from_anchors

def test_accepted_override_stamps_cases():
    """The headline integration check: the anchor_config the detector
    emits, once written as the override and fed through the same
    detect_cases_from_anchors the normalize pipeline uses, produces the
    cases the candidate's metrics promised."""
    events = (_typical_case(0,    "CUST-11255")
              + _typical_case(60,  "CUST-11256")
              + _typical_case(120, "CUST-11257"))
    fresh = suggest_anchors(events)
    accepted = dict(fresh[0]["anchor_config"])
    accepted["_accepted_signature"] = fresh[0]["signature"]
    accepted["_accepted_at"] = "now"
    cfg = coerce_anchor_override(accepted)
    interactions = [e for e in events if e["type"] == "interaction"]
    cases = detect_cases_from_anchors(interactions, cfg)
    assert len(cases) == 3
    assert {c["label"] for c in cases} == {
        "CUST-11255", "CUST-11256", "CUST-11257"
    }
