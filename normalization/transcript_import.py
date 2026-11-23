"""Import a meeting transcript into a session folder (contract C8).

When the SME is recorded during a Teams call, the meeting transcript says what
the SME said while doing each step. This module reads the transcript file
Teams produces (.vtt or .docx) into timestamped segments with speaker names.
Nothing here interprets the text: the viewer shows the segments next to the
steps and the analyst decides what to use.

Usage:
    python transcript_import.py <session_folder> <transcript_file> [--out <name>]

--out names the transcript written (contract C23, 2.0.6: a project holds one
transcript per video, transcript.json, then transcript-2.json and on); the
default is transcript.json. Any other name is a usage error.

Exit codes. Codes 1 to 3 print one stderr line starting "[transcript] ERROR:".
    0  imported; one summary line on stdout (segments, speakers, duration)
    1  bad arguments: not the two above (with --out <name>), or the folder is
       not a session folder (it has no events.jsonl)
    2  the transcript file cannot be read, or its layout is not one listed
       below; nothing was written
    3  the session folder cannot be used: annotations.json exists but cannot
       be read (so the clock cannot be chosen; nothing was written), or the
       output could not be written (the previous transcript is kept)

What it writes, and nothing else (events.jsonl and annotations.json are only
read, never written):
    <session>/transcript/<original name>   a byte-for-byte copy of the file
    <session>/transcript.json              written atomically:
        {"version": 1, "source_file": "transcript/<name>",
         "format": "vtt" | "docx", "clock": "video" | "own", "offset_ms": null,
         "segments": [{"id": "t0001", "start_s": 12.34, "end_s": 15.0,
                       "speaker": "Ana" | null, "text": "..."}]}
    `clock` is "video" when annotations.json has a video with a path
    (`external_videos`, or the `external_video` of a project of 2.0.5),
    else "own". `offset_ms` is always null here: the viewer sets it when the
    analyst syncs an "own" clock, and `video_id` when the transcript belongs
    to one video of the chain (C23). Times are seconds from the transcript's
    own start, to the millisecond. A re-import replaces the transcript file
    entirely (offset_ms included); a copy made by an earlier import stays in
    transcript/, and one with the same name is replaced, unless another
    transcript of the project names it: the copy then takes a free name
    ("meeting (2).vtt").

parse(path) is the reusable entry point (the viewer can run it through
python-runner): it returns {"format": "vtt" | "docx", "segments": [...]},
the segments in the shape above, and raises TranscriptError with a one-line
reason. It writes nothing.

Supported layouts, the evidence for each, and how sure it is. No real Teams
file was available; an owner check with a real file is still needed, and
anything else fails loudly instead of being guessed at.

.vtt, read as UTF-8 (a leading byte order mark is dropped):
  V1  "WEBVTT", then cues: an optional identifier line (Teams writes
      "<uuid>/<n>-<m>"), a timing line "HH:MM:SS.mmm --> HH:MM:SS.mmm" or
      "MM:SS.mmm --> MM:SS.mmm" (cue settings after it are ignored), then the
      text lines. The speaker is the voice tag <v Name>text</v>; the end tag
      may be left out. Evidence: the text/vtt examples in Microsoft's Graph
      callTranscript documentation and the README of teams-transcript-
      formatter (a Teams download). Confident.
  V2  The unpadded timing Teams wrote until January 2023,
      "0:0:0.0 --> 0:0:1.890", in .vtt and .docx files alike. Evidence:
      Microsoft 365 message center MC485792, which announced the change to
      padded times. Confident that it exists; see the note on fractions.
  V3  A timing line directly under "WEBVTT" with no blank line between, a
      file with no "WEBVTT" line at all, and a timing line alone in its block
      with its text in the next block. Evidence: Microsoft's Graph examples
      (metadataContent, and the speaker-unattributed format
      application/vnd.microsoft.graph.transcript+text, which has no WEBVTT
      line) and a GitHub issue (GreenJesterAt/webvtt-to-markdown #1) that
      reports the split layout, with voice tags, from a Graph Teams
      transcript. Confident for Graph exports; not seen in a download from
      the Teams app.
  Other tags (<c>, <i>, <b>, <lang>, timestamps) are dropped and their text
  kept; character references (&amp;) are decoded; NOTE, STYLE and REGION
  blocks are skipped. A cue with several voices becomes one segment per
  voice, each with the cue's times. A cue without a voice tag has speaker
  null: a "Name: text" line is not split into a speaker, because that would
  be a guess. A cue with no text is skipped.
  Fails on: a first line that is neither WEBVTT nor a timing line, a timing
  line that cannot be read, a cue that ends before it starts, a cue that
  starts before the cue above it, text that belongs to no cue, and a file
  with no cue text at all.

.docx, word/document.xml read with zipfile and xml.etree: every paragraph in
document order, a line break inside a paragraph starting a new line:
  D1  Cue blocks: a paragraph "0:0:0.0 --> 0:0:1.250" (either timing form
      above), the next paragraph names the speaker, and the paragraphs after
      it, up to the next timing line, are the utterance. Evidence: the README
      of endjin/TeamsTranscript ("Given the following transcript (in a
      .docx)") and MC485792 (the same times in .docx files). Confident that
      Teams wrote it at least until the January 2023 time change;
      unverified against a current download.
  D2  Speaker-and-time lines: a paragraph "Ana Petrovic   0:03" (the name,
      spaces or a tab, then M:SS, MM:SS, H:MM:SS or HH:MM:SS), then the
      utterance paragraphs up to the next such line. Paragraphs before the
      first one (meeting title, date, duration) are skipped. Evidence: the
      task brief and a recollection of the current Teams .docx download; NO
      sample was found to confirm it, so this is the least certain layout.
      Each segment ends where the next one starts; the last one ends
      LAST_SEGMENT_DEFAULT_S seconds after it starts.
  Fails on: a document with neither layout, a timing line that cannot be
  read, a D1 timing line without a speaker line and text after it, a D2
  speaker line without text after it, a time earlier than the one above it,
  and a D2 paragraph that is only a time (a layout without speaker names,
  not known here).
  Known limits: a D2 preamble line that ends in a clock time ("3 November
  2023, 14:30") reads as an entry and then fails the time-order check,
  loudly; a D1 entry whose speaker line is missing reads its first
  utterance line as the speaker.

Fractions of a second: the unpadded V2 times print the milliseconds as a
whole number without leading zeros. One sample file has "0:0:7.80" next to
"0:0:5.300"; a printer that keeps the trailing zeros of "5.300" would have
printed 7.8 s as "7.800". So a fraction of 1 or 2 digits is read as whole
milliseconds (7.080 s). The decimal reading (7.8 s) would differ by under a
second; 3-digit fractions read the same either way.

Standard library only (zipfile, xml.etree, html), so the tests run on any
Python.
"""

