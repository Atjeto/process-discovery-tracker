"""Generate a Process Definition Document (.docx) from a normalized session.

FINDINGS-FIRST (lab-phase spec §B3): §1 is the findings memo content,
rendered from the SAME `analysis.findings` + `annotations.memo_selection[]`
model as memo_export (one source of truth -- the memo and the PDD cannot
disagree). The long-form body follows: document control, an introduction,
an As-Is process description (overview, applications, map, statistics,
detailed steps, input data), an automation assessment, and an
exceptions/variations section -- the outline a standard RPA PDD uses
(cf. the document UiPath Task Capture generates), demoted behind the
findings.

Honesty parity with the viewer (§B3): the efficiency ratio in the
statistics section renders only once an analyst has judged
business-required time somewhere (any `bnva_ms` override); the Tier-2
sections (cycle times, variants) render only when
`analysis.case_quality.tier2_unlocked` -- below the gate each is
REPLACED by the one-line call to action, never rendered with fact-level
authority.

Sections are auto-filled where the pipeline has the data and carry explicit
"[To be completed: ...]" placeholders where they need analyst judgement (purpose,
scope, exception handling). A PDD is a structured document, not a data dump --
the placeholders are intentional and mark exactly what a human still owns.

Uses python-docx.
"""

from __future__ import annotations
import logging
from datetime import datetime, timezone
from pathlib import Path

try:
    from docx import Document
    from docx.shared import Pt, Inches
except ImportError:
    Document = None
    Pt = None
    Inches = None

logger = logging.getLogger(__name__)

_FLAG_LABELS = {
    "waste": "Waste",
    "rework": "Rework",
    "value_add": "Value-add",
    "bottleneck": "Bottleneck",
}
# `automation_candidate` is deliberately absent here. ADR-0016 moved
# automation candidacy from the atomic-step grain to coherent segments;
# §4.3 now lists segments, and rendering a per-step "Automation candidate"
# flag in §3.5 contradicts that framing (you don't automate one click).
# The flag itself may still be set on a step by the app vocab, but the
# PDD output does not surface it.


def write_pdd(
    out_path: Path,
    *,
    session_folder: Path,
    canonical: dict | None,
    annotations: dict,
    stats: dict,
    manifest: dict,
    analysis: dict | None = None,
    process_map_image: str | Path | None = None,
    tobe_map_image: str | Path | None = None,
) -> None:
    if Document is None:
        raise RuntimeError(
            "python-docx is not installed. Add `python-docx>=1.1.0` to "
            "normalization/requirements.txt and reinstall."
        )
    stats = stats or {}
    analysis = analysis or {}
    annotations = annotations or {}

    doc = Document()
    _write_findings_first(doc, manifest, stats, analysis, annotations,
                          session_folder)             # 1. Findings (memo, §B3)
    _write_title(doc, manifest, canonical)            # 2. Document control
    _write_introduction(doc, manifest)                # 3. Introduction

    doc.add_heading("4. As-Is Process", level=1)
    _write_overview(doc, stats, manifest, canonical)  # 4.1 Process overview
    _write_applications(doc, stats)                   # 4.2 Applications used
    _write_process_map(doc, process_map_image)        # 4.3 As-Is process map
    _write_statistics(doc, stats, analysis, annotations)  # 4.4 Process statistics
    _write_steps(doc, annotations, session_folder, analysis)  # 4.5 Detailed steps
    _write_input_data(doc)                            # 4.6 Input data

    _write_automation(doc, analysis)                  # 5. Automation assessment
    _write_roi(doc, analysis)                         # 5.4 Estimated ROI
    _write_tobe_map(doc, tobe_map_image)              # 5.5 Proposed to-be process (ADR-0019)
    _write_exceptions(doc, annotations, stats, analysis)  # 6. Exceptions & variations
    _write_footer(doc)

    doc.save(str(out_path))


