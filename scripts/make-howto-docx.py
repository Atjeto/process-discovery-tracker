"""Make docs/PDT-How-to.docx, the Word copy of the process managers' guide,
from docs/HOW-TO.md.

Run it with the viewer's bundled Python (it has python-docx) after a change
to the guide, from the repo root:

    viewer/python/python.exe scripts/make-howto-docx.py

The Markdown is the source; the .docx is made from it and never edited by
hand. It reads the few kinds of block the guide uses: headings (#, ##, ###),
paragraphs, numbered and bulleted lists (a wrapped line joins its paragraph
or item), one table (the glossary), and **bold** and *italic* inside a
block. Each numbered list starts again at 1. build-distribution.ps1 copies
the .docx into dist/.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

try:
    import docx
    from docx.shared import Cm
except ImportError:
    sys.exit("python-docx is missing: run this with viewer/python/python.exe")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "HOW-TO.md"
OUT = ROOT / "docs" / "PDT-How-to.docx"

INLINE = re.compile(r"(\*\*.+?\*\*|\*.+?\*)")


def blocks(text: str) -> list[tuple[str, str]]:
    """The guide as (kind, text) blocks: title, h1, h2, para, num, bullet,
    row (a table row), and blank between blocks."""
    out: list[tuple[str, str]] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        if not line.strip():
            out.append(("blank", ""))
            continue
        heading = re.match(r"(#{1,3}) (.*)", line)
        numbered = re.match(r"\d+\. (.*)", line)
        bullet = re.match(r"- (.*)", line)
        if heading:
            out.append((("title", "h1", "h2")[len(heading.group(1)) - 1], heading.group(2).strip()))
        elif line.startswith("|"):
            out.append(("row", line.strip()))
        elif numbered:
            out.append(("num", numbered.group(1).strip()))
        elif bullet:
            out.append(("bullet", bullet.group(1).strip()))
        elif out and out[-1][0] in ("para", "num", "bullet"):
            out[-1] = (out[-1][0], out[-1][1] + " " + line.strip())
        else:
            out.append(("para", line.strip()))
    return out


def add_runs(paragraph, text: str, bold: bool = False) -> None:
    """The text into runs, **bold** and *italic* marked."""
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            add_runs(paragraph, part[2:-2], bold=True)
        elif part.startswith("*") and part.endswith("*"):
            run = paragraph.add_run(part[1:-1])
            run.italic = True
            run.bold = bold or None
        else:
            run = paragraph.add_run(part)
            run.bold = bold or None


def restarted_numbering(document) -> int:
    """A new numbering instance of the List Number style's list that starts
    at 1, so each numbered list counts from 1."""
    numbering = document.part.numbering_part.element
    style_num = document.styles["List Number"].element.pPr.numPr.numId.val
    abstract = numbering.num_having_numId(style_num).abstractNumId.val
    num = numbering.add_num(abstract)
    num.add_lvlOverride(ilvl=0).add_startOverride(1)
    return num.numId


def numbered(document, text: str, num_id: int) -> None:
    p = document.add_paragraph(style="List Number")
    num_pr = p._p.get_or_add_pPr().get_or_add_numPr()
    num_pr.get_or_add_ilvl().val = 0
    num_pr.get_or_add_numId().val = num_id
    add_runs(p, text)


def table(document, rows: list[str]) -> None:
    cells = [[c.strip() for c in r.strip("|").split("|")] for r in rows]
    cells = [r for r in cells if not all(re.fullmatch(r":?-+:?", c) for c in r)]
    t = document.add_table(rows=0, cols=len(cells[0]))
    t.style = "Table Grid"
    widths = (Cm(4.2), Cm(12.3))
    for i, row in enumerate(cells):
        tr = t.add_row()
        for j, value in enumerate(row):
            cell = tr.cells[j]
            cell.width = widths[j] if j < len(widths) else Cm(4)
            add_runs(cell.paragraphs[0], value, bold=(i == 0))


def build(src: Path, out: Path) -> None:
    document = docx.Document()
    props = document.core_properties
    props.title = "How to use PDT"
    props.subject = "The Process Discovery Tracker, for process managers"
    props.author = "Process Discovery Tracker"
    props.last_modified_by = "Process Discovery Tracker"
    props.comments = "Made from docs/HOW-TO.md by scripts/make-howto-docx.py."
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0, tzinfo=None)
    props.created = now
    props.modified = now

    items = blocks(src.read_text(encoding="utf-8"))
    num_id = None
    rows: list[str] = []
    for kind, text in items + [("blank", "")]:
        if kind != "row" and rows:
            table(document, rows)
            rows = []
        if kind != "num":
            num_id = None
        if kind == "title":
            document.add_heading(text, level=0)
        elif kind == "h1":
            document.add_heading(text, level=1)
        elif kind == "h2":
            document.add_heading(text, level=2)
        elif kind == "para":
            add_runs(document.add_paragraph(), text)
        elif kind == "bullet":
            add_runs(document.add_paragraph(style="List Bullet"), text)
        elif kind == "num":
            if num_id is None:
                num_id = restarted_numbering(document)
            numbered(document, text, num_id)
        elif kind == "row":
            rows.append(text)
    out.parent.mkdir(parents=True, exist_ok=True)
    document.save(str(out))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--src", type=Path, default=SRC, help="the guide (default docs/HOW-TO.md)")
    ap.add_argument("--out", type=Path, default=OUT, help="the Word file (default docs/PDT-How-to.docx)")
    args = ap.parse_args()
    build(args.src, args.out)
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
