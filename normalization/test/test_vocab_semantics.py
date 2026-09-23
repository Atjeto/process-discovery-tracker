"""Lab-phase C1: vocab record semantics -- loader + lookup and the two
pipeline consumers (step boundary hint, rekey field set).

The contract under test (LAB-PHASE-SPEC §C1):
  * every committed vocab (no semantic fields) loads, matches, and emits
    EXACTLY what it did before -- absence is fully tolerated;
  * a vocab carrying verb/object/completion/case_id_source/carries_value/
    means reaches the derived stream as data.vocab_semantics on matched
    interactions;
  * completion=true closes a step in step_suggest (boundary hint);
  * carries_value=true admits short values into facts.rekey_details.

Run with:
    pytest normalization/test/test_vocab_semantics.py
"""

from __future__ import annotations

import sys
from pathlib import Path

NORM_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(NORM_DIR))

import app_vocab        # noqa: E402
import facts            # noqa: E402
from step_suggest import auto_suggest_steps  # noqa: E402


# --- Fixtures ----------------------------------------------------------

SEMANTIC_VOCAB = {
    "id": "orders-app",
    "name": "Orders App",
    "version": 1,
    "scope": {"process_name": "orders.exe"},
    "interactions": [
        {
            "signature": {"control_type": "Edit", "automation_id": "order-id"},
            "name": "Order ID",
            "verb": "enter",
            "object": "order record",
            "case_id_source": True,
            "carries_value": True,
            "means": "names the order this case is about",
        },
        {
            "signature": {"control_type": "Edit", "automation_id": "cc-code"},
            "name": "Cost center",
            "carries_value": True,
        },
        {
            "signature": {"control_type": "Button", "automation_id": "post-order"},
            "name": "Post order",
            "verb": "submit",
            "completion": True,
        },
    ],
}

PLAIN_VOCAB = {
    "id": "plain",
    "name": "Plain (pre-C1 shape)",
    "version": 1,
    "scope": {"process_name": "plain.exe"},
    "interactions": [
        {"signature": {"control_type": "Button", "automation_id": "go"},
         "name": "Go"},
    ],
}


def _ev(data: dict, *, ts="2026-06-01T09:00:00Z", eid="e1") -> dict:
    return {"type": "interaction", "event_id": eid, "timestamp": ts, "data": data}


# --- Loader round-trip ---------------------------------------------------

def test_committed_vocabs_carry_no_semantics_and_still_load():
    """All shipped vocabs predate C1: they must load fine and produce no
    vocab_semantics enrichment (the absence contract)."""
    vocabs = app_vocab.load_vocabularies()
    assert len(vocabs) >= 10
    for v in vocabs:
        for entry in v.get("interactions") or []:
            assert app_vocab.semantics_from_entry(entry) == {}


def test_plain_vocab_lookup_has_no_semantics_key_on_event():
    events = [_ev({"process_name": "plain.exe", "control_type": "Button",
                   "automation_id": "go", "kind": "invoked", "name": "Go"})]
    out, summary = app_vocab.enrich_events(events, [PLAIN_VOCAB])
    assert summary["matched"] == 1
    assert out[0]["data"]["meaningful_name"] == "Go"
    # The pre-C1 derived shape is preserved exactly: no empty semantics dict.
    assert "vocab_semantics" not in out[0]["data"]


def test_lookup_carries_semantics_to_matched_event():
    events = [_ev({"process_name": "orders.exe", "control_type": "Edit",
                   "automation_id": "order-id", "kind": "value_changed",
                   "value": "ORD-1001", "name": "Order ID"})]
    out, summary = app_vocab.enrich_events(events, [SEMANTIC_VOCAB])
    assert summary["matched"] == 1
    sem = out[0]["data"]["vocab_semantics"]
    assert sem == {
        "verb": "enter",
        "object": "order record",
        "case_id_source": True,
        "carries_value": True,
        "means": "names the order this case is about",
    }