# ---- 1. Findings (the memo content, findings-first -- §B3) -------------------

def _write_findings_first(doc, manifest, stats, analysis, annotations,
                          session_folder):
    """§1 = the findings memo, rendered from the same build_memo_model()
    the md/docx memo uses -- one source of truth, the two artifacts
    cannot disagree on a claim, a number, or the analyst's selection."""
    from memo_export import build_memo_model, write_memo_into_docx
    doc.add_heading("1. Findings", level=1)
    model = build_memo_model(manifest, stats, analysis, annotations)
    _note(doc, f"Captured {model['captured']} · {model['coverage_line']}")
    write_memo_into_docx(doc, model, session_folder=session_folder,
                         heading_offset=1)
    _note(doc, "Every number above was measured from the capture; sentences "
               "are templated. The sections below are the long-form As-Is "
               "documentation behind these findings.")


# ---- shared bits ------------------------------------------------------------

def _placeholder(doc, text):
    """An italic, clearly-marked gap for the analyst to complete."""
    p = doc.add_paragraph()
    run = p.add_run(f"[To be completed: {text}]")
    run.italic = True
    return p


def _note(doc, text):
    """A small italic caption (disclaimers, table footnotes)."""
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.italic = True
    if Pt is not None:
        run.font.size = Pt(9)
    return p


def _kv_table(doc, rows):
    t = doc.add_table(rows=0, cols=2)
    for k, v in rows:
        c = t.add_row().cells
        c[0].text = str(k)
        c[1].text = str(v)
    return t


# ---- 2. Document control ----------------------------------------------------

def _write_title(doc, manifest, canonical):
    doc.add_heading("Process Definition Document", level=0)
    proc_name = (canonical or {}).get("name")
    if proc_name:
        sub = doc.add_paragraph()
        sub.add_run(proc_name).bold = True

    doc.add_heading("2. Document control", level=1)
    worker = (manifest.get("config", {}).get("worker") or {}).get("id", "-")
    _kv_table(doc, [
        ("Engagement", manifest.get("engagement_id") or "-"),
        ("Process", proc_name or "-"),
        ("Prepared from recording by", worker),
        ("Captured", manifest.get("started_at", "-")),
        ("Document generated", datetime.now(timezone.utc).strftime("%Y-%m-%d")),
        ("Version", str((canonical or {}).get("version") or "Draft")),
    ])


# ---- 3. Introduction --------------------------------------------------------

def _write_introduction(doc, manifest):
    doc.add_heading("3. Introduction", level=1)
    doc.add_heading("3.1 Purpose", level=2)
    _placeholder(doc, "the business need this process serves and why it is being "
                      "documented / considered for automation")
    doc.add_heading("3.2 Objectives", level=2)
    _placeholder(doc, "what this document and any resulting automation aim to achieve")
    doc.add_heading("3.3 Key contacts", level=2)
    worker = (manifest.get("config", {}).get("worker") or {}).get("id", "-")
    t = doc.add_table(rows=1, cols=3)
    h = t.rows[0].cells
    h[0].text, h[1].text, h[2].text = "Name", "Role", "Contact"
    r = t.add_row().cells
    r[0].text, r[1].text, r[2].text = str(worker), "Process operator (recorded)", "—"
    _placeholder(doc, "the process owner, SME, and automation lead")


# ---- 4.1 Process overview ---------------------------------------------------

def _write_overview(doc, stats, manifest, canonical):
    doc.add_heading("4.1 Process overview", level=2)
    meta = stats.get("meta") or {}
    name = (canonical or {}).get("name")
    worker = (manifest.get("config", {}).get("worker") or {}).get("id")
    captured = manifest.get("started_at")

    lead = "This process"
    if name:
        lead += f", “{name}”,"
    lead += " was reconstructed from a recorded session"
    if captured and captured != "-":
        lead += f" captured {captured}"
    if worker and worker != "-":
        lead += f" by {worker}"
    lead += "."
    cc, sc = meta.get("case_count"), meta.get("step_count")
    if cc or sc:
        lead += " It comprises"
        if cc:
            lead += f" {cc} case(s)"
        if sc:
            lead += (" and" if cc else "") + f" {sc} step(s)"
        lead += " across the applications listed below."
    doc.add_paragraph(lead)
    _placeholder(doc, "a short business description of what the process does and "
                      "the outcome it produces")


