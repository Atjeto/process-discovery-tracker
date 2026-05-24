"""process_label -- the value-free step label, now sourced from the shared
shared/process-label-patterns.json and mirrored by the viewer's
process-map-levels.processLabel (ADR-0013). These guard the Python loader
(including the JS $1/$2 -> \\1 backref mapping) and the two rewrite shapes the
step map relies on. The JS twin is covered in viewer/process-map-levels.test.js.

Run: python -m pytest normalization/test/test_process_label.py
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from step_suggest import process_label


def test_enter_in_drops_the_typed_value():
    # "Enter 25 in Quantity" -> "Enter Quantity" (keep the field, drop the value)
    assert process_label("Salesforce: Enter 25 in Quantity") == "Salesforce: Enter Quantity"


def test_value_tail_is_stripped():
    assert process_label("Search — CUST-10001") == "Search"   # em-dash
    assert process_label("Search – SN12345") == "Search"      # en-dash
    assert process_label("Search - 42") == "Search"           # hyphen


def test_value_free_names_are_left_untouched():
    assert process_label("Salesforce: Fill Customer ID field") == "Salesforce: Fill Customer ID field"
    assert process_label("Click Search") == "Click Search"


def test_empty_and_none():
    assert process_label("") == ""
    assert process_label(None) == ""


def test_enter_in_wins_over_tail_when_both_could_apply():
    # The enter-in rule is first; a name that also has a trailing dash keeps the
    # enter-in rewrite rather than being tail-stripped.
    assert process_label("App: Enter 5 in Qty — CUST-1") == "App: Enter Qty — CUST-1"
