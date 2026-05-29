"""Tests for pii_masking -- structural PII redaction (§11f).

Sensitive UIA field VALUES (password, SSN, card, CVV, PIN, secret, IBAN,
routing/account number) are redacted in a COPY of the event stream; the input
is never mutated, so raw events.jsonl stays intact. Redaction is a one-way,
join-preserving token.

Run with pytest:
    pytest normalization/test/test_pii_masking.py
or directly:
    python normalization/test/test_pii_masking.py
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pii_masking import mask_events, RULESET_ID, RULESET_VERSION


def _interaction(eid, name="", value="", control_type="Edit", automation_id="",
                 selected_value=None):
    data = {"name": name, "control_type": control_type,
            "automation_id": automation_id, "value": value}
    if selected_value is not None:
        data["selected_value"] = selected_value
    return {"event_id": eid, "type": "interaction", "data": data}


def test_password_value_is_redacted():
    evs = [_interaction("i1", name="Password", value="hunter2")]
    out, report = mask_events(evs, session_id="S1")
    d = out[0]["data"]
    assert d["value"] != "hunter2"
    assert d["value"].startswith("«password#") and d["value"].endswith("»")
    assert d["value_masked"] is True
    assert d["value_masked_rule"] == "password"
    assert report["masked_value_count"] == 1
    assert report["rules_fired"] == {"password": 1}
    assert report["ruleset_id"] == RULESET_ID
    assert report["ruleset_version"] == RULESET_VERSION
    assert report["scanned_interactions"] == 1
    assert report["applied"] is True


def test_input_events_are_not_mutated():
    # The immutability invariant: masking must work on a copy, never touch the
    # caller's (raw-derived) dicts.
    evs = [_interaction("i1", name="SSN", value="123-45-6789")]
    original_value = evs[0]["data"]["value"]
    out, _ = mask_events(evs, session_id="S1")
    assert evs[0]["data"]["value"] == original_value      # input untouched
    assert "value_masked" not in evs[0]["data"]
    assert out[0]["data"]["value"] != original_value      # copy redacted


def test_non_sensitive_field_is_untouched():
    evs = [_interaction("i1", name="Quantity", value="42"),
           _interaction("i2", name="Shipping address", value="1 Main St")]
    out, report = mask_events(evs, session_id="S1")
    assert out[0]["data"]["value"] == "42"
    assert out[1]["data"]["value"] == "1 Main St"
    assert report["masked_value_count"] == 0
    # "shipping" must NOT trip the bare-"pin" rule.
    assert report["rules_fired"] == {}


def test_token_is_join_preserving():
    # Same value+session -> same token; different value -> different token.
    a = mask_events([_interaction("i1", name="PIN", value="1234")], session_id="S1")[0][0]
    b = mask_events([_interaction("i2", name="PIN", value="1234")], session_id="S1")[0][0]
    c = mask_events([_interaction("i3", name="PIN", value="9999")], session_id="S1")[0][0]
    assert a["data"]["value"] == b["data"]["value"]
    assert a["data"]["value"] != c["data"]["value"]


def test_token_is_salted_by_session():
    a = mask_events([_interaction("i1", name="PIN", value="1234")], session_id="S1")[0][0]
    b = mask_events([_interaction("i1", name="PIN", value="1234")], session_id="S2")[0][0]
    assert a["data"]["value"] != b["data"]["value"]


def test_selected_value_is_redacted_too():
    evs = [_interaction("i1", name="Credit card number", value="",
                        selected_value="4111111111111111")]
    out, report = mask_events(evs, session_id="S1")
    assert out[0]["data"]["selected_value"].startswith("«card#")
    assert report["rules_fired"] == {"card": 1}


def test_sensitive_field_with_no_value_is_not_counted():
    evs = [_interaction("i1", name="Password", value="")]
    out, report = mask_events(evs, session_id="S1")
    assert "value_masked" not in out[0]["data"]
    assert report["masked_value_count"] == 0


def test_various_categories_fire():
    evs = [
        _interaction("i1", name="Password", value="x"),
        _interaction("i2", automation_id="txtSSN", value="y"),
        _interaction("i3", control_type="PasswordBox", value="z"),
        _interaction("i4", name="CVV", value="123"),
        _interaction("i5", name="IBAN", value="DE00"),
        _interaction("i6", name="API key", value="sk-1"),
        _interaction("i7", name="Account number", value="1"),
    ]
    _, report = mask_events(evs, session_id="S1")
    assert report["masked_value_count"] == 7
    assert set(report["rules_fired"]) == {"password", "ssn", "cvv", "iban", "secret", "account"}
    assert report["rules_fired"]["password"] == 2  # name + control_type


def test_disabled_via_config_masks_nothing():
    evs = [_interaction("i1", name="Password", value="hunter2")]
    anno = {"pii_masking_config": {"enabled": False}}
    out, report = mask_events(evs, annotations=anno, session_id="S1")
    assert out[0]["data"]["value"] == "hunter2"
    assert report["enabled"] is False
    assert report["applied"] is False


def test_custom_rule_extends_the_ruleset():
    evs = [_interaction("i1", name="Employee badge", value="E-5523")]
    anno = {"pii_masking_config": {"custom_rules": [{"id": "badge", "pattern": r"\bbadge\b"}]}}
    out, report = mask_events(evs, annotations=anno, session_id="S1")
    assert out[0]["data"]["value"].startswith("«badge#")
    assert report["custom_rule_count"] == 1
    assert report["rules_fired"] == {"badge": 1}


def test_malformed_custom_rule_is_skipped_not_fatal():
    evs = [_interaction("i1", name="Password", value="x")]
    anno = {"pii_masking_config": {"custom_rules": [
        {"id": "bad", "pattern": "(unclosed"},   # invalid regex
        "not a dict",
        {"no_pattern": True},
    ]}}
    out, report = mask_events(evs, annotations=anno, session_id="S1")
    # Bad rules ignored; default password rule still fires.
    assert out[0]["data"]["value"].startswith("«password#")
    assert report["custom_rule_count"] == 0


def test_non_interaction_and_junk_events_pass_through():
    evs = [
        {"type": "marker", "data": {"value": "secret-marker"}},  # not interaction
        {"type": "interaction"},                                  # no data
        {"type": "interaction", "data": "junk"},                  # data not dict
        None,
        _interaction("i1", name="Password", value="x"),
    ]
    out, report = mask_events(evs, session_id="S1")
    assert len(out) == 5
    assert out[0]["data"]["value"] == "secret-marker"  # marker untouched
    assert report["masked_value_count"] == 1


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
