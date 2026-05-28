"""Generate dummy sessions that exercise the normalization pipeline and the
analysis layer in five regimes:

  demo-01-well-formed    - clean 5-case order-provisioning process across
                           4 apps; targeted ~30% waste; analyst BNVA
                           override targets ~14% business-required.
  demo-02-broken         - cases abandoned mid-flow; missing end markers;
                           an orphan activity with no case context.
  demo-03-badly-recorded - corrupt JSONL lines, malformed timestamps,
                           missing event_ids, truncated values, NUL bytes.
  demo-04-variants       - same logical process, three different paths
                           (the "happy path", a "skip Excel" shortcut,
                           and a "rework loop" variant).
  demo-05-stress         - 50 cases x ~40 interactions each across 4
                           apps, to load the pipeline / viewer.

Run from the repo root:
    viewer/python/python.exe scripts/generate-demo-sessions.py

The output lands in sessions/_demo/ and is NOT meant to be committed.
"""

from __future__ import annotations

import json
import os
import random
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "sessions" / "_demo"


# ----------------------------------------------------------------------
# Event helpers

def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


class Stream:
    def __init__(self, session_id: str, started: datetime):
        self.session_id = session_id
        self.started = started
        self.events: list[dict[str, Any]] = []
        self._seq = 0

    def _emit(self, t: datetime, etype: str, data: dict) -> str:
        eid = str(uuid.uuid4())
        self.events.append({
            "event_id": eid,
            "type": etype,
            "timestamp": _iso(t),
            "session_id": self.session_id,
            "data": data,
            "_seq": self._seq,
        })
        self._seq += 1
        return eid

    def activity(self, t, dur_ms, app, title):
        return self._emit(t, "activity", {
            "app": app, "title": title, "pid": 1000, "duration_ms": dur_ms,
            "bounds": {"x": 0, "y": 0, "w": 1920, "h": 1080},
        })

    def interaction(self, t, app, kind, control, name, value="", auto_id=""):
        return self._emit(t, "interaction", {
            "kind": kind, "control_type": control, "name": name,
            "automation_id": auto_id or name.replace(" ", "_").lower(),
            "process_name": app, "window_title": _window_for(app, name),
            "value": value,
            "framework_id": ("Chrome" if "chrome" in app
                             else "XAML" if "outlook" in app
                             else "Win32"),
            "pid": 1000,
        })

    def marker(self, t, kind, label):
        return self._emit(t, "marker", {
            "marker_type": kind, "label": label, "reason": None,
        })

    def idle(self, t, dur_s):
        # An idle_start/idle_end pair sets up "waiting" waste in the
        # window of any step that overlaps.
        self._emit(t, "system", {"kind": "idle_start", "idle_seconds": dur_s})
        return t + timedelta(seconds=dur_s + 0.001)

    def idle_end(self, t):
        return self._emit(t, "system", {"kind": "idle_end", "duration_seconds": 0})


def _window_for(app, name):
    label_map = {
        "chrome.exe": "Salesforce - {n} - Google Chrome",
        "excel.exe":  "Microsoft Excel - Order data.xlsx",
        "sap.exe":    "SAP Easy Access - {n}",
        "outlook.exe": "{n} - Outlook",
    }
    tmpl = label_map.get(app, "{n}")
    return tmpl.replace("{n}", name)


# ----------------------------------------------------------------------
# Process templates

