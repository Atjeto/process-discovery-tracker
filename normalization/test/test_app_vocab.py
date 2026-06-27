"""Smoke tests for app_vocab loading, matching, and enrichment.

Run with:
    pytest normalization/test/test_app_vocab.py
"""

from __future__ import annotations
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app_vocab


# --- Fixtures ----------------------------------------------------------

SALESFORCE_VOCAB = {
    "id": "salesforce",
    "name": "Salesforce",
    "version": 1,
    "scope": {
        "process_name": "chrome.exe",
        "window_title_regex": ".*Salesforce.*",
    },
    "screens": [
        {"id": "search", "name": "Search", "window_title_regex": ".*Search.*"},
    ],
    "interactions": [
        {
            "signature": {"control_type": "Button", "automation_id": "searchBtn"},
            "name": "Run customer search",
        },
        {
            "signature": {"control_type": "Button", "name": "Save"},
            "name": "Save record",
        },
        {
            "signature": {"control_type": "Button", "name": "Save",
                          "window_title_regex": ".*Account.*"},
            "name": "Save account record",
            "flags": {"automation_candidate": True},
        },
    ],
}

OUTLOOK_VOCAB = {
    "id": "outlook",
    "name": "Outlook",
    "version": 1,
    "scope": {"process_name": "OUTLOOK.EXE"},
    "interactions": [
        {"signature": {"name": "Send"}, "name": "Send email"},
    ],
}


def _ev(data: dict) -> dict:
    return {"type": "interaction", "event_id": "e", "data": data}


# --- Tests -------------------------------------------------------------

def test_scope_filter_drops_other_apps():
    """A Salesforce vocab must not annotate an Outlook event."""
    ev = _ev({"process_name": "OUTLOOK.EXE", "window_title": "Inbox",
              "control_type": "Button", "automation_id": "searchBtn"})
    out = app_vocab.lookup([SALESFORCE_VOCAB], ev["data"])
    assert out is None


def test_scope_process_name_is_case_insensitive():
    """The OS / recorder reports the exe name with inconsistent casing
    ('chrome.exe' but 'EXCEL.EXE' / 'SAPGUI.exe'); a vocab scoped lowercase
    must still match an uppercase-reported process and vice versa (§11d)."""
    # Vocab scoped lowercase, event reports uppercase.
    ev_up = _ev({"process_name": "OUTLOOK.EXE", "control_type": "Button", "name": "Send"})
    lower_scope = dict(OUTLOOK_VOCAB, scope={"process_name": "outlook.exe"})
    assert app_vocab.lookup([lower_scope], ev_up["data"])["meaningful_name"] == "Send email"
    # Vocab scoped uppercase, event reports lowercase.
    ev_low = _ev({"process_name": "outlook.exe", "control_type": "Button", "name": "Send"})
    assert app_vocab.lookup([OUTLOOK_VOCAB], ev_low["data"])["meaningful_name"] == "Send email"


def test_match_via_automation_id():
    ev = _ev({"process_name": "chrome.exe", "window_title": "Salesforce | Search",
              "control_type": "Button", "automation_id": "searchBtn"})
    out = app_vocab.lookup([SALESFORCE_VOCAB], ev["data"])
    assert out is not None
    assert out["meaningful_name"] == "Run customer search"
    assert out["screen_id"] == "search"
    assert out["vocab_source"]["vocab_id"] == "salesforce"


def test_specificity_tiebreak_more_specific_wins():
    """Generic 'Save' rule has 2 fields; account-scoped rule has 3.
    Account-scoped rule must win when the window matches."""
    ev = _ev({"process_name": "chrome.exe",
              "window_title": "Salesforce | Account: Acme Corp",
              "control_type": "Button", "name": "Save"})
    out = app_vocab.lookup([SALESFORCE_VOCAB], ev["data"])
    assert out["meaningful_name"] == "Save account record"
    assert out["vocab_flags"].get("automation_candidate") is True


def test_specificity_tiebreak_generic_fallback():
    """If the more-specific rule's window doesn't match, the generic
    'Save' rule should still match."""
    ev = _ev({"process_name": "chrome.exe", "window_title": "Salesforce | Contact",
              "control_type": "Button", "name": "Save"})
    out = app_vocab.lookup([SALESFORCE_VOCAB], ev["data"])
    assert out["meaningful_name"] == "Save record"


def test_load_yaml_skips_malformed(tmp_path: Path):
    """Library loader must not crash on a malformed file."""
    good = tmp_path / "good.yaml"
    good.write_text(
        "app_vocabulary:\n"
        "  id: testapp\n"
        "  name: Test\n"
        "  version: 1\n"
        "  scope: {}\n"
        "  interactions: []\n",
        encoding="utf-8",
    )
    bad = tmp_path / "bad.yaml"
    bad.write_text("not: [valid\nyaml: -\n", encoding="utf-8")
    vocabs = app_vocab.load_vocabularies(extra_dirs=[str(tmp_path)])
    # We get the default-shipped vocab plus the good one; bad is skipped.
    ids = {v.get("id") for v in vocabs}
    assert "testapp" in ids
    # Malformed file did not raise.


