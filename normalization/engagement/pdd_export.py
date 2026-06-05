"""PDD bundle export — markdown + simple PDF.

PDT-1.0-SPEC §6.2. One Process Discovery Document per promoted process,
assembled from measured numbers + templated prose (no LLM in Phase 0;
the scoped Naming Layer in Phase 4 will draft the executive-summary
paragraph).

The PDF generation is a *minimal* PDF writer (single-page text only, no
deps) — the rich PDF is a Phase 4+ deliverable. For now the PDD is
mostly a Markdown file plus a basic PDF for client circulation.
"""

from __future__ import annotations

import io
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _fmt_duration(ms: int | float) -> str:
    if not ms or ms <= 0:
        return "—"
    s = round(ms / 1000)
    h = s // 3600
    m = (s % 3600) // 60
    if h:
        return f"{h}h {m}m"
    if m:
        return f"{m}m"
    return f"{s}s"


def _pdd_markdown(
    process: dict[str, Any],
    engagement: dict[str, Any],
    *,
    cached_prose: dict[str, Any] | None = None,
) -> str:
    """Generate the Markdown PDD for one process row.

    PDT-1.0-SPEC §3.2: §1 executive-summary paragraph drafted by the LLM
    Naming Layer when reachable; deterministic template fallback otherwise.
    All numerical content is templated from measurements — the LLM never
    produces numbers (ADR-0028).

    `cached_prose` is the dict returned by draft_exec_summary() — passed in
    so the markdown + PDF writers for the SAME row use the SAME prose. The
    LLM is non-deterministic at temperature 0.2; calling it twice can
    produce different results (one passing the hallucination guard, one
    falling back to template) and the MD/PDF would diverge. Cache once
    in export_pdd_bundle, pass to both writers.
    """
    name = process.get("label") or "(unnamed process)"
    rank = process.get("rank", "—")
    apps = ", ".join(process.get("apps") or [])
    instance_count = process.get("instance_count", 0)
    case_count = process.get("case_count", 0)
    session_count = process.get("session_count", 0)
    mean = process.get("mean_elapsed_ms", 0)
    confidence = process.get("confidence", 0)
    variant_ok = process.get("variant_data_sufficient", False)
    sig = process.get("signature", "")
    ai_named = process.get("ai_named", False)

    engagement_name = engagement.get("name") or "Engagement"
    client = engagement.get("client") or "Client"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # PDT-1.0-SPEC §3.2: LLM-drafted exec-summary prose (no numbers).
    # Best-effort: import lazily, and probe BOTH the package path (when
    # normalization/ is a top-level package, e.g. tests) and the sibling
    # path (when normalize.py adds normalization/ to sys.path directly,
    # which is what the embedded viewer Python does). One of the two must
    # work; both failing means the naming subpackage is genuinely absent.
    exec_prose = None
    exec_source = "template"
    if cached_prose is not None:
        # Use the cached prose result so MD and PDF agree, even when the
        # LLM is on and producing different outputs across calls.
        exec_prose = cached_prose.get("prose")
        exec_source = cached_prose.get("source", "template")
    else:
        try:
            try:
                from normalization.naming import draft_exec_summary  # type: ignore
            except ImportError:
                from naming import draft_exec_summary  # type: ignore
            prose_result = draft_exec_summary(process)
            exec_prose = prose_result.get("prose")
            exec_source = prose_result.get("source", "template")
        except Exception as _e:
            exec_prose = None

    summary_sentence = (
        f"This process was observed **{instance_count}× across "
        f"{case_count} cases** in {session_count} session"
        f"{'s' if session_count != 1 else ''}, with an average duration of "
        f"**{_fmt_duration(mean)}**."
    )
    if not variant_ok:
        summary_sentence += (
            " *Variant analysis is suppressed — fewer than 3 cases observed.*"
        )

    lines = [
        f"# Process Discovery Document",
        "",
        f"**Process:** {name}" + (" *(AI-named)*" if ai_named else ""),
        f"**Engagement:** {engagement_name} ({client})",
        f"**Rank:** #{rank} of the engagement backlog",
        f"**Generated:** {today}",
        f"**Signature:** `{sig}`",
        "",
        "---",
        "",
        "## 1. Process at a glance",
        "",
    ]
    # LLM-drafted prose (if available) goes first; the measured-numbers
    # sentence is templated and always follows. This separation enforces
    # the no-numbers-from-LLM rule. When the LLM refused or hallucinated
    # we fall back to the templated paragraph emitted by draft_exec_summary
    # itself — still inserted, still labelled "templated" in the footer so
    # the consultant sees provenance honestly.
    if exec_prose:
        lines.append(exec_prose)
        lines.append("")
    lines.extend([
        summary_sentence,
        "",
        f"- **Applications involved:** {apps or '—'}",
        f"- **Confidence:** {round(confidence * 100)}%",
        f"- **Observations:** {instance_count}",
        f"- **Cases:** {case_count}" +
        ("" if variant_ok else " *(below the 3-case threshold for variant analysis)*"),
        "",
        "## 2. What we observed",
        "",
        "The following pattern was identified across the captured sessions. "
        "Each occurrence was a contiguous run of interactions on the listed "
        "applications, bounded by an app switch or case boundary. The full "
        "interaction-level evidence is in `evidence.json` alongside this PDD.",
        "",
        "## 3. Where the time goes",
        "",
        f"Average duration per execution: **{_fmt_duration(mean)}**.",
        f"Total observed time spent in this process: **{_fmt_duration(process.get('total_elapsed_ms', 0))}**.",
        "",
        "## 4. Automation candidacy",
        "",
        "This process is a candidate for automation because it repeats with "
        "a recognisable structure across multiple cases. The €-ROI band in "
        "the backlog spreadsheet is computed from the observed duration × "
        "annual volume (annotated or observed-floor) × a labour rate × "
        "realism factors — never from an LLM. See the backlog row and the "
        "engagement-level `analysis.json` for the per-band figures.",
        "",
        "## 5. Recommended next steps",
        "",
        f"1. **Validate the activity name** — confirm or correct *{name}* with the process owner.",
        "2. **Confirm the annual volume** — the backlog figure may be the "
        "observed floor; an annotated annual volume yields a defensible band.",
        "3. **Estimate automation cost** — RPA scope plus integration effort. "
        "Set `roi_inputs.automation_cost` to make the net-annual band concrete.",
        "4. **Promote or defer** — high-confidence + high rank → promote to the "
        "automation pilot list; low-confidence → return to Workshop / Analysis "
        "for verification.",
        "",
        "## 6. Evidence index",
        "",
        f"This PDD draws on **{session_count} session"
        f"{'s' if session_count != 1 else ''}** containing **{case_count} case"
        f"{'s' if case_count != 1 else ''}**. See `evidence.json` for the "
        "session and case identifiers backing every claim above.",
        "",
        "---",
        "",
        "*Generated by PDT 1.0. Numbers above are measurements; surrounding "
        "prose is " +
        ("LLM-drafted (local model, no raw events)" if exec_source == "llm" else "templated") +
        ". Per the integrity backbone, no AI-generated number reaches this "
        "deliverable.*",
        "",
    ])
    return "\n".join(lines)


