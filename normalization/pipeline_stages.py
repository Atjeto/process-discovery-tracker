"""The normalization pipeline's named stage helpers.

Extracted from normalize.py (god-file decomposition; completes the F4 split).
Each `_run_*` helper is the verbatim body of one stage of the former
normalize() god-function -- a pure structural extraction (zero behavior
change). Shared state (events, annotations/existing_anno, the `cal` calibration
dict, session_id, flags) is threaded explicitly rather than via a closure, and
each stage keeps its original best-effort try/except exactly where it was.

normalize.py imports every `_run_*` / `_init_existing_anno` name below and calls
them from its (now thin) orchestrator, so `normalize.X` resolves unchanged.
The heavier optional deps (analysis, mining, pm4py, bpmn_observed, pdd_export)
stay as function-local imports exactly as before, so they are only paid for
when that stage/export actually runs.
"""
from __future__ import annotations

import json
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Python embeddable distributions do not auto-add the script's directory to
# sys.path; mirror normalize.py so sibling imports resolve under the bundled
# embeddable too.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from case_assignment import assign_case_ids, collect_cases
from coalesce import coalesce_typing_bursts
from classification import (
    classify_events,
    collapse_adjacent,
    collapse_activity_occurrences,
    load_taxonomy,
)
from classification_overrides import apply_classification_overrides
from xes_export import build_event_log, export_xes, export_csv
from step_suggest import (
    auto_suggest_steps, _merge_steps, restamp_preserved_case_ids,
    draft_summary, load_remembered_names,
)
import app_vocab
import stats_compute as stats
from session_io import write_annotations, compute_screenshot_hashes
from marker_edits import apply_marker_edits
from pipeline_config import (
    _step_ignored_processes, _excluded_ranges, _step_calibration_kwargs,
)

logger = logging.getLogger(__name__)


class ExportFailed(Exception):
    """A requested export failed after the analysis outputs were written.
    Contract C13 exit code 3 (RP-09)."""