# ---- 4.2 Applications used --------------------------------------------------

def _write_applications(doc, stats):
    doc.add_heading("4.2 Applications used", level=2)
    meta = stats.get("meta") or {}
    cov = meta.get("vocab_coverage") or {}
    apps = sorted(cov.items(),
                  key=lambda kv: (kv[1] or {}).get("total_interactions", 0),
                  reverse=True)
    if not apps:
        # Fall back to the apps embedded in activity labels ("... -- app.exe").
        seen = []
        for a in (stats.get("activity_stats") or []):
            label = str(a.get("activity_label", ""))
            if " -- " in label:
                app = label.rsplit(" -- ", 1)[1]
                if app not in seen:
                    seen.append(app)
        apps = [(a, {}) for a in seen]
    if not apps:
        _placeholder(doc, "the applications this process touches")
        return
    t = doc.add_table(rows=1, cols=3)
    h = t.rows[0].cells
    h[0].text, h[1].text, h[2].text = "Application", "Interactions captured", "Role in process"
    for app, info in apps:
        r = t.add_row().cells
        r[0].text = str(app)
        r[1].text = str((info or {}).get("total_interactions", "—"))
        r[2].text = "—"
    _note(doc, "The role each application plays is to be completed by the analyst.")


# ---- 4.3 As-Is process map --------------------------------------------------

def _write_process_map(doc, process_map_image):
    doc.add_heading("4.3 As-Is process map", level=2)
    if process_map_image and Path(process_map_image).exists() and Inches is not None:
        try:
            doc.add_picture(str(process_map_image), width=Inches(6.0))
            _note(doc, "Directly-follows flow of the captured process.")
            return
        except (FileNotFoundError, OSError, ValueError) as exc:
            logger.warning("pdd_export: could not embed process map %s: %s",
                           process_map_image, exc)
    doc.add_paragraph(
        "The process map (Flow / Process diagram) is available in the viewer; the "
        "rendered diagram is not yet embedded in this document."
    )


# ---- 5.5 Proposed to-be process map (analyst-authored, ADR-0019) ------------

def _write_tobe_map(doc, tobe_map_image):
    """Embed an analyst-authored To-Be reference map, when one was selected for
    the PDD. Unlike the As-Is map (mined from the event log), this is a
    hand-drawn proposal — captioned as such so it can never be mistaken for
    observed evidence. The section is omitted entirely when no To-Be map is
    selected (no empty placeholder)."""
    if not (tobe_map_image and Path(tobe_map_image).exists() and Inches is not None):
        return
    doc.add_heading("5.5 Proposed to-be process", level=2)
    try:
        doc.add_picture(str(tobe_map_image), width=Inches(6.0))
    except (FileNotFoundError, OSError, ValueError) as exc:
        logger.warning("pdd_export: could not embed to-be map %s: %s",
                       tobe_map_image, exc)
        return
    _note(doc, "Analyst-authored proposed future-state process — hand-edited, "
               "NOT mined from the captured events.")


# ---- 4.4 Process statistics -------------------------------------------------

def _has_bnva_override(annotations) -> bool:
    """Has the analyst judged business-required time anywhere? The same
    gate the viewer's Analysis level applies to the efficiency ratio
    (lab-phase §A5/§B3): while every step's bnva_ms sits at the
    heuristic default of 0, the ratio is an artifact of that default."""
    return any(
        isinstance(ov, dict) and ov.get("bnva_ms") is not None
        for ov in (annotations or {}).get("analysis_overrides") or [])


