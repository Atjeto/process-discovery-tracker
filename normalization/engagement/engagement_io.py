"""Engagement I/O — read, write, list. stdlib only.

PDT-1.0-SPEC §5, ADR-0030. The Engagement is a directory containing
engagement.json (metadata) plus a sessions/ folder of session symlinks or
copies, a backlog.json, and a processes/ subdirectory.

Compatible with the rest of the pipeline's plain-file approach — no
database, no service, just JSON on disk.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ENGAGEMENT_SCHEMA_VERSION = 1


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _safe_engagement_id(name: str) -> str:
    """Lower-case kebab + suffix, conservative so the id is path-safe on Windows."""
    base = re.sub(r"[^a-z0-9]+", "-", (name or "engagement").lower()).strip("-")
    if not base:
        base = "engagement"
    return base[:60]


def new_engagement(
    *,
    name: str,
    client: str | None = None,
    scope: str | None = None,
    owner: str | None = None,
) -> dict[str, Any]:
    """Return a fresh engagement.json dict. Caller picks the engagement_id."""
    return {
        "version": ENGAGEMENT_SCHEMA_VERSION,
        "engagement_id": _safe_engagement_id(name) + "-" + uuid.uuid4().hex[:6],
        "name": name,
        "client": client,
        "scope": scope,
        "owner": owner,
        "created_at": _utc_now_iso(),
        "last_modified": _utc_now_iso(),
        # Sessions belonging to this engagement. Each entry is a path
        # relative to the engagement folder OR an absolute path on disk
        # (when the session lives elsewhere and is referenced by link).
        "sessions": [],
        # Promoted processes — produced by the Cockpit's "promote to
        # backlog" action. Each is { process_id, name, description,
        # promoted_at, evidence }. The backlog.json holds the
        # consultant-facing ranked view; this is the engagement's audit trail.
        "promoted_processes": [],
        # Engagement-level configuration — knobs and overrides the consultant
        # tunes per engagement. The Phase 5 export bundle packages this into
        # an engagement-config.zip the client can import on a fresh install.
        "config": {
            "confidence_floor": 0.5,        # see ADR-0016 + analysis_roi.CONFIDENCE_FLOOR
            "variant_suppression_threshold": 3,   # PDT-1.0-SPEC §5.2 — <3 cases hides variant %s
            "currency": "EUR",
            "loaded_cost_per_hour": None,   # null => time-savings only, no monetary band
            "automatable_fraction": 0.7,
            "annual_volume": None,
        },
        "notes": "",
    }


def load_engagement(folder: str | os.PathLike) -> dict[str, Any]:
    """Read engagement.json from `folder`. Returns {} if not present."""
    f = Path(folder) / "engagement.json"
    if not f.exists():
        return {}
    try:
        with open(f, "r", encoding="utf-8") as fh:
            return json.load(fh) or {}
    except (json.JSONDecodeError, OSError):
        return {}


def write_engagement(folder: str | os.PathLike, engagement: dict[str, Any]) -> None:
    """Write engagement.json, stamping `last_modified`. Creates the folder if needed."""
    p = Path(folder)
    p.mkdir(parents=True, exist_ok=True)
    if isinstance(engagement, dict):
        engagement["last_modified"] = _utc_now_iso()
    f = p / "engagement.json"
    with open(f, "w", encoding="utf-8") as fh:
        json.dump(engagement, fh, ensure_ascii=False, indent=2)


def list_engagement_sessions(folder: str | os.PathLike) -> list[str]:
    """Return the list of session folder paths attached to this engagement.

    Combines the engagement.json `sessions` list with anything physically
    sitting under `<folder>/sessions/` (so a folder a worker dropped in
    manually is still recognised).
    """
    p = Path(folder)
    sessions: list[str] = []
    seen: set[str] = set()

    # 1. Declared sessions in engagement.json
    eng = load_engagement(p)
    declared = eng.get("sessions") if isinstance(eng, dict) else None
    if isinstance(declared, list):
        for s in declared:
            path = s if os.path.isabs(s) else str(p / s)
            if path not in seen and Path(path).exists():
                sessions.append(path)
                seen.add(path)

    # 2. Anything in sessions/ on disk
    sessions_dir = p / "sessions"
    if sessions_dir.exists() and sessions_dir.is_dir():
        for child in sorted(sessions_dir.iterdir()):
            if not child.is_dir():
                continue
            # Heuristic: a session folder always has events.jsonl or manifest.json
            if (child / "events.jsonl").exists() or (child / "manifest.json").exists():
                resolved = str(child.resolve())
                if resolved not in seen:
                    sessions.append(resolved)
                    seen.add(resolved)

    return sessions
