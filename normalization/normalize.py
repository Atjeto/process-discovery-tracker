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
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Python embeddable distributions do not auto-add the script's directory
# to sys.path (the ._pth file overrides default behavior). Add it ourselves
# so sibling modules (case_assignment, classification, ...) import cleanly
# whether we run under regular Python or the bundled embeddable.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from case_assignment import assign_case_ids, collect_cases
from classification import classify_events, collapse_adjacent, load_taxonomy
from xes_export import build_event_log, export_xes, export_csv
from step_suggest import auto_suggest_steps
import stats_compute as stats


def load_events(events_file: Path) -> list[dict[str, Any]]:
    events = []
    with open(events_file, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    events.sort(key=lambda e: e.get("timestamp", ""))
    return events


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


def _merge_steps(existing: list, fresh: list) -> list:
    """Preserve manually_authored and edited steps. Replace auto_*
    steps with the latest fresh suggestions only if their case has any
    fresh suggestions (otherwise leave the prior auto_suggested in place
    so the analyst doesn't lose context on a partial re-run)."""
    by_state = {"manually_authored": [], "edited": []}
    for s in existing or []:
        st = s.get("state")
        if st in by_state:
            by_state[st].append(s)
    return by_state["manually_authored"] + by_state["edited"] + (fresh or [])


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

    Returns (edited_events, applied_count). Raw events.jsonl never
    modified; this builds a derived stream that downstream stages walk.
    """
    edits = (annotations or {}).get("marker_edits") or []
    if not edits:
        return events, 0
    label_over: dict[str, Any] = {}
    ts_over: dict[str, Any] = {}
    deleted: set[str] = set()
    for e in edits:
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
    # If we changed any timestamps, sort again so downstream sees order
    if ts_over:
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

    manifest = load_manifest(session_folder)
    worker_id = (manifest.get("config", {}).get("worker") or {}).get("id", "unknown")

    raw = load_events(events_file)
    print(f"[normalize] loaded {len(raw)} raw events")

    annotations = load_annotations(session_folder)
    edited, edits_applied = apply_marker_edits(raw, annotations)
    if edits_applied:
        print(f"[normalize] applied {edits_applied} annotation edit(s) from annotations.json")

    with_cases = assign_case_ids(edited)
    cases = collect_cases(with_cases)
    print(f"[normalize] identified {len(cases)} cases")

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
            fallback = auto_suggest_steps(unmatched, session_id=session_id_str)
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
        auto_steps = auto_suggest_steps(with_cases, session_id=session_id_str)
        merged_steps = _merge_steps(existing_anno.get("steps") or [], auto_steps)
        existing_anno["steps"] = merged_steps
        existing_anno.setdefault("matched_against", None)
        write_annotations(session_folder, existing_anno)
        print(f"[normalize] auto-suggested {len(auto_steps)} step(s) "
              f"({len(merged_steps)} total after merge)")

    taxonomy = load_taxonomy(taxonomy_path) if taxonomy_path else {"rules": []}
    print(f"[normalize] taxonomy: {len(taxonomy.get('rules', []))} rules")

    classified = classify_events(with_cases, taxonomy)
    collapsed = collapse_adjacent(classified)
    print(f"[normalize] collapsed: {sum(1 for e in classified if e.get('type') == 'activity')} -> "
          f"{sum(1 for e in collapsed if e.get('type') == 'activity')} activity events")

    log = build_event_log(collapsed, cases, worker_id=worker_id)
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

    summary = stats.compute_all(collapsed, cases)
    summary["meta"] = {
        "normalization_run_at": datetime.now(timezone.utc).isoformat(),
        "taxonomy_version": (taxonomy or {}).get("version"),
        "taxonomy_path": str(taxonomy_path) if taxonomy_path else None,
        "session_folder": str(session_folder),
        "worker_id": worker_id,
        "raw_event_count": len(raw),
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
    }
    stats_path = session_folder / "stats.json"
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"[normalize] wrote {stats_path}")

    if mine:
        import mining as mining_mod
        # DFG first - pure data, no Graphviz needed. Always emit if possible.
        try:
            dfg, starts, ends = mining_mod.discover_dfg(log)
            dfg_path = session_folder / "dfg.json"
            with open(dfg_path, "w", encoding="utf-8") as f:
                json.dump(mining_mod.dfg_to_dict(dfg, starts, ends), f, indent=2)
            print(f"[normalize] wrote {dfg_path}")
        except Exception as e:
            print(f"[normalize] WARNING: DFG mining failed: {e}")
        # BPMN export - PM4Py's BPMN write path invokes Graphviz `dot` for
        # layout. Non-fatal when missing; the viewer's DFG renders fine
        # without BPMN.
        try:
            bpmn = mining_mod.discover_inductive(log, noise_threshold=0.2)
            bpmn_path = session_folder / "process_map.bpmn"
            mining_mod.export_bpmn(bpmn, str(bpmn_path))
            print(f"[normalize] wrote {bpmn_path}")
        except Exception as e:
            msg = str(e)
            if "dot" in msg.lower() or "graphviz" in msg.lower():
                print("[normalize] WARNING: BPMN export skipped - Graphviz `dot` not on PATH. "
                      "Install Graphviz from graphviz.org if you need BPMN files. "
                      "The DFG (dfg.json) renders in the viewer regardless.")
            else:
                print(f"[normalize] WARNING: BPMN mining failed: {msg}")

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

    # Phase F: ML pass (best-effort, non-fatal)
    try:
        from ml.classifier import predict as ml_predict
        uncovered = [
            e for e in classified
            if e.get("type") == "activity" and
            (e["data"].get("activity_label") or "").startswith("Unclassified")
        ]
        if uncovered:
            texts = [f"{e['data'].get('app','')} | {e['data'].get('title','')}" for e in uncovered]
            preds = ml_predict(texts, min_confidence=0.55)
            ml_suggestions = []
            for ev, (label, conf) in zip(uncovered, preds):
                if label is not None:
                    ml_suggestions.append({
                        "kind": "classification",
                        "event_id": ev["event_id"],
                        "suggested_label": label,
                        "confidence": conf,
                    })
            if ml_suggestions:
                _write_ml_suggestions(session_folder, ml_suggestions)
                print(f"[normalize] wrote {len(ml_suggestions)} ML suggestion(s)")
    except Exception as e:
        print(f"[normalize] ML pass skipped: {e}")

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


def _write_ml_suggestions(session_folder: Path, suggestions: list[dict]) -> None:
    out = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "suggestions": suggestions,
    }
    with open(session_folder / "ml_suggestions.json", "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)


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
    parser.add_argument("--retrain-classifier", action="store_true",
                        help="Retrain the local ML classifier from the taxonomy and exit.")
    parser.add_argument("--cluster-review", nargs="+", default=None,
                        help="Run HDBSCAN cluster review over interaction events in the given session folders.")
    args = parser.parse_args()

    if args.retrain_classifier:
        if not args.taxonomy:
            print("ERROR: --taxonomy required for --retrain-classifier", file=sys.stderr)
            sys.exit(2)
        try:
            from ml.classifier import train_from_taxonomy
            train_from_taxonomy(args.taxonomy)
            print(json.dumps({"ok": True, "retrained": True}, indent=2))
        except Exception as e:
            print(f"ERROR: retrain failed: {e}", file=sys.stderr)
            sys.exit(2)
        return

    if args.cluster_review:
        try:
            from ml.cluster import cluster_uncovered
            all_events = []
            for f in args.cluster_review:
                p = Path(f) / "events.jsonl"
                if not p.exists():
                    continue
                with open(p, encoding="utf-8") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            ev = json.loads(line)
                            if ev.get("type") == "interaction":
                                all_events.append(ev)
                        except json.JSONDecodeError:
                            pass
            clusters = cluster_uncovered(all_events)
            print(json.dumps({"ok": True, "clusters": clusters}, indent=2))
        except Exception as e:
            print(f"ERROR: cluster review failed: {e}", file=sys.stderr)
            sys.exit(2)
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
