"""Generate a Process Definition Document .docx from a session +
canonical step set. Uses python-docx. Mirrors the team's existing
PDD format.
"""

from __future__ import annotations
import logging
from pathlib import Path

try:
    from docx import Document
    from docx.shared import Pt, Inches
except ImportError:
    Document = None
    Inches = None

logger = logging.getLogger(__name__)


def write_pdd(
    out_path: Path,
    *,
    session_folder: Path,
    canonical: dict | None,
    annotations: dict,
    stats: dict,
    manifest: dict,
    analysis: dict | None = None,
) -> None:
    if Document is None:
        raise RuntimeError(
            "python-docx is not installed. Add `python-docx>=1.1.0` to "
            "normalization/requirements.txt and reinstall."
        )

    doc = Document()
    doc.add_heading("Process Definition Document", level=0)
    eng = manifest.get("engagement_id") or "Engagement"
    doc.add_paragraph(f"Engagement: {eng}")
    worker_id = (manifest.get("config", {}).get("worker") or {}).get("id", "-")
    doc.add_paragraph(f"Worker: {worker_id}")
    doc.add_paragraph(f"Captured: {manifest.get('started_at', '-')}")

    if canonical:
        doc.add_heading(f"Process: {canonical.get('name', '-')}", level=1)
        doc.add_paragraph(f"Canonical version: {canonical.get('version', '-')}")

    # Analysis-layer context (Cluster N / ADR-0008). analysis.json is
    # absent on sessions normalized before the analysis layer existed;
    # the per-step enrichment is simply skipped when it is.
    analysis = analysis or {}
    waste_by_step = {
        w["step_id"]: w
        for w in (analysis.get("waste_classification") or [])
        if w.get("step_id")
    }
    auto_by_step = {
        a["step_id"]: a
        for a in (analysis.get("automation_candidates") or [])
        if a.get("step_id")
    }
    efficiency = analysis.get("efficiency") or {}
    if efficiency.get("process_efficiency_ratio") is not None:
        pct = round(efficiency["process_efficiency_ratio"] * 100)
        doc.add_paragraph(
            f"Process efficiency: {pct}% value-add time (heuristic "
            "estimate -- review before relying on it)."
        )

    # Phase-by-phase narrative
    phases = annotations.get("phases", []) or []
    steps = annotations.get("steps", []) or []
    step_by_id = {s["step_id"]: s for s in steps}

    if phases:
        for phase in phases:
            doc.add_heading(phase["name"], level=2)
            if phase.get("description"):
                doc.add_paragraph(phase["description"])
            contained = [step_by_id.get(sid) for sid in (phase.get("step_ids") or [])]
            contained = [s for s in contained if s]
            for step in contained:
                _write_step(doc, step, session_folder, waste_by_step, auto_by_step)
    elif steps:
        doc.add_heading("Steps", level=1)
        for step in steps:
            _write_step(doc, step, session_folder, waste_by_step, auto_by_step)

    # Statistics table
    if stats and stats.get("activity_stats"):
        doc.add_heading("Activity statistics", level=1)
        table = doc.add_table(rows=1, cols=4)
        hdr = table.rows[0].cells
        hdr[0].text = "Activity"
        hdr[1].text = "Frequency"
        hdr[2].text = "Total time"
        hdr[3].text = "Median"
        for row in stats["activity_stats"][:25]:
            r = table.add_row().cells
            r[0].text = str(row["activity_label"])
            r[1].text = str(row["frequency"])
            r[2].text = _fmt_ms(row.get("total_duration_ms", 0))
            r[3].text = _fmt_ms(row.get("median_ms", 0))

    doc.save(str(out_path))


def _write_step(doc, step, session_folder, waste_by_step=None, auto_by_step=None):
    doc.add_heading(step["name"], level=3)
    if step.get("description"):
        doc.add_paragraph(step["description"])
    for ref in (step.get("evidence", {}).get("screenshot_refs") or []):
        full = session_folder / ref
        if full.exists():
            try:
                doc.add_picture(str(full), width=Inches(4.5))
            except (FileNotFoundError, OSError, ValueError) as exc:
                logger.warning(
                    "pdd_export: skipping screenshot %s for step %s: %s",
                    ref, step.get("step_id", "?"), exc,
                )
    flags = [k for k, v in (step.get("flags") or {}).items() if v is True]
    if flags:
        p = doc.add_paragraph(f"Flags: {', '.join(flags)}")
        for run in p.runs:
            run.italic = True

    # Analysis-layer context (Cluster N), when analysis.json was present.
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
    auto = (auto_by_step or {}).get(sid)
    if auto and auto.get("data_sufficiency") == "multi_instance":
        rep = (auto.get("scores") or {}).get("repetitiveness")
        if rep is not None:
            p = doc.add_paragraph(
                f"Automation potential: repetitiveness {round(rep * 100)}%"
            )
            for run in p.runs:
                run.italic = True


def _fmt_ms(ms):
    if ms is None: return "-"
    s = ms / 1000
    if s < 60: return f"{s:.1f}s"
    return f"{int(s // 60)}m {int(s % 60)}s"
