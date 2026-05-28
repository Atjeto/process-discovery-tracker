"""Generate a broad test suite of demo sessions to stress every analytical
surface of the viewer: steps, phases, canonical-template matching, app-
vocab enrichment, single/multi/mixed/empty/noise aggregation, and stress.

Output: sessions/_testsuite/<scenario>/
Also writes a test-suite YAML (canonical) and YAML (vocab) to:
  scripts/test-suite-assets/onboarding-template.yaml
  scripts/test-suite-assets/test-crm.yaml

Run from the repo root:
    viewer/python/python.exe scripts/generate-test-suite.py
"""

from __future__ import annotations

import json
import shutil
import uuid
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SUITE = ROOT / "sessions" / "_testsuite"
ASSETS = ROOT / "scripts" / "test-suite-assets"


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


# ----------------------------------------------------------------------
# Event stream builder

class Stream:
    def __init__(self, session_id: str, started: datetime):
        self.session_id = session_id
        self.started = started
        self.events: list[dict] = []
        self._seq = 0

    def _emit(self, t, etype, data):
        eid = str(uuid.uuid4())
        self.events.append({
            "event_id": eid, "type": etype, "timestamp": _iso(t),
            "session_id": self.session_id, "data": data, "_seq": self._seq,
        })
        self._seq += 1
        return eid

    def activity(self, t, dur_ms, app, title):
        return self._emit(t, "activity", {
            "app": app, "title": title, "pid": 1000, "duration_ms": dur_ms,
            "bounds": {"x": 0, "y": 0, "w": 1920, "h": 1080},
        })

    def interaction(self, t, app, kind, control, name, value="",
                    auto_id="", window_title=None):
        wt = window_title if window_title is not None else app
        return self._emit(t, "interaction", {
            "kind": kind, "control_type": control, "name": name,
            "automation_id": auto_id or name.replace(" ", "_").lower(),
            "process_name": app, "window_title": wt,
            "value": value,
            "framework_id": "Chrome" if "chrome" in app else "Win32",
            "pid": 1000,
        })

    def marker(self, t, kind, label):
        return self._emit(t, "marker", {
            "marker_type": kind, "label": label, "reason": None,
        })

    def system(self, t, kind, data=None):
        d = dict(data or {}); d["kind"] = kind
        return self._emit(t, "system", d)

    def idle(self, t, dur_s):
        self._emit(t, "system", {"kind": "idle_start", "idle_seconds": dur_s})
        new_t = t + timedelta(seconds=dur_s + 0.001)
        self._emit(new_t, "system", {"kind": "idle_end", "duration_seconds": 0})
        return new_t


def manifest(sid, eng, worker, started, ended, label):
    return {
        "session_id": sid, "engagement_id": eng, "engagement_name": eng,
        "started_at": _iso(started), "ended_at": _iso(ended),
        "status": "closed", "label": label, "purpose": "process",
        "prep_app": None,
        "config": {"worker": {"id": worker, "display_name": worker}},
        "obs": {"recording_path": None, "recording_start_ts": None, "offset_ms": None},
        "displays": [{"id": 0, "bounds": {"x": 0, "y": 0, "width": 1920, "height": 1080}}],
        "recovered": False,
    }


