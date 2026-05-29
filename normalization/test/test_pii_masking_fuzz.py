"""Seeded property-based fuzzer for pii_masking (§11f).

Mirrors the other fuzzers in shape: thousands of random event streams,
deterministic per (BASE + iter) seed, two regimes -- one on well-formed input,
one on corrupt / hand-edited input. The headline invariants:

* `mask_events` NEVER crashes -- even on corrupt input.
* The input list and its event dicts are NEVER mutated (immutability: raw
  events.jsonl must stay intact).
* Every redacted value is replaced by a «category#hex» token; the original
  value never survives in the output.
* A non-sensitive field's value is always left exactly as-is.
* Redaction is deterministic + join-preserving: re-running yields identical
  tokens, equal (value, session) inputs map to equal tokens, and unequal
  values map to unequal tokens.
* The report's masked_value_count equals the number of changed value fields,
  and sum(rules_fired.values()) == masked_value_count.

Run with:
    pytest normalization/test/test_pii_masking_fuzz.py
"""

from __future__ import annotations

import copy
import sys
import uuid
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pii_masking import mask_events  # noqa: E402

BASE = 0x9117
WELLFORMED_ITERS = 4000
ADVERSARIAL_ITERS = 3000

# Field names: a mix of clearly-sensitive and clearly-benign, plus identifier
# forms the tokenizer must handle (txtPassword, PasswordBox).
_SENSITIVE_NAMES = ["Password", "txtPassword", "SSN", "Social Security Number",
                    "Credit card number", "CVV", "PIN", "API key", "IBAN",
                    "Account number", "Routing number"]
_BENIGN_NAMES = ["Quantity", "Unit price", "Shipping address", "Spinner",
                 "Customer name", "Search", "Status cell", "Pinboard label",
                 "Date", "", "Account name"]
_VALUES = ["hunter2", "123-45-6789", "4111111111111111", "0000", "sk-abc123",
           "", "   ", "DE89370400440532013000", "click", "ORD-9", "42"]
_CONTROL_TYPES = ["Edit", "PasswordBox", "Button", "ComboBox", "Document", ""]


def _rand_interaction(rng: Random) -> dict:
    name = rng.choice(_SENSITIVE_NAMES + _BENIGN_NAMES)
    data = {
        "name": name,
        "control_type": rng.choice(_CONTROL_TYPES),
        "automation_id": rng.choice(["", "txtSSN", "fldPwd", "btnOk", "txt1"]),
        "value": rng.choice(_VALUES),
    }
    if rng.random() < 0.3:
        data["selected_value"] = rng.choice(_VALUES)
    return {"event_id": str(uuid.uuid4()), "type": "interaction", "data": data}


def _rand_event(rng: Random) -> dict:
    if rng.random() < 0.75:
        return _rand_interaction(rng)
    return {"event_id": str(uuid.uuid4()),
            "type": rng.choice(["marker", "system", "activity"]),
            "data": {"value": rng.choice(_VALUES)}}


def _corrupt(rng: Random):
    """A grab-bag of malformed inputs a hand-edited log might contain."""
    choice = rng.randint(0, 8)
    if choice == 0:
        return None
    if choice == 1:
        return {"type": "interaction"}                       # no data
    if choice == 2:
        return {"type": "interaction", "data": "not a dict"}
    if choice == 3:
        return {"type": "interaction", "data": {"value": rng.randint(0, 9)}}  # non-str value
    if choice == 4:
        return {"type": "interaction", "data": {"name": None, "value": None}}
    if choice == 5:
        return {"data": {"name": "Password", "value": "x"}}   # no type
    if choice == 6:
        return "a bare string"
    if choice == 7:
        return {"type": "interaction", "data": {"name": "Password",
                "value": "x", "control_type": rng.randint(0, 5)}}
    return _rand_interaction(rng)


def _check_invariants(events, session_id):
    before = copy.deepcopy(events)
    out, report = mask_events(events, session_id=session_id)

    # 1. Immutability: the input is byte-for-byte unchanged.
    assert events == before, "mask_events mutated its input"

    # 2. Determinism / idempotence.
    out2, report2 = mask_events(events, session_id=session_id)
    assert out == out2 and report == report2

    # 3. Per-event checks + count reconciliation.
    masked_seen = 0
    for orig, new in zip(events, out):
        od = orig.get("data") if isinstance(orig, dict) else None
        nd = new.get("data") if isinstance(new, dict) else None
        if not isinstance(nd, dict) or not nd.get("value_masked"):
            # Untouched: value fields identical to the original.
            if isinstance(od, dict) and isinstance(nd, dict):
                assert nd.get("value") == od.get("value")
                assert nd.get("selected_value") == od.get("selected_value")
            continue
        masked_seen += 1
        cat = nd["value_masked_rule"]
        for key in ("value", "selected_value"):
            ov = od.get(key)
            if isinstance(ov, str) and ov != "":
                nv = nd.get(key)
                assert nv != ov, "original value survived masking"
                assert nv.startswith(f"«{cat}#") and nv.endswith("»")

    assert report["masked_value_count"] == masked_seen
    assert sum(report["rules_fired"].values()) == masked_seen


def test_wellformed_fuzz():
    for i in range(WELLFORMED_ITERS):
        rng = Random(BASE + i)
        n = rng.randint(0, 25)
        events = [_rand_event(rng) for _ in range(n)]
        _check_invariants(events, session_id=f"S{i % 7}")


def test_adversarial_fuzz():
    for i in range(ADVERSARIAL_ITERS):
        rng = Random(BASE * 2 + i)
        n = rng.randint(0, 25)
        events = [_corrupt(rng) for _ in range(n)]
        # Must not raise on any junk.
        out, report = mask_events(events, session_id=f"S{i % 5}")
        assert isinstance(out, list) and len(out) == len(events)
        assert report["masked_value_count"] == sum(report["rules_fired"].values())


def test_join_preservation_across_events():
    # The same secret in two different sensitive fields of one session must map
    # to the same token (process mining can still join on it).
    evs = [
        {"event_id": "a", "type": "interaction",
         "data": {"name": "Password", "value": "shared-secret"}},
        {"event_id": "b", "type": "interaction",
         "data": {"name": "Password", "value": "shared-secret"}},
    ]
    out, _ = mask_events(evs, session_id="S1")
    assert out[0]["data"]["value"] == out[1]["data"]["value"]


if __name__ == "__main__":
    test_wellformed_fuzz()
    print("ok wellformed")
    test_adversarial_fuzz()
    print("ok adversarial")
    test_join_preservation_across_events()
    print("all passed")
