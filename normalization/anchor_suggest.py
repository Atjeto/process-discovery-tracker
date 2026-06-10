"""Anchor-candidate detection -- pattern-mine value_changed events to
find fields that look like case anchors for unbracketed sessions
(ADR-0018).

The recurring failure mode: a worker captures a long passive process
without firing markers, AND there's no Process Template configured yet
(it's a discovery session). `assign_case_ids` produces one big default
case and downstream analysis collapses. The companion feature
(ADR-0017, marker_suggest) tackles this by suggesting Start/End
markers; this module tackles it from the other direction by
identifying the FIELD whose typing names each case.

Approach: for every distinct (field-property, field-value) pair the
session typed into (e.g. (`automation_id`, "customer-id-field")),
**simulate** what `detect_cases_from_anchors` would produce if that
field were the anchor. Score the resulting case structure by case
count, balance, coverage, and label diversity; rank; return the top
N candidates with stable signatures.

The analyst clicks Accept to write a session-level
`case_anchor_override` into annotations.json -- the next normalize
run picks it up and stamps cases by the chosen anchor. Dismiss writes
the signature to `anchor_candidates_dismissed[]` so the next
re-normalize never re-suggests it.

Hand-rolled, no new dependencies beyond what normalization already
ships (stdlib + the existing `case_assignment` machinery this module
calls into).
"""

from __future__ import annotations

import hashlib
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from _dt import parse_ts_or_none as _parse_ts


# ---------------------------------------------------------------------------
# Tuning constants. Calibration on real captures is owner-side; the
# fuzzer proves robustness (never crash, valid anchor_config produced,
# guards respected), not "the right number of candidates."

_HEURISTIC_VERSION = 1

# A field is a candidate only if it fires at least this many times in
# the uncased stretch. Fewer than two fires can't split anything into
# meaningful cases.
_MIN_FIRES = 2

# A candidate's anchor_config must produce at least this many real
# cases (after the case-assignment degenerate-case guard) to score.
_MIN_CASES = 2

# Top-N candidates returned (UI surface only shows the strongest).
_TOP_N = 5

# Score components (each in [0, 1]); weights sum to 1.0.
_W_COVERAGE = 0.40    # fraction of interactions the anchor catches
_W_BALANCE = 0.30     # 1 - coefficient of variation of case sizes
_W_DIVERSITY = 0.20   # distinct labels / fire count
_W_FOCUS = 0.10       # 1 / log2(case_count + 1) -- prefer a "right-sized" handful

# Lab-phase C1: a field whose vocab entry declares `case_id_source: true`
# gets a small additive bonus (clamped to 1.0). A BONUS, never a gate --
# the candidate still has to clear _MIN_FIRES/_MIN_CASES and out-score the
# field evidence on its own; the vocab just breaks ties toward the field
# the app vocabulary says names the case.
_VOCAB_CASE_ID_BONUS = 0.08


# ---------------------------------------------------------------------------
# Helpers

def _interaction_data(ev: dict) -> dict:
    d = ev.get("data")
    return d if isinstance(d, dict) else {}


def _typed_value(ev: dict) -> str:
    """The non-empty stripped value typed in this interaction, or empty
    string if there's no value (a focus/click, an empty edit box)."""
    d = _interaction_data(ev)
    if d.get("kind") not in ("value_changed", "text_changed"):
        return ""
    val = d.get("value")
    if not isinstance(val, str):
        return ""
    return val.strip()


def _field_identity(data: dict) -> tuple[str, str, str] | None:
    """A stable (property, value, window_title) triple identifying a UIA
    field across multiple typings into it. Prefers `automation_id` (the
    most stable identifier across recapture); falls back to `name`; returns
    None when neither is available.

    The window_title is kept on the triple so a "Customer ID" field in
    Salesforce doesn't collide with a "Customer ID" field in SAP."""
    aid = (data.get("automation_id") or "").strip()
    name = (data.get("name") or "").strip()
    wt = (data.get("window_title") or "").strip()
    if aid:
        return ("automation_id", aid, wt)
    if name:
        return ("name", name, wt)
    return None


def _build_anchor_config(field_identity: tuple[str, str, str]) -> dict:
    """The `case_anchor` block shape `detect_cases_from_anchors` expects.
    The window_title hint is NOT placed into the config -- it's a display
    aid only -- because the existing anchor matcher doesn't filter by
    window. Adding it would force a `window_title_regex` in the template
    and tangle the matcher; keep the anchor identity to the field rule."""
    prop, val, _wt = field_identity
    return {
        "field": prop,
        "equals": val,
        "case_label_from": "value",
    }


