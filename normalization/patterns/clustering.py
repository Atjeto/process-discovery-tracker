"""Activity clustering on the step set (ADR-0029).

v1 groups steps by an exact 4-tuple of attributes — `(process_label,
screen_label, app, mean_duration_bucket)`. "Similar but not identical" is a
v2 concern; the spec explicitly says exact-tuple match is the v1 default. A
duration bucket coarsens away one-off jitter (10 ms vs. 11 ms) without
collapsing genuinely different mean durations into one cluster.

Confidence per cluster blends:
- coverage  = occurrence_count / total_steps          (cluster's footprint)
- tuple_completeness = 1.0 if process_label + screen + app all present, else 0.7
- capture-confidence floor: if ANY interaction in the cluster's evidence has
  capture confidence < 0.30 (ADR-0023 §11e), the cluster's overall confidence
  is capped at 0.5 — a low-trust capture cannot certify a cluster name.

Pure stdlib.
"""
from __future__ import annotations

import hashlib
import math
from statistics import mean
from typing import Any

# Mean-duration bucket boundaries in milliseconds. A step is bucketed by the
# largest boundary it does NOT exceed (so 30s lands in `30s`, 31s in `2m`).
# Coarsening keeps cluster identity stable against jitter without flattening
# genuinely different durations into one node.
_BUCKETS_MS: list[tuple[int, str]] = [
    (1_000, "1s"),
    (5_000, "5s"),
    (30_000, "30s"),
    (120_000, "2m"),
    (600_000, "10m"),
    (3_600_000, "1h"),
]


def _duration_bucket(ms: float | None) -> str:
    """Coarsen a step's mean duration into a label-friendly bucket. None / 0 /
    negative → `unknown` (so a zero-duration step doesn't merge with a 1s step)."""
    if ms is None or not math.isfinite(ms) or ms <= 0:
        return "unknown"
    for upper, label in _BUCKETS_MS:
        if ms <= upper:
            return label
    return "1h+"


def _step_duration_ms(step: dict[str, Any]) -> float | None:
    """Wall-clock duration of a step from its `time_range`. Returns None if the
    range is missing or unparseable — that step is bucketed as `unknown`."""
    tr = step.get("time_range") or {}
    start, end = tr.get("start"), tr.get("end")
    if not start or not end:
        return None
    # Cheap lexicographic comparison would be wrong (DST / TZ tails); use the
    # _dt helper that the rest of the pipeline already trusts.
    try:
        from _dt import parse_ts_or_epoch as parse_ts
    except Exception:
        return None
    try:
        a, b = parse_ts(start), parse_ts(end)
    except Exception:
        return None
    return max(0.0, (b - a).total_seconds() * 1000.0)


def _screen_label(step: dict[str, Any]) -> str:
    """Best available value-free screen string for a step. The pipeline stamps
    `grain_keys.screen` per ADR-0024; fall back to an empty string so a step
    that pre-dates the grain-keys field still clusters cleanly."""
    gk = step.get("grain_keys") or {}
    return (gk.get("screen") or "").strip()


def _app(step: dict[str, Any]) -> str:
    """Best available app key for a step (from ADR-0024 grain_keys)."""
    gk = step.get("grain_keys") or {}
    return (gk.get("app") or "").strip()


def _stable_id(parts: list[str]) -> str:
    """12-hex blake2b over the cluster's identity tuple. Stable across runs."""
    joined = "\x1f".join(parts)
    return hashlib.blake2b(joined.encode("utf-8"), digest_size=6).hexdigest()


