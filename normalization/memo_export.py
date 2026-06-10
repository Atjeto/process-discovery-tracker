"""Findings-memo export (lab-phase spec §A4 + §B3/§B4).

The consultant deliverable: a ~2-page memo of measured claims +
evidence, rendered from the analysis.json blocks Phase A produces
(facts, findings, case_quality) plus stats.json. Templated sentences
and measured numbers ONLY -- nothing here invents a judgment, a
benchmark, or a number that was not computed upstream.

Structure:
  header        -- session, capture date/span, capture-coverage line.
  fact strip    -- the Tier-1 facts block as one table.
  findings      -- the analyst-selected findings (annotations.json
                   `memo_selection[]`) or the top N by feed order; each
                   claim + evidence numbers + starred screenshot refs.
  Tier 2        -- case-based numbers ONLY when case_quality unlocks
                   them; otherwise one honest line.
  to say more   -- the missing inputs, honestly enumerated.

ONE SOURCE OF TRUTH (§B3): `build_memo_model()` computes the structured
content; the Markdown renderer, the docx renderer (§B4), and the PDD's
findings-first §1 (pdd_export) all consume the same model, so the memo
and the PDD cannot disagree on a claim or a selection.

`--memo-out <path>` on normalize.py writes it -- `.docx` gets the Word
variant with the starred screenshots embedded inline as evidence
figures; any other extension gets Markdown. Markdown path is pure
stdlib; the docx variant needs python-docx (present in the bundled
viewer/python, same engine pdd_export uses).
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from findings import _fmt_ms, _pct

try:
    from docx import Document
    from docx.shared import Pt, Inches
except ImportError:          # md export stays stdlib-only
    Document = None
    Pt = None
    Inches = None

logger = logging.getLogger(__name__)

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


def _fact_cells(facts: dict) -> list[tuple[str, str]]:
    """The 6 (header, value) fact-strip pairs every renderer (md table,
    docx table, PDD §1) shares."""
    top = (facts.get("top_apps") or [{}])
    lead = top[0] if top else {}
    lead_cell = (f"{lead.get('app', '—')} ({_pct(lead.get('share', 0))})"
                 if lead.get("app") else "—")
    rekey = facts.get("rekey_count") or 0
    seqs = facts.get("repeated_sequence_count") or 0
    return [
        ("Active (foreground)", _fmt_ms(facts.get("active_ms"))),
        ("Idle (measured)", _fmt_ms(facts.get("idle_ms"))),
        ("Top app", lead_cell),
        ("App switches", "{} ({}/h)".format(
            facts.get("app_switches") or 0,
            facts.get("switches_per_hour") or 0)),
        ("Longest focus", _fmt_ms(facts.get("longest_focus_ms"))),
        ("Re-keyed values", "{} ({} repeated sequence{})".format(
            rekey, seqs, "s" if seqs != 1 else "")),
    ]


def _fact_strip(facts: dict) -> list[str]:
    cells = _fact_cells(facts)
    return [
        "| " + " | ".join(h for h, _ in cells) + " |",
        "|" + "---|" * len(cells),
        "| " + " | ".join(v for _, v in cells) + " |",
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


def build_memo_model(
    manifest: dict | None,
    stats: dict | None,
    analysis: dict | None,
    annotations: dict | None,
    session_label: str | None = None,
) -> dict[str, Any]:
    """The single structured source every memo surface renders from
    (§B3): the md memo, the docx memo, and the PDD's findings-first §1.
    Everything in it is computed upstream -- this only SELECTS and
    formats; it never invents a number."""
    manifest = manifest or {}
    stats = stats or {}
    analysis = analysis or {}
    annotations = annotations or {}
    label = (session_label
             or manifest.get("label")
             or manifest.get("session_id")
             or "session")
    chosen = _select_findings(analysis, annotations)
    return {
        "label": label,
        "captured": _capture_date(manifest, stats),
        "coverage_line": _coverage_line(stats, analysis),
        "fact_cells": _fact_cells(analysis.get("facts") or {}),
        "findings": [
            {
                "claim": f.get("claim") or "(no claim)",
                "evidence_line": _evidence_numbers(f.get("evidence") or {}),
                "screenshot_refs": list(
                    ((f.get("evidence") or {}).get("screenshot_refs") or [])[:2]),
                "confidence_note": f.get("confidence_note") or "",
            }
            for f in chosen
        ],
        "tier2_unlocked": bool(
            ((analysis.get("case_quality") or {}).get("tier2_unlocked"))),
        "tier2_lines": _tier2_section(analysis, stats, annotations),
        "to_say_more": _to_say_more(analysis, annotations),
    }


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
    model = build_memo_model(manifest, stats, analysis, annotations,
                             session_label=session_label)

    out: list[str] = []
    out.append(f"# Findings memo — {model['label']}")
    out.append("")
    out.append(f"*Captured {model['captured']} · {model['coverage_line']}*")
    out.append("")
    out.append("## What the capture measured")
    out.append("")
    out.extend(_fact_strip(analysis.get("facts") or {}))
    out.append("")
    out.append("## Findings")
    out.append("")
    out.extend(_findings_section(analysis, annotations))
    out.append("## Case-based analysis (Tier 2)")
    out.append("")
    out.extend(model["tier2_lines"])
    out.append("")
    out.append("## To say more")
    out.append("")
    more = model["to_say_more"]
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


# ---- docx variant (§B4) ----------------------------------------------------

def _resolve_session_image(session_folder: str | os.PathLike | None,
                           ref: str) -> Path | None:
    """Containment-checked screenshot resolution (same SEC posture as
    pdd_export): `ref` comes from a sidecar, so an absolute path or a
    `..` escape is skipped, never embedded."""
    if not session_folder or not ref:
        return None
    if Path(ref).is_absolute():
        logger.warning("memo_export: skipping absolute screenshot ref %s", ref)
        return None
    base = Path(session_folder).resolve()
    full = (base / ref).resolve()
    if base != full and base not in full.parents:
        logger.warning("memo_export: skipping out-of-folder screenshot ref %s", ref)
        return None
    return full if full.exists() else None


def _docx_note(doc, text: str):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.italic = True
    if Pt is not None:
        run.font.size = Pt(9)
    return p


def write_memo_into_docx(doc, model: dict, session_folder=None,
                         heading_offset: int = 0) -> None:
    """Write the memo body (fact strip, findings with INLINE starred
    screenshots, Tier 2, to-say-more) into an open python-docx Document.
    Shared by the standalone docx memo and the PDD's findings-first §1
    (pdd_export) so the two artifacts render the same model the same way.
    `heading_offset` shifts the section heading level (0 = a standalone
    memo with level-1 sections; 1 = nested under a PDD level-1 head)."""
    h = lambda lvl: lvl + heading_offset  # noqa: E731

    doc.add_heading("What the capture measured", level=h(1))
    cells = model["fact_cells"]
    t = doc.add_table(rows=2, cols=len(cells))
    for i, (head, val) in enumerate(cells):
        t.rows[0].cells[i].text = head
        t.rows[1].cells[i].text = val

    doc.add_heading("Findings", level=h(1))
    if not model["findings"]:
        _docx_note(doc, "No findings fired on this capture -- the detectors "
                        "found nothing above their preconditions.")
    for i, f in enumerate(model["findings"], 1):
        p = doc.add_paragraph()
        p.add_run(f"{i}. {f['claim']}").bold = True
        if f["evidence_line"]:
            _docx_note(doc, "Evidence: " + f["evidence_line"])
        for ref in f["screenshot_refs"]:
            img = _resolve_session_image(session_folder, ref)
            if img is None or Inches is None:
                continue
            try:
                doc.add_picture(str(img), width=Inches(4.5))
                _docx_note(doc, "★ " + str(ref))
            except (OSError, ValueError) as exc:
                logger.warning("memo_export: skipping screenshot %s: %s", ref, exc)
        if f["confidence_note"]:
            _docx_note(doc, f["confidence_note"])

    doc.add_heading("Case-based analysis (Tier 2)", level=h(1))
    for line in model["tier2_lines"]:
        doc.add_paragraph(line)

    doc.add_heading("To say more", level=h(1))
    more = model["to_say_more"]
    if not more:
        more = ["Nothing outstanding -- every analysis input this memo "
                "can use was supplied."]
    for item in more:
        doc.add_paragraph(item, style="List Bullet")


def render_memo_docx(
    out_path: str,
    manifest: dict | None,
    stats: dict | None,
    analysis: dict | None,
    annotations: dict | None,
    session_folder: str | os.PathLike | None = None,
    session_label: str | None = None,
) -> str:
    """Write the Word memo (same model as the Markdown memo, with the
    starred screenshots embedded inline as evidence figures)."""
    if Document is None:
        raise RuntimeError(
            "python-docx is not installed -- the .docx memo needs it "
            "(the bundled viewer/python has it; use a .md path otherwise).")
    model = build_memo_model(manifest, stats, analysis, annotations,
                             session_label=session_label)
    doc = Document()
    doc.add_heading(f"Findings memo — {model['label']}", level=0)
    _docx_note(doc, f"Captured {model['captured']} · {model['coverage_line']}")
    write_memo_into_docx(doc, model, session_folder=session_folder)
    _docx_note(doc, "Every number above was measured from the capture; "
                    "sentences are templated. Evidence figures (★) are the "
                    "screenshots named from the session folder.")
    doc.save(str(out_path))
    return str(out_path)


def write_memo(path: str, session_folder: str) -> str:
    """Load the session sidecars from disk and write the memo to `path`
    -- the Word variant when `path` ends in .docx, else Markdown.
    Returns the path written. Used by `normalize.py --memo-out` (and
    callable standalone against an already-analyzed session)."""
    def _read(name: str) -> dict:
        p = os.path.join(str(session_folder), name)
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError, ValueError):
            return {}

    kwargs = dict(
        manifest=_read("manifest.json"),
        stats=_read("stats.json"),
        analysis=_read("analysis.json"),
        annotations=_read("annotations.json"),
        session_label=None,
    )
    if str(path).lower().endswith(".docx"):
        return render_memo_docx(path, session_folder=session_folder, **kwargs)
    md = render_memo(**kwargs)
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
    return path
