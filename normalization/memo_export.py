"""Findings-memo export (lab-phase spec §A4).

The consultant deliverable seed: a ~2-page Markdown memo of measured
claims + evidence, rendered from the analysis.json blocks Phase A
produces (facts, findings, case_quality) plus stats.json. Templated
sentences and measured numbers ONLY -- nothing here invents a judgment,
a benchmark, or a number that was not computed upstream.

Structure:
  header        -- session, capture date/span, capture-coverage line.
  fact strip    -- the Tier-1 facts block as one table.
  findings      -- the analyst-selected findings (annotations.json
                   `memo_selection[]`) or the top N by feed order; each
                   claim + evidence numbers + starred screenshot refs.
  Tier 2        -- case-based numbers ONLY when case_quality unlocks
                   them; otherwise one honest line.
  to say more   -- the missing inputs, honestly enumerated.

`--memo-out <path.md>` on normalize.py writes it; docx is Phase B.
Pure stdlib.
"""
from __future__ import annotations

import json
import os
from typing import Any

from findings import _fmt_ms, _pct

# Without an analyst selection, the memo takes the first N findings in
# feed order (the detector-table order is already a narrative order).
DEFAULT_TOP_FINDINGS = 5


def _capture_date(manifest: dict, stats: dict) -> str:
    """The capture day, from the manifest start or the stats meta run stamp."""
    for probe in (
        (manifest or {}).get("started_at"),
        (manifest or {}).get("created_at"),
        ((stats or {}).get("meta") or {}).get("normalization_run_at"),
    ):
        if isinstance(probe, str) and len(probe) >= 10:
            return probe[:10]
    return "unknown date"


def _coverage_line(stats: dict, analysis: dict) -> str:
    meta = (stats or {}).get("meta") or {}
    facts = (analysis or {}).get("facts") or {}
    parts = []
    raw = meta.get("raw_event_count")
    inter = meta.get("interaction_count")
    if raw:
        parts.append(f"{raw} events ({inter or 0} interactions)")
    span = facts.get("session_span_ms")
    if span:
        parts.append(f"{_fmt_ms(span)} span")
    apps = facts.get("top_apps") or []
    if apps:
        parts.append(f"{len(apps)} app{'s' if len(apps) != 1 else ''} in the foreground top-5")
    caveat = next((f for f in (analysis or {}).get("findings") or []
                   if f.get("detector") == "coverage_caveat"), None)
    if caveat:
        n = len(((caveat.get("evidence") or {}).get("flagged_apps")) or [])
        parts.append(f"{n} app{'s' if n != 1 else ''} at reduced capture confidence")
    return " · ".join(parts) if parts else "no capture metadata available"


def _fact_strip(facts: dict) -> list[str]:
    top = (facts.get("top_apps") or [{}])
    lead = top[0] if top else {}
    lead_cell = (f"{lead.get('app', '—')} ({_pct(lead.get('share', 0))})"
                 if lead.get("app") else "—")
    rekey = facts.get("rekey_count") or 0
    seqs = facts.get("repeated_sequence_count") or 0
    return [
        "| Active (foreground) | Idle (measured) | Top app | App switches | Longest focus | Re-keyed values |",
        "|---|---|---|---|---|---|",
        "| {} | {} | {} | {} ({}/h) | {} | {} ({} repeated sequence{}) |".format(
            _fmt_ms(facts.get("active_ms")),
            _fmt_ms(facts.get("idle_ms")),
            lead_cell,
            facts.get("app_switches") or 0,
            facts.get("switches_per_hour") or 0,
            _fmt_ms(facts.get("longest_focus_ms")),
            rekey, seqs, "s" if seqs != 1 else "",
        ),
    ]


