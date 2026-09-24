"""Sessions without a recording and content the analyst adds (contract C16,
lane V3-P): the pipeline and PDD half.

Three synthetic session folders, built in pytest's tmp_path (never in
sessions/), each with an empty events.jsonl:

  video          manifest.source "video", no run markers, three steps added by
                 hand with times on the video clock (listed out of order);
  video_markers  the same plus two start markers inserted by hand
                 (marker_edits), which replace the implicit run;
  blank          manifest.source "blank": four steps without times, ordered by
                 `order` (listed out of order), one with a system, one whose
                 PDD screenshot the analyst chose among two added by hand, one
                 with an analyst screenshot and no choice, one whose recorder
                 screenshot is hidden; two attachments (one on a step), notes
                 pinned to a step and a product-edition notes list.

For each, normalize.py exits 0 with --mine and --pdd-out, the step BPMN is
valid and in the right order, and the PDD (read back with python-docx) lists
the steps in order with their systems, the chosen screenshot, the
attachments, no notes and no zero timings.

The pipeline imports pandas and pm4py and the PDD needs python-docx, so this
module skips where they are absent (bare system pytest) and runs under the
full-deps gate.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import logging
import struct
import subprocess
import sys
import uuid
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
NORMALIZATION = HERE.parent
sys.path.insert(0, str(NORMALIZATION))

_DEPS_OK = all(importlib.util.find_spec(m) is not None
               for m in ("pandas", "pm4py", "docx"))
pytestmark = pytest.mark.skipif(not _DEPS_OK,
                                reason="pipeline deps (pandas/pm4py/python-docx) not installed")

if _DEPS_OK:
    import normalize as normalize_mod

# C9's fixed namespace; C16's implicit run is uuid5 of "<session_id>:implicit-run".
CASE_NS = uuid.UUID("c35db218-e350-4efb-ae74-37c31a4f697a")
VIDEO_SID = "7f0c2a64-5a1e-4c1b-9b1e-0d5d7c1f0a01"
BLANK_SID = "7f0c2a64-5a1e-4c1b-9b1e-0d5d7c1f0a02"
_BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
ZEROS = ("under 1s", " 0s", "0ms")


def implicit_id(session_id: str) -> str:
    return str(uuid.uuid5(CASE_NS, f"{session_id}:implicit-run"))


def _png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """A small valid PNG; the size and colour make each file's bytes unique."""
    def chunk(typ, data):
        body = typ + data
        return (struct.pack(">I", len(data)) + body
                + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def _write(folder: Path, name: str, data) -> None:
    path = folder / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, bytes):
        path.write_bytes(data)
    elif isinstance(data, str):
        path.write_text(data, encoding="utf-8")
    else:
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _hand_step(sid, name, **extra):
    step = {"step_id": sid, "session_id": "", "case_id": None, "name": name,
            "description": "", "state": "manually_authored",
            "evidence": {"interaction_event_ids": [], "screenshot_refs": []},
            "flags": {"waste": False}}
    step.update(extra)
    return step


def _video_session(folder: Path, markers: bool = False) -> Path:
    _write(folder, "manifest.json", {"session_id": VIDEO_SID,
                                     "started_at": "2026-09-24T10:00:00Z",
                                     "source": "video"})
    _write(folder, "events.jsonl", "")
    _write(folder, "video/call.mp4", b"not really a video")
    tr = lambda a, b: {"start": f"2026-09-24T10:{a}Z", "end": f"2026-09-24T10:{b}Z"}  # noqa: E731
    anno = {
        "external_video": {"path": "video/call.mp4", "offset_ms": 0},
        # Listed out of time order on purpose: the time orders them.
        "steps": [
            _hand_step("v3", "Confirm the order", time_range=tr("02:00", "02:20")),
            _hand_step("v1", "Open the order", time_range=tr("00:10", "00:40"),
                       description="Open the order from the customer's mail."),
            _hand_step("v2", "Check the stock", time_range=tr("01:00", "01:30"),
                       system="SAP"),
        ],
    }
    if markers:
        # The analyst first worked in the implicit run, then marked two runs.
        for s in anno["steps"]:
            s["case_id"] = implicit_id(VIDEO_SID)
        anno["marker_edits"] = [
            {"id": "m1", "op": "insert", "marker_type": "start", "label": "Order 1",
             "timestamp": "2026-09-24T10:00:05Z", "ts": "2026-09-24T12:00:00Z"},
            {"id": "m2", "op": "insert", "marker_type": "start", "label": "Order 2",
             "timestamp": "2026-09-24T10:01:50Z", "ts": "2026-09-24T12:00:00Z"},
        ]
    _write(folder, "annotations.json", anno)
    return folder


