"""Seeded property-based fuzzer for canonical_match.

Mirrors test_marker_suggest_fuzz.py in shape. canonical_match parses an
UNTRUSTED Process Template (a hand-authored / hand-edited YAML moved between
machines) against a captured event stream (an old/odd capture emits odd
shapes). `match_canonical` already documents defensive intent -- it tolerates
a step lacking a step_id and an event lacking a timestamp -- and routes the
authored `window_title_regex` through `regex_guard`; this fuzzer pins that the
defensiveness actually holds across thousands of random + corrupt templates.

Headline invariants:

* `match_canonical` and `rollup_phases` never crash -- even on a corrupt
  template / corrupt events.
* `match_canonical` returns `(steps, unmatched)`, both lists; every step is a
  dict with a non-empty `step_id`, a `canonical_step_id` drawn from the
  template, and a list `evidence.interaction_event_ids`; every `unmatched` is
  an interaction event.
* It is idempotent: a re-run yields the same canonical_step_id sequence.
* `rollup_phases` returns a list of phase dicts, each with a `phase_id` and
  `step_ids` that all reference matched steps.

Run with:
    pytest normalization/test/test_canonical_match_fuzz.py
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from canonical_match import match_canonical, rollup_phases  # noqa: E402


BASE = 0xCA0_1234
WELLFORMED_ITERS = 2500
ADVERSARIAL_ITERS = 2500

_APPS = ["chrome.exe", "EXCEL.EXE", "outlook.exe", "SAPGUI.exe", "notepad.exe"]
_CTRLS = ["Button", "Edit", "ComboBox", "MenuItem", "TabItem"]
_NAMES = ["Save", "Search", "Submit", "OK", "Customer", ""]
_WINDOWS = ["Salesforce - Search", "Create Incident", "Inbox", "Book1", ""]
_BOUNDARIES = ["group_contiguous", "single", "until_app_change", "until_pause",
               "until_field_change", "until_next_step"]


def _iso(t: datetime) -> str:
    return t.replace(tzinfo=timezone.utc).isoformat()


def _inter(t: datetime, rng: Random) -> dict:
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(t),
        "data": {
            "kind": rng.choice(["invoked", "value_changed", "selection_changed"]),
            "window_title": rng.choice(_WINDOWS),
            "process_name": rng.choice(_APPS),
            "control_type": rng.choice(_CTRLS),
            "name": rng.choice(_NAMES),
            "case_ids": rng.choice([["case-1"], ["case-1", "case-2"], []]),
        },
    }


def _rule(rng: Random) -> dict:
    rule: dict = {}
    if rng.random() < 0.7:
        rule["process_name"] = rng.choice(_APPS)
    if rng.random() < 0.5:
        rule["window_title_regex"] = ".*" + rng.choice(["Salesforce", "Incident", "Inbox"]) + ".*"
    if rng.random() < 0.7:
        inter = {}
        if rng.random() < 0.8:
            inter["control_type"] = rng.choice(_CTRLS)
        if rng.random() < 0.4:
            inter["name"] = rng.choice(_NAMES[:-1])
        if inter:
            rule["interaction"] = inter
    return rule


def _canonical(rng: Random) -> dict:
    nsteps = rng.randint(0, 5)
    steps = []
    for k in range(nsteps):
        steps.append({
            "step_id": f"step-{k}",
            "name": rng.choice(["Search", "Open record", "Submit", ""]),
            "description": "",
            "boundary": rng.choice(_BOUNDARIES),
            "match": [_rule(rng) for _ in range(rng.randint(0, 2))],
        })
    phases = []
    if steps and rng.random() < 0.5:
        chosen = rng.sample([s["step_id"] for s in steps],
                            k=rng.randint(1, len(steps)))
        phases.append({"phase_id": "ph-0", "name": "Phase", "step_ids": chosen})
    return {"id": "p", "version": 1, "steps": steps, "phases": phases}


def _gen_wellformed(rng: Random) -> tuple[list[dict], dict]:
    t = datetime(2026, 6, 1, 9, 0, 0, tzinfo=timezone.utc)
    events = []
    for _ in range(rng.randint(0, 25)):
        t = t + timedelta(milliseconds=rng.choice([200, 1000, 5000, 30000]))
        events.append(_inter(t, rng))
    return events, _canonical(rng)


def _corrupt(rng: Random, value):
    return rng.choice([value, value, None, "", 42, [], {}, "(", ".*((((", True])


def _gen_adversarial(rng: Random) -> tuple[list, dict]:
    events, canonical = _gen_wellformed(rng)
    for ev in events:
        r = rng.random()
        if r < 0.08:
            ev.pop("data", None)
        elif r < 0.14:
            ev["data"] = None
        elif r < 0.18:
            ev["data"] = "corrupt"
        elif r < 0.22:
            ev.pop("timestamp", None)
        elif r < 0.26:
            ev.pop("type", None)
        elif isinstance(ev.get("data"), dict) and r < 0.55:
            key = rng.choice(["window_title", "process_name", "control_type",
                              "name", "case_ids"])
            ev["data"][key] = _corrupt(rng, ev["data"].get(key))
    # Corrupt the template: missing step_id, non-dict step, non-list match,
    # garbage rule, ReDoS regex.
    steps = canonical.get("steps")
    if isinstance(steps, list) and steps:
        for s in steps:
            if not isinstance(s, dict):
                continue
            r = rng.random()
            if r < 0.15:
                s.pop("step_id", None)
            elif r < 0.25:
                s["match"] = _corrupt(rng, s.get("match"))
            elif r < 0.35 and isinstance(s.get("match"), list):
                s["match"].append(rng.choice([None, "x", 7, {"window_title_regex": "(a+)+$"}]))
            elif r < 0.4:
                s["boundary"] = _corrupt(rng, s.get("boundary"))
        if rng.random() < 0.2:
            steps.append(rng.choice([None, "not-a-step", 42]))
    if rng.random() < 0.2:
        canonical["steps"] = _corrupt(rng, canonical.get("steps"))
    if rng.random() < 0.2:
        canonical["phases"] = _corrupt(rng, canonical.get("phases"))
    return events, canonical


def _compact(events, canonical) -> str:
    ns = canonical.get("steps") if isinstance(canonical, dict) else canonical
    return (f"events={len(events) if isinstance(events, list) else type(events).__name__}, "
            f"steps={len(ns) if isinstance(ns, list) else type(ns).__name__}")


def _step_ids(canonical: dict) -> set:
    out = set()
    steps = canonical.get("steps") if isinstance(canonical, dict) else None
    for s in (steps if isinstance(steps, list) else []):
        if isinstance(s, dict) and s.get("step_id"):
            out.add(s["step_id"])
    return out


def _assert_match(steps, unmatched, canonical) -> None:
    assert isinstance(steps, list) and isinstance(unmatched, list)
    valid_ids = _step_ids(canonical)
    for s in steps:
        assert isinstance(s, dict), f"non-dict step: {s!r}"
        assert isinstance(s.get("step_id"), str) and s["step_id"], f"bad step_id: {s!r}"
        assert s.get("canonical_step_id") in valid_ids, \
            f"step references unknown canonical id: {s.get('canonical_step_id')}"
        ev = s.get("evidence") or {}
        assert isinstance(ev.get("interaction_event_ids"), list)
    for u in unmatched:
        assert isinstance(u, dict) and u.get("type") == "interaction"


def _csid_seq(steps) -> list:
    return [s.get("canonical_step_id") for s in steps]


def test_fuzz_match_wellformed():
    """2500 well-formed templates+streams: full correctness + idempotence."""
    for i in range(WELLFORMED_ITERS):
        seed = BASE + i
        rng = Random(seed)
        events, canonical = _gen_wellformed(rng)
        try:
            steps, unmatched = match_canonical(events, canonical, session_id="s")
            _assert_match(steps, unmatched, canonical)
            steps2, _ = match_canonical(events, canonical, session_id="s")
            assert _csid_seq(steps) == _csid_seq(steps2), "match_canonical not idempotent"
            phases = rollup_phases(canonical, steps, session_id="s")
            assert isinstance(phases, list)
            matched_ids = {s["step_id"] for s in steps}
            for ph in phases:
                assert isinstance(ph.get("phase_id"), str)
                for sid in ph.get("step_ids", []):
                    assert sid in matched_ids, "phase references a non-matched step"
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}\n{_compact(events, canonical)}") from e
        except Exception as e:  # noqa: BLE001 - a crash here is a finding
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}]: {type(e).__name__}: {e}\n"
                f"{_compact(events, canonical)}") from e


def test_fuzz_match_adversarial():
    """2500 corrupt templates+streams: robustness only -- never crash, always
    return two lists with well-shaped entries."""
    for i in range(ADVERSARIAL_ITERS):
        seed = BASE + 1_000_000 + i
        rng = Random(seed)
        events, canonical = _gen_adversarial(rng)
        try:
            steps, unmatched = match_canonical(events, canonical, session_id="s")
            _assert_match(steps, unmatched, canonical)
            phases = rollup_phases(canonical, steps, session_id="s")
            assert isinstance(phases, list)
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}\n{_compact(events, canonical)}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH on corrupt input [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}\n{_compact(events, canonical)}") from e


def test_fuzz_rollup_phases_garbage():
    """1500 garbage (canonical, steps) pairs to rollup_phases directly."""
    for i in range(1500):
        rng = Random(BASE + 2_000_000 + i)
        canonical = rng.choice([
            {"phases": _corrupt(rng, [{"phase_id": "p", "step_ids": ["a"]}])},
            {"phases": [None, "x", {"step_ids": "not-a-list"}]},
            {},
            {"phases": [{"name": "no id", "step_ids": [rng.choice(["a", None, 7])]}]},
        ])
        steps = rng.choice([
            [], [None, "x"], [{"step_id": "a", "canonical_step_id": "a"}],
            [{"canonical_step_id": "a"}],
        ])
        try:
            out = rollup_phases(canonical, steps, session_id="s")
            assert isinstance(out, list)
            for ph in out:
                assert isinstance(ph, dict)
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH [iter {i}]: rollup_phases -> {type(e).__name__}: {e}") from e
