"""The normalization pipeline's named stage helpers.

Extracted from normalize.py (god-file decomposition; completes the F4 split).
Each `_run_*` helper is the verbatim body of one stage of the former
normalize() god-function -- a pure structural extraction (zero behavior
change). Shared state (events, annotations/existing_anno, the `cal` calibration
dict, session_id, flags) is threaded explicitly rather than via a closure, and
each stage keeps its original best-effort try/except exactly where it was.

normalize.py imports every `_run_*` / `_init_existing_anno` name below and calls
them from its (now thin) orchestrator, so `normalize.X` resolves unchanged.
The heavier optional deps (analysis, bpmn_observed, which imports mining and
pm4py, and pdd_export) stay as function-local imports, so they are only paid
for when that stage/export actually runs.
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Python embeddable distributions do not auto-add the script's directory to
# sys.path; mirror normalize.py so sibling imports resolve under the bundled
# embeddable too.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from case_assignment import (
    assign_case_ids, collect_cases, needs_implicit_run, add_implicit_run,
)
from coalesce import coalesce_typing_bursts
from recorder_noise import clean_recorder_noise, leave_out_not_the_users
from classification import (
    classify_events,
    collapse_adjacent,
    load_taxonomy,
)
from classification_overrides import apply_classification_overrides
from step_suggest import (
    auto_suggest_steps, _merge_steps, restamp_preserved_case_ids,
    draft_summary, session_names,
)
import app_vocab
from app_names import build_app_names
import stats_compute as stats
from session_io import write_annotations, compute_screenshot_hashes, has_recording, Staging
from marker_edits import apply_marker_edits
from pipeline_config import (
    _step_ignored_processes, _excluded_ranges, _step_calibration_kwargs,
)
from step_context import step_duration_ms

logger = logging.getLogger(__name__)


class ExportFailed(Exception):
    """A requested export failed; the run commits nothing, so the project
    stays as it was. Contract C13 exit code 3 (RP-09)."""


def _session_start(manifest: dict | None, events: list[dict[str, Any]]) -> str | None:
    """Where the implicit run of a session without a recording starts (C16):
    manifest.started_at, else the first event's timestamp, else None."""
    started = manifest.get("started_at") if isinstance(manifest, dict) else None
    if isinstance(started, str) and started.strip():
        return started
    first = next((ev.get("timestamp") for ev in events or [] if ev.get("timestamp")), None)
    return first if isinstance(first, str) else None


def _run_coalesce(
    raw: list[dict[str, Any]],
    annotations: dict[str, Any],
    cal: dict,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int, dict[str, Any]]:
    """Stage 1a: coalesce typing bursts, leave out what the recorder saw
    that the user did not do (recorder_noise: an empty field, a dropdown's
    echo, the Office ribbon's, a screen rendering, and the window a click
    lost filled in), then apply annotation marker edits. Returns (coalesced,
    edited, edits_applied, noise report)."""
    # What the recorder marked as a program's own change goes first, so the
    # coalescing never folds the user's value into the program's.
    users, marked = leave_out_not_the_users(raw)
    coalesced = coalesce_typing_bursts(users, idle_ms=cal["coalesce_idle_ms"])
    if len(coalesced) < len(users):
        print(f"[normalize] coalesced: {len(users)} -> {len(coalesced)} events")
    cleaned, noise = clean_recorder_noise(coalesced, not_the_users_count=marked)
    if noise["dropped_total"] or noise["filled"]:
        print(f"[normalize] recorder noise: left out {noise['dropped_total']} "
              f"interaction(s) the user did not make {noise['dropped']}, "
              f"filled the window of {noise['filled']}")

    edited, edits_applied = apply_marker_edits(cleaned, annotations)
    if edits_applied:
        print(f"[normalize] applied {edits_applied} annotation edit(s) from annotations.json")
    return coalesced, edited, edits_applied, noise