def _run_coalesce(
    raw: list[dict[str, Any]],
    annotations: dict[str, Any],
    cal: dict,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    """Stage 1a: coalesce typing bursts, then apply annotation marker edits.
    Returns (coalesced, edited, edits_applied)."""
    coalesced = coalesce_typing_bursts(raw, idle_ms=cal["coalesce_idle_ms"])
    if len(coalesced) < len(raw):
        print(f"[normalize] coalesced: {len(raw)} -> {len(coalesced)} events")

    edited, edits_applied = apply_marker_edits(coalesced, annotations)
    if edits_applied:
        print(f"[normalize] applied {edits_applied} annotation edit(s) from annotations.json")
    return coalesced, edited, edits_applied


def _run_case_assignment(
    edited: list[dict[str, Any]],
    session_id_str: str,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict]:
    """Stage 2a/3: marker-based case assignment + app-vocab enrichment.
    Returns (with_cases, cases, vocab_summary). `session_id_str` seeds the
    deterministic case ids (RP-01)."""
    with_cases = assign_case_ids(edited, session_id=session_id_str)
    cases = collect_cases(with_cases)
    print(f"[normalize] identified {len(cases)} cases")

    # App vocabulary enrichment (ADR-0002). Non-destructive: adds
    # meaningful_name / screen_id / vocab_flags / vocab_source onto each
    # matched interaction event. Step suggestion below picks these up.
    vocabs = app_vocab.load_vocabularies()
    if vocabs:
        with_cases, vocab_summary = app_vocab.enrich_events(with_cases, vocabs)
        print(f"[normalize] app vocabs: {vocab_summary['matched']}/{vocab_summary['total']} "
              f"interactions enriched ({len(vocabs)} vocab(s) loaded)")
    else:
        vocab_summary = {"matched": 0, "total": 0, "vocabs_loaded": [],
                         "vocabs_hit": {}, "coverage": {}}
    return with_cases, cases, vocab_summary


def _init_existing_anno(annotations: dict, session_id_str: str) -> dict[str, Any]:
    """Build the working annotations dict the step/analysis stages mutate,
    preserving the analyst's existing blocks and seeding the lists the
    pipeline appends to. Keys of removed features (phases, drift_markers,
    anchor / suggestion keys, roi_inputs, pii_masking, ...) are neither seeded
    nor regenerated: when present they round-trip verbatim, never deleted."""
    existing_anno = dict(annotations) if isinstance(annotations, dict) else {}
    existing_anno.setdefault("annotations", [])
    existing_anno.setdefault("notes", existing_anno.get("notes") or [])
    existing_anno.setdefault("marker_edits", existing_anno.get("marker_edits") or [])
    # ADR-0019: analyst-authored reference maps. A decoupled one-way leaf —
    # no stage ever writes this key, so it (and the derived_maps/*.bpmn it
    # points at) round-trips every re-normalize untouched. Just ensure it exists.
    existing_anno.setdefault("reference_maps", existing_anno.get("reference_maps") or [])
    existing_anno["version"] = 1
    existing_anno["session_id"] = session_id_str
    return existing_anno


def _run_step_segmentation(
    with_cases: list[dict[str, Any]],
    cases: dict[str, dict[str, Any]],
    existing_anno: dict,
    session_id_str: str,
    cal: dict,
    session_folder: Path,
    names_path: str | None = None,
) -> tuple[list[dict[str, Any]], int, dict[str, Any]]:
    """Step drafting (the C1 rule), then persist annotations. Returns
    (merged_steps, total_interactions, draft_summary). `names_path` is the
    optional remembered-names store (C4, the `--names` flag)."""
    total_interactions = sum(1 for e in with_cases if e.get("type") == "interaction")
    # ADR-0024: event_id -> interaction, so _merge_steps can resolve each step's
    # grain_keys (the view-time roll-up containment keys) from its evidence.
    interactions_by_id = {
        e["event_id"]: e for e in with_cases
        if e.get("type") == "interaction" and e.get("event_id")
    }
    auto_steps = auto_suggest_steps(
        with_cases, session_id=session_id_str,
        ignored_processes=_step_ignored_processes(existing_anno),
        excluded_ranges=_excluded_ranges(existing_anno),
        remembered_names=load_remembered_names(names_path),
        **_step_calibration_kwargs(cal),
    )
    # Counted on the fresh drafts, before the merge (see draft_summary).
    summary = draft_summary(auto_steps, cases, interactions_by_id)
    merged_steps = _merge_steps(existing_anno.get("steps") or [], auto_steps,
                                interactions_by_id)
    # RP-01 / C9: a preserved analyst step keeps its case_id only while that
    # run still exists; otherwise it moves to the run containing it in time.
    restamped = restamp_preserved_case_ids(merged_steps, cases)
    if restamped:
        print(f"[normalize] moved {restamped} analyst step(s) to the run "
              f"that contains them (their previous run id no longer exists)")
    existing_anno["steps"] = merged_steps
    write_annotations(session_folder, existing_anno)
    print(f"[normalize] drafted {len(auto_steps)} step(s) "
          f"({len(merged_steps)} total after merge)")
    return merged_steps, total_interactions, summary


def _run_classification(
    with_cases: list[dict[str, Any]],
    annotations: dict,
    taxonomy_path: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict, list]:
    """Taxonomy classification + analyst overrides + the two collapses. Returns
    (classified, collapsed, log_events, taxonomy, taxonomy_report)."""
    taxonomy = load_taxonomy(taxonomy_path) if taxonomy_path else {"rules": []}
    print(f"[normalize] taxonomy: {len(taxonomy.get('rules', []))} rules")

    classified, taxonomy_report = classify_events(with_cases, taxonomy)
    for _r in taxonomy_report:
        if _r["zero_match"]:
            _rx = f" (title pattern: {_r['title_regex']})" if _r["title_regex"] else ""
            print(f"[normalize] note: taxonomy rule '{_r['label']}'{_rx} "
                  f"matched 0 events")
    # Analyst classification corrections (annotations.json) override the
    # taxonomy result -- applied last so the analyst's judgement wins, and
    # before collapse so a correction that unifies two labels then
    # collapses cleanly. See design §6.1 / §7.2.
    classified, overrides_applied = apply_classification_overrides(classified, annotations)
    if overrides_applied:
        print(f"[normalize] applied {overrides_applied} classification override(s) from annotations.json")
    collapsed = collapse_adjacent(classified)
    print(f"[normalize] collapsed: {sum(1 for e in classified if e.get('type') == 'activity')} -> "
          f"{sum(1 for e in collapsed if e.get('type') == 'activity')} activity events")

    # events.csv keeps the per-window rows (`collapsed`); the process-mining
    # event log collapses further -- one row per activity occurrence -- so the
    # DFG/BPMN cannot contain a directly-follows self-loop. See design §7.1.
    log_events = collapse_activity_occurrences(classified)
    print(f"[normalize] event-log occurrences: "
          f"{sum(1 for e in log_events if e.get('type') == 'activity')} activity events")
    return classified, collapsed, log_events, taxonomy, taxonomy_report


def _run_event_log_export(
    log_events: list[dict[str, Any]],
    collapsed: list[dict[str, Any]],
    cases: list[dict[str, Any]],
    worker_id: str,
    session_folder: Path,
) -> tuple[Any, Path, Path]:
    """Build the PM4Py event log and write events.xes / events.csv. Returns
    (log, xes_path, csv_path)."""
    log = build_event_log(log_events, cases, worker_id=worker_id)
    print(f"[normalize] event log: {len(log)} traces")

    xes_path = session_folder / "events.xes"
    csv_path = session_folder / "events.csv"
    try:
        export_xes(log, str(xes_path))
        print(f"[normalize] wrote {xes_path}")
    except Exception as e:
        print(f"[normalize] WARNING: XES export failed: {e}")
    export_csv(collapsed, cases, str(csv_path))
    print(f"[normalize] wrote {csv_path}")
    return log, xes_path, csv_path


def _visible_steps(existing_anno: dict) -> list[dict[str, Any]]:
    """RP-06: the steps the analyst has not hidden. A hidden step stays in
    annotations.json, so a re-analyze does not resurrect it, but it never
    feeds the stats, the analysis or the deliverable built from them."""
    return [s for s in (existing_anno.get("steps") or [])
            if s.get("state") != "hidden"]


# The analysis.json keys the step-grained analysis layer (analysis.run_analysis)
# writes. When the layer fails as a whole, each is written as null (C12).
_STEP_ANALYSIS_KEYS = ("waste_classification", "time_study", "segments",
                       "automation_candidates", "efficiency")

# The stages the findings detectors read. If one of them failed, the findings
# would silently miss checks, so the findings stage does not run (C12).
_FINDINGS_INPUT_STAGES = ("step_analysis", "motifs", "facts", "time_study",
                          "segments", "automation_candidates")


def _run_stats(
    session_folder: Path,
    log_events: list[dict[str, Any]],
    cases: list[dict[str, Any]],
    existing_anno: dict,
    taxonomy: dict,
    taxonomy_path: str | None,
    taxonomy_report: list,
    worker_id: str,
    raw: list[dict[str, Any]],
    dropped_lines: int,
    collapsed: list[dict[str, Any]],
    total_interactions: int,
    edits_applied: int,
    merged_steps: list[dict[str, Any]],
    coalesced: list[dict[str, Any]],
    vocab_summary: dict,
    draft_summary: dict | None = None,
) -> tuple[dict[str, Any], Path]:
    """Compute the statistics summary and write stats.json. Returns
    (summary, stats_path). `draft_summary` is the structure-only numbers of
    this analyze's drafts (step_suggest.draft_summary), counts only."""
    summary = stats.compute_all(
        log_events, cases,
        excluded_ranges=_excluded_ranges(existing_anno),
        steps=_visible_steps(existing_anno),
    )
    summary["screenshot_hashes"] = compute_screenshot_hashes(session_folder)
    summary["meta"] = {
        "normalization_run_at": datetime.now(timezone.utc).isoformat(),
        "taxonomy_version": (taxonomy or {}).get("version"),
        "taxonomy_path": str(taxonomy_path) if taxonomy_path else None,
        "taxonomy_report": taxonomy_report,
        "session_folder": str(session_folder),
        "worker_id": worker_id,
        "raw_event_count": len(raw),
        "dropped_jsonl_lines": dropped_lines,
        "collapsed_activity_count": sum(1 for e in collapsed if e.get("type") == "activity"),
        "interaction_count": total_interactions,
        "case_count": len(cases),
        "annotations_present": (session_folder / "annotations.json").exists(),
        "marker_edits_applied": edits_applied,
        "step_count": len(merged_steps),
        "step_state_breakdown": {
            "auto_suggested":    sum(1 for s in merged_steps if s.get("state") == "auto_suggested"),
            "manually_authored": sum(1 for s in merged_steps if s.get("state") == "manually_authored"),
            "edited":            sum(1 for s in merged_steps if s.get("state") == "edited"),
        },
        "draft_summary": draft_summary,
        "coalesced_event_count": len(coalesced),
        "app_vocabularies": vocab_summary.get("vocabs_loaded") or [],
        "app_vocabulary_matches": vocab_summary.get("matched", 0),
        "app_vocabulary_hits_by_id": vocab_summary.get("vocabs_hit") or {},
        "vocab_coverage": vocab_summary.get("coverage") or {},
    }

    stats_path = session_folder / "stats.json"
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"[normalize] wrote {stats_path}")
    return summary, stats_path