def write_pdd_markdown(
    process: dict[str, Any],
    engagement: dict[str, Any],
    out_path: str | os.PathLike,
    *,
    cached_prose: dict[str, Any] | None = None,
) -> str:
    """Write the PDD markdown for one process. Returns the path written."""
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    md = _pdd_markdown(process, engagement, cached_prose=cached_prose)
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(md)
    return str(p)


# ---- Minimal PDF writer (single-page text only, no deps) ----
#
# Phase 0 ships the PDD as Markdown; the rich PDF (with BPMN thumbnails,
# evidence screenshots, etc.) is a Phase 4+ deliverable. This minimal PDF
# is for clients who insist on a circulated PDF — it's a wrapped text
# rendering of the same content, single A4 page, no formatting.

def _pdf_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def write_pdd_pdf(
    process: dict[str, Any],
    engagement: dict[str, Any],
    out_path: str | os.PathLike,
    *,
    cached_prose: dict[str, Any] | None = None,
) -> str:
    """Write a minimal single-page PDF rendering of the PDD."""
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    md = _pdd_markdown(process, engagement, cached_prose=cached_prose)
    # Strip markdown syntax for plain-text PDF.
    plain = re.sub(r"[*_`#-]", "", md)
    # Wrap to ~90 char lines.
    wrapped: list[str] = []
    for line in plain.splitlines():
        line = line.rstrip()
        while len(line) > 90:
            cut = line.rfind(" ", 0, 90)
            if cut == -1:
                cut = 90
            wrapped.append(line[:cut])
            line = line[cut:].lstrip()
        wrapped.append(line)
    # PDF document: 5 objects (catalog, pages, page, content, font).
    # Each line drawn at y descending; A4 = 595 x 842, top margin 60.
    content_lines = ["BT", "/F1 9 Tf", "60 800 Td", "12 TL"]
    for w in wrapped[:90]:   # safety cap; PDF is single-page only
        content_lines.append(f"({_pdf_escape(w)}) Tj T*")
    content_lines.append("ET")
    content_stream = "\n".join(content_lines).encode("latin-1", errors="replace")
    pdf = io.BytesIO()
    def w(b: bytes) -> int:
        pos = pdf.tell()
        pdf.write(b)
        return pos
    # Header
    w(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    offsets.append(w(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"))
    offsets.append(w(b"2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n"))
    offsets.append(w(
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n"
    ))
    offsets.append(w(
        f"4 0 obj\n<< /Length {len(content_stream)} >>\nstream\n".encode("latin-1")
    ))
    pdf.write(content_stream)
    w(b"\nendstream\nendobj\n")
    offsets.append(w(b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"))
    xref_pos = pdf.tell()
    pdf.write(b"xref\n0 6\n")
    pdf.write(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        pdf.write(f"{off:010d} 00000 n \n".encode("latin-1"))
    pdf.write(b"trailer\n<< /Size 6 /Root 1 0 R >>\n")
    pdf.write(f"startxref\n{xref_pos}\n%%EOF\n".encode("latin-1"))
    with open(p, "wb") as fh:
        fh.write(pdf.getvalue())
    return str(p)


def export_pdd_bundle(
    backlog: dict[str, Any],
    engagement: dict[str, Any],
    out_folder: str | os.PathLike,
) -> dict[str, list[str]]:
    """Export one PDD (markdown + minimal PDF) per backlog row to out_folder."""
    out = Path(out_folder)
    out.mkdir(parents=True, exist_ok=True)
    md_files: list[str] = []
    pdf_files: list[str] = []
    # Lazy import so the bundle still exports when the naming subpackage
    # isn't reachable (e.g., the embedded Python's sys.path quirks).
    try:
        try:
            from normalization.naming import draft_exec_summary  # type: ignore
        except ImportError:
            from naming import draft_exec_summary  # type: ignore
    except Exception:
        draft_exec_summary = None
    for row in backlog.get("rows", []):
        sig = row.get("signature", "")[:12] or "unknown"
        label_slug = re.sub(r"[^a-z0-9]+", "-",
                            (row.get("label") or "process").lower()).strip("-") or "process"
        base = out / f"{row.get('rank', 0):02d}-{label_slug}-{sig}"
        # Draft the prose ONCE per row so the .md and .pdf agree on text.
        cached = None
        if draft_exec_summary is not None:
            try:
                cached = draft_exec_summary(row)
            except Exception:
                cached = None
        md_files.append(write_pdd_markdown(row, engagement, str(base) + ".md", cached_prose=cached))
        pdf_files.append(write_pdd_pdf(row, engagement, str(base) + ".pdf", cached_prose=cached))
    return {"markdown": md_files, "pdf": pdf_files}