def test_enrich_events_marks_only_matches():
    events = [
        _ev({"process_name": "chrome.exe", "window_title": "Salesforce",
             "control_type": "Button", "automation_id": "searchBtn"}),
        _ev({"process_name": "chrome.exe", "window_title": "Salesforce",
             "control_type": "Button", "name": "Cancel"}),
        _ev({"process_name": "OUTLOOK.EXE", "window_title": "Inbox",
             "name": "Send"}),
    ]
    enriched, summary = app_vocab.enrich_events(
        events, vocabs=[SALESFORCE_VOCAB, OUTLOOK_VOCAB])
    assert summary["matched"] == 2
    assert summary["total"] == 3
    assert enriched[0]["data"]["meaningful_name"] == "Run customer search"
    assert "meaningful_name" not in enriched[1]["data"]
    assert enriched[2]["data"]["meaningful_name"] == "Send email"
    assert summary["vocabs_hit"] == {"salesforce": 1, "outlook": 1}


def test_screen_by_window_tags_unmatched_controls_without_counting_as_match():
    """ADR-0024 §6b: an interaction whose CONTROL isn't in the vocab but whose
    WINDOW is a known vocab screen (window_title_regex) is tagged with that
    screen_id, so one logical screen stays one node at the screen grain -- but it
    is NOT counted as a vocab name match (no meaningful_name, no coverage credit)."""
    events = [
        # control matches a signature -> named + screen via window regex
        _ev({"process_name": "chrome.exe", "window_title": "Customer Search | Salesforce",
             "control_type": "Button", "automation_id": "searchBtn"}),
        # SAME screen window, but an UNKNOWN control -> screen tagged, not named
        _ev({"process_name": "chrome.exe", "window_title": "Customer Search | Salesforce",
             "control_type": "Edit", "automation_id": "someUnmappedField"}),
    ]
    enriched, summary = app_vocab.enrich_events(events, vocabs=[SALESFORCE_VOCAB])
    # Both interactions carry the SAME value-free screen (no per-window split).
    assert enriched[0]["data"]["screen_id"] == "search"
    assert enriched[1]["data"]["screen_id"] == "search"
    # The unmatched control is screen-tagged but NOT a named match.
    assert "meaningful_name" not in enriched[1]["data"]
    assert summary["matched"] == 1            # only the searchBtn is a real match
    assert summary["coverage"]["chrome.exe"]["enriched"] == 1


def test_bootstrap_from_session_produces_signatures():
    """The bootstrap must deduplicate identical signatures and prefer
    automation_id when present."""
    events = [
        _ev({"process_name": "chrome.exe", "window_title": "Salesforce | Search",
             "control_type": "Button", "automation_id": "searchBtn", "name": "Search"}),
        # Same automation_id repeated -- should collapse to one entry.
        _ev({"process_name": "chrome.exe", "window_title": "Salesforce | Search",
             "control_type": "Button", "automation_id": "searchBtn", "name": "Search"}),
        _ev({"process_name": "chrome.exe", "window_title": "Salesforce | Account",
             "control_type": "Button", "name": "Save"}),
    ]
    doc = app_vocab.bootstrap_from_session(
        events, vocab_id="sf", vocab_name="Salesforce")
    interactions = doc["app_vocabulary"]["interactions"]
    # Two unique signatures (searchBtn deduped, Save separate).
    assert len(interactions) == 2
    # automation_id-based signature came in first (twice in input).
    first_sig = interactions[0]["signature"]
    assert first_sig.get("automation_id") == "searchBtn"


def test_bootstrap_empty_session():
    doc = app_vocab.bootstrap_from_session([], vocab_id="empty", vocab_name="Empty")
    assert doc["app_vocabulary"]["interactions"] == []


# --- I57 / I58: bootstrap ranking + coverage ---------------------------

def test_enrich_events_reports_per_app_coverage():
    """I58: the enrich_events summary carries per-app vocabulary coverage."""
    events = [
        _ev({"process_name": "chrome.exe", "window_title": "Salesforce",
             "control_type": "Button", "automation_id": "searchBtn"}),
        _ev({"process_name": "chrome.exe", "window_title": "Salesforce",
             "control_type": "Button", "name": "Cancel"}),
        _ev({"process_name": "OUTLOOK.EXE", "window_title": "Inbox",
             "name": "Send"}),
    ]
    _, summary = app_vocab.enrich_events(
        events, vocabs=[SALESFORCE_VOCAB, OUTLOOK_VOCAB])
    cov = summary["coverage"]
    assert cov["chrome.exe"] == {
        "total_interactions": 2, "enriched": 1, "coverage_pct": 50.0}
    assert cov["OUTLOOK.EXE"]["coverage_pct"] == 100.0