def _run_analysis(
    session_folder: Path,
    classified: list[dict[str, Any]],
    existing_anno: dict,
    summary: dict,
    manifest: dict,
    cases: Any = None,
) -> Any:
    """Analysis layer (ADR-0008 / IMPROVEMENTS.md Cluster N). Heuristic
    IE/CI findings -- waste classification, time study, automation
    candidates, the process-efficiency ratio -- written to
    analysis.json. Best-effort, never blocks the pipeline. Returns the
    analysis result (or None).

    Phase A (honesty redesign, LAB-PHASE-SPEC §A1-§A3) adds the Tier-1
    measured blocks -- `case_quality`, `facts`, `findings` -- as additive
    keys on the same file. Tier 1 needs no case boundaries and no steps,
    so analysis.json now writes for a stepless session too (the classic
    step-grained blocks stay empty there).

    Stage failures (contract C12, RP-10): a stage that fails leaves its
    output key null, never [] or zeros, and adds one
    {"stage", "error"} entry to `stage_errors`, which is always written
    (empty when every stage ran). Hidden steps are left out (RP-06)."""
    stage_errors: list[dict[str, str]] = []

    def _failed(stage: str, error: str) -> None:
        print(f"[normalize] WARNING: {stage} failed: {error}")
        stage_errors.append({"stage": stage, "error": error})

    steps = _visible_steps(existing_anno)
    analysis_result = None
    try:
        from analysis import run_analysis
        analysis_result = run_analysis(
            events=classified,
            steps=steps,
            stats=summary,
            manifest=manifest,
            annotations=existing_anno,
        )
    except Exception as e:  # noqa: BLE001 -- recorded as a stage error
        _failed("step_analysis", f"{type(e).__name__}: {e}")
    if analysis_result is None:
        # The classic layer failed entirely; still attempt the Tier-1
        # blocks on a minimal shell rather than losing the whole file.
        analysis_result = {"meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "session_id": (manifest or {}).get("session_id", ""),
            "step_count": len(steps),
            "provisional": True,
        }}
        analysis_result.update({key: None for key in _STEP_ANALYSIS_KEYS})
    # Sub-stage failures inside the classic layer (analysis.run_analysis).
    stage_errors.extend(analysis_result.pop("stage_errors", None) or [])

    try:
        from case_quality import compute_case_quality
        analysis_result["case_quality"] = compute_case_quality(classified, cases)
        cq = analysis_result["case_quality"]
        print(f"[normalize] case quality: {cq['mode']}, "
              f"coverage {cq['coverage']:.0%}, "
              f"tier2 {'unlocked' if cq['tier2_unlocked'] else 'locked'}")
    except Exception as e:  # noqa: BLE001 -- recorded as a stage error
        analysis_result["case_quality"] = None
        _failed("case_quality", f"{type(e).__name__}: {e}")
    motifs: list | None = None
    bounces: list | None = None
    try:
        from motifs import find_motifs, find_bounces, maximal_motifs
        # The maximal filter keeps the repeated-sequence count honest --
        # the raw sliding window counts every overlapping sub-window.
        motifs = maximal_motifs(find_motifs(steps))
        bounces = find_bounces(steps)
    except Exception as e:  # noqa: BLE001 -- recorded as a stage error
        motifs = bounces = None
        _failed("motifs", f"{type(e).__name__}: {e}")
    try:
        from facts import compute_facts
        facts = compute_facts(classified, motifs or [])
        if motifs is None:
            # The repeated-sequence count comes from motif mining, which failed.
            facts["repeated_sequence_count"] = None
        analysis_result["facts"] = facts
    except Exception as e:  # noqa: BLE001 -- recorded as a stage error
        analysis_result["facts"] = None
        _failed("facts", f"{type(e).__name__}: {e}")

    failed_inputs = [s for s in _FINDINGS_INPUT_STAGES
                     if any(err["stage"] == s for err in stage_errors)]
    if failed_inputs:
        analysis_result["findings"] = None
        _failed("findings", "not run: depends on failed stage(s) "
                + ", ".join(failed_inputs))
    else:
        try:
            from findings import detect_findings
            detector_errors: list[str] = []
            found = detect_findings(
                classified, steps,
                analysis_result.get("facts"),
                case_quality=analysis_result.get("case_quality"),
                analysis_blocks=analysis_result,
                bounces=bounces,
                errors=detector_errors)
            if detector_errors:
                # A detector that could not run makes the list incomplete; an
                # incomplete list must not read as "nothing else stood out".
                analysis_result["findings"] = None
                _failed("findings", "; ".join(detector_errors))
            else:
                analysis_result["findings"] = found
                if found:
                    # ASCII-only: the bundled embeddable's console codepage
                    # mangles non-ASCII in print output (it lands in
                    # normalize.log too).
                    print(f"[normalize] {len(found)} finding(s) detected (lab-phase A3)")
        except Exception as e:  # noqa: BLE001 -- recorded as a stage error
            analysis_result["findings"] = None
            _failed("findings", f"{type(e).__name__}: {e}")
    analysis_result["stage_errors"] = stage_errors

    try:
        analysis_path = session_folder / "analysis.json"
        with open(analysis_path, "w", encoding="utf-8") as f:
            json.dump(analysis_result, f, indent=2)
        print(f"[normalize] wrote {analysis_path}")
    except Exception as e:
        print(f"[normalize] WARNING: analysis write failed: {e}")
    return analysis_result