def _evidence_numbers(evidence: dict) -> str:
    """The scalar evidence numbers, formatted compactly. `_ms` keys render
    as durations, `share`/`coverage` as percentages; lists/dicts are
    skipped (the claim already summarises them)."""
    parts = []
    for k, v in (evidence or {}).items():
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        if k.endswith("_ms"):
            parts.append(f"{k.replace('_', ' ')} {_fmt_ms(v)}")
        elif k in ("share", "coverage"):
            parts.append(f"{k} {_pct(v)}")
        else:
            num = round(v, 2) if isinstance(v, float) else v
            parts.append(f"{k.replace('_', ' ')} {num}")
    return " · ".join(parts)


def _select_findings(analysis: dict, annotations: dict) -> list[dict]:
    all_findings = [f for f in (analysis or {}).get("findings") or []
                    if isinstance(f, dict)]
    selected_ids = [s for s in ((annotations or {}).get("memo_selection") or [])
                    if isinstance(s, str)]
    if selected_ids:
        chosen = [f for f in all_findings if f.get("id") in set(selected_ids)]
        if chosen:
            return chosen
    return all_findings[:DEFAULT_TOP_FINDINGS]


def _findings_section(analysis: dict, annotations: dict) -> list[str]:
    chosen = _select_findings(analysis, annotations)
    if not chosen:
        return ["_No findings fired on this capture -- the detectors found "
                "nothing above their preconditions._"]
    lines: list[str] = []
    for i, f in enumerate(chosen, 1):
        lines.append(f"{i}. **{f.get('claim') or '(no claim)'}**")
        ev = f.get("evidence") or {}
        nums = _evidence_numbers(ev)
        if nums:
            lines.append(f"   - Evidence: {nums}")
        refs = ev.get("screenshot_refs") or []
        for r in refs[:2]:
            lines.append(f"   - ★ `{r}`")
        note = f.get("confidence_note")
        if note:
            lines.append(f"   - _{note}_")
        lines.append("")
    return lines


def _tier2_section(analysis: dict, stats: dict, annotations: dict) -> list[str]:
    cq = (analysis or {}).get("case_quality") or {}
    if not cq.get("tier2_unlocked"):
        n = len((annotations or {}).get("anchor_candidates") or [])
        return [
            "This session is not case-segmented; {} anchor candidate{} "
            "awaiting review.".format(n, "s are" if n != 1 else " is")
            if n else
            "This session is not case-segmented and no anchor candidates "
            "were detected; capture Start/End markers to unlock case-based "
            "analysis.",
        ]
    lines = []
    mode = cq.get("mode")
    if mode == "anchor":
        anchor = cq.get("anchor") or {}
        lines.append("Cases stamped by anchor `{}` = `{}` -- {} cases, {} of "
                     "interactions covered.".format(
                         anchor.get("field_property") or "?",
                         anchor.get("field_value") or "?",
                         cq.get("case_count") or 0,
                         _pct(cq.get("coverage") or 0)))
    else:
        lines.append("Cases bracketed by worker-fired markers -- {} cases, {} "
                     "of interactions covered.".format(
                         cq.get("case_count") or 0,
                         _pct(cq.get("coverage") or 0)))
    rows = [r for r in (stats or {}).get("case_stats") or []
            if isinstance(r.get("wall_clock_ms"), (int, float))]
    if rows:
        walls = [r["wall_clock_ms"] for r in rows]
        lines.append("Cycle time (wall clock): mean {} · fastest {} · slowest {} "
                     "across {} timed case{}.".format(
                         _fmt_ms(sum(walls) / len(walls)),
                         _fmt_ms(min(walls)), _fmt_ms(max(walls)),
                         len(walls), "s" if len(walls) != 1 else ""))
    variants = (stats or {}).get("step_variants") or (stats or {}).get("trace_variants") or []
    if variants:
        top_freq = variants[0].get("frequency") or 0
        lines.append("{} distinct path variant{} observed; the most common "
                     "ran {} time{}.".format(
                         len(variants), "s" if len(variants) != 1 else "",
                         top_freq, "s" if top_freq != 1 else ""))
    return lines