def _write_statistics(doc, stats, analysis, annotations=None):
    doc.add_heading("4.4 Process statistics", level=2)
    meta = stats.get("meta") or {}
    case_stats = stats.get("case_stats") or []
    activity_stats = stats.get("activity_stats") or []
    efficiency = (analysis or {}).get("efficiency") or {}
    tier2 = bool(((analysis or {}).get("case_quality") or {}).get("tier2_unlocked"))

    rows = []
    cc = meta.get("case_count")
    if cc is None and case_stats:
        cc = len(case_stats)
    # Tier-2 gate (§B3): per-case cycle time is case-based analysis -- it
    # renders only when the case segmentation is trustworthy. Below the
    # gate the row is REPLACED by the call to action (after the table).
    if cc is not None and tier2:
        durs = [c.get("active_ms") or c.get("wall_clock_ms") for c in case_stats]
        durs = [d for d in durs if d]
        rows.append(("Cases observed",
                     f"{cc} (avg {_fmt_ms(sum(durs) / len(durs))} each)" if durs else str(cc)))
    sc = meta.get("step_count")
    sb = meta.get("step_state_breakdown") or {}
    if sc is not None:
        auto = (sb.get("auto_suggested", 0) or 0) + (sb.get("auto_matched", 0) or 0)
        conf = (sb.get("manually_authored", 0) or 0) + (sb.get("edited", 0) or 0)
        rows.append(("Steps", f"{sc} ({auto} auto-detected, {conf} confirmed)"))
    if meta.get("phase_count"):
        rows.append(("Phases", str(meta["phase_count"])))
    if activity_stats:
        rows.append(("Distinct activities", str(len(activity_stats))))
    # Honesty gate (§B3, parity with the viewer): the VA/(VA+BNVA+NVA) ratio
    # is WITHHELD until an analyst has set business-required time on at least
    # one step type -- the heuristic defaults bnva to 0, which inflates it.
    if efficiency.get("process_efficiency_ratio") is not None and _has_bnva_override(annotations):
        rows.append(("Process efficiency",
                     f"{round(efficiency['process_efficiency_ratio'] * 100)}% "
                     "value-add (analyst-reviewed split)"))
    if rows:
        _kv_table(doc, rows)
    if not tier2:
        _note(doc, "Case-based statistics (cycle times per case) are withheld: "
                   "this session is not case-segmented to the trust threshold. "
                   "Accepting an anchor or capturing Start/End markers in the "
                   "viewer unlocks them.")
    if efficiency.get("process_efficiency_ratio") is not None and not _has_bnva_override(annotations):
        _note(doc, "A process-efficiency ratio is withheld: the value-add vs "
                   "business-required split is an analyst judgment, and no "
                   "step type has one yet (the heuristic defaults "
                   "business-required to 0, which would inflate the ratio). "
                   "Set business-required minutes in the viewer's Analysis "
                   "level to state it.")

    timed = sorted((a for a in activity_stats if a.get("total_duration_ms")),
                   key=lambda a: a["total_duration_ms"], reverse=True)
    total = sum(a.get("total_duration_ms", 0) for a in activity_stats)
    if timed:
        doc.add_heading("Where the time went", level=3)
        t = doc.add_table(rows=1, cols=3)
        h = t.rows[0].cells
        h[0].text, h[1].text, h[2].text = "Activity", "Share", "Time"
        for a in timed[:8]:
            r = t.add_row().cells
            r[0].text = str(a.get("activity_label", "-"))
            r[1].text = f"{round(a['total_duration_ms'] / total * 100)}%" if total else "-"
            r[2].text = _fmt_ms(a.get("total_duration_ms", 0))

    if activity_stats:
        doc.add_heading("Activity statistics", level=3)
        t = doc.add_table(rows=1, cols=4)
        h = t.rows[0].cells
        h[0].text, h[1].text, h[2].text, h[3].text = "Activity", "Frequency", "Total time", "Median"
        for row in activity_stats[:25]:
            r = t.add_row().cells
            r[0].text = str(row.get("activity_label", "-"))
            r[1].text = str(row.get("frequency", "-"))
            r[2].text = _fmt_ms(row.get("total_duration_ms", 0))
            r[3].text = _fmt_ms(row.get("median_ms", 0))
        if len(activity_stats) > 25:
            _note(doc, f"Showing 25 of {len(activity_stats)} activities.")


