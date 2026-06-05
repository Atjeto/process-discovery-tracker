"""Engagement Process Backlog — aggregate automation candidates across sessions.

PDT-1.0-SPEC §5.2, §6.1. The Backlog is the consultant-facing deliverable
that ranks every identified process by (frequency × time × confidence) so
the client sees what to automate first. Each row maps to one promoted
process; rows below the confidence floor are surfaced as candidates-needing-
review, not on the public backlog.

stdlib-only. Consumes the per-session analysis.json files; produces the
backlog.json deliverable shape.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Any

# Match the per-session honesty pass.
DEFAULT_CONFIDENCE_FLOOR = 0.5
DEFAULT_VARIANT_SUPPRESSION_THRESHOLD = 3


def _load_analysis(session_folder: str | os.PathLike) -> dict[str, Any]:
    f = Path(session_folder) / "analysis.json"
    if not f.exists():
        return {}
    try:
        with open(f, "r", encoding="utf-8") as fh:
            return json.load(fh) or {}
    except (json.JSONDecodeError, OSError):
        return {}


def _load_patterns(session_folder: str | os.PathLike) -> dict[str, Any]:
    """PDT-1.0-SPEC §3.1 — Pattern Layer output blob, if present."""
    f = Path(session_folder) / "patterns.json"
    if not f.exists():
        return {}
    try:
        with open(f, "r", encoding="utf-8") as fh:
            return json.load(fh) or {}
    except (json.JSONDecodeError, OSError):
        return {}


def _load_manifest(session_folder: str | os.PathLike) -> dict[str, Any]:
    f = Path(session_folder) / "manifest.json"
    if not f.exists():
        return {}
    try:
        with open(f, "r", encoding="utf-8") as fh:
            return json.load(fh) or {}
    except (json.JSONDecodeError, OSError):
        return {}


def _load_engagement_config(folder: str | os.PathLike) -> dict[str, Any]:
    """If `folder` is the engagement root and engagement.json sits there,
    return the `config` block (so per-engagement floors flow through)."""
    f = Path(folder) / "engagement.json"
    if not f.exists():
        return {}
    try:
        with open(f, "r", encoding="utf-8") as fh:
            data = json.load(fh) or {}
        return data.get("config") or {}
    except (json.JSONDecodeError, OSError):
        return {}


def build_backlog(
    session_folders: list[str],
    *,
    confidence_floor: float | None = None,
    variant_suppression_threshold: int | None = None,
    engagement_folder: str | os.PathLike | None = None,
) -> dict[str, Any]:
    """Walk every session, group automation candidates by signature, rank them.

    PDT-1.0-SPEC §6.5: per-engagement floor/threshold. When
    `engagement_folder` is supplied (or the kwargs override) the
    engagement's config.confidence_floor / variant_suppression_threshold
    take precedence over the module defaults.
    """
    # Per-engagement config wiring.
    eng_cfg = _load_engagement_config(engagement_folder) if engagement_folder else {}
    if confidence_floor is None:
        cv = eng_cfg.get("confidence_floor")
        confidence_floor = float(cv) if isinstance(cv, (int, float)) else DEFAULT_CONFIDENCE_FLOOR
    if variant_suppression_threshold is None:
        vv = eng_cfg.get("variant_suppression_threshold")
        variant_suppression_threshold = int(vv) if isinstance(vv, int) else DEFAULT_VARIANT_SUPPRESSION_THRESHOLD

    # signature -> aggregated row
    grouped: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "signature": "",
        "label": "",
        "apps": set(),
        "instance_count": 0,
        "case_count": 0,
        "session_count": 0,
        "total_elapsed_ms": 0,
        "mean_elapsed_ms": 0,
        "confidence_sum": 0.0,
        "confidence_n": 0,
        "sessions": [],
        "case_ids": set(),
    })

    # PDT-1.0-SPEC §3.2: collect LLM-named clusters across sessions so backlog
    # rows can display the AI-named activity when available (falls back to
    # the heuristic label when no name was produced).
    named_label_for_cluster: dict[str, str] = {}

    # PDT-1.0-SPEC §6.4 — fuzzy aggregation. The segment_signature is a
    # hash of (app, ordered step labels). Two sessions doing the same
    # business process produce DIFFERENT signatures whenever the step
    # sequence differs slightly (one worker submits before saving, one
    # saves before submitting). Use a fuzzy key — sorted `step_labels`
    # tuple + app — so the same process across workers aggregates.
    def _fuzzy_key(c: dict[str, Any]) -> str:
        labels = c.get("step_labels") or []
        if not labels and c.get("label"):
            # Fallback to the label string, normalised — strip the app
            # prefix and step-arrow separators.
            lbl = c["label"]
            if "—" in lbl:
                lbl = lbl.split("—", 1)[1]
            parts = [p.strip() for p in lbl.replace("…", "").split("→") if p.strip()]
            labels = parts
        normed = sorted(set((l or "").strip().lower() for l in labels if l))
        app = (c.get("app") or "").lower()
        return f"{app}|{'+'.join(normed)}"

    # The first signature seen for each fuzzy key acts as the public id.
    fuzzy_to_signature: dict[str, str] = {}

    for sf in session_folders:
        analysis = _load_analysis(sf)
        patterns = _load_patterns(sf)
        manifest = _load_manifest(sf)
        session_id = manifest.get("session_id") or os.path.basename(sf)

        # Collect AI names from patterns.json named_clusters (ADR-0028).
        for nc in (patterns.get("named_clusters") or []):
            if not isinstance(nc, dict):
                continue
            if nc.get("insufficient_signal"):
                continue
            cid = nc.get("cluster_id")
            name = (nc.get("name") or "").strip()
            if cid and name:
                # First good name wins; consistent across sessions for the
                # same cluster id.
                named_label_for_cluster.setdefault(cid, name)

        cands = analysis.get("automation_candidates") or []
        for c in cands:
            if not isinstance(c, dict):
                continue
            sig = c.get("segment_signature")
            if not sig:
                continue
            # Map this candidate's segment_signature to a fuzzy key so
            # equivalent processes across sessions land in one row.
            fkey = _fuzzy_key(c)
            primary_sig = fuzzy_to_signature.setdefault(fkey, sig)
            row = grouped[primary_sig]
            row["signature"] = primary_sig
            row["label"] = c.get("label") or row["label"]
            for a in (c.get("apps") or []):
                row["apps"].add(a)
            row["instance_count"] += c.get("instance_count", 0)
            row["total_elapsed_ms"] += c.get("total_elapsed_ms", 0)
            scores = c.get("scores") or {}
            conf = scores.get("confidence")
            if isinstance(conf, (int, float)):
                row["confidence_sum"] += conf
                row["confidence_n"] += 1
            row["sessions"].append(session_id)
            row["session_count"] = len(set(row["sessions"]))
            for cid in (c.get("case_ids") or []):
                row["case_ids"].add(cid)
            row["case_count"] = len(row["case_ids"])

        # PDT-1.0-SPEC §3.1 + §6.4: also surface activity clusters from
        # patterns.json when they exceed the variant-suppression
        # threshold. Segment-grain candidates miss multi-app activities
        # that don't share a single contiguous segment (an activity that
        # repeats across the workflow). Activity-grain clusters fill
        # that gap. Fuzzy key here is (process_label, app) — what makes
        # two activity clusters across sessions the same activity.
        clusters_in_session = patterns.get("activity_clusters") or []
        for c in clusters_in_session:
            if not isinstance(c, dict):
                continue
            occ = c.get("occurrence_count") or 0
            if occ < 2:
                continue   # single-instance is noise
            cid = c.get("cluster_id")
            if not cid:
                continue
            label = c.get("process_label") or ""
            app = c.get("app") or ""
            fkey = "cluster|" + (app.lower()) + "|" + label.lower().strip()
            primary_sig = fuzzy_to_signature.setdefault(fkey, cid)
            row = grouped[primary_sig]
            row["signature"] = primary_sig
            if not row["label"]:
                row["label"] = label
            if app:
                row["apps"].add(app)
            row["instance_count"] += occ
            row["total_elapsed_ms"] += int((c.get("mean_duration_ms") or 0) * occ)
            cc = c.get("confidence")
            if isinstance(cc, (int, float)):
                row["confidence_sum"] += cc
                row["confidence_n"] += 1
            row["sessions"].append(session_id)
            row["session_count"] = len(set(row["sessions"]))
            for ccid in (c.get("case_ids") or []):
                row["case_ids"].add(ccid)
            row["case_count"] = len(row["case_ids"])

    rows: list[dict[str, Any]] = []
    suppressed_low_confidence = 0
    for sig, row in grouped.items():
        mean_elapsed_ms = int(row["total_elapsed_ms"] / row["instance_count"]) \
            if row["instance_count"] else 0
        confidence = (row["confidence_sum"] / row["confidence_n"]) \
            if row["confidence_n"] else 0
        # PDT-1.0-SPEC §5.2: variant analysis suppressed when too few cases.
        variant_data_sufficient = row["case_count"] >= variant_suppression_threshold

        # PDT-1.0-SPEC §3.2: prefer the AI-named label if any session named
        # this cluster. The heuristic label is preserved as fallback_label
        # so deliverables can show provenance.
        ai_name = named_label_for_cluster.get(sig)
        display_label = ai_name or row["label"]
        out = {
            "signature": sig,
            "label": display_label,
            "fallback_label": row["label"],
            "ai_named": bool(ai_name),
            "apps": sorted(row["apps"]),
            "instance_count": row["instance_count"],
            "case_count": row["case_count"],
            "session_count": row["session_count"],
            "mean_elapsed_ms": mean_elapsed_ms,
            "total_elapsed_ms": row["total_elapsed_ms"],
            "confidence": round(confidence, 3),
            "variant_data_sufficient": variant_data_sufficient,
            # ranking score: frequency × mean × confidence. The rationale —
            # frequent + slow + confident processes are the highest-value
            # automation candidates. Surfaced explicitly so the analyst can
            # see *why* a row ranks where it does.
            "rank_score": row["instance_count"] * mean_elapsed_ms * confidence,
        }
        if confidence < confidence_floor:
            suppressed_low_confidence += 1
            out["below_confidence_floor"] = True
        rows.append(out)

    # Sort by rank_score descending — the consultant sees high-value first.
    rows.sort(key=lambda r: r["rank_score"], reverse=True)
    for i, row in enumerate(rows):
        row["rank"] = i + 1

    return {
        "version": 1,
        "session_count": len(session_folders),
        "process_count": len(rows),
        "confidence_floor": confidence_floor,
        "variant_suppression_threshold": variant_suppression_threshold,
        "suppressed_low_confidence": suppressed_low_confidence,
        "rows": rows,
    }


def write_backlog(folder: str | os.PathLike, backlog: dict[str, Any]) -> None:
    p = Path(folder)
    p.mkdir(parents=True, exist_ok=True)
    f = p / "backlog.json"
    with open(f, "w", encoding="utf-8") as fh:
        json.dump(backlog, fh, ensure_ascii=False, indent=2)


def load_backlog(folder: str | os.PathLike) -> dict[str, Any]:
    f = Path(folder) / "backlog.json"
    if not f.exists():
        return {}
    try:
        with open(f, "r", encoding="utf-8") as fh:
            return json.load(fh) or {}
    except (json.JSONDecodeError, OSError):
        return {}