def _to_say_more(analysis: dict, annotations: dict) -> list[str]:
    items: list[str] = []
    cq = (analysis or {}).get("case_quality") or {}
    facts = (analysis or {}).get("facts") or {}
    if not cq.get("tier2_unlocked"):
        n = len((annotations or {}).get("anchor_candidates") or [])
        hint = (f" ({n} anchor candidate{'s' if n != 1 else ''} awaiting review)"
                if n else "")
        items.append("Case segmentation{} -- accepting an anchor or capturing "
                     "Start/End markers unlocks cycle times, variants and "
                     "per-case comparison.".format(hint))
    if not (annotations or {}).get("roi_inputs"):
        items.append("A loaded labour rate and annual volume (Analysis → Edit "
                     "assumptions) would turn the measured time into a € "
                     "savings band.")
    caveat = next((f for f in (analysis or {}).get("findings") or []
                   if f.get("detector") == "coverage_caveat"), None)
    if caveat:
        apps = [a.get("app") for a in
                ((caveat.get("evidence") or {}).get("flagged_apps")) or []]
        items.append("Capture confidence is reduced in {} -- an App "
                     "Vocabulary for {} would firm up element identity."
                     .format(", ".join(apps[:4]),
                             "them" if len(apps) != 1 else "it"))
    if not facts.get("idle_ms"):
        items.append("No idle events were measured -- waiting time spent "
                     "inside an app without input is invisible to this "
                     "capture.")
    has_bnva = any(
        isinstance(ov, dict) and ov.get("bnva_ms") is not None
        for ov in (annotations or {}).get("analysis_overrides") or [])
    if not has_bnva:
        items.append("The value-add vs business-required split needs an "
                     "analyst judgment per step type (Analysis → Waste by "
                     "step) before a process-efficiency ratio can be stated.")
    return items


def render_memo(
    manifest: dict | None,
    stats: dict | None,
    analysis: dict | None,
    annotations: dict | None,
    session_label: str | None = None,
) -> str:
    """Render the memo Markdown from in-memory pipeline objects."""
    manifest = manifest or {}
    stats = stats or {}
    analysis = analysis or {}
    annotations = annotations or {}
    label = (session_label
             or manifest.get("label")
             or manifest.get("session_id")
             or "session")
    facts = analysis.get("facts") or {}

    out: list[str] = []
    out.append(f"# Findings memo — {label}")
    out.append("")
    out.append(f"*Captured {_capture_date(manifest, stats)} · "
               f"{_coverage_line(stats, analysis)}*")
    out.append("")
    out.append("## What the capture measured")
    out.append("")
    out.extend(_fact_strip(facts))
    out.append("")
    out.append("## Findings")
    out.append("")
    out.extend(_findings_section(analysis, annotations))
    out.append("## Case-based analysis (Tier 2)")
    out.append("")
    out.extend(_tier2_section(analysis, stats, annotations))
    out.append("")
    out.append("## To say more")
    out.append("")
    more = _to_say_more(analysis, annotations)
    if more:
        out.extend(f"- {item}" for item in more)
    else:
        out.append("- Nothing outstanding -- every analysis input this memo "
                   "can use was supplied.")
    out.append("")
    out.append("---")
    out.append("*Every number above was measured from the capture; sentences "
               "are templated. Evidence pointers (★) name screenshots in the "
               "session folder.*")
    out.append("")
    return "\n".join(out)


def write_memo(path: str, session_folder: str) -> str:
    """Load the session sidecars from disk and write the memo to `path`.
    Returns the path written. Used by `normalize.py --memo-out` (and
    callable standalone against an already-analyzed session)."""
    def _read(name: str) -> dict:
        p = os.path.join(str(session_folder), name)
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError, ValueError):
            return {}

    md = render_memo(
        manifest=_read("manifest.json"),
        stats=_read("stats.json"),
        analysis=_read("analysis.json"),
        annotations=_read("annotations.json"),
        session_label=None,
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
    return path