# ---- 4.5 Detailed process steps ---------------------------------------------

def _analysis_maps(analysis):
    analysis = analysis or {}
    waste = {w["step_id"]: w for w in (analysis.get("waste_classification") or [])
             if w.get("step_id")}
    return waste


def _write_steps(doc, annotations, session_folder, analysis):
    doc.add_heading("4.5 Detailed process steps", level=2)
    phases = annotations.get("phases") or []
    # Noise-suppressed steps are hidden everywhere else in the pipeline; the
    # PDD honours that convention too (M-5).
    steps = [s for s in (annotations.get("steps") or [])
             if s.get("state") != "hidden"]
    step_by_id = {s["step_id"]: s for s in steps}
    waste_by_step = _analysis_maps(analysis)
    if phases:
        phased_ids = set()
        for phase in phases:
            doc.add_heading(phase.get("name", "(phase)"), level=3)
            if phase.get("description"):
                doc.add_paragraph(phase["description"])
            for sid in (phase.get("step_ids") or []):
                phased_ids.add(sid)
                step = step_by_id.get(sid)
                if step:
                    _write_step(doc, step, session_folder, waste_by_step, level=4)
        # Steps belonging to no phase -- unmatched steps and analyst-authored
        # steps -- would otherwise silently vanish (H-2). Render them under
        # their own subsection, preserving the original step ordering.
        unphased = [s for s in steps if s["step_id"] not in phased_ids]
        if unphased:
            doc.add_heading("Unphased steps", level=3)
            for step in unphased:
                _write_step(doc, step, session_folder, waste_by_step, level=4)
    elif steps:
        for step in steps:
            _write_step(doc, step, session_folder, waste_by_step, level=3)
    else:
        doc.add_paragraph("No steps have been annotated for this session yet.")


def _write_step(doc, step, session_folder, waste_by_step=None, level=3):
    doc.add_heading(step.get("name", "(step)"), level=level)
    if step.get("description"):
        doc.add_paragraph(step["description"])
    for ref in (step.get("evidence", {}).get("screenshot_refs") or []):
        # `ref` is untrusted (it comes from annotations.json). pathlib honours
        # absolute paths and `..`, so a malicious ref could embed an off-folder
        # image into the export. Resolve and require containment (SEC Vuln 2).
        if Path(ref).is_absolute():
            logger.warning("pdd_export: skipping absolute screenshot ref %s for step %s",
                           ref, step.get("step_id", "?"))
            continue
        full = (session_folder / ref).resolve()
        base = session_folder.resolve()
        if base != full and base not in full.parents:
            logger.warning("pdd_export: skipping out-of-folder screenshot ref %s for step %s",
                           ref, step.get("step_id", "?"))
            continue
        if full.exists() and Inches is not None:
            try:
                doc.add_picture(str(full), width=Inches(4.5))
            except (FileNotFoundError, OSError, ValueError) as exc:
                logger.warning("pdd_export: skipping screenshot %s for step %s: %s",
                               ref, step.get("step_id", "?"), exc)
    # ADR-0027: `waste` is the only per-step flag. Path/segment concerns
    # (exceptions, automation candidacy — §4.3/§5) are not per-step.
    flags = [k for k, v in (step.get("flags") or {}).items() if v is True]
    if flags:
        labels = [_FLAG_LABELS.get(f, f.replace("_", " ").capitalize()) for f in flags]
        p = doc.add_paragraph(f"Flags: {', '.join(labels)}")
        for run in p.runs:
            run.italic = True

    sid = step.get("step_id")
    waste = (waste_by_step or {}).get(sid)
    if waste:
        bits = []
        if waste.get("nva_ms"):
            bits.append(f"{_fmt_ms(waste['nva_ms'])} non-value-add")
        if waste.get("waste_types"):
            bits.append("waste types: " + ", ".join(waste["waste_types"]))
        if bits:
            p = doc.add_paragraph("Waste: " + "; ".join(bits))
            for run in p.runs:
                run.italic = True


