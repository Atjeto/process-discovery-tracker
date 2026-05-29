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


def _coerce_event_shape(obj: dict[str, Any], line_no: int) -> dict[str, Any]:
    """Guarantee the structural invariants the rest of the pipeline relies on, so
    a corrupt or hand-edited events.jsonl line degrades instead of crashing a
    downstream consumer (coalesce / case_assignment / step_suggest all assume
    these): `data` is a dict, `event_id` is a non-empty string, and `timestamp`
    is a string. Field VALUES inside `data` are validated where they're
    interpreted -- e.g. parse_ts tolerates a non-ISO timestamp string."""
    if not isinstance(obj.get("data"), dict):
        obj["data"] = {}
    eid = obj.get("event_id")
    if not isinstance(eid, str) or not eid:
        obj["event_id"] = f"_gen{line_no}"
    ts = obj.get("timestamp")
    if not isinstance(ts, str):
        obj["timestamp"] = "" if ts is None else str(ts)
    return obj


def load_events(events_file: Path) -> tuple[list[dict[str, Any]], int]:
    events = []
    dropped = 0
    with open(events_file, encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                dropped += 1
                snippet = line[:120] + ("..." if len(line) > 120 else "")
                logger.warning(
                    "load_events: dropping malformed line %d in %s: %s | %s",
                    line_no, events_file, exc, snippet,
                )
                continue
            # A line can be valid JSON yet not an event object (a bare number,
            # string, array, null/true) -- e.g. a truncated or corrupt log.
            # Drop it like a malformed line instead of crashing downstream on
            # `.get`.
            if not isinstance(obj, dict):
                dropped += 1
                logger.warning(
                    "load_events: dropping non-object line %d in %s: %s",
                    line_no, events_file, type(obj).__name__,
                )
                continue
            events.append(_coerce_event_shape(obj, line_no))
    # Defensive ordering: timestamps are normally ISO strings (which sort
    # chronologically as strings), but a corrupt log may carry a numeric or
    # null timestamp -- coerce so heterogeneous types never crash the sort.
    def _order(e: dict[str, Any]) -> tuple[str, float]:
        ts = e.get("timestamp")
        ts = ts if isinstance(ts, str) else ("" if ts is None else str(ts))
        seq = e.get("_seq", 0)
        if isinstance(seq, bool) or not isinstance(seq, (int, float)):
            seq = 0
        return (ts, seq)
    events.sort(key=_order)
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


def compute_screenshot_hashes(session_folder: Path) -> list[dict[str, str]]:
    """Average-hash (aHash) every screenshot so the viewer's gallery can
    collapse runs of near-identical frames. Pillow is optional -- when it
    cannot be imported the feature degrades cleanly to no grouping."""
    shots_dir = session_folder / "screenshots"
    if not shots_dir.is_dir():
        return []
    try:
        from PIL import Image
    except ImportError:
        return []
    out: list[dict[str, str]] = []
    for f in sorted(shots_dir.glob("*.jpg")):
        try:
            with Image.open(f) as im:
                px = list(im.convert("L").resize((8, 8)).getdata())
        except (OSError, ValueError):
            continue
        if not px:
            continue
        avg = sum(px) / len(px)
        bits = 0
        for p in px:
            bits = (bits << 1) | (1 if p >= avg else 0)
        out.append({"filename": f.name, "hash": f"{bits:016x}"})
    return out


def _merge_phases(existing: list, fresh: list) -> list:
    """Preserve manually_authored and edited phases. Same semantics as
    _merge_steps."""
    by_state = {"manually_authored": [], "edited": []}
    for p in existing or []:
        st = p.get("state")
        if st in by_state:
            by_state[st].append(p)
    return by_state["manually_authored"] + by_state["edited"] + (fresh or [])


def reconcile_phase_membership(steps: list, phases: list) -> None:
    """Bidirectional reconcile of the dual phase-membership representation
    (CR M-4). Membership is stored twice -- on ``phase.step_ids`` AND on
    ``step.phase_id`` -- and ``_merge_phases`` preserves edited phases'
    ``step_ids`` verbatim with no check against the regenerated step set.
    A re-merge that deletes or renames a step id therefore leaves it
    dangling in ``step_ids`` (inflated count) and can drop a step that
    carries a ``phase_id`` from its phase's list.

    This pass makes the two readings agree, in place:
      * drop ids from every ``phase.step_ids`` that no longer name a step
        in ``steps`` (deleted / renamed away);
      * for every step that carries a ``phase_id`` naming a live phase,
        ensure it is listed in that phase's ``step_ids`` (forward stamp);
      * clear a step's ``phase_id`` when it points at a phase that no
        longer exists (reverse cleanup).

    Pure apart from the in-place mutation of the passed lists; no I/O.
    """
    phase_by_id = {p.get("phase_id"): p for p in (phases or []) if p.get("phase_id")}
    live_step_ids = {s.get("step_id") for s in (steps or []) if s.get("step_id")}

    # 1. Prune dangling ids from each phase's step_ids.
    for ph in phases or []:
        sids = ph.get("step_ids")
        if isinstance(sids, list):
            ph["step_ids"] = [sid for sid in sids if sid in live_step_ids]

    # 2. Reverse cleanup + forward stamp from step.phase_id.
    for s in steps or []:
        pid = s.get("phase_id")
        if pid is None:
            continue
        ph = phase_by_id.get(pid)
        if ph is None:
            # phase_id points at a phase that no longer exists.
            s["phase_id"] = None
            continue
        sids = ph.setdefault("step_ids", [])
        if not isinstance(sids, list):
            ph["step_ids"] = sids = []
        if s.get("step_id") not in sids:
            sids.append(s.get("step_id"))


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
        out.sort(key=lambda e: (e.get("timestamp", ""), e.get("_seq", 0)))
    return out, applied


# --------------------------------------------------------------------------
# Wave 0 / F4: the pipeline orchestrator decomposed into named stage helpers.
# Each helper is the verbatim body of one stage of the former normalize()
# god-function -- a pure structural extraction (zero behavior change). Shared
# state (events, annotations/existing_anno, the `cal` calibration dict,
# session_id, flags) is threaded explicitly rather than via a closure, and each
# stage keeps its original best-effort try/except exactly where it was.
# --------------------------------------------------------------------------


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
    annotations: dict[str, Any],
    canonical_path: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], Any, str | None, dict]:
    """Stage 2a/3: case assignment (anchor mode or marker mode) + app-vocab
    enrichment. Returns (with_cases, cases, canonical, canonical_path,
    vocab_summary). `canonical_path` is returned as None when a remembered
    Process Template path is stale (missing on this machine), and `canonical`
    is the loaded template dict (or None)."""
    # A remembered Process Template path can go stale: the file may be absent on
    # this machine (a session matched elsewhere, then handed off). Treat a missing
    # template as "no template" and analyze without it, rather than crashing the
    # whole run on a FileNotFoundError.
    if canonical_path and not os.path.exists(canonical_path):
        print(f"[normalize] WARNING: Process Template not found: {canonical_path} "
              "-- analyzing without it.", file=sys.stderr)
        canonical_path = None

    # Stage 2a/3: case assignment -- anchor mode or marker mode.
    # Precedence: Process Template's case_anchor (template wins; the
    # canonical engagement contract) > annotations.case_anchor_override
    # (the analyst's session-level pick from an anchor candidate,
    # ADR-0018) > marker pairs.
    canonical = None
    anchor_cfg = None
    anchor_source = None
    if canonical_path:
        from canonical_match import load_canonical
        canonical = load_canonical(canonical_path)
        anchor_cfg = canonical.get("case_anchor")
        if anchor_cfg:
            anchor_source = "template"

    if not anchor_cfg and isinstance(annotations, dict):
        override = coerce_anchor_override(annotations.get("case_anchor_override"))
        if override:
            anchor_cfg = override
            anchor_source = "override"

    if anchor_cfg:
        anchor_interactions = [
            e for e in edited if e.get("type") == "interaction"]
        anchor_cases = detect_cases_from_anchors(anchor_interactions, anchor_cfg)
        with_cases, cases = stamp_anchor_cases(edited, anchor_cases)
        print(f"[normalize] anchor cases ({anchor_source}): "
              f"{len(cases)} cases detected")
    else:
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
        vocab_summary = {"matched": 0, "total": 0, "vocabs_loaded": [],
                         "vocabs_hit": {}, "coverage": {}}
    return with_cases, cases, canonical, canonical_path, vocab_summary


