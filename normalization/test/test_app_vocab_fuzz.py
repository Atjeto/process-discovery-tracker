"""Seeded property-based fuzzer for app_vocab (ADR-0002, lab Phase H G-7).

Mirrors test_marker_suggest_fuzz.py in shape: thousands of random vocab
dictionaries + event streams, deterministic per (BASE + iter) seed, two
regimes -- one asserting full correctness on well-formed input, one
asserting only robustness on corrupt/hand-edited input.

app_vocab parses UNTRUSTED input on two sides: the per-app vocabulary YAML
(authored, but malformed files reach the matcher) and the captured event
stream (an old/odd capture build emits odd shapes -- see G-2). Both reach
`lookup` / `enrich_events` / `bootstrap_*`. Authored `window_title_regex`
patterns are routed through `regex_guard.compile_guarded` (a bad / ReDoS
pattern is made inert, not raised), so garbage regexes are in-scope here too.

Headline invariants:

* `lookup`, `enrich_events`, `bootstrap_from_session`,
  `bootstrap_per_app_from_session`, `auto_semantics` never crash -- even on
  corrupt vocabs / events.
* `enrich_events` returns `(events, summary)` with `matched <= total`, a
  coverage entry per app, and is idempotent in its summary.
* `bootstrap_from_session` returns the documented `{app_vocabulary: {...}}`
  shape; every interaction row carries a dict `signature` and string `name`.
* `bootstrap_per_app_from_session` returns one entry per observed app,
  ranked by interaction volume, each scoped to its OWN process, with
  `interaction_count == len(interactions)`, and is deterministic.

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


def _assert_bootstrap_doc(doc) -> None:
    assert isinstance(doc, dict) and "app_vocabulary" in doc, f"bad doc: {doc!r}"
    av = doc["app_vocabulary"]
    assert isinstance(av.get("interactions"), list)
    for row in av["interactions"]:
        assert isinstance(row, dict)
        assert isinstance(row.get("signature"), dict), f"row signature not a dict: {row!r}"
        assert isinstance(row.get("name"), str)


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

            doc = app_vocab.bootstrap_from_session(events)
            _assert_bootstrap_doc(doc)

            per_app = app_vocab.bootstrap_per_app_from_session(events)
            assert isinstance(per_app, list)
            counts = [a["interaction_count"] for a in per_app]
            assert counts == sorted(counts, reverse=True), "per-app not volume-ranked"
            for a in per_app:
                assert a["interaction_count"] == len(a["app_vocabulary"]["interactions"])
                assert a["app_vocabulary"]["scope"]["process_name"] == a["app"]
                assert a["app_vocabulary"]["id"] == a["vocab_id"]
                _assert_bootstrap_doc({"app_vocabulary": a["app_vocabulary"]})
            # Deterministic: a re-run yields the same per-app ids + counts.
            per_app2 = app_vocab.bootstrap_per_app_from_session(events)
            assert [(a["vocab_id"], a["interaction_count"]) for a in per_app] == \
                   [(a["vocab_id"], a["interaction_count"]) for a in per_app2]
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
            doc = app_vocab.bootstrap_from_session(
                [e for e in events if isinstance(e, dict)])
            _assert_bootstrap_doc(doc)
            per_app = app_vocab.bootstrap_per_app_from_session(
                [e for e in events if isinstance(e, dict)])
            assert isinstance(per_app, list)
            for a in per_app:
                assert a["interaction_count"] == len(a["app_vocabulary"]["interactions"])
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}\n{_compact(events, vocabs)}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH on corrupt input [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}\n{_compact(events, vocabs)}") from e


def test_fuzz_auto_semantics_total():
    """auto_semantics is total over any control_type / name / kinds combo."""
    for i in range(2000):
        rng = Random(BASE + 2_000_000 + i)
        ct = _corrupt(rng, rng.choice(_CTRLS))
        name = _corrupt(rng, rng.choice(_NAMES))
        kinds = rng.choice([None, set(), {rng.choice(_KINDS)},
                            {"value_changed", "toggle_changed"}])
        try:
            out = app_vocab.auto_semantics(ct, name, kinds)
            assert isinstance(out, dict) and isinstance(out.get("verb"), str)
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH [iter {i}]: auto_semantics({ct!r},{name!r},{kinds!r}) "
                f"-> {type(e).__name__}: {e}") from e
