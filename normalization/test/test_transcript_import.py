"""transcript_import: the Teams transcript parser and its command line (C8).

Every layout the module docstring lists has a fixture here, the .docx ones
built in the test with zipfile. They are made from the documented examples,
not from a real Teams file (there is none in the repository), so they prove
the parser reads those layouts and fails loudly on others, not that Teams
still writes them; the owner's check with a real file covers that.

The command-line tests run the real script in a subprocess, because the exit
codes and the UTF-8 output are the contract the viewer relies on.

stdlib only, so this runs under any pytest.
"""

from __future__ import annotations

import codecs
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import transcript_import as ti  # noqa: E402
from transcript_import import TranscriptError, parse  # noqa: E402

SCRIPT = Path(ti.__file__).resolve()
ANA = "Ana Petrovi" + chr(0x107)           # a speaker name the ANSI code page lacks


# ---- fixtures ---------------------------------------------------------------

def _seg(start, end, speaker, text):
    return {"start_s": start, "end_s": end, "speaker": speaker, "text": text}


def _plain(segments):
    """The segments without their ids, for comparing layouts."""
    return [{k: v for k, v in s.items() if k != "id"} for s in segments]


def _vtt(tmp_path, text, name="meeting.vtt", bom=False):
    path = tmp_path / name
    path.write_bytes((codecs.BOM_UTF8 if bom else b"") + text.encode("utf-8"))
    return path


_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/'
    'vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>')


def _run(text):
    parts = []
    for piece in re.split(r"(\t|\n)", text):
        if piece == "\t":
            parts.append("<w:tab/>")
        elif piece == "\n":
            parts.append("<w:br/>")
        elif piece:
            parts.append(f'<w:t xml:space="preserve">{escape(piece)}</w:t>')
    return "<w:r>" + "".join(parts) + "</w:r>"


def _docx(tmp_path, paragraphs, name="meeting.docx"):
    """A minimal .docx whose body holds `paragraphs`: each one a string (one
    run) or a list of strings (one run each). A tab or a newline in a string
    becomes <w:tab/> or <w:br/>, the way Word stores them."""
    body = "".join(
        "<w:p>" + "".join(_run(r) for r in ([p] if isinstance(p, str) else p)) + "</w:p>"
        for p in paragraphs)
    xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           f'<w:document xmlns:w="{_W_NS}"><w:body>{body}</w:body></w:document>')
    path = tmp_path / name
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", _CONTENT_TYPES)
        package.writestr("word/document.xml", xml)
    return path


def _session(tmp_path, annotations=None):
    folder = tmp_path / "sess"
    folder.mkdir(parents=True)
    (folder / "events.jsonl").write_text(
        '{"event_id": "e1", "type": "system", "timestamp": "2026-09-23T09:00:00Z", '
        '"data": {}}\n', encoding="utf-8")
    if annotations is not None:
        text = annotations if isinstance(annotations, str) else json.dumps(annotations)
        (folder / "annotations.json").write_text(text, encoding="utf-8")
    return folder


def _snapshot(folder):
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*")) if p.is_file()}


def _cli(*args):
    proc = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                          capture_output=True, timeout=60)
    return proc.returncode, proc.stdout.decode("utf-8"), proc.stderr.decode("utf-8")


# ---- .vtt ---------------------------------------------------------------------

TEAMS_VTT = (
    "WEBVTT\n"
    "\n"
    "5c1e6f0a-2b3d-4e5f-8a9b-0c1d2e3f4a5b/12-0\n"
    "00:00:03.120 --> 00:00:05.480\n"
    f"<v {ANA}>Now I look up the customer.</v>\n"
    "\n"
    "5c1e6f0a-2b3d-4e5f-8a9b-0c1d2e3f4a5b/13-0\n"
    "00:00:05.480 --> 00:00:09.000\n"
    "<v Bo Smith>Which field do you\n"
    "search in?</v>\n"
    "\n"
    "5c1e6f0a-2b3d-4e5f-8a9b-0c1d2e3f4a5b/14-0\n"
    "01:02:03.500 --> 01:02:04.250\n"
    f"<v {ANA}>The account number &amp; the <c.yellow>name</c>.</v>\n"
)