BLANK_FILES = {
    "screenshots/analyst/shot-a.png": _png(3, 2, (200, 10, 10)),
    "screenshots/analyst/shot-b.png": _png(4, 2, (10, 200, 10)),
    "screenshots/analyst/shot-c.png": _png(5, 2, (10, 10, 200)),
    "screenshots/rec-1.png": _png(6, 2, (90, 90, 90)),
    "screenshots/rec-2.png": _png(7, 2, (160, 160, 20)),
    "attachments/order-email.msg": b"From: customer",
    "attachments/orders.xlsx": b"PK not really a workbook",
}

LEGACY_NOTES = [{"id": "old-1", "type": "note", "timestamp": "2026-05-01T09:00:00Z",
                 "video_offset_s": 12.5, "text": "Legacy flow note"}]


def _blank_session(folder: Path) -> Path:
    _write(folder, "manifest.json", {"session_id": BLANK_SID,
                                     "started_at": "2026-09-24T11:00:00Z",
                                     "source": "blank"})
    _write(folder, "events.jsonl", "")
    for name, data in BLANK_FILES.items():
        _write(folder, name, data)
    added = "2026-09-24T11:30:00Z"
    anno = {
        # Listed out of order on purpose: `order` orders steps without times.
        "steps": [
            _hand_step("b3", "Check the stock", order=3, time_range=None),
            _hand_step("b1", "Receive the request", order=1, time_range=None),
            _hand_step("b4", "Reply to the customer", order=4, time_range=None,
                       evidence={"interaction_event_ids": [],
                                 "screenshot_refs": ["screenshots/rec-1.png",
                                                     "screenshots/rec-2.png"]},
                       hidden_screenshots=["screenshots/rec-1.png"]),
            _hand_step("b2", "Log it in SAP", order=2, time_range=None, system="SAP",
                       pdd_screenshot="shot-a"),
        ],
        "analyst_screenshots": [
            {"id": "shot-a", "file": "shot-a.png", "step_id": "b2", "at": None,
             "source": "paste", "added_at": added},
            {"id": "shot-b", "file": "shot-b.png", "step_id": "b2", "at": None,
             "source": "file", "added_at": added},
            {"id": "shot-c", "file": "shot-c.png", "step_id": "b3", "at": None,
             "source": "file", "added_at": added},
        ],
        "attachments": [
            {"id": "att-1", "file": "order-email.msg", "label": "Example order email",
             "step_id": None, "added_at": added},
            {"id": "att-2", "file": "orders.xlsx", "label": "Input spreadsheet",
             "step_id": "b1", "added_at": added},
        ],
        "analyst_notes": [
            {"id": "n1", "text": "Ask Ana about the credit block.", "step_id": "b2",
             "at": None, "added_at": added},
            {"id": "n2", "text": "The SME types the mail by hand.", "step_id": None,
             "at": None, "added_at": added},
        ],
        "notes": LEGACY_NOTES,
    }
    _write(folder, "annotations.json", anno)
    return folder


def _read(folder: Path, name: str):
    return json.loads((folder / name).read_text(encoding="utf-8"))


