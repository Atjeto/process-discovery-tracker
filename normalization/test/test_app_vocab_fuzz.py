"""Seeded property-based fuzzer for app_vocab (ADR-0002, lab Phase H G-7).

The same shape as the other seeded fuzzers (e.g. test_case_assignment_fuzz.py):
thousands of random vocab dictionaries + event streams, deterministic per
(BASE + iter) seed, two regimes -- one asserting full correctness on
well-formed input, one asserting only robustness on corrupt/hand-edited input.

app_vocab parses UNTRUSTED input on two sides: the per-app vocabulary YAML
(authored, but malformed files reach the matcher) and the captured event
stream (an old/odd capture build emits odd shapes -- see G-2). Both reach
`lookup` / `enrich_events`. Authored `window_title_regex` patterns are routed
through `regex_guard.compile_guarded` (a bad / ReDoS pattern is made inert,
not raised), so garbage regexes are in-scope here too.

Headline invariants:

* `lookup` and `enrich_events` never crash -- even on corrupt vocabs / events.
* `enrich_events` returns `(events, summary)` with `matched <= total`, a
  coverage entry per app, and is idempotent in its summary.

Run with:
    pytest normalization/test/test_app_vocab_fuzz.py
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app_vocab  # noqa: E402


BASE = 0x5EED_A99
WELLFORMED_ITERS = 3000
ADVERSARIAL_ITERS = 3000

_APPS = ["salesforce.exe", "EXCEL.EXE", "outlook.exe", "chrome.exe",
         "SAPGUI.exe", "notepad.exe", "TAMBA.exe"]
_CTRLS = ["Button", "Edit", "ComboBox", "DataItem", "MenuItem", "CheckBox",
          "TabItem", "Hyperlink", "Document", ""]
_KINDS = ["invoked", "value_changed", "text_changed", "selection_changed",
          "toggle_changed", "focus_changed", ""]
_NAMES = ["Save", "Search", "Customer ID", "Submit", "OK", "ProblemDesc",
          "Order type", "", "Send"]
_AIDS = ["searchBtn", "customer-id", "save-btn", "input-378", "", "order-id"]
_TITLES = ["Salesforce - Acme", "Create INC0010010 | Incident",
           "TAMBA - Case 339481", "Inbox", "", "Book1 - Excel"]


def _ev(rng: Random) -> dict:
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": "2026-06-01T09:00:00Z",
        "data": {
            "kind": rng.choice(_KINDS),
            "process_name": rng.choice(_APPS),
            "window_title": rng.choice(_TITLES),
            "control_type": rng.choice(_CTRLS),
            "automation_id": rng.choice(_AIDS),
            "name": rng.choice(_NAMES),
            "class_name": rng.choice(["x-btn", "GridCell", ""]),
        },
    }


def _vocab(rng: Random, vid: str) -> dict:
    """A random, well-formed app vocabulary dict (the loaded shape)."""
    n = rng.randint(0, 6)
    interactions = []
    for _ in range(n):
        sig = {}
        if rng.random() < 0.6:
            sig["control_type"] = rng.choice(_CTRLS[:-1])
        if rng.random() < 0.5:
            sig["automation_id"] = rng.choice(_AIDS[:-1])
        if rng.random() < 0.5:
            sig["name"] = rng.choice(_NAMES[:-1])
        if rng.random() < 0.2:
            sig["class_name"] = "x-btn"
        if rng.random() < 0.2:
            sig["window_title_regex"] = ".*" + rng.choice(["Acme", "Incident", "Case"]) + ".*"
        entry = {"signature": sig, "name": rng.choice(_NAMES)}
        for k in ("verb", "object", "means"):
            if rng.random() < 0.3:
                entry[k] = rng.choice(["enter", "click", "a customer record", "does a thing"])
        interactions.append(entry)
    scope = {"process_name": rng.choice(_APPS)}
    if rng.random() < 0.4:
        scope["window_title_regex"] = ".*" + rng.choice(["Salesforce", "Incident", "TAMBA"]) + ".*"
    vocab = {"id": vid, "name": vid.title(), "version": 1, "scope": scope,
             "interactions": interactions}
    if rng.random() < 0.3:
        vocab["screens"] = [{"id": "s1", "name": "Screen one",
                             "window_title_regex": ".*Incident.*"}]
    return vocab


def _gen_wellformed(rng: Random) -> tuple[list[dict], list[dict]]:
    events = [_ev(rng) for _ in range(rng.randint(0, 30))]
    vocabs = [_vocab(rng, f"app-{k}") for k in range(rng.randint(0, 4))]
    return events, vocabs


def _corrupt(rng: Random, value):
    return rng.choice([value, value, None, "", 42, [], {}, "(", ".*((((",
                       "a" * 60 + "!", True])


def _gen_adversarial(rng: Random) -> tuple[list, list]:
    """Corrupt events + vocabs: missing/null data, wrong types, garbage
    (incl. catastrophic) regexes. The module must degrade, not crash."""
    events, vocabs = _gen_wellformed(rng)
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
        elif isinstance(ev.get("data"), dict) and r < 0.5:
            key = rng.choice(["process_name", "control_type", "name",
                              "automation_id", "window_title", "class_name", "kind"])
            ev["data"][key] = _corrupt(rng, ev["data"].get(key))
    # Garbage vocab entries: non-dict, missing interactions, bad signatures,
    # ReDoS-prone regexes (regex_guard must neutralise them).
    for v in vocabs:
        if rng.random() < 0.2:
            v["scope"] = _corrupt(rng, v.get("scope"))
        if rng.random() < 0.2 and isinstance(v.get("interactions"), list):
            v["interactions"].append(rng.choice([None, "x", 7, {"name": "no sig"}]))
        if rng.random() < 0.15 and isinstance(v.get("scope"), dict):
            v["scope"]["window_title_regex"] = "(a+)+$"
    if rng.random() < 0.15:
        vocabs.append("not-a-vocab")  # type: ignore[arg-type]
    if rng.random() < 0.15:
        vocabs.append(None)  # type: ignore[arg-type]
    return events, vocabs


def _compact(events, vocabs) -> str:
    return (f"events={len(events) if isinstance(events, list) else type(events).__name__}, "
            f"vocabs={len(vocabs) if isinstance(vocabs, list) else type(vocabs).__name__}")


def _assert_enrich(events, summary) -> None:
    assert isinstance(events, list)
    assert isinstance(summary, dict)
    assert summary["matched"] <= summary["total"], summary
    assert summary["matched"] >= 0 and summary["total"] >= 0
    cov = summary.get("coverage")
    assert isinstance(cov, dict)
    for app, c in cov.items():
        assert c["enriched"] <= c["total_interactions"], (app, c)


def test_fuzz_wellformed():
    """3000 well-formed vocab+event sets: full correctness invariants."""
    for i in range(WELLFORMED_ITERS):
        seed = BASE + i
        rng = Random(seed)
        events, vocabs = _gen_wellformed(rng)
        try:
            for ev in events:
                got = app_vocab.lookup(vocabs, (ev.get("data") or {}))
                assert got is None or isinstance(got, dict)
            ev2, summary = app_vocab.enrich_events([dict(e) for e in events], vocabs)
            _assert_enrich(ev2, summary)
            # Idempotent summary: enriching a FRESH copy gives the same counts.
            _, summary2 = app_vocab.enrich_events([dict(e) for e in events], vocabs)
            assert (summary["matched"], summary["total"]) == (summary2["matched"], summary2["total"])
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}\n{_compact(events, vocabs)}") from e
        except Exception as e:  # noqa: BLE001 - a crash here is a finding
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}]: {type(e).__name__}: {e}\n"
                f"{_compact(events, vocabs)}") from e


def test_fuzz_adversarial():
    """3000 corrupt vocab+event sets: robustness only -- never crash, always
    return the documented container types."""
    for i in range(ADVERSARIAL_ITERS):
        seed = BASE + 1_000_000 + i
        rng = Random(seed)
        events, vocabs = _gen_adversarial(rng)
        try:
            for ev in events:
                data = (ev.get("data") if isinstance(ev, dict) else None) or {}
                if not isinstance(data, dict):
                    data = {}
                got = app_vocab.lookup(vocabs, data)
                assert got is None or isinstance(got, dict)
            ev2, summary = app_vocab.enrich_events(
                [e for e in events if isinstance(e, dict)], vocabs)
            _assert_enrich(ev2, summary)
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}\n{_compact(events, vocabs)}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH on corrupt input [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}\n{_compact(events, vocabs)}") from e
