"""Volatility-diff signature picker (ADR-0025 — the clever core).

The hard-won lesson of the real-value cycle ([REAL-VALUE-TESTING.md]) is that the
*stable* control signature differs per platform:

  * **idMso** for Office  — ``FileSave`` is a stable, language-independent id.
  * **DOM id** for ServiceNow — ``incident.short_description`` is a stable element id.
  * **the label** for Salesforce Lightning / Zendesk — their ``input-378`` /
    ``downshift-3-input`` automation_ids *regenerate every render*, so a signature
    keyed on the id breaks on the next page load; the accessible label is stable.

A human made that call per app by eyeballing the UIA tree. This module automates
it from a **two-pass window snapshot** (the recorder's ``snapshot`` command, ADR-
0025): walk the window twice across a benign re-render, **join** the controls by a
*stability-independent* key (role + label + ancestry + bounds bucket — never the
candidate id), then mark an ``automation_id`` **volatile** when it either changed
across passes for the same joined control *or* matches a known volatility pattern.
Pick the most-stable identity in the ADR-0023 ladder order, **skipping volatile
fields** — turning the analyst's "which id is real?" guess into a measured fact.

Pure-Python, no pandas / no PyYAML import here, so the ground-truth test runs on a
bare interpreter. See ``app_vocab.bootstrap_from_snapshot`` for the skeleton build
that consumes these picks.
"""

from __future__ import annotations

import re
from typing import Any


# --- Volatility patterns ----------------------------------------------
#
# An automation_id matching any of these is a per-render / per-instance value, not
# a stable handle. Grounded in the committed real-value vocabs:
#   ^input-\d+$              Salesforce Lightning text inputs (input-378)
#   ^view_\d+$               framework-generated view ids
#   ^combobox-(input|button)-\d+$   Salesforce combobox parts (combobox-button-411)
#   ^[a-z]+-\d{2,}$          the general "<word>-<number>" auto-id shape
#   <bare GUID>              a raw UUID used as an id
VOLATILE_AID_PATTERNS = [
    re.compile(r"^input-\d+$"),
    re.compile(r"^view_\d+$"),
    re.compile(r"^combobox-(input|button)-\d+$"),
    re.compile(r"^[a-z]+-\d{2,}$"),
    re.compile(
        r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
        r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    ),
]


def aid_matches_volatility_pattern(aid: str | None) -> bool:
    """True when an automation_id matches a known per-render volatility shape."""
    if not aid:
        return False
    return any(p.match(aid) for p in VOLATILE_AID_PATTERNS)


def is_volatile_aid(aid: str | None, aids_across_passes: list[str | None]) -> bool:
    """An automation_id is volatile if it (a) changed across passes for the same
    joined control, or (b) matches a volatility pattern. Either signal demotes it.
    """
    if not aid:
        return False
    distinct = {a for a in aids_across_passes if a}
    if len(distinct) > 1:
        return True
    return aid_matches_volatility_pattern(aid)


# --- Cross-pass join (stability-independent) --------------------------

def _bounds_bucket(b: Any, grid: int = 25) -> tuple | None:
    """Coarse position bucket so a sub-pixel / minor reflow across the two passes
    still joins to the same control. None when the control has no bounds."""
    if not isinstance(b, dict):
        return None
    try:
        return (
            round(float(b.get("x", 0)) / grid),
            round(float(b.get("y", 0)) / grid),
            round(float(b.get("w", 0)) / grid),
            round(float(b.get("h", 0)) / grid),
        )
    except (TypeError, ValueError):
        return None


def _ancestry_by_order(pass_controls: list[dict]) -> dict[int, tuple]:
    """Reconstruct each control's ancestry (a tuple of ancestor control_types)
    from the DFS-ordered, depth-tagged emission. Pure-decoration controls were
    dropped before emission, but the drop is deterministic across passes, so the
    reconstructed ancestry is consistent between pass 1 and pass 2 — good enough
    as a *stability-independent* join key."""
    stack: list[tuple[int, str | None]] = []  # (depth, control_type)
    out: dict[int, tuple] = {}
    for c in pass_controls:
        d = int(c.get("depth", 0) or 0)
        while stack and stack[-1][0] >= d:
            stack.pop()
        out[id(c)] = tuple(ct for (_, ct) in stack)
        stack.append((d, c.get("control_type")))
    return out


def _join_key(c: dict, ancestry: tuple) -> tuple:
    """The stability-independent identity of a control: role + label + class +
    bounds bucket + ancestry. Deliberately EXCLUDES automation_id — that is the
    candidate we are testing for volatility, so it can't take part in the join."""
    return (
        c.get("role") or c.get("control_type") or "",
        c.get("name") or "",
        c.get("class_name") or "",
        _bounds_bucket(c.get("bounds")),
        ancestry,
    )