def _normalize_cli(folder: Path, pdd: Path):
    return subprocess.run(
        [sys.executable, str(NORMALIZATION / "normalize.py"), str(folder),
         "--taxonomy", str(NORMALIZATION / "taxonomy.yaml"), "--mine",
         "--pdd-out", str(pdd)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=str(NORMALIZATION.parent))


@pytest.fixture(autouse=True)
def _restore_root_logging():
    """normalize() attaches a file handler for <session>/normalize.log to the
    root logger; detach and close it so tmp folders are not held open."""
    root = logging.getLogger()
    before, level = list(root.handlers), root.level
    yield
    for h in list(root.handlers):
        if h not in before:
            root.removeHandler(h)
            h.close()
    root.setLevel(level)


# ---- reading the outputs back --------------------------------------------------

def _chain(bpmn_path: Path) -> list[str]:
    """The task names met walking a linear step BPMN from its start event."""
    process = ET.parse(bpmn_path).getroot().find(f"{_BPMN}process")
    nodes = {el.get("id"): el for el in process if el.tag != f"{_BPMN}sequenceFlow"}
    out_flows: dict[str, list[str]] = {}
    for el in process:
        if el.tag == f"{_BPMN}sequenceFlow":
            out_flows.setdefault(el.get("sourceRef"), []).append(el.get("targetRef"))
    starts = [i for i, el in nodes.items() if el.tag == f"{_BPMN}startEvent"]
    assert len(starts) == 1
    names, at, seen = [], starts[0], set()
    while at not in seen:
        seen.add(at)
        nxt = out_flows.get(at, [])
        assert len(nxt) <= 1, "the one-run map branches"
        if not nxt:
            break
        at = nxt[0]
        if nodes[at].tag == f"{_BPMN}task":
            names.append(nodes[at].get("name"))
    assert nodes[at].tag == f"{_BPMN}endEvent"
    return names


def _bpmn_tasks(bpmn_path: Path) -> dict[str, ET.Element]:
    process = ET.parse(bpmn_path).getroot().find(f"{_BPMN}process")
    return {el.get("name"): el for el in process if el.tag == f"{_BPMN}task"}


def _reaches(bpmn_path: Path, a: str, b: str) -> bool:
    """True when a path of sequence flows leads from task `a` to task `b`."""
    process = ET.parse(bpmn_path).getroot().find(f"{_BPMN}process")
    ids = {el.get("name"): el.get("id") for el in process if el.tag == f"{_BPMN}task"}
    adj: dict[str, list[str]] = {}
    for el in process:
        if el.tag == f"{_BPMN}sequenceFlow":
            adj.setdefault(el.get("sourceRef"), []).append(el.get("targetRef"))
    todo, seen = list(adj.get(ids[a], [])), set()
    while todo:
        n = todo.pop()
        if n == ids[b]:
            return True
        if n not in seen:
            seen.add(n)
            todo.extend(adj.get(n, []))
    return False


def _sha(blob: bytes) -> str:
    return hashlib.sha1(blob).hexdigest()


def _pdd(path: Path):
    """The PDD's body in order: ("Heading N" | "p" | "t" | "pic", text). A
    picture's text is the sha1 of its image bytes."""
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    doc = Document(str(path))
    out = []
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            p = Paragraph(child, doc)
            if p.text.strip():
                style = p.style.name if p.style is not None else ""
                out.append((style if style.startswith("Heading") or style == "Title"
                            else "p", p.text))
            for rid in child.xpath(".//a:blip/@r:embed"):
                out.append(("pic", _sha(doc.part.related_parts[rid].blob)))
        elif tag == "tbl":
            for row in Table(child, doc).rows:
                out.append(("t", " | ".join(c.text for c in row.cells)))
    return out


def _section(blocks, heading):
    start = next(i for i, (k, t) in enumerate(blocks) if t == heading and k != "p")
    out = []
    for k, t in blocks[start + 1:]:
        if k in ("Heading 1", "Heading 2") and t[:1].isdigit():
            break
        out.append(t if k != "pic" else "pic:" + t)
    return out


def _under(blocks, heading):
    """The blocks under one step heading (level 3), up to the next heading."""
    start = next(i for i, (k, t) in enumerate(blocks) if k == "Heading 3" and t == heading)
    out = []
    for k, t in blocks[start + 1:]:
        if k.startswith("Heading"):
            break
        out.append(t if k != "pic" else "pic:" + t)
    return out


def _text(blocks) -> str:
    return "\n".join(t for k, t in blocks if k != "pic")


def _assert_no_zero_timing(text: str) -> None:
    for zero in ZEROS:
        assert zero not in text, f"a zero timing is printed: {zero!r}"


# ---- the video session: one implicit run ---------------------------------------

def test_a_video_session_without_markers_is_one_implicit_run(tmp_path):
    session = _video_session(tmp_path / "video")
    proc = _normalize_cli(session, tmp_path / "video.docx")
    assert proc.returncode == 0, proc.stderr[-3000:]

    stats = _read(session, "stats.json")
    rid = implicit_id(VIDEO_SID)
    assert stats["case_stats"] == [{
        "case_id": rid, "label": None, "parent_case_id": None,
        "start_ts": "2026-09-24T10:00:00Z", "end_ts": None, "wall_clock_ms": None,
        "active_ms": None, "end_reason": None, "implicit": True}]
    steps = _read(session, "annotations.json")["steps"]
    assert {s["step_id"]: s["case_id"] for s in steps} == {"v1": rid, "v2": rid, "v3": rid}
    assert stats["meta"]["case_count"] == 1

    analysis = _read(session, "analysis.json")
    assert analysis["case_quality"] == {"mode": "implicit", "case_count": 1,
                                        "coverage": None, "tier2_unlocked": False}
    # Nothing was recorded: the measurements of the recording are null, and
    # not failures (no stage_errors entry).
    for key in ("facts", "findings", "pdd_findings", "waste_classification",
                "time_study", "segments", "automation_candidates", "efficiency"):
        assert analysis[key] is None, key
    assert analysis["stage_errors"] == []

    # The id is the same on every analysis.
    normalize_mod.normalize(session)
    assert [r["case_id"] for r in _read(session, "stats.json")["case_stats"]] == [rid]


def test_the_video_sessions_map_and_pdd_follow_the_video_clock(tmp_path):
    session = _video_session(tmp_path / "video")
    pdd = tmp_path / "video.docx"
    proc = _normalize_cli(session, pdd)
    assert proc.returncode == 0, proc.stderr[-3000:]

    bpmn = session / "process_map_step.bpmn"
    assert _chain(bpmn) == ["Open the order", "Check the stock", "Confirm the order"]
    doc = _bpmn_tasks(bpmn)["Check the stock"].find(f"{_BPMN}documentation").text
    assert doc == "SAP. 30s on average."           # step.system names the system

    blocks = _pdd(pdd)
    assert [t for k, t in blocks if k == "Heading 3"] == [
        "1. Open the order", "2. Check the stock", "3. Confirm the order"]
    assert _under(blocks, "1. Open the order") == [
        "30s on average · video 0:10", "Open the order from the customer's mail."]
    assert _under(blocks, "2. Check the stock") == ["SAP · 30s on average · video 1:00"]
    control = _section(blocks, "1. Document control")
    assert "Runs recorded | Not marked" in control and "Video | Attached" in control
    assert _section(blocks, "4.1 Differences between runs") == [
        "Runs were not marked in this session, so there are no runs to compare."]
    assert _section(blocks, "6.1 Time per run") == [
        "Runs were not marked in this session, so there is no time per run."]
    assert _section(blocks, "6.2 Time in each application") == [
        "System | Screens | Steps | Time",
        "Not recorded | Not recorded | Open the order, Confirm the order | 50s",
        "SAP | Not recorded | Check the stock | 30s"]
    _assert_no_zero_timing(_text(blocks))


def test_inserted_markers_replace_the_implicit_run(tmp_path):
    session = _video_session(tmp_path / "video", markers=True)
    pdd = tmp_path / "video.docx"
    proc = _normalize_cli(session, pdd)
    assert proc.returncode == 0, proc.stderr[-3000:]

    run1 = str(uuid.uuid5(CASE_NS, f"{VIDEO_SID}:insert-m1"))
    run2 = str(uuid.uuid5(CASE_NS, f"{VIDEO_SID}:insert-m2"))
    rows = _read(session, "stats.json")["case_stats"]
    assert [r["case_id"] for r in rows] == [run1, run2]
    assert not any(r.get("implicit") for r in rows)
    assert [r["active_ms"] for r in rows] == [None, None]      # nothing recorded
    assert [r["wall_clock_ms"] for r in rows] == [105000, None]
    steps = {s["step_id"]: s["case_id"] for s in _read(session, "annotations.json")["steps"]}
    assert steps == {"v1": run1, "v2": run1, "v3": run2}
    assert _read(session, "analysis.json")["case_quality"]["mode"] == "markers"

    bpmn = session / "process_map_step.bpmn"
    assert set(_bpmn_tasks(bpmn)) == {"Open the order", "Check the stock", "Confirm the order"}
    assert _reaches(bpmn, "Open the order", "Check the stock")
    assert not _reaches(bpmn, "Check the stock", "Open the order")

    blocks = _pdd(pdd)
    assert [t for k, t in blocks if k == "Heading 3"] == [
        "1. Open the order", "2. Check the stock"]
    assert _under(blocks, "2. Check the stock")[0] == (
        "SAP · 30s on average · in 1 of 2 runs · Run 1, video 1:00")
    assert _section(blocks, "6.1 Time per run")[:3] == [
        "Run | Steps | Active time | Elapsed time",
        "Run 1: Order 1 | 2 | Not recorded | 1m 45s",
        "Run 2: Order 2 | 1 | Not recorded | Not measured: the run was not ended"]
    _assert_no_zero_timing(_text(blocks))


# ---- the blank session: steps without times ------------------------------------

def test_a_blank_session_orders_its_steps_by_order_everywhere(tmp_path):
    session = _blank_session(tmp_path / "blank")
    pdd = tmp_path / "blank.docx"
    proc = _normalize_cli(session, pdd)
    assert proc.returncode == 0, proc.stderr[-3000:]

    order = ["Receive the request", "Log it in SAP", "Check the stock",
             "Reply to the customer"]
    rid = implicit_id(BLANK_SID)
    steps = _read(session, "annotations.json")["steps"]
    assert {s["case_id"] for s in steps} == {rid}
    stats = _read(session, "stats.json")
    assert stats["step_variants"] == [{"variant": order, "frequency": 1, "length": 4}]
    assert stats["step_stats"] == []                # no step has a time
    assert stats["case_stats"][0]["implicit"] is True

    bpmn = session / "process_map_step.bpmn"
    assert _chain(bpmn) == order
    tasks = _bpmn_tasks(bpmn)
    assert tasks["Log it in SAP"].find(f"{_BPMN}documentation").text == "SAP."
    assert tasks["Receive the request"].find(f"{_BPMN}documentation") is None

    blocks = _pdd(pdd)
    assert [t for k, t in blocks if k == "Heading 3"] == [
        f"{i}. {name}" for i, name in enumerate(order, start=1)]
    control = _section(blocks, "1. Document control")
    assert "Recorded | Nothing recorded" in control
    assert "Runs recorded | Not marked" in control
    steps_text = _section(blocks, "3.2 Process steps")
    assert steps_text[:2] == [
        "The process runs through SAP.",
        "Runs were not marked in this session, so every step is listed in order."]
    assert _section(blocks, "6.2 Time in each application") == [
        "System | Screens | Steps",
        "Not recorded | Not recorded | Receive the request, Check the stock, "
        "Reply to the customer",
        "SAP | Not recorded | Log it in SAP"]
    _assert_no_zero_timing(_text(blocks))


def test_the_blank_pdd_prints_the_chosen_screenshots_and_the_attachments(tmp_path):
    session = _blank_session(tmp_path / "blank")
    pdd = tmp_path / "blank.docx"
    proc = _normalize_cli(session, pdd)
    assert proc.returncode == 0, proc.stderr[-3000:]
    sha = {name: _sha(data) for name, data in BLANK_FILES.items()}
    blocks = _pdd(pdd)

    # Step 1 lists its attachment by label; it has no screenshot.
    assert _under(blocks, "1. Receive the request") == ["Attachments: Input spreadsheet."]
    # Step 2: the system, then only the screenshot chosen for the PDD.
    assert _under(blocks, "2. Log it in SAP") == [
        "SAP", "pic:" + sha["screenshots/analyst/shot-a.png"]]
    # Step 3: no choice, so its analyst screenshot counts like a recorder one.
    assert _under(blocks, "3. Check the stock") == [
        "pic:" + sha["screenshots/analyst/shot-c.png"]]
    # Step 4: the hidden recorder screenshot is never printed.
    assert _under(blocks, "4. Reply to the customer") == [
        "pic:" + sha["screenshots/rec-2.png"]]
    pictures = [t for k, t in blocks if k == "pic"]
    assert sha["screenshots/analyst/shot-b.png"] not in pictures
    assert sha["screenshots/rec-1.png"] not in pictures

    headings = [t for k, t in blocks if k == "Heading 1"]
    assert headings[-1] == "8. Attachments"            # no document notes: 8
    assert _section(blocks, "8. Attachments") == [
        "The files are in the session folder's attachments folder.",
        "Attachment | File",
        "Example order email | order-email.msg",
        "Input spreadsheet | orders.xlsx"]
    text = _text(blocks)
    for note in ("Ask Ana about the credit block.", "The SME types the mail by hand.",
                 "Legacy flow note"):
        assert note not in text, "a note reached the PDD"


def test_a_new_blank_session_without_steps_analyzes_and_exports(tmp_path):
    """The viewer analyzes a session as soon as it creates it: an empty
    blank session has its implicit run and no steps; nothing crashes, no map
    is drawn, and the PDD says no step was added yet."""
    session = tmp_path / "new"
    _write(session, "manifest.json", {"session_id": BLANK_SID, "source": "blank",
                                      "started_at": "2026-09-24T11:00:00Z"})
    _write(session, "events.jsonl", "")
    pdd = tmp_path / "new.docx"
    proc = _normalize_cli(session, pdd)
    assert proc.returncode == 0, proc.stderr[-3000:]
    assert [r["case_id"] for r in _read(session, "stats.json")["case_stats"]] == [
        implicit_id(BLANK_SID)]
    assert _read(session, "annotations.json")["steps"] == []
    assert not (session / "process_map_step.bpmn").exists()
    blocks = _pdd(pdd)
    assert _section(blocks, "3.2 Process steps") == [
        "No steps have been added to this session yet."]
    assert _section(blocks, "4.1 Differences between runs") == [
        "Runs were not marked in this session, so there are no runs to compare."]
    assert _section(blocks, "6.2 Time in each application") == [
        "No steps have been added to this session yet."]


def test_attachments_follow_the_document_notes(tmp_path):
    session = _blank_session(tmp_path / "blank")
    anno = _read(session, "annotations.json")
    anno["document"] = {"notes": "Check the SAP role with IT."}
    _write(session, "annotations.json", anno)
    pdd = tmp_path / "blank.docx"
    assert _normalize_cli(session, pdd).returncode == 0
    headings = [t for k, t in _pdd(pdd) if k == "Heading 1"]
    assert headings[-2:] == ["8. Notes", "9. Attachments"]


def test_re_analysis_round_trips_what_the_analyst_added(tmp_path):
    session = _blank_session(tmp_path / "blank")
    before = _read(session, "annotations.json")
    for _ in range(2):
        normalize_mod.normalize(session, mine=True)
    after = _read(session, "annotations.json")
    for key in ("analyst_screenshots", "attachments", "analyst_notes", "notes"):
        assert after[key] == before[key], key
    assert after["notes"] == LEGACY_NOTES          # the product edition's Flow notes
    by_id = {s["step_id"]: s for s in after["steps"]}
    for s in before["steps"]:
        for key in ("order", "system", "pdd_screenshot", "hidden_screenshots",
                    "time_range", "name", "state"):
            assert by_id[s["step_id"]].get(key) == s.get(key), (s["step_id"], key)
    # The files the analyst added are never touched.
    for name, data in BLANK_FILES.items():
        assert (session / name).read_bytes() == data


def _recorded_run(prefix: str, sec: int) -> list[dict]:
    """One marked run of a recording: Find, then Save, in a CRM window."""
    ts = lambda s: f"2026-09-24T09:{s // 60:02d}:{s % 60:02d}Z"  # noqa: E731
    inter = lambda eid, s, name: {  # noqa: E731
        "event_id": f"{prefix}-{eid}", "type": "interaction", "timestamp": ts(s),
        "data": {"kind": "invoked", "control_type": "Button", "name": name,
                 "automation_id": name.lower(), "process_name": "crm.exe",
                 "window_title": "CRM | Orders"}}
    return [
        {"event_id": f"{prefix}-start", "type": "marker", "timestamp": ts(sec),
         "data": {"marker_type": "start", "label": f"Order {prefix}"}},
        {"event_id": f"{prefix}-act", "type": "activity", "timestamp": ts(sec),
         "data": {"app": "crm.exe", "title": "CRM | Orders", "duration_ms": 9000}},
        inter("i1", sec + 2, "Find"),
        inter("i2", sec + 5, "Save"),
        {"event_id": f"{prefix}-end", "type": "marker", "timestamp": ts(sec + 9),
         "data": {"marker_type": "end"}},
    ]


def test_a_step_without_a_time_in_a_marked_run_of_a_recording(tmp_path):
    """C16 in a recording: a step the analyst added without a time, filed in
    run 1, stays there, follows the run's timed steps in the map (the miner
    runs on two runs), in the differences and in the PDD, and no time is
    printed for it."""
    session = tmp_path / "rec"
    events = _recorded_run("a", 10) + _recorded_run("b", 40)
    _write(session, "events.jsonl", "\n".join(json.dumps(e) for e in events) + "\n")
    _write(session, "manifest.json", {"session_id": "rec-2", "started_at": "2026-09-24T09:00:00Z"})
    normalize_mod.normalize(session)
    run1 = next(r["case_id"] for r in _read(session, "stats.json")["case_stats"]
                if r["label"] == "Order a")
    anno = _read(session, "annotations.json")
    anno["steps"].append(_hand_step("h1", "Phone the customer", case_id=run1,
                                    time_range=None, order=1, system="Phone"))
    _write(session, "annotations.json", anno)
    pdd = tmp_path / "rec.docx"
    proc = _normalize_cli(session, pdd)
    assert proc.returncode == 0, proc.stderr[-3000:]

    steps = {s["step_id"]: s for s in _read(session, "annotations.json")["steps"]}
    assert steps["h1"]["case_id"] == run1
    bpmn = session / "process_map_step.bpmn"
    assert _reaches(bpmn, "CRM | Orders: Save", "Phone the customer")
    assert not _reaches(bpmn, "Phone the customer", "CRM | Orders: Find")
    blocks = _pdd(pdd)
    assert [t for k, t in blocks if k == "Heading 3"] == [
        "1. CRM | Orders: Find", "2. CRM | Orders: Save", "3. Phone the customer"]
    assert _under(blocks, "3. Phone the customer") == ["Phone · in 1 of 2 runs"]
    assert _section(blocks, "4.1 Differences between runs") == [
        "Run 2: Order b", "Skipped: Phone the customer (done in 1 of 2 runs)."]
    variants = {tuple(v["variant"]) for v in _read(session, "stats.json")["step_variants"]}
    assert ("CRM | Orders: Find", "CRM | Orders: Save", "Phone the customer") in variants


def test_a_recorder_session_without_markers_still_has_no_runs(tmp_path):
    """C16 changes nothing for a recording: no markers, no runs."""
    session = tmp_path / "rec"
    _write(session, "manifest.json", {"session_id": "rec-1",
                                      "started_at": "2026-09-24T09:00:00Z"})
    _write(session, "events.jsonl", "")
    _write(session, "annotations.json",
           {"steps": [_hand_step("r1", "Hand step", time_range=None, order=1)]})
    normalize_mod.normalize(session, mine=True)
    assert _read(session, "stats.json")["case_stats"] == []
    assert _read(session, "annotations.json")["steps"][0]["case_id"] is None
    analysis = _read(session, "analysis.json")
    assert analysis["case_quality"]["mode"] == "unsegmented"
    assert analysis["facts"] is not None and analysis["findings"] == []
    assert not (session / "process_map_step.bpmn").exists()
