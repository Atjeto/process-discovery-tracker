"""Per-session pipeline configuration read from annotations.json.

Extracted from normalize.py (god-file decomposition, continues F4). These are
the readers that pull analyst-authored knobs out of annotations.json
and turn them into the values the pipeline stages consume:

  * _step_ignored_processes -- the step-drafting denylist;
  * _excluded_ranges -- analyst-authored excluded-time ranges;
  * _DEFAULT_CALIBRATION / _calibration / _step_calibration_kwargs -- the F3
    calibration surface (the knobs that still apply after the drafting rule
    replaced the old segmenter; _IGNORED_CALIBRATION_KEYS lists the dead ones).

Pure; no I/O. normalize.py re-imports every name, so normalize.X and
`from normalize import X` resolve unchanged.
"""
from __future__ import annotations


def _step_ignored_processes(annotations: dict) -> list[str]:
    """Pull the per-session step denylist from annotations.json. Shape:
    {"step_filters": {"ignored_processes": ["obs64.exe", "OBS"]}}.
    Returns [] when absent so step suggestion behaves as before."""
    sf = (annotations or {}).get("step_filters") or {}
    procs = sf.get("ignored_processes") or []
    return [str(p) for p in procs if str(p).strip()]


def _excluded_ranges(annotations: dict) -> list[dict]:
    """Pull the analyst-authored excluded-time ranges from
    annotations.json. Shape: {"excluded_ranges": [{"start": iso,
    "end": iso, "reason": "manual"}, ...]}. Step suggestion and
    statistics skip events inside these. Returns [] when absent."""
    ranges = (annotations or {}).get("excluded_ranges") or []
    return [r for r in ranges if isinstance(r, dict) and r.get("start") and r.get("end")]


# Wave 0 / F3: the calibration surface, read from an optional `calibration`
# block in annotations.json (the analyst can set it per session).
#
# The drafting rule (contract C1) replaced the old segmenter, and the old
# segmenter's knobs no longer apply. Old annotations.json files still carry
# them; the block is still read, and these keys are IGNORED (dropped like any
# unknown key):
_IGNORED_CALIBRATION_KEYS = (
    "step_split_idle_ms",
    "step_max_interactions",
    "step_min_interactions",
    "step_max_idle_ms",
    "step_split_on_element",
)

# The knobs that still apply, with their defaults.
_DEFAULT_CALIBRATION = {
    "coalesce_idle_ms": 1500,       # typing-burst coalescing (coalesce.py)
    "filter_browser_chrome": True,  # drop the browser's own UI before drafting
}


def _calibration(annotations: dict) -> dict:
    """Merge an optional `annotations['calibration']` override over the defaults.
    Missing keys fall back to the default; unknown keys and the ignored old
    segmenter keys (_IGNORED_CALIBRATION_KEYS) are dropped."""
    cal = dict(_DEFAULT_CALIBRATION)
    override = (annotations or {}).get("calibration")
    if isinstance(override, dict):
        for k in _DEFAULT_CALIBRATION:
            if k in override:
                cal[k] = override[k]
    return cal


def _step_calibration_kwargs(cal: dict) -> dict:
    """The subset of the calibration surface that `auto_suggest_steps` (the
    drafting rule) accepts."""
    return {
        "filter_browser_chrome": cal["filter_browser_chrome"],
    }
