"""Seeded property-based fuzzer for classification.

Mirrors test_marker_suggest_fuzz.py in shape. `classify_events` and the two
`collapse_*` stages consume the UNTRUSTED captured event stream (an old/odd
capture emits odd shapes -- non-dict `data`, a non-string app/title) and an
authored taxonomy. This fuzzer pins that they degrade rather than crash.

Headline invariants:

* `classify_events`, `collapse_adjacent`, `collapse_activity_occurrences`
  never crash -- even on a corrupt event stream / an odd taxonomy.
* `classify_events` is length-preserving (every event passes through), stamps
  a string `activity_label` on every activity event, leaves non-activity
  events untouched, returns one taxonomy_report entry per rule, and is
  idempotent in the labels it assigns.
* The two collapses return a list no longer than their input.

The taxonomy regexes stay VALID in every regime: a bad authored regex is a
fail-fast authoring contract, not a robustness target. The corrupt-EVENT and
odd-STRUCTURE regimes are the real threat surface.

Run with:
    pytest normalization/test/test_classification_fuzz.py
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from classification import (  # noqa: E402
    classify_events,
    collapse_adjacent,
    collapse_activity_occurrences,
)


BASE = 0xC1A_55F
WELLFORMED_ITERS = 2500
EVENT_ADVERSARIAL_ITERS = 2500
TAXONOMY_ADVERSARIAL_ITERS = 1500

_APPS = ["chrome.exe", "EXCEL.EXE", "outlook.exe", "SAPGUI.exe", "notepad.exe"]
_TITLES = ["Salesforce - Acme Corp", "Create Incident INC0010010",
           "Inbox - Outlook", "Book1 - Excel", "Untitled - Notepad", ""]
_LABELS = ["CRM", "Email", "Spreadsheet", "ERP"]


def _iso(t: datetime) -> str:
    return t.replace(tzinfo=timezone.utc).isoformat()


def _activity(t: datetime, rng: Random) -> dict:
    return {
        "event_id": str(uuid.uuid4()),
        "type": "activity",
        "timestamp": _iso(t),
        "data": {
            "app": rng.choice(_APPS),
            "title": rng.choice(_TITLES),
            "duration_ms": rng.choice([0, 500, 1000, 30000]),
            "case_ids": rng.choice([["case-1"], [], ["case-1", "case-2"]]),
        },
    }


def _interaction(t: datetime, rng: Random) -> dict:
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(t),
        "data": {"kind": "invoked", "process_name": rng.choice(_APPS),
                 "window_title": rng.choice(_TITLES), "control_type": "Button"},
    }


def _taxonomy(rng: Random) -> dict:
    rules = []
    for _ in range(rng.randint(0, 5)):
        rule = {"label": rng.choice(_LABELS), "match": {}}
        if rng.random() < 0.6:
            rule["match"]["app"] = rng.choice(_APPS)
        if rng.random() < 0.6:
            rule["match"]["title_regex"] = rng.choice(
                ["Salesforce", "Incident", "Inbox", "Book\\d", ".*"])
        if rng.random() < 0.3:
            rule["extract"] = {"transaction_id": r"(INC\d+)"}
        rules.append(rule)
    return {"rules": rules}


def _gen_events(rng: Random) -> list[dict]:
    t = datetime(2026, 6, 1, 9, 0, 0, tzinfo=timezone.utc)
    out = []
    for _ in range(rng.randint(0, 25)):
        t = t + timedelta(milliseconds=rng.choice([200, 1000, 5000, 30000]))
        out.append(_activity(t, rng) if rng.random() < 0.6 else _interaction(t, rng))
    return out


def _corrupt(rng: Random, value):
    return rng.choice([value, value, None, "", 42, [], {}, True, ["x"]])


def _corrupt_events(rng: Random) -> list:
    events = _gen_events(rng)
    for ev in events:
        r = rng.random()
        if r < 0.08:
            ev.pop("data", None)
        elif r < 0.14:
            ev["data"] = None
        elif r < 0.18:
            ev["data"] = "corrupt"
        elif r < 0.22:
            ev.pop("type", None)
        elif isinstance(ev.get("data"), dict) and r < 0.55:
            key = rng.choice(["app", "title", "duration_ms", "case_ids",
                              "activity_label"])
            ev["data"][key] = _corrupt(rng, ev["data"].get(key))
    return events


def _odd_taxonomy(rng: Random) -> dict:
    """Structurally-odd but regex-VALID taxonomy: non-dict rules, a missing
    match block, a missing label. (The regex strings stay valid.)"""
    base = _taxonomy(rng)
    rules = base["rules"]
    if rules:
        for rule in rules:
            r = rng.random()
            if r < 0.15 and isinstance(rule, dict):
                rule.pop("match", None)
            elif r < 0.25 and isinstance(rule, dict):
                rule.pop("label", None)
            elif r < 0.32 and isinstance(rule, dict):
                rule["match"] = _corrupt(rng, rule.get("match"))
        if rng.random() < 0.3:
            rules.append(rng.choice([None, "not-a-rule", 7]))
    if rng.random() < 0.2:
        base["rules"] = _corrupt(rng, rules)
    return base


def _compact(events) -> str:
    return f"events={len(events) if isinstance(events, list) else type(events).__name__}"


def _assert_classified(events, out, report) -> None:
    assert isinstance(out, list) and isinstance(report, list)
    assert len(out) == len(events), "classify_events must be length-preserving"
    for orig, ev in zip(events, out):
        assert isinstance(ev, dict)
        if isinstance(orig, dict) and orig.get("type") == "activity":
            lbl = (ev.get("data") or {}).get("activity_label")
            assert isinstance(lbl, str) and lbl, f"activity not labelled: {ev!r}"
        else:
            assert ev is orig or ev == orig, "non-activity event was modified"


def _labels(out) -> list:
    return [(ev.get("data") or {}).get("activity_label")
            if isinstance(ev, dict) and isinstance(ev.get("data"), dict) else None
            for ev in out]


def test_fuzz_classify_wellformed():
    """2500 well-formed taxonomy+streams: full correctness + idempotence."""
    for i in range(WELLFORMED_ITERS):
        seed = BASE + i
        rng = Random(seed)
        events = _gen_events(rng)
        taxonomy = _taxonomy(rng)
        try:
            out, report = classify_events(events, taxonomy)
            _assert_classified(events, out, report)
            assert len(report) == len(taxonomy["rules"])
            # Idempotent: classifying the already-classified output again yields
            # the same labels.
            out2, _ = classify_events(out, taxonomy)
            assert _labels(out) == _labels(out2), "classify_events not idempotent"
            assert len(collapse_adjacent(out)) <= len(out)
            assert len(collapse_activity_occurrences(out)) <= len(out)
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}\n{_compact(events)}") from e
        except Exception as e:  # noqa: BLE001 - a crash here is a finding
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}]: {type(e).__name__}: {e}\n"
                f"{_compact(events)}") from e


def test_fuzz_classify_corrupt_events():
    """2500 corrupt event streams (valid taxonomy): robustness only."""
    for i in range(EVENT_ADVERSARIAL_ITERS):
        seed = BASE + 1_000_000 + i
        rng = Random(seed)
        events = _corrupt_events(rng)
        taxonomy = _taxonomy(rng)
        try:
            out, report = classify_events(events, taxonomy)
            assert isinstance(out, list) and len(out) == len(events)
            assert len(collapse_adjacent(out)) <= len(out)
            assert len(collapse_activity_occurrences(out)) <= len(out)
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}\n{_compact(events)}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH on corrupt events [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}\n{_compact(events)}") from e


def test_fuzz_classify_odd_taxonomy():
    """1500 structurally-odd (regex-valid) taxonomies over clean events."""
    for i in range(TAXONOMY_ADVERSARIAL_ITERS):
        seed = BASE + 2_000_000 + i
        rng = Random(seed)
        events = _gen_events(rng)
        taxonomy = _odd_taxonomy(rng)
        try:
            out, report = classify_events(events, taxonomy)
            assert isinstance(out, list) and len(out) == len(events)
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}\n{_compact(events)}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH on odd taxonomy [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}\n{_compact(events)}") from e
