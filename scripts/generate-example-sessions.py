#!/usr/bin/env python
"""Generate the bundled example / demo dataset for the viewer.

The dataset models a realistic **order-processing** engagement: a
worker takes sales orders through Salesforce, SAP, Excel, and Outlook.

Why a rewrite (2026-05): the previous generator emitted one interaction
per window. `step_suggest.py` splits a step on every window change, so
every candidate was a single interaction -- below the 2-interaction
floor -- and auto-suggest produced **0 steps**. Nothing to annotate.

This version emits realistic **interaction clusters**: when the worker
is "in" a window they generate a burst of 4-9 interactions all sharing
that window title. Each burst is exactly what `auto_suggest_steps`
groups into one step. A happy-path case therefore yields ~5 named
steps; the aggregate view gets real variants, a branching DFG, rework
loops, and app outliers.

Run (from repo root):
    viewer/python/python.exe scripts/generate-example-sessions.py

Then in the viewer: Compare Sessions tab -> "Open sessions to
compare..." -> point at sessions/example-aggregate/.
"""

from __future__ import annotations

import json
import random
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SESSIONS_ROOT = REPO_ROOT / "sessions" / "example-aggregate"
PYTHON_EXE = REPO_ROOT / "viewer" / "python" / "python.exe"
NORMALIZE_PY = REPO_ROOT / "normalization" / "normalize.py"

# Deterministic RNG -- the dataset must regenerate byte-identically so
# it can live in git without spurious diffs.
RNG = random.Random(20260516)

# Apps -- realistic exe names + pids. Colours route through
# renderer.js's APP_COLOR_MAP.
APPS = {
    "chrome":  {"app": "chrome.exe",  "pid": 4120},
    "sap":     {"app": "SAPGUI.exe",  "pid": 5180},
    "excel":   {"app": "EXCEL.EXE",   "pid": 9220},
    "outlook": {"app": "OUTLOOK.EXE", "pid": 3360},
    "notepad": {"app": "notepad.exe", "pid": 7740},
}

# A 1x1 transparent PNG (the canonical 67-byte file) -- placeholder so
# the screenshot dots are clickable and the gallery / hover-thumbnail
# mechanics work in the demo. Real captures carry real screenshots;
# the demo only needs a valid image file to exist at each path.
_PLACEHOLDER_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c63000100000500010d0a2db4"
    "0000000049454e44ae426082"
)


# ---- Builder ----------------------------------------------------------


