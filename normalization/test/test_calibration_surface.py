"""Wave 0 / F3: the calibration surface.

The knobs are read from an optional `annotations['calibration']` block. The
drafting rule (contract C1) replaced the old segmenter, so only the knobs that
still apply are live (`coalesce_idle_ms`, `filter_browser_chrome`); the old
segmenter's knobs are listed in `_IGNORED_CALIBRATION_KEYS` and dropped when an
old annotations.json still carries them.

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
    import pipeline_config


_OLD_SEGMENTER_KEYS = {
    "step_split_idle_ms", "step_max_interactions", "step_min_interactions",
    "step_max_idle_ms", "step_split_on_element",
}


def test_defaults_match_prior_hardcoded_values():
    # The two knobs that still apply keep the values they always had.
    assert normalize._DEFAULT_CALIBRATION == {
        "coalesce_idle_ms": 1500,
        "filter_browser_chrome": True,
    }
    assert set(pipeline_config._IGNORED_CALIBRATION_KEYS) == _OLD_SEGMENTER_KEYS


def test_calibration_absent_returns_defaults():
    assert normalize._calibration({}) == normalize._DEFAULT_CALIBRATION
    assert normalize._calibration({"calibration": None}) == normalize._DEFAULT_CALIBRATION
    assert normalize._calibration(None) == normalize._DEFAULT_CALIBRATION


def test_calibration_override_merges_per_key():
    cal = normalize._calibration({"calibration": {"coalesce_idle_ms": 900}})
    assert cal["coalesce_idle_ms"] == 900
    # untouched keys keep their defaults
    assert cal["filter_browser_chrome"] is True


def test_unknown_calibration_keys_are_ignored():
    cal = normalize._calibration({"calibration": {"bogus_knob": 1,
                                                  "filter_browser_chrome": False}})
    assert "bogus_knob" not in cal
    assert cal["filter_browser_chrome"] is False


def test_an_old_segmenter_block_is_read_and_its_dead_keys_ignored():
    """An annotations.json written before the drafting rule still carries the
    old segmenter knobs: it loads, the live keys apply, the dead keys vanish."""
    old_block = {"step_split_idle_ms": 60000, "step_max_interactions": 5,
                 "step_min_interactions": 9, "step_max_idle_ms": 1,
                 "step_split_on_element": False, "coalesce_idle_ms": 700}
    cal = normalize._calibration({"calibration": old_block})
    assert cal == {"coalesce_idle_ms": 700, "filter_browser_chrome": True}
    assert not _OLD_SEGMENTER_KEYS & set(normalize._step_calibration_kwargs(cal))


def test_step_calibration_kwargs_subset():
    kwargs = normalize._step_calibration_kwargs(normalize._DEFAULT_CALIBRATION)
    # the coalesce-only knob is NOT passed to the drafting rule
    assert "coalesce_idle_ms" not in kwargs
    assert set(kwargs) == {"filter_browser_chrome"}
