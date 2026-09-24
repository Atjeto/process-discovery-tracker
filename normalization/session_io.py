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
import os
import tempfile
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


# manifest.source (contract C16): how the session was made. The viewer
# creates "video" and "blank" sessions, with an empty events.jsonl; the
# capture app's sessions carry no source, which means "recorder".
SOURCES = ("recorder", "video", "blank")
SOURCES_WITHOUT_RECORDING = ("video", "blank")


def session_source(manifest: dict | None) -> str:
    """The session's kind: manifest.source when it is "video" or "blank",
    else "recorder" (absent or unknown)."""
    source = manifest.get("source") if isinstance(manifest, dict) else None
    return source if source in SOURCES else "recorder"


def has_recording(manifest: dict | None) -> bool:
    """False for a session without a recording (a video or blank session,
    C16): the stages that measure the recording have nothing to measure."""
    return session_source(manifest) not in SOURCES_WITHOUT_RECORDING


class AnnotationsUnreadable(Exception):
    """annotations.json exists but cannot be read as an annotations object.

    Contract C13 code 2 (RP-04): normalize must stop before writing anything.
    Treating the file as empty would let the next write replace it and wipe
    the analyst's work; the viewer's numbered backups are the way back."""


def load_annotations(session_folder: Path) -> dict[str, Any]:
    """The session's annotations.json as a dict.

    An absent file is the normal state of a session nobody has annotated yet
    and loads as {}. A file that is present but unreadable (truncated, not
    UTF-8, not a JSON object, locked) raises AnnotationsUnreadable, naming the
    file and the viewer's backups."""
    annotations_file = session_folder / "annotations.json"
    if not annotations_file.exists():
        return {}
    try:
        with open(annotations_file, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as exc:     # ValueError covers JSON and UTF-8 decode errors
        raise AnnotationsUnreadable(
            _unreadable_message(annotations_file, f"{type(exc).__name__}: {exc}")
        ) from exc
    if not isinstance(data, dict):
        raise AnnotationsUnreadable(_unreadable_message(
            annotations_file, f"the top level is {type(data).__name__}, not an object"))
    return data


def _unreadable_message(path: Path, reason: str) -> str:
    return (f"{path} exists but cannot be read ({reason}). Nothing was written. "
            "The viewer keeps the previous versions next to it as "
            "annotations.json.2 to annotations.json.5; copy the newest good one "
            "over annotations.json, then analyze again.")


def write_annotations(session_folder: Path, anno: dict) -> None:
    """Write annotations.json atomically (RP-04), through write_json_atomic,
    so a crash or a cancelled run never leaves a truncated file behind."""
    anno["last_modified"] = datetime.now(timezone.utc).isoformat()
    write_json_atomic(session_folder / "annotations.json", anno)


def write_json_atomic(target: Path, obj: Any) -> None:
    """Write `obj` as JSON to `target` atomically: the JSON goes to a temp file
    in the same folder, which then replaces `target` in one step. A write that
    fails part-way leaves `target` exactly as it was and no temp file behind,
    and the error is re-raised."""
    target = Path(target)
    fd, tmp_name = tempfile.mkstemp(dir=target.parent,
                                    prefix=target.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, target)
    except BaseException:
        # The temp file is ours and incomplete; remove it, then re-raise so
        # the failure still stops the run. The target is untouched.
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


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