class Builder:
    """Accumulates events on a moving virtual clock. Output matches the
    shape capture/events.js writes."""

    def __init__(self, session_id: str, start: datetime, folder: Path):
        self.session_id = session_id
        self.t = start
        self.folder = folder
        self.events: list[dict] = []
        self.shot_n = 0
        self._seq = 0
        self.system("session_start")

    def _ts(self) -> str:
        return self.t.replace(microsecond=0).isoformat().replace("+00:00", "Z")

    def _push(self, ev_type: str, data: dict) -> None:
        # Stamp a monotonic _seq like capture/tracker.js appendEvent does, so the
        # generated stream matches the real one (the viewer and pipeline rely on
        # _seq for stable append-order ties).
        self._seq += 1
        self.events.append({
            "event_id": uuid.uuid4().hex,
            "_seq": self._seq,
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
        self._push("marker", {"marker_type": marker_type, "label": label})

    def idle(self, seconds: float) -> None:
        self.system("idle_start")
        self.advance(seconds)
        self.system("idle_end")

    def screenshot(self) -> None:
        self.shot_n += 1
        rel = f"screenshots/shot_{self.shot_n:02d}.png"
        shots_dir = self.folder / "screenshots"
        shots_dir.mkdir(parents=True, exist_ok=True)
        (self.folder / rel).write_bytes(_PLACEHOLDER_PNG)
        self.system("screenshot", path=rel)

    def step(self, app_key: str, window_title: str, activity_label: str,
             interactions: list[tuple]) -> None:
        """Emit one auto-suggestable step: an activity band plus a burst
        of interactions that all share `window_title`. step_suggest.py
        groups a same-window run into a single step, so this is the
        atomic unit a happy-path case is built from.

        interactions: list of (kind, control_type, name, value) tuples;
        value may be None.
        """
        a = APPS[app_key]
        # Per-interaction gaps must stay UNDER step_suggest.py's 3s
        # idle-split threshold, otherwise a cluster fragments mid-step.
        # Window changes (the next step) are what should split a step.
        gaps = [round(RNG.uniform(0.5, 2.5), 1) for _ in interactions]
        total = sum(gaps)
        # Activity band timestamped at the cluster start, spanning it.
        self._push("activity", {
            "app": a["app"], "title": activity_label, "pid": a["pid"],
            "duration_ms": int(total * 1000),
        })
        for (kind, ctl, name, value), gap in zip(interactions, gaps):
            data = {
                "kind": kind,
                "control_type": ctl,
                "name": name,
                "process_name": a["app"],
                "pid": a["pid"],
                "window_title": window_title,
                "automation_id": name.lower().replace(" ", "-"),
            }
            if value is not None:
                data["value"] = value
            self._push("interaction", data)
            self.advance(gap)

    def close(self) -> None:
        self.system("session_end")


# ---- Step library -----------------------------------------------------
# Each function emits exactly one step (one interaction cluster). The
# last interaction is usually an invoked Button so step_suggest.py's
# namer produces a clean "App: <button>" name.


def s_lookup(b: Builder, oid: str) -> None:
    b.step("chrome", "Salesforce - Account lookup", "Salesforce - Account lookup", [
        ("focus_changed", "Edit", "Customer ID field", None),
        ("text_changed", "Edit", "Customer ID field", f"CUST-{oid}"),
        ("value_changed", "Edit", "Customer ID field", f"CUST-{oid}"),
        ("invoked", "Button", "Search", None),
        ("selection_changed", "DataItem", "Customer result row", None),
        ("invoked", "Button", "Open customer record", None),
    ])


def s_credit_check(b: Builder, oid: str) -> None:
    b.step("chrome", "Salesforce - Credit check", "Salesforce - Credit check", [
        ("invoked", "Button", "Run credit check", None),
        ("selection_changed", "DataItem", "Credit rating", None),
        ("invoked", "Button", "Approve credit", None),
    ])


def s_order_entry(b: Builder, oid: str) -> None:
    b.step("chrome", f"Salesforce - Order #{oid}", f"Salesforce - Order #{oid} entry", [
        ("value_changed", "Edit", "Product code", "SKU-4471"),
        ("value_changed", "Edit", "Quantity", str(RNG.randint(2, 40))),
        ("value_changed", "Edit", "Unit price", "49.99"),
        ("value_changed", "Edit", "Shipping address", "144 Maple Ave"),
        ("value_changed", "ComboBox", "Delivery method", "Express"),
        ("invoked", "Button", "Save order", None),
    ])


def s_fix_address(b: Builder, oid: str) -> None:
    """Rework: the worker returns to the Salesforce order to correct a
    field after SAP rejected it. Same window as s_order_entry, so the
    DFG / variants show a genuine revisit."""
    b.step("chrome", f"Salesforce - Order #{oid}", f"Salesforce - Order #{oid} (fix)", [
        ("value_changed", "Edit", "Shipping address", "144 Maple Avenue, Unit 2"),
        ("value_changed", "ComboBox", "Delivery method", "Standard"),
        ("invoked", "Button", "Save order", None),
    ])


def s_sap_create(b: Builder, oid: str) -> None:
    b.step("sap", "SAP - Create Sales Order (VA01)", "SAP - Create Sales Order", [
        ("focus_changed", "Edit", "Order type", None),
        ("value_changed", "Edit", "Order type", "OR"),
        ("value_changed", "Edit", "Sales organisation", "1000"),
        ("value_changed", "Edit", "Material number", "SKU-4471"),
        ("value_changed", "Edit", "Order quantity", str(RNG.randint(2, 40))),
        ("invoked", "MenuItem", "Check document", None),
        ("invoked", "Button", "Create sales order", None),
    ])


def s_notepad_lookup(b: Builder, oid: str) -> None:
    """Exception: worker breaks out to a text file to look up an
    internal product-code mapping SAP didn't recognise."""
    b.step("notepad", "Notepad - Internal mappings.txt", "Notepad - Internal mappings", [
        ("focus_changed", "Document", "Mappings file", None),
        ("text_changed", "Document", "Mapping search", "SKU-4471"),
        ("text_changed", "Document", "Mapping search", "SKU-4471 MAT-99820"),
    ])


def s_excel_track(b: Builder, oid: str) -> None:
    b.step("excel", "Excel - Order Tracking.xlsx", "Excel - Order Tracking.xlsx", [
        ("value_changed", "Edit", "Order number cell", f"Order #{oid}"),
        ("value_changed", "Edit", "Status cell", "Created"),
        ("value_changed", "Edit", "Date cell", "2026-05-16"),
        ("value_changed", "Edit", "Owner cell", "demo-worker"),
        ("invoked", "Button", "Save workbook", None),
    ])


def s_outlook_send(b: Builder, oid: str) -> None:
    b.step("outlook", f"Outlook - Order #{oid} confirmation", "Outlook - Order confirmation", [
        ("value_changed", "Edit", "To", "customer@example.com"),
        ("value_changed", "Edit", "Subject", f"Order #{oid} confirmed"),
        ("text_changed", "Document", "Message body", "Your order is confirmed."),
        ("invoked", "Button", "Send", None),
    ])


# ---- Case templates ---------------------------------------------------
# A case = a start marker, a sequence of steps, an end marker. Variety
# across templates is what makes the aggregate DFG / variants / rework
# panels interesting.


def case_happy(b: Builder, oid: str) -> None:
    b.marker("start", f"Order #{oid}")
    b.screenshot()
    s_lookup(b, oid)
    s_order_entry(b, oid)
    s_sap_create(b, oid)
    b.screenshot()
    s_excel_track(b, oid)
    s_outlook_send(b, oid)
    b.marker("end")


def case_credit(b: Builder, oid: str) -> None:
    """Adds a credit-check step -- a conditional branch in the DFG."""
    b.marker("start", f"Order #{oid}")
    b.screenshot()
    s_lookup(b, oid)
    s_credit_check(b, oid)
    s_order_entry(b, oid)
    s_sap_create(b, oid)
    s_excel_track(b, oid)
    s_outlook_send(b, oid)
    b.marker("end")


def case_rework(b: Builder, oid: str) -> None:
    """Worker revisits the Salesforce order to fix a field, then
    re-runs SAP. Surfaces in the 'repeated activities' panel."""
    b.marker("start", f"Order #{oid}")
    b.screenshot()
    s_lookup(b, oid)
    s_order_entry(b, oid)
    s_sap_create(b, oid)
    s_fix_address(b, oid)
    s_sap_create(b, oid)
    b.screenshot()
    s_excel_track(b, oid)
    s_outlook_send(b, oid)
    b.marker("end")


def case_exception(b: Builder, oid: str) -> None:
    """Worker breaks out to Notepad mid-SAP -- Notepad shows up as an
    app outlier (rare app)."""
    b.marker("start", f"Order #{oid}")
    b.screenshot()
    s_lookup(b, oid)
    s_order_entry(b, oid)
    s_sap_create(b, oid)
    s_notepad_lookup(b, oid)
    s_sap_create(b, oid)
    s_excel_track(b, oid)
    s_outlook_send(b, oid)
    b.marker("end")


def case_skip_email(b: Builder, oid: str) -> None:
    """Fast variant -- skips the confirmation email."""
    b.marker("start", f"Order #{oid}")
    b.screenshot()
    s_lookup(b, oid)
    s_order_entry(b, oid)
    s_sap_create(b, oid)
    s_excel_track(b, oid)
    b.marker("end")


def case_idle(b: Builder, oid: str) -> None:
    """Happy path with two long idle gaps (worker pulled away)."""
    b.marker("start", f"Order #{oid}")
    b.screenshot()
    s_lookup(b, oid)
    b.idle(210)
    s_order_entry(b, oid)
    s_sap_create(b, oid)
    b.idle(160)
    s_excel_track(b, oid)
    s_outlook_send(b, oid)
    b.marker("end")


# ---- Session blueprints ----------------------------------------------
# Ten sessions across five working days. The happy path dominates
# (~60% of cases) with the variants sprinkled through so the aggregate
# view has a realistic long tail.

SESSIONS = [
    ("sess-2026-0511-0905", datetime(2026, 5, 11, 9, 5, tzinfo=timezone.utc),
     [case_happy, case_happy, case_credit, case_happy]),
    ("sess-2026-0511-1320", datetime(2026, 5, 11, 13, 20, tzinfo=timezone.utc),
     [case_happy, case_rework, case_happy]),
    ("sess-2026-0512-0850", datetime(2026, 5, 12, 8, 50, tzinfo=timezone.utc),
     [case_happy, case_happy, case_exception, case_happy, case_happy]),
    ("sess-2026-0512-1410", datetime(2026, 5, 12, 14, 10, tzinfo=timezone.utc),
     [case_idle, case_happy, case_skip_email]),
    ("sess-2026-0513-0915", datetime(2026, 5, 13, 9, 15, tzinfo=timezone.utc),
     [case_happy, case_credit, case_happy, case_rework]),
    ("sess-2026-0513-1130", datetime(2026, 5, 13, 11, 30, tzinfo=timezone.utc),
     [case_happy, case_happy, case_happy]),
    ("sess-2026-0514-0900", datetime(2026, 5, 14, 9, 0, tzinfo=timezone.utc),
     [case_happy, case_exception, case_skip_email, case_happy]),
    ("sess-2026-0514-1505", datetime(2026, 5, 14, 15, 5, tzinfo=timezone.utc),
     [case_happy, case_credit, case_happy]),
    ("sess-2026-0515-0840", datetime(2026, 5, 15, 8, 40, tzinfo=timezone.utc),
     [case_happy, case_rework, case_happy, case_idle, case_happy]),
    ("sess-2026-0515-1255", datetime(2026, 5, 15, 12, 55, tzinfo=timezone.utc),
     [case_happy, case_happy, case_credit]),
]


def build_session(session_id: str, start: datetime, cases: list) -> Path:
    folder = SESSIONS_ROOT / session_id
    folder.mkdir(parents=True, exist_ok=True)
    b = Builder(session_id, start, folder)
    # Order numbers are session-local but globally unique.
    base = 10000 + int(session_id[-4:]) % 9000
    for i, case_fn in enumerate(cases):
        b.advance(RNG.uniform(8, 20))   # gap before the case
        case_fn(b, str(base + i))
        b.advance(RNG.uniform(12, 30))  # wrap-up after the case
    b.close()

    start_ts = start.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    end_ts = b.t.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    # Match the SCHEMA-documented manifest shape (consent / displays / obs /
    # recovered), with the default not-required/no-OBS values, so re-normalizing
    # demo data exercises the same manifest the real capture app writes.
    manifest = {
        "session_id": session_id,
        "engagement_id": "demo-order-processing",
        "engagement_name": "Demo: order processing",
        "started_at": start_ts,
        "ended_at": end_ts,
        "status": "closed",
        "purpose": "process",
        "config": {"worker": {"id": "demo-worker", "role": "Order processor"}},
        "obs": {"recording_path": None, "recording_start_ts": None, "offset_ms": None},
        "displays": [
            {"id": 0, "bounds": {"x": 0, "y": 0, "width": 1920, "height": 1080}}
        ],
        "consent": {"required": False, "granted": None, "mode": "off"},
        "recovered": False,
    }
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
        tail = (r.stderr or r.stdout or "").splitlines()[-12:]
        print("  [normalize FAILED]")
        for line in tail:
            print("    " + line)
        return False
    # Surface the step count so a regression to "0 steps" is obvious.
    for line in (r.stdout or "").splitlines():
        if "auto-suggested" in line or "canonical match" in line:
            print("  " + line.strip())
    return True


def main() -> int:
    if not PYTHON_EXE.exists():
        print(f"ERROR: embedded Python not found at {PYTHON_EXE}")
        print("Run scripts/build-python-embeddable.ps1 first.")
        return 1
    if not NORMALIZE_PY.exists():
        print(f"ERROR: normalize.py not found at {NORMALIZE_PY}")
        return 1

    # Wipe any prior example sessions so stale folders don't linger.
    if SESSIONS_ROOT.exists():
        shutil.rmtree(SESSIONS_ROOT)
    SESSIONS_ROOT.mkdir(parents=True, exist_ok=True)
    print(f"Writing demo sessions to: {SESSIONS_ROOT}\n")

    ok = 0
    total_cases = 0
    for session_id, start, cases in SESSIONS:
        total_cases += len(cases)
        print(f"[{session_id}] {len(cases)} case(s)")
        folder = build_session(session_id, start, cases)
        if normalize(folder):
            ok += 1

    print()
    print(f"Done. {ok}/{len(SESSIONS)} sessions normalized, "
          f"{total_cases} cases total, at:")
    print(f"  {SESSIONS_ROOT}")
    print()
    print("In the Viewer: Open, Open project... on any one of them")
    print("(each session is a project of its own).")
    return 0 if ok == len(SESSIONS) else 1


if __name__ == "__main__":
    sys.exit(main())