# ---- 4.6 Input data ---------------------------------------------------------

def _write_input_data(doc):
    doc.add_heading("4.6 Input data", level=2)
    doc.add_paragraph(
        "The data the process consumes and produces is visible inline in the "
        "detailed step descriptions above (entered values, selected options)."
    )
    _placeholder(doc, "a consolidated list of the inputs the process requires "
                      "(source, format, mandatory vs optional)")


# ---- 5. Automation assessment -----------------------------------------------

def _write_automation(doc, analysis):
    """Render §4 with the segment grain (ADR-0016): "a coherent stretch of
    work, ideally end-to-end" rather than a per-click table. A row says
    "the CRM lookup → copy → paste sequence ran 4× across cases, total
    2m 14s" -- a unit you can actually scope to a robot, not a single
    button-click."""
    doc.add_heading("5. Automation assessment", level=1)
    doc.add_heading("5.1 In scope for automation", level=2)
    _placeholder(doc, "which segments / sub-processes are in scope for automation")
    doc.add_heading("5.2 Out of scope", level=2)
    _placeholder(doc, "which segments / sub-processes are explicitly out of scope")

    doc.add_heading("5.3 Automation candidates", level=2)
    doc.add_paragraph(
        "Candidacy is evaluated at the level of a coherent segment -- a "
        "contiguous run of work in one application within one case, such "
        "as a lookup followed by a copy-paste sequence. An individual "
        "click or keystroke is not a meaningful automation unit on its "
        "own (you cannot have a human fill a form, a robot click Search, "
        "then a human continue); segments capture the smallest stretch a "
        "robot can realistically take end-to-end."
    )
    cands = [a for a in ((analysis or {}).get("automation_candidates") or [])
             if a.get("data_sufficiency") == "multi_instance"]
    if not cands:
        _placeholder(doc, "coherent segments with automation potential (this "
                          "capture lacks the repetition needed to identify "
                          "candidates automatically -- consider loading more "
                          "sessions of this process)")
        return

    t = doc.add_table(rows=1, cols=6)
    h = t.rows[0].cells
    h[0].text = "Rank"
    h[1].text = "Segment"
    h[2].text = "Application"
    h[3].text = "Instances"
    h[4].text = "Total time"
    h[5].text = "Mean per instance"
    for i, a in enumerate(cands, start=1):
        r = t.add_row().cells
        r[0].text = str(a.get("rank") or i)
        r[1].text = str(a.get("label", "(segment)"))
        r[2].text = str(a.get("app", "—")).replace(".exe", "") or "—"
        r[3].text = str(a.get("instance_count", 0))
        r[4].text = _fmt_ms(a.get("total_elapsed_ms", 0))
        r[5].text = _fmt_ms(a.get("mean_elapsed_ms", 0))

    _note(doc, "An instance is one execution of the segment within one case; "
               "segments grouped here share the same application and the same "
               "ordered list of step types. Rank orders the candidates by "
               "automation priority — frequency × mean time per instance × the "
               "automatable fraction — so the highest-leverage segment is first.")

    # Narrative summary for the analyst: the top 3 segments, expressed as
    # prose so §4.3 reads like a recommendation, not just a grid.
    top = cands[:3]
    if top:
        doc.add_heading("Suggested focus", level=3)
        for a in top:
            steps = a.get("step_labels") or []
            seq = " → ".join(steps[:4]) if steps else "an interaction sequence"
            tail = "" if len(steps) <= 4 else f" → … (+{len(steps) - 4} more)"
            p = doc.add_paragraph(
                f'The "{seq}{tail}" sequence in '
                f'{str(a.get("app", "")).replace(".exe", "")} ran '
                f'{a.get("instance_count", 0)}× across the captured cases '
                f'(total elapsed {_fmt_ms(a.get("total_elapsed_ms", 0))}, '
                f'mean {_fmt_ms(a.get("mean_elapsed_ms", 0))} per instance). '
                "Suggested automation: scope this segment as a single, "
                "end-to-end automation unit."
            )
            for run in p.runs:
                run.italic = True


