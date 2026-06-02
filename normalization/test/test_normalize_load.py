"""Tests for normalize.load_events stable ordering (Phase E, E2).

load_events sorts by (timestamp, _seq) so events that share a
millisecond timestamp keep their true append order. _seq is the
events.jsonl line ordinal stamped by the capture tracker.

Run with:
    pytest normalization/test/test_normalize_load.py

normalize.py pulls in the pm4py / pandas-backed pipeline modules at
import time; where those are not installed the whole module skips
cleanly rather than erroring the suite.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from normalize import load_events
except Exception:
    # normalize.py drags in the pm4py / pandas pipeline at import time. load_events
    # itself is dependency-free and lives in session_io (normalize re-exports it
    # unchanged), so fall back to that module where the heavy deps are absent --
    # otherwise these pure-I/O tests skip on any box without pandas installed.
    try:
        from session_io import load_events
    except Exception as exc:  # pragma: no cover - load_events genuinely unavailable
        pytest.skip(f"load_events unavailable ({exc})", allow_module_level=True)


def _write(tmp_path: Path, events: list[dict]) -> Path:
    f = tmp_path / "events.jsonl"
    f.write_text("\n".join(json.dumps(e) for e in events) + "\n", encoding="utf-8")
    return f


def _write_raw(tmp_path: Path, text: str) -> Path:
    f = tmp_path / "events.jsonl"
    f.write_text(text, encoding="utf-8")
    return f


def _write_bytes(tmp_path: Path, raw: bytes) -> Path:
    # write_text would re-encode as valid UTF-8; raw non-UTF-8 bytes need write_bytes.
    f = tmp_path / "events.jsonl"
    f.write_bytes(raw)
    return f


def test_seq_breaks_timestamp_ties(tmp_path):
    # Three events at the SAME timestamp, written out of _seq order.
    f = _write(tmp_path, [
        {"_seq": 2, "timestamp": "2026-05-17T10:00:00.000Z", "type": "system"},
        {"_seq": 0, "timestamp": "2026-05-17T10:00:00.000Z", "type": "system"},
        {"_seq": 1, "timestamp": "2026-05-17T10:00:00.000Z", "type": "system"},
    ])
    events, dropped = load_events(f)
    assert dropped == 0
    assert [e["_seq"] for e in events] == [0, 1, 2]


def test_timestamp_is_the_primary_key(tmp_path):
    # A later _seq with an earlier timestamp must still sort first.
    f = _write(tmp_path, [
        {"_seq": 0, "timestamp": "2026-05-17T10:00:02.000Z", "type": "system"},
        {"_seq": 1, "timestamp": "2026-05-17T10:00:01.000Z", "type": "system"},
    ])
    events, _ = load_events(f)
    assert [e["timestamp"] for e in events] == [
        "2026-05-17T10:00:01.000Z",
        "2026-05-17T10:00:02.000Z",
    ]


def test_missing_seq_is_treated_as_zero(tmp_path):
    # A pre-Phase-E event (no _seq) and a Phase-E one share a timestamp;
    # the missing _seq defaults to 0 and the sort must not crash.
    f = _write(tmp_path, [
        {"_seq": 3, "timestamp": "2026-05-17T10:00:00.000Z", "type": "system"},
        {"timestamp": "2026-05-17T10:00:00.000Z", "type": "system"},
    ])
    events, dropped = load_events(f)
    assert dropped == 0
    assert "_seq" not in events[0]
    assert events[1]["_seq"] == 3


def test_non_object_lines_are_dropped_not_crashed(tmp_path):
    # A line can be valid JSON yet not an event object (bare number / string /
    # array / null / bool) -- e.g. a truncated or corrupt log. It must be
    # dropped like a malformed line, never crash downstream on `.get`.
    f = _write_raw(
        tmp_path,
        '{"_seq":0,"timestamp":"2026-05-17T10:00:00.000Z","type":"system"}\n'
        '123\n"stray"\n[1,2,3]\nnull\ntrue\n'
        '{"_seq":1,"timestamp":"2026-05-17T10:00:01.000Z","type":"system"}\n',
    )
    events, dropped = load_events(f)
    assert [e["_seq"] for e in events] == [0, 1]   # only the two real events survive
    assert dropped == 5                            # the five non-objects


def test_non_string_timestamp_does_not_crash_the_sort(tmp_path):
    # A corrupt log may carry a numeric or null timestamp. The sort must coerce
    # rather than raise TypeError comparing str against int / None.
    f = _write_raw(
        tmp_path,
        '{"timestamp":1234567890,"type":"x","data":{}}\n'
        '{"timestamp":null,"type":"x","data":{}}\n'
        '{"timestamp":"2026-05-17T10:00:00.000Z","type":"x","data":{}}\n',
    )
    events, dropped = load_events(f)
    assert dropped == 0
    assert len(events) == 3   # no crash; all three kept


def test_event_shape_is_coerced_so_downstream_can_trust_it(tmp_path):
    # The loader guarantees the invariants the whole pipeline relies on, even for
    # a corrupt/hand-edited line: data is a dict, event_id is a non-empty string,
    # timestamp is a string. (coalesce / case_assignment / step_suggest all
    # assume these and used to crash otherwise.)
    f = _write_raw(
        tmp_path,
        '{"type":"interaction","timestamp":"2026-05-17T10:00:00.000Z"}\n'              # no data, no event_id
        '{"event_id":"x","type":"interaction","timestamp":1234567890,"data":null}\n'   # numeric ts, null data
        '{"event_id":"","type":"interaction","timestamp":"2026-05-17T10:00:02.000Z","data":[1]}\n',  # empty id, list data
    )
    events, dropped = load_events(f)
    assert dropped == 0
    assert len(events) == 3
    for e in events:
        assert isinstance(e["data"], dict)
        assert isinstance(e["event_id"], str) and e["event_id"]
        assert isinstance(e["timestamp"], str)


def test_non_utf8_bytes_do_not_crash_the_load_and_are_dropped(tmp_path):
    # events.jsonl carries attacker-influenceable third-party strings (window
    # titles, OCR text). A genuinely non-UTF-8 byte sequence used to raise
    # UnicodeDecodeError at line iteration -- BEFORE the per-line JSON guard runs
    # -- aborting the whole load with an unhandled exception. With errors="replace"
    # the read substitutes U+FFFD, so bad bytes that break a line's JSON structure
    # are caught like any other malformed line and counted in `dropped`, and the
    # loop survives to the next event. (Analogue of the ADR-0025 recorder-stdin
    # mojibake fix, on the file-read path.)
    f = _write_bytes(
        tmp_path,
        b'{"_seq":0,"timestamp":"2026-05-17T10:00:00.000Z","type":"system"}\n'
        b'{"_seq":1,"timestamp":"2026-05-17T10:00:01.000Z","type":"x","data":\xff\xfe}\n'
        b'{"_seq":2,"timestamp":"2026-05-17T10:00:02.000Z","type":"system"}\n',
    )
    events, dropped = load_events(f)               # must NOT raise UnicodeDecodeError
    assert [e["_seq"] for e in events] == [0, 2]   # the two well-formed events survive
    assert dropped == 1                            # the non-UTF-8 line is reported


def test_non_utf8_inside_a_string_value_degrades_to_replacement_char(tmp_path):
    # When the bad bytes fall INSIDE a JSON string value, the event is too valuable
    # to discard over a garbled title: "replace" keeps the record and swaps the
    # undecodable bytes for U+FFFD. We assert U+FFFD specifically -- NOT a lone
    # surrogate: surrogateescape would also keep the record, but as a lone surrogate
    # that json.loads silently accepts here and then crashes downstream at a
    # *.encode("utf-8") boundary (analysis_segments / anchor_suggest / marker_suggest).
    # U+FFFD re-serializes and encodes safely everywhere.
    f = _write_bytes(
        tmp_path,
        b'{"_seq":0,"timestamp":"2026-05-17T10:00:00.000Z","type":"interaction",'
        b'"data":{"title":"Create \xff\xfe INC0010010"}}\n',
    )
    events, dropped = load_events(f)               # must NOT raise
    assert dropped == 0                            # record survives, not dropped
    assert len(events) == 1
    title = events[0]["data"]["title"]
    assert chr(0xFFFD) in title                    # bad bytes became the replacement char
    assert not any(0xDC80 <= ord(c) <= 0xDCFF for c in title)  # no lone surrogate leaked
    title.encode("utf-8")                          # and the value is safe to re-encode
