"""Generate a Process Definition Document (.docx) from a normalized session.

The structure mirrors a standard RPA PDD (cf. the document UiPath Task Capture
generates from a recorded process): document control, an introduction, an As-Is
process description (overview, applications, map, statistics, detailed steps,
input data), an automation assessment, and an exceptions/variations section.

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
    "conditional": "Conditional",
    "exception_path": "Exception path",
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
    _write_title(doc, manifest, canonical)            # 1. Document control
    _write_introduction(doc, manifest)                # 2. Introduction

    doc.add_heading("3. As-Is Process", level=1)
    _write_overview(doc, stats, manifest, canonical)  # 3.1 Process overview
    _write_applications(doc, stats)                   # 3.2 Applications used
    _write_process_map(doc, process_map_image)        # 3.3 As-Is process map
    _write_statistics(doc, stats, analysis)           # 3.4 Process statistics
    _write_steps(doc, annotations, session_folder, analysis)  # 3.5 Detailed steps
    _write_input_data(doc)                            # 3.6 Input data

    _write_automation(doc, analysis)                  # 4. Automation assessment
    _write_exceptions(doc, annotations)               # 5. Exceptions & variations
    _write_footer(doc)

    doc.save(str(out_path))


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


# ---- 1. Document control ----------------------------------------------------

def _write_title(doc, manifest, canonical):
    doc.add_heading("Process Definition Document", level=0)
    proc_name = (canonical or {}).get("name")
    if proc_name:
        sub = doc.add_paragraph()
        sub.add_run(proc_name).bold = True

    doc.add_heading("1. Document control", level=1)
    worker = (manifest.get("config", {}).get("worker") or {}).get("id", "-")
    _kv_table(doc, [
        ("Engagement", manifest.get("engagement_id") or "-"),
        ("Process", proc_name or "-"),
        ("Prepared from recording by", worker),
        ("Captured", manifest.get("started_at", "-")),
        ("Document generated", datetime.now(timezone.utc).strftime("%Y-%m-%d")),
        ("Version", str((canonical or {}).get("version") or "Draft")),
    ])


# ---- 2. Introduction --------------------------------------------------------

def _write_introduction(doc, manifest):
    doc.add_heading("2. Introduction", level=1)
    doc.add_heading("2.1 Purpose", level=2)
    _placeholder(doc, "the business need this process serves and why it is being "
                      "documented / considered for automation")
    doc.add_heading("2.2 Objectives", level=2)
    _placeholder(doc, "what this document and any resulting automation aim to achieve")
    doc.add_heading("2.3 Key contacts", level=2)
    worker = (manifest.get("config", {}).get("worker") or {}).get("id", "-")
    t = doc.add_table(rows=1, cols=3)
    h = t.rows[0].cells
    h[0].text, h[1].text, h[2].text = "Name", "Role", "Contact"
    r = t.add_row().cells
    r[0].text, r[1].text, r[2].text = str(worker), "Process operator (recorded)", "—"
    _placeholder(doc, "the process owner, SME, and automation lead")


# ---- 3.1 Process overview ---------------------------------------------------

def _write_overview(doc, stats, manifest, canonical):
    doc.add_heading("3.1 Process overview", level=2)
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


# ---- 3.2 Applications used --------------------------------------------------

def _write_applications(doc, stats):
    doc.add_heading("3.2 Applications used", level=2)
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


# ---- 3.3 As-Is process map --------------------------------------------------

def _write_process_map(doc, process_map_image):
    doc.add_heading("3.3 As-Is process map", level=2)
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


# ---- 3.4 Process statistics -------------------------------------------------

def _write_statistics(doc, stats, analysis):
    doc.add_heading("3.4 Process statistics", level=2)
    meta = stats.get("meta") or {}
    case_stats = stats.get("case_stats") or []
    activity_stats = stats.get("activity_stats") or []
    efficiency = (analysis or {}).get("efficiency") or {}

    rows = []
    cc = meta.get("case_count")
    if cc is None and case_stats:
        cc = len(case_stats)
    if cc is not None:
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
    if efficiency.get("process_efficiency_ratio") is not None:
        rows.append(("Process efficiency",
                     f"{round(efficiency['process_efficiency_ratio'] * 100)}% "
                     "value-add (heuristic estimate)"))
    if rows:
        _kv_table(doc, rows)

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


# ---- 3.5 Detailed process steps ---------------------------------------------

def _analysis_maps(analysis):
    analysis = analysis or {}
    waste = {w["step_id"]: w for w in (analysis.get("waste_classification") or [])
             if w.get("step_id")}
    return waste


def _write_steps(doc, annotations, session_folder, analysis):
    doc.add_heading("3.5 Detailed process steps", level=2)
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
    # `automation_candidate` is filtered out -- candidacy lives at the
    # segment grain (§4.3), not on individual steps. See ADR-0016.
    flags = [k for k, v in (step.get("flags") or {}).items()
             if v is True and k != "automation_candidate"]
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


# ---- 3.6 Input data ---------------------------------------------------------

def _write_input_data(doc):
    doc.add_heading("3.6 Input data", level=2)
    doc.add_paragraph(
        "The data the process consumes and produces is visible inline in the "
        "detailed step descriptions above (entered values, selected options)."
    )
    _placeholder(doc, "a consolidated list of the inputs the process requires "
                      "(source, format, mandatory vs optional)")


# ---- 4. Automation assessment -----------------------------------------------

def _write_automation(doc, analysis):
    """Render §4 with the segment grain (ADR-0016): "a coherent stretch of
    work, ideally end-to-end" rather than a per-click table. A row says
    "the CRM lookup → copy → paste sequence ran 4× across cases, total
    2m 14s" -- a unit you can actually scope to a robot, not a single
    button-click."""
    doc.add_heading("4. Automation assessment", level=1)
    doc.add_heading("4.1 In scope for automation", level=2)
    _placeholder(doc, "which segments / sub-processes are in scope for automation")
    doc.add_heading("4.2 Out of scope", level=2)
    _placeholder(doc, "which segments / sub-processes are explicitly out of scope")

    doc.add_heading("4.3 Automation candidates", level=2)
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

    t = doc.add_table(rows=1, cols=5)
    h = t.rows[0].cells
    h[0].text = "Segment"
    h[1].text = "Application"
    h[2].text = "Instances"
    h[3].text = "Total time"
    h[4].text = "Mean per instance"
    for a in cands:
        r = t.add_row().cells
        r[0].text = str(a.get("label", "(segment)"))
        r[1].text = str(a.get("app", "—")).replace(".exe", "") or "—"
        r[2].text = str(a.get("instance_count", 0))
        r[3].text = _fmt_ms(a.get("total_elapsed_ms", 0))
        r[4].text = _fmt_ms(a.get("mean_elapsed_ms", 0))

    _note(doc, "An instance is one execution of the segment within one case; "
               "segments grouped here share the same application and the same "
               "ordered list of step types.")

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


# ---- 5. Exceptions & variations ---------------------------------------------

def _write_exceptions(doc, annotations):
    doc.add_heading("5. Exceptions & variations", level=1)
    # Skip noise-suppressed steps, consistent with §3.5 and the rest of the
    # pipeline (M-5).
    steps = [s for s in (annotations.get("steps") or [])
             if s.get("state") != "hidden"]
    flagged = [s for s in steps
               if (s.get("flags") or {}).get("exception_path")
               or (s.get("flags") or {}).get("conditional")]

    doc.add_heading("5.1 Business exceptions", level=2)
    if flagged:
        t = doc.add_table(rows=1, cols=3)
        h = t.rows[0].cells
        h[0].text, h[1].text, h[2].text = "Step", "Observed variation", "Expected handling"
        for s in flagged:
            fl = s.get("flags") or {}
            kinds = []
            if fl.get("conditional"):
                kinds.append("conditional (branches)")
            if fl.get("exception_path"):
                kinds.append("exception path")
            r = t.add_row().cells
            r[0].text = str(s.get("name", "(step)"))
            r[1].text = ", ".join(kinds) or "-"
            r[2].text = "—"
        _note(doc, "The expected handling for each exception is to be completed by the analyst.")
    else:
        _placeholder(doc, "known business exceptions and how the operator handles each "
                          "(none were flagged in this capture)")

    doc.add_heading("5.2 Application errors", level=2)
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