# ---- 5.4 Estimated ROI ------------------------------------------------------

_CCY_SYMBOLS = {"EUR": "€", "USD": "$", "GBP": "£"}


def _fmt_money(amount, currency):
    if amount is None:
        return "—"
    sym = _CCY_SYMBOLS.get(currency, "")
    s = f"{round(amount):,}"
    return f"{sym}{s}" if sym else f"{s} {currency}"


def _write_roi(doc, analysis):
    """Render §4.4 -- the €-ROI band over the automation candidates (§10).

    A row per candidate segment carries the time saved per year and, when the
    analyst has supplied a loaded labour rate and an annual volume, the net
    annual saving and payback as a conservative / expected / optimistic band.
    When monetary inputs are absent the section still reports the hours-saved
    band and explicitly flags that the € figures need analyst inputs -- it
    never fabricates a labour rate."""
    roi = (analysis or {}).get("roi") or {}
    cands = roi.get("candidates") or []
    doc.add_heading("5.4 Estimated ROI", level=2)
    if not cands:
        _placeholder(doc, "the annual time and cost savings of automating the "
                          "candidate segments (no multi-instance candidates "
                          "were detected, so no ROI band could be computed)")
        return

    currency = roi.get("currency") or "EUR"
    needs_input = roi.get("needs_input")
    doc.add_paragraph(
        "Each candidate segment is projected to an annual saving using the "
        "observed mean instance duration, an automatable fraction, an annual "
        "volume, and a loaded labour cost. The figures are reported as a "
        "conservative / expected / optimistic band rather than a single number."
    )
    if needs_input:
        _note(doc, "Monetary figures require a loaded cost per hour (and an "
                   "annual volume) in the session's ROI inputs; only the "
                   "hours-saved band is shown below until those are supplied.")

    t = doc.add_table(rows=1, cols=5)
    h = t.rows[0].cells
    h[0].text = "Segment"
    h[1].text = "Hours/yr (cons.–opt.)"
    h[2].text = "Net/yr (expected)"
    h[3].text = "Payback (expected)"
    h[4].text = "Volume basis"
    for r in cands:
        bands = r.get("bands") or {}
        cons = (bands.get("conservative") or {}).get("saved_hours_per_year")
        opt = (bands.get("optimistic") or {}).get("saved_hours_per_year")
        exp = bands.get("expected") or {}
        row = t.add_row().cells
        row[0].text = str(r.get("label", "(segment)"))
        row[1].text = (f"{cons:g}–{opt:g} h"
                       if cons is not None and opt is not None else "—")
        row[2].text = _fmt_money(exp.get("net_annual"), currency)
        pm = exp.get("payback_months")
        row[3].text = f"{pm:g} mo" if pm is not None else "—"
        row[4].text = ("annual" if r.get("volume_basis") in ("annotated", "default")
                       else "observed (floor)")

    totals = roi.get("totals") or {}
    th = totals.get("saved_hours_per_year")
    tnet = totals.get("net_annual")
    if th is not None:
        bits = [f"{th:g} hours/yr saved (expected)"]
        if tnet is not None:
            bits.append(f"{_fmt_money(tnet, currency)} net annual (expected)")
        doc.add_paragraph("Estimated total across candidate segments: "
                          + "; ".join(bits) + ".")
    _note(doc, "ROI is a planning estimate, not a guarantee: it assumes the "
               "supplied annual volume and labour rate hold and that the "
               "automation captures the stated automatable fraction.")


