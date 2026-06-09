"""Sequence motif discovery on the step `process_label` stream.

Ported as-is from the parked ML branch (`project-vision-ai-ml:
normalization/patterns/motif_mining.py`, ADR-0029 there) per the
lab-phase spec (LAB-PHASE-SPEC.md §A3) -- it is pure stdlib and feeds
the `backtracking` / `repetition` findings detectors plus the
`repeated_sequence_count` fact. Phase A adds `find_bounces` (A->B->A
returns), which the original module did not have.

For each case, the case's step `process_label` sequence is treated as a
string of symbols and repeated subsequences of length 3-8 are counted
via a simple sliding window. A motif is reported when its frequency
>= 3 across the session.

The output is a JSON-serialisable list; each motif carries its stable id
(a 12-hex blake2b hash of the label sequence) plus the list of
occurrences with their step_ids and ISO timestamps. Pure stdlib.
"""
from __future__ import annotations

import hashlib
from typing import Any

MIN_LEN = 3
MAX_LEN = 8
MIN_FREQ = 3


def _stable_id(labels: list[str]) -> str:
    """12-hex stable hash of a label sequence. Joining with U+001F (the unit
    separator) keeps the hash injective against labels that themselves contain
    spaces or hyphens."""
    joined = "\x1f".join(labels)
    return hashlib.blake2b(joined.encode("utf-8"), digest_size=6).hexdigest()


def _per_case_step_lists(steps: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Group steps by case_id and sort each case's steps by `time_range.start`.
    Steps without a process_label are skipped (no signal for motif mining).
    Returns ordered lists ready to slice into symbol windows."""
    by_case: dict[str, list[dict[str, Any]]] = {}
    for s in steps or []:
        label = (s.get("process_label") or "").strip()
        if not label:
            continue
        cid = s.get("case_id") or "__nocase__"
        by_case.setdefault(cid, []).append(s)
    for cid in by_case:
        by_case[cid].sort(key=lambda s: ((s.get("time_range") or {}).get("start") or ""))
    return by_case


def find_motifs(
    steps: list[dict[str, Any]],
    *,
    min_len: int = MIN_LEN,
    max_len: int = MAX_LEN,
    min_freq: int = MIN_FREQ,
) -> list[dict[str, Any]]:
    """Discover repeated step-label subsequences of length [min_len, max_len]
    that appear at least `min_freq` times across the session.

    Sliding-window counting across the per-case label streams: for each window
    length L, every contiguous L-step slice is keyed by its label tuple and
    its occurrence (case + step_ids + start/end ISO) is recorded. Motifs whose
    occurrence count meets the threshold are returned, sorted by descending
    frequency then by motif_id for stability.
    """
    if not steps:
        return []
    by_case = _per_case_step_lists(steps)

    # Map: tuple-of-labels -> list of occurrence dicts.
    seen: dict[tuple[str, ...], list[dict[str, Any]]] = {}
    for cid, case_steps in by_case.items():
        labels = [(s.get("process_label") or "").strip() for s in case_steps]
        n = len(labels)
        for L in range(min_len, max_len + 1):
            if L > n:
                break
            for i in range(n - L + 1):
                window = tuple(labels[i:i + L])
                window_steps = case_steps[i:i + L]
                occ = {
                    "case_id": cid,
                    "step_ids": [
                        s.get("step_id") for s in window_steps if s.get("step_id")
                    ],
                    "start_ts": (
                        (window_steps[0].get("time_range") or {}).get("start") or ""
                    ),
                    "end_ts": (
                        (window_steps[-1].get("time_range") or {}).get("end") or ""
                    ),
                }
                seen.setdefault(window, []).append(occ)

    motifs: list[dict[str, Any]] = []
    for window, occurrences in seen.items():
        if len(occurrences) < min_freq:
            continue
        labels_list = list(window)
        motifs.append({
            "motif_id": _stable_id(labels_list),
            "labels": labels_list,
            "occurrences": occurrences,
            "frequency": len(occurrences),
        })
    motifs.sort(key=lambda m: (-m["frequency"], m["motif_id"]))
    return motifs


def _is_contiguous_sub(short: list[str], long: list[str]) -> bool:
    n, m = len(short), len(long)
    if n >= m:
        return False
    return any(long[i:i + n] == short for i in range(m - n + 1))


def maximal_motifs(motifs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop motifs contained in a longer motif of >= frequency (Phase A).

    The sliding window counts every overlapping sub-window, so one
    repeated 6-step sequence yields a pile of length-3..5 shadows -- an
    honest count of *distinct* repeated sequences keeps only the maximal
    ones. The full list (with shadows) stays available from find_motifs
    for drill-down; this filter feeds the `repeated_sequence_count` fact.
    """
    out = []
    for m in motifs or []:
        contained = any(
            other is not m
            and other.get("frequency", 0) >= m.get("frequency", 0)
            and _is_contiguous_sub(m.get("labels") or [], other.get("labels") or [])
            for other in motifs
        )
        if not contained:
            out.append(m)
    return out


def find_bounces(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Detect A->B->A bounces in the per-case step-label streams (Phase A
    addition for the `backtracking` findings detector).

    A bounce is three consecutive steps labelled A, B, A with A != B --
    the flow left a screen/action and came straight back. Bounces are
    grouped by the (A, B) label pair; each group carries every occurrence
    (case + step_ids + timestamps) so the viewer can jump to the evidence.
    Sorted by descending count then bounce_id for stability.
    """
    if not steps:
        return []
    by_case = _per_case_step_lists(steps)

    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for cid, case_steps in by_case.items():
        labels = [(s.get("process_label") or "").strip() for s in case_steps]
        for i in range(len(labels) - 2):
            a, b, a2 = labels[i], labels[i + 1], labels[i + 2]
            if a != a2 or a == b:
                continue
            window_steps = case_steps[i:i + 3]
            occ = {
                "case_id": cid,
                "step_ids": [
                    s.get("step_id") for s in window_steps if s.get("step_id")
                ],
                "start_ts": (
                    (window_steps[0].get("time_range") or {}).get("start") or ""
                ),
                "end_ts": (
                    (window_steps[-1].get("time_range") or {}).get("end") or ""
                ),
            }
            groups.setdefault((a, b), []).append(occ)

    bounces: list[dict[str, Any]] = []
    for (a, b), occurrences in groups.items():
        bounces.append({
            "bounce_id": _stable_id([a, b, a]),
            "labels": [a, b, a],
            "returned_to": a,
            "via": b,
            "occurrences": occurrences,
            "count": len(occurrences),
        })
    bounces.sort(key=lambda x: (-x["count"], x["bounce_id"]))
    return bounces
