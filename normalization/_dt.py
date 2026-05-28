"""Single ISO-8601 timestamp parser for the normalization pipeline.

Consolidates eight near-duplicate ``parse_ts`` / ``_parse_ts`` copies that grew
across the pipeline as each module needed its own. Each call site picks one of
three semantics depending on what it can tolerate from a corrupt or hand-edited
log:

* :func:`parse_ts`          -- strict; raises ``ValueError`` on bad input.
* :func:`parse_ts_or_none`  -- lenient; returns ``None`` on bad input.
* :func:`parse_ts_or_epoch` -- degrading; returns ``1970-01-01 UTC`` on bad
  input (used by stages that need a sortable datetime no matter what, e.g.
  anchor-case detection and step segmentation).

All three normalize a zone-LESS valid timestamp to UTC. This matters: a
zone-less timestamp from a hand-edited log mixed with the zoned ones from the
recorder used to crash with ``"can't subtract offset-naive and offset-aware
datetimes"`` -- the step-segmenter fuzzer surfaced that, and the family-wide
consistency guard in ``test_parse_ts_consistency.py`` pins it.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def parse_ts(s: Any) -> datetime:
    """Strict ISO-8601 parser. Raises ``ValueError`` / ``TypeError`` on bad input.

    Tolerates a trailing ``Z`` suffix (Python < 3.11 ``fromisoformat`` rejected
    it). A zone-less but otherwise valid timestamp is normalized to UTC so it
    can be safely subtracted from zoned peers.
    """
    raw = str(s).rstrip() if s is not None else ""
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_ts_or_none(s: Any) -> datetime | None:
    """Lenient parser: ``None`` for empty / non-ISO / non-string input."""
    if not s:
        return None
    try:
        return parse_ts(s)
    except (ValueError, TypeError):
        return None


def parse_ts_or_epoch(s: Any) -> datetime:
    """Degrading parser: ``1970-01-01 UTC`` for bad input.

    Used by stages that need *some* sortable, subtractable datetime even when a
    log has been corrupted or hand-edited (anchor-case detection, step
    segmentation) so the pipeline degrades instead of crashing.
    """
    try:
        return parse_ts(s)
    except (ValueError, TypeError):
        return _EPOCH