def _run_case_assignment(
    edited: list[dict[str, Any]],
    session_id_str: str,
    manifest: dict | None = None,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict]:
    """Stage 2a/3: marker-based case assignment + app-vocab enrichment.
    Returns (with_cases, cases, vocab_summary). `session_id_str` seeds the
    deterministic case ids (RP-01). A session without a recording (the
    `manifest` says video or blank) and without a start marker gets one
    implicit run covering the whole session (contract C16)."""
    with_cases = assign_case_ids(edited, session_id=session_id_str)
    cases = collect_cases(with_cases)
    if needs_implicit_run(with_cases, has_recording(manifest)):
        with_cases, cases = add_implicit_run(
            with_cases, cases, session_id_str, _session_start(manifest, with_cases))
        print("[normalize] no start marker in a session without a recording: "
              "one implicit run covers the session")
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
    # DA gap 3: the readable name of every recorded executable, for the
    # PDD, the capture detail and the step map (stats.json meta.app_names).
    vocab_summary["app_names"] = build_app_names(with_cases, vocabs)
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
    recorded: bool = True,
    staging: Staging | None = None,
    library: Any = None,
) -> tuple[list[dict[str, Any]], int, dict[str, Any]]:
    """Step drafting (the C1 rule), then persist annotations. Returns
    (merged_steps, total_interactions, draft_summary). A draft takes the name
    the analyst gave to a step with its draft_key in this session (C4), and
    a run of drafts an activity of the project's `library` (library.Library,
    contract C21) lists becomes one draft named from it (_merge_steps).
    `recorded` is False for a session without a recording (C16): its steps
    without a time whose transaction is gone join the first transaction.
    With a `staging`, annotations.json is staged and committed with the run
    (session_io.Staging)."""
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
        session_names=session_names(existing_anno),
        **_step_calibration_kwargs(cal),
    )
    # Counted on the fresh drafts, before the merge (see draft_summary).
    summary = draft_summary(auto_steps, cases, interactions_by_id)
    merged_steps = _merge_steps(existing_anno.get("steps") or [], auto_steps,
                                interactions_by_id, library=library)
    # RP-01 / C9: a preserved analyst step keeps its case_id only while that
    # run still exists; otherwise it moves to the run containing it in time.
    restamped = restamp_preserved_case_ids(merged_steps, cases, recorded=recorded)
    if restamped:
        print(f"[normalize] moved {restamped} analyst step(s) to the run "
              f"that holds them (their previous run id no longer exists)")
    existing_anno["steps"] = merged_steps
    write_annotations(session_folder, existing_anno, staging)
    print(f"[normalize] drafted {len(auto_steps)} step(s) "
          f"({len(merged_steps)} total after merge)")
    return merged_steps, total_interactions, summary


def _run_classification(
    with_cases: list[dict[str, Any]],
    annotations: dict,
    taxonomy_path: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict, list]:
    """Taxonomy classification + analyst overrides + the per-window collapse.
    Returns (classified, collapsed, taxonomy, taxonomy_report). The
    statistics merge the classified rows into activity occurrences
    themselves, once the stretches left out of the analysis are cut out of
    them (stats_compute.compute_all)."""
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
    # `collapsed` keeps the per-window rows (the collapsed_activity_count in
    # stats.json meta). See design §7.1.
    collapsed = collapse_adjacent(classified)
    print(f"[normalize] collapsed: {sum(1 for e in classified if e.get('type') == 'activity')} -> "
          f"{sum(1 for e in collapsed if e.get('type') == 'activity')} activity events")
    return classified, collapsed, taxonomy, taxonomy_report


def _visible_steps(existing_anno: dict) -> list[dict[str, Any]]:
    """RP-06: the steps the analyst has not hidden. A hidden step stays in
    annotations.json, so a re-analyze does not resurrect it, but it never
    feeds the stats, the analysis or the deliverable built from them."""
    return [s for s in (existing_anno.get("steps") or [])
            if s.get("state") != "hidden"]