def test_bootstrap_carries_seen_count_ranked_by_frequency():
    """I57: bootstrapped entries carry seen_count, ranked by it descending."""
    events = [
        _ev({"process_name": "chrome.exe", "window_title": "App",
             "control_type": "Button", "automation_id": "common"})
        for _ in range(3)
    ] + [
        _ev({"process_name": "chrome.exe", "window_title": "App",
             "control_type": "Button", "automation_id": "rare"}),
    ]
    doc = app_vocab.bootstrap_from_session(events, vocab_id="x", vocab_name="X")
    interactions = doc["app_vocabulary"]["interactions"]
    assert [i["seen_count"] for i in interactions] == [3, 1]
    assert interactions[0]["signature"]["automation_id"] == "common"


# --- G-7: per-app bootstrap (the arrival-session workflow) -------------

def _multi_app_events() -> list[dict]:
    """A received recording touching three apps the analyst has no vocab for."""
    return [
        _ev({"process_name": "chrome.exe", "window_title": "Salesforce - Acme",
             "control_type": "Button", "automation_id": "searchBtn", "name": "Search"}),
        _ev({"process_name": "chrome.exe", "window_title": "Salesforce - Acme",
             "control_type": "Button", "automation_id": "searchBtn", "name": "Search"}),
        _ev({"process_name": "chrome.exe", "window_title": "Salesforce - Beta",
             "control_type": "Edit", "automation_id": "customer-id", "name": "Customer",
             "kind": "value_changed"}),
        _ev({"process_name": "SAPGUI.exe", "window_title": "SAP Easy Access",
             "control_type": "Edit", "name": "Material", "kind": "value_changed"}),
        _ev({"process_name": "OUTLOOK.EXE", "window_title": "Inbox",
             "control_type": "Button", "name": "Send"}),
    ]


def test_bootstrap_per_app_emits_one_vocab_per_observed_app():
    apps = app_vocab.bootstrap_per_app_from_session(_multi_app_events())
    # One starter vocab per app, densest first (chrome has the most rows).
    by_id = {a["vocab_id"]: a for a in apps}
    assert set(by_id) == {"chrome", "sapgui", "outlook"}
    assert apps[0]["vocab_id"] == "chrome"
    assert apps[0]["interaction_count"] == 2          # searchBtn (deduped) + customer-id
    # Each app's vocab is scoped to ITS OWN process, not a mixed catch-all.
    for a in apps:
        scope = a["app_vocabulary"]["scope"]
        assert scope["process_name"] == a["app"]
        # The doc id/name mirror the top-level summary fields.
        assert a["app_vocabulary"]["id"] == a["vocab_id"]
        assert a["app_vocabulary"]["name"] == a["vocab_name"]


def test_bootstrap_per_app_rows_carry_hint_for_review_checklist():
    """Every bootstrapped row carries a `_hint` -- the editor reads it as the
    discovery marker that renders the row in the review checklist (G-7)."""
    apps = app_vocab.bootstrap_per_app_from_session(_multi_app_events())
    for a in apps:
        for row in a["app_vocabulary"]["interactions"]:
            assert row.get("_hint"), f"{a['vocab_id']} row missing _hint: {row}"
            assert "seen_count" in row


def test_bootstrap_per_app_skips_apps_below_min_interactions():
    # Outlook + SAP each have a single row; require >= 2 leaves only chrome.
    apps = app_vocab.bootstrap_per_app_from_session(
        _multi_app_events(), min_interactions=2)
    assert [a["vocab_id"] for a in apps] == ["chrome"]


def test_bootstrap_per_app_friendly_names():
    apps = app_vocab.bootstrap_per_app_from_session(_multi_app_events())
    names = {a["vocab_id"]: a["vocab_name"] for a in apps}
    assert names["chrome"] == "Chrome"        # plain lower-case -> Capitalised
    assert names["sapgui"] == "SAPGUI"        # all-caps acronym left alone
    assert names["outlook"] == "OUTLOOK"


def test_bootstrap_per_app_scope_narrows_by_window_title():
    apps = app_vocab.bootstrap_per_app_from_session(_multi_app_events())
    chrome = next(a for a in apps if a["vocab_id"] == "chrome")
    scope = chrome["app_vocabulary"]["scope"]
    # The two chrome windows share the "Salesforce - " prefix -> a narrowing regex.
    assert "window_title_regex" in scope
    assert "Salesforce" in scope["window_title_regex"]


def test_bootstrap_per_app_no_interactions_is_empty():
    # Activity-only / marker-only events produce no apps (and never crash).
    assert app_vocab.bootstrap_per_app_from_session(
        [{"type": "activity", "data": {"app": "chrome.exe"}}]) == []
    assert app_vocab.bootstrap_per_app_from_session([]) == []