def _coefficient_of_variation(values: list[float]) -> float:
    """Standard deviation / mean. Returns 0.0 for an empty or
    single-element list (no variation to measure)."""
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    if mean <= 0:
        return 0.0
    var = sum((v - mean) ** 2 for v in values) / len(values)
    return (var ** 0.5) / mean


def _score(metrics: dict) -> float:
    """Weighted blend of the four signals, each clamped to [0, 1].

    - coverage: fraction of interactions the anchor catches.
    - balance: 1 - CV(case sizes); a stable / repetitive process scores high.
    - diversity: distinct labels / fire count; a real case-key has a
      fresh value per case, not a repeated one.
    - focus: 1 / log2(case_count + 1); rewards a "right-sized" handful
      of cases (2-10) over hundreds.
    """
    import math
    coverage = max(0.0, min(1.0, metrics["coverage"]))
    balance = max(0.0, min(1.0, 1.0 - metrics["case_size_cv"]))
    fire_count = max(1, metrics["fire_count"])
    diversity = max(0.0, min(1.0, metrics["distinct_labels"] / fire_count))
    case_count = max(1, metrics["case_count"])
    focus = 1.0 / math.log2(case_count + 1)
    return round(
        _W_COVERAGE * coverage
        + _W_BALANCE * balance
        + _W_DIVERSITY * diversity
        + _W_FOCUS * focus,
        3,
    )


def _signature(field_identity: tuple[str, str, str]) -> str:
    """12-char blake2b over the field identity. Stable across re-runs;
    matches the dismiss-set lookup and the `_accepted_signature` link
    on `case_anchor_override`."""
    prop, val, wt = field_identity
    raw = "\x1f".join([prop or "", val or "", (wt or "").lower()])
    return hashlib.blake2b(raw.encode("utf-8"), digest_size=6).hexdigest()


def signature_of_anchor_config(cfg: dict, window_title: str = "") -> str | None:
    """Recompute a candidate's signature from its anchor_config shape, so
    the merge can match a candidate against `case_anchor_override` and
    drop the now-accepted candidate from the live list. Returns None for
    a config the detector wouldn't have produced (e.g. uses `matches`
    instead of `equals`)."""
    if not isinstance(cfg, dict):
        return None
    prop = cfg.get("field")
    val = cfg.get("equals")
    if not isinstance(prop, str) or not isinstance(val, str):
        return None
    return _signature((prop, val, window_title or ""))


# ---------------------------------------------------------------------------
# Public entry point

