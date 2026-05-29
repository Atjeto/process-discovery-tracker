"""Wave 0 / F3 — the segmentation calibration surface.

Pins the contract that the segmentation knobs (previously locked as
`auto_suggest_steps` / `coalesce_typing_bursts` keyword defaults and unreachable
from a session) are now read from an optional `annotations['calibration']` block,
with defaults that exactly match the prior hardcoded values.

Skips where the pipeline deps are absent (importing `normalize` pulls pandas); gates
in CI. End-to-end reachability (an override actually changes step_count) is covered by
the golden gate + a manual check; this pins the merge/contract logic.
"""
import importlib.util

import pytest

_DEPS_OK = all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py"))
pytestmark = pytest.mark.skipif(not _DEPS_OK, reason="pipeline deps (pandas/pm4py) not installed")

if _DEPS_OK:
    import normalize


def test_defaults_match_prior_hardcoded_values():
    # These are the values auto_suggest_steps / coalesce shipped with; absent an
    # override, behaviour must be unchanged (the golden gate enforces this too).
    assert normalize._DEFAULT_CALIBRATION == {
        "coalesce_idle_ms": 1500,
        "step_split_idle_ms": 10000,
        "step_max_interactions": 60,
        "step_min_interactions": 2,
        "step_max_idle_ms": 5000,
        "step_split_on_element": True,
        "filter_browser_chrome": True,
    }


def test_calibration_absent_returns_defaults():
    assert normalize._calibration({}) == normalize._DEFAULT_CALIBRATION
    assert normalize._calibration({"calibration": None}) == normalize._DEFAULT_CALIBRATION
    assert normalize._calibration(None) == normalize._DEFAULT_CALIBRATION


def test_calibration_override_merges_per_key():
    cal = normalize._calibration({"calibration": {"step_split_on_element": False,
                                                  "step_split_idle_ms": 60000}})
    assert cal["step_split_on_element"] is False
    assert cal["step_split_idle_ms"] == 60000
    # untouched keys keep their defaults
    assert cal["step_max_interactions"] == 60
    assert cal["coalesce_idle_ms"] == 1500


def test_unknown_calibration_keys_are_ignored():
    cal = normalize._calibration({"calibration": {"bogus_knob": 1, "step_min_interactions": 9}})
    assert "bogus_knob" not in cal
    assert cal["step_min_interactions"] == 9


def test_step_calibration_kwargs_subset():
    kwargs = normalize._step_calibration_kwargs(normalize._DEFAULT_CALIBRATION)
    # the coalesce-only knob is NOT passed to auto_suggest_steps
    assert "coalesce_idle_ms" not in kwargs
    assert set(kwargs) == {
        "step_split_idle_ms", "step_max_interactions", "step_min_interactions",
        "step_max_idle_ms", "step_split_on_element", "filter_browser_chrome",
    }
