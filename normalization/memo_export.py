"""Findings-memo model (lab-phase spec §A4 + §B3/§B4).

Lane LUX-P cut the PDD's findings section: pdd_export no longer calls
build_memo_model or write_memo_into_docx. What still runs is `pdd_findings`
(analysis.json, read by the viewer's "include in PDD" boxes), `run_rows`,
`failed_stages` and COULD_NOT_RUN; the rest goes with those boxes (viewer
lane). The description below is the section as it was.

The findings content of the PDD's §1: measured claims + evidence, built
from the analysis.json blocks Phase A produces (facts, findings,
case_quality) plus stats.json. Templated sentences and measured numbers
ONLY -- nothing here invents a judgment, a benchmark, or a number that was
not computed upstream.

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
content and `write_memo_into_docx()` renders it into the PDD's
findings-first §1 (pdd_export), with the starred screenshots embedded
inline as evidence figures. The docx rendering needs python-docx (present
in the bundled viewer/python, same engine pdd_export uses); the model is
pure stdlib.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from app_names import display_name
from facts import PER_HOUR_MIN_SPAN_MS
from findings import _fmt_ms, _pct

try:
    from docx.shared import Pt, Inches
except ImportError:          # the model stays stdlib-only
    Pt = None
    Inches = None

logger = logging.getLogger(__name__)

# Without an analyst selection, the memo takes the first N findings in
# feed order (the detector-table order is already a narrative order).
DEFAULT_TOP_FINDINGS = 5

# AD-20: a repeated step sequence has one home, the automation candidates
# (the PDD's 5.3 and the Overview's Automation candidates), so section 1
# never prints it as a finding, not even when an older memo_selection names it.
_NOT_PRINTED = frozenset({"repetition"})

# C12 (RP-10): the words every renderer uses for an analysis stage that
# failed, in place of its output. Never a zero, never "nothing found".
COULD_NOT_RUN = "could not run on this recording"

# analysis.json keys that are the output of one analysis stage (C12).
_STAGE_KEYS = ("case_quality", "facts", "findings", "waste_classification",
               "time_study", "segments", "automation_candidates", "efficiency")


def failed_stages(analysis: dict | None) -> set[str]:
    """The analysis stages that could not run on this recording (C12): every
    stage named in `stage_errors`, plus every stage-output key written as
    null. An ABSENT key is not a failure (an older analysis.json, or no
    analysis at all); only an explicit null is."""
    a = analysis if isinstance(analysis, dict) else {}
    out = {e.get("stage") for e in (a.get("stage_errors") or [])
           if isinstance(e, dict) and isinstance(e.get("stage"), str)}
    out.update(k for k in _STAGE_KEYS if k in a and a[k] is None)
    return out


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
        parts.append(f"{n} app{'s' if n != 1 else ''} recorded with less detail")
    return " · ".join(parts) if parts else "no capture metadata available"


_FACT_HEADS = ("Active time", "Idle time", "Top app", "App switches",
               "Longest stretch in one app", "Values re-typed across apps",
               "Repeated step sequences")


def _fact_cells(facts: dict, failed: bool = False,
                app_names: dict | None = None) -> list[tuple[str, str]]:
    """The 7 (header, value) fact-strip pairs the PDD §1 fact table shows.

    G-2 honesty rule: when the recording carries no app-time signal at all
    (facts.app_time_source == "none" -- old captures), the four app-time
    cells say "not available from this recording" instead of a confident
    0; an interaction-derived estimate is labelled as one.

    C12 (RP-10): when the facts stage failed (`failed`), every cell says the
    check could not run; a failed motif stage (repeated_sequence_count
    written as null) says so for the repeated-sequence count.

    DA gap 8: the re-typed values and the repeated step sequences are two
    separate counts in two cells. DA gap 9: the switch count carries a
    per-hour rate only when the recording spans at least 30 minutes. DA gap
    3: the top app is named by its readable name (`app_names`)."""
    if failed:
        return [(head, COULD_NOT_RUN) for head in _FACT_HEADS]
    top = (facts.get("top_apps") or [{}])
    lead = top[0] if top else {}
    na = "not available from this recording"
    lead_cell = (f"{display_name(lead.get('app'), app_names)} "
                 f"({_pct(lead.get('share', 0))})" if lead.get("app") else na)
    source = facts.get("app_time_source") or "activity"
    est = " (estimated from clicks and typing)" if source == "interactions" else ""
    if source == "none":
        active_cell = top_cell = switches_cell = longest_cell = na
    else:
        active_cell = _fmt_ms(facts.get("active_ms")) + est
        top_cell = lead_cell
        switches_cell = str(facts.get("app_switches") or 0)
        span = facts.get("session_span_ms")
        if (isinstance(span, (int, float)) and not isinstance(span, bool)
                and span >= PER_HOUR_MIN_SPAN_MS):
            switches_cell += " ({}/h)".format(facts.get("switches_per_hour") or 0)
        switches_cell += est
        longest_cell = _fmt_ms(facts.get("longest_focus_ms"))
    if "repeated_sequence_count" in facts and facts["repeated_sequence_count"] is None:
        seq_cell = COULD_NOT_RUN
    else:
        seq_cell = str(facts.get("repeated_sequence_count") or 0)
    return list(zip(_FACT_HEADS, (
        active_cell,
        _fmt_ms(facts.get("idle_ms")),
        top_cell,
        switches_cell,
        longest_cell,
        str(facts.get("rekey_count") or 0),
        seq_cell,
    )))


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


def printable_findings(analysis: dict | None, runs_exist: bool = True) -> list[dict]:
    """The findings section 1 can print, in feed order: every finding except
    a repeated step sequence (AD-20), and a case-based finding (tier 2) only
    when the recording has runs: it compares runs, so without runs it has
    nothing to stand on."""
    return [f for f in (analysis or {}).get("findings") or []
            if isinstance(f, dict) and f.get("detector") not in _NOT_PRINTED
            and (runs_exist or f.get("tier") != 2)]


def _select_findings(analysis: dict, annotations: dict,
                     runs_exist: bool = True) -> list[dict]:
    """The analyst's selection (memo_selection) among the printable findings,
    or the first DEFAULT_TOP_FINDINGS of them when it names none."""
    all_findings = printable_findings(analysis, runs_exist)
    selected_ids = [s for s in ((annotations or {}).get("memo_selection") or [])
                    if isinstance(s, str)]
    if selected_ids:
        chosen = [f for f in all_findings if f.get("id") in set(selected_ids)]
        if chosen:
            return chosen
    return all_findings[:DEFAULT_TOP_FINDINGS]


def pdd_findings(analysis: dict | None, stats: dict | None) -> dict | None:
    """What section 1 prints, for the viewer's "include in PDD" boxes (F2):
    the ids of the printable findings (`eligible`, feed order) and of the
    ones printed when the analyst ticked none (`default`). Computed by the
    same selection the PDD uses, so the boxes cannot disagree with it. None
    when the findings stage did not run (C12)."""
    if not isinstance((analysis or {}).get("findings"), list):
        return None
    runs = _run_count(stats, analysis) > 0
    return {
        "eligible": [f.get("id") for f in printable_findings(analysis, runs)],
        "default": [f.get("id") for f in _select_findings(analysis, {}, runs)],
    }


def run_rows(stats: dict | None) -> list[dict]:
    """The recording's runs: the top-level marked cases in stats.case_stats,
    in start order. The PDD's timings table and this memo's elapsed-time line
    read the same rows, so the two never disagree (DA gap 7)."""
    rows = [r for r in (stats or {}).get("case_stats") or []
            if isinstance(r, dict) and r.get("case_id") and not r.get("parent_case_id")]
    return sorted(rows, key=lambda r: str(r.get("start_ts") or ""))


def _run_count(stats: dict | None, analysis: dict | None) -> int:
    """How many runs the recording has (the case check's count when the
    stats carry no case rows)."""
    rows = run_rows(stats)
    if rows:
        return len(rows)
    n = ((analysis or {}).get("case_quality") or {}).get("case_count")
    return n if isinstance(n, int) and not isinstance(n, bool) else 0


def _tier2_section(analysis: dict, stats: dict,
                   failed: set | frozenset = frozenset()) -> list[str]:
    if "case_quality" in failed:
        # C12: a failed run check is not "no runs marked".
        return [f"The run check {COULD_NOT_RUN}, so no run-by-run "
                "numbers are shown."]
    cq = (analysis or {}).get("case_quality") or {}
    if not cq.get("tier2_unlocked"):
        # G-3: runs WERE marked, just not enough of them to compare.
        if cq.get("mode") != "unsegmented" and (cq.get("case_count") or 0) >= 1:
            n_runs = cq.get("case_count") or 0
            return [
                "{} run{} marked in this recording. Comparing runs (how "
                "long each run takes, the steps each run followed) needs at "
                "least 2 runs, so no comparison is reported.".format(
                    n_runs, "s were" if n_runs != 1 else " was"),
            ]
        return [
            "No runs were marked in this recording; marking each repetition "
            "as a run would unlock the run-by-run numbers.",
        ]
    lines = []
    lines.append("{} runs were marked during the recording; {} of the "
                 "recorded actions fall inside a run.".format(
                     cq.get("case_count") or 0,
                     _pct(cq.get("coverage") or 0)))
    rows = [r for r in run_rows(stats)
            if isinstance(r.get("wall_clock_ms"), (int, float))]
    if rows:
        walls = [r["wall_clock_ms"] for r in rows]
        lines.append("Elapsed time per run (wall clock): mean {}, fastest {}, "
                     "slowest {}, across {} timed run{}.".format(
                         _fmt_ms(sum(walls) / len(walls)),
                         _fmt_ms(min(walls)), _fmt_ms(max(walls)),
                         len(walls), "s" if len(walls) != 1 else ""))
    variants = (stats or {}).get("step_variants") or (stats or {}).get("trace_variants") or []
    if variants:
        top_freq = variants[0].get("frequency") or 0
        lines.append("The runs followed {} different step sequence{}; the "
                     "most common one was followed {} time{}.".format(
                         len(variants), "s" if len(variants) != 1 else "",
                         top_freq, "s" if top_freq != 1 else ""))
    return lines


def _to_say_more(analysis: dict, annotations: dict,
                 failed: set | frozenset = frozenset(),
                 app_names: dict | None = None) -> list[str]:
    items: list[str] = []
    cq = (analysis or {}).get("case_quality") or {}
    facts = (analysis or {}).get("facts") or {}
    # C12: a stage that failed measured nothing, so it cannot say what is
    # missing either; its items are skipped rather than stated as findings.
    if "case_quality" not in failed and not cq.get("tier2_unlocked"):
        if cq.get("mode") != "unsegmented" and (cq.get("case_count") or 0) >= 1:
            # G-3: marked but too few to compare.
            items.append("Only {} run{} marked. Comparing runs needs at "
                         "least 2, so recording one more run (or marking "
                         "another in this recording) would show how long "
                         "each run takes and how the runs differ."
                         .format(cq.get("case_count") or 0,
                                 " was" if (cq.get("case_count") or 0) == 1
                                 else "s were"))
        else:
            items.append("No runs were marked. Marking each repetition of "
                         "the process as a run shows how long each run "
                         "takes, how the runs differ, and the run-by-run "
                         "numbers.")
    caveat = next((f for f in (analysis or {}).get("findings") or []
                   if f.get("detector") == "coverage_caveat"), None)
    if caveat:
        apps = [display_name(a.get("app"), app_names) for a in
                ((caveat.get("evidence") or {}).get("flagged_apps")) or []]
        items.append("The recorder saw less detail in {}, so the numbers "
                     "measured inside {} are less precise."
                     .format(", ".join(apps[:4]),
                             "those apps" if len(apps) != 1 else "that app"))
    if "facts" not in failed and not facts.get("idle_ms"):
        items.append("No idle time was measured: time spent waiting "
                     "inside an app without typing or clicking is invisible "
                     "to this recording.")
    has_bnva = any(
        isinstance(ov, dict) and ov.get("bnva_ms") is not None
        for ov in (annotations or {}).get("analysis_overrides") or [])
    if not has_bnva:
        items.append("Saying how much of the time added value needs an "
                     "analyst to judge each step type first (Analysis → "
                     "Waste by step); until then the memo makes no "
                     "efficiency claim.")
    return items


def build_memo_model(
    manifest: dict | None,
    stats: dict | None,
    analysis: dict | None,
    annotations: dict | None,
    session_label: str | None = None,
) -> dict[str, Any]:
    """The single structured source the PDD's findings-first §1 renders
    from (§B3). Everything in it is computed upstream -- this only SELECTS
    and formats; it never invents a number."""
    manifest = manifest or {}
    stats = stats or {}
    analysis = analysis or {}
    annotations = annotations or {}
    label = (session_label
             or manifest.get("label")
             or manifest.get("session_id")
             or "session")
    app_names = (stats.get("meta") or {}).get("app_names")
    chosen = _select_findings(analysis, annotations,
                              runs_exist=_run_count(stats, analysis) > 0)
    failed = failed_stages(analysis)
    return {
        "label": label,
        "captured": _capture_date(manifest, stats),
        "coverage_line": _coverage_line(stats, analysis),
        "fact_cells": _fact_cells(analysis.get("facts") or {},
                                  failed="facts" in failed,
                                  app_names=app_names),
        # C12: the findings stage failed, so an empty list is not "nothing
        # stood out".
        "findings_failed": "findings" in failed,
        "findings": [
            {
                "claim": f.get("claim") or "(no claim)",
                "evidence_line": _evidence_numbers(f.get("evidence") or {}),
                "screenshot_refs": list(
                    ((f.get("evidence") or {}).get("screenshot_refs") or [])[:2]),
                "confidence_note": f.get("confidence_note") or "",
                # Tier 2 compares runs: the renderer labels it as such.
                "case_based": f.get("tier") == 2,
                # The PDD's candidate list skips what a finding already says.
                "segment_signature": (f.get("evidence") or {}).get("segment_signature"),
            }
            for f in chosen
        ],
        "tier2_unlocked": bool(
            ((analysis.get("case_quality") or {}).get("tier2_unlocked"))),
        "tier2_lines": _tier2_section(analysis, stats, failed),
        "to_say_more": _to_say_more(analysis, annotations, failed, app_names),
    }


# ---- docx rendering (§B4) --------------------------------------------------

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
    screenshots, the run-by-run lines, to-say-more) into an open python-docx
    Document: the PDD's findings-first §1 (pdd_export). `heading_offset` shifts the
    section heading level (0 = level-1 sections; 1 = nested under a PDD
    level-1 head, as pdd_export renders it)."""
    h = lambda lvl: lvl + heading_offset  # noqa: E731

    doc.add_heading("What the recording measured", level=h(1))
    cells = model["fact_cells"]
    t = doc.add_table(rows=2, cols=len(cells))
    for i, (head, val) in enumerate(cells):
        t.rows[0].cells[i].text = head
        t.rows[1].cells[i].text = val

    doc.add_heading("Findings", level=h(1))
    if model.get("findings_failed"):
        _docx_note(doc, f"The automatic checks {COULD_NOT_RUN}, so no "
                        "findings are reported.")
    elif not model["findings"]:
        _docx_note(doc, "Nothing stood out: the automatic checks found "
                        "nothing worth reporting on this recording.")
    for i, f in enumerate(model["findings"], 1):
        p = doc.add_paragraph()
        p.add_run(f"{i}. ").bold = True
        if f.get("case_based"):
            # A case-based finding compares the runs; say so up front.
            p.add_run("Across runs: ").italic = True
        p.add_run(f["claim"]).bold = True
        if f["evidence_line"]:
            _docx_note(doc, "Evidence: " + f["evidence_line"])
        for ref in f["screenshot_refs"]:
            img = _resolve_session_image(session_folder, ref)
            if img is None or Inches is None:
                continue
            try:
                # 3.2" keeps an evidence figure memo-sized (the memo stays
                # ~2 pages); the PDD's step screenshots remain 4.5".
                doc.add_picture(str(img), width=Inches(3.2))
                _docx_note(doc, "★ " + str(ref))
            except (OSError, ValueError) as exc:
                logger.warning("memo_export: skipping screenshot %s: %s", ref, exc)
        if f["confidence_note"]:
            _docx_note(doc, f["confidence_note"])

    doc.add_heading("Run-by-run analysis", level=h(1))
    for line in model["tier2_lines"]:
        doc.add_paragraph(line)

    doc.add_heading("To say more", level=h(1))
    more = model["to_say_more"]
    if not more:
        more = ["Nothing outstanding: every analysis input this memo "
                "can use was supplied."]
    for item in more:
        doc.add_paragraph(item, style="List Bullet")
