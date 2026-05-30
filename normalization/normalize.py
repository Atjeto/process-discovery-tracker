"""Top-level normalization entry point (§7).

Usage:
    python normalize.py <session_folder> [--taxonomy path/to/taxonomy.yaml] [--mine]

Pipeline:
    1. Load events.jsonl, sort by timestamp
    2. Assign case_ids via marker stream walk
    3. Apply taxonomy classification rules
    4. Collapse adjacent identical events
    5. Write events.xes + events.csv
    6. (optional --mine) Run PM4Py inductive miner, write process_map.bpmn
    7. Compute statistics, write stats.json

Output goes into <session_folder>/ alongside the raw data. Re-runnable
against an updated taxonomy without recapture (§6.3) -- raw events.jsonl
is never modified.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import os
import sys
import uuid as _uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Python embeddable distributions do not auto-add the script's directory
# to sys.path (the ._pth file overrides default behavior). Add it ourselves
# so sibling modules (case_assignment, classification, ...) import cleanly
# whether we run under regular Python or the bundled embeddable.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from case_assignment import (
    assign_case_ids, collect_cases,
    detect_cases_from_anchors, stamp_anchor_cases,
)
from coalesce import coalesce_typing_bursts
from classification import (
    classify_events,
    collapse_adjacent,
    collapse_activity_occurrences,
    load_taxonomy,
)
from classification_overrides import apply_classification_overrides
from log_setup import setup_logging
from xes_export import build_event_log, export_xes, export_csv
from step_suggest import (
    auto_suggest_steps, drop_overlapping_auto_steps, _merge_steps,
)
from marker_suggest import suggest_markers, merge_marker_suggestions
from anchor_suggest import (
    suggest_anchors, merge_anchor_candidates, coerce_anchor_override,
)
import app_vocab
import stats_compute as stats
from pii_masking import mask_events
# Session-folder I/O + marker-edit replay live in focused sibling modules
# (god-file decomposition, continues F4). Re-imported here so normalize.X and
# `from normalize import X` keep resolving and every internal call site is
# unchanged.
from session_io import (
    _coerce_event_shape, load_events, load_manifest, load_annotations,
    write_annotations, compute_screenshot_hashes,
)
from marker_edits import apply_marker_edits
from phase_reconcile import (
    _merge_phases, reconcile_phase_membership, _compute_drift_markers,
)
from pipeline_config import (
    _step_ignored_processes, _excluded_ranges,
    _DEFAULT_CALIBRATION, _calibration, _step_calibration_kwargs,
)


# load_events / _coerce_event_shape / load_manifest / load_annotations /
# write_annotations live in session_io.py (re-imported above).


# _step_ignored_processes / _excluded_ranges / the F3 calibration surface
# (_DEFAULT_CALIBRATION / _calibration / _step_calibration_kwargs) live in
# pipeline_config.py (re-imported above).


# compute_screenshot_hashes lives in session_io.py (re-imported above).


# _merge_phases / reconcile_phase_membership / _compute_drift_markers live in
# phase_reconcile.py (re-imported above).


# apply_marker_edits lives in marker_edits.py (re-imported above).


# The named pipeline stage helpers live in pipeline_stages.py (god-file
# decomposition; completes the F4 split). Imported here so the (now thin)
# normalize() orchestrator calls them as before and `normalize._run_*`
# resolves unchanged.
from pipeline_stages import (
    _run_coalesce, _run_case_assignment, _init_existing_anno, _run_suggestions,
    _run_step_segmentation, _run_classification, _run_event_log_export,
    _run_stats, _run_analysis, _run_mining_exports,
)


def normalize(
    session_folder: Path,
    taxonomy_path: str | None = None,
    mine: bool = False,
    canonical_path: str | None = None,
    pdd_out: str | None = None,
    pdd_map_image: str | None = None,
    step_bpmn_out: str | None = None,
    phase_bpmn_out: str | None = None,
    step_csv_out: str | None = None,
) -> dict[str, Any]:
    events_file = session_folder / "events.jsonl"
    if not events_file.exists():
        raise FileNotFoundError(f"events.jsonl not found in {session_folder}")

    setup_logging(session_folder=session_folder)

    manifest = load_manifest(session_folder)
    worker_id = (manifest.get("config", {}).get("worker") or {}).get("id", "unknown")

    raw, dropped_lines = load_events(events_file)
    print(f"[normalize] loaded {len(raw)} raw events")
    if dropped_lines:
        print(f"[normalize] WARNING: dropped {dropped_lines} malformed JSONL line(s); see warnings above")

    annotations = load_annotations(session_folder)
    cal = _calibration(annotations)
    session_id_str = manifest.get("session_id", "")

    # Stage 1a: coalesce typing bursts + apply annotation marker edits.
    coalesced, edited, edits_applied = _run_coalesce(raw, annotations, cal)

    # Stage 1b: structural PII masking (§11f). Redact sensitive UIA field
    # VALUES in the DERIVED stream only -- raw events.jsonl is never rewritten,
    # so this masks the copy that feeds csv/xes/stats/steps/analysis/maps.
    edited, pii_report = mask_events(edited, annotations, session_id=session_id_str)
    if pii_report.get("masked_value_count"):
        print(f"[normalize] PII masking: redacted "
              f"{pii_report['masked_value_count']} field value(s) "
              f"({pii_report['rules_fired']})")

    # Stage 2a/3: case assignment (anchor / marker mode) + app-vocab enrichment.
    # A stale Process Template path is downgraded to "no template" inside.
    with_cases, cases, canonical, canonical_path, vocab_summary = _run_case_assignment(
        edited, annotations, canonical_path)

    existing_anno = _init_existing_anno(annotations, session_id_str)
    # Record which rule-set ran (Python owns this additive key; the analyst-owned
    # pii_masking_config controls it). Persisted by the step-segmentation write.
    existing_anno["pii_masking"] = pii_report

    # Suggested markers (ADR-0017) + anchor candidates (ADR-0018), best-effort.
    _run_suggestions(existing_anno, with_cases, cases)

    # Step segmentation (canonical match / auto-suggest) + phase rollup.
    merged_steps, matched_interactions, unmatched_evs, total_interactions = (
        _run_step_segmentation(
            with_cases, cases, canonical_path, canonical, existing_anno,
            session_id_str, cal, session_folder))

    # Taxonomy classification + analyst overrides + the two collapses.
    classified, collapsed, log_events, taxonomy, taxonomy_report = (
        _run_classification(with_cases, annotations, taxonomy_path))

    # Build the PM4Py event log + write events.xes / events.csv.
    log, xes_path, csv_path = _run_event_log_export(
        log_events, collapsed, cases, worker_id, session_folder)

    # Statistics summary + stats.json.
    summary, stats_path = _run_stats(
        session_folder, log_events, cases, existing_anno, taxonomy,
        taxonomy_path, taxonomy_report, worker_id, raw, dropped_lines,
        collapsed, total_interactions, matched_interactions, edits_applied,
        merged_steps, canonical, canonical_path, coalesced, vocab_summary,
        unmatched_evs)

    # Analysis layer (ADR-0008), best-effort -- never blocks the pipeline.
    analysis_result = _run_analysis(
        session_folder, classified, existing_anno, summary, manifest)

    # Mining (DFG / BPMN variants) + Phase E exports (PDD, BPMN, step CSV).
    _run_mining_exports(
        session_folder, log, existing_anno, mine, canonical, summary,
        manifest, analysis_result, pdd_out, pdd_map_image, step_bpmn_out,
        phase_bpmn_out, step_csv_out)

    return {
        "session_folder": str(session_folder),
        "events_in": len(raw),
        "events_out": sum(1 for e in collapsed if e.get("type") == "activity"),
        "cases": len(cases),
        "outputs": {
            "xes": str(xes_path),
            "csv": str(csv_path),
            "stats": str(stats_path),
        },
    }


def main():
    parser = argparse.ArgumentParser(
        description="Normalize a captured process-discovery session into XES + CSV + stats."
    )
    parser.add_argument("session_folder", type=Path, nargs="?",
                        help="Path to the session folder.")
    parser.add_argument("--taxonomy", type=str, default=None,
                        help="Path to taxonomy.yaml. Falls back to no classification.")
    parser.add_argument("--mine", action="store_true",
                        help="Run PM4Py inductive miner and emit process_map.bpmn + dfg.json.")
    parser.add_argument("--canonical", type=str, default=None,
                        help="Path to canonical step set YAML.")
    parser.add_argument("--pdd-out", type=str, default=None,
                        help="Write PDD .docx to this path.")
    parser.add_argument("--pdd-map-image", type=str, default=None,
                        help="PNG of the process map to embed in the PDD's As-Is map section.")
    parser.add_argument("--step-bpmn-out", type=str, default=None,
                        help="Write step-level BPMN to this path.")
    parser.add_argument("--phase-bpmn-out", type=str, default=None,
                        help="Write phase-level BPMN to this path.")
    parser.add_argument("--step-csv-out", type=str, default=None,
                        help="Write step CSV to this path.")
    parser.add_argument("--bootstrap-vocab-out", type=str, default=None,
                        help="Generate a starter App Vocabulary YAML from this session's "
                             "interactions and write to the given path. Skips full normalization.")
    parser.add_argument("--vocab-id", type=str, default="untitled",
                        help="Vocabulary id (used with --bootstrap-vocab-out).")
    parser.add_argument("--vocab-name", type=str, default="Untitled",
                        help="Vocabulary display name (used with --bootstrap-vocab-out).")
    args = parser.parse_args()

    setup_logging()

    if args.bootstrap_vocab_out:
        if not args.session_folder or not args.session_folder.is_dir():
            print(f"ERROR: session folder required for --bootstrap-vocab-out", file=sys.stderr)
            sys.exit(2)
        events, _dropped = load_events(args.session_folder / "events.jsonl")
        doc = app_vocab.bootstrap_from_session(
            events, vocab_id=args.vocab_id, vocab_name=args.vocab_name)
        yaml_text = app_vocab.to_yaml(doc)
        with open(args.bootstrap_vocab_out, "w", encoding="utf-8") as f:
            f.write(yaml_text)
        print(json.dumps({"ok": True, "vocab_path": args.bootstrap_vocab_out,
                          "interactions": len(doc["app_vocabulary"].get("interactions") or [])}, indent=2))
        return

    if not args.session_folder or not args.session_folder.is_dir():
        print(f"ERROR: {args.session_folder} is not a directory", file=sys.stderr)
        sys.exit(2)
    result = normalize(
        args.session_folder,
        taxonomy_path=args.taxonomy,
        mine=args.mine,
        canonical_path=args.canonical,
        pdd_out=getattr(args, "pdd_out"),
        pdd_map_image=getattr(args, "pdd_map_image", None),
        step_bpmn_out=getattr(args, "step_bpmn_out"),
        phase_bpmn_out=getattr(args, "phase_bpmn_out"),
        step_csv_out=getattr(args, "step_csv_out"),
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
