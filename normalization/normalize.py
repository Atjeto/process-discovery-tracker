"""Top-level normalization entry point (§7).

Usage:
    python normalize.py <session_folder> [--taxonomy path/to/taxonomy.yaml] [--mine]

Pipeline:
    1. Load events.jsonl, sort by timestamp
    2. Assign case_ids via marker stream walk
    3. Apply taxonomy classification rules
    4. Collapse adjacent identical events
    5. (optional --mine) Mine the drafted steps, write process_map_step.bpmn
    6. Compute statistics, write stats.json

Output goes into <session_folder>/ alongside the raw data. Re-runnable
against an updated taxonomy without recapture (§6.3) -- raw events.jsonl
is never modified.

Exit codes (contract C13). Codes 1 to 3 below report the error as one stderr
line starting with "[normalize] ERROR:"; an unexpected crash also exits 1,
with a Python traceback.
    0  success
    1  usage error, or the folder is not a session folder
    2  annotations.json exists but cannot be read; nothing was written
    3  a requested export (--pdd-out) failed; the analysis outputs were
       written, the export was not
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
    write_annotations, compute_screenshot_hashes, AnnotationsUnreadable,
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
    _run_step_segmentation, _run_classification,
    _run_stats, _run_analysis, _run_mining_exports, ExportFailed,
)


def normalize(
    session_folder: Path,
    taxonomy_path: str | None = None,
    mine: bool = False,
    pdd_out: str | None = None,
    pdd_map_image: str | None = None,
    pdd_tobe_image: str | None = None,
    names_path: str | None = None,
) -> dict[str, Any]:
    """Run the pipeline on one session folder. `names_path` is the optional
    remembered-names store (contract C4): drafted steps whose draft_key it
    lists take the remembered name."""
    events_file = session_folder / "events.jsonl"
    if not events_file.exists():
        raise FileNotFoundError(f"events.jsonl not found in {session_folder}")

    # RP-04: read annotations.json first. If it is present but unreadable this
    # raises AnnotationsUnreadable before anything, normalize.log included, is
    # written into the session folder.
    annotations = load_annotations(session_folder)

    setup_logging(session_folder=session_folder)

    manifest = load_manifest(session_folder)
    worker_id = (manifest.get("config", {}).get("worker") or {}).get("id", "unknown")

    raw, dropped_lines = load_events(events_file)
    print(f"[normalize] loaded {len(raw)} raw events")
    if dropped_lines:
        print(f"[normalize] WARNING: dropped {dropped_lines} malformed JSONL line(s); see warnings above")

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
    with_cases, cases, vocab_summary = _run_case_assignment(edited, session_id_str)

    existing_anno = _init_existing_anno(annotations, session_id_str)
    # Additive, regenerated each run: what the self/ignored-process filter dropped.
    existing_anno["process_exclusions"] = exclude_report

    # Step drafting (the C1 rule), then persist annotations.
    merged_steps, total_interactions, draft_summary = _run_step_segmentation(
        with_cases, cases, existing_anno, session_id_str, cal, session_folder,
        names_path=names_path)

    # Taxonomy classification + analyst overrides + the two collapses.
    classified, collapsed, log_events, taxonomy, taxonomy_report = (
        _run_classification(with_cases, annotations, taxonomy_path))

    # Statistics summary + stats.json.
    summary, stats_path = _run_stats(
        session_folder, log_events, cases, existing_anno, taxonomy,
        taxonomy_path, taxonomy_report, worker_id, raw, dropped_lines,
        collapsed, total_interactions, edits_applied, merged_steps,
        coalesced, vocab_summary, draft_summary=draft_summary)

    # Analysis layer (ADR-0008), best-effort -- never blocks the pipeline.
    # Phase A (LAB-PHASE-SPEC §A1-§A3): cases feed the additive
    # case_quality / facts / findings blocks.
    analysis_result = _run_analysis(
        session_folder, classified, existing_anno, summary, manifest,
        cases=cases)

    # The step-level BPMN (--mine) + the requested PDD export. A failed PDD
    # export raises ExportFailed after every analysis output is written.
    _run_mining_exports(
        session_folder, existing_anno, mine, summary, manifest,
        analysis_result, pdd_out, pdd_map_image, pdd_tobe_image,
        events=classified)

    return {
        "session_folder": str(session_folder),
        "events_in": len(raw),
        "events_out": sum(1 for e in collapsed if e.get("type") == "activity"),
        "cases": len(cases),
        "outputs": {
            "stats": str(stats_path),
        },
    }


def _fail(code: int, message: str) -> None:
    """Contract C13: report an error as ONE stderr line, then exit."""
    one_line = str(message).replace("\r", " ").replace("\n", " ")
    print(f"[normalize] ERROR: {one_line}", file=sys.stderr, flush=True)
    sys.exit(code)


class _ArgumentParser(argparse.ArgumentParser):
    """argparse exits 2 on a usage error, but C13 reserves exit code 2 for an
    unreadable annotations.json, so a usage error exits 1 here."""

    def error(self, message: str) -> None:  # overrides the argparse hook
        _fail(1, f"{message} (run normalize.py --help for the options)")


def main():
    parser = _ArgumentParser(
        description="Normalize a captured process-discovery session into drafted steps, "
                    "stats and analysis."
    )
    parser.add_argument("session_folder", type=Path, nargs="?",
                        help="Path to the session folder.")
    parser.add_argument("--taxonomy", type=str, default=None,
                        help="Path to taxonomy.yaml. Falls back to no classification.")
    parser.add_argument("--mine", action="store_true",
                        help="Mine the drafted steps into the step-level BPMN, "
                             "process_map_step.bpmn. Without this flag no BPMN is written.")
    parser.add_argument("--pdd-out", type=str, default=None,
                        help="Write PDD .docx to this path.")
    parser.add_argument("--pdd-map-image", type=str, default=None,
                        help="PNG of the process map to embed in the PDD's As-Is map section.")
    parser.add_argument("--pdd-tobe-image", type=str, default=None,
                        help="PNG of an analyst-authored To-Be reference map to embed in the "
                             "PDD's proposed-to-be section (ADR-0019). Hand-drawn, not mined.")
    parser.add_argument("--names", type=str, default=None,
                        help="Remembered-names store (remembered-names.json). A drafted step "
                             "whose draft key is listed takes the remembered name. Optional: "
                             "a missing or unreadable file prints a warning and drafting uses "
                             "the default names.")
    args = parser.parse_args()

    setup_logging()

    if not args.session_folder or not args.session_folder.is_dir():
        _fail(1, f"{args.session_folder} is not a session folder")
    try:
        result = normalize(
            args.session_folder,
            taxonomy_path=args.taxonomy,
            mine=args.mine,
            pdd_out=args.pdd_out,
            pdd_map_image=args.pdd_map_image,
            pdd_tobe_image=args.pdd_tobe_image,
            names_path=args.names,
        )
    except AnnotationsUnreadable as exc:
        _fail(2, str(exc))
    except ExportFailed as exc:
        _fail(3, str(exc))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
