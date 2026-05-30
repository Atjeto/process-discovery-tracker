"""Per-session pipeline configuration read from annotations.json.

Extracted from normalize.py (god-file decomposition, continues F4). These are
the readers that pull analyst-/template-authored knobs out of annotations.json
and turn them into the values the pipeline stages consume:

  * _step_ignored_processes -- the step-suggestion denylist;
  * _excluded_ranges -- analyst-authored excluded-time ranges;
  * _DEFAULT_CALIBRATION / _calibration / _step_calibration_kwargs -- the F3
    segmentation calibration surface (defaults match the prior hardcoded
    values EXACTLY, so absent an override the pipeline output is unchanged).

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


# Wave 0 / F3: the segmentation calibration surface. These knobs were previously
# locked as `coalesce_typing_bursts` / `auto_suggest_steps` keyword defaults and
# UNREACHABLE from a session (the two call sites passed none of them), so the
# over-segmentation ("308-step") class could not be tuned without editing code.
# They are now read from an optional `calibration` block in annotations.json (a
# Process Template or analyst can set it per session). Defaults match the prior
# hardcoded values EXACTLY, so absent an override the pipeline output is unchanged.
_DEFAULT_CALIBRATION = {
    "coalesce_idle_ms": 1500,
    "step_split_idle_ms": 10000,
    "step_max_interactions": 60,
    "step_min_interactions": 2,
    "step_max_idle_ms": 5000,
    "step_split_on_element": True,
    "filter_browser_chrome": True,
}


def _calibration(annotations: dict) -> dict:
    """Merge an optional `annotations['calibration']` override over the defaults.
    Missing keys fall back to the prior hardcoded value; unknown keys are ignored."""
    cal = dict(_DEFAULT_CALIBRATION)
    override = (annotations or {}).get("calibration")
    if isinstance(override, dict):
        for k in _DEFAULT_CALIBRATION:
            if k in override:
                cal[k] = override[k]
    return cal


def _step_calibration_kwargs(cal: dict) -> dict:
    """The subset of the calibration surface that `auto_suggest_steps` accepts."""
    return {
        "step_split_idle_ms": cal["step_split_idle_ms"],
        "step_max_interactions": cal["step_max_interactions"],
        "step_min_interactions": cal["step_min_interactions"],
        "step_max_idle_ms": cal["step_max_idle_ms"],
        "step_split_on_element": cal["step_split_on_element"],
        "filter_browser_chrome": cal["filter_browser_chrome"],
    }
