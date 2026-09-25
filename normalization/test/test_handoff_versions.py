"""Hand-off versions (contract C20, lane HV): the one line every PDD says
about its version, and the PDD's version history table, in the three states
a document can be in:

  made for a hand-off      "Version 2, handed off 2026-09-25 by rasha"
  between hand-offs        "Working copy after version 2"
  before the first         "Working copy, not handed off yet"

handoff_versions.py is pure; the PDD part needs python-docx (the full-deps
gate: the bundled python with the system pytest) and no-ops without it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import handoff_versions as HV
import pdd_export

_HAVE_DOCX = pdd_export.Document is not None

V1 = {"version": 1, "handed_off_at": "2026-09-20T08:00:00.000Z", "by": "rasha", "note": "First hand-off"}
V2 = {"version": 2, "handed_off_at": "2026-09-25T10:14:03.120Z", "by": "rasha",
      "note": "The credit check added"}


def test_the_entries_are_the_valid_ones_in_version_order():
    anno = {"handoffs": [V2, {"version": 0}, {"version": True}, "x", {"note": "no version"}, V1]}
    assert [e["version"] for e in HV.handoff_entries(anno)] == [1, 2]
    assert HV.handoff_entries({}) == [] and HV.handoff_entries(None) == []
    assert HV.handoff_entries({"handoffs": "not a list"}) == []
    # Two entries of one version: the later one in the list counts.
    again = dict(V1, note="Second note")
    assert HV.handoff_entries({"handoffs": [V1, again]})[0]["note"] == "Second note"


def test_the_version_line_in_its_three_states():
    anno = {"handoffs": [V1, V2]}
    assert HV.version_line(anno, 2) == "Version 2, handed off 2026-09-25 by rasha"
    assert HV.version_line(anno, 1) == "Version 1, handed off 2026-09-20 by rasha"
    assert HV.version_line(anno) == "Working copy after version 2"
    assert HV.version_line({}) == "Working copy, not handed off yet"
    assert HV.version_line({"handoffs": []}, 1) == "Working copy, not handed off yet"
    # A version the project does not hold is not claimed.
    assert HV.version_line(anno, 7) == "Working copy after version 2"


def test_the_line_leaves_out_what_the_entry_lacks():
    assert HV.handed_off_line({"version": 3, "handed_off_at": "", "by": ""}) == "Version 3"
    assert HV.handed_off_line({"version": 3, "handed_off_at": "yesterday", "by": "ana"}) == \
        "Version 3, handed off by ana"
    assert HV.handed_off_line({"version": 3, "handed_off_at": "2026-01-02T00:00:00Z", "by": ""}) == \
        "Version 3, handed off 2026-01-02"


def test_the_history_rows_oldest_first():
    assert HV.history_rows({"handoffs": [V2, V1]}) == [
        ["1", "2026-09-20", "rasha", "First hand-off"],
        ["2", "2026-09-25", "rasha", "The credit check added"],
    ]
    assert list(HV.HISTORY_HEADER) == ["Version", "Date", "By", "What changed"]


# ---- The PDD ----------------------------------------------------------------------

def _pdd(tmp_path, handoffs, handoff=None):
    from docx import Document
    anno = {"steps": []}
    if handoffs is not None:
        anno["handoffs"] = handoffs
    out = tmp_path / "pdd.docx"
    pdd_export.write_pdd(out, session_folder=tmp_path, annotations=anno,
                         stats={"case_stats": [], "meta": {}},
                         manifest={"session_id": "s", "started_at": "2026-09-25T08:00:00Z"},
                         events=[], handoff=handoff)
    doc = Document(str(out))
    control = {r.cells[0].text: r.cells[1].text for r in doc.tables[0].rows}
    history = None
    texts = [p.text for p in doc.paragraphs]
    if "Version history" in texts:
        history = [[c.text for c in r.cells] for r in doc.tables[1].rows]
    return control, history, texts


@pytest.mark.skipif(not _HAVE_DOCX, reason="python-docx not installed")
def test_a_pdd_made_for_a_hand_off_says_its_version_and_lists_the_history(tmp_path):
    control, history, texts = _pdd(tmp_path, [V1, V2], handoff=2)
    assert control["Version"] == "Version 2, handed off 2026-09-25 by rasha"
    assert history == [["Version", "Date", "By", "What changed"],
                       ["1", "2026-09-20", "rasha", "First hand-off"],
                       ["2", "2026-09-25", "rasha", "The credit check added"]]
    # The history follows the Document control table, before section 2.
    assert texts.index("Version history") < texts.index("2. Purpose and scope")


@pytest.mark.skipif(not _HAVE_DOCX, reason="python-docx not installed")
def test_a_pdd_exported_between_hand_offs_is_a_working_copy_after_the_latest(tmp_path):
    control, history, _texts = _pdd(tmp_path, [V1, V2])
    assert control["Version"] == "Working copy after version 2"
    assert history is not None and len(history) == 3


@pytest.mark.skipif(not _HAVE_DOCX, reason="python-docx not installed")
def test_a_pdd_before_the_first_hand_off_says_so_and_has_no_history(tmp_path):
    control, history, texts = _pdd(tmp_path, None)
    assert control["Version"] == "Working copy, not handed off yet"
    assert history is None and "Version history" not in texts
    control, history, _texts = _pdd(tmp_path, [])
    assert control["Version"] == "Working copy, not handed off yet" and history is None