from __future__ import annotations

import html
import io
import json
import os
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any

# The Python embeddable the viewer bundles does not put the script's folder on
# sys.path; add it so the sibling import below resolves (as normalize.py does).
sys.path.insert(0, str(Path(__file__).resolve().parent))

from session_io import (  # noqa: E402
    AnnotationsUnreadable, load_annotations, write_json_atomic, long_path, plain_path, plain_streams,
)

FORMAT_VERSION = 1

# The end of the last D2 (.docx speaker-line) segment, which has no end time
# of its own: a typical length for one spoken sentence.
LAST_SEGMENT_DEFAULT_S = 5.0

# A meeting transcript is kilobytes to a few megabytes. A file (or a .docx
# body) far larger than that is not one, and is refused before it is read.
MAX_BYTES = 64 * 1024 * 1024

USAGE = "usage: python transcript_import.py <session_folder> <transcript_file> [--out <name>]"

# The transcript files of a project (C23): transcript.json, transcript-2.json...
OUT_NAME = re.compile(r"^transcript(?:-(\d+))?\.json$")


class TranscriptError(ValueError):
    """The transcript cannot be read, or its layout is not one this module
    supports. The message is one line; nothing has been written."""


# ---- times ------------------------------------------------------------------

# [h:]m:s[.fff]; any part may be unpadded (V2) and the fraction may be absent.
_TIME_RE = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?")