def _order_case(s: Stream, t0: datetime, case_label: str,
                customer: str, *, with_waste: bool = True,
                with_rework: bool = False, with_motion: bool = False,
                variant: str = "happy") -> datetime:
    """Walk one order-provisioning case. Returns the time at end of case.
    Steps inside (each ~5-15s of interactions):
      1. Salesforce: search customer + open record (chrome)
      2. (optional) motion: brief Excel detour INSIDE the SF step
      3. Excel: paste customer fields                 [skip on `skip_excel`]
      4. SAP: create sales order + enter line items
         + (optional) 8 s idle INSIDE the SAP step -> waiting waste
      5. (optional) rework: re-search the customer
      6. Outlook: send confirmation

    For the waste signal to land, the idle / motion has to overlap a
    step's TIME RANGE -- which is bounded by the first and last
    interaction inside that step. So idle goes BETWEEN two
    interactions of the same step (not between steps), and the motion
    activity event also fires inside one step's window.
    """
    t = t0
    s.marker(t, "start", case_label); t += timedelta(seconds=0.1)

    # --- Salesforce search + open ----------------------------------
    s.activity(t, 8000, "chrome.exe", "Search")
    t += timedelta(seconds=0.2)
    s.interaction(t, "chrome.exe", "value_changed", "Edit", "Search",
                  value=customer, auto_id="searchbox"); t += timedelta(seconds=1.5)
    s.interaction(t, "chrome.exe", "invoked", "Button", "Search"); t += timedelta(seconds=3)
    s.activity(t, 7000, "chrome.exe", "Open customer record"); t += timedelta(seconds=0.2)
    s.interaction(t, "chrome.exe", "invoked", "Hyperlink", "Open customer record",
                  auto_id="customer_link"); t += timedelta(seconds=2.5)
    # --- (optional) brief motion to Excel and back, INSIDE the SF step
    if with_motion:
        s.activity(t, 2000, "excel.exe", "Order data.xlsx (checking)"); t += timedelta(seconds=2.5)
        s.activity(t, 1500, "chrome.exe", "Open customer record"); t += timedelta(seconds=2)
    s.interaction(t, "chrome.exe", "value_changed", "Edit", "Quantity",
                  value="10", auto_id="qty"); t += timedelta(seconds=2)
    s.interaction(t, "chrome.exe", "value_changed", "Edit", "Unit price",
                  value="125.00", auto_id="price"); t += timedelta(seconds=2)

    # --- Excel paste customer fields (skipped on the variant) ------
    if variant != "skip_excel":
        s.activity(t, 10000, "excel.exe", "Order data.xlsx"); t += timedelta(seconds=0.5)
        s.interaction(t, "excel.exe", "value_changed", "Edit",
                      "Customer cell", value=customer, auto_id="cust_cell"); t += timedelta(seconds=2)
        s.interaction(t, "excel.exe", "value_changed", "Edit",
                      "Quantity cell", value="10", auto_id="qty_cell"); t += timedelta(seconds=2)
        s.interaction(t, "excel.exe", "value_changed", "Edit",
                      "Price cell", value="125.00", auto_id="price_cell"); t += timedelta(seconds=2)
        s.interaction(t, "excel.exe", "invoked", "Button", "Save workbook",
                      auto_id="save"); t += timedelta(seconds=2)

    # --- SAP: create sales order + fields --------------------------
    s.activity(t, 13000, "sap.exe", "Create sales order"); t += timedelta(seconds=0.5)
    s.interaction(t, "sap.exe", "value_changed", "Edit", "Order type",
                  value="OR", auto_id="ord_type"); t += timedelta(seconds=2)
    s.interaction(t, "sap.exe", "value_changed", "Edit", "Sales organisation",
                  value="1000", auto_id="sales_org")
    # --- (optional) WAITING idle INSIDE one step's window ----------
    # step_suggest's element-boundary rule says two value-changes on
    # the SAME element stay in one step. Emit Sales-org-#2 ~7 s later
    # (under the 10 s split threshold) -- the idle pair sits fully
    # inside that step's [first, last] range, so the waste classifier
    # tags it with `waiting`.
    if with_waste:
        t += timedelta(seconds=0.05)
        t = s.idle(t, 5)            # ~5 s waiting per case -> ~30% across the 5 cases
        s.idle_end(t); t += timedelta(seconds=0.05)
        s.interaction(t, "sap.exe", "value_changed", "Edit",
                      "Sales organisation",
                      value="1000", auto_id="sales_org")
        t += timedelta(seconds=2)
    else:
        t += timedelta(seconds=2)
    s.interaction(t, "sap.exe", "value_changed", "Edit", "Material number",
                  value="MAT-" + customer.split("-")[-1], auto_id="mat"); t += timedelta(seconds=2)
    s.interaction(t, "sap.exe", "value_changed", "Edit", "Customer reference",
                  value=customer, auto_id="cust_ref"); t += timedelta(seconds=2)
    s.interaction(t, "sap.exe", "invoked", "Button", "Save order",
                  auto_id="sap_save"); t += timedelta(seconds=3)

    # --- (optional) rework: re-search the customer in Salesforce ---
    if with_rework:
        s.activity(t, 4000, "chrome.exe", "Search"); t += timedelta(seconds=0.3)
        s.interaction(t, "chrome.exe", "value_changed", "Edit", "Search",
                      value=customer, auto_id="searchbox"); t += timedelta(seconds=2)
        s.interaction(t, "chrome.exe", "invoked", "Button", "Search"); t += timedelta(seconds=2)

    # --- Outlook: confirmation email -------------------------------
    s.activity(t, 7000, "outlook.exe", "Send confirmation"); t += timedelta(seconds=0.3)
    s.interaction(t, "outlook.exe", "value_changed", "Edit", "To",
                  value="customer@example.com", auto_id="to"); t += timedelta(seconds=2)
    s.interaction(t, "outlook.exe", "value_changed", "Edit", "Subject",
                  value="Order confirmation for " + customer,
                  auto_id="subj"); t += timedelta(seconds=2)
    s.interaction(t, "outlook.exe", "invoked", "Button", "Send email",
                  auto_id="send"); t += timedelta(seconds=2)

    s.marker(t, "end", None); t += timedelta(seconds=1)
    return t


