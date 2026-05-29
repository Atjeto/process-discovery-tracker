"""Suggested markers -- change-point detection for unbracketed sessions.

A worker recording a long passive process often forgets to fire Start/End
markers. Without markers, `assign_case_ids` produces one big default case
and every downstream artifact collapses against it. This module detects
candidate case boundaries from the event stream and surfaces them as
suggestions the analyst accepts or dismisses.

Hand-rolled detector, pandas + stdlib only (no `ruptures`, no `scipy`,
no `sklearn`). Operates only on uncased stretches -- runs of activity /
interaction events that fall outside every open marker case. Four
signals scored per row in those stretches:

  1. idle_gap        (0.0..0.4)  -- long pause to previous activity
  2. home_app_return (0.0..0.4)  -- arrive at a recurring "home" app
                                   (dashboard / inbox / queue) from
                                   somewhere else
  3. transaction_id_typed (0.0..0.4) -- a value_changed event typed a
                                   transaction-ID-like value at or just
                                   before this row
  4. app_cluster_boundary (0.0..0.2) -- predecessor and successor apps
                                   are in different Markov clusters

`sum >= 0.5` is a candidate Start; Ends are paired by walking forward to
the next Start's predecessor or the next idle gap. Each suggestion gets
a stable 12-char blake2b `signature` over (marker_type, ts bucketed to
5s, before_app, after_app, reason) so a dismiss survives re-normalize
and an accept (recorded as `marker_edits[].derived_from_signature`)
suppresses re-suggestion of the same boundary.

Guards: never emit inside an excluded_range, inside an existing case
time range, within 5 s of an existing real Start, or for a stretch
shorter than `min_case_interactions` interactions.

See ADR-0017.
"""

from __future__ import annotations

import hashlib
import math
import re
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from _dt import parse_ts_or_none as _parse_ts


# ---------------------------------------------------------------------------
# Tuning constants. Per ADR-0017, calibration on real captures is owner-side;
# the seeded fuzzer proves robustness (never crash, never violate guards),
# not "the right number of suggestions per hour."

_HEURISTIC_VERSION = 1

# Each first-tier signal alone is enough to surface a suggestion -- the
# detector is intentionally generous because the analyst dismiss-set is
# bounded and persistent, so a false-positive dies forever after one
# click. False negatives, conversely, leave the analyst doing manual
# segmentation. The cluster signal is a bonus that nudges close calls
# over the line.
# The idle term is `weight * tanh(gap / idle_gap_ms)`. `tanh` is strictly < 1,
# so the weight must sit ABOVE `_SCORE_THRESHOLD` for a lone long idle gap to
# ever cross it (a weight of exactly 0.5 made the idle-only suggestion
# mathematically unreachable). At a gap == `idle_gap_ms` the ratio is 1.0 and
# tanh(1) ~= 0.762, so 0.7 * 0.762 ~= 0.53 clears the 0.5 gate; a gap of about
# 1.05 * idle_gap_ms is the firing point. Short gaps stay quiet: at 0.25 *
# idle_gap_ms the term is 0.7 * tanh(0.25) ~= 0.17, well under threshold.
_IDLE_SIG_WEIGHT = 0.7
_HOME_APP_WEIGHT = 0.5
_TXNID_WEIGHT = 0.6
_CLUSTER_WEIGHT = 0.2

_SCORE_THRESHOLD = 0.5
_START_RATE_LIMIT_MS = 30_000     # no two Starts within this window
_TS_BUCKET_S = 5                  # signature bucket -- absorbs detector drift
_NEAR_REAL_START_MS = 5_000       # suppress within this window of a real Start

_TXNID_PATTERNS = [
    re.compile(r"^[A-Z]{2,5}-?\d{3,8}$"),
    re.compile(r"^\d{6,12}$"),
]

# Cluster edge: a transition from `a` is "in-cluster" if its weight >=
# this fraction of `a`'s total outbound transitions.
_CLUSTER_EDGE_FRAC = 0.2


# ---------------------------------------------------------------------------
# Helpers

def _ev_ts(ev: dict) -> datetime | None:
    return _parse_ts(ev.get("timestamp"))