# --- Consumer 1: completion -> step boundary hint --------------------------

def _orders_events():
    """Two fill+post rounds on the same field/button. Without the completion
    boundary they glue into one step (same element, no idle gap); the vocab
    completion on 'Post order' must split them."""
    base = "2026-06-01T09:00:{s:02d}Z"
    evs = []
    rows = [
        ("value_changed", "Edit", "order-id", "ORD-1001"),
        ("invoked", "Button", "post-order", None),
        ("value_changed", "Edit", "order-id", "ORD-1002"),
        ("invoked", "Button", "post-order", None),
    ]
    for i, (kind, ct, aid, val) in enumerate(rows):
        d = {"process_name": "orders.exe", "window_title": "Orders",
             "kind": kind, "control_type": ct, "automation_id": aid,
             "name": "Post order" if aid == "post-order" else "Order ID"}
        if val:
            d["value"] = val
        evs.append(_ev(d, ts=base.format(s=i * 2), eid=f"e{i}"))
    return evs


def test_completion_semantic_closes_step():
    events, _ = app_vocab.enrich_events(_orders_events(), [SEMANTIC_VOCAB])
    steps = auto_suggest_steps(events, session_id="s")
    assert len(steps) == 2
    for s in steps:
        assert len(s["evidence"]["interaction_event_ids"]) == 2


def test_without_semantics_same_events_stay_glued():
    """The control case: 'Post order' has no completion word, so absent the
    vocab semantic the four interactions remain one step. Proves the split
    in test_completion_semantic_closes_step is the C1 hint, nothing else."""
    steps = auto_suggest_steps(_orders_events(), session_id="s")
    assert len(steps) == 1


# --- Consumer 2: carries_value -> rekey field set ---------------------------

def _typed(app, aid, value, eid):
    return _ev({"process_name": app, "kind": "value_changed",
                "control_type": "Edit", "automation_id": aid,
                "name": aid, "value": value}, eid=eid)


def test_short_value_rekey_needs_vocab_vouching():
    vocab = {
        "id": "cc", "name": "CC", "version": 1, "scope": {},
        "interactions": [
            {"signature": {"control_type": "Edit", "automation_id": "cc-a"},
             "name": "Cost center (A)", "carries_value": True},
            {"signature": {"control_type": "Edit", "automation_id": "cc-b"},
             "name": "Cost center (B)", "carries_value": True},
        ],
    }
    # "K42" is 3 chars: below REKEY_MIN_LEN, above REKEY_MIN_LEN_VOCAB.
    evs = [_typed("alpha.exe", "cc-a", "K42", "e1"),
           _typed("beta.exe", "cc-b", "K42", "e2")]
    # Unvouched: too short, no rekey row.
    assert facts.rekey_details([dict(e, data=dict(e["data"])) for e in evs]) == []
    # Vouched by the vocab: the same typings are a rekey row, and the row
    # names the vocab fields involved.
    enriched, _ = app_vocab.enrich_events(evs, [vocab])
    rows = facts.rekey_details(enriched)
    assert len(rows) == 1
    assert rows[0]["value"] == "K42"
    assert rows[0]["apps"] == ["alpha.exe", "beta.exe"]
    assert rows[0]["fields"] == ["Cost center (A)", "Cost center (B)"]


def test_rekey_classic_threshold_unchanged_without_vocab():
    evs = [_typed("alpha.exe", "f1", "ACC-2231", "e1"),
           _typed("beta.exe", "f2", "ACC-2231", "e2"),
           _typed("alpha.exe", "f3", "K42", "e3"),
           _typed("beta.exe", "f4", "K42", "e4")]
    rows = facts.rekey_details(evs)
    assert [r["value"] for r in rows] == ["ACC-2231"]
    # Raw-id fallback labels still populate the field set.
    assert rows[0]["fields"] == ["f1", "f2"]