def test_a_teams_vtt_with_voice_tags_identifiers_and_a_multi_line_cue(tmp_path):
    parsed = parse(_vtt(tmp_path, TEAMS_VTT))
    assert parsed == {"format": "vtt", "segments": [
        {"id": "t0001", "start_s": 3.12, "end_s": 5.48, "speaker": ANA,
         "text": "Now I look up the customer."},
        {"id": "t0002", "start_s": 5.48, "end_s": 9.0, "speaker": "Bo Smith",
         "text": "Which field do you search in?"},
        {"id": "t0003", "start_s": 3723.5, "end_s": 3724.25, "speaker": ANA,
         "text": "The account number & the name."},
    ]}


def test_a_vtt_without_voice_tags_with_a_bom_and_minute_only_timings(tmp_path):
    text = ("WEBVTT - exported by hand\r\n"
            "\r\n"
            "NOTE a comment block\r\n"
            "over two lines\r\n"
            "\r\n"
            "00:01.000 --> 00:04.500\r\n"
            "First line of the cue\r\n"
            "and its second line.\r\n"
            "\r\n"
            "02:03.500 --> 02:04.000 align:start position:10%\r\n"
            "No speaker <i>here</i>.\r\n")
    parsed = parse(_vtt(tmp_path, text, bom=True))
    assert _plain(parsed["segments"]) == [
        _seg(1.0, 4.5, None, "First line of the cue and its second line."),
        _seg(123.5, 124.0, None, "No speaker here."),
    ]


def test_the_legacy_and_graph_layouts_teams_also_wrote(tmp_path):
    """V2: the unpadded pre-2023 times, a 2-digit fraction read as whole
    milliseconds, and voice tags without their end tag. V3: a timing line
    right under WEBVTT, timing-only blocks with the text in the next block,
    and the speaker-unattributed Graph format with no WEBVTT line."""
    legacy = ("WEBVTT\n\n"
              "0:0:0.0 --> 0:0:1.890\n<v Jane Doe>Hi, I'm Jane.\n\n"
              "0:0:7.80 --> 0:0:8.180\n<v John Doe>Hello.\n")
    assert _plain(parse(_vtt(tmp_path, legacy, "a.vtt"))["segments"]) == [
        _seg(0.0, 1.89, "Jane Doe", "Hi, I'm Jane."),
        _seg(7.08, 8.18, "John Doe", "Hello.")]
    split = ("WEBVTT\n"
             "00:00:01.000 --> 00:00:03.000\n\n"
             "<v Alice Example>Lorem ipsum dolor sit amet.</v>\n\n"
             "00:00:03.000 --> 00:00:05.000\n\n"
             "<v Bob Example>Consectetur adipiscing elit.</v>\n")
    assert _plain(parse(_vtt(tmp_path, split, "b.vtt"))["segments"]) == [
        _seg(1.0, 3.0, "Alice Example", "Lorem ipsum dolor sit amet."),
        _seg(3.0, 5.0, "Bob Example", "Consectetur adipiscing elit.")]
    unattributed = ("00:00:01.500 --> 00:00:04.000 \n\n"
                    "Hello, thanks for joining. \n\n"
                    "00:00:04.000 --> 00:00:07.200 \n\n"
                    "Glad to be here. \n")
    assert _plain(parse(_vtt(tmp_path, unattributed, "c.vtt"))["segments"]) == [
        _seg(1.5, 4.0, None, "Hello, thanks for joining."),
        _seg(4.0, 7.2, None, "Glad to be here.")]


def test_a_cue_with_two_voices_becomes_one_segment_per_voice(tmp_path):
    text = ("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n"
            "<v Ana>Ready?</v> <v Bo>Yes.</v> <v Bo>Go.</v>\n")
    assert _plain(parse(_vtt(tmp_path, text))["segments"]) == [
        _seg(1.0, 2.0, "Ana", "Ready?"), _seg(1.0, 2.0, "Bo", "Yes. Go.")]


