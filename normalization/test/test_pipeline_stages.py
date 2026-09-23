"""Tests for pipeline_stages -- the normalize() stage orchestration
(review coverage gap #16). Focused on _init_existing_anno, which guards the
NON-DESTRUCTIVE re-normalize invariant: analyst blocks are preserved and the
lists the pipeline appends to are seeded.

pipeline_stages imports xes_export (pandas + pm4py) at module top, so this
SKIPS loudly under bare pytest and runs where the deps exist:
    viewer/python/python.exe normalization/test/test_pipeline_stages.py
    pytest (CI env with requirements.txt installed)
"""

from __future__ import annotations
import copy
import importlib.util
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_HAVE_DEPS = all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py"))
try:
    import pytest
    if not _HAVE_DEPS:
        pytest.skip(
            "pandas/pm4py not installed (system Python) -- run via the bundled "
            "python or a CI env with requirements.txt",
            allow_module_level=True,
        )
except ImportError:
    pass

from pipeline_stages import _init_existing_anno


def test_init_seeds_the_append_lists_and_sets_identity():
    anno = _init_existing_anno({}, "sess-123")
    for key in ("annotations", "notes", "marker_edits", "reference_maps"):
        assert anno[key] == [], f"{key} should be seeded to []"
    # Keys of removed features are no longer written by the pipeline.
    for key in ("phases", "drift_markers"):
        assert key not in anno, f"{key} must not be seeded any more"
    assert anno["version"] == 1
    assert anno["session_id"] == "sess-123"


def test_init_round_trips_legacy_keys_of_removed_features():
    """Contract C10: keys the pipeline no longer owns survive re-normalization
    verbatim (never regenerated, never deleted), so an old annotations.json
    loads and re-analyzes without losing the analyst's data."""
    legacy = {
        "phases": [{"phase_id": "p", "step_ids": ["gone"]}],
        "marker_suggestions": [{"x": 1}],
        "marker_suggestions_dismissed": ["sig-1"],
        "anchor_candidates": [{"signature": "a"}],
        "anchor_candidates_dismissed": ["sig-2"],
        "case_anchor_override": {"field": "automation_id", "equals": "x"},
        "roi_inputs": {"loaded_cost_per_hour": 36},
        "pii_masking": {"applied": True},
        "pii_masking_config": {"enabled": False},
        "self_annotations": [{"q": "a"}],
        "group_annotations": [{"case_id": "c1", "name": "n"}],
        "memo_selection": ["f-1"],
        "drift_markers": [{"marker_id": "m"}],
        "matched_against": {"canonical_process_id": "t", "canonical_version": 1},
        "classification_overrides": [{"scope": "instance"}],
    }
    anno = _init_existing_anno(copy.deepcopy(legacy), "sess-legacy")
    for key, value in legacy.items():
        assert anno[key] == value, f"legacy key {key} was not round-tripped verbatim"


def test_init_preserves_existing_analyst_blocks():
    existing = {
        "steps": [{"step_id": "s1", "state": "manually_authored"}],
        "notes": [{"id": "n1", "text": "keep me"}],
        "reference_maps": [{"id": "ref-1", "type": "to_be"}],
        "pii_masking_config": {"enabled": False},
        "case_anchor_override": {"field": "automation_id"},
    }
    anno = _init_existing_anno(existing, "sess-9")
    assert anno["steps"] == existing["steps"]
    assert anno["notes"] == [{"id": "n1", "text": "keep me"}]      # not clobbered
    assert anno["reference_maps"] == [{"id": "ref-1", "type": "to_be"}]
    assert anno["pii_masking_config"] == {"enabled": False}        # analyst-owned block kept
    assert anno["case_anchor_override"] == {"field": "automation_id"}


def test_init_does_not_mutate_the_caller_top_level_dict():
    existing = {"steps": []}
    anno = _init_existing_anno(existing, "sess-1")
    # The function works on a shallow copy: keys it seeds appear on the result,
    # not on the caller's original dict.
    assert "annotations" in anno
    assert "annotations" not in existing
    assert anno is not existing


def test_init_tolerates_a_non_dict_annotations():
    anno = _init_existing_anno(None, "sess-x")        # e.g. missing annotations.json
    assert anno["session_id"] == "sess-x"
    assert anno["annotations"] == [] and anno["reference_maps"] == []


if __name__ == "__main__":
    if not _HAVE_DEPS:
        print("SKIP: pandas/pm4py not available")
        sys.exit(0)
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