def _init_existing_anno(annotations: dict, session_id_str: str) -> dict[str, Any]:
    """Build the working annotations dict the step/suggestion/analysis stages
    mutate, preserving the analyst's existing blocks and seeding the lists the
    pipeline appends to."""
    existing_anno = dict(annotations) if isinstance(annotations, dict) else {}
    existing_anno.setdefault("phases", [])
    existing_anno.setdefault("annotations", [])
    existing_anno.setdefault("notes", existing_anno.get("notes") or [])
    existing_anno.setdefault("marker_edits", existing_anno.get("marker_edits") or [])
    existing_anno.setdefault("drift_markers", existing_anno.get("drift_markers") or [])
    existing_anno["version"] = 1
    existing_anno["session_id"] = session_id_str
    return existing_anno


def _run_suggestions(
    existing_anno: dict,
    with_cases: list[dict[str, Any]],
    cases: list[dict[str, Any]],
) -> None:
    """Suggested markers (ADR-0017) + anchor candidates (ADR-0018). Both are
    best-effort detectors that mutate `existing_anno` in place; a detector edge
    case never blocks the pipeline."""
    # Suggested markers (ADR-0017). Hand-rolled change-point detector
    # surfaces candidate Start/End pairs for any stretch of work outside
    # an open marker case. Suggestions live in annotations.json as a
    # separate block; the analyst Accepts (which writes an op:insert into
    # marker_edits[] with derived_from_signature) or Dismisses (which
    # adds the signature to marker_suggestions_dismissed[] so it's
    # suppressed across re-normalize). Best-effort -- a detector edge
    # case never blocks the pipeline.
    existing_anno.setdefault(
        "marker_suggestions", existing_anno.get("marker_suggestions") or [])
    existing_anno.setdefault(
        "marker_suggestions_dismissed",
        existing_anno.get("marker_suggestions_dismissed") or [])
    try:
        fresh_sugs = suggest_markers(
            with_cases, cases,
            excluded_ranges=_excluded_ranges(existing_anno),
        )
        existing_anno["marker_suggestions"] = merge_marker_suggestions(
            existing=existing_anno.get("marker_suggestions") or [],
            fresh=fresh_sugs,
            dismissed=existing_anno.get("marker_suggestions_dismissed") or [],
            accepted_edits=existing_anno.get("marker_edits") or [],
        )
        n = len(existing_anno["marker_suggestions"])
        if n:
            print(f"[normalize] {n} suggested marker(s) (ADR-0017)")
    except Exception as e:
        print(f"[normalize] WARNING: marker_suggest failed: {e}")

    # Anchor candidates (ADR-0018). Pattern-mine value_changed events
    # for fields that look like case anchors -- a session-level Accept
    # writes a case_anchor_override into annotations and the next
    # normalize stamps cases by that anchor instead of needing a
    # Process Template. Best-effort.
    existing_anno.setdefault(
        "anchor_candidates", existing_anno.get("anchor_candidates") or [])
    existing_anno.setdefault(
        "anchor_candidates_dismissed",
        existing_anno.get("anchor_candidates_dismissed") or [])
    try:
        fresh_anchors = suggest_anchors(with_cases)
        existing_anno["anchor_candidates"] = merge_anchor_candidates(
            existing=existing_anno.get("anchor_candidates") or [],
            fresh=fresh_anchors,
            dismissed=existing_anno.get("anchor_candidates_dismissed") or [],
            case_anchor_override=existing_anno.get("case_anchor_override"),
        )
        n = len(existing_anno["anchor_candidates"])
        if n:
            print(f"[normalize] {n} anchor candidate(s) (ADR-0018)")
    except Exception as e:
        print(f"[normalize] WARNING: anchor_suggest failed: {e}")


