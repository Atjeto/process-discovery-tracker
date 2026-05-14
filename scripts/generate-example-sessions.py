#!/usr/bin/env python
"""Generate 5 synthetic sessions for the Aggregate view demo.

Each session lives at sessions/example-aggregate/sess-<date>-<hhmm>/
with manifest.json + events.jsonl. After writing, normalize.py --mine
runs against each so stats.json / dfg.json / process_map.bpmn land
alongside -- exactly what the Aggregate view consumes.

Run:
    viewer/python/python.exe scripts/generate-example-sessions.py

Then in the viewer, Aggregate tab -> "Open sessions..." -> point at
sessions/example-aggregate/.
"""

from __future__ import annotations

import json
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SESSIONS_ROOT = REPO_ROOT / "sessions" / "example-aggregate"
PYTHON_EXE = REPO_ROOT / "viewer" / "python" / "python.exe"
NORMALIZE_PY = REPO_ROOT / "normalization" / "normalize.py"

# Apps -- realistic exe names + pids. Same color routing the viewer
# already maps in renderer.js's APP_COLOR_MAP.
APPS = {
    "chrome":  {"app": "chrome.exe",  "pid": 1234},
    "sap":     {"app": "SAPGUI.exe",  "pid": 5678},
    "excel":   {"app": "EXCEL.EXE",   "pid": 9012},
    "outlook": {"app": "OUTLOOK.EXE", "pid": 3456},
    "notepad": {"app": "notepad.exe", "pid": 7890},
}


class Builder:
    """Accumulates events with a moving virtual clock so each call
    advances time naturally; output matches capture/events.js shape."""

    def __init__(self, session_id: str, start: datetime):
        self.session_id = session_id
        self.t = start
        self.events: list[dict] = []
        self.system("session_start")

    def _ts(self) -> str:
        # capture/events.js emits ISO with `Z` suffix via .toISOString().
        return self.t.replace(microsecond=0).isoformat().replace("+00:00", "Z")

    def _push(self, ev_type: str, data: dict) -> None:
        self.events.append({
            "event_id": uuid.uuid4().hex,
            "type": ev_type,
            "timestamp": self._ts(),
            "session_id": self.session_id,
            "data": data,
        })

    def advance(self, seconds: float) -> None:
        self.t = self.t + timedelta(seconds=seconds)

    def system(self, kind: str, **payload) -> None:
        self._push("system", {"kind": kind, **payload})

    def marker(self, marker_type: str, label: str | None = None) -> None:
        d: dict = {"marker_type": marker_type, "label": label}
        self._push("marker", d)

    def activity(self, app_key: str, title: str, duration_s: float) -> None:
        a = APPS[app_key]
        self._push("activity", {
            "app": a["app"],
            "title": title,
            "pid": a["pid"],
            "duration_ms": int(duration_s * 1000),
        })
        self.advance(duration_s)

    def interaction(self, app_key: str, kind: str, control_type: str,
                    name: str, automation_id: str = "",
                    window_title: str = "") -> None:
        a = APPS[app_key]
        data = {
            "kind": kind,
            "control_type": control_type,
            "name": name,
            "process_name": a["app"],
            "pid": a["pid"],
        }
        if automation_id:
            data["automation_id"] = automation_id
        if window_title:
            data["window_title"] = window_title
        self._push("interaction", data)

    def screenshot(self, path: str) -> None:
        self.system("screenshot", path=path)

    def idle(self, seconds: float) -> None:
        self.system("idle_start")
        self.advance(seconds)
        self.system("idle_end")

    def close(self) -> None:
        self.system("session_end")


# ---- Case templates ---------------------------------------------------


