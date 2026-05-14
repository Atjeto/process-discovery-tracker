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

from case_assignment import assign_case_ids, collect_cases
from classification import classify_events, collapse_adjacent, load_taxonomy
from xes_export import build_event_log, export_xes, export_csv
import statistics as stats


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


def apply_marker_edits(
    events: list[dict[str, Any]],
    annotations: dict[str, Any],
) -> tuple[list[dict[str, Any]], int]:
    """§9.3 option b -- apply annotation overrides during normalization.

    Currently supports `field: "label"` rename edits. Returns the
    edit-applied event list plus the count of edits applied. Raw
    events.jsonl is never modified; this builds a derived stream.
    """
    edits = (annotations or {}).get("marker_edits") or []
    if not edits:
        return events, 0
    # Last-write-wins per (event_id, field)
    overrides: dict[tuple[str, str], Any] = {}
    for e in edits:
        evid = e.get("event_id")
        field = e.get("field")
        if not evid or not field:
            continue
        overrides[(evid, field)] = e.get("value")
    applied = 0
    out: list[dict[str, Any]] = []
    for ev in events:
        if ev.get("type") != "marker":
            out.append(ev)
            continue
        evid = ev.get("event_id")
        new_label = overrides.get((evid, "label"))
        if new_label is None:
            out.append(ev)
            continue
        new_ev = dict(ev)
        new_ev["data"] = {**ev["data"], "label": new_label}
        out.append(new_ev)
        applied += 1
    return out, applied


def normalize(
    session_folder: Path,
    taxonomy_path: str | None = None,
    mine: bool = False,
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
        "case_count": len(cases),
        "annotations_present": (session_folder / "annotations.json").exists(),
        "marker_edits_applied": edits_applied,
    }
    stats_path = session_folder / "stats.json"
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"[normalize] wrote {stats_path}")

    if mine:
        try:
            import mining as mining_mod
            bpmn = mining_mod.discover_inductive(log, noise_threshold=0.2)
            bpmn_path = session_folder / "process_map.bpmn"
            mining_mod.export_bpmn(bpmn, str(bpmn_path))
            print(f"[normalize] wrote {bpmn_path}")

            dfg, starts, ends = mining_mod.discover_dfg(log)
            dfg_path = session_folder / "dfg.json"
            with open(dfg_path, "w", encoding="utf-8") as f:
                json.dump(mining_mod.dfg_to_dict(dfg, starts, ends), f, indent=2)
            print(f"[normalize] wrote {dfg_path}")
        except Exception as e:
            print(f"[normalize] WARNING: mining failed: {e}")

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
    parser.add_argument("session_folder", type=Path, help="Path to the session folder.")
    parser.add_argument("--taxonomy", type=str, default=None,
                        help="Path to taxonomy.yaml. Falls back to no classification.")
    parser.add_argument("--mine", action="store_true",
                        help="Run PM4Py inductive miner and emit process_map.bpmn + dfg.json.")
    args = parser.parse_args()
    if not args.session_folder.is_dir():
        print(f"ERROR: {args.session_folder} is not a directory", file=sys.stderr)
        sys.exit(2)
    result = normalize(args.session_folder, taxonomy_path=args.taxonomy, mine=args.mine)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