def _ev_data(ev: dict) -> dict:
    d = ev.get("data")
    return d if isinstance(d, dict) else {}


def _ev_app(ev: dict) -> str:
    """Stable app key for clustering: process_name lowercased, else
    a window-title fallback. Matches the shape `analysis_segments`
    uses so signals line up across the pipeline."""
    d = _ev_data(ev)
    p = (d.get("process_name") or "").strip().lower()
    if p:
        return p
    return (d.get("window_title") or "").strip().lower() or "(unknown)"


def _is_uncased(ev: dict) -> bool:
    """An event is in an uncased stretch when it has no case_ids stamped
    on it. Markers are skipped (they are case boundaries themselves).
    Activity and interaction events both count."""
    if ev.get("type") not in ("activity", "interaction"):
        return False
    cids = _ev_data(ev).get("case_ids") or []
    return not cids


def _txnid_value(ev: dict) -> str | None:
    """Return the typed value if this is a value_changed/text_changed
    event AND the value matches a transaction-ID-like pattern; else
    None."""
    d = _ev_data(ev)
    if d.get("kind") not in ("value_changed", "text_changed"):
        return None
    val = d.get("value")
    if not isinstance(val, str):
        return None
    val = val.strip()
    if not val:
        return None
    for rx in _TXNID_PATTERNS:
        if rx.match(val):
            return val
    return None


def _excluded(ts: datetime, ranges: list[tuple[datetime, datetime]]) -> bool:
    return any(a <= ts <= b for a, b in ranges)


def _parse_excluded_ranges(
    raw: list[dict] | None,
) -> list[tuple[datetime, datetime]]:
    out: list[tuple[datetime, datetime]] = []
    for r in raw or []:
        if not isinstance(r, dict):
            continue
        a, b = _parse_ts(r.get("start")), _parse_ts(r.get("end"))
        if a is None or b is None or b < a:
            continue
        out.append((a, b))
    return out


def _existing_case_ranges(
    existing_cases: dict | None,
) -> list[tuple[datetime, datetime]]:
    """A list of (start, end) tuples covering each existing case. A
    candidate marker landing inside any of these is suppressed."""
    out: list[tuple[datetime, datetime]] = []
    for c in (existing_cases or {}).values():
        if not isinstance(c, dict):
            continue
        a, b = _parse_ts(c.get("start_ts")), _parse_ts(c.get("end_ts"))
        if a is None:
            continue
        if b is None:
            # Open case -- extend to far future so we never suggest inside.
            b = datetime(9999, 1, 1, tzinfo=timezone.utc)
        if b < a:
            a, b = b, a
        out.append((a, b))
    return out


def _real_start_times(events: list[dict]) -> list[datetime]:
    """Timestamps of every real Start marker (captured or synthetic
    op:insert) in the stream. Used to suppress suggestions within
    _NEAR_REAL_START_MS of one."""
    out: list[datetime] = []
    for ev in events:
        if ev.get("type") != "marker":
            continue
        if _ev_data(ev).get("marker_type") != "start":
            continue
        ts = _ev_ts(ev)
        if ts is not None:
            out.append(ts)
    return out


def _near_real_start(ts: datetime, real_starts: list[datetime]) -> bool:
    return any(
        abs((ts - rs).total_seconds() * 1000) <= _NEAR_REAL_START_MS
        for rs in real_starts
    )