def _clock_ms(m: re.Match, where: str) -> int:
    """Milliseconds of a _TIME_RE match. Seconds, and minutes when hours are
    given, must be below 60. A fraction is whole milliseconds, also when it
    has fewer than 3 digits (see the module docstring)."""
    hours, minutes, seconds, fraction = m.groups()
    h, mi, s = int(hours or 0), int(minutes), int(seconds)
    if s > 59 or (hours is not None and mi > 59):
        raise TranscriptError(f"{where}: {m.group(0)!r} is not a valid time")
    return ((h * 60 + mi) * 60 + s) * 1000 + int(fraction or 0)


def _timing(line: str, where: str) -> tuple[int, int]:
    """(start_ms, end_ms) of a timing line "<start> --> <end> [settings]"."""
    left, _arrow, right = line.partition("-->")
    parts = right.split()
    start = _TIME_RE.fullmatch(left.strip())
    end = _TIME_RE.fullmatch(parts[0]) if parts else None
    if start is None or end is None:
        raise TranscriptError(f"{where}: cannot read the timing line {line.strip()[:80]!r}")
    start_ms, end_ms = _clock_ms(start, where), _clock_ms(end, where)
    if end_ms < start_ms:
        raise TranscriptError(f"{where}: the cue ends ({end.group(0)}) before it "
                              f"starts ({start.group(0)})")
    return start_ms, end_ms


def _clean(text: str) -> str:
    """Whitespace collapsed to single spaces, trimmed."""
    return " ".join(text.split())


# ---- .vtt -------------------------------------------------------------------

_KEYWORD_BLOCK_RE = re.compile(r"(?:NOTE|STYLE|REGION)(?:[ \t]|$)")
_TAG_RE = re.compile(r"<[^>]*>")
_VOICE_RE = re.compile(r"<v(?:\.[^\s>]*)?(?:[ \t\f]+([^>]*))?>")
_VOICE_END_RE = re.compile(r"</v\s*>")


def _voice_spans(payload: str) -> list[tuple[str | None, str]]:
    """(speaker, text) spans of one cue's text: text inside <v Name> is Name's,
    text outside any voice span has no speaker. Other tags are dropped (their
    text kept), character references decoded, whitespace collapsed, and
    neighbouring spans of one speaker joined."""
    spans: list[list] = []
    speaker: str | None = None
    parts: list[str] = []

    def flush() -> None:
        text = _clean(html.unescape("".join(parts)))
        parts.clear()
        if not text:
            return
        if spans and spans[-1][0] == speaker:
            spans[-1][1] += " " + text
        else:
            spans.append([speaker, text])

    pos = 0
    for tag in _TAG_RE.finditer(payload):
        parts.append(payload[pos:tag.start()])
        pos = tag.end()
        voice = _VOICE_RE.fullmatch(tag.group(0))
        if voice is not None:
            flush()
            speaker = _clean(html.unescape(voice.group(1) or "")) or None
        elif _VOICE_END_RE.fullmatch(tag.group(0)):
            flush()
            speaker = None
    parts.append(payload[pos:])
    flush()
    return [(who, text) for who, text in spans]