@pytest.mark.parametrize("text, reason", [
    ("Meeting notes\nAna: hello\n", "neither WEBVTT nor a cue timing line"),
    ("WEBVTT\n\n00:00:05.000 --> 00:00:04.000\n<v A>x\n", "before it starts"),
    ("WEBVTT\n\n00:00:05.000 --> 00:00:06.000\n<v A>x\n\n"
     "00:00:01.000 --> 00:00:02.000\n<v A>y\n", "starts before the cue above it"),
    ("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v A>x\n\nstray text\n",
     "belongs to no cue"),
    ("WEBVTT\n\n00:00:01.000 --> 00:0x:02.000\n<v A>x\n", "cannot read the timing line"),
    ("WEBVTT\n\n00:00:61.000 --> 00:01:02.000\n<v A>x\n", "is not a valid time"),
    ("WEBVTT\n\nNOTE only a note\n", "no cue with text"),
    ("", "the file is empty"),
], ids=["not-vtt", "ends-first", "out-of-order", "stray-text", "bad-timing",
        "bad-seconds", "no-text", "empty"])
def test_a_vtt_it_cannot_read_fails_loudly(tmp_path, text, reason):
    with pytest.raises(TranscriptError, match=re.escape(reason)):
        parse(_vtt(tmp_path, text))


def test_a_vtt_that_is_not_utf8_fails_loudly(tmp_path):
    path = tmp_path / "meeting.vtt"
    path.write_bytes("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n".encode("utf-16"))
    with pytest.raises(TranscriptError, match="not UTF-8"):
        parse(path)


# ---- .docx ----------------------------------------------------------------------

def test_a_docx_in_the_cue_block_layout(tmp_path):
    """D1: timing line, speaker line, utterance lines, with the unpadded and
    the padded times, and a title line before the first entry."""
    path = _docx(tmp_path, [
        "Weekly sync transcript",
        "0:0:0.0 --> 0:0:1.250", "Jane Doe", "Hi, I'm Jane.",
        "0:0:2.90 --> 0:0:4.480", "John Doe", "Hello.", "A second line.",
        "00:01:02.500 --> 00:01:04.000", "Jane Doe", "Padded times.",
    ])
    parsed = parse(path)
    assert parsed["format"] == "docx"
    assert [s["id"] for s in parsed["segments"]] == ["t0001", "t0002", "t0003"]
    assert _plain(parsed["segments"]) == [
        _seg(0.0, 1.25, "Jane Doe", "Hi, I'm Jane."),
        _seg(2.09, 4.48, "John Doe", "Hello. A second line."),
        _seg(62.5, 64.0, "Jane Doe", "Padded times."),
    ]


def test_a_docx_in_the_speaker_line_layout(tmp_path):
    """D2: "<name> <time>" lines with M:SS, HH:MM:SS and H:MM:SS times, the
    name and the time in separate runs split by a tab, a line break inside a
    paragraph, a title, date and duration before the first entry. Each
    segment ends where the next starts; the last one gets the default."""
    path = _docx(tmp_path, [
        "Order intake walkthrough",
        "22 September 2026, 10:00AM",
        "12m 5s",
        [ANA, "\t", "0:03"],
        "Now I look up the customer.",
        "Bo Smith 00:00:10\nWhich field?",
        ANA + "   1:02:05",
        "The account number.",
        "Then I save.",
    ])
    assert _plain(parse(path)["segments"]) == [
        _seg(3.0, 10.0, ANA, "Now I look up the customer."),
        _seg(10.0, 3725.0, "Bo Smith", "Which field?"),
        _seg(3725.0, 3725.0 + ti.LAST_SEGMENT_DEFAULT_S, ANA,
             "The account number. Then I save."),
    ]


@pytest.mark.parametrize("paragraphs, reason", [
    (["Agenda", "Intro", "Review"], "no transcript entries found"),
    (["Ana 0:03", "Bo 0:05", "Hello."], "a speaker line with no text after it"),
    (["Ana 0:10", "Hi.", "Bo 0:05", "Hello."], "is earlier than the entry above it"),
    (["Ana 0:03", "Hi.", "0:05", "Hello."], "a time without a speaker name"),
    (["0:0:0.0 --> 0:0:1.0", "Jane Doe"], "expected a speaker line and at least one"),
    (["0:0:x --> 0:0:1.0", "Jane Doe", "Hi."], "cannot read the timing line"),
    (["0:0:5.0 --> 0:0:6.0", "Jane", "Hi.", "0:0:1.0 --> 0:0:2.0", "Jane", "Yo."],
     "starts before the entry above it"),
    ([], "the document has no text"),
], ids=["neither-layout", "d2-no-text", "d2-time-back", "d2-bare-time",
        "d1-no-text", "d1-bad-timing", "d1-out-of-order", "empty"])
