"""A minimal .xlsx writer: Office Open XML SpreadsheetML, standard library only.

The bundled Python has no openpyxl or xlsxwriter, and no dependency is added
for one workbook, so the Technical details (tech_details.py, contract C20)
are written here with zipfile. What it writes, and nothing more:

  - one worksheet per Sheet, in order, the first one selected;
  - every cell an inline string or a number (no shared strings, no
    formulas, no dates);
  - rows made bold (a header), through the second cell format of a minimal
    styles.xml (a bold font on a light grey fill);
  - the top `freeze` rows frozen, so a header stays on screen;
  - a width per column.

The parts are the ones Excel needs to open a file without a repair prompt:
[Content_Types].xml, _rels/.rels, xl/workbook.xml with its relationships,
xl/styles.xml and xl/worksheets/sheet<N>.xml, the elements in the order the
schema sets. A cell's text is cut at Excel's 32,767 characters, and the
characters XML 1.0 cannot hold are left out.

    write_workbook(path, [Sheet("Steps", rows=[["Step", "Name"], ["Step 1", "Log in"]],
                                bold_rows={0}, freeze=1, widths=[10, 30])])
"""

from __future__ import annotations

import math
import os
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable
from xml.sax.saxutils import escape, quoteattr

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
_DOC_REL = REL_NS + "/officeDocument"
_SHEET_REL = REL_NS + "/worksheet"
_STYLES_REL = REL_NS + "/styles"
_CT_WORKBOOK = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
_CT_SHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
_CT_STYLES = "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"
_CT_RELS = "application/vnd.openxmlformats-package.relationships+xml"

# Excel's limits: the characters of one cell, the characters of a sheet name.
MAX_CELL = 32767
MAX_SHEET_NAME = 31
_BAD_SHEET_CHARS = re.compile(r"[\[\]:*?/\\]")
# The characters XML 1.0 allows; any other one is left out of a cell.
_NOT_XML = re.compile("[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\U00010000-\U0010ffff]")

_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
# Style 0: the default; style 1: a header cell (bold, light grey fill).
_STYLES = (
    _HEAD + f'<styleSheet xmlns="{MAIN_NS}">'
    '<fonts count="2">'
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
    '</fonts>'
    '<fills count="3">'
    '<fill><patternFill patternType="none"/></fill>'
    '<fill><patternFill patternType="gray125"/></fill>'
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill>'
    '</fills>'
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="2">'
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
    '</cellXfs>'
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    '</styleSheet>'
)


@dataclass
class Sheet:
    """One worksheet: `rows` of cells (a str, an int or a float; None is an
    empty cell), the indexes of the rows shown bold, how many rows at the
    top stay frozen, and the columns' widths (in characters; a missing one
    is Excel's default)."""
    name: str
    rows: list[list[Any]] = field(default_factory=list)
    bold_rows: set[int] = field(default_factory=set)
    freeze: int = 0
    widths: list[float] = field(default_factory=list)


def column_letter(index: int) -> str:
    """The letters of a 0-based column: 0 is A, 25 is Z, 26 is AA."""
    if index < 0:
        raise ValueError("a column index is 0 or more")
    out = ""
    n = index + 1
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def cell_text(value: Any) -> str:
    """A cell's text as the workbook holds it: the characters XML 1.0
    cannot hold left out, cut at Excel's limit."""
    text = _NOT_XML.sub("", str(value))
    return text if len(text) <= MAX_CELL else text[:MAX_CELL - 1] + "…"


def _is_number(value: Any) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value))


def _cell_xml(ref: str, value: Any, style: int) -> str:
    s = f' s="{style}"' if style else ""
    if _is_number(value):
        return f'<c r="{ref}"{s}><v>{value!r}</v></c>'
    text = cell_text(value)
    space = ' xml:space="preserve"' if text != text.strip() or "\n" in text else ""
    return f'<c r="{ref}"{s} t="inlineStr"><is><t{space}>{escape(text)}</t></is></c>'


