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
except Exception as exc:  # pragma: no cover - optional heavy deps absent
    pytest.skip(f"normalize.py unavailable ({exc})", allow_module_level=True)


def _write(tmp_path: Path, events: list[dict]) -> Path:
    f = tmp_path / "events.jsonl"
    f.write_text("\n".join(json.dumps(e) for e in events) + "\n", encoding="utf-8")
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
