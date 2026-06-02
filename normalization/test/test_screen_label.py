"""screen_label -- the value-free SCREEN string, sourced from the shared
shared/screen-label-patterns.json and mirrored by the viewer's
process-map-levels.screenType (ADR-0024 §6a/§6b). This guards the Python side
and pins its agreement with the JS twin via shared/screen-label-golden.json --
the sibling of test_process_label.py. If the two engines diverge, one logical
screen splits per record and the screen-grain map fans out.

Run: python -m pytest normalization/test/test_screen_label.py
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from step_suggest import screen_label

_GOLDEN = json.loads(
    (Path(__file__).resolve().parent.parent.parent / "shared"
     / "screen-label-golden.json").read_text(encoding="utf-8")
)


def test_embedded_record_numbers_are_stripped():
    assert screen_label("Salesforce - Order #10900") == "Salesforce - Order"
    assert screen_label("Create INC0010010 | Incident | ServiceNow") == "Create | Incident | ServiceNow"


def test_genuinely_different_screens_stay_apart():
    assert screen_label("Salesforce - Account lookup") == "Salesforce - Account lookup"
    assert screen_label("Salesforce - Credit check") == "Salesforce - Credit check"


def test_short_codes_survive_but_id_tokens_are_stripped():
    assert screen_label("va01") == "va01"                  # short txn code kept
    assert screen_label("Search — CUST-10852") == "Search"  # id token stripped


def test_never_blanks_an_all_value_title():
    assert screen_label("#10900") == "#10900"
    assert screen_label("") == ""
    assert screen_label("   ") == ""


def test_matches_cross_language_golden():
    """Every golden case must hold here AND in the JS twin
    (viewer/process-map-levels.test.js). A divergence means the Python and JS
    screen labelers disagree -- the screen-grain map would fan out per record."""
    for name, expected in _GOLDEN["cases"]:
        assert screen_label(name) == expected, repr(name)


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
