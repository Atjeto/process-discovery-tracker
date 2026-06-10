"""Lab-phase C2: discovery autofill — after the volatility diff, every
discovered row arrives with auto-semantics (verb / completion-candidate /
carries_value) and screen grouping, so the human pass is *review*, not
authoring.

Exercises the REAL discovery path (`discover_vocab.discover` →
`app_vocab.bootstrap_from_snapshot` → `signature_pick`) on a recorded
two-pass snapshot fixture shaped like the recorder's `snapshot` output
(an order-entry form: id field, picker, notes box, a Save and a Search
button — incl. a Salesforce-style volatile automation_id that must be
demoted to its label without losing its autofill).

Run with:
    pytest normalization/test/test_discover_autofill.py
"""

from __future__ import annotations

import sys
from pathlib import Path

NORM_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(NORM_DIR))

import app_vocab        # noqa: E402
import discover_vocab   # noqa: E402


def ctrl(pass_, *, control_type=None, automation_id=None, name=None,
         class_name=None, framework="chromium", bounds=None, depth=1):
    """One synthetic snapshot_control line (the recorder `snapshot` shape —
    mirrors test_signature_pick.ctrl)."""
    d = {
        "pass": pass_, "depth": depth,
        "control_type": control_type, "automation_id": automation_id,
        "name": name, "class_name": class_name, "framework": framework,
        "role": (control_type or "").lower() or None,
    }
    if bounds:
        d["bounds"] = bounds
    return d


# The recorded fixture: two passes over one order-entry window. The
# "Order ID" input is Salesforce-style — its automation_id regenerates
# between passes (input-378 → input-512), so the picker must key it on
# the label while the autofill still sees control_type=Edit.
def _snapshot_controls():
    out = []
    for p, vol_aid in ((1, "input-378"), (2, "input-512")):
        out.extend([
            ctrl(p, control_type="Edit", automation_id=vol_aid,
                 name="Order ID", bounds={"x": 40, "y": 80, "w": 200, "h": 24}),
            ctrl(p, control_type="ComboBox", automation_id="priority",
                 name="Priority", bounds={"x": 40, "y": 120, "w": 200, "h": 24}),
            ctrl(p, control_type="Document", automation_id="notes",
                 name="Notes", bounds={"x": 40, "y": 160, "w": 400, "h": 80}),
            ctrl(p, control_type="Button", automation_id="save-order",
                 name="Save order", bounds={"x": 40, "y": 260, "w": 90, "h": 28}),
            ctrl(p, control_type="Button", automation_id="search-orders",
                 name="Search", bounds={"x": 150, "y": 260, "w": 90, "h": 28}),
            ctrl(p, control_type="CheckBox", automation_id="rush",
                 name="Rush handling", bounds={"x": 40, "y": 220, "w": 140, "h": 20}),
        ])
    return out


def _discovered():
    doc = discover_vocab.discover({
        "controls": _snapshot_controls(),
        "window_title": "New Order ORD-10042 — Orders",
        "vocab_id": "orders", "vocab_name": "Orders",
    })
    return doc["app_vocabulary"]


def _by_name(vocab):
    return {e.get("name"): e for e in vocab["interactions"]}


def test_every_discovered_row_has_an_auto_verb():
    rows = _discovered()["interactions"]
    assert rows, "fixture discovered no rows"
    for e in rows:
        assert e.get("verb") in app_vocab.VERBS, e


def test_autofill_verbs_match_control_roles():
    by = _by_name(_discovered())
    assert by["Order ID"]["verb"] == "enter"
    assert by["Priority"]["verb"] == "select"
    assert by["Notes"]["verb"] == "enter"
    assert by["Save order"]["verb"] == "submit"     # completion wins
    assert by["Search"]["verb"] == "click"
    assert by["Rush handling"]["verb"] == "toggle"


def test_autofill_completion_candidates():
    by = _by_name(_discovered())
    assert by["Save order"].get("completion") is True
    # Not completion: Search runs a lookup, it doesn't close the unit of work.
    assert "completion" not in by["Search"]
    assert "completion" not in by["Order ID"]


def test_autofill_carries_value_on_value_holding_roles():
    by = _by_name(_discovered())
    assert by["Order ID"].get("carries_value") is True
    assert by["Priority"].get("carries_value") is True
    assert by["Notes"].get("carries_value") is True
    assert "carries_value" not in by["Save order"]
    assert "carries_value" not in by["Rush handling"]


def test_autofill_never_guesses_the_human_half():
    """object / means / case_id_source are the human/LLM columns — discovery
    must leave them absent (suggest-don't-mutate starts here)."""
    for e in _discovered()["interactions"]:
        assert "object" not in e
        assert "means" not in e
        assert "case_id_source" not in e


def test_screen_grouping_on_every_row():
    vocab = _discovered()
    assert vocab["screens"], "discovery should derive one screen per window"
    sid = vocab["screens"][0]["id"]
    for e in vocab["interactions"]:
        assert e.get("screen") == sid


def test_volatile_aid_demotion_keeps_autofill():
    """The Salesforce-style row is keyed on its label (volatility diff) AND
    still arrives with the Edit-role autofill — the two features compose."""
    by = _by_name(_discovered())
    row = by["Order ID"]
    assert "automation_id" not in (row.get("signature") or {})
    assert row["signature"].get("name") == "Order ID"
    assert row.get("verb") == "enter"
    assert row.get("carries_value") is True
    assert row.get("volatile_aids"), "the rejected per-render aid should be listed"


def test_discovered_doc_round_trips_with_semantics():
    import yaml
    vocab = _discovered()
    text = app_vocab.to_yaml({"app_vocabulary": vocab})
    loaded = yaml.safe_load(text)["app_vocabulary"]
    by = _by_name(loaded)
    assert by["Save order"]["completion"] is True
    assert by["Order ID"]["verb"] == "enter"
