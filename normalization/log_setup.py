"""Centralized logging configuration for the normalization pipeline.

Call `setup_logging(session_folder=...)` once at process entry. Module
loggers use the standard `logging.getLogger(__name__)` pattern and inherit
from the root config set here.

Two handlers:
- stderr at WARNING (so the existing `print("[normalize] ...")` status
  stream stays clean and warnings stand out)
- per-session file at INFO when `session_folder` is given, written to
  `<session_folder>/normalize.log`. Rotates when the file passes ~2 MB.

Idempotent: calling twice with the same session folder reuses handlers.
"""

from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path

_FMT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"
_DATEFMT = "%Y-%m-%dT%H:%M:%S"


def setup_logging(session_folder: Path | str | None = None, level: int = logging.WARNING) -> None:
    root = logging.getLogger()
    root.setLevel(min(level, logging.INFO))

    have_stream = any(
        isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler)
        for h in root.handlers
    )
    if not have_stream:
        sh = logging.StreamHandler()
        sh.setLevel(level)
        sh.setFormatter(logging.Formatter(_FMT, _DATEFMT))
        root.addHandler(sh)

    if session_folder is None:
        return

    log_path = Path(session_folder) / "normalize.log"
    already = any(
        isinstance(h, logging.handlers.RotatingFileHandler)
        and Path(h.baseFilename) == log_path.resolve()
        for h in root.handlers
    )
    if already:
        return

    fh = logging.handlers.RotatingFileHandler(
        log_path, maxBytes=2 * 1024 * 1024, backupCount=2, encoding="utf-8"
    )
    fh.setLevel(logging.INFO)
    fh.setFormatter(logging.Formatter(_FMT, _DATEFMT))
    root.addHandler(fh)
