"""Seeded property-based fuzzer for the analysis layer -- the waste / efficiency
/ automation heuristics that feed PDD section 4 ("Automation assessment") and the
findings report. The layer is already defensive (isinstance guards, try/except,
clamping); this pins the load-bearing invariants so a future change can't quietly
break them, and probes corrupt analyst overrides / segments for crashes.

Drives classify_waste / compute_efficiency / score_automation directly, passing
`segments` explicitly so the pure scoring is exercised without the segmenter.

Two regimes:
  * well-formed (active <= elapsed, well-typed overrides): correctness -- efficiency
    ratio in [0,1], va <= elapsed, non-negative durations, automation scores in
    [0,1] or null, valid data_sufficiency.
  * adversarial (corrupt overrides / segments / events): robustness -- never crash,
    rows stay well-shaped.

Run: pytest normalization/test/test_analysis_layer_fuzz.py
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from analysis_automation import score_automation  # noqa: E402
from analysis_efficiency import compute_efficiency  # noqa: E402
from analysis_waste import classify_waste  # noqa: E402

BASE = 0xA17A5
WELLFORMED_ITERS = 2500
ADVERSARIAL_ITERS = 2000

_NAMES = ["Search", "Open record", "Enter qty", "Save order", "Send email"]
_WASTE_TYPES = ["waiting", "motion", "overprocessing", "rework"]
_T0 = datetime(2026, 5, 18, 9, 0, 0, tzinfo=timezone.utc)


def _iso(t):
    return t.isoformat()


def _gen_steps(rng, n):
    steps = []
    for i in range(n):
        s = _T0 + timedelta(seconds=rng.randint(0, 300))
        e = s + timedelta(milliseconds=rng.choice([0, 500, 5000, 30000]))
        nm = rng.choice(_NAMES)
        steps.append({
            "step_id": "s%d" % i, "name": nm, "process_label": nm,
            "time_range": {"start": _iso(s), "end": _iso(e)},
            "evidence": {"interaction_event_ids": []},
        })
    return steps


def _gen_segments(rng, steps, *, wellformed):
    segs = {}
    for st in steps:
        elapsed = rng.choice([0, rng.randint(0, 60000)])
        if wellformed:
            active = rng.randint(0, elapsed) if elapsed else 0
            waiting = rng.randint(0, max(0, elapsed - active)) if elapsed else 0
            switching = rng.randint(0, max(0, elapsed - active - waiting)) if elapsed else 0
        else:
            active = rng.choice([0, elapsed, rng.randint(0, 90000)])
            waiting = rng.choice([0, rng.randint(0, 90000)])
            switching = rng.choice([0, rng.randint(0, 90000)])
        seg = {"elapsed_ms": elapsed, "active_ms": active,
               "waiting_ms": waiting, "switching_ms": switching,
               "app_switches": rng.choice([0, 0, 1, 2])}
        if not wellformed and rng.random() < 0.2:
            seg.pop(rng.choice(["active_ms", "waiting_ms", "elapsed_ms"]), None)
        segs[st["step_id"]] = seg
    return segs


def _gen_annotations(rng, steps, *, wellformed):
    overrides = []
    for st in steps:
        if rng.random() < 0.3:
            if wellformed:
                ov = {"step_id": st["step_id"]}
                if rng.random() < 0.6:
                    ov["waste_types"] = rng.sample(_WASTE_TYPES, rng.randint(0, 3))
                if rng.random() < 0.6:
                    ov["bnva_ms"] = rng.randint(0, 30000)
                if rng.random() < 0.3:
                    ov["automation_confirmed"] = rng.choice([True, False])
            else:
                ov = {"step_id": st["step_id"],
                      "waste_types": rng.choice([42, None, "rework", ["ok", 5]]),
                      "bnva_ms": rng.choice(["lots", None, -5, 1.5e9]),
                      "automation_confirmed": rng.choice([1, "yes", None])}
            overrides.append(ov)
    # Also exercise grouped 'Waste by step' overrides: an entry keyed by
    # process_label with no step_id, propagated to every matching instance.
    for nm in _NAMES:
        if rng.random() < 0.25:
            if wellformed:
                ov = {"process_label": nm}
                if rng.random() < 0.6:
                    ov["waste_types"] = rng.sample(_WASTE_TYPES, rng.randint(0, 3))
                if rng.random() < 0.6:
                    ov["bnva_ms"] = rng.randint(0, 30000)
            else:
                ov = {"process_label": rng.choice([nm, "", None, 5]),
                      "waste_types": rng.choice([42, None, ["x"]]),
                      "bnva_ms": rng.choice(["lots", None, -5])}
            overrides.append(ov)
    return {"analysis_overrides": overrides}


def _gen_stats(rng):
    return {"rework_loops": [{"activity_label": rng.choice(_NAMES)}
                             for _ in range(rng.randint(0, 3))]}


def test_fuzz_analysis_wellformed():
    """2500 well-formed analyses: the PDD section-4 numbers obey their invariants."""
    for i in range(WELLFORMED_ITERS):
        seed = BASE + i
        rng = Random(seed)
        steps = _gen_steps(rng, rng.randint(0, 25))
        segs = _gen_segments(rng, steps, wellformed=True)
        anns = _gen_annotations(rng, steps, wellformed=True)
        stats = _gen_stats(rng)
        try:
            waste = classify_waste(steps, [], stats, segments=segs, annotations=anns)
            for w in waste:
                assert w["elapsed_ms"] >= 0 and w["va_ms"] >= 0 and w["nva_ms"] >= 0
                assert w["bnva_ms"] >= 0
                assert w["va_ms"] <= w["elapsed_ms"], f"va>elapsed: {w}"
                assert isinstance(w["waste_types"], list)
                assert all(isinstance(t, str) for t in w["waste_types"])

            eff = compute_efficiency(waste)
            r = eff["process_efficiency_ratio"]
            assert 0.0 <= r <= 1.0, f"efficiency ratio out of [0,1]: {r}"
            assert eff["total_va_ms"] <= eff["total_elapsed_ms"]
            for ps in eff["per_step"]:
                assert 0.0 <= ps["ratio"] <= 1.0, f"per-step ratio out of [0,1]: {ps}"

            auto = score_automation(steps, [], segments=segs, annotations=anns)
            for a in auto:
                assert a["instances"] >= 1
                assert a["data_sufficiency"] in ("single_instance", "multi_instance")
                sc = a["scores"]
                for k in ("repetitiveness", "rule_based"):
                    assert sc[k] is None or 0.0 <= sc[k] <= 1.0, f"{k} out of [0,1]: {sc}"
                assert sc["volume"] >= 0
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}") from e
        except Exception as e:  # noqa: BLE001 -- a crash on well-formed input is a finding
            raise AssertionError(
                f"CRASH [iter {i}, seed {hex(seed)}]: {type(e).__name__}: {e}") from e


def test_fuzz_analysis_adversarial():
    """2000 corrupt analyses (bad overrides / segments / events): the heuristics
    must degrade, not crash, and keep returning well-shaped rows."""
    for i in range(ADVERSARIAL_ITERS):
        seed = BASE + 1_000_000 + i
        rng = Random(seed)
        steps = _gen_steps(rng, rng.randint(0, 25))
        segs = _gen_segments(rng, steps, wellformed=False)
        anns = _gen_annotations(rng, steps, wellformed=False)
        stats = _gen_stats(rng)
        # A few corrupt events too (null/odd data, bad timestamps).
        events = [{"event_id": "e%d" % j, "type": "activity",
                   "timestamp": rng.choice(["bad", "", _iso(_T0)]),
                   "data": rng.choice([None, {}, {"activity_label": rng.choice(_NAMES)}])}
                  for j in range(rng.randint(0, 5))]
        try:
            waste = classify_waste(steps, events, stats, segments=segs, annotations=anns)
            assert isinstance(waste, list)
            for w in waste:
                assert "va_ms" in w and "elapsed_ms" in w and isinstance(w["waste_types"], list)
            eff = compute_efficiency(waste)
            assert eff["process_efficiency_ratio"] >= 0.0
            auto = score_automation(steps, events, segments=segs, annotations=anns)
            assert isinstance(auto, list)
            for a in auto:
                assert a["data_sufficiency"] in ("single_instance", "multi_instance")
        except AssertionError as e:
            raise AssertionError(f"[iter {i}, seed {hex(seed)}] {e}") from e
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH on corrupt input [iter {i}, seed {hex(seed)}]: "
                f"{type(e).__name__}: {e}") from e
