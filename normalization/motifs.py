"""Sequence motif discovery on the step stream.

Ported as-is from the parked ML branch (`project-vision-ai-ml:
normalization/patterns/motif_mining.py`, ADR-0029 there) per the
lab-phase spec (LAB-PHASE-SPEC.md §A3) -- it is pure stdlib and feeds
the `backtracking` / `repetition` findings detectors plus the
`repeated_sequence_count` fact. Phase A adds `find_bounces` (A->B->A
returns), which the original module did not have.

For each case, the case's step sequence is treated as a string of symbols
and repeated subsequences of length 3-8 are counted via a simple sliding
window. A motif is reported when its frequency >= 3 across the session.

A step's symbol is its identity (step_suggest.step_identity: the draft_key,
a merged step's draft_keys, else the label of a step added by hand), not its
name, so a repeat counts the same whether the analyst renamed the steps or
not (F1). The step names ride along for display (`labels`).

The output is a JSON-serialisable list; each motif carries its stable id
(a 12-hex blake2b hash of the identity sequence) plus the list of
occurrences with their step_ids and ISO timestamps. Pure stdlib.
"""
from __future__ import annotations

import hashlib
from typing import Any

from step_context import untimed_key
from step_suggest import step_identity

MIN_LEN = 3
MAX_LEN = 8
MIN_FREQ = 3


def _stable_id(labels: list[str]) -> str:
    """12-hex stable hash of a label sequence. Joining with U+001F (the unit
    separator) keeps the hash injective against labels that themselves contain
    spaces or hyphens."""
    joined = "\x1f".join(labels)
    return hashlib.blake2b(joined.encode("utf-8"), digest_size=6).hexdigest()


def _label(step: dict[str, Any]) -> str:
    """The step's display label: its process_label, else its name."""
    return (step.get("process_label") or step.get("name") or "").strip()


def _symbol(step: dict[str, Any]) -> str:
    """The step's symbol: its identity; "" for a step with no draft identity
    and no label (no signal for motif mining)."""
    key = step_identity(step)
    return "" if key == "label:" else key


def _order(step: dict[str, Any]) -> tuple:
    """A step's place in its case: by `time_range.start`, then the steps
    without a time by their `order` (contract C16)."""
    start = (step.get("time_range") or {}).get("start") or ""
    return (0, start) if start else untimed_key(step)


def _per_case_step_lists(steps: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Group steps by case_id and sort each case's steps by `time_range.start`,
    the steps without a time after them by their `order` (C16).
    Steps without a symbol are skipped (no signal for motif mining).
    Returns ordered lists ready to slice into symbol windows."""
    by_case: dict[str, list[dict[str, Any]]] = {}
    for s in steps or []:
        if not isinstance(s, dict) or not _symbol(s):
            continue
        cid = s.get("case_id") or "__nocase__"
        by_case.setdefault(cid, []).append(s)
    for cid in by_case:
        by_case[cid].sort(key=_order)
    return by_case


def find_motifs(
    steps: list[dict[str, Any]],
    *,
    min_len: int = MIN_LEN,
    max_len: int = MAX_LEN,
    min_freq: int = MIN_FREQ,
) -> list[dict[str, Any]]:
    """Discover repeated step subsequences of length [min_len, max_len]
    that appear at least `min_freq` times across the session.

    Sliding-window counting across the per-case symbol streams: for each
    window length L, every contiguous L-step slice is keyed by its identity
    tuple and its occurrence (case + step_ids + start/end ISO) is recorded.
    Motifs whose occurrence count meets the threshold are returned, sorted by
    descending frequency then by motif_id for stability. `keys` is the
    identity sequence, `labels` the first occurrence's step labels.
    """
    if not steps:
        return []
    by_case = _per_case_step_lists(steps)

    # Map: tuple of symbols -> list of occurrence dicts.
    seen: dict[tuple[str, ...], list[dict[str, Any]]] = {}
    shown: dict[tuple[str, ...], list[str]] = {}
    for cid, case_steps in by_case.items():
        symbols = [_symbol(s) for s in case_steps]
        n = len(symbols)
        for L in range(min_len, max_len + 1):
            if L > n:
                break
            for i in range(n - L + 1):
                window = tuple(symbols[i:i + L])
                shown.setdefault(window, [_label(s) for s in case_steps[i:i + L]])
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
        motifs.append({
            "motif_id": _stable_id(list(window)),
            "keys": list(window),
            "labels": shown[window],
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
    def seq(m):
        return m.get("keys") or m.get("labels") or []

    out = []
    for m in motifs or []:
        contained = any(
            other is not m
            and other.get("frequency", 0) >= m.get("frequency", 0)
            and _is_contiguous_sub(seq(m), seq(other))
            for other in motifs
        )
        if not contained:
            out.append(m)
    return out


def find_bounces(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Detect A->B->A bounces in the per-case step streams (Phase A
    addition for the `backtracking` findings detector).

    A bounce is three consecutive steps A, B, A (by identity) with A != B:
    the flow left a screen/action and came straight back. Bounces are
    grouped by the (A, B) identity pair and named by the first occurrence's
    step labels; each group carries every occurrence (case + step_ids +
    timestamps) so the viewer can jump to the evidence. Sorted by descending
    count then bounce_id for stability.
    """
    if not steps:
        return []
    by_case = _per_case_step_lists(steps)

    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    names: dict[tuple[str, str], tuple[str, str]] = {}
    for cid, case_steps in by_case.items():
        symbols = [_symbol(s) for s in case_steps]
        for i in range(len(symbols) - 2):
            a, b, a2 = symbols[i], symbols[i + 1], symbols[i + 2]
            if a != a2 or a == b:
                continue
            window_steps = case_steps[i:i + 3]
            names.setdefault((a, b), (_label(window_steps[0]), _label(window_steps[1])))
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
        la, lb = names[(a, b)]
        bounces.append({
            "bounce_id": _stable_id([a, b, a]),
            "labels": [la, lb, la],
            "returned_to": la,
            "via": lb,
            "occurrences": occurrences,
            "count": len(occurrences),
        })
    bounces.sort(key=lambda x: (-x["count"], x["bounce_id"]))
    return bounces