# ---- 6. Exceptions & variations ---------------------------------------------

def _write_exceptions(doc, annotations, stats, analysis=None):
    doc.add_heading("6. Exceptions & variations", level=1)
    # ADR-0027: an exception/variation is a property of a PATH, not a single
    # step, so this section is DERIVED from the observed trace variants (the most
    # frequent path is the norm; every other distinct sequence is a variation) —
    # not from the retired per-step exception_path/conditional flags. Rework
    # loops (a repeated activity within a case) are listed as process rework.
    variants = sorted((stats.get("trace_variants") or []),
                      key=lambda v: v.get("frequency", 0), reverse=True)
    rework = stats.get("rework_loops") or []
    tier2 = bool(((analysis or {}).get("case_quality") or {}).get("tier2_unlocked"))

    doc.add_heading("6.1 Process variations", level=2)
    # Tier-2 gate (§B3): a "variant" is a per-CASE path -- on an unsegmented
    # session every event pools into one default bucket and the variant table
    # would be an artifact, so it is REPLACED by the call to action.
    if not tier2:
        _note(doc, "Path variants are case-based analysis and are withheld: "
                   "this session is not case-segmented to the trust threshold. "
                   "Accepting an anchor or capturing Start/End markers in the "
                   "viewer unlocks them.")
    elif len(variants) > 1:
        norm_freq = variants[0].get("frequency", 0)
        t = doc.add_table(rows=1, cols=3)
        h = t.rows[0].cells
        h[0].text, h[1].text, h[2].text = "Variation", "Times seen", "Observed path"
        for i, v in enumerate(variants[1:], start=1):
            r = t.add_row().cells
            r[0].text = f"Variation {i}"
            r[1].text = str(v.get("frequency", 0))
            seq = v.get("variant") or []
            r[2].text = " → ".join(str(x) for x in seq) if seq else "-"
        _note(doc, f"The dominant path (seen {norm_freq}×) is the norm; each "
                   "row above is an observed deviation. The expected handling for "
                   "each is to be completed by the analyst.")
    elif variants:
        doc.add_paragraph(
            "No process variations observed — every case followed the same path.")
    else:
        _placeholder(doc, "known business exceptions and how the operator handles each")

    doc.add_heading("6.2 Rework", level=2)
    if rework:
        t = doc.add_table(rows=1, cols=2)
        h = t.rows[0].cells
        h[0].text, h[1].text = "Activity", "Times repeated"
        for rl in rework:
            r = t.add_row().cells
            r[0].text = str(rl.get("activity_label", "-"))
            r[1].text = str(rl.get("rework_count", 0))
    else:
        _placeholder(doc, "repeated work within a case (none observed in this capture)")

    doc.add_heading("6.3 Application errors", level=2)
    _placeholder(doc, "system / application errors that can interrupt the process and "
                      "the recovery steps for each")


# ---- footer & formatting ----------------------------------------------------

def _write_footer(doc):
    _note(doc, "Generated by the Process Discovery Viewer on "
               + datetime.now(timezone.utc).strftime("%Y-%m-%d") + ".")


def _fmt_ms(ms):
    if ms is None:
        return "-"
    s = ms / 1000
    if s < 60:
        return f"{s:.1f}s"
    if s < 3600:
        return f"{int(s // 60)}m {int(s % 60)}s"
    return f"{int(s // 3600)}h {int((s % 3600) // 60)}m"
