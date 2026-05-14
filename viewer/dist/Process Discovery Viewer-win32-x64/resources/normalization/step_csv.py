"""Step CSV export. Uses pandas if available; falls back to the csv
stdlib so the export still works without pandas in dev."""

from __future__ import annotations
from pathlib import Path
from typing import Any


def export_step_csv(out_path: str | Path, annotations: dict, sessions: list[dict] | None = None) -> None:
    steps = annotations.get("steps", []) or []
    rows: list[dict[str, Any]] = []
    for s in steps:
        rows.append({
            "step_id": s.get("step_id"),
            "name": s.get("name"),
            "state": s.get("state"),
            "canonical_step_id": s.get("canonical_step_id"),
            "case_id": s.get("case_id"),
            "phase_id": s.get("phase_id"),
            "start": (s.get("time_range") or {}).get("start"),
            "end": (s.get("time_range") or {}).get("end"),
            "interaction_count": len((s.get("evidence") or {}).get("interaction_event_ids") or []),
            "waste": (s.get("flags") or {}).get("waste", False),
            "automation_candidate": (s.get("flags") or {}).get("automation_candidate", False),
        })

    try:
        import pandas as pd  # type: ignore
        pd.DataFrame(rows).to_csv(out_path, index=False)
        return
    except ImportError:
        pass

    import csv
    cols = ["step_id", "name", "state", "canonical_step_id", "case_id", "phase_id",
            "start", "end", "interaction_count", "waste", "automation_candidate"]
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow(r)