def test_a_docx_it_cannot_read_fails_loudly(tmp_path, paragraphs, reason):
    with pytest.raises(TranscriptError, match=re.escape(reason)):
        parse(_docx(tmp_path, paragraphs))


def test_a_docx_that_is_not_a_word_document_fails_loudly(tmp_path):
    not_zip = tmp_path / "a.docx"
    not_zip.write_bytes(b"this is plain text, not a ZIP package")
    with pytest.raises(TranscriptError, match="not a readable Word document"):
        parse(not_zip)
    no_body = tmp_path / "b.docx"
    with zipfile.ZipFile(no_body, "w") as package:
        package.writestr("[Content_Types].xml", _CONTENT_TYPES)
    with pytest.raises(TranscriptError, match="no word/document.xml"):
        parse(no_body)


def test_an_unsupported_file_type_is_refused_as_such(tmp_path):
    txt = tmp_path / "meeting.txt"
    txt.write_text(TEAMS_VTT, encoding="utf-8")        # a readable VTT, wrong type
    with pytest.raises(TranscriptError, match="unsupported file type '.txt'"):
        parse(txt)


# ---- the session folder and the command line ---------------------------------

def test_the_cli_imports_a_transcript_and_prints_one_summary_line(tmp_path):
    session = _session(tmp_path, {"steps": [], "external_video": {
        "path": "D:/recordings/call.mp4", "offset_ms": 1200}})
    before = _snapshot(session)
    source = _vtt(tmp_path, TEAMS_VTT)
    code, out, err = _cli(session, source)
    assert (code, err) == (0, "")
    assert out.splitlines() == [
        f"[transcript] imported meeting.vtt: 3 segments, 2 speakers ({ANA}, Bo Smith), "
        "duration 1:02:04, clock video"]
    doc = json.loads((session / "transcript.json").read_text(encoding="utf-8"))
    assert doc == {"version": 1, "source_file": "transcript/meeting.vtt",
                   "format": "vtt", "clock": "video", "offset_ms": None,
                   "segments": parse(source)["segments"]}
    assert (session / "transcript" / "meeting.vtt").read_bytes() == source.read_bytes()
    after = _snapshot(session)
    for kept in ("events.jsonl", "annotations.json"):
        assert after[kept] == before[kept], f"{kept} was modified"
    assert sorted(after) == ["annotations.json", "events.jsonl",
                             "transcript.json", "transcript/meeting.vtt"]


def test_the_clock_is_video_only_when_a_video_is_attached(tmp_path):
    cases = {
        "no annotations.json": (None, "own"),
        "no external_video": ({"steps": []}, "own"),
        "external_video without a path": ({"external_video": {"offset_ms": 5}}, "own"),
        "external_video with an empty path": ({"external_video": {"path": " "}}, "own"),
        "external_video with a path": ({"external_video": {"path": "C:/v.mp4"}}, "video"),
    }
    for label, (annotations, clock) in cases.items():
        folder = tmp_path / re.sub(r"\W+", "-", label)
        folder.mkdir()
        if annotations is not None:
            (folder / "annotations.json").write_text(json.dumps(annotations),
                                                     encoding="utf-8")
        assert ti.transcript_clock(folder) == clock, label