def _run_mining_exports(
    session_folder: Path,
    log: Any,
    existing_anno: dict,
    mine: bool,
    summary: dict,
    manifest: dict,
    analysis_result: Any,
    pdd_out: str | None,
    pdd_map_image: str | None,
    pdd_tobe_image: str | None = None,
) -> None:
    """Mining (DFG / aggregate BPMN / observed-flow BPMN / per-case BPMN) plus
    the requested PDD export. Each mining output keeps its own best-effort
    try/except. A requested PDD export that fails raises ExportFailed (C13
    exit code 3); it runs last, so every analysis output is already written."""
    if mine:
        import mining as mining_mod
        from pm4py.objects.log.obj import EventLog
        # DFG first - pure data, no Graphviz needed. Always emit if possible.
        try:
            dfg, starts, ends = mining_mod.discover_dfg(log)
            dfg_path = session_folder / "dfg.json"
            with open(dfg_path, "w", encoding="utf-8") as f:
                json.dump(mining_mod.dfg_to_dict(dfg, starts, ends), f, indent=2)
            print(f"[normalize] wrote {dfg_path}")
        except Exception as e:
            print(f"[normalize] WARNING: DFG mining failed: {e}")
        # Aggregate BPMN: one model fitting ALL traces together. Right
        # answer when every case in the session is an instance of the
        # same underlying process.
        try:
            bpmn = mining_mod.discover_inductive(log, noise_threshold=0.2)
            bpmn_path = session_folder / "process_map.bpmn"
            mining_mod.export_bpmn(bpmn, str(bpmn_path))
            print(f"[normalize] wrote {bpmn_path}")
        except Exception as e:
            print(f"[normalize] WARNING: BPMN mining failed: {e}")
        # Step observed-flow BPMN: the ACTUAL annotated step flow mined into
        # BPMN (the Process-diagram counterpart of the step Flow diagram).
        # Built from annotations -- no Process Template needed.
        try:
            import bpmn_observed
            if any(s.get("state") != "hidden"
                   for s in (existing_anno.get("steps") or [])):
                if bpmn_observed.write_observed_bpmn(
                        existing_anno,
                        str(session_folder / "process_map_step.bpmn")):
                    print(f"[normalize] wrote {session_folder / 'process_map_step.bpmn'}")
        except Exception as e:
            print(f"[normalize] WARNING: step BPMN failed: {e}")
        # Per-case BPMN: one model per individual case. Right answer
        # when the session contains MIXED processes (the aggregate would
        # mash them into one nonsense model), or for instance-to-instance
        # comparison. Output dir: process_maps/<case_id>.bpmn next to
        # the session folder so the analyst can see all of them at a
        # glance without cluttering the top level.
        if len(log) > 1:
            per_case_dir = session_folder / "process_maps"
            per_case_dir.mkdir(exist_ok=True)
            wrote = 0
            for trace in log:
                case_id = (trace.attributes.get("case:id")
                           or trace.attributes.get("concept:name")
                           or f"case_{wrote}")
                safe = re.sub(r"[^A-Za-z0-9._-]", "_", str(case_id))[:80]
                if len(trace) < 2:
                    # PM4Py's inductive miner needs at least 2 events to
                    # produce a meaningful model; single-event traces
                    # collapse to a degenerate task.
                    continue
                try:
                    sub_log = EventLog([trace])
                    case_bpmn = mining_mod.discover_inductive(sub_log, noise_threshold=0.2)
                    case_path = per_case_dir / f"{safe}.bpmn"
                    mining_mod.export_bpmn(case_bpmn, str(case_path))
                    wrote += 1
                except Exception as e:
                    print(f"[normalize] WARNING: per-case BPMN failed for {case_id}: {e}")
            if wrote:
                print(f"[normalize] wrote {wrote} per-case BPMNs to {per_case_dir}")

    # The requested PDD export (RP-09): a failure is never a warning, because
    # the viewer trusts the exit code and would otherwise open the previous PDD.
    if pdd_out:
        try:
            from pdd_export import write_pdd
            write_pdd(
                Path(pdd_out),
                session_folder=session_folder,
                annotations=existing_anno,
                stats=summary,
                manifest=manifest,
                analysis=analysis_result,
                process_map_image=pdd_map_image,
                tobe_map_image=pdd_tobe_image,
            )
        except Exception as e:  # noqa: BLE001 -- any failure fails the export
            # The traceback goes to normalize.log only (INFO is below the
            # stderr handler's level), so stderr keeps its one ERROR line.
            logger.info("PDD export traceback", exc_info=True)
            raise ExportFailed(
                f"PDD export to {pdd_out} failed: {type(e).__name__}: {e}. "
                "The analysis outputs were written; the PDD was not.") from e
        print(f"[normalize] wrote PDD: {pdd_out}")