# The format number analysis.json carries: raised when the layout of the
# analysis outputs changes, so the viewer knows an older analysis for what it
# is (viewer/normalize-result.js ANALYSIS_FORMAT reads the same number).
# 3: `pdd_data` and `pdd_time`, the rows of the PDD's sections 5 and 6 the
# Overview shows (lane CC). 4: the analysis layer nobody read is cut (the
# facts, the findings, the step analysis, `pdd_findings`), and the one check
# the Overview shows, the apps the recorder saw with less detail, is its own
# key, `coverage_caveat` (lane FX1). 5: the rows of the PDD's sections 5 and
# 6 are the document's alone (the Overview no longer shows them, the owner,
# 2026-09-26): `pdd_data`, `pdd_time` and `steps_signature` are cut.
ANALYSIS_FORMAT = 5


def _run_stats(
    session_folder: Path,
    classified: list[dict[str, Any]],
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
    recorded: bool = True,
    staging: Staging | None = None,
    recorder_noise: dict | None = None,
) -> tuple[dict[str, Any], Path]:
    """Compute the statistics summary and write stats.json. Returns
    (summary, stats_path). `classified` is the classified event stream as
    recorded, one activity row per foreground stretch: the statistics cut the
    stretches left out of the analysis out of its rows before they merge
    them (stats_compute.compute_all). `draft_summary` is the structure-only
    numbers of this analyze's drafts (step_suggest.draft_summary), counts
    only. `recorder_noise` is what stage 1a left out and filled in
    (recorder_noise.clean_recorder_noise's report), counts only. `recorded`
    is False for a session without a recording (C16). With a `staging`,
    stats.json is staged and committed with the run."""
    summary = stats.compute_all(
        classified, cases,
        excluded_ranges=_excluded_ranges(existing_anno),
        steps=_visible_steps(existing_anno),
        recorded=recorded,
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
        "annotations_present": ((session_folder / "annotations.json").exists()
                                or (staging is not None and "annotations.json" in staging.names())),
        "marker_edits_applied": edits_applied,
        "step_count": len(merged_steps),
        "step_state_breakdown": {
            "auto_suggested":    sum(1 for s in merged_steps if s.get("state") == "auto_suggested"),
            "manually_authored": sum(1 for s in merged_steps if s.get("state") == "manually_authored"),
            "edited":            sum(1 for s in merged_steps if s.get("state") == "edited"),
            "confirmed":         sum(1 for s in merged_steps if s.get("state") == "confirmed"),
            "hidden":            sum(1 for s in merged_steps if s.get("state") == "hidden"),
        },
        "draft_summary": draft_summary,
        "recorder_noise": recorder_noise,
        "coalesced_event_count": len(coalesced),
        "app_vocabularies": vocab_summary.get("vocabs_loaded") or [],
        "app_vocabulary_matches": vocab_summary.get("matched", 0),
        "app_vocabulary_hits_by_id": vocab_summary.get("vocabs_hit") or {},
        "vocab_coverage": vocab_summary.get("coverage") or {},
        "app_names": vocab_summary.get("app_names") or {},
    }

    stats_path = session_folder / "stats.json"
    if staging is not None:
        staging.write_json("stats.json", summary)
        print(f"[normalize] staged {stats_path}")
    else:
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
    recorded: bool = True,
    staging: Staging | None = None,
    library_version: str | None = None,
) -> Any:
    """analysis.json: what the viewer and the PDD read of the analysis.

      case_quality     the transaction check (case_quality.py): how the
                       transactions were found, how many, the share of the
                       recorded actions inside them. The Map and the
                       Checklist read it.
      coverage_caveat  the apps the recorder saw with less detail
                       (capture_detail.py), or null; the Overview's project
                       line warns with its claim.
      library_version  the version of the project's activity library the
                       drafts were named from (contract C21), or null when
                       the analysis used no library.
      meta, stage_errors, format.

    The analysis layer of the product edition (the facts, the findings, the
    waste, time study, segments, automation and efficiency blocks, and the
    PDD's findings selection) is cut: nothing read it (lane FX1).

    Stage failures (contract C12, RP-10): a stage that fails leaves its
    output key null, never [] or zeros, and adds one {"stage", "error"} entry
    to `stage_errors`, which is always written (empty when every stage ran).
    Hidden steps are left out (RP-06). The stretches the analyst left out of
    the analysis (excluded_ranges) are left out of the transaction check and
    of the capture detail, as they are of the drafting and the statistics.
    A session without a recording (`recorded` False: a video or blank
    session, C16) has nothing recorded: `case_quality` still counts its
    transactions, with coverage null, and `coverage_caveat` is null. With a
    `staging`, analysis.json is staged and committed with the run."""
    stage_errors: list[dict[str, str]] = []

    def _failed(stage: str, error: str) -> None:
        print(f"[normalize] WARNING: {stage} failed: {error}")
        stage_errors.append({"stage": stage, "error": error})

    classified = stats._filter_excluded(classified, _excluded_ranges(existing_anno))

    steps = _visible_steps(existing_anno)
    analysis_result: dict[str, Any] = {"meta": {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "session_id": (manifest or {}).get("session_id", ""),
        "step_count": len(steps),
    }, "library_version": library_version}
    try:
        from case_quality import compute_case_quality
        analysis_result["case_quality"] = compute_case_quality(
            classified, cases, recorded=recorded)
        cq = analysis_result["case_quality"]
        coverage = ("none (nothing recorded)" if cq["coverage"] is None
                    else f"{cq['coverage']:.0%}")
        print(f"[normalize] case quality: {cq['mode']}, "
              f"coverage {coverage}, "
              f"tier2 {'unlocked' if cq['tier2_unlocked'] else 'locked'}")
    except Exception as e:  # noqa: BLE001 -- recorded as a stage error
        analysis_result["case_quality"] = None
        _failed("case_quality", f"{type(e).__name__}: {e}")
    try:
        from capture_detail import coverage_caveat
        analysis_result["coverage_caveat"] = coverage_caveat(
            classified, ((summary or {}).get("meta") or {}).get("app_names"))
    except Exception as e:  # noqa: BLE001 (recorded as a stage error)
        analysis_result["coverage_caveat"] = None
        _failed("coverage_caveat", f"{type(e).__name__}: {e}")
    return _write_analysis(session_folder, analysis_result, stage_errors, staging)