def _sheet_xml(sheet: Sheet, selected: bool) -> str:
    rows = sheet.rows
    ncols = max((len(r) for r in rows), default=0)
    dim = f"A1:{column_letter(ncols - 1)}{len(rows)}" if rows and ncols else "A1"
    tab = ' tabSelected="1"' if selected else ""
    view = f'<sheetView workbookViewId="0"{tab}'
    if sheet.freeze > 0:
        top = f"A{sheet.freeze + 1}"
        view += (f'><pane ySplit="{sheet.freeze}" topLeftCell="{top}" activePane="bottomLeft" state="frozen"/>'
                 f'<selection pane="bottomLeft" activeCell="{top}" sqref="{top}"/></sheetView>')
    else:
        view += "/>"
    cols = "".join(
        f'<col min="{i + 1}" max="{i + 1}" width="{float(w):g}" customWidth="1"/>'
        for i, w in enumerate(sheet.widths) if _is_number(w) and w > 0)
    body = []
    for r, row in enumerate(rows):
        style = 1 if r in sheet.bold_rows else 0
        cells = "".join(_cell_xml(f"{column_letter(c)}{r + 1}", v, style)
                        for c, v in enumerate(row) if v is not None and (_is_number(v) or str(v) != ""))
        body.append(f'<row r="{r + 1}">{cells}</row>')
    return (
        _HEAD + f'<worksheet xmlns="{MAIN_NS}" xmlns:r="{REL_NS}">'
        f'<dimension ref="{dim}"/>'
        f'<sheetViews>{view}</sheetViews>'
        '<sheetFormatPr defaultRowHeight="15"/>'
        + (f"<cols>{cols}</cols>" if cols else "")
        + (f"<sheetData>{''.join(body)}</sheetData>" if body else "<sheetData/>")
        + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
        '</worksheet>'
    )


def _check_names(sheets: Iterable[Sheet]) -> None:
    seen: set[str] = set()
    for sheet in sheets:
        name = sheet.name
        if not name or len(name) > MAX_SHEET_NAME or _BAD_SHEET_CHARS.search(name) \
                or name.startswith("'") or name.endswith("'"):
            raise ValueError(f"not a sheet name Excel takes: {name!r}")
        if name.lower() in seen:
            raise ValueError(f"two sheets are named {name!r}")
        seen.add(name.lower())


def workbook_parts(sheets: list[Sheet]) -> dict[str, str]:
    """{part name: XML text} of the workbook, in the order they are written."""
    if not sheets:
        raise ValueError("a workbook holds at least one sheet")
    _check_names(sheets)
    n = len(sheets)
    overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="{_CT_SHEET}"/>' for i in range(n))
    parts = {
        "[Content_Types].xml": (
            _HEAD + f'<Types xmlns="{CT_NS}">'
            f'<Default Extension="rels" ContentType="{_CT_RELS}"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            f'<Override PartName="/xl/workbook.xml" ContentType="{_CT_WORKBOOK}"/>'
            + overrides +
            f'<Override PartName="/xl/styles.xml" ContentType="{_CT_STYLES}"/>'
            '</Types>'),
        "_rels/.rels": (
            _HEAD + f'<Relationships xmlns="{PKG_REL_NS}">'
            f'<Relationship Id="rId1" Type="{_DOC_REL}" Target="xl/workbook.xml"/>'
            '</Relationships>'),
        "xl/workbook.xml": (
            _HEAD + f'<workbook xmlns="{MAIN_NS}" xmlns:r="{REL_NS}">'
            '<bookViews><workbookView activeTab="0"/></bookViews><sheets>'
            + "".join(f'<sheet name={quoteattr(s.name)} sheetId="{i + 1}" r:id="rId{i + 1}"/>'
                      for i, s in enumerate(sheets))
            + '</sheets></workbook>'),
        "xl/_rels/workbook.xml.rels": (
            _HEAD + f'<Relationships xmlns="{PKG_REL_NS}">'
            + "".join(f'<Relationship Id="rId{i + 1}" Type="{_SHEET_REL}" Target="worksheets/sheet{i + 1}.xml"/>'
                      for i in range(n))
            + f'<Relationship Id="rId{n + 1}" Type="{_STYLES_REL}" Target="styles.xml"/>'
            '</Relationships>'),
        "xl/styles.xml": _STYLES,
    }
    for i, sheet in enumerate(sheets):
        parts[f"xl/worksheets/sheet{i + 1}.xml"] = _sheet_xml(sheet, i == 0)
    return parts


def write_workbook(path: str | Path, sheets: list[Sheet]) -> None:
    """Write the workbook to `path`: through a temporary file beside it,
    renamed into place once complete, so a failed write leaves no half file
    under the name."""
    target = Path(path)
    parts = workbook_parts(sheets)
    partial = target.with_name(target.name + ".partial")
    try:
        with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for name, text in parts.items():
                zf.writestr(name, text.encode("utf-8"))
        os.replace(partial, target)
    except BaseException:
        try:
            partial.unlink()
        except OSError:
            pass
        raise