def _vtt_segments(text: str) -> list[tuple[int, int, str | None, str]]:
    """(start_ms, end_ms, speaker, text) of every cue with text (layouts V1 to
    V3). Blocks are collected by the WebVTT parsing rules: a timing line on
    the first or second line of a block is its timing (a line above it is
    the cue identifier), and a timing line further down starts a new block."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    n, i = len(lines), 0
    while i < n and not lines[i].strip():
        i += 1
    if i == n:
        raise TranscriptError("the file is empty")
    first = lines[i].strip()
    if first == "WEBVTT" or first.startswith(("WEBVTT ", "WEBVTT\t")):
        i += 1
        # The header runs to the first blank line; a timing line ends it early
        # (V3: Microsoft's own exports put the first cue right under WEBVTT).
        while i < n and lines[i].strip() and "-->" not in lines[i]:
            i += 1
    elif "-->" not in first:
        raise TranscriptError("not a WebVTT transcript: the first line is neither "
                              "WEBVTT nor a cue timing line")

    cues: list[list] = []            # [start_ms, end_ms, text lines]
    after_empty_cue = False
    while i < n:
        if not lines[i].strip():
            i += 1
            continue
        top = i
        block: list[str] = []
        timing_at = None
        while i < n and lines[i].strip():
            if "-->" in lines[i]:
                if timing_at is None and len(block) < 2:
                    timing_at = len(block)
                else:
                    break            # this timing line starts the next block
            block.append(lines[i])
            i += 1
        if timing_at is not None:
            where = f"line {top + timing_at + 1}"
            start, end = _timing(block[timing_at], where)
            if cues and start < cues[-1][0]:
                raise TranscriptError(f"{where}: this cue starts before the cue above it")
            payload = block[timing_at + 1:]
            cues.append([start, end, payload])
            after_empty_cue = not payload
        elif _KEYWORD_BLOCK_RE.match(block[0]):
            after_empty_cue = False  # NOTE, STYLE and REGION blocks are skipped
        elif after_empty_cue:
            cues[-1][2] = block      # V3: the text block of a timing-only cue
            after_empty_cue = False
        else:
            raise TranscriptError(f"line {top + 1}: text that belongs to no cue "
                                  f"({block[0].strip()[:60]!r})")
    segments = [(start, end, speaker, spoken)
                for start, end, payload in cues
                for speaker, spoken in _voice_spans("\n".join(payload))]
    if not segments:
        raise TranscriptError("no cue with text was found")
    return segments


# ---- .docx ------------------------------------------------------------------

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# D2: the speaker's name, a space, then a time with two-digit seconds. Lines
# are whitespace-collapsed first, so a tab or several spaces match too.
_SPEAKER_TIME_RE = re.compile(r"(\S.*?) ((?:\d+:)?\d{1,2}:\d{2}(?:\.\d{1,3})?)")
_BARE_TIME_RE = re.compile(r"(?:\d+:)?\d{1,2}:\d{2}(?:\.\d{1,3})?")


def _docx_lines(data: bytes) -> list[tuple[int, str]]:
    """(paragraph number, text) of every non-blank line of the document body,
    in order. A line break inside a paragraph starts a new line; a tab reads
    as a space; whitespace is collapsed."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            try:
                info = package.getinfo("word/document.xml")
            except KeyError:
                raise TranscriptError("not a Word document: it has no "
                                      "word/document.xml") from None
            if info.file_size > MAX_BYTES:
                raise TranscriptError(f"the document body is {info.file_size} bytes, "
                                      "far larger than a meeting transcript")
            body = package.read(info)
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError,
            OSError) as e:
        raise TranscriptError(f"not a readable Word document ({type(e).__name__}: "
                              f"{e})") from None
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        raise TranscriptError(f"word/document.xml cannot be read as XML ({e})") from None
    lines: list[tuple[int, str]] = []
    for number, paragraph in enumerate(root.iter(_W + "p"), start=1):
        pieces: list[str] = []
        for run in paragraph.iter(_W + "r"):
            for child in run:
                if child.tag == _W + "t":
                    pieces.append(child.text or "")
                elif child.tag == _W + "tab":
                    pieces.append("\t")
                elif child.tag in (_W + "br", _W + "cr"):
                    pieces.append("\n")
                elif child.tag == _W + "noBreakHyphen":
                    pieces.append("-")
        for line in "".join(pieces).split("\n"):
            line = _clean(line)
            if line:
                lines.append((number, line))
    return lines