def _run_step_segmentation(
    with_cases: list[dict[str, Any]],
    cases: list[dict[str, Any]],
    canonical_path: str | None,
    canonical: Any,
    existing_anno: dict,
    session_id_str: str,
    cal: dict,
    session_folder: Path,
) -> tuple[list[dict[str, Any]], int, list[dict[str, Any]], int]:
    """Step segmentation (canonical match + auto-suggest fallback, or
    auto-suggest only) and phase rollup, then persist annotations. Returns
    (merged_steps, matched_interactions, unmatched_evs, total_interactions)."""
    matched_interactions = 0
    unmatched_evs: list[dict[str, Any]] = []
    total_interactions = sum(1 for e in with_cases if e.get("type") == "interaction")
    if canonical_path:
        from canonical_match import match_canonical, rollup_phases
        if canonical is None:
            from canonical_match import load_canonical
            canonical = load_canonical(canonical_path)
        existing_anno["matched_against"] = {
            "canonical_process_id": canonical.get("id"),
            "canonical_version": canonical.get("version"),
        }
        matched_steps, unmatched = match_canonical(
            with_cases, canonical, session_id=session_id_str
        )
        matched_interactions = total_interactions - len(unmatched)
        unmatched_evs = unmatched
        if unmatched:
            fallback = auto_suggest_steps(
                unmatched, session_id=session_id_str,
                ignored_processes=_step_ignored_processes(existing_anno),
                excluded_ranges=_excluded_ranges(existing_anno),
                **_step_calibration_kwargs(cal),
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
        # M-4: reconcile the dual representation -- drop step_ids that no
        # longer name a regenerated step, and forward-stamp any step whose
        # phase_id is missing from its phase's step_ids.
        reconcile_phase_membership(existing_anno["steps"], existing_anno["phases"])
        write_annotations(session_folder, existing_anno)
        print(f"[normalize] canonical match: {len(matched_steps)} steps "
              f"({matched_interactions}/{total_interactions} interactions matched)")
    else:
        auto_steps = auto_suggest_steps(
            with_cases, session_id=session_id_str,
            ignored_processes=_step_ignored_processes(existing_anno),
            excluded_ranges=_excluded_ranges(existing_anno),
            **_step_calibration_kwargs(cal),
        )
        merged_steps = _merge_steps(existing_anno.get("steps") or [], auto_steps)
        existing_anno["steps"] = merged_steps
        existing_anno.setdefault("matched_against", None)
        # M-4: no fresh phases are mined on the non-canonical path, but any
        # preserved (edited / manually_authored) phases must still be
        # reconciled against the regenerated step set so deleted ids don't
        # linger in step_ids.
        if existing_anno.get("phases"):
            reconcile_phase_membership(existing_anno["steps"], existing_anno["phases"])
        write_annotations(session_folder, existing_anno)
        print(f"[normalize] auto-suggested {len(auto_steps)} step(s) "
              f"({len(merged_steps)} total after merge)")
    return merged_steps, matched_interactions, unmatched_evs, total_interactions


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
    matched_interactions: int,
    edits_applied: int,
    merged_steps: list[dict[str, Any]],
    canonical: Any,
    canonical_path: str | None,
    coalesced: list[dict[str, Any]],
    vocab_summary: dict,
    unmatched_evs: list[dict[str, Any]],
) -> tuple[dict[str, Any], Path]:
    """Compute the statistics summary and write stats.json. Returns
    (summary, stats_path)."""
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

    summary = stats.compute_all(
        log_events, cases,
        excluded_ranges=_excluded_ranges(existing_anno),
        steps=existing_anno.get("steps") or [],
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
        "coalesced_event_count": len(coalesced),
        "drift_count": len(existing_anno.get("drift_markers") or []),
        "phase_count": len(existing_anno.get("phases") or []),
        "app_vocabularies": vocab_summary.get("vocabs_loaded") or [],
        "app_vocabulary_matches": vocab_summary.get("matched", 0),
        "app_vocabulary_hits_by_id": vocab_summary.get("vocabs_hit") or {},
        "vocab_coverage": vocab_summary.get("coverage") or {},
    }
    # Unmatched-interaction summary for canonical runs
    if canonical_path and unmatched_evs:
        um_apps: dict[str, int] = {}
        for ue in unmatched_evs:
            app = (ue.get("data", {}).get("process_name") or "unknown")
            um_apps[app] = um_apps.get(app, 0) + 1
        summary["meta"]["unmatched_interactions"] = {
            "count": len(unmatched_evs),
            "apps": um_apps,
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
    return summary, stats_path


def _run_analysis(
    session_folder: Path,
    classified: list[dict[str, Any]],
    existing_anno: dict,
    summary: dict,
    manifest: dict,
) -> Any:
    """Analysis layer (ADR-0008 / IMPROVEMENTS.md Cluster N). Heuristic
    IE/CI findings -- waste classification, time study, automation
    candidates, the process-efficiency ratio -- written to
    analysis.json. Runs whenever the session has steps; best-effort,
    never blocks the pipeline. Returns the analysis result (or None)."""
    analysis_result = None
    if existing_anno.get("steps"):
        try:
            from analysis import run_analysis
            analysis_result = run_analysis(
                events=classified,
                steps=existing_anno.get("steps") or [],
                phases=existing_anno.get("phases") or [],
                stats=summary,
                manifest=manifest,
                annotations=existing_anno,
            )
            analysis_path = session_folder / "analysis.json"
            with open(analysis_path, "w", encoding="utf-8") as f:
                json.dump(analysis_result, f, indent=2)
            print(f"[normalize] wrote {analysis_path}")
        except Exception as e:
            print(f"[normalize] WARNING: analysis layer failed: {e}")
    return analysis_result


def _run_mining_exports(
    session_folder: Path,
    log: Any,
    existing_anno: dict,
    mine: bool,
    canonical: Any,
    summary: dict,
    manifest: dict,
    analysis_result: Any,
    pdd_out: str | None,
    pdd_map_image: str | None,
    step_bpmn_out: str | None,
    phase_bpmn_out: str | None,
    step_csv_out: str | None,
) -> None:
    """Mining (DFG / aggregate BPMN / observed-flow BPMN / per-case BPMN) plus
    the Phase E exports (PDD, step/phase BPMN, step CSV). Each sub-export keeps
    its own best-effort try/except."""
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
        # Step/phase observed-flow BPMN: the ACTUAL annotated step/phase flow
        # mined into BPMN (the Process-diagram counterpart of the step/phase
        # Flow diagram). Built from annotations -- no Process Template needed.
        try:
            import bpmn_observed
            if any(s.get("state") != "hidden"
                   for s in (existing_anno.get("steps") or [])):
                if bpmn_observed.write_observed_bpmn(
                        existing_anno, "step",
                        str(session_folder / "process_map_step.bpmn")):
                    print(f"[normalize] wrote {session_folder / 'process_map_step.bpmn'}")
                if (existing_anno.get("phases") or []) and bpmn_observed.write_observed_bpmn(
                        existing_anno, "phase",
                        str(session_folder / "process_map_phase.bpmn")):
                    print(f"[normalize] wrote {session_folder / 'process_map_phase.bpmn'}")
        except Exception as e:
            print(f"[normalize] WARNING: step/phase BPMN failed: {e}")
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
                analysis=analysis_result,
                process_map_image=pdd_map_image,
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
