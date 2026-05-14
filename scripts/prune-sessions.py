"""Storage retention CLI for captured sessions.

Lists or deletes session folders older than a given age. Defaults to
dry-run; pass --apply to actually delete.

Usage:
    python scripts/prune-sessions.py --older-than 90        # list
    python scripts/prune-sessions.py --older-than 90 --apply

    # Custom sessions root (e.g. when running on the worker machine)
    python scripts/prune-sessions.py --root "%APPDATA%/process-discovery-tracker/sessions" --older-than 30 --apply

The default root resolves to the standard capture output location on
the current OS.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def default_sessions_root() -> Path:
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", "")) / "process-discovery-tracker" / "sessions"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "process-discovery-tracker" / "sessions"
    return Path.home() / ".config" / "process-discovery-tracker" / "sessions"


def collect_sessions(root: Path) -> list[dict]:
    """Walk root/<engagement>/<session>/. Return one dict per session."""
    out = []
    if not root.is_dir():
        return out
    for engagement_dir in sorted(root.iterdir()):
        if not engagement_dir.is_dir():
            continue
        for session_dir in sorted(engagement_dir.iterdir()):
            if not session_dir.is_dir():
                continue
            manifest = session_dir / "manifest.json"
            started_at = None
            status = "?"
            if manifest.exists():
                try:
                    m = json.loads(manifest.read_text(encoding="utf-8"))
                    started_at = m.get("started_at")
                    status = m.get("status", "?")
                except Exception:
                    pass
            # Fallback: session folder name is YYYYMMDD-HHMMSS
            if not started_at:
                try:
                    started_at = datetime.strptime(
                        session_dir.name, "%Y%m%d-%H%M%S"
                    ).replace(tzinfo=timezone.utc).isoformat()
                except ValueError:
                    pass
            size = sum(p.stat().st_size for p in session_dir.rglob("*") if p.is_file())
            out.append({
                "path": session_dir,
                "engagement": engagement_dir.name,
                "session": session_dir.name,
                "started_at": started_at,
                "status": status,
                "size_bytes": size,
            })
    return out


def parse_age_to_cutoff(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


def fmt_size(b: int) -> str:
    if b > 1 << 30:
        return f"{b / (1 << 30):.1f} GB"
    if b > 1 << 20:
        return f"{b / (1 << 20):.1f} MB"
    if b > 1 << 10:
        return f"{b / (1 << 10):.1f} KB"
    return f"{b} B"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="List or delete captured sessions older than a given age."
    )
    parser.add_argument("--root", type=Path, default=None,
                        help="Sessions root folder. Defaults to the standard capture output location.")
    parser.add_argument("--older-than", type=int, default=90,
                        help="Age threshold in days. Default: 90.")
    parser.add_argument("--keep-recovered", action="store_true",
                        help="Skip sessions whose status is 'recovered' (may need analyst attention).")
    parser.add_argument("--apply", action="store_true",
                        help="Actually delete. Without this flag, the script lists candidates only.")
    parser.add_argument("--json", action="store_true",
                        help="Emit results as JSON instead of a human-readable table.")
    args = parser.parse_args()

    root = args.root or default_sessions_root()
    if not root.is_dir():
        print(f"sessions root not found: {root}", file=sys.stderr)
        sys.exit(2)

    cutoff = parse_age_to_cutoff(args.older_than)
    cutoff_iso = cutoff.isoformat()

    all_sessions = collect_sessions(root)
    candidates = []
    for s in all_sessions:
        if not s["started_at"]:
            continue
        if s["started_at"] >= cutoff_iso:
            continue
        if args.keep_recovered and s["status"] == "recovered":
            continue
        candidates.append(s)

    if args.json:
        result = {
            "root": str(root),
            "cutoff": cutoff_iso,
            "total_sessions": len(all_sessions),
            "candidates": [
                {**c, "path": str(c["path"])} for c in candidates
            ],
            "applied": False,
        }
        print(json.dumps(result, indent=2))
    else:
        print(f"sessions root: {root}")
        print(f"cutoff: {cutoff_iso}  (sessions older than {args.older_than} days)")
        print(f"total sessions: {len(all_sessions)}")
        print(f"candidates for deletion: {len(candidates)}")
        if candidates:
            print()
            print(f"{'engagement':<28} {'session':<24} {'status':<10} {'size':>10}  started")
            print("-" * 100)
            for c in candidates:
                print(f"{c['engagement'][:28]:<28} {c['session'][:24]:<24} "
                      f"{c['status'][:10]:<10} {fmt_size(c['size_bytes']):>10}  "
                      f"{c['started_at'] or '-'}")

    if not args.apply:
        if candidates:
            print(f"\n(dry run - pass --apply to delete the {len(candidates)} candidate(s) above)")
        return

    deleted = 0
    freed = 0
    for c in candidates:
        try:
            shutil.rmtree(c["path"])
            deleted += 1
            freed += c["size_bytes"]
        except Exception as e:
            print(f"  WARN failed to delete {c['path']}: {e}", file=sys.stderr)
    print(f"\nDeleted {deleted} session(s); freed {fmt_size(freed)}.")


if __name__ == "__main__":
    main()
