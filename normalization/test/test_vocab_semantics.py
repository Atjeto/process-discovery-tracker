"""Lab-phase C1: vocab record semantics — loader round-trip + the three
consumers (step boundary hint, anchor scoring bonus, rekey field set).

The contract under test (LAB-PHASE-SPEC §C1):
  * every committed vocab (no semantic fields) loads, matches, and emits
    EXACTLY what it did before — absence is fully tolerated;
  * a vocab carrying verb/object/completion/case_id_source/carries_value/
    means round-trips through to_yaml and reaches the derived stream as
    data.vocab_semantics on matched interactions;
  * completion=true closes a step in step_suggest (boundary hint);
  * case_id_source=true adds a small anchor_suggest scoring BONUS — never
    a gate;
  * carries_value=true admits short values into facts.rekey_details.

Run with:
    pytest normalization/test/test_vocab_semantics.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

NORM_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(NORM_DIR))

import app_vocab        # noqa: E402
import anchor_suggest   # noqa: E402
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


def test_semantic_vocab_round_trips_through_yaml():
    doc = {"app_vocabulary": SEMANTIC_VOCAB}
    text = app_vocab.to_yaml(doc)
    loaded = yaml.safe_load(text)["app_vocabulary"]
    by_aid = {e["signature"]["automation_id"]: e for e in loaded["interactions"]}
    assert by_aid["order-id"]["case_id_source"] is True
    assert by_aid["order-id"]["carries_value"] is True
    assert by_aid["order-id"]["verb"] == "enter"
    assert by_aid["order-id"]["object"] == "order record"
    assert by_aid["order-id"]["means"].startswith("names the order")
    assert by_aid["post-order"]["completion"] is True
    # And re-emitting the loaded doc is stable (no field loss on a 2nd pass).
    again = yaml.safe_load(app_vocab.to_yaml({"app_vocabulary": loaded}))
    assert again["app_vocabulary"]["interactions"] == loaded["interactions"]


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


# --- Auto-derivation helpers (the C1 auto columns) ------------------------

def test_derive_verb_from_control_and_kind():
    assert app_vocab.derive_verb("Edit") == "enter"
    assert app_vocab.derive_verb("ComboBox") == "select"
    assert app_vocab.derive_verb("CheckBox") == "toggle"
    assert app_vocab.derive_verb("MenuItem") == "open"
    assert app_vocab.derive_verb("Button", "Search") == "click"
    # Observed kind beats the role guess (session-bootstrap path).
    assert app_vocab.derive_verb("Custom", kinds={"value_changed"}) == "enter"
    assert app_vocab.derive_verb("Custom", kinds={"selection_changed"}) == "select"
    # Completion wins as submit.
    assert app_vocab.derive_verb("Button", "Save record") == "submit"


def test_derive_completion_word_boundaries():
    assert app_vocab.derive_completion("Button", "Save") is True
    assert app_vocab.derive_completion("Button", "Submit incident") is True
    assert app_vocab.derive_completion("Button", "OK") is True
    assert app_vocab.derive_completion("Button", "Send") is True
    # Not a completion: word only as a fragment, or a non-action control.
    assert app_vocab.derive_completion("Button", "Sender address") is False
    assert app_vocab.derive_completion("Edit", "Save") is False
    assert app_vocab.derive_completion("Button", "Search") is False


def test_derive_carries_value():
    assert app_vocab.derive_carries_value("Edit") is True
    assert app_vocab.derive_carries_value("Button") is False
    # Observed typing wins over the role guess.
    assert app_vocab.derive_carries_value("Custom", {"value_changed"}) is True
    assert app_vocab.derive_carries_value("Edit", {"invoked"}) is False


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


# --- Consumer 2: case_id_source -> anchor scoring bonus ---------------------

def _anchor_events(flag_field_a: bool):
    """Two structurally IDENTICAL candidate fields (same fires, same case
    structure). With the vocab flag on field A, A must outrank B; without
    it they tie. Interleaved so each anchor's simulated cases cover the
    same interaction spans."""
    vocab = {
        "id": "anchored", "name": "Anchored", "version": 1,
        "scope": {"process_name": "app.exe"},
        "interactions": [
            {"signature": {"control_type": "Edit", "automation_id": "field-a"},
             "name": "Field A",
             **({"case_id_source": True} if flag_field_a else {})},
        ],
    }
    evs = []
    i = 0
    for n in (1, 2, 3):
        for aid, val in (("field-a", f"A-{n}"), ("field-b", f"B-{n}")):
            evs.append(_ev({
                "process_name": "app.exe", "window_title": "App",
                "kind": "value_changed", "control_type": "Edit",
                "automation_id": aid, "name": aid, "value": val,
            }, ts=f"2026-06-01T09:{i:02d}:00Z", eid=f"e{i}"))
            i += 1
        for j in range(3):  # filler work inside each case
            evs.append(_ev({
                "process_name": "app.exe", "window_title": "App",
                "kind": "invoked", "control_type": "Button",
                "automation_id": f"work-{n}-{j}", "name": "Work",
            }, ts=f"2026-06-01T09:{i:02d}:00Z", eid=f"e{i}"))
            i += 1
    enriched, _ = app_vocab.enrich_events(evs, [vocab])
    return enriched


def _scores_by_field(cands):
    return {c["display"]["field_value"]: c for c in cands}


def test_case_id_source_bonus_lifts_score_never_gates():
    plain = _scores_by_field(anchor_suggest.suggest_anchors(_anchor_events(False)))
    flagged = _scores_by_field(anchor_suggest.suggest_anchors(_anchor_events(True)))
    # Both fields are candidates in BOTH runs — the flag never gates entry.
    assert {"field-a", "field-b"} <= set(plain) and {"field-a", "field-b"} <= set(flagged)
    # Flagged run: A gains exactly the bonus (clamped) vs its unflagged self;
    # B is untouched in both runs.
    assert flagged["field-b"]["score"] == plain["field-b"]["score"]
    expected = round(min(1.0, plain["field-a"]["score"]
                         + anchor_suggest._VOCAB_CASE_ID_BONUS), 3)
    assert flagged["field-a"]["score"] == expected
    assert flagged["field-a"]["metrics"]["vocab_case_id_source"] is True
    assert "vocab_case_id_source" not in flagged["field-b"]["metrics"]


def test_case_id_source_alone_cannot_create_a_candidate():
    """A flagged field that fails the structural minimums (one fire) stays
    absent — the bonus is not a gate-opener."""
    vocab = {
        "id": "anchored", "name": "Anchored", "version": 1,
        "scope": {"process_name": "app.exe"},
        "interactions": [
            {"signature": {"control_type": "Edit", "automation_id": "field-a"},
             "name": "Field A", "case_id_source": True},
        ],
    }
    evs = [_ev({"process_name": "app.exe", "kind": "value_changed",
                "control_type": "Edit", "automation_id": "field-a",
                "name": "Field A", "value": "A-1",
                "window_title": "App"}, eid="e0")]
    enriched, _ = app_vocab.enrich_events(evs, [vocab])
    assert anchor_suggest.suggest_anchors(enriched) == []


# --- Consumer 3: carries_value -> rekey field set ---------------------------

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