def _interactions_for_steps(
    steps: list[dict[str, Any]],
    events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Resolve the interaction events backing each step's evidence ids. Returns
    the subset of `events` whose event_id is referenced by one of the input
    steps — used to apply the capture-confidence floor."""
    wanted: set[str] = set()
    for s in steps:
        for eid in ((s.get("evidence") or {}).get("interaction_event_ids") or []):
            if eid:
                wanted.add(eid)
    if not wanted:
        return []
    return [e for e in events if e.get("event_id") in wanted]


def _has_low_capture_confidence(interactions: list[dict[str, Any]]) -> bool:
    """True if any interaction has capture confidence < 0.30 (ADR-0023 §11e).
    A missing `confidence` field is treated as "no signal" — does NOT trip the
    floor (we cap only on positive evidence of low trust)."""
    for ev in interactions:
        c = (ev.get("data") or {}).get("confidence")
        if isinstance(c, (int, float)) and c < 0.30:
            return True
    return False


def find_activity_clusters(
    steps: list[dict[str, Any]],
    events: list[dict[str, Any]] | None = None,
    disagreements: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Cluster steps by exact `(process_label, screen_label, app,
    mean_duration_bucket)` tuple. Each cluster reports its constituent
    step_ids, case_ids, occurrence_count, mean_duration_ms, and a confidence
    in [0, 1] derived from coverage, tuple completeness, and the capture-
    confidence floor.

    `events` is the (best available) raw interaction stream — used only to
    enforce the capture-confidence cap. If None, the cap simply doesn't fire.

    `disagreements` is `annotations.disagreements[]` (PDT-1.0-SPEC §4.3,
    ADR-0029). A worker / consultant editing an AI-suggested step name in
    Glance writes a `{step_id, rejected, proposed}` entry. On the next
    normalize pass the cluster confidence is capped at 0.5 for any cluster
    whose membership includes a step the user previously disagreed with,
    AND the cluster carries a `disagreement_count` so the Cockpit can show
    "review by hand" provenance.
    """
    if not steps:
        return []
    total_steps = len(steps)
    events = events or []
    # Index disagreements by step_id for O(1) lookup during the cluster pass.
    disagree_step_ids: set[str] = set()
    if disagreements:
        for d in disagreements:
            if isinstance(d, dict):
                sid = d.get("step_id")
                if sid:
                    disagree_step_ids.add(sid)

    # Group by the exact 4-tuple.
    buckets: dict[tuple[str, str, str, str], list[dict[str, Any]]] = {}
    durations: dict[tuple[str, str, str, str], list[float]] = {}
    for s in steps:
        proc = (s.get("process_label") or "").strip()
        screen = _screen_label(s)
        app = _app(s)
        dur = _step_duration_ms(s)
        key = (proc, screen, app, _duration_bucket(dur))
        buckets.setdefault(key, []).append(s)
        if dur is not None:
            durations.setdefault(key, []).append(dur)

    clusters: list[dict[str, Any]] = []
    for key, members in buckets.items():
        proc, screen, app, _bucket = key
        member_durs = durations.get(key, [])
        mean_dur = int(round(mean(member_durs))) if member_durs else 0
        case_ids = sorted({s.get("case_id") for s in members if s.get("case_id")})
        step_ids = [s.get("step_id") for s in members if s.get("step_id")]
        occurrence_count = len(members)

        # Tuple completeness: full identity tuple vs. partial.
        tuple_completeness = 1.0 if (proc and screen and app) else 0.7
        coverage = occurrence_count / total_steps if total_steps else 0.0
        # A single instance is a noise floor regardless of coverage; clamp.
        coverage_contribution = min(1.0, coverage * 2.0)

        # Base confidence: a coverage-weighted blend with the completeness factor.
        # The two factors compose multiplicatively so a partial tuple discounts
        # the score evenly across the range, not just at one end.
        base = (0.4 + 0.6 * coverage_contribution) * tuple_completeness

        # Capture-confidence floor (ADR-0023).
        cluster_events = _interactions_for_steps(members, events)
        if _has_low_capture_confidence(cluster_events):
            base = min(base, 0.5)

        # Disagreement penalty (PDT-1.0-SPEC §4.3). If any member step is in
        # the disagreement set, the cluster is suspect — cap confidence at
        # 0.5 so the Cockpit's filter floor catches it for review, and emit
        # a count so the analyst sees provenance.
        disagree_in_cluster = sum(1 for sid in step_ids if sid in disagree_step_ids)
        if disagree_in_cluster:
            base = min(base, 0.5)

        confidence = max(0.0, min(1.0, base))

        clusters.append({
            "cluster_id": _stable_id([proc, screen, app, _bucket]),
            "process_label": proc,
            "screen_label": screen,
            "app": app,
            "step_ids": step_ids,
            "case_ids": case_ids,
            "occurrence_count": occurrence_count,
            "mean_duration_ms": mean_dur,
            "confidence": round(confidence, 4),
            "disagreement_count": disagree_in_cluster,
        })

    clusters.sort(key=lambda c: (-c["occurrence_count"], c["cluster_id"]))
    # PDT-1.0-SPEC §3.1: optional semantic merge of exact-tuple clusters
    # whose process_label / screen_label are semantically equivalent
    # ("Submit" + "Send" + "Save record" → one). Best-effort: if the
    # embeddings backend is unreachable, the exact-tuple clusters survive
    # unchanged. Same-app clusters only — semantic merge across different
    # apps would collapse genuinely distinct work surfaces.
    clusters = _semantic_merge(clusters)
    return clusters


# PDT-1.0-SPEC §3.1 — LLM-as-judge cluster equivalence (v2 of the
# semantic merge). Cosine on a tiny embedding model was too conservative
# on short labels — "Submit"/"Send"/"Save record" never crossed
# threshold even though a worker would describe them as the same
# activity. The judge consults the bundled qwen2.5:1.5b for the
# ambiguous middle band; obvious YES (cos ≥ 0.78) and obvious NO
# (cos ≤ 0.30) short-circuit to skip the LLM call. See
# naming/equivalence_judge.py for the budget cap and prompt structure.


def _semantic_merge(clusters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group same-app clusters whose labels describe the same activity,
    as judged by qwen2.5:1.5b with a cosine fast-path (see
    equivalence_judge.py).

    Lazy import — keeps clustering.py importable on systems without the
    naming subpackage (the merge then no-ops).
    """
    if len(clusters) < 2:
        return clusters
    try:
        from naming.equivalence_judge import equivalence_pairs
    except ImportError:
        try:
            from normalization.naming.equivalence_judge import equivalence_pairs  # type: ignore
        except ImportError:
            return clusters

    pairs = equivalence_pairs(clusters)
    if not pairs:
        return clusters

    # Union-find over judge-confirmed equivalent pairs.
    parent = list(range(len(clusters)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i, j in pairs:
        union(i, j)

    # Coalesce members under each root.
    groups: dict[int, list[int]] = {}
    for i in range(len(clusters)):
        groups.setdefault(find(i), []).append(i)

    merged: list[dict[str, Any]] = []
    for root, members in groups.items():
        if len(members) == 1:
            merged.append(clusters[members[0]])
            continue
        # Pick the most-frequent constituent as the "head" — its label wins.
        members_sorted = sorted(members,
                                key=lambda i: (-clusters[i]["occurrence_count"],
                                                clusters[i]["cluster_id"]))
        head = clusters[members_sorted[0]]
        all_step_ids: list[str] = []
        all_case_ids: list[str] = []
        total_occ = 0
        total_dur = 0
        merged_labels: list[str] = []
        max_disagree = 0
        for mi in members:
            c = clusters[mi]
            all_step_ids.extend(c.get("step_ids") or [])
            all_case_ids.extend(c.get("case_ids") or [])
            total_occ += c.get("occurrence_count", 0)
            total_dur += (c.get("mean_duration_ms", 0) or 0) * (c.get("occurrence_count", 0) or 0)
            lbl = (c.get("process_label") or "").strip()
            if lbl and lbl not in merged_labels:
                merged_labels.append(lbl)
            max_disagree = max(max_disagree, c.get("disagreement_count", 0))
        mean_dur = int(total_dur / total_occ) if total_occ else 0
        unique_case_ids = sorted(set(all_case_ids))
        # New stable id for the merged group — hash of the sorted member ids.
        merged_id = _stable_id(
            [head["app"], "merged"] + sorted(c["cluster_id"] for c in (clusters[i] for i in members))
        )
        merged.append({
            "cluster_id": merged_id,
            "process_label": head["process_label"],
            "screen_label": head["screen_label"],
            "app": head["app"],
            "step_ids": all_step_ids,
            "case_ids": unique_case_ids,
            "occurrence_count": total_occ,
            "mean_duration_ms": mean_dur,
            # Average source confidences weighted by occurrence count.
            "confidence": round(
                sum(clusters[i]["confidence"] * clusters[i]["occurrence_count"]
                    for i in members) / total_occ, 4) if total_occ else 0,
            "disagreement_count": max_disagree,
            "semantic_merge": {
                "merged_label_variants": merged_labels,
                "merged_cluster_ids": sorted(clusters[i]["cluster_id"] for i in members),
            },
        })
    merged.sort(key=lambda c: (-c["occurrence_count"], c["cluster_id"]))
    return merged