def case_happy_path(b: Builder, order_id: str) -> None:
    b.marker("start", f"Order #{order_id}")
    b.activity("chrome", f"Salesforce - Account: Customer-{order_id}", 35)
    b.interaction("chrome", "invoked", "Button", "Search",
                  automation_id="search-customer",
                  window_title=f"Salesforce - Account: Customer-{order_id}")
    b.screenshot(f"screenshots/{order_id}_01.jpg")
    b.activity("chrome", f"Salesforce - Order #{order_id} Detail", 45)
    b.interaction("chrome", "value_changed", "Edit", "Quantity",
                  automation_id="qty-input",
                  window_title=f"Salesforce - Order #{order_id}")
    b.activity("sap", "SAP Easy Access - [VA01]", 80)
    b.interaction("sap", "invoked", "Button", "Create Order",
                  automation_id="sap-create",
                  window_title="SAP - VA01")
    b.screenshot(f"screenshots/{order_id}_02.jpg")
    b.activity("excel", "Order_Tracking.xlsx - Excel", 50)
    b.interaction("excel", "value_changed", "Edit",
                  f"Cell B{order_id[-2:]}",
                  window_title="Order_Tracking.xlsx")
    b.activity("outlook", "New Message - Outlook", 35)
    b.marker("end")


def case_with_rework(b: Builder, order_id: str) -> None:
    """SF -> SAP -> back to SF (rework) -> SAP again -> Excel -> Outlook"""
    b.marker("start", f"Order #{order_id}")
    b.activity("chrome", f"Salesforce - Account: Customer-{order_id}", 30)
    b.activity("chrome", f"Salesforce - Order #{order_id} Detail", 40)
    b.activity("sap", "SAP Easy Access - [VA01]", 50)
    # Rework: realized a field was missing, went back to SF.
    b.activity("chrome", f"Salesforce - Order #{order_id} Detail", 25)
    b.interaction("chrome", "value_changed", "Edit", "ShipAddress",
                  automation_id="ship-input",
                  window_title=f"Salesforce - Order #{order_id}")
    b.activity("sap", "SAP - Create Sales Order", 60)
    b.activity("excel", "Order_Tracking.xlsx - Excel", 45)
    b.activity("outlook", "New Message - Outlook", 30)
    b.marker("end")


def case_with_exception(b: Builder, order_id: str) -> None:
    """SF -> SAP -> Notepad (lookup) -> SAP -> Excel -> Outlook"""
    b.marker("start", f"Order #{order_id}")
    b.activity("chrome", f"Salesforce - Account: Customer-{order_id}", 28)
    b.activity("chrome", f"Salesforce - Order #{order_id} Detail", 35)
    b.activity("sap", "SAP - Create Sales Order", 30)
    # Exception: needed to look up a mapping in notepad.
    b.activity("notepad", "internal-mappings.txt - Notepad", 25)
    b.activity("sap", "SAP - Create Sales Order", 55)
    b.activity("excel", "Order_Tracking.xlsx - Excel", 40)
    b.activity("outlook", "New Message - Outlook", 30)
    b.marker("end")


def case_idle_heavy(b: Builder, order_id: str) -> None:
    b.marker("start", f"Order #{order_id}")
    b.activity("chrome", f"Salesforce - Account: Customer-{order_id}", 25)
    b.idle(180)  # 3-minute gap, e.g. analyst on call
    b.activity("chrome", f"Salesforce - Order #{order_id} Detail", 40)
    b.activity("sap", "SAP - Create Sales Order", 70)
    b.idle(120)  # 2-minute gap
    b.activity("excel", "Order_Tracking.xlsx - Excel", 45)
    b.activity("outlook", "New Message - Outlook", 30)
    b.marker("end")


def case_skip_outlook(b: Builder, order_id: str) -> None:
    """Fast variant -- skips the confirmation email step."""
    b.marker("start", f"Order #{order_id}")
    b.activity("chrome", f"Salesforce - Account: Customer-{order_id}", 22)
    b.activity("chrome", f"Salesforce - Order #{order_id} Detail", 35)
    b.activity("sap", "SAP - Create Sales Order", 55)
    b.activity("excel", "Order_Tracking.xlsx - Excel", 40)
    b.marker("end")