def _cue_block_entries(lines: list[tuple[int, str]]) -> list[tuple[int, int, str, str]]:
    """Layout D1: timing line, speaker line, utterance lines."""
    entries: list[list] = []         # [start_ms, end_ms, speaker, text lines, where]

    def check_last() -> None:
        if entries and (entries[-1][2] is None or not entries[-1][3]):
            raise TranscriptError(f"{entries[-1][4]}: expected a speaker line and at "
                                  "least one line of text after this timing line")

    for number, line in lines:
        where = f"paragraph {number}"
        if "-->" in line:
            check_last()
            start, end = _timing(line, where)
            if entries and start < entries[-1][0]:
                raise TranscriptError(f"{where}: this entry starts before the entry above it")
            entries.append([start, end, None, [], where])
        elif not entries:
            continue                 # title or date lines before the first entry
        elif entries[-1][2] is None:
            entries[-1][2] = line    # the line after the timing names the speaker
        else:
            entries[-1][3].append(line)
    check_last()
    return [(start, end, speaker, " ".join(text))
            for start, end, speaker, text, _where in entries]


def _speaker_line_entries(lines: list[tuple[int, str]]) -> list[tuple[int, int, str, str]]:
    """Layout D2: a speaker-and-time line, then utterance lines."""
    entries: list[list] = []         # [start_ms, speaker, text lines, where]

    def check_last() -> None:
        if entries and not entries[-1][2]:
            raise TranscriptError(f"{entries[-1][3]}: a speaker line with no text after it")

    for number, line in lines:
        where = f"paragraph {number}"
        m = _SPEAKER_TIME_RE.fullmatch(line)
        if m:
            check_last()
            start = _clock_ms(_TIME_RE.fullmatch(m.group(2)), where)
            if entries and start < entries[-1][0]:
                raise TranscriptError(f"{where}: the time {m.group(2)} is earlier than "
                                      "the entry above it")
            entries.append([start, m.group(1), [], where])
        elif not entries:
            continue                 # title, date and duration before the first entry
        elif _BARE_TIME_RE.fullmatch(line):
            raise TranscriptError(f"{where}: a time without a speaker name; a transcript "
                                  "without speaker names is not a layout this module reads")
        else:
            entries[-1][2].append(line)
    check_last()
    last_ms = round(LAST_SEGMENT_DEFAULT_S * 1000)
    return [(start,
             entries[k + 1][0] if k + 1 < len(entries) else start + last_ms,
             speaker, " ".join(text))
            for k, (start, speaker, text, _where) in enumerate(entries)]


def _docx_segments(data: bytes) -> list[tuple[int, int, str, str]]:
    """(start_ms, end_ms, speaker, text) of every entry (layouts D1, D2)."""
    lines = _docx_lines(data)
    if not lines:
        raise TranscriptError("the document has no text")
    if any("-->" in line for _n, line in lines):
        return _cue_block_entries(lines)
    if any(_SPEAKER_TIME_RE.fullmatch(line) for _n, line in lines):
        return _speaker_line_entries(lines)
    raise TranscriptError('no transcript entries found: expected timing lines such as '
                          '"0:0:1.250 --> 0:0:4.480" or speaker lines such as '
                          '"Ana Petrovic 0:03"')


# ---- the parsed transcript --------------------------------------------------

def _read(path: Path) -> bytes:
    try:
        size = path.stat().st_size
        if size > MAX_BYTES:
            raise TranscriptError(f"the file is {size} bytes, far larger than a "
                                  "meeting transcript")
        return path.read_bytes()
    except OSError as e:
        raise TranscriptError(f"cannot read the file ({type(e).__name__}: "
                              f"{e.strerror or e})") from None