# ----------------------------------------------------------------------
# Manifest

def _manifest(sid: str, engagement: str, worker: str, started: datetime,
              ended: datetime, label: str) -> dict:
    return {
        "session_id": sid,
        "engagement_id": engagement,
        "engagement_name": engagement,
        "started_at": _iso(started),
        "ended_at": _iso(ended),
        "status": "closed",
        "label": label,
        "purpose": "process",
        "prep_app": None,
        "config": {"worker": {"id": worker, "display_name": worker}},
        "obs": {"recording_path": None, "recording_start_ts": None, "offset_ms": None},
        "displays": [{"id": 0, "bounds": {"x": 0, "y": 0, "width": 1920, "height": 1080}}],
        "recovered": False,
    }


def _write_session(folder: Path, stream: Stream, manifest: dict,
                   annotations: dict | None = None,
                   raw_event_overrides: list[tuple[int, str]] | None = None):
    """Write events.jsonl + manifest + annotations to `folder`.

    `raw_event_overrides` lets the badly-recorded scenario splice
    corrupted lines into the JSONL after the good ones are formatted.
    Each tuple is (insert_after_index, literal_line) -- the literal
    line is appended verbatim, no JSON encoding.
    """
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "screenshots").mkdir(exist_ok=True)
    lines = [json.dumps(e) for e in stream.events]
    if raw_event_overrides:
        # Insert in REVERSE so the earlier indices don't shift.
        for idx, lit in sorted(raw_event_overrides, key=lambda x: -x[0]):
            lines.insert(idx, lit)
    (folder / "events.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2),
                                          encoding="utf-8")
    if annotations is not None:
        (folder / "annotations.json").write_text(json.dumps(annotations, indent=2),
                                                 encoding="utf-8")


# ----------------------------------------------------------------------
# Scenarios

