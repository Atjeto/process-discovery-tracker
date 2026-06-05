"""Build the PDT 1.0 Demo Pack engagement (PDT-1.0-SPEC §6.4, ADR-0033).

Synthesises 4 ServiceNow IT Service sessions (realistic incident-handling
workflows with proper UIA event shapes), runs the full pipeline (Pattern
Layer + bundled Naming Layer) on each, then assembles the engagement
backlog + 2 PDDs + an XLSX + a CSV at sessions/demo-pack/.

Run with the bundled Python so pandas/pm4py + the Naming Layer are
available. Designed to run with the bundled Ollama (PDT_OLLAMA_URL +
PDT_OLLAMA_MODEL set by the launcher) — falls back to NullBackend
gracefully if Ollama is unreachable, so a build server can still produce
the engagement skeleton.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEMO = REPO / "sessions" / "demo-pack"
NORMALIZE = REPO / "normalization" / "normalize.py"
PY = REPO / "viewer" / "python" / "python.exe"
if not PY.exists():
    PY = Path(sys.executable)

# ---- Workflow shapes ----

CASES = [
    {"id": "INC0010842", "summary": "Server down — DB host", "priority": "High",
     "assignee": "Tier 2", "category": "Hardware"},
    {"id": "INC0010843", "summary": "Login failure on portal", "priority": "Medium",
     "assignee": "Tier 1", "category": "Access"},
    {"id": "INC0010844", "summary": "Printer offline floor 3", "priority": "Low",
     "assignee": "Facilities", "category": "Equipment"},
    {"id": "INC0010845", "summary": "VPN dropping during meetings", "priority": "High",
     "assignee": "Tier 2", "category": "Network"},
]

WORKERS = [
    {"name": "alice", "pid_servicenow": 7401, "pid_outlook": 7800, "pid_excel": 7900},
    {"name": "bob", "pid_servicenow": 6201, "pid_outlook": 6800, "pid_excel": 6900},
    {"name": "carol", "pid_servicenow": 5101, "pid_outlook": 5800, "pid_excel": 5900},
    {"name": "dave", "pid_servicenow": 4101, "pid_outlook": 4800, "pid_excel": 4900},
]


def _isoms(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class Clock:
    def __init__(self, start):
        self.now = start

    def advance_ms(self, ms):
        self.now += timedelta(milliseconds=ms)
        return _isoms(self.now)


def _ev(events, session_id, etype, ts, data):
    events.append({
        "event_id": uuid.uuid4().hex,
        "session_id": session_id,
        "type": etype,
        "timestamp": ts,
        "data": data,
        "_seq": len(events),
    })


def _interaction(events, session_id, ts, *, kind, app, title, pid,
                 control_type, name, automation_id="", value=None,
                 framework="chromium", identity_source="automation_id",
                 confidence=0.85):
    data = {
        "kind": kind,
        "control_type": control_type,
        "automation_id": automation_id,
        "name": name,
        "class_name": "",
        "framework_id": "Chrome" if framework == "chromium" else "WinForm",
        "framework": framework,
        "identity_source": identity_source,
        "confidence": confidence,
        "window_title": title,
        "process_name": app,
        "pid": pid,
    }
    if value is not None:
        data["value"] = value
    if kind == "selection_changed" and value is not None:
        data["selected_value"] = value
    _ev(events, session_id, "interaction", ts, data)


def build_session(worker, case_set, start_ts):
    session_id = f"demo-{worker['name']}-{start_ts.strftime('%Y%m%d-%H%M')}"
    events = []
    clock = Clock(start_ts)

    _ev(events, session_id, "system", clock.advance_ms(0), {"kind": "session_start"})

    for case in case_set:
        _ev(events, session_id, "marker", clock.advance_ms(0),
            {"marker_type": "start", "label": case["id"]})

        # --- ServiceNow incident review ---
        title_sn = f"Incident {case['id']} | ServiceNow"
        psn = worker["pid_servicenow"]
        _ev(events, session_id, "activity", clock.advance_ms(50),
            {"app": "chrome.exe", "title": title_sn, "pid": psn,
             "duration_ms": 5500,
             "bounds": {"x": 100, "y": 100, "w": 1400, "h": 900}})
        _interaction(events, session_id, clock.advance_ms(800),
                     kind="focus_changed", app="chrome.exe", title=title_sn,
                     pid=psn, control_type="Edit", name="Number",
                     automation_id="sys_id")
        _interaction(events, session_id, clock.advance_ms(700),
                     kind="invoked", app="chrome.exe", title=title_sn,
                     pid=psn, control_type="Button", name="Open record",
                     automation_id="btn_open")
        _interaction(events, session_id, clock.advance_ms(500),
                     kind="focus_changed", app="chrome.exe", title=title_sn,
                     pid=psn, control_type="Edit", name="Short description",
                     automation_id="short_desc")
        _interaction(events, session_id, clock.advance_ms(2200),
                     kind="value_changed", app="chrome.exe", title=title_sn,
                     pid=psn, control_type="Edit", name="Short description",
                     automation_id="short_desc", value=case["summary"])
        _interaction(events, session_id, clock.advance_ms(400),
                     kind="focus_changed", app="chrome.exe", title=title_sn,
                     pid=psn, control_type="ComboBox", name="Priority",
                     automation_id="priority_select")
        _interaction(events, session_id, clock.advance_ms(400),
                     kind="selection_changed", app="chrome.exe", title=title_sn,
                     pid=psn, control_type="ComboBox", name="Priority",
                     automation_id="priority_select", value=case["priority"])
        _interaction(events, session_id, clock.advance_ms(500),
                     kind="focus_changed", app="chrome.exe", title=title_sn,
                     pid=psn, control_type="ComboBox", name="Category",
                     automation_id="category_select")
        _interaction(events, session_id, clock.advance_ms(300),
                     kind="selection_changed", app="chrome.exe", title=title_sn,
                     pid=psn, control_type="ComboBox", name="Category",
                     automation_id="category_select", value=case["category"])
        _interaction(events, session_id, clock.advance_ms(500),
                     kind="focus_changed", app="chrome.exe", title=title_sn,
                     pid=psn, control_type="ComboBox", name="Assignment group",
                     automation_id="assignment_group")
        _interaction(events, session_id, clock.advance_ms(400),
                     kind="selection_changed", app="chrome.exe", title=title_sn,
                     pid=psn, control_type="ComboBox", name="Assignment group",
                     automation_id="assignment_group", value=case["assignee"])
        _interaction(events, session_id, clock.advance_ms(700),
                     kind="invoked", app="chrome.exe", title=title_sn,
                     pid=psn, control_type="Button", name="Save record",
                     automation_id="btn_save")

        # --- Excel tracker update ---
        title_xl = "Incident Tracker.xlsx - Excel"
        pxl = worker["pid_excel"]
        _ev(events, session_id, "activity", clock.advance_ms(1200),
            {"app": "EXCEL.EXE", "title": title_xl, "pid": pxl,
             "duration_ms": 3500,
             "bounds": {"x": 200, "y": 150, "w": 1200, "h": 800}})
        _interaction(events, session_id, clock.advance_ms(600),
                     kind="focus_changed", app="EXCEL.EXE", title=title_xl,
                     pid=pxl, control_type="Edit", name="Cell B2",
                     automation_id="cell_b2",
                     framework="winforms", identity_source="automation_id",
                     confidence=0.7)
        _interaction(events, session_id, clock.advance_ms(900),
                     kind="value_changed", app="EXCEL.EXE", title=title_xl,
                     pid=pxl, control_type="Edit", name="Cell B2",
                     automation_id="cell_b2",
                     framework="winforms", value=case["id"], confidence=0.7)
        _interaction(events, session_id, clock.advance_ms(400),
                     kind="focus_changed", app="EXCEL.EXE", title=title_xl,
                     pid=pxl, control_type="Edit", name="Cell C2",
                     automation_id="cell_c2",
                     framework="winforms", confidence=0.7)
        _interaction(events, session_id, clock.advance_ms(1500),
                     kind="value_changed", app="EXCEL.EXE", title=title_xl,
                     pid=pxl, control_type="Edit", name="Cell C2",
                     automation_id="cell_c2",
                     framework="winforms", value=case["summary"], confidence=0.7)
        _interaction(events, session_id, clock.advance_ms(500),
                     kind="invoked", app="EXCEL.EXE", title=title_xl,
                     pid=pxl, control_type="Button", name="Save workbook",
                     automation_id="btn_save_wb",
                     framework="winforms", confidence=0.7)

        # --- Outlook notification ---
        title_out = f"RE: {case['id']} - {case['summary']} - Outlook"
        pout = worker["pid_outlook"]
        _ev(events, session_id, "activity", clock.advance_ms(1100),
            {"app": "OUTLOOK.EXE", "title": title_out, "pid": pout,
             "duration_ms": 3200,
             "bounds": {"x": 300, "y": 200, "w": 1000, "h": 700}})
        _interaction(events, session_id, clock.advance_ms(500),
                     kind="focus_changed", app="OUTLOOK.EXE", title=title_out,
                     pid=pout, control_type="Edit", name="To",
                     automation_id="to_field",
                     framework="winforms", confidence=0.7)
        to_email = case["assignee"].replace(" ", "").lower() + "@example.com"
        _interaction(events, session_id, clock.advance_ms(1100),
                     kind="value_changed", app="OUTLOOK.EXE", title=title_out,
                     pid=pout, control_type="Edit", name="To",
                     automation_id="to_field",
                     framework="winforms", value=to_email, confidence=0.7)
        _interaction(events, session_id, clock.advance_ms(400),
                     kind="focus_changed", app="OUTLOOK.EXE", title=title_out,
                     pid=pout, control_type="Edit", name="Subject",
                     automation_id="subject_field",
                     framework="winforms", confidence=0.7)
        _interaction(events, session_id, clock.advance_ms(1500),
                     kind="value_changed", app="OUTLOOK.EXE", title=title_out,
                     pid=pout, control_type="Edit", name="Subject",
                     automation_id="subject_field",
                     framework="winforms",
                     value=f"{case['id']} {case['summary']}", confidence=0.7)
        _interaction(events, session_id, clock.advance_ms(600),
                     kind="invoked", app="OUTLOOK.EXE", title=title_out,
                     pid=pout, control_type="Button", name="Send",
                     automation_id="btn_send",
                     framework="winforms", confidence=0.7)

        _ev(events, session_id, "marker", clock.advance_ms(800),
            {"marker_type": "end", "label": None})
        clock.advance_ms(3000)  # idle between cases

    _ev(events, session_id, "system", clock.advance_ms(0), {"kind": "session_end"})
    return session_id, events, clock.now


def write_session(session_id, events, started, ended, out_root):
    sess_dir = out_root / session_id
    sess_dir.mkdir(parents=True, exist_ok=True)
    (sess_dir / "screenshots").mkdir(exist_ok=True)
    manifest = {
        "session_id": session_id,
        "engagement_id": "demo-pack-servicenow-it-service",
        "started_at": _isoms(started),
        "ended_at": _isoms(ended),
        "status": "closed",
        "purpose": "process",
        "config": {"debounce_ms": 250},
        "consent": {"required": False, "granted": None, "mode": "off"},
        "displays": [{"id": 0, "bounds": {"x": 0, "y": 0, "width": 1920, "height": 1080}}],
    }
    with open(sess_dir / "manifest.json", "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    with open(sess_dir / "events.jsonl", "w", encoding="utf-8") as fh:
        for ev in events:
            fh.write(json.dumps(ev, ensure_ascii=False) + "\n")
    return sess_dir


def main():
    DEMO.mkdir(parents=True, exist_ok=True)
    # Clean previous demo content (keep engagement.json + README.md).
    keep = {DEMO / "engagement.json", DEMO / "README.md"}
    for entry in DEMO.iterdir():
        if entry in keep:
            continue
        if entry.is_dir():
            shutil.rmtree(entry, ignore_errors=True)
        else:
            entry.unlink(missing_ok=True)
    sessions_dir = DEMO / "sessions"
    sessions_dir.mkdir(exist_ok=True)

    base = datetime(2026, 6, 1, 9, 0, 0, tzinfo=timezone.utc)
    session_paths = []
    for i, worker in enumerate(WORKERS):
        # Each worker handles 3 of the 4 cases, in different orders, so the
        # backlog aggregation hits cross-session linkage.
        rotated = CASES[i % len(CASES):] + CASES[:i % len(CASES)]
        case_set = rotated[:3]
        worker_start = base + timedelta(days=i, hours=i)
        session_id, events, ended = build_session(worker, case_set, worker_start)
        path = write_session(session_id, events, worker_start, ended, sessions_dir)
        session_paths.append(str(path))
        print(f"  built session: {session_id} ({len(events)} events)")

    print(f"Total sessions: {len(session_paths)}")

    # Run normalize on each session.
    env = dict(os.environ)
    env.setdefault("PYTHONUTF8", "1")
    for sp in session_paths:
        print(f"  normalizing {Path(sp).name} ...")
        r = subprocess.run([str(PY), str(NORMALIZE), sp, "--mine"],
                           capture_output=True, text=True, env=env)
        if r.returncode != 0:
            print("    FAIL:", r.stderr[-500:])
        else:
            for line in r.stdout.splitlines():
                if "naming:" in line or "patterns.json" in line:
                    print("   ", line)

    # Build deliverables.
    sys.path.insert(0, str(REPO / "normalization"))
    from engagement import build_backlog, export_backlog_csv, export_backlog_xlsx
    from engagement import export_pdd_bundle, load_engagement
    backlog = build_backlog(session_paths)
    deliv = DEMO / "deliverables"
    deliv.mkdir(exist_ok=True)
    export_backlog_csv(backlog, deliv / "backlog.csv")
    export_backlog_xlsx(backlog, deliv / "backlog.xlsx")
    eng = load_engagement(DEMO)
    files = export_pdd_bundle(backlog, eng, deliv / "pdds")

    # Promote top 2 process candidates (per spec §6.4: "5-row backlog, two
    # finished PDDs"). Cap the public backlog at 5.
    backlog["rows"] = backlog["rows"][:5]
    backlog["process_count"] = len(backlog["rows"])
    with open(DEMO / "backlog.json", "w", encoding="utf-8") as fh:
        json.dump(backlog, fh, indent=2)

    print()
    print(f"Demo Pack ready: {DEMO}")
    print(f"  sessions:     {len(session_paths)}")
    print(f"  backlog rows: {backlog['process_count']}")
    print(f"  PDDs:         {len(files['markdown'])} markdown + {len(files['pdf'])} PDF")


if __name__ == "__main__":
    main()
