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

from case_assignment import assign_case_ids, collect_cases
from classification import (
    classify_events,
    collapse_adjacent,
    collapse_activity_occurrences,
    load_taxonomy,
)
from classification_overrides import apply_classification_overrides
from log_setup import setup_logging
from xes_export import build_event_log, export_xes, export_csv
from step_suggest import auto_suggest_steps, drop_overlapping_auto_steps
import app_vocab
import stats_compute as stats


def load_events(events_file: Path) -> tuple[list[dict[str, Any]], int]:
    events = []
    dropped = 0
    with open(events_file, encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError as exc:
                dropped += 1
                snippet = line[:120] + ("..." if len(line) > 120 else "")
                logger.warning(
                    "load_events: dropping malformed line %d in %s: %s | %s",
                    line_no, events_file, exc, snippet,
                )
    events.sort(key=lambda e: e.get("timestamp", ""))
    return events, dropped


def load_manifest(session_folder: Path) -> dict[str, Any]:
    manifest_file = session_folder / "manifest.json"
    if not manifest_file.exists():
        return {}
    with open(manifest_file, encoding="utf-8") as f:
        return json.load(f)


def load_annotations(session_folder: Path) -> dict[str, Any]:
    annotations_file = session_folder / "annotations.json"
    if not annotations_file.exists():
        return {}
    try:
        with open(annotations_file, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def write_annotations(session_folder: Path, anno: dict) -> None:
    anno["last_modified"] = datetime.now(timezone.utc).isoformat()
    with open(session_folder / "annotations.json", "w", encoding="utf-8") as f:
        json.dump(anno, f, indent=2)


def _step_ignored_processes(annotations: dict) -> list[str]:
    """Pull the per-session step denylist from annotations.json. Shape:
    {"step_filters": {"ignored_processes": ["obs64.exe", "OBS"]}}.
    Returns [] when absent so step suggestion behaves as before."""
    sf = (annotations or {}).get("step_filters") or {}
    procs = sf.get("ignored_processes") or []
    return [str(p) for p in procs if str(p).strip()]


def _merge_steps(existing: list, fresh: list) -> list:
    """Preserve manually_authored, edited, and hidden steps. Replace
    auto_* steps with the latest fresh suggestions. A `hidden` step is
    one the analyst manually suppressed -- preserving it means a
    re-analyze won't resurrect it as a fresh auto_suggested row.

    Fresh auto steps that overlap an analyst-owned (manual / edited /
    hidden) step are dropped: the analyst already owns that span, and an
    overlapping auto step is a duplicate they would otherwise have to
    find and delete by hand (§I37)."""
    by_state = {"manually_authored": [], "edited": [], "hidden": []}
    for s in existing or []:
        st = s.get("state")
        if st in by_state:
            by_state[st].append(s)
    preserved = (by_state["manually_authored"] + by_state["edited"]
                 + by_state["hidden"])
    kept, dropped = drop_overlapping_auto_steps(fresh or [], preserved)
    if dropped:
        print(f"[normalize] dropped {len(dropped)} auto step(s) "
              f"overlapping analyst-owned steps")
    return preserved + kept


def _merge_phases(existing: list, fresh: list) -> list:
    """Preserve manually_authored and edited phases. Same semantics as
    _merge_steps."""
    by_state = {"manually_authored": [], "edited": []}
    for p in existing or []:
        st = p.get("state")
        if st in by_state:
            by_state[st].append(p)
    return by_state["manually_authored"] + by_state["edited"] + (fresh or [])


def _compute_drift_markers(existing: list, fresh: list) -> list[dict]:
    """Compare existing (edited / manually_authored) steps against the
    fresh canonical match. Whenever an existing step that already had a
    canonical_step_id now lives inside a session whose canonical
    assignment for the same time-range names a different step, record a
    drift marker.
    """
    import uuid as _uuid
    drift = []
    fresh_by_event = {}
    for fs in fresh or []:
        for evid in (fs.get("evidence", {}).get("interaction_event_ids") or []):
            fresh_by_event[evid] = fs.get("canonical_step_id")
    for s in existing or []:
        if s.get("state") not in ("manually_authored", "edited"):
            continue
        prev_cid = s.get("canonical_step_id")
        if not prev_cid:
            continue
        new_cid = None
        for evid in (s.get("evidence", {}).get("interaction_event_ids") or []):
            if evid in fresh_by_event:
                new_cid = fresh_by_event[evid]
                break
        if new_cid is not None and new_cid != prev_cid:
            drift.append({
                "marker_id": str(_uuid.uuid4()),
                "kind": "canonical_drift",
                "step_id": s.get("step_id"),
                "previous_canonical_step_id": prev_cid,
                "new_canonical_step_id": new_cid,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
    return drift


def apply_marker_edits(
    events: list[dict[str, Any]],
    annotations: dict[str, Any],
) -> tuple[list[dict[str, Any]], int]:
    """§9.3 option b: apply annotation overrides during normalization.

    Supported edit shapes (last-write-wins per event_id+field/op):
      { event_id, field: "label", value }       - rename
      { event_id, field: "timestamp", value }   - adjust marker timestamp
      { event_id, op: "delete" }                - drop the marker entirely
      { op: "insert", marker_type, label,
        timestamp, id }                          - insert synthetic marker

    Insert edits create a derived marker with event_id "insert-<id>" so
    downstream consumers can distinguish synthetic from captured markers.

    Returns (edited_events, applied_count). Raw events.jsonl never
    modified; this builds a derived stream that downstream stages walk.
    """
    edits = (annotations or {}).get("marker_edits") or []
    if not edits:
        return events, 0
    label_over: dict[str, Any] = {}
    ts_over: dict[str, Any] = {}
    deleted: set[str] = set()
    inserts: list[dict[str, Any]] = []
    session_id_hint = next((e.get("session_id") for e in events if e.get("session_id")), None)
    for e in edits:
        if e.get("op") == "insert":
            ts = e.get("timestamp")
            if not ts:
                continue
            edit_id = e.get("id") or str(_uuid.uuid4())
            inserts.append({
                "event_id": f"insert-{edit_id}",
                "type": "marker",
                "timestamp": ts,
                "session_id": session_id_hint or "",
                "data": {
                    "marker_type": e.get("marker_type", "start"),
                    "label": e.get("label"),
                    "synthetic": True,
                    "edit_id": edit_id,
                },
            })
            continue
        evid = e.get("event_id")
        if not evid:
            continue
        if e.get("op") == "delete":
            deleted.add(evid)
            continue
        field = e.get("field")
        if field == "label":
            label_over[evid] = e.get("value")
        elif field == "timestamp":
            ts_over[evid] = e.get("value")
    applied = 0
    out: list[dict[str, Any]] = []
    for ev in events:
        if ev.get("type") != "marker":
            out.append(ev)
            continue
        evid = ev.get("event_id")
        if evid in deleted:
            applied += 1
            continue
        new_label = label_over.get(evid)
        new_ts = ts_over.get(evid)
        if new_label is None and new_ts is None:
            out.append(ev)
            continue
        new_ev = dict(ev)
        new_data = dict(ev["data"])
        if new_label is not None:
            new_data["label"] = new_label
        new_ev["data"] = new_data
        if new_ts is not None:
            new_ev["timestamp"] = new_ts
        out.append(new_ev)
        applied += 1
    if inserts:
        out.extend(inserts)
        applied += len(inserts)
    # If we changed any timestamps OR inserted markers, sort again so downstream sees order
    if ts_over or inserts:
        out.sort(key=lambda e: e.get("timestamp", ""))
    return out, applied


def normalize(
    session_folder: Path,
    taxonomy_path: str | None = None,
    mine: bool = False,
    canonical_path: str | None = None,
    pdd_out: str | None = None,
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
    edited, edits_applied = apply_marker_edits(raw, annotations)
    if edits_applied:
        print(f"[normalize] applied {edits_applied} annotation edit(s) from annotations.json")

    with_cases = assign_case_ids(edited)
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
        vocab_summary = {"matched": 0, "total": 0, "vocabs_loaded": [], "vocabs_hit": {}}

    # Step matching / suggestion (Phase B + C)
    session_id_str = manifest.get("session_id", "")
    existing_anno = dict(annotations) if isinstance(annotations, dict) else {}
    existing_anno.setdefault("phases", [])
    existing_anno.setdefault("annotations", [])
    existing_anno.setdefault("notes", existing_anno.get("notes") or [])
    existing_anno.setdefault("marker_edits", existing_anno.get("marker_edits") or [])
    existing_anno.setdefault("drift_markers", existing_anno.get("drift_markers") or [])
    existing_anno["version"] = 1
    existing_anno["session_id"] = session_id_str

    canonical = None
    matched_interactions = 0
    total_interactions = sum(1 for e in with_cases if e.get("type") == "interaction")
    if canonical_path:
        from canonical_match import load_canonical, match_canonical, rollup_phases
        canonical = load_canonical(canonical_path)
        existing_anno["matched_against"] = {
            "canonical_process_id": canonical.get("id"),
            "canonical_version": canonical.get("version"),
        }
        matched_steps, unmatched = match_canonical(
            with_cases, canonical, session_id=session_id_str
        )
        matched_interactions = total_interactions - len(unmatched)
        if unmatched:
            fallback = auto_suggest_steps(
                unmatched, session_id=session_id_str,
                ignored_processes=_step_ignored_processes(existing_anno),
            )
            fresh_steps = matched_steps + fallback
        else:
            fresh_steps = matched_steps
        # Drift detection
        new_drift = _compute_drift_markers(existing_anno.get("steps") or [], matched_steps)
        if new_drift:
            existing_anno["drift_markers"] = (existing_anno.get("drift_markers") or []) + new_drift
            print(f"[normalize] {len(new_drift)} drift marker(s) recorded")
        merged_steps = _merge_steps(existing_anno.get("steps") or [], fresh_steps)
        existing_anno["steps"] = merged_steps
        # Phase rollup (Phase D)
        auto_phases = rollup_phases(canonical, [s for s in merged_steps if s.get("state") == "auto_matched"],
                                    session_id=session_id_str)
        existing_anno["phases"] = _merge_phases(existing_anno.get("phases") or [], auto_phases)
        # Stamp phase_id on contained steps
        step_by_id = {s["step_id"]: s for s in existing_anno["steps"]}
        for ph in existing_anno["phases"]:
            for sid in ph.get("step_ids", []):
                if sid in step_by_id:
                    step_by_id[sid]["phase_id"] = ph["phase_id"]
        write_annotations(session_folder, existing_anno)
        print(f"[normalize] canonical match: {len(matched_steps)} steps "
              f"({matched_interactions}/{total_interactions} interactions matched)")
    else:
        auto_steps = auto_suggest_steps(
            with_cases, session_id=session_id_str,
            ignored_processes=_step_ignored_processes(existing_anno),
        )
        merged_steps = _merge_steps(existing_anno.get("steps") or [], auto_steps)
        existing_anno["steps"] = merged_steps
        existing_anno.setdefault("matched_against", None)
        write_annotations(session_folder, existing_anno)
        print(f"[normalize] auto-suggested {len(auto_steps)} step(s) "
              f"({len(merged_steps)} total after merge)")

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

    # C5/§I38: capture the prior run's canonical match rate before we
    # overwrite stats.json, so a sharp drop can be flagged as drift.
    prev_match_rate = None
    _prior_stats = session_folder / "stats.json"
    if _prior_stats.exists():
        try:
            with open(_prior_stats, encoding="utf-8") as f:
                prev_match_rate = (json.load(f).get("meta") or {}).get("match_rate")
        except (OSError, json.JSONDecodeError, ValueError):
            prev_match_rate = None

    summary = stats.compute_all(log_events, cases)
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
        "matched_interactions": matched_interactions,
        "match_rate": (matched_interactions / total_interactions) if total_interactions else 0,
        "case_count": len(cases),
        "annotations_present": (session_folder / "annotations.json").exists(),
        "marker_edits_applied": edits_applied,
        "step_count": len(merged_steps),
        "step_state_breakdown": {
            "auto_suggested":    sum(1 for s in merged_steps if s.get("state") == "auto_suggested"),
            "auto_matched":      sum(1 for s in merged_steps if s.get("state") == "auto_matched"),
            "manually_authored": sum(1 for s in merged_steps if s.get("state") == "manually_authored"),
            "edited":            sum(1 for s in merged_steps if s.get("state") == "edited"),
        },
        "canonical_process_id": (canonical.get("id") if canonical else None),
        "canonical_version": (canonical.get("version") if canonical else None),
        "drift_count": len(existing_anno.get("drift_markers") or []),
        "phase_count": len(existing_anno.get("phases") or []),
        "app_vocabularies": vocab_summary.get("vocabs_loaded") or [],
        "app_vocabulary_matches": vocab_summary.get("matched", 0),
        "app_vocabulary_hits_by_id": vocab_summary.get("vocabs_hit") or {},
    }
    # C5/§I38: a >20-point match-rate drop vs the prior run usually means
    # the target app changed its field IDs and canonical matching is
    # silently degrading. Surface it so the analyst can re-check.
    if (canonical_path and prev_match_rate is not None
            and total_interactions > 0):
        _cur = summary["meta"]["match_rate"]
        if _cur < prev_match_rate - 0.20:
            summary["meta"]["canonical_drift"] = {
                "warning": True,
                "current_rate": round(_cur, 3),
                "previous_rate": round(prev_match_rate, 3),
            }
            print(f"[normalize] WARNING: canonical match rate dropped "
                  f"{round(prev_match_rate * 100)}% -> {round(_cur * 100)}% "
                  f"-- the target application may have changed its fields")

    stats_path = session_folder / "stats.json"
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"[normalize] wrote {stats_path}")

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

    # Phase E exports
    if pdd_out:
        try:
            from pdd_export import write_pdd
            write_pdd(
                Path(pdd_out),
                session_folder=session_folder,
                canonical=canonical,
                annotations=existing_anno,
                stats=summary,
                manifest=manifest,
            )
            print(f"[normalize] wrote PDD: {pdd_out}")
        except Exception as e:
            print(f"[normalize] WARNING: PDD export failed: {e}")

    if step_bpmn_out:
        try:
            from bpmn_step import step_bpmn_from_canonical
            if not canonical:
                print("[normalize] WARNING: step BPMN requires --canonical")
            else:
                xml = step_bpmn_from_canonical(
                    canonical, [{"steps": existing_anno.get("steps") or []}]
                )
                with open(step_bpmn_out, "w", encoding="utf-8") as f:
                    f.write(xml)
                print(f"[normalize] wrote step BPMN: {step_bpmn_out}")
        except Exception as e:
            print(f"[normalize] WARNING: step BPMN export failed: {e}")

    if phase_bpmn_out:
        try:
            from bpmn_phase import phase_bpmn_from_canonical
            if not canonical:
                print("[normalize] WARNING: phase BPMN requires --canonical")
            else:
                xml = phase_bpmn_from_canonical(
                    canonical, [{"steps": existing_anno.get("steps") or [],
                                 "phases": existing_anno.get("phases") or []}]
                )
                with open(phase_bpmn_out, "w", encoding="utf-8") as f:
                    f.write(xml)
                print(f"[normalize] wrote phase BPMN: {phase_bpmn_out}")
        except Exception as e:
            print(f"[normalize] WARNING: phase BPMN export failed: {e}")

    if step_csv_out:
        try:
            from step_csv import export_step_csv
            export_step_csv(step_csv_out, existing_anno)
            print(f"[normalize] wrote step CSV: {step_csv_out}")
        except Exception as e:
            print(f"[normalize] WARNING: step CSV export failed: {e}")

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
        step_bpmn_out=getattr(args, "step_bpmn_out"),
        phase_bpmn_out=getattr(args, "phase_bpmn_out"),
        step_csv_out=getattr(args, "step_csv_out"),
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