def test_a_re_import_replaces_the_earlier_transcript(tmp_path):
    session = _session(tmp_path, {"steps": []})
    before = _snapshot(session)
    first = _vtt(tmp_path, TEAMS_VTT, "first.vtt")
    second = _docx(tmp_path, ["Bo Smith 0:01", "A different meeting."], "second.docx")
    assert _cli(session, first)[0] == 0
    code, out, _err = _cli(session, second)
    assert code == 0 and "second.docx: 1 segment, 1 speaker (Bo Smith)" in out
    doc = json.loads((session / "transcript.json").read_text(encoding="utf-8"))
    assert doc["source_file"] == "transcript/second.docx"
    assert doc["format"] == "docx" and doc["clock"] == "own"
    assert _plain(doc["segments"]) == [
        _seg(1.0, 1.0 + ti.LAST_SEGMENT_DEFAULT_S, "Bo Smith", "A different meeting.")]
    # The earlier copy is kept; a later import under its name replaces it.
    assert (session / "transcript" / "first.vtt").read_bytes() == first.read_bytes()
    first.write_text(TEAMS_VTT.replace("customer", "supplier"), encoding="utf-8")
    assert _cli(session, first)[0] == 0
    assert (session / "transcript" / "first.vtt").read_bytes() == first.read_bytes()
    doc = json.loads((session / "transcript.json").read_text(encoding="utf-8"))
    assert doc["segments"][0]["text"] == "Now I look up the supplier."
    after = _snapshot(session)
    for kept in ("events.jsonl", "annotations.json"):
        assert after[kept] == before[kept], f"{kept} was modified"


@pytest.mark.parametrize("make, reason", [
    (lambda tmp: _vtt(tmp, TEAMS_VTT, "meeting.txt"), "unsupported file type"),
    (lambda tmp: _vtt(tmp, "Meeting notes\nAna: hello\n"), "neither WEBVTT"),
    (lambda tmp: _docx(tmp, ["Agenda", "Intro"]), "no transcript entries found"),
    (lambda tmp: tmp / "missing.vtt", "cannot read the file"),
], ids=["txt", "not-vtt", "docx-neither-layout", "missing"])
def test_the_cli_refuses_an_unsupported_file_with_exit_2_and_writes_nothing(
        tmp_path, make, reason):
    session = _session(tmp_path, {"steps": []})
    before = _snapshot(session)
    source = make(tmp_path)
    code, out, err = _cli(session, source)
    assert (code, out) == (2, "")
    assert len(err.splitlines()) == 1 and err.startswith("[transcript] ERROR: ")
    assert reason in err and "Nothing was written." in err
    assert _snapshot(session) == before
    assert not (session / "transcript").exists()


def test_the_cli_exit_codes_for_bad_arguments_and_an_unreadable_session(tmp_path):
    source = _vtt(tmp_path, TEAMS_VTT)
    for args in ((), (tmp_path,), (tmp_path, source, "extra")):
        code, out, err = _cli(*args)
        assert (code, out) == (1, ""), args
        assert err.startswith("[transcript] ERROR: usage:"), args
    not_a_session = tmp_path / "plain-folder"
    not_a_session.mkdir()
    code, _out, err = _cli(not_a_session, source)
    assert code == 1 and "is not a project folder" in err
    assert list(not_a_session.iterdir()) == []

    session = _session(tmp_path, '{"steps": [ truncated')
    before = _snapshot(session)
    code, out, err = _cli(session, source)
    assert (code, out) == (3, "")
    assert len(err.splitlines()) == 1 and "annotations.json" in err
    assert _snapshot(session) == before
    assert not (session / "transcript").exists()


def test_a_failed_write_keeps_the_previous_transcript(tmp_path, monkeypatch):
    """The exit-3 promise: when transcript.json cannot be written, the copy
    is put back as it was, a new copy removed, the old bytes restored."""
    session = _session(tmp_path)
    first = _vtt(tmp_path, TEAMS_VTT)
    ti.import_transcript(session, first)
    before = _snapshot(session)

    def disk_full(target, obj):
        raise OSError("disk full")
    monkeypatch.setattr(ti, "write_json_atomic", disk_full)
    first.write_text(TEAMS_VTT.replace("customer", "supplier"), encoding="utf-8")
    other = _vtt(tmp_path, TEAMS_VTT, "other.vtt")
    for source in (first, other):
        with pytest.raises(OSError, match="disk full"):
            ti.import_transcript(session, source)
        assert _snapshot(session) == before, source.name

    fresh = _session(tmp_path / "fresh")
    with pytest.raises(OSError, match="disk full"):
        ti.import_transcript(fresh, other)
    assert not (fresh / "transcript").exists()
    assert not (fresh / "transcript.json").exists()