def gen_well_formed():
    """5 cases of order provisioning. Adds idle waste in each case
    (~12s waiting per case) and one motion-waste case + one rework
    case. Annotations carry a BNVA override on the SAP Save step so
    the demo shows business-required time as well."""
    sid = str(uuid.uuid4())
    t = datetime(2026, 5, 26, 9, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s._emit(t, "system", {"kind": "session_start"})
    t += timedelta(seconds=1)
    customers = ["CUST-1001", "CUST-1002", "CUST-1003", "CUST-1004", "CUST-1005"]
    for i, c in enumerate(customers):
        t = _order_case(
            s, t, "Order ORD-" + str(1000 + i), c,
            with_waste=True,
            with_rework=(i == 2),     # case #3 has rework
            with_motion=(i == 1),     # case #2 has app churn
            variant="happy",
        )
        t += timedelta(seconds=2)
    s._emit(t, "system", {"kind": "session_end"})
    ended = t + timedelta(seconds=1)
    manifest = _manifest(sid, "demo-engagement", "alice", s.started, ended,
                         "Demo: well-formed order provisioning")
    # Analyst override -- reclassify part of the SAP-save active time
    # as business-required (BNVA). The auto-suggested step name is
    # built from window title + control name ("SAP Easy Access:
    # Save order"); we list a few candidates so whichever exact
    # process_label normalize produces, one matches and 2.5 s of
    # active time per instance reclassifies as business-required.
    annotations = {
        "version": 1,
        "session_id": sid,
        "steps": [], "phases": [], "annotations": [], "marker_edits": [],
        "classification_overrides": [],
        "analysis_overrides": [
            {"process_label": "SAP Easy Access: Save order", "bnva_ms": 3000},
            {"process_label": "Save order", "bnva_ms": 3000},
            {"process_label": "SAP: Save order", "bnva_ms": 3000},
        ],
        "excluded_ranges": [], "notes": [], "drift_markers": [],
        "starred_screenshots": [],
    }
    _write_session(OUT / "demo-01-well-formed", s, manifest, annotations)


def gen_broken():
    """A "broken" process: case 1 starts but is abandoned (no end
    marker); case 2 starts and crashes through to session end; an
    orphan activity event lives outside any case."""
    sid = str(uuid.uuid4())
    t = datetime(2026, 5, 26, 10, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s._emit(t, "system", {"kind": "session_start"})
    t += timedelta(seconds=1)

    # Orphan activity BEFORE the first marker -- happens outside any case.
    s.activity(t, 6000, "chrome.exe", "Personal email"); t += timedelta(seconds=8)

    # Case 1: starts, gets through Salesforce, then gives up (no end marker)
    s.marker(t, "start", "Order ORD-2001"); t += timedelta(seconds=0.5)
    s.activity(t, 8000, "chrome.exe", "Search"); t += timedelta(seconds=0.2)
    s.interaction(t, "chrome.exe", "value_changed", "Edit", "Search",
                  value="CUST-2001", auto_id="searchbox"); t += timedelta(seconds=2)
    s.interaction(t, "chrome.exe", "invoked", "Button", "Search"); t += timedelta(seconds=2)
    # Long idle -- the worker gave up
    t = s.idle(t, 240)
    s.idle_end(t); t += timedelta(seconds=2)

    # Case 2: starts, partially fills SAP, then the session just ends
    s.marker(t, "start", "Order ORD-2002"); t += timedelta(seconds=0.5)
    s.activity(t, 8000, "sap.exe", "Create sales order"); t += timedelta(seconds=0.3)
    s.interaction(t, "sap.exe", "value_changed", "Edit", "Order type",
                  value="OR", auto_id="ord_type"); t += timedelta(seconds=2)
    s.interaction(t, "sap.exe", "value_changed", "Edit", "Material number",
                  value="MAT-???", auto_id="mat"); t += timedelta(seconds=2)
    # Note: NO end marker, NO send-email step.
    s._emit(t, "system", {"kind": "session_end"})
    ended = t + timedelta(seconds=1)
    manifest = _manifest(sid, "demo-engagement", "bob", s.started, ended,
                         "Demo: broken / abandoned")
    _write_session(OUT / "demo-02-broken", s, manifest)


def gen_badly_recorded():
    """A corrupt JSONL: hand-edited or write-truncated lines, malformed
    timestamps, missing event_ids. The pipeline must degrade, not
    crash. Built off of the well-formed stream plus 5 corrupt lines."""
    sid = str(uuid.uuid4())
    t = datetime(2026, 5, 26, 11, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s._emit(t, "system", {"kind": "session_start"}); t += timedelta(seconds=1)
    # Two normal cases worth of events
    for i, c in enumerate(["CUST-3001", "CUST-3002"]):
        t = _order_case(s, t, "Order ORD-" + str(3000 + i), c,
                        with_waste=False, with_rework=False, with_motion=False)
        t += timedelta(seconds=2)
    s._emit(t, "system", {"kind": "session_end"})
    ended = t + timedelta(seconds=1)
    manifest = _manifest(sid, "demo-engagement", "carol", s.started, ended,
                         "Demo: corrupt / hand-edited log")
    # Splice in bad lines at varied positions:
    corruptions = [
        (5,  '{"type":"interaction","timestamp":"not-an-iso-string","data":{}}'),
        (10, '{"event_id":"x1","type":"interaction"'),            # truncated mid-line
        (15, '{not really json at all}'),
        (20, ''),                                                  # blank line
        (25, '\x00\x00\x00binary garbage\x00'),                    # NUL bytes
        (30, '{"event_id":"valid","type":"interaction","timestamp":"2026-05-26T11:00:00Z","data":{"process_name":null,"window_title":42,"value":"' + "x" * 600 + '"}}'),  # weird types, oversize value
    ]
    _write_session(OUT / "demo-03-badly-recorded", s, manifest,
                   raw_event_overrides=corruptions)


def gen_variants():
    """Three variant paths through the order-provisioning process so
    the variant table and the segment grouping can distinguish them.
      - happy (cases 1, 2, 3): full path
      - skip_excel (cases 4, 5): SAP directly after CRM, Excel skipped
      - rework (cases 6, 7): re-search Salesforce after SAP
    """
    sid = str(uuid.uuid4())
    t = datetime(2026, 5, 26, 12, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s._emit(t, "system", {"kind": "session_start"}); t += timedelta(seconds=1)
    plan = [
        ("CUST-4001", "happy",      False),
        ("CUST-4002", "happy",      False),
        ("CUST-4003", "happy",      False),
        ("CUST-4004", "skip_excel", False),
        ("CUST-4005", "skip_excel", False),
        ("CUST-4006", "happy",      True),    # rework loop
        ("CUST-4007", "happy",      True),
    ]
    for i, (cust, variant, rework) in enumerate(plan):
        t = _order_case(s, t, "Order ORD-" + str(4000 + i), cust,
                        with_waste=False, with_motion=False,
                        with_rework=rework, variant=variant)
        t += timedelta(seconds=2)
    s._emit(t, "system", {"kind": "session_end"})
    ended = t + timedelta(seconds=1)
    manifest = _manifest(sid, "demo-engagement", "dave", s.started, ended,
                         "Demo: three variants of order provisioning")
    _write_session(OUT / "demo-04-variants", s, manifest)


def gen_stress():
    """A long session: 50 cases with random variants, occasional waste,
    occasional rework. Tests pipeline throughput + viewer load."""
    sid = str(uuid.uuid4())
    t = datetime(2026, 5, 26, 13, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s._emit(t, "system", {"kind": "session_start"}); t += timedelta(seconds=1)
    rng = random.Random(0xC0FFEE)
    for i in range(50):
        cust = "CUST-{:04d}".format(5000 + i)
        variant = rng.choice(["happy", "happy", "happy", "skip_excel"])
        t = _order_case(s, t, "Order ORD-" + str(5000 + i), cust,
                        with_waste=(rng.random() < 0.4),
                        with_motion=(rng.random() < 0.25),
                        with_rework=(rng.random() < 0.15),
                        variant=variant)
        t += timedelta(seconds=rng.uniform(1, 6))
    s._emit(t, "system", {"kind": "session_end"})
    ended = t + timedelta(seconds=1)
    manifest = _manifest(sid, "demo-engagement", "erin", s.started, ended,
                         "Demo: 50-case stress run")
    _write_session(OUT / "demo-05-stress", s, manifest)


# ----------------------------------------------------------------------

def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)
    gen_well_formed()
    gen_broken()
    gen_badly_recorded()
    gen_variants()
    gen_stress()
    print("Wrote demo sessions to", OUT)
    for sub in sorted(OUT.iterdir()):
        events = sub / "events.jsonl"
        if events.exists():
            n = sum(1 for _ in events.open(encoding="utf-8", errors="replace"))
            print(f"  {sub.name}: {n} JSONL lines")


if __name__ == "__main__":
    main()
