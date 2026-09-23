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
import sys
from pathlib import Path
from typing import Any

# Python embeddable distributions do not auto-add the script's directory
# to sys.path (the ._pth file overrides default behavior). Add it ourselves
# so sibling modules (case_assignment, classification, ...) import cleanly
# whether we run under regular Python or the bundled embeddable.
sys.path.insert(0, str(Path(__file__).resolve().parent))

# The pipeline stages (pipeline_stages.py) own the case-assignment /
# classification / step / stats / mining imports now; normalize() only
# orchestrates. It keeps the few it still touches directly: logging setup and
# the self/ignored-process filter it runs inline.
from log_setup import setup_logging
from process_filter import filter_excluded
# Session-folder I/O + marker-edit replay live in focused sibling modules
# (god-file decomposition, continues F4). Re-imported here so normalize.X and
# `from normalize import X` keep resolving and every internal call site is
# unchanged.
from session_io import (
    _coerce_event_shape, load_events, load_manifest, load_annotations,
    write_annotations, compute_screenshot_hashes,
)
from marker_edits import apply_marker_edits
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


# apply_marker_edits lives in marker_edits.py (re-imported above).


# The named pipeline stage helpers live in pipeline_stages.py (god-file
# decomposition; completes the F4 split). Imported here so the (now thin)
# normalize() orchestrator calls them as before and `normalize._run_*`
# resolves unchanged.
from pipeline_stages import (
    _run_coalesce, _run_case_assignment, _init_existing_anno,
    _run_step_segmentation, _run_classification, _run_event_log_export,
    _run_stats, _run_analysis, _run_mining_exports,
)


def normalize(
    session_folder: Path,
    taxonomy_path: str | None = None,
    mine: bool = False,
    pdd_out: str | None = None,
    pdd_map_image: str | None = None,
    pdd_tobe_image: str | None = None,
    step_bpmn_out: str | None = None,
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

    # Stage 1.0: drop PDT's own interactions (operator panel / label picker /
    # dialogs) + any analyst-excluded process/window from the DERIVED stream.
    # Raw events.jsonl is immutable, so re-analyzing cleans an existing session.
    # Done BEFORE coalesce/case-assignment so the self-capture noise never mines
    # into phantom steps or pools into the __nocase__ bucket (which exploded the
    # single-case map into a gateway flower).
    raw, exclude_report = filter_excluded(raw, manifest, annotations)
    if exclude_report.get("excluded_count"):
        print(f"[normalize] excluded {exclude_report['excluded_count']} self/"
              f"ignored-process event(s) ({exclude_report['by_process']})")

    # Stage 1a: coalesce typing bursts + apply annotation marker edits.
    coalesced, edited, edits_applied = _run_coalesce(raw, annotations, cal)

    # Stage 2a/3: marker-based case assignment + app-vocab enrichment.
    with_cases, cases, vocab_summary = _run_case_assignment(edited)

    existing_anno = _init_existing_anno(annotations, session_id_str)
    # Additive, regenerated each run: what the self/ignored-process filter dropped.
    existing_anno["process_exclusions"] = exclude_report

    # Step segmentation (auto-suggest), then persist annotations.
    merged_steps, total_interactions = _run_step_segmentation(
        with_cases, cases, existing_anno, session_id_str, cal, session_folder)

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
        collapsed, total_interactions, edits_applied, merged_steps,
        coalesced, vocab_summary)

    # Analysis layer (ADR-0008), best-effort -- never blocks the pipeline.
    # Phase A (LAB-PHASE-SPEC §A1-§A3): cases feed the additive
    # case_quality / facts / findings blocks.
    analysis_result = _run_analysis(
        session_folder, classified, existing_anno, summary, manifest,
        cases=cases)

    # Mining (DFG / BPMN variants) + Phase E exports (PDD, step BPMN).
    _run_mining_exports(
        session_folder, log, existing_anno, mine, summary, manifest,
        analysis_result, pdd_out, pdd_map_image, step_bpmn_out, pdd_tobe_image)

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
    parser.add_argument("--pdd-out", type=str, default=None,
                        help="Write PDD .docx to this path.")
    parser.add_argument("--pdd-map-image", type=str, default=None,
                        help="PNG of the process map to embed in the PDD's As-Is map section.")
    parser.add_argument("--pdd-tobe-image", type=str, default=None,
                        help="PNG of an analyst-authored To-Be reference map to embed in the "
                             "PDD's proposed-to-be section (ADR-0019). Hand-drawn, not mined.")
    parser.add_argument("--step-bpmn-out", type=str, default=None,
                        help="Write step-level BPMN to this path.")
    args = parser.parse_args()

    setup_logging()

    if not args.session_folder or not args.session_folder.is_dir():
        print(f"ERROR: {args.session_folder} is not a directory", file=sys.stderr)
        sys.exit(2)
    result = normalize(
        args.session_folder,
        taxonomy_path=args.taxonomy,
        mine=args.mine,
        pdd_out=getattr(args, "pdd_out"),
        pdd_map_image=getattr(args, "pdd_map_image", None),
        pdd_tobe_image=getattr(args, "pdd_tobe_image", None),
        step_bpmn_out=getattr(args, "step_bpmn_out"),
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