def _check_suffix(suffix: str) -> None:
    if suffix not in (".vtt", ".docx"):
        raise TranscriptError(f"unsupported file type {suffix or '(none)'!r}: a Teams "
                              "transcript is a .vtt or a .docx file")


def _parse_bytes(suffix: str, data: bytes) -> dict[str, Any]:
    _check_suffix(suffix)
    if suffix == ".vtt":
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError as e:
            raise TranscriptError(f"the file is not UTF-8 text (byte {e.start})") from None
        raw = _vtt_segments(text)
    else:
        raw = _docx_segments(data)
    return {
        "format": suffix[1:],
        "segments": [{"id": f"t{k:04d}", "start_s": round(start / 1000, 3),
                      "end_s": round(end / 1000, 3), "speaker": speaker or None,
                      "text": text}
                     for k, (start, end, speaker, text) in enumerate(raw, start=1)],
    }


def parse(path: str | Path) -> dict[str, Any]:
    """Parse a Teams transcript: {"format": "vtt" | "docx", "segments": [...]}
    (each segment {"id", "start_s", "end_s", "speaker", "text"}). Raises
    TranscriptError with a one-line reason; writes nothing."""
    path = Path(path)
    suffix = path.suffix.lower()
    _check_suffix(suffix)            # refused as a type before any read
    return _parse_bytes(suffix, _read(path))


# ---- the session folder -----------------------------------------------------

def transcript_clock(session_folder: str | Path) -> str:
    """"video" when annotations.json has a video with a path (external_videos,
    C23, or a project of 2.0.5's external_video), else "own". Raises
    AnnotationsUnreadable when annotations.json exists but cannot be read."""
    anno = load_annotations(Path(session_folder))
    videos = anno.get("external_videos")
    if not isinstance(videos, list):
        videos = [anno.get("external_video")]
    for video in videos:
        path = video.get("path") if isinstance(video, dict) else None
        if isinstance(path, str) and path.strip():
            return "video"
    return "own"


def _copy_name(session_folder: Path, name: str, out: str) -> str:
    """The name the original's copy takes in transcript/: `name`, unless
    another transcript of the project (not `out`) names transcript/<name> as
    its source: then the first free "stem (n).ext"."""
    named = set()
    for f in session_folder.glob("transcript*.json"):
        if f.name == out or not OUT_NAME.match(f.name):
            continue
        try:
            src = json.loads(f.read_text(encoding="utf-8")).get("source_file")
        except (OSError, ValueError, AttributeError):
            continue
        if isinstance(src, str):
            named.add(src)
    if f"transcript/{name}" not in named:
        return name
    stem, suffix = Path(name).stem, Path(name).suffix
    n = 2
    while f"transcript/{stem} ({n}){suffix}" in named:
        n += 1
    return f"{stem} ({n}){suffix}"


def _write_bytes_atomic(target: Path, data: bytes) -> None:
    fd, tmp_name = tempfile.mkstemp(dir=target.parent, prefix=target.name + ".",
                                    suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, target)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def write_transcript(session_folder: str | Path, name: str, data: bytes,
                     parsed: dict[str, Any], clock: str,
                     out: str = "transcript.json") -> dict[str, Any]:
    """Copy the transcript's bytes to <session>/transcript/<name> (a free
    name when another transcript names that one, _copy_name), then write
    `out` (transcript.json by default) atomically; returns its document.
    When a write fails, the copy is put back as it was (removed, or its
    previous bytes restored) and the OSError is raised, so the previous
    transcript is kept."""
    session_folder = Path(session_folder)
    folder = session_folder / "transcript"
    name = _copy_name(session_folder, name, out)
    copy = folder / name
    doc = {"version": FORMAT_VERSION, "source_file": f"transcript/{name}",
           "format": parsed["format"], "clock": clock, "offset_ms": None,
           "segments": parsed["segments"]}
    previous = copy.read_bytes() if copy.is_file() else None
    made_folder = not folder.is_dir()
    folder.mkdir(exist_ok=True)
    try:
        _write_bytes_atomic(copy, data)
        write_json_atomic(session_folder / out, doc)
    except BaseException:
        # Best-effort roll-back; the original error is re-raised either way.
        try:
            if previous is None:
                copy.unlink(missing_ok=True)
            else:
                _write_bytes_atomic(copy, previous)
            if made_folder:
                folder.rmdir()
        except OSError:
            pass
        raise
    return doc