# ---- Session blueprints ----------------------------------------------

# (session_id, start_iso, [(case_fn, order_id), ...])
SESSIONS = [
    ("sess-2026-0512-0930",
     datetime(2026, 5, 12, 9, 30, tzinfo=timezone.utc),
     [(case_happy_path, "12345"), (case_happy_path, "12346"),
      (case_happy_path, "12347"), (case_happy_path, "12348")]),

    ("sess-2026-0513-0915",
     datetime(2026, 5, 13, 9, 15, tzinfo=timezone.utc),
     [(case_happy_path, "12350"), (case_with_rework, "12351"),
      (case_happy_path, "12352")]),

    ("sess-2026-0513-1402",
     datetime(2026, 5, 13, 14, 2, tzinfo=timezone.utc),
     [(case_happy_path, "12355"), (case_happy_path, "12356"),
      (case_with_exception, "12357"), (case_happy_path, "12358"),
      (case_happy_path, "12359")]),

    ("sess-2026-0514-0858",
     datetime(2026, 5, 14, 8, 58, tzinfo=timezone.utc),
     [(case_idle_heavy, "12360"), (case_idle_heavy, "12361"),
      (case_happy_path, "12362")]),

    ("sess-2026-0514-1130",
     datetime(2026, 5, 14, 11, 30, tzinfo=timezone.utc),
     [(case_skip_outlook, "12365"), (case_happy_path, "12366"),
      (case_skip_outlook, "12367"), (case_happy_path, "12368")]),
]


def build_session(session_id: str, start: datetime,
                  cases: list[tuple]) -> Path:
    b = Builder(session_id, start)
    for case_fn, order_id in cases:
        b.advance(10)  # brief gap before each case
        case_fn(b, order_id)
        b.advance(15)  # wrap-up after case end
    b.close()

    end_ts = b.t.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    start_ts = start.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    manifest = {
        "session_id": session_id,
        "engagement_id": "demo-order-processing",
        "started_at": start_ts,
        "ended_at": end_ts,
        "status": "closed",
        "purpose": "process",
        "config": {"worker": {"id": "demo-worker"}},
    }

    folder = SESSIONS_ROOT / session_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")
    with open(folder / "events.jsonl", "w", encoding="utf-8") as f:
        for ev in b.events:
            f.write(json.dumps(ev) + "\n")
    return folder


def normalize(folder: Path) -> bool:
    cmd = [str(PYTHON_EXE), str(NORMALIZE_PY), str(folder), "--mine"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        tail = (r.stderr or r.stdout or "").splitlines()[-10:]
        print("  [normalize FAILED]:")
        for line in tail:
            print("    " + line)
        return False
    return True


def main() -> int:
    if not PYTHON_EXE.exists():
        print(f"ERROR: embedded Python not found at {PYTHON_EXE}")
        print("Run scripts/build-python-embeddable.ps1 first.")
        return 1
    if not NORMALIZE_PY.exists():
        print(f"ERROR: normalize.py not found at {NORMALIZE_PY}")
        return 1

    SESSIONS_ROOT.mkdir(parents=True, exist_ok=True)
    print(f"Writing demo sessions to: {SESSIONS_ROOT}\n")

    ok_count = 0
    for session_id, start, cases in SESSIONS:
        print(f"[{session_id}] {len(cases)} case(s)")
        folder = build_session(session_id, start, cases)
        if normalize(folder):
            print("  -> normalized (stats.json + dfg.json + process_map.bpmn)")
            ok_count += 1
        else:
            print("  -> normalize failed (session is still loadable as raw)")

    print()
    print(f"Done. {ok_count}/{len(SESSIONS)} sessions normalized at:")
    print(f"  {SESSIONS_ROOT}")
    print()
    print("In the Viewer: Aggregate tab -> 'Open sessions...' ->")
    print("select that folder to load all sessions in one go.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