def _write_analysis(session_folder: Path, analysis_result: dict,
                    stage_errors: list[dict[str, str]],
                    staging: Staging | None = None) -> dict:
    """Write analysis.json with its stage_errors and the format number the
    viewer checks (normalize-result.js analysisNeed analyzes a recording again
    when it finds an older layout); returns the result. With a `staging`, the
    file is staged and committed with the run."""
    analysis_result["stage_errors"] = stage_errors
    analysis_result["format"] = ANALYSIS_FORMAT
    try:
        analysis_path = session_folder / "analysis.json"
        if staging is not None:
            staging.write_json("analysis.json", analysis_result)
            print(f"[normalize] staged {analysis_path}")
        else:
            with open(analysis_path, "w", encoding="utf-8") as f:
                json.dump(analysis_result, f, indent=2)
            print(f"[normalize] wrote {analysis_path}")
    except Exception as e:
        print(f"[normalize] WARNING: analysis write failed: {e}")
    return analysis_result


def _run_mining_exports(
    session_folder: Path,
    existing_anno: dict,
    mine: bool,
    summary: dict,
    manifest: dict,
    analysis_result: Any,
    pdd_out: str | None,
    pdd_map_image: str | None,
    pdd_tobe_image: str | None = None,
    events: list[dict[str, Any]] | None = None,
    pdd_map_images: str | None = None,
    staging: Staging | None = None,
    tech_out: str | None = None,
    handoff: int | None = None,
    library: Any = None,
) -> None:
    """The step-level observed-flow BPMN (when `mine` is set) plus the
    requested PDD and Technical details exports. The BPMN keeps its
    best-effort try/except. A requested export that fails raises
    ExportFailed (C13 exit code 3): the run then commits nothing, so the
    project stays as it was. `events` is the derived event stream the PDD
    and the workbook read the entered fields from. `pdd_map_images` is the
    manifest of the maps' pictures (contract C19). `tech_out` is the
    Technical details workbook's path and `handoff` the hand-off version both
    documents are made for (contract C20; None: a working copy). `library`
    is the activity library the run uses (contract C21, library.Library):
    its application order is the step map's colour order, and the PDD and
    the workbook print its activities' codes and descriptions. With a
    `staging`, the step BPMN is staged and committed with the run."""
    map_written = False
    if mine:
        # Step observed-flow BPMN: the ACTUAL annotated step flow mined into
        # BPMN (the Process-diagram counterpart of the step Flow diagram).
        # Built from annotations -- no Process Template needed.
        try:
            import bpmn_observed
            from step_context import StepContext
            if any(s.get("state") != "hidden"
                   for s in (existing_anno.get("steps") or [])):
                # The system and screen each task's documentation names.
                context = StepContext(
                    {e["event_id"]: e["data"] for e in events or []
                     if e.get("type") == "interaction" and e.get("event_id")
                     and isinstance(e.get("data"), dict)},
                    ((summary or {}).get("meta") or {}).get("app_names"))
                # The implicit run of a session without a recording (C16).
                rows = [r for r in (summary or {}).get("case_stats") or [] if isinstance(r, dict)]
                implicit = [r.get("case_id") for r in rows if r.get("implicit")]
                # C17: the transactions in the viewer's order (start, then
                # case id), the order the labels of one flow are joined in.
                run_order = [r.get("case_id") for r in sorted(
                    (r for r in rows if r.get("case_id") and not r.get("parent_case_id")),
                    key=lambda r: (str(r.get("start_ts") or ""), str(r.get("case_id"))))]
                # Each transaction's span, where the stretches left out of
                # the analysis cut its trace (step_flow.left_out_stretches).
                run_spans = {r.get("case_id"): (r.get("start_ts"), r.get("end_ts"))
                             for r in rows if r.get("case_id")}
                final = session_folder / "process_map_step.bpmn"
                out = staging.path(final.name) if staging is not None else final
                if bpmn_observed.write_observed_bpmn(
                        existing_anno, str(out),
                        context=context, implicit_runs=implicit, run_order=run_order,
                        run_spans=run_spans,
                        app_order=getattr(library, "applications", None)):
                    map_written = True
                    print(f"[normalize] {'staged' if staging is not None else 'wrote'} {final}")
        except Exception as e:
            print(f"[normalize] WARNING: step BPMN failed: {e}")

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
                events=events,
                map_images=pdd_map_images,
                map_file=map_written or None,
                handoff=handoff,
                library=library,
            )
        except Exception as e:  # noqa: BLE001 -- any failure fails the export
            # The traceback goes to normalize.log only (INFO is below the
            # stderr handler's level), so stderr keeps its one ERROR line.
            logger.info("PDD export traceback", exc_info=True)
            raise ExportFailed(
                f"PDD export to {pdd_out} failed: {type(e).__name__}: {e}. "
                "Nothing in the project was changed.") from e
        print(f"[normalize] wrote PDD: {pdd_out}")

    # C20: the Technical details workbook, a requested export like the PDD.
    if tech_out:
        try:
            from tech_details import write_tech_details
            write_tech_details(
                Path(tech_out),
                session_folder=session_folder,
                annotations=existing_anno,
                stats=summary,
                manifest=manifest,
                events=events,
                handoff=handoff,
                library=library,
            )
        except Exception as e:  # noqa: BLE001 (any failure fails the export)
            logger.info("Technical details export traceback", exc_info=True)
            raise ExportFailed(
                f"Technical details export to {tech_out} failed: {type(e).__name__}: {e}. "
                "Nothing in the project was changed.") from e
        print(f"[normalize] wrote Technical details: {tech_out}")
