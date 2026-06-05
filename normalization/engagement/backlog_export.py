"""Backlog export — XLSX + CSV. stdlib + minimal-xlsx, no pandas.

PDT-1.0-SPEC §6.1. The Process Backlog as a client-facing deliverable —
the board-ready spreadsheet that ranks every identified process by
(frequency × time × confidence) with the savings band beside it.

Export targets:
  - CSV: always available, stdlib only.
  - XLSX: written via a minimal in-house writer (sub-200 lines, no deps).
    The XLSX file is opened by Excel / LibreOffice / Numbers identically.
"""

from __future__ import annotations

import csv
import io
import os
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape as _xml_escape


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


def _fmt_pct(p: float | None) -> str:
    if p is None:
        return "—"
    return f"{round(p * 100)}%"


_COLUMNS = [
    ("rank", "Rank"),
    ("label", "Process"),
    ("apps", "Apps"),
    ("instance_count", "Observations"),
    ("case_count", "Cases"),
    ("session_count", "Sessions"),
    ("mean_elapsed_display", "Avg duration"),
    ("confidence_display", "Confidence"),
    ("rank_score", "Rank score"),
    ("below_confidence_floor", "Low confidence?"),
]


def _row_to_display(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "rank": row.get("rank", "—"),
        "label": row.get("label", "(unnamed)"),
        "apps": ", ".join(row.get("apps") or []),
        "instance_count": row.get("instance_count", 0),
        "case_count": row.get("case_count", 0),
        "session_count": row.get("session_count", 0),
        "mean_elapsed_display": _fmt_duration(row.get("mean_elapsed_ms", 0)),
        "confidence_display": _fmt_pct(row.get("confidence")),
        "rank_score": round(row.get("rank_score", 0)),
        "below_confidence_floor": "yes" if row.get("below_confidence_floor") else "",
    }


def export_csv(backlog: dict[str, Any], out_path: str | os.PathLike) -> str:
    """Write backlog rows to a CSV at out_path. Returns the path written."""
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    rows = backlog.get("rows") or []
    with open(p, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow([h for _, h in _COLUMNS])
        for r in rows:
            display = _row_to_display(r)
            writer.writerow([display[k] for k, _ in _COLUMNS])
    return str(p)


# ---- Minimal XLSX writer (no openpyxl dependency) ----
#
# An XLSX is a ZIP of a fixed XML structure. We only need a single sheet
# with a header row and data rows, so we hand-build the minimum schema.

_XLSX_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"""

_XLSX_ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""

_XLSX_WORKBOOK = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Backlog" sheetId="1" r:id="rId1"/></sheets>
</workbook>"""

_XLSX_WORKBOOK_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""

_XLSX_STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs>
</styleSheet>"""


def _col_letter(i: int) -> str:
    s = ""
    n = i
    while True:
        n, r = divmod(n, 26)
        s = chr(65 + r) + s
        if n == 0:
            break
        n -= 1
    return s


def export_xlsx(backlog: dict[str, Any], out_path: str | os.PathLike) -> str:
    """Write backlog rows to a single-sheet XLSX at out_path."""
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    rows = backlog.get("rows") or []

    # Collect unique strings for the shared-strings table.
    strings: list[str] = []
    str_index: dict[str, int] = {}

    def _s(text: str) -> int:
        if text not in str_index:
            str_index[text] = len(strings)
            strings.append(text)
        return str_index[text]

    # Build worksheet XML.
    header_cells = []
    for col_i, (_, header) in enumerate(_COLUMNS):
        ref = _col_letter(col_i) + "1"
        idx = _s(header)
        header_cells.append(f'<c r="{ref}" s="1" t="s"><v>{idx}</v></c>')
    row_xml = ['<row r="1">' + "".join(header_cells) + "</row>"]
    for row_i, raw in enumerate(rows, start=2):
        display = _row_to_display(raw)
        cells = []
        for col_i, (key, _) in enumerate(_COLUMNS):
            ref = _col_letter(col_i) + str(row_i)
            val = display[key]
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                cells.append(f'<c r="{ref}"><v>{val}</v></c>')
            else:
                idx = _s(str(val) if val is not None else "")
                cells.append(f'<c r="{ref}" t="s"><v>{idx}</v></c>')
        row_xml.append(f'<row r="{row_i}">' + "".join(cells) + "</row>")
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetData>' + "".join(row_xml) + '</sheetData></worksheet>'
    )

    # Shared strings XML.
    si_xml = "".join(f"<si><t xml:space=\"preserve\">{_xml_escape(s)}</t></si>"
                     for s in strings)
    shared_strings_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        f'count="{len(strings)}" uniqueCount="{len(strings)}">{si_xml}</sst>'
    )

    with zipfile.ZipFile(p, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _XLSX_CONTENT_TYPES)
        z.writestr("_rels/.rels", _XLSX_ROOT_RELS)
        z.writestr("xl/workbook.xml", _XLSX_WORKBOOK)
        z.writestr("xl/_rels/workbook.xml.rels", _XLSX_WORKBOOK_RELS)
        z.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        z.writestr("xl/sharedStrings.xml", shared_strings_xml)
        z.writestr("xl/styles.xml", _XLSX_STYLES)
    return str(p)
