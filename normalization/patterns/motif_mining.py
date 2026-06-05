"""Sequence motif discovery on the step `process_label` stream (ADR-0029).

For each case, the case's step `process_label` sequence is treated as a string
of symbols and repeated subsequences of length 3-8 are counted via a simple
sliding window. A motif is reported when its frequency >= 3 across the session.

The output is a JSON-serialisable list; each motif carries its stable id (a
12-hex blake2b hash of the label sequence) plus the list of occurrences with
their step_ids and ISO timestamps. Pure stdlib.
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
