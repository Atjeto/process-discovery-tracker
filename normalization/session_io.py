"""Session-folder I/O for the normalization pipeline.

Extracted from normalize.py (god-file decomposition, continues F4). These are
the load/write helpers that touch the session folder's files plus the optional
screenshot aHash pass -- pure I/O with no pipeline logic, so the orchestrator
reads cleaner and these stay independently testable. normalize.py re-imports
every name below, so `normalize.load_events` / `from normalize import ...`
keep resolving unchanged.

Raw events.jsonl is never modified here; load_events only reads and defensively
orders, and the only writer (write_annotations) touches annotations.json.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _coerce_event_shape(obj: dict[str, Any], line_no: int) -> dict[str, Any]:
    """Guarantee the structural invariants the rest of the pipeline relies on, so
    a corrupt or hand-edited events.jsonl line degrades instead of crashing a
    downstream consumer (coalesce / case_assignment / step_suggest all assume
    these): `data` is a dict, `event_id` is a non-empty string, and `timestamp`
    is a string. Field VALUES inside `data` are validated where they're
    interpreted -- e.g. parse_ts tolerates a non-ISO timestamp string."""
    if not isinstance(obj.get("data"), dict):
        obj["data"] = {}
    eid = obj.get("event_id")
    if not isinstance(eid, str) or not eid:
        obj["event_id"] = f"_gen{line_no}"
    ts = obj.get("timestamp")
    if not isinstance(ts, str):
        obj["timestamp"] = "" if ts is None else str(ts)
    return obj


def load_events(events_file: Path) -> tuple[list[dict[str, Any]], int]:
    events = []
    dropped = 0
    # events.jsonl carries attacker-influenceable third-party strings (window
    # titles, control names, OCR text); without errors=, a genuinely non-UTF-8
    # byte raises UnicodeDecodeError at line iteration -- before the per-line
    # guard below -- aborting the whole load. "replace" degrades instead: bad
    # bytes that break a line's JSON are caught as a JSONDecodeError and counted
    # in `dropped`, while bytes inside a string value become U+FFFD (safe to
    # re-serialize/hash downstream). NOT "surrogateescape" -- json.loads accepts
    # a lone surrogate here, only to crash later at a .encode("utf-8") boundary
    # (analysis_segments). Mirrors the ADR-0025
    # recorder-stdin mojibake fix, on the file-read path.
    with open(events_file, encoding="utf-8", errors="replace") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                dropped += 1
                snippet = line[:120] + ("..." if len(line) > 120 else "")
                logger.warning(
                    "load_events: dropping malformed line %d in %s: %s | %s",
                    line_no, events_file, exc, snippet,
                )
                continue
            # A line can be valid JSON yet not an event object (a bare number,
            # string, array, null/true) -- e.g. a truncated or corrupt log.
            # Drop it like a malformed line instead of crashing downstream on
            # `.get`.
            if not isinstance(obj, dict):
                dropped += 1
                logger.warning(
                    "load_events: dropping non-object line %d in %s: %s",
                    line_no, events_file, type(obj).__name__,
                )
                continue
            events.append(_coerce_event_shape(obj, line_no))
    # Defensive ordering: timestamps are normally ISO strings (which sort
    # chronologically as strings), but a corrupt log may carry a numeric or
    # null timestamp -- coerce so heterogeneous types never crash the sort.
    def _order(e: dict[str, Any]) -> tuple[str, float]:
        ts = e.get("timestamp")
        ts = ts if isinstance(ts, str) else ("" if ts is None else str(ts))
        seq = e.get("_seq", 0)
        if isinstance(seq, bool) or not isinstance(seq, (int, float)):
            seq = 0
        return (ts, seq)
    events.sort(key=_order)
    return events, dropped


def load_manifest(session_folder: Path) -> dict[str, Any]:
    manifest_file = session_folder / "manifest.json"
    if not manifest_file.exists():
        return {}
    with open(manifest_file, encoding="utf-8") as f:
        return json.load(f)


def load_annotations(session_folder: Path) -> dict[str, Any]:
    annotations_file = session_folder / "annotations.json"
    if not annotations_file.exists():
        return {}
    try:
        with open(annotations_file, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def write_annotations(session_folder: Path, anno: dict) -> None:
    anno["last_modified"] = datetime.now(timezone.utc).isoformat()
    with open(session_folder / "annotations.json", "w", encoding="utf-8") as f:
        json.dump(anno, f, indent=2)


def compute_screenshot_hashes(session_folder: Path) -> list[dict[str, str]]:
    """Average-hash (aHash) every screenshot so the viewer's gallery can
    collapse runs of near-identical frames. Pillow is optional -- when it
    cannot be imported the feature degrades cleanly to no grouping."""
    shots_dir = session_folder / "screenshots"
    if not shots_dir.is_dir():
        return []
    try:
        from PIL import Image
    except ImportError:
        return []
    out: list[dict[str, str]] = []
    for f in sorted(shots_dir.glob("*.jpg")):
        try:
            with Image.open(f) as im:
                px = list(im.convert("L").resize((8, 8)).getdata())
        except (OSError, ValueError):
            continue
        if not px:
            continue
        avg = sum(px) / len(px)
        bits = 0
        for p in px:
            bits = (bits << 1) | (1 if p >= avg else 0)
        out.append({"filename": f.name, "hash": f"{bits:016x}"})
    return out