def suggest_anchors(
    events: list[dict[str, Any]],
    *,
    heuristic_version: int = _HEURISTIC_VERSION,
    top_n: int = _TOP_N,
) -> list[dict[str, Any]]:
    """Return the top-N anchor-candidate suggestions for this session.

    Each candidate carries everything the viewer needs to render an
    Accept / Dismiss row AND everything `case_assignment` needs if the
    analyst Accepts (the full `anchor_config` block).

    Output shape (see SCHEMA.md):

        {
          "candidate_id": "uuid",
          "signature": "12-hex",
          "anchor_config": { "field": ..., "equals": ..., "case_label_from": "value" },
          "display": {
            "field_property": "automation_id",
            "field_value": "customer-id-field",
            "window_title_hint": "Order entry",
            "sample_values": ["CUST-11255", "CUST-11256", "CUST-11257"]
          },
          "metrics": {
            "fire_count": 6,
            "distinct_labels": 3,
            "case_count": 3,
            "mean_case_interactions": 28.0,
            "case_size_cv": 0.05,
            "coverage": 0.92
          },
          "score": 0.83,
          "created_at": "ISO",
          "heuristic_version": 1
        }
    """
    # Late-import to avoid a cycle: case_assignment is the canonical
    # consumer of anchor_config, and we re-use its detection here.
    from case_assignment import detect_cases_from_anchors

    interactions: list[dict] = [
        e for e in events if isinstance(e, dict) and e.get("type") == "interaction"
    ]
    total_interactions = len(interactions)
    if total_interactions < _MIN_FIRES:
        return []

    # Group typings by field identity. A typing into a focus/click
    # event (empty value) does NOT count -- the empty fire produces an
    # empty label that detect_cases_from_anchors deliberately skips.
    by_field: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    window_titles: dict[tuple[str, str, str], Counter[str]] = defaultdict(Counter)
    vocab_case_id: set[tuple[str, str, str]] = set()
    for ev in interactions:
        d = _interaction_data(ev)
        val = _typed_value(ev)
        if not val:
            continue
        fid = _field_identity(d)
        if fid is None:
            continue
        by_field[fid].append(val)
        if (d.get("vocab_semantics") or {}).get("case_id_source") is True:
            vocab_case_id.add(fid)
        wt = (d.get("window_title") or "").strip()
        if wt:
            window_titles[fid][wt] += 1

    candidates: list[dict] = []
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    for fid, values in by_field.items():
        if len(values) < _MIN_FIRES:
            continue
        cfg = _build_anchor_config(fid)
        try:
            cases = detect_cases_from_anchors(interactions, cfg)
        except Exception:
            # Defensive: a malformed anchor_cfg the matcher rejects must
            # never crash the detector. Skip and move on.
            continue
        if len(cases) < _MIN_CASES:
            continue

        case_sizes = [c.get("interaction_count", 0) for c in cases]
        cov = sum(case_sizes) / max(total_interactions, 1)
        cv = _coefficient_of_variation([float(x) for x in case_sizes])
        labels = [c.get("label") for c in cases if c.get("label")]
        distinct_labels = len(set(labels))

        metrics = {
            "fire_count": len(values),
            "distinct_labels": distinct_labels,
            "case_count": len(cases),
            "mean_case_interactions": round(
                sum(case_sizes) / len(case_sizes), 2),
            "case_size_cv": round(cv, 3),
            "coverage": round(cov, 3),
        }
        score = _score(metrics)
        if fid in vocab_case_id:
            # C1 consumer: the app vocabulary names this field a case-id
            # source -- nudge it up the ranking, transparently.
            score = round(min(1.0, score + _VOCAB_CASE_ID_BONUS), 3)
            metrics["vocab_case_id_source"] = True
        # Choose the most common window-title as the display hint.
        wt_hint = ""
        if window_titles[fid]:
            wt_hint = window_titles[fid].most_common(1)[0][0]
        prop, val, _wt = fid
        # Sample values: first three distinct ones, in first-seen order.
        sample = []
        seen: set[str] = set()
        for v in values:
            if v in seen:
                continue
            seen.add(v)
            sample.append(v)
            if len(sample) >= 3:
                break
        candidates.append({
            "candidate_id": str(uuid.uuid4()),
            "signature": _signature(fid),
            "anchor_config": cfg,
            "display": {
                "field_property": prop,
                "field_value": val,
                "window_title_hint": wt_hint,
                "sample_values": sample,
            },
            "metrics": metrics,
            "score": score,
            "created_at": now,
            "heuristic_version": heuristic_version,
        })

    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates[:top_n]


# ---------------------------------------------------------------------------
# Re-normalization merge (mirrors marker_suggest.merge_marker_suggestions)

def merge_anchor_candidates(
    existing: list[dict],
    fresh: list[dict],
    *,
    dismissed: list[dict] | None = None,
    case_anchor_override: dict | None = None,
) -> list[dict]:
    """Drop any candidate whose signature was dismissed, or whose
    signature matches the currently-active `case_anchor_override`. The
    accepted-override is suppressed from the live list because the
    analyst already chose it; surfacing it as a suggestion alongside the
    "current anchor" surface would be confusing.

    Existing candidates are tossed wholesale -- same posture as
    marker_suggest: candidates are auto-derived each run, the analyst
    owns the dismiss-list and the override.
    """
    drop: set[str] = set()
    for d in dismissed or []:
        if isinstance(d, dict):
            sig = d.get("signature")
            if isinstance(sig, str) and sig:
                drop.add(sig)
    if isinstance(case_anchor_override, dict):
        ov_sig = case_anchor_override.get("_accepted_signature")
        if isinstance(ov_sig, str) and ov_sig:
            drop.add(ov_sig)

    seen: set[str] = set()
    out: list[dict] = []
    for c in fresh or []:
        if not isinstance(c, dict):
            continue
        sig = c.get("signature")
        if not isinstance(sig, str) or not sig:
            continue
        if sig in drop or sig in seen:
            continue
        seen.add(sig)
        out.append(c)
    return out


# ---------------------------------------------------------------------------
# Override validation (consumed by normalize.py)

def coerce_anchor_override(raw: Any) -> dict | None:
    """Return a clean dict that detect_cases_from_anchors can consume,
    or None for a malformed / absent override. Strips the
    `_accepted_*` audit fields so the override is a pure anchor_cfg
    when passed downstream."""
    if not isinstance(raw, dict):
        return None
    field = raw.get("field")
    recognized = raw.get("recognized")
    if not isinstance(field, str) and not recognized:
        return None
    out = {k: v for k, v in raw.items()
           if not k.startswith("_") and v is not None}
    out.setdefault("case_label_from", "value")
    return out