def _ts_bucket(ts: datetime) -> int:
    return int(ts.timestamp() // _TS_BUCKET_S)


def signature(
    marker_type: str,
    ts: datetime,
    before_app: str,
    after_app: str,
    reason: str,
) -> str:
    """Stable 12-char identity over the canonical tuple, used to key
    dismissals and to detect "this op:insert was promoted from
    suggestion X" via `derived_from_signature`."""
    raw = "\x1f".join([
        str(marker_type or ""),
        str(_ts_bucket(ts)),
        (before_app or "").lower(),
        (after_app or "").lower(),
        reason or "",
    ])
    return hashlib.blake2b(raw.encode("utf-8"), digest_size=6).hexdigest()


def signature_from_op_insert(edit: dict, *, default_reason: str = "") -> str | None:
    """Recompute the signature for a `marker_edits[]` op:insert entry, so
    a re-detection that lands on the same boundary recognizes it.
    Returns None if the entry is missing fields the signature needs.

    Note: an op:insert has no `before_app` / `after_app` / `reason` --
    those are detector-specific. The viewer writes `derived_from_signature`
    onto the op:insert at Accept time, which is the trusted match; this
    helper is a fallback for legacy entries without that field.
    """
    ts = _parse_ts(edit.get("timestamp"))
    if ts is None:
        return None
    mt = edit.get("marker_type") or "start"
    return signature(mt, ts, "", "", default_reason)


# ---------------------------------------------------------------------------
# App clustering -- hand-rolled Union-Find over the Markov adjacency graph.

class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def add(self, x: str) -> None:
        if x not in self.parent:
            self.parent[x] = x

    def find(self, x: str) -> str:
        self.add(x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def _app_clusters(rows: list[dict]) -> dict[str, str]:
    """Compute a {app -> cluster_id} mapping from the Markov adjacency
    over a list of feature rows. An edge (a -> b) is in-cluster iff
    its weight >= _CLUSTER_EDGE_FRAC of a's outbound mass. Apps not
    seen are absent from the result.
    """
    out: dict[str, Counter] = defaultdict(Counter)
    for prev, cur in zip(rows, rows[1:]):
        a, b = prev["app"], cur["app"]
        if not a or not b or a == b:
            continue
        out[a][b] += 1
    uf = _UnionFind()
    for a, dests in out.items():
        uf.add(a)
        total = sum(dests.values()) or 1
        for b, w in dests.items():
            uf.add(b)
            if w / total >= _CLUSTER_EDGE_FRAC:
                uf.union(a, b)
    return {x: uf.find(x) for x in uf.parent}


def _home_apps(rows: list[dict]) -> set[str]:
    """The "home" app(s) the worker returns to between cases -- the
    dashboard / inbox / queue. The single most common app, gated at
    >= 40% appearance share so a small / balanced multi-app stream
    (no clear dashboard) yields an empty set and the signal doesn't
    fire. A second app is added when it ALSO hits 40% (rare -- only
    when work alternates between two equally-dominant tools)."""
    if not rows:
        return set()
    counts: Counter[str] = Counter(r["app"] for r in rows if r["app"])
    if not counts:
        return set()
    total = sum(counts.values())
    out: set[str] = set()
    for app, c in counts.most_common(2):
        if c / total >= 0.40:
            out.add(app)
    return out


# ---------------------------------------------------------------------------
# Public entry point

def suggest_markers(
    events: list[dict],
    existing_cases: dict | None = None,
    *,
    excluded_ranges: list[dict] | None = None,
    idle_gap_ms: int = 60_000,
    min_case_interactions: int = 5,
    heuristic_version: int = _HEURISTIC_VERSION,
) -> list[dict]:
    """Return a list of candidate Start/End markers in the order they
    occur in the session.

    The detector ignores any event already attributed to an existing
    case (`data.case_ids` non-empty), so it never re-segments cleanly
    bracketed work. Suggestions inside an excluded_range, inside an
    existing case, or within `_NEAR_REAL_START_MS` of a real Start
    are dropped. A proposed case shorter than `min_case_interactions`
    interactions is dropped.

    Output dict shape (see SCHEMA.md):

        {
          "suggestion_id": "uuid",
          "signature": "12-hex-chars",
          "marker_type": "start" | "end",
          "timestamp": "ISO 8601",
          "label": str | None,
          "score": float,
          "reason": "idle_gap" | "home_app_return"
                  | "transaction_id_typed" | "app_cluster_boundary",
          "evidence": {
            "near_event_ids": [...],
            "before_app": str,
            "after_app": str,
            "idle_ms_before": int,
          },
          "created_at": "ISO 8601",
          "heuristic_version": int
        }
    """
    excluded = _parse_excluded_ranges(excluded_ranges)
    case_ranges = _existing_case_ranges(existing_cases)
    real_starts = _real_start_times(events)

    # Order events; the boundary checks rely on a stable ordering. A
    # corrupt timestamp degrades to epoch, which sorts to the front.
    ordered: list[dict] = sorted(
        (e for e in events if e.get("type") in ("activity", "interaction", "marker")),
        key=lambda e: (_parse_ts(e.get("timestamp")) or datetime(1970, 1, 1, tzinfo=timezone.utc),
                       e.get("_seq") or 0),
    )

    # Build per-row features for the UNCASED slice. Each row carries the
    # event id, ts, app, idle-gap-to-prev, nearest txn-id-like value.
    rows: list[dict] = []
    prev_ts: datetime | None = None
    for ev in ordered:
        if ev.get("type") == "marker":
            # A marker resets the idle-gap baseline -- a real marker
            # signals a case boundary the analyst already gave us.
            prev_ts = _ev_ts(ev) or prev_ts
            continue
        if not _is_uncased(ev):
            prev_ts = _ev_ts(ev) or prev_ts
            continue
        ts = _ev_ts(ev)
        if ts is None:
            continue
        gap_ms = 0
        if prev_ts is not None:
            gap_ms = max(0, int((ts - prev_ts).total_seconds() * 1000))
        rows.append({
            "ev": ev,
            "event_id": ev.get("event_id"),
            "ts": ts,
            "app": _ev_app(ev),
            "idle_ms_before": gap_ms,
            "txnid": _txnid_value(ev),
        })
        prev_ts = ts

    if not rows:
        return []

    home_apps = _home_apps(rows)
    clusters = _app_clusters(rows)

    # Score each row as a candidate Start.
    candidates: list[dict] = []
    last_start_ts: datetime | None = None
    for i, r in enumerate(rows):
        score = 0.0
        reason = ""
        before_app = rows[i - 1]["app"] if i > 0 else ""
        after_app = r["app"]

        idle_sig = _IDLE_SIG_WEIGHT * math.tanh(r["idle_ms_before"] / max(idle_gap_ms, 1))
        if idle_sig > 0:
            score += idle_sig
            reason = "idle_gap"

        if before_app and after_app and home_apps and (
                after_app in home_apps and before_app not in home_apps):
            score += _HOME_APP_WEIGHT
            reason = "home_app_return"

        if r["txnid"]:
            score += _TXNID_WEIGHT
            reason = "transaction_id_typed"

        if (before_app and after_app and before_app != after_app
                and clusters.get(before_app) and clusters.get(after_app)
                and clusters[before_app] != clusters[after_app]):
            score += _CLUSTER_WEIGHT
            if not reason:
                reason = "app_cluster_boundary"

        if score < _SCORE_THRESHOLD:
            continue
        # Rate-limit Starts.
        if last_start_ts is not None:
            if (r["ts"] - last_start_ts).total_seconds() * 1000 < _START_RATE_LIMIT_MS:
                continue

        score = min(score, 1.0)
        # Guards.
        if _excluded(r["ts"], excluded):
            continue
        if any(a <= r["ts"] <= b for a, b in case_ranges):
            continue
        if _near_real_start(r["ts"], real_starts):
            continue

        label = r["txnid"] if reason == "transaction_id_typed" else None
        candidates.append({
            "row_index": i,
            "ts": r["ts"],
            "before_app": before_app,
            "after_app": after_app,
            "idle_ms_before": r["idle_ms_before"],
            "score": round(score, 3),
            "reason": reason or "idle_gap",
            "label": label,
            "near_event_id": r["event_id"],
        })
        last_start_ts = r["ts"]

    # Pair each Start with an End:
    #   end_ts = min(next Start's preceding row's ts, last row before
    #                an idle gap > idle_gap_ms within this stretch)
    suggestions: list[dict] = []
    for n, cand in enumerate(candidates):
        start_row = cand["row_index"]
        # Default end: last row in `rows`.
        end_row = len(rows) - 1
        # Truncate at next Start's predecessor.
        if n + 1 < len(candidates):
            nxt = candidates[n + 1]["row_index"]
            if nxt - 1 >= start_row:
                end_row = nxt - 1
        # Truncate further at the first big idle gap inside this slice.
        for j in range(start_row + 1, end_row + 1):
            if rows[j]["idle_ms_before"] > idle_gap_ms:
                end_row = j - 1
                break
        # Drop slivers.
        interactions_in = end_row - start_row + 1
        if interactions_in < min_case_interactions:
            continue

        end_ts = rows[end_row]["ts"]
        # An End must clear the excluded-range and existing-case guards
        # -- if it doesn't, drop the whole pair so accepting the Start
        # never leaves a dangling open case. The "within 5 s of a real
        # Start" rule does NOT apply to Ends: an End landing right
        # before a real Start is a clean case-to-case handoff (this
        # suggested case closes; the next real case opens), not a
        # duplicate.
        if _excluded(end_ts, excluded):
            continue
        if any(a <= end_ts <= b for a, b in case_ranges):
            continue

        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        sig_s = signature("start", cand["ts"], cand["before_app"], cand["after_app"], cand["reason"])
        sig_e = signature("end", end_ts, cand["after_app"], "", cand["reason"])
        evidence = {
            "near_event_ids": [
                rows[start_row]["event_id"],
                rows[end_row]["event_id"],
            ],
            "before_app": cand["before_app"],
            "after_app": cand["after_app"],
            "idle_ms_before": cand["idle_ms_before"],
        }
        suggestions.append({
            "suggestion_id": str(uuid.uuid4()),
            "signature": sig_s,
            "marker_type": "start",
            "timestamp": cand["ts"].isoformat().replace("+00:00", "Z"),
            "label": cand["label"],
            "score": cand["score"],
            "reason": cand["reason"],
            "evidence": evidence,
            "created_at": now,
            "heuristic_version": heuristic_version,
        })
        suggestions.append({
            "suggestion_id": str(uuid.uuid4()),
            "signature": sig_e,
            "marker_type": "end",
            "timestamp": end_ts.isoformat().replace("+00:00", "Z"),
            "label": None,
            "score": cand["score"],
            "reason": cand["reason"],
            "evidence": {
                "near_event_ids": [rows[end_row]["event_id"]],
                "before_app": cand["after_app"],
                "after_app": "",
                "idle_ms_before": rows[end_row]["idle_ms_before"],
            },
            "created_at": now,
            "heuristic_version": heuristic_version,
        })

    return suggestions


# ---------------------------------------------------------------------------
# Re-normalization merge (mirrors step_suggest._merge_steps)

def _accepted_signatures(marker_edits: list[dict]) -> set[str]:
    """Collect every `derived_from_signature` value from op:insert
    entries in `marker_edits[]`. These are the signatures the analyst
    already promoted to real markers; the detector must not re-surface
    them."""
    out: set[str] = set()
    for e in marker_edits or []:
        if not isinstance(e, dict):
            continue
        if e.get("op") != "insert":
            continue
        sig = e.get("derived_from_signature")
        if isinstance(sig, str) and sig:
            out.add(sig)
    return out


def merge_marker_suggestions(
    existing: list[dict],
    fresh: list[dict],
    *,
    dismissed: list[dict] | None = None,
    accepted_edits: list[dict] | None = None,
) -> list[dict]:
    """Non-destructive merge: regenerate suggestions from this run,
    drop any whose signature appears in `dismissed[]` or in an accepted
    op:insert's `derived_from_signature`.

    Existing suggestions are TOSSED wholesale -- they are auto-derived
    each run; the analyst owns the dismiss-list and the accepted-edits,
    both of which DO survive. Mirrors how `step_suggest._merge_steps`
    treats `auto_suggested`. `existing` is accepted in the signature
    only for symmetry with the other merges; it is intentionally not
    consulted beyond a no-op pass-through used by the fuzzer.
    """
    drop: set[str] = set()
    for d in dismissed or []:
        if isinstance(d, dict):
            sig = d.get("signature")
            if isinstance(sig, str) and sig:
                drop.add(sig)
    drop |= _accepted_signatures(accepted_edits or [])

    seen: set[str] = set()
    out: list[dict] = []
    for s in fresh or []:
        if not isinstance(s, dict):
            continue
        sig = s.get("signature")
        if not isinstance(sig, str) or not sig:
            continue
        if sig in drop or sig in seen:
            continue
        seen.add(sig)
        out.append(s)
    return out