def write_session(folder, stream, m, annotations=None, raw_extra=None):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "screenshots").mkdir(exist_ok=True)
    lines = [json.dumps(e) for e in stream.events]
    if raw_extra:
        for idx, lit in sorted(raw_extra, key=lambda x: -x[0]):
            lines.insert(idx, lit)
    (folder / "events.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (folder / "manifest.json").write_text(json.dumps(m, indent=2), encoding="utf-8")
    if annotations is not None:
        (folder / "annotations.json").write_text(
            json.dumps(annotations, indent=2), encoding="utf-8")


# ----------------------------------------------------------------------
# Reusable case templates

def case_onboarding(s, t0, label, customer, *, with_vocab_targets=False):
    """Customer onboarding: CRM search -> KYC check -> Account create
    -> Welcome email. Uses the automation_id values the canonical
    template and the test app-vocab will match against when
    `with_vocab_targets=True`."""
    t = t0
    s.marker(t, "start", label); t += timedelta(seconds=0.2)
    # 1) CRM search (chrome / Salesforce window)
    s.activity(t, 6000, "chrome.exe", "Salesforce - Search Accounts - Google Chrome")
    t += timedelta(seconds=0.3)
    # ----- test-crm exclusive signature ---------------------------
    # An interaction with an automation_id NO other vocab knows about,
    # so the T03b test can prove the test-crm vocab actually fired
    # (the default sample-salesforce vocab matches everything else
    # and would steal the credit otherwise).
    s.interaction(t, "chrome.exe", "value_changed", "Edit",
                  "Business unit", value="EU-001",
                  auto_id="testCrmExclusiveBusinessUnit",
                  window_title="Salesforce - Search Accounts - Google Chrome")
    t += timedelta(seconds=1.5)
    s.interaction(t, "chrome.exe", "value_changed", "Edit", "Search",
                  value=customer, auto_id="searchInput",
                  window_title="Salesforce - Search Accounts - Google Chrome")
    t += timedelta(seconds=2)
    s.interaction(t, "chrome.exe", "invoked", "Button", "Search",
                  window_title="Salesforce - Search Accounts - Google Chrome")
    t += timedelta(seconds=3)
    # 2) KYC verify (chrome KYC window)
    s.activity(t, 7000, "chrome.exe", "KYC Verification - " + customer)
    t += timedelta(seconds=0.3)
    s.interaction(t, "chrome.exe", "value_changed", "Edit", "ID number",
                  value="ID-" + customer.split("-")[-1], auto_id="kyc_id",
                  window_title="KYC Verification - " + customer)
    t += timedelta(seconds=2)
    s.interaction(t, "chrome.exe", "invoked", "Button", "Verify",
                  window_title="KYC Verification - " + customer)
    t += timedelta(seconds=3)
    # 3) Create account (Salesforce Account New window)
    s.activity(t, 8000, "chrome.exe", "Salesforce - Account New - Google Chrome")
    t += timedelta(seconds=0.3)
    s.interaction(t, "chrome.exe", "value_changed", "Edit", "Account name",
                  value=customer, auto_id="accountName",
                  window_title="Salesforce - Account New - Google Chrome")
    t += timedelta(seconds=2)
    s.interaction(t, "chrome.exe", "value_changed", "Edit", "Phone",
                  value="555-0100", auto_id="accountPhone",
                  window_title="Salesforce - Account New - Google Chrome")
    t += timedelta(seconds=2)
    s.interaction(t, "chrome.exe", "invoked", "Button", "Save",
                  window_title="Salesforce - Account New - Google Chrome")
    t += timedelta(seconds=3)
    # 4) Welcome email (Outlook)
    s.activity(t, 5000, "OUTLOOK.EXE", "Welcome - " + customer)
    t += timedelta(seconds=0.3)
    s.interaction(t, "OUTLOOK.EXE", "value_changed", "Edit", "Subject",
                  value="Welcome " + customer, auto_id="subj",
                  window_title="Welcome - " + customer)
    t += timedelta(seconds=2)
    s.interaction(t, "OUTLOOK.EXE", "invoked", "Button", "Send email",
                  auto_id="send", window_title="Welcome - " + customer)
    t += timedelta(seconds=2)
    s.marker(t, "end", None); t += timedelta(seconds=1)
    return t


def case_atm_ticket(s, t0, ticket, *, with_idle=False):
    """An ATM-ticket case spanning 3 apps: ticket system, ATM admin tool,
    confirmation email. Unrelated to the onboarding process."""
    t = t0
    s.marker(t, "start", "Ticket " + ticket); t += timedelta(seconds=0.2)
    s.activity(t, 6000, "ticket.exe", "TicketSys - " + ticket); t += timedelta(seconds=0.3)
    s.interaction(t, "ticket.exe", "value_changed", "Edit", "Ticket id",
                  value=ticket, auto_id="ticket_id"); t += timedelta(seconds=2)
    s.interaction(t, "ticket.exe", "invoked", "Button", "Open ticket",
                  auto_id="open_ticket"); t += timedelta(seconds=3)
    if with_idle:
        t = s.idle(t, 4)
        t += timedelta(seconds=0.3)
    s.activity(t, 5000, "atmadmin.exe", "ATM Admin - " + ticket); t += timedelta(seconds=0.3)
    s.interaction(t, "atmadmin.exe", "value_changed", "Edit", "Device id",
                  value="ATM-" + ticket, auto_id="device_id"); t += timedelta(seconds=2)
    s.interaction(t, "atmadmin.exe", "invoked", "Button", "Reset device",
                  auto_id="reset"); t += timedelta(seconds=3)
    s.activity(t, 4000, "OUTLOOK.EXE", "Ticket " + ticket + " resolved"); t += timedelta(seconds=0.3)
    s.interaction(t, "OUTLOOK.EXE", "value_changed", "Edit", "Subject",
                  value="Resolved " + ticket, auto_id="subj"); t += timedelta(seconds=2)
    s.interaction(t, "OUTLOOK.EXE", "invoked", "Button", "Send", auto_id="send")
    t += timedelta(seconds=2)
    s.marker(t, "end", None); t += timedelta(seconds=1)
    return t


# ----------------------------------------------------------------------
# Test assets: canonical Process Template + App Vocabulary

def write_canonical_template():
    ASSETS.mkdir(parents=True, exist_ok=True)
    p = ASSETS / "onboarding-template.yaml"
    p.write_text(
        # The match signatures align with the `automation_id` /
        # window_title_regex the case_onboarding() emitter produces, so
        # every interaction in the chain has a canonical home.
        """canonical_process:
  id: "onboarding-test"
  name: "Customer Onboarding (test)"
  version: 1
  owners: ["test-suite@team"]

  phases:
    - phase_id: "validate"
      name: "Validate customer"
      step_ids: ["search-crm", "kyc-verify"]
    - phase_id: "provision"
      name: "Provision account"
      step_ids: ["create-account", "send-welcome"]

  steps:
    - step_id: "search-crm"
      name: "Search CRM"
      match:
        - process_name: "chrome.exe"
          window_title_regex: ".*Salesforce.*Search.*"
          interaction:
            control_type: "Edit"
            automation_id: "searchInput"
          end_when:
            interaction:
              control_type: "Button"
              name: "Search"

    - step_id: "kyc-verify"
      name: "KYC verification"
      match:
        - process_name: "chrome.exe"
          window_title_regex: ".*KYC.*"
          interaction:
            control_type: "Edit"
            automation_id: "kyc_id"
          end_when:
            interaction:
              control_type: "Button"
              name: "Verify"

    - step_id: "create-account"
      name: "Create account"
      match:
        - process_name: "chrome.exe"
          window_title_regex: ".*Salesforce.*Account New.*"
          interaction:
            control_type: "Edit"
            automation_id: "accountName"
          end_when:
            interaction:
              control_type: "Button"
              name: "Save"

    - step_id: "send-welcome"
      name: "Send welcome email"
      match:
        - process_name: "OUTLOOK.EXE"
          window_title_regex: ".*Welcome.*"
""",
        encoding="utf-8")
    return p


def write_app_vocab():
    """A test app-vocab targeting the onboarding events. Placed in a
    dedicated directory so we can opt sessions in via the
    PDT_APP_VOCABULARIES env var without polluting the default
    `normalization/app_vocabularies/`."""
    voc_dir = ASSETS / "vocab"
    voc_dir.mkdir(parents=True, exist_ok=True)
    p = voc_dir / "test-crm.yaml"
    p.write_text(
        """app_vocabulary:
  id: "test-crm"
  name: "Test CRM (onboarding)"
  version: 1
  owner: "test-suite@team"
  scope:
    process_name: "chrome.exe"
    window_title_regex: ".*Salesforce.*"
  screens:
    - id: "account-search"
      name: "Account Search"
      window_title_regex: ".*Search Accounts.*"
    - id: "account-new"
      name: "Account (new)"
      window_title_regex: ".*Account New.*"
  interactions:
    # The unique signature -- only test-crm knows about
    # `testCrmExclusiveBusinessUnit`, so T03b can prove enrichment
    # actually came from THIS vocab (not from the default sample-
    # salesforce vocab, which would otherwise win on shared fields).
    - signature:
        control_type: "Edit"
        automation_id: "testCrmExclusiveBusinessUnit"
      name: "Type business unit"
      screen: "account-search"
      flags:
        automation_candidate: true

    - signature:
        control_type: "Edit"
        automation_id: "searchInput"
      name: "Type into CRM search"
      screen: "account-search"
    - signature:
        control_type: "Button"
        name: "Search"
        window_title_regex: ".*Search Accounts.*"
      name: "Run CRM search"
      screen: "account-search"
      flags:
        automation_candidate: true
    - signature:
        control_type: "Edit"
        automation_id: "accountName"
      name: "Type account name"
      screen: "account-new"
    - signature:
        control_type: "Edit"
        automation_id: "accountPhone"
      name: "Type phone number"
      screen: "account-new"
    - signature:
        control_type: "Button"
        name: "Save"
        window_title_regex: ".*Account New.*"
      name: "Save new account"
      screen: "account-new"
      flags:
        automation_candidate: true
""",
        encoding="utf-8")
    return p.parent


# ----------------------------------------------------------------------
# Scenarios

def gen_steps_phases():
    """Multi-case onboarding session with analyst-authored phases. Tests
    the phases view: each case has a manually-authored 'Validate
    customer' phase and 'Provision account' phase."""
    sid = str(uuid.uuid4())
    t = datetime(2026, 6, 1, 9, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s.system(t, "session_start"); t += timedelta(seconds=1)
    for i in range(4):
        t = case_onboarding(s, t, "Onboard ONB-" + str(2000 + i),
                            "CUST-" + str(2000 + i))
        t += timedelta(seconds=2)
    s.system(t, "session_end")
    m = manifest(sid, "test-onboarding", "alice", s.started,
                 t + timedelta(seconds=1), "Steps + Phases test")
    # We don't author steps here -- we want auto_suggested ones for the
    # Steps view test, and phases will be authored after normalize (see
    # patch_phases_post_normalize() below).
    write_session(SUITE / "01-steps-and-phases", s, m)


def gen_canonical_template_match():
    """3-case onboarding session. After normalize is run with
    --canonical=<onboarding-template>, every case should resolve to the
    template's 4 canonical steps."""
    sid = str(uuid.uuid4())
    t = datetime(2026, 6, 1, 10, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s.system(t, "session_start"); t += timedelta(seconds=1)
    for i in range(3):
        t = case_onboarding(s, t, "Onboard ONB-" + str(2100 + i),
                            "CUST-" + str(2100 + i))
        t += timedelta(seconds=2)
    s.system(t, "session_end")
    m = manifest(sid, "test-onboarding", "bob", s.started,
                 t + timedelta(seconds=1), "Canonical template match test")
    write_session(SUITE / "02-canonical-match", s, m)


def gen_vocab_off_then_on_pair():
    """Two sessions with identical events: one to be normalized WITHOUT
    the test app-vocab loaded, the other WITH. Compares enrichment."""
    for label, folder in [
            ("Vocab off (baseline)", "03a-vocab-off"),
            ("Vocab on (enriched)",  "03b-vocab-on"),
    ]:
        sid = str(uuid.uuid4())
        t = datetime(2026, 6, 1, 11, 0, 0, tzinfo=timezone.utc)
        s = Stream(sid, t)
        s.system(t, "session_start"); t += timedelta(seconds=1)
        for i in range(3):
            t = case_onboarding(s, t, "Onboard ONB-" + str(2200 + i),
                                "CUST-" + str(2200 + i))
            t += timedelta(seconds=2)
        s.system(t, "session_end")
        m = manifest(sid, "test-vocab", "carol", s.started,
                     t + timedelta(seconds=1), label)
        write_session(SUITE / folder, s, m)


def gen_aggregation_1session():
    """A single onboarding session in its own engagement -- the
    aggregation view's degenerate case."""
    sid = str(uuid.uuid4())
    t = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s.system(t, "session_start"); t += timedelta(seconds=1)
    for i in range(3):
        t = case_onboarding(s, t, "Onboard ONB-" + str(2300 + i),
                            "CUST-" + str(2300 + i))
        t += timedelta(seconds=2)
    s.system(t, "session_end")
    m = manifest(sid, "test-agg-1", "dan", s.started,
                 t + timedelta(seconds=1), "Aggregation: 1 session")
    write_session(SUITE / "04-agg-1-session", s, m)


def gen_aggregation_10sessions():
    """Ten onboarding sessions across two workers -- the bread-and-
    butter aggregation case."""
    parent = SUITE / "05-agg-10-sessions"
    rng = random.Random(0xAAA)
    for i in range(10):
        sid = str(uuid.uuid4())
        t = datetime(2026, 6, 2 + (i // 5), 9 + (i % 5),
                     0, 0, tzinfo=timezone.utc)
        s = Stream(sid, t)
        s.system(t, "session_start"); t += timedelta(seconds=1)
        for j in range(rng.randint(2, 4)):
            t = case_onboarding(s, t,
                                "Onboard ONB-" + str(2400 + i * 10 + j),
                                "CUST-" + str(2400 + i * 10 + j))
            t += timedelta(seconds=2)
        s.system(t, "session_end")
        worker = "alice" if i % 2 == 0 else "bob"
        m = manifest(sid, "test-agg-10", worker, s.started,
                     t + timedelta(seconds=1),
                     f"Onboarding session #{i + 1:02d}")
        write_session(parent / f"sess-{i + 1:02d}", s, m)


def gen_aggregation_mixed_unrelated():
    """Three sessions of completely unrelated processes: an onboarding
    session (CRM + Outlook), an ATM-ticket session (ticket + admin
    tool + Outlook), and a notes-only session (Notepad). The
    aggregation view should produce a chaotic merged map with very few
    cross-session overlaps."""
    parent = SUITE / "06-agg-mixed-unrelated"
    # Session A: onboarding
    sid = str(uuid.uuid4())
    t = datetime(2026, 6, 10, 9, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s.system(t, "session_start"); t += timedelta(seconds=1)
    t = case_onboarding(s, t, "Onboard ONB-3001", "CUST-3001")
    t = case_onboarding(s, t, "Onboard ONB-3002", "CUST-3002")
    s.system(t, "session_end")
    write_session(parent / "01-onboarding", s,
                  manifest(sid, "test-mixed", "alice", s.started,
                           t + timedelta(seconds=1), "Onboarding (mixed agg)"))
    # Session B: ATM tickets
    sid = str(uuid.uuid4())
    t = datetime(2026, 6, 10, 11, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s.system(t, "session_start"); t += timedelta(seconds=1)
    t = case_atm_ticket(s, t, "TKT-1001")
    t = case_atm_ticket(s, t, "TKT-1002")
    s.system(t, "session_end")
    write_session(parent / "02-atm-tickets", s,
                  manifest(sid, "test-mixed", "bob", s.started,
                           t + timedelta(seconds=1), "ATM tickets (mixed agg)"))
    # Session C: notepad-only (notes)
    sid = str(uuid.uuid4())
    t = datetime(2026, 6, 10, 14, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s.system(t, "session_start"); t += timedelta(seconds=1)
    s.marker(t, "start", "Doc DRAFT-1"); t += timedelta(seconds=0.3)
    s.activity(t, 8000, "notepad.exe", "Untitled - Notepad"); t += timedelta(seconds=0.3)
    s.interaction(t, "notepad.exe", "value_changed", "Edit", "Body",
                  value="brainstorm notes line 1...", auto_id="body")
    t += timedelta(seconds=3)
    s.interaction(t, "notepad.exe", "value_changed", "Edit", "Body",
                  value="brainstorm notes line 1...line 2...", auto_id="body")
    t += timedelta(seconds=3)
    s.interaction(t, "notepad.exe", "invoked", "Button", "Save",
                  auto_id="save")
    t += timedelta(seconds=2)
    s.marker(t, "end", None); t += timedelta(seconds=1)
    s.system(t, "session_end")
    write_session(parent / "03-notes", s,
                  manifest(sid, "test-mixed", "carol", s.started,
                           t + timedelta(seconds=1), "Notes (mixed agg)"))


def gen_empty_session():
    """A session with NO events except session_start and session_end.
    The pipeline must produce empty-shaped artifacts without crashing."""
    sid = str(uuid.uuid4())
    t = datetime(2026, 6, 11, 9, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s.system(t, "session_start"); t += timedelta(seconds=1)
    # Nothing else.
    s.system(t, "session_end")
    m = manifest(sid, "test-empty", "dan", s.started,
                 t + timedelta(seconds=1), "Empty session")
    write_session(SUITE / "07-empty", s, m)


def gen_noise_only():
    """A realistic noise session: no markers, no interactions at all --
    just activity-event churn across background apps (OBS, Teams,
    Explorer, Spotify) like the recorder would see while the worker
    has the tracker on but isn't actually working. The pipeline must
    produce empty step-shape outputs without crashing."""
    sid = str(uuid.uuid4())
    t = datetime(2026, 6, 11, 10, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s.system(t, "session_start"); t += timedelta(seconds=1)
    noise_apps = ["obs64.exe", "teams.exe", "explorer.exe", "Spotify.exe"]
    rng = random.Random(0xB0BB1E)
    for _ in range(40):
        app = rng.choice(noise_apps)
        s.activity(t, rng.randint(800, 3000), app, app + " - active")
        t += timedelta(seconds=rng.uniform(1, 4))
    s.system(t, "session_end")
    m = manifest(sid, "test-noise", "erin", s.started,
                 t + timedelta(seconds=1), "Noise only (no business events)")
    write_session(SUITE / "08-noise-only", s, m)


def gen_step_analytics():
    """Repeated-step session for the steps view + step_stats: 6 cases
    of onboarding, with the same step type appearing 6x in identical
    form. Tests that step_stats (step-level analogue of activity_stats)
    aggregates instances correctly, and that the step-level process map
    converges."""
    sid = str(uuid.uuid4())
    t = datetime(2026, 6, 12, 9, 0, 0, tzinfo=timezone.utc)
    s = Stream(sid, t)
    s.system(t, "session_start"); t += timedelta(seconds=1)
    for i in range(6):
        t = case_onboarding(s, t, "Onboard ONB-" + str(4000 + i),
                            "CUST-" + str(4000 + i))
        t += timedelta(seconds=2)
    s.system(t, "session_end")
    m = manifest(sid, "test-step-analytics", "fred", s.started,
                 t + timedelta(seconds=1), "Step analytics (6 identical cases)")
    write_session(SUITE / "09-step-analytics", s, m)


# ----------------------------------------------------------------------
# Author phases AFTER normalize (so the auto-suggested steps exist)

def patch_phases_post_normalize(folder: Path):
    """Read annotations.json (which now has auto_suggested steps from
    normalize), then attach phases that group steps by name pattern.
    A phase is a manually-authored bucket of step_ids -- we synthesize
    one for `Validate*` and one for `Provision/Save/Send*`."""
    p = folder / "annotations.json"
    if not p.exists():
        return
    ann = json.loads(p.read_text(encoding="utf-8"))
    steps = ann.get("steps") or []
    if not steps:
        return
    validate_ids = [s["step_id"] for s in steps
                    if "Salesforce" in (s.get("name") or "")
                    and ("Search" in (s.get("name") or "")
                         or "KYC" in (s.get("name") or "")
                         or "ID number" in (s.get("name") or "")
                         or "Verify" in (s.get("name") or ""))]
    provision_ids = [s["step_id"] for s in steps
                     if "Account" in (s.get("name") or "")
                     or "Save" in (s.get("name") or "")
                     or "OUTLOOK" in (s.get("name") or "")
                     or "Welcome" in (s.get("name") or "")
                     or "Send" in (s.get("name") or "")]
    phases = []
    if validate_ids:
        phases.append({
            "phase_id": str(uuid.uuid4()),
            "session_id": ann.get("session_id", ""),
            "case_id": None,
            "name": "Validate customer",
            "description": "Search the CRM, run KYC.",
            "step_ids": validate_ids,
            "state": "manually_authored",
            "canonical_phase_id": None,
        })
    if provision_ids:
        phases.append({
            "phase_id": str(uuid.uuid4()),
            "session_id": ann.get("session_id", ""),
            "case_id": None,
            "name": "Provision account",
            "description": "Create the account, send the welcome email.",
            "step_ids": provision_ids,
            "state": "manually_authored",
            "canonical_phase_id": None,
        })
    ann["phases"] = phases
    p.write_text(json.dumps(ann, indent=2), encoding="utf-8")


# ----------------------------------------------------------------------

def main():
    if SUITE.exists():
        shutil.rmtree(SUITE)
    SUITE.mkdir(parents=True, exist_ok=True)
    write_canonical_template()
    write_app_vocab()

    gen_steps_phases()
    gen_canonical_template_match()
    gen_vocab_off_then_on_pair()
    gen_aggregation_1session()
    gen_aggregation_10sessions()
    gen_aggregation_mixed_unrelated()
    gen_empty_session()
    gen_noise_only()
    gen_step_analytics()

    print("Wrote test sessions to", SUITE)
    for sub in sorted(SUITE.rglob("events.jsonl")):
        n = sum(1 for _ in sub.open(encoding="utf-8", errors="replace"))
        print(f"  {sub.parent.relative_to(SUITE)}: {n} JSONL lines")


if __name__ == "__main__":
    main()