def _join_groups(controls: list[dict]) -> list[tuple[tuple, list[dict]]]:
    """Group all snapshot controls (across every pass) by the stability-
    independent key, returning ``(key, group)`` pairs in first-seen order. The
    key's ancestry component (``key[4]``) is the only place the join's
    reconstructed tree context survives, so callers that want it (``pick_all``,
    for the annotator legend) read it from here rather than recomputing."""
    by_pass: dict[int, list[dict]] = {}
    for c in controls:
        by_pass.setdefault(int(c.get("pass", 1) or 1), []).append(c)
    groups: dict[tuple, list[dict]] = {}
    order: list[tuple] = []
    for p in sorted(by_pass):
        anc = _ancestry_by_order(by_pass[p])
        for c in by_pass[p]:
            k = _join_key(c, anc[id(c)])
            if k not in groups:
                groups[k] = []
                order.append(k)
            groups[k].append(c)
    return [(k, groups[k]) for k in order]


def join_passes(controls: list[dict]) -> list[list[dict]]:
    """Group all snapshot controls (across every pass) into joined groups by the
    stability-independent key. Each group is the same logical control seen once
    per pass (size 1 when a control appeared in only one pass). First-seen order
    is preserved so the resulting skeleton mirrors document order."""
    return [group for _key, group in _join_groups(controls)]


# --- Confidence (mirrors UiaSubscriber.ComputeConfidence) -------------

def compute_confidence(identity_source: str, framework: str | None) -> float:
    """The ADR-0023 per-element confidence, recomputed for the *picked* signature
    (a demotion from a volatile automation_id to the label drops it from 0.95 to
    0.70). Mirrors the C# ladder + the remote/terminal cap so a picked signature
    and a captured interaction agree."""
    conf = {
        "automation_id": 0.95,
        "name": 0.70,
        "class_name": 0.40,
        "ocr": 0.25,
    }.get(identity_source, 0.10)
    if framework in ("remote", "terminal"):
        conf = min(conf, 0.30)
    return round(conf, 2)


# --- The picker -------------------------------------------------------

def pick_signature(group: list[dict]) -> dict[str, Any]:
    """Pick the most-stable signature for one joined control group.

    Walks the ADR-0023 ladder — automation_id → name → class_name → label —
    but treats a *volatile* automation_id as absent and falls through to the
    label, exactly as the human did for Salesforce / Zendesk. Returns
    ``{signature, identity_source, confidence, volatile_aids}``; ``signature`` is
    None only for a control with no usable identity at all.
    """
    if not group:
        return {"signature": None, "identity_source": "none",
                "confidence": compute_confidence("none", None), "volatile_aids": []}

    rep = group[0]
    ct = rep.get("control_type")
    name = rep.get("name")
    cls = rep.get("class_name")
    framework = rep.get("framework")
    aids = [g.get("automation_id") for g in group]
    aid = next((a for a in aids if a), None)

    volatile = is_volatile_aid(aid, aids) if aid else False
    volatile_aids = sorted({a for a in aids if a}) if volatile else []

    # Rung 1: a stable automation_id wins (Office idMso, ServiceNow element id).
    if aid and not volatile:
        sig: dict[str, Any] = {}
        if ct:
            sig["control_type"] = ct
        sig["automation_id"] = aid
        return {"signature": sig, "identity_source": "automation_id",
                "confidence": compute_confidence("automation_id", framework),
                "volatile_aids": []}

    # The aid was volatile (or absent) -> demote down the ladder to the label.
    if ct and name:
        return {"signature": {"control_type": ct, "name": name},
                "identity_source": "name",
                "confidence": compute_confidence("name", framework),
                "volatile_aids": volatile_aids}
    if cls and name:
        return {"signature": {"class_name": cls, "name": name},
                "identity_source": "name",
                "confidence": compute_confidence("name", framework),
                "volatile_aids": volatile_aids}
    if name:
        return {"signature": {"name": name}, "identity_source": "name",
                "confidence": compute_confidence("name", framework),
                "volatile_aids": volatile_aids}
    if cls:
        return {"signature": {"class_name": cls}, "identity_source": "class_name",
                "confidence": compute_confidence("class_name", framework),
                "volatile_aids": volatile_aids}
    return {"signature": None, "identity_source": "none",
            "confidence": compute_confidence("none", framework),
            "volatile_aids": volatile_aids}


def pick_all(controls: list[dict]) -> list[dict[str, Any]]:
    """Join the snapshot's controls across passes and pick each one's signature.
    Returns one ``{group, ancestry, ...pick}`` per joined control, in document
    order. ``ancestry`` is the reconstructed parent control_type chain (outermost
    first) -- value-free tree context for the annotator, never part of the
    signature."""
    out: list[dict[str, Any]] = []
    for key, group in _join_groups(controls):
        pick = pick_signature(group)
        pick["group"] = group
        ancestry = key[4] if isinstance(key, tuple) and len(key) > 4 else ()
        pick["ancestry"] = [a for a in ancestry if a]
        out.append(pick)
    return out