def import_transcript(session_folder: str | Path, source: str | Path,
                      out: str = "transcript.json") -> dict[str, Any]:
    """Parse `source` and write it into the session as `out`. Raises
    TranscriptError or AnnotationsUnreadable before anything is written, and
    OSError when the writing fails (the previous transcript is kept)."""
    source = Path(source)
    suffix = source.suffix.lower()
    _check_suffix(suffix)
    data = _read(source)             # parsed and copied from the same bytes
    parsed = _parse_bytes(suffix, data)
    clock = transcript_clock(session_folder)
    return write_transcript(session_folder, source.name, data, parsed, clock, out)


# ---- command line -----------------------------------------------------------

def _hms(seconds: float) -> str:
    h, rest = divmod(int(round(seconds)), 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}"


def summary_line(name: str, doc: dict[str, Any]) -> str:
    segments = doc["segments"]
    speakers = list(dict.fromkeys(s["speaker"] for s in segments if s["speaker"]))
    who = (f"{len(speakers)} speaker{'' if len(speakers) == 1 else 's'} "
           f"({', '.join(speakers)})" if speakers else "no speaker names")
    return (f"[transcript] imported {name}: {len(segments)} segment"
            f"{'' if len(segments) == 1 else 's'}, {who}, duration "
            f"{_hms(max(s['end_s'] for s in segments))}, clock {doc['clock']}")


def _fail(code: int, message: str) -> int:
    one_line = plain_path(message).replace("\r", " ").replace("\n", " ")
    print(f"[transcript] ERROR: {one_line}", file=sys.stderr, flush=True)
    return code


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else list(argv)
    if args in (["-h"], ["--help"]):
        print(USAGE)
        return 0
    out = "transcript.json"
    if len(args) == 4 and args[2] == "--out":
        out = args[3]
        args = args[:2]
        if not OUT_NAME.match(out):
            return _fail(1, f"--out {out}: a transcript is named transcript.json or "
                            f"transcript-<n>.json")
    if len(args) != 2:
        return _fail(1, USAGE)
    # Both paths become extended-length paths, once, so a project folder past
    # 260 characters works (session_io.long_path); --out is a file name in
    # the folder and inherits it. The messages show them plain.
    session, source = long_path(args[0]), long_path(args[1])
    if not session.is_dir() or not (session / "events.jsonl").is_file():
        # The viewer shows this line; a person calls the folder a project.
        return _fail(1, f"{session} is not a project folder (it has no events.jsonl)")
    try:
        doc = import_transcript(session, source, out)
    except TranscriptError as e:
        return _fail(2, f"{source}: {e}. Nothing was written.")
    except AnnotationsUnreadable as e:
        return _fail(3, f"cannot choose the transcript clock: {e}")
    except OSError as e:
        return _fail(3, f"could not write the transcript into {session} "
                        f"({type(e).__name__}: {e}); the previous transcript is kept")
    print(summary_line(source.name, doc))
    return 0


if __name__ == "__main__":
    # The viewer reads this output as UTF-8 through a pipe, where Python would
    # otherwise use the ANSI code page and fail on a speaker name it cannot
    # encode.
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    # No line shows the extended-length prefix (a crash's traceback too).
    plain_streams()
    sys.exit(main())
