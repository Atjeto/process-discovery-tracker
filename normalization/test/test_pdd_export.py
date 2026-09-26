"""Tests for pdd_export: the process manager's hand-over document, in the
reader's order (lane LUX-P): document control, purpose and scope (the
analyst's fields, C6), the As-Is map and the reference run's steps (C3), the
variations and rules, the data, applications and time, the improvement
scope and the notes.

The fixture is a synthetic two-run session: run 1 is the reference run
(Find, Save, Send, plus one hidden step); run 2 does Find, an extra Log step
and Save, and skips Send. Run 1 types its order number again as the mail's
subject (re-keyed data).

Deps-gated: write_pdd needs python-docx, which the full-deps gate (bundled
python plus the system pytest) has; without it these tests no-op.

Run with pytest:
    pytest normalization/test/test_pdd_export.py
"""

from __future__ import annotations
import json
import re
import struct
import sys
import tempfile
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pdd_export

_HAVE_DOCX = pdd_export.Document is not None

T0 = datetime(2026, 5, 14, 9, 0, 0, tzinfo=timezone.utc)
R1, R2 = "run-1", "run-2"
FIND = "crm|CRM - Orders|Button:find"
SAVE = "crm|CRM - Orders|Button:save"
SEND = "outlook|Mail - Compose|Button:send"
LOG = "excel|Sheet - Log|Button:save"
CRM_TITLE = "Contoso CRM - Orders"
MAIL_TITLE = "Order confirmation - Outlook"
LOG_TITLE = "Order log.xlsx - Excel"


def _ts(sec):
    return (T0 + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _step(sid, case_id, name, key, sec, eids, state="auto_suggested", **extra):
    step = {"step_id": sid, "case_id": case_id, "name": name, "draft_key": key,
            "state": state, "description": "", "flags": {"waste": False},
            "time_range": {"start": _ts(sec), "end": _ts(sec + 2)},
            "evidence": {"interaction_event_ids": eids, "screenshot_refs": []}}
    step.update(extra)
    return step


def _inter(eid, sec, proc, title, kind, name, control_type="Edit", **data):
    return {"event_id": eid, "type": "interaction", "timestamp": _ts(sec),
            "data": {"kind": kind, "process_name": proc, "window_title": title,
                     "name": name, "control_type": control_type, **data}}


def _session():
    """(manifest, annotations, stats, analysis, events) of the fixture."""
    manifest = {"session_id": "sess-pdd", "engagement_id": "ENG-1",
                "started_at": _ts(0),
                "config": {"worker": {"id": "w1", "name": "Ana Silva"}}}
    annotations = {"steps": [
        _step("a1", R1, "Look up the order", FIND, 1, ["e1", "e2"],
              state="confirmed", description="Search the order by its number."),
        _step("a2", R1, "CRM - Orders: Save", SAVE, 5, ["e3"], state="confirmed"),
        _step("hid", R1, "Hidden noise step", "crm|CRM - Orders|Button:noise", 7,
              ["e9"], state="hidden"),
        _step("a3", R1, "Mail - Compose: Send", SEND, 10, ["e4", "e7", "e5", "e6"],
              state="confirmed", flags={"waste": True}),
        _step("b1", R2, "Look up the order", FIND, 61, ["f1", "f2"]),
        _step("b2", R2, "Sheet - Log: Save", LOG, 65, ["f3", "f4"]),
        _step("b3", R2, "CRM - Orders: Save", SAVE, 70, ["f5"]),
    ], "pattern_run": {"case_id": R1, "confirmed_at": _ts(200)}}
    events = [
        _inter("e1", 1, "crm.exe", CRM_TITLE, "value_changed", "Order number", value="ORD-1"),
        _inter("e2", 2, "crm.exe", CRM_TITLE, "invoked", "Find", "Button"),
        _inter("e3", 5, "crm.exe", CRM_TITLE, "invoked", "Save", "Button"),
        _inter("e9", 7, "crm.exe", CRM_TITLE, "value_changed", "Noise field", value="NOISE-VALUE"),
        _inter("e4", 10, "OUTLOOK.EXE", MAIL_TITLE, "value_changed", "To",
               value="customer@example.com"),
        _inter("e7", 10.5, "OUTLOOK.EXE", MAIL_TITLE, "value_changed", "Subject", value="ORD-1"),
        _inter("e5", 11, "OUTLOOK.EXE", MAIL_TITLE, "value_changed", "Password",
               value_redacted=True),
        _inter("e6", 12, "OUTLOOK.EXE", MAIL_TITLE, "invoked", "Send", "Button"),
        _inter("f1", 61, "crm.exe", CRM_TITLE, "value_changed", "Order number", value="ORD-2"),
        _inter("f2", 62, "crm.exe", CRM_TITLE, "invoked", "Find", "Button"),
        _inter("f3", 65, "EXCEL.EXE", LOG_TITLE, "value_changed", "Status", value="Logged"),
        _inter("f4", 66, "EXCEL.EXE", LOG_TITLE, "invoked", "Save", "Button"),
        _inter("f5", 70, "crm.exe", CRM_TITLE, "invoked", "Save", "Button"),
    ]
    stats = {
        "case_stats": [
            {"case_id": R1, "label": "Order 1", "parent_case_id": None,
             "start_ts": _ts(0), "end_ts": _ts(50), "wall_clock_ms": 50000,
             "active_ms": 44000},
            {"case_id": R2, "label": "Order 2", "parent_case_id": None,
             "start_ts": _ts(60), "end_ts": _ts(120), "wall_clock_ms": 60000,
             "active_ms": 58000},
        ],
        "meta": {
            "raw_event_count": 40, "interaction_count": 12, "step_count": 7,
            "app_names": {"crm.exe": "Contoso CRM", "OUTLOOK.EXE": "Outlook",
                          "EXCEL.EXE": "Excel"},
        },
    }
    analysis = {
        "case_quality": {"mode": "markers", "case_count": 2, "coverage": 1.0,
                         "tier2_unlocked": True},
        "facts": {"active_ms": 102000, "idle_ms": 0, "session_span_ms": 120000,
                  "top_apps": [{"app": "crm.exe", "ms": 60000, "share": 0.59}],
                  "app_switches": 4, "rekey_count": 1, "app_time_source": "activity"},
        "findings": [
            {"id": "screen_time_sink-x", "detector": "screen_time_sink", "tier": 1,
             "claim": "Contoso CRM accounts for 59% of measured foreground time.",
             "evidence": {"app": "crm.exe", "share": 0.59, "screenshot_refs": []},
             "confidence_note": "Foreground-window time."},
        ],
        "automation_candidates": [
            {"segment_signature": "sigA", "app": "crm.exe",
             "step_labels": ["Look up the order", "CRM - Orders: Save"],
             "instance_count": 2, "total_elapsed_ms": 12000,
             "mean_elapsed_ms": 6000, "data_sufficiency": "multi_instance"},
        ],
        "efficiency": {"process_efficiency_ratio": 0.6},
        "pdd_findings": {"eligible": ["screen_time_sink-x"], "default": ["screen_time_sink-x"]},
        "stage_errors": [],
    }
    return manifest, annotations, stats, analysis, events


def _render(tmp, manifest, annotations, stats, analysis, events=None, **images):
    out = Path(tmp) / "pdd.docx"
    pdd_export.write_pdd(out, session_folder=Path(tmp), annotations=annotations,
                         stats=stats, manifest=manifest, analysis=analysis,
                         events=events, **images)
    from docx import Document
    return Document(str(out))


def _blocks(doc):
    """(kind, text) in body order: kind is the heading style name for a
    heading, "p" for a paragraph, "t" for a table row (cells joined " | ")."""
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    out = []
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            p = Paragraph(child, doc)
            if p.text.strip():
                style = p.style.name if p.style is not None else ""
                heading = style.startswith("Heading") or style == "Title"
                out.append((style if heading else "p", p.text))
        elif tag == "tbl":
            for row in Table(child, doc).rows:
                out.append(("t", " | ".join(c.text for c in row.cells)))
    return out


def _numbered(blocks):
    return [t for k, t in blocks if k in ("Heading 1", "Heading 2") and t[:1].isdigit()]


def _section(blocks, heading):
    """The texts after `heading` up to the next numbered section heading."""
    start = next(i for i, (k, t) in enumerate(blocks) if t == heading and k != "p")
    out = []
    for k, t in blocks[start + 1:]:
        if k in ("Heading 1", "Heading 2") and t[:1].isdigit():
            break
        out.append(t)
    return out


def _all_text(blocks):
    return "\n".join(t for _k, t in blocks)


def _blocks_of(manifest, annotations, stats, analysis, events, **images):
    with tempfile.TemporaryDirectory() as tmp:
        return _blocks(_render(tmp, manifest, annotations, stats, analysis, events, **images))


def _rendered():
    return _blocks_of(*_session())


OUTLINE = [
    "1. Document control",
    "2. Purpose and scope", "2.1 Purpose", "2.2 Scope", "2.3 Trigger", "2.4 Result",
    "2.5 Key contacts",
    "3. As-Is process", "3.1 As-Is process map", "3.2 Process steps",
    "4. Variations, rules and exceptions", "4.1 Differences between transactions",
    "4.2 Business rules", "4.3 Exceptions",
    "5. Systems and information used",
    "6. Volume and effort",
    "7. Improvement and automation scope",
]

FIELDS = {"title": "Order intake", "purpose": "Book every customer order.",
          "scope": "Standard orders; returns are out of scope.",
          "trigger": "An order email arrives.\nIt names the customer.",
          "result": "The customer has a confirmation mail.",
          "contacts": "Ana (process owner)\nBo (analyst)",
          "business_rules": "Orders over 10,000 need a second approval.",
          "exceptions": "A blocked customer goes to credit control.\n"
                        "The CRM times out: save again.",
          "improvement": "Automate the order entry; the credit check stays manual.",
          "effort": "About 40 orders a day, 3 minutes each.",
          "notes": ""}


# ---- the outline, the title, document control, the fields (C6) -------------------

def test_the_outline_is_in_the_readers_order():
    if not _HAVE_DOCX:
        return
    blocks = _rendered()
    assert _numbered(blocks) == OUTLINE
    assert blocks[0] == ("Title", "Process Definition Document")


def test_document_control_names_the_folder_the_sme_the_video_and_the_request():
    """AD-30: the capture's engagement prints as the Request, only when set;
    "project" names only the folder the analyst opens."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    with tempfile.TemporaryDirectory() as tmp:
        blocks = _blocks(_render(tmp, manifest, annotations, stats, analysis, events))
        folder = Path(tmp).resolve().name
    rows = _section(blocks, "1. Document control")
    assert rows[:7] == ["Process | Not named yet", f"Project folder | {folder}",
                        "Recorded | 2026-05-14", "Recorded by | Ana Silva",
                        "Transactions recorded | 2", "Video | None", "Request | ENG-1"]
    # C20: a PDD not made for a hand-off says it is a working copy.
    assert rows[7].startswith("Document generated | ")
    assert rows[8] == "Version | Working copy, not handed off yet"
    assert [r for r in rows if r.startswith("Project")] == [f"Project folder | {folder}"]

    # The login when the profile has no name; an attached video; the capture's
    # default request prints no row.
    manifest["config"]["worker"] = {"id": "w1"}
    manifest["engagement_id"] = "default"
    annotations["external_video"] = {"path": "D:/call.mp4", "offset_ms": 0}
    rows = _section(_blocks_of(manifest, annotations, stats, analysis, events),
                    "1. Document control")
    assert "Recorded by | w1" in rows and "Video | Attached" in rows
    assert not any(r.startswith("Request | ") or r.startswith("Project | ") for r in rows)
    manifest["engagement_name"] = "Order desk review"
    rows = _section(_blocks_of(manifest, annotations, stats, analysis, events),
                    "1. Document control")
    assert "Request | Order desk review" in rows
    assert not any(r.startswith("Project | ") for r in rows)
    # Lane FX1 (report 3, F23): the request's name and its code, as the
    # viewer's project line names it (session-summary.js requestOf).
    manifest["engagement_id"] = "REQ-2026-042"
    rows = _section(_blocks_of(manifest, annotations, stats, analysis, events),
                    "1. Document control")
    assert "Request | Order desk review (REQ-2026-042)" in rows
    # The capture app's default name is never printed (report 1, item 6).
    manifest["engagement_name"] = "Default engagement"
    rows = _section(_blocks_of(manifest, annotations, stats, analysis, events),
                    "1. Document control")
    assert "Request | REQ-2026-042" in rows
    assert not any("Default engagement" in r for r in rows)


def test_document_fields_replace_their_gaps():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    annotations["document"] = dict(FIELDS)
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    assert blocks[0] == ("Title", "Order intake")
    assert blocks[1] == ("p", "Process Definition Document")
    assert _section(blocks, "2.1 Purpose") == ["Book every customer order."]
    assert _section(blocks, "2.2 Scope") == ["Standard orders; returns are out of scope."]
    assert _section(blocks, "2.3 Trigger") == ["An order email arrives.", "It names the customer."]
    assert _section(blocks, "2.4 Result") == ["The customer has a confirmation mail."]
    assert _section(blocks, "2.5 Key contacts") == ["Ana (process owner)", "Bo (analyst)"]
    assert _section(blocks, "4.2 Business rules") == ["Orders over 10,000 need a second approval."]
    assert _section(blocks, "4.3 Exceptions") == [
        "A blocked customer goes to credit control.", "The CRM times out: save again."]
    assert _section(blocks, "6. Volume and effort") == ["About 40 orders a day, 3 minutes each."]
    # The re-keyed data is a finding of the improvement scope, after its field.
    assert _section(blocks, "7. Improvement and automation scope") == [
        "Automate the order entry; the credit check stays manual.",
        "Re-keyed data",
        "Order number (Contoso CRM) is typed again as Subject (Outlook) in 1 of 2 transactions."]
    assert "Process | Order intake" in _section(blocks, "1. Document control")
    assert "[To be completed" not in _all_text(blocks)


def test_a_gap_stands_only_for_a_field_the_analyst_fills():
    """With no document field written, the only gaps are the nine fields the
    app lets the analyst fill (C6); nothing else in the document is left
    open."""
    if not _HAVE_DOCX:
        return
    blocks = _rendered()
    gaps = [t for _k, t in blocks if "[To be completed" in t]
    assert len(gaps) == 9
    for heading in ("2.1 Purpose", "2.2 Scope", "2.3 Trigger", "2.4 Result",
                    "2.5 Key contacts", "4.2 Business rules", "4.3 Exceptions",
                    "6. Volume and effort", "7. Improvement and automation scope"):
        texts = _section(blocks, heading)
        assert texts[0].startswith("[To be completed:"), heading
        # 7 goes on with the re-keyed data the recording found.
        assert len(texts) == 1 or heading.startswith("7."), heading
    assert _section(blocks, "6. Volume and effort") == [
        "[To be completed: how often the process is done, and how long one takes]"]
    assert "application errors" in _section(blocks, "4.3 Exceptions")[0]


# ---- what the document no longer says ---------------------------------------------

CUT = ("Findings", "What the recording measured", "Evidence", "Run-by-run", "To say more",
       "pattern run", "interaction", "Interactions", "foreground", "wall clock", "memo",
       "templated", "mined", "as exported from the viewer", "Generated by",
       "Process operator", "Engagement", "worker", "candidate", "Automation assessment",
       "Application errors", "confirmed by the analyst", "chose it", "Value-add",
       "Measured timings", "Rework", "Overview", "In scope", "Out of scope",
       "Role in process", "starred", "events", "polling", "JSONL", "operator")


def test_no_findings_method_notes_or_machine_units_are_printed():
    """Section 1 of the earlier document (the analysis findings) is cut: the
    document prints no finding, whatever the analyst selected, and none of
    the method sentences or machine words the review listed."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    annotations["memo_selection"] = ["screen_time_sink-x"]
    annotations["analysis_overrides"] = [{"process_label": "Look up the order",
                                          "bnva_ms": 5000}]
    text = _all_text(_blocks_of(manifest, annotations, stats, analysis, events))
    assert "accounts for 59%" not in text
    for phrase in CUT:
        assert phrase not in text, phrase


# ---- the words (AD-29) ------------------------------------------------------------------

# One pass through the process is a transaction and what the analyst opens is
# a project: the document never says run or session for them. "runs through"
# is the verb ("The process runs through Outlook and Excel.").
_OLD_WORDS = re.compile(r"\bruns?\b|\bsessions?\b", re.IGNORECASE)


def _word_states():
    """(state, text) of the fixture in every state that prints a sentence
    about the transactions or the project folder."""
    out = []

    def render(name, change=None, bpmn=False):
        manifest, annotations, stats, analysis, events = _session()
        if change:
            change(manifest, annotations, stats)
        with tempfile.TemporaryDirectory() as tmp:
            if bpmn:
                (Path(tmp) / "process_map_step.bpmn").write_text("<x/>", encoding="utf-8")
            doc = _render(tmp, manifest, annotations, stats, analysis, events)
            out.append((name, _all_text(_blocks(doc))))

    def full(m, a, s):
        a["document"] = dict(FIELDS, notes="Ask Ana.")
        a["external_video"] = {"path": "D:/call.mp4", "offset_ms": 0}
        a["attachments"] = [{"id": "x1", "file": "sop.pdf", "label": "SOP", "step_id": "a1"}]

    def open_reference_2(m, a, s):
        a["pattern_run"] = {"case_id": R2}
        a["steps"].append(_step("b5", R2, "Look up the order", FIND, 90, []))   # a repeat
        # A stretch of the reference transaction left out: its block says so.
        a["excluded_ranges"] = [{"start": _ts(95), "end": _ts(99), "reason": "manual"}]
        s["case_stats"][1]["wall_clock_ms"] = None

    def no_runs(m, a, s):
        s["case_stats"] = []
        for st in a["steps"]:
            st["case_id"] = None

    def one_run(m, a, s):
        s["case_stats"] = s["case_stats"][:1]

    def all_hidden(m, a, s):
        del a["pattern_run"]
        for st in a["steps"]:
            st["state"] = "hidden"

    def reference_without_steps(m, a, s):
        a["pattern_run"] = {"case_id": R2}
        for st in a["steps"]:
            if st["case_id"] == R2:
                st["state"] = "hidden"

    def blank(m, a, s, steps=True):
        m["source"] = "blank"
        s["case_stats"] = [{"case_id": "implicit-run", "implicit": True, "label": None,
                            "parent_case_id": None, "start_ts": None, "end_ts": None,
                            "wall_clock_ms": None, "active_ms": None}]
        a.pop("pattern_run", None)
        a["steps"] = [{"step_id": f"h{i}", "case_id": "implicit-run", "name": name,
                       "state": "manually_authored", "time_range": None, "order": i,
                       "system": "SAP"}
                      for i, name in enumerate(["Open the order", "Book it"], start=1)] if steps else []

    render("full", full, bpmn=True)
    render("open reference 2", open_reference_2)
    render("no runs", no_runs)
    render("one run", one_run)
    render("all hidden", all_hidden)
    render("reference without steps", reference_without_steps)
    render("blank", blank, bpmn=True)
    render("blank without steps", lambda m, a, s: blank(m, a, s, steps=False))
    return out


def test_the_document_says_transaction_and_project_never_run_or_session():
    if not _HAVE_DOCX:
        return
    states = _word_states()
    said = "\n".join(text for _name, text in states)
    # Positive control: the states print every sentence about the
    # transactions and the project folder, in the new words.
    for sentence in (
            "Transactions recorded | 2", "Project folder | ",
            "The steps as done in Transaction 1: Order 1, the reference transaction.",
            "in 2 of 2 transactions", "Transaction 1 at 0:01 (video 0:01)",
            "Each step and the steps that followed it in the transactions:",
            "The map file is process_map_step.bpmn in the project folder.",
            "Transaction 2: Order 2 (the reference transaction)",
            "Transactions were not marked in this recording, so every step is listed in time order.",
            "Only one transaction was recorded.",
            "None of the recorded transactions has steps, so the transactions cannot be compared.",
            "No steps have been recorded for this project yet.",
            "No steps have been recorded for this transaction yet.",
            "One transaction (not marked), so every step is listed in order.",
            "Transactions recorded | One transaction (not marked)",
            "No steps have been added to this project yet.",
            "Transactions were not marked in this recording, so there is no map.",
            "None of the transactions has steps, so there is no map.",
            "No steps have been added to this project yet, so there is no map.",
            "The files are in the project folder's attachments folder."):
        assert sentence in said, sentence
    for name, text in states:
        left = _OLD_WORDS.findall(text.replace("runs through", ""))
        assert not left, (name, left)


# ---- the reference run (C3) and its steps -------------------------------------------

def _steps_section(annotations_change=None, stats_change=None):
    manifest, annotations, stats, analysis, events = _session()
    if annotations_change:
        annotations_change(annotations)
    if stats_change:
        stats_change(stats)
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    return blocks, _section(blocks, "3.2 Process steps")


def test_the_reference_run_is_the_detailed_process():
    if not _HAVE_DOCX:
        return
    blocks, steps = _steps_section()
    assert steps[:2] == ["The process runs through Contoso CRM, Outlook and Excel.",
                         "The steps as done in Transaction 1: Order 1, the reference transaction."]
    assert [t for k, t in blocks if k == "Heading 3"] == [
        "Step 1: Look up the order", "Step 2: CRM - Orders: Save", "Step 3: Mail - Compose: Send"]
    assert not any("not confirmed yet" in t for t in steps)


def test_a_chosen_reference_run_and_its_draft_status_line():
    if not _HAVE_DOCX:
        return
    def choose_run_2(a):
        a["pattern_run"] = {"case_id": R2}
    blocks, steps = _steps_section(choose_run_2)
    assert steps[1] == "The steps as done in Transaction 2: Order 2, the reference transaction."
    assert steps[2] == "3 of these 3 steps are drafts not confirmed yet."
    assert [t for k, t in blocks if k == "Heading 3"] == [
        "Step 1: Look up the order", "Step 2: Sheet - Log: Save", "Step 3: CRM - Orders: Save"]
    # The time is counted from the start of the recording, not of the run:
    # run 2's first step is 1:01 in, not 0:01.
    assert steps[steps.index("Step 1: Look up the order") + 1].endswith("Transaction 2 at 1:01")


def test_without_a_valid_choice_the_first_run_with_steps_is_the_reference():
    if not _HAVE_DOCX:
        return
    def unknown_run(a):
        a["pattern_run"] = {"case_id": "no-such-run"}
    blocks, steps = _steps_section(unknown_run)
    assert steps[1] == "The steps as done in Transaction 1: Order 1, the reference transaction."

    def run_1_all_hidden(a):
        del a["pattern_run"]
        for st in a["steps"]:
            if st["case_id"] == R1:
                st["state"] = "hidden"
    blocks, steps = _steps_section(run_1_all_hidden)
    assert steps[1] == "The steps as done in Transaction 2: Order 2, the reference transaction."


def test_without_runs_every_visible_step_is_listed_in_time_order():
    if not _HAVE_DOCX:
        return
    def no_runs(a):
        del a["pattern_run"]
        for st in a["steps"]:
            st["case_id"] = None
        a["steps"].reverse()                     # time order, not list order

    def no_case_stats(s):
        s["case_stats"] = []
    blocks, steps = _steps_section(no_runs, no_case_stats)
    assert steps[1] == ("Transactions were not marked in this recording, so every "
                        "step is listed in time order.")
    assert [t for k, t in blocks if k == "Heading 3"] == [
        "Step 1: Look up the order", "Step 2: CRM - Orders: Save", "Step 3: Mail - Compose: Send",
        "Step 4: Look up the order", "Step 5: Sheet - Log: Save", "Step 6: CRM - Orders: Save"]
    # A step outside every run is placed by its time in the recording.
    assert steps[steps.index("Step 1: Look up the order") + 1] == (
        "Contoso CRM, Orders \u00b7 0:01 into the recording")
    assert _section(blocks, "4.1 Differences between transactions") == [
        "Transactions were not marked in this recording, so there are no transactions "
        "to compare."]
    # Without transactions, every step's system and information count.
    assert _section(blocks, "5. Systems and information used")[1:] == [
        "Contoso CRM | Order number", "Outlook | To, Subject, Password", "Excel | Status"]


def test_each_step_carries_its_system_runs_and_place_in_the_recording_never_a_time():
    """The recording's times are a walkthrough with explanations: a step
    says in how many transactions it happened and where it is, never how
    long it took (section 6 states the effort as the analyst writes it)."""
    if not _HAVE_DOCX:
        return
    steps = _section(_rendered(), "3.2 Process steps")
    line = lambda heading: steps[steps.index(heading) + 1]  # noqa: E731
    assert line("Step 1: Look up the order") == (
        "Contoso CRM, Orders \u00b7 in 2 of 2 transactions \u00b7 Transaction 1 at 0:01")
    assert line("Step 3: Mail - Compose: Send") == (
        "Outlook, Order confirmation \u00b7 in 1 of 2 transactions \u00b7 Transaction 1 at 0:10")
    assert not any("on average" in t for t in steps)


def test_the_video_time_joins_the_place_when_the_video_is_synced():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    annotations["external_video"] = {"path": "D:/call.mp4", "offset_ms": -90000}
    steps = _section(_blocks_of(manifest, annotations, stats, analysis, events),
                     "3.2 Process steps")
    assert steps[steps.index("Step 1: Look up the order") + 1].endswith(
        "Transaction 1 at 0:01 (video 1:31)")


def test_a_step_shows_its_description_field_names_and_waste_flag():
    if not _HAVE_DOCX:
        return
    steps = _section(_rendered(), "3.2 Process steps")
    i = steps.index("Step 1: Look up the order")
    assert steps[i + 2:i + 4] == ["Search the order by its number.", "Fields: Order number."]
    j = steps.index("Step 3: Mail - Compose: Send")
    assert steps[j + 2:j + 4] == ["Fields: To, Subject, Password.", "Flagged as waste."]
    # The values live in the data table, not under the steps.
    assert not any("customer@example.com" in t for t in steps)


def test_a_step_description_shows_only_when_the_analyst_wrote_it():
    """A draft's description is the narration the drafting generates from its
    interactions ("Clicked Save."), which the step's field list repeats. It
    is left out when it equals that narration, recomputed with the same
    function; a description the analyst wrote, or edited, is shown. Without
    the events the narration cannot be recomputed, so it is shown."""
    if not _HAVE_DOCX:
        return
    from step_suggest import _default_step_description
    manifest, annotations, stats, analysis, events = _session()
    by_id = {e["event_id"]: e for e in events}
    steps = {st["step_id"]: st for st in annotations["steps"]}

    def narration(sid):
        return _default_step_description(
            [by_id[eid] for eid in steps[sid]["evidence"]["interaction_event_ids"]])
    assert narration("a2") == "Clicked Save."
    assert narration("a3").startswith('Entered "customer@example.com" into To.')
    steps["a2"]["description"] = narration("a2")                   # generated
    steps["a3"]["description"] = narration("a3") + " Ana: then I send it."  # edited
    body = _section(_blocks_of(manifest, annotations, stats, analysis, events),
                    "3.2 Process steps")
    assert body[body.index("Step 2: CRM - Orders: Save") + 2] == "Step 3: Mail - Compose: Send"
    assert "Clicked Save." not in body
    assert body[body.index("Step 3: Mail - Compose: Send") + 2] == (
        narration("a3") + " Ana: then I send it.")
    no_events = _section(_blocks_of(manifest, annotations, stats, analysis, None),
                         "3.2 Process steps")
    assert no_events[no_events.index("Step 2: CRM - Orders: Save") + 2] == "Clicked Save."


def test_hidden_steps_never_appear():
    if not _HAVE_DOCX:
        return
    text = _all_text(_rendered())
    assert "Hidden noise step" not in text
    assert "Noise field" not in text and "NOISE-VALUE" not in text
    # Positive control: the visible steps of the same run do render.
    assert "Mail - Compose: Send" in text


def _with_flow(a):
    """The flow set on the reference run's steps (contract C17): step 1 skips
    to step 3; step 2 happens only when the order is new and goes on to step
    3 or back to step 1; step 3 goes back to step 1 or ends the process, and
    its links to a hidden step, to no step and to itself print nothing. One
    link names run 2's copy of step 1, which the document numbers as step 1."""
    steps = {s["step_id"]: s for s in a["steps"]}
    steps["a1"]["links"] = [{"to": "a3", "when": "the order is a repeat"}]
    steps["a2"]["only_when"] = "the order is new."
    steps["a2"]["links"] = [{"to": "a3", "when": "the mail is ready"}, {"to": "a1"}]
    steps["a3"]["links"] = [{"to": "b1", "when": "the customer changes the order"},
                            {"to": "end", "when": "the customer cancels"},
                            {"to": "hid", "when": "never printed"},
                            {"to": "gone", "when": "never printed"},
                            {"to": "a3", "when": "never printed"},
                            {"to": "end"}]


def test_a_step_prints_the_flow_set_on_it():
    """Under a step: "Only when" its condition, right under its context line;
    after the step's content, one line per link, the target numbered as
    the document numbers the steps."""
    if not _HAVE_DOCX:
        return
    _blocks_, steps = _steps_section(_with_flow)
    one, two, three = (steps.index(h) for h in (
        "Step 1: Look up the order", "Step 2: CRM - Orders: Save", "Step 3: Mail - Compose: Send"))
    assert steps[one + 2:two] == [
        "Search the order by its number.", "Fields: Order number.",
        "Then skips to step 3, Mail - Compose: Send, when the order is a repeat."]
    assert steps[two + 2:three] == [
        "Only when the order is new.",
        "Then goes on to step 3, Mail - Compose: Send, when the mail is ready.",
        "Then goes back to step 1, Look up the order."]
    assert steps[three + 2:] == [
        "Fields: To, Subject, Password.", "Flagged as waste.",
        "Then goes back to step 1, Look up the order, when the customer changes the order.",
        "The process ends here when the customer cancels.",
        "The process ends here."]
    assert not any("never printed" in t for t in steps)


def test_a_step_without_flow_prints_no_flow_line():
    if not _HAVE_DOCX:
        return
    _blocks_, steps = _steps_section()
    assert not any(t.startswith(("Only when", "Then ", "The process ends")) for t in steps)


# ---- 4. Variations -------------------------------------------------------------------

def test_the_differences_carry_the_system_the_runs_and_what_was_done():
    if not _HAVE_DOCX:
        return
    diffs = _section(_rendered(), "4.1 Differences between transactions")
    # Plain sentences for the SME (the owner, 2026-09-26), under the
    # transaction's name: "here" is that transaction.
    assert diffs == [
        "Transaction 2: Order 2",
        "Sheet - Log: Save (Excel) is done after Look up the order, in 1 of 2 "
        "transactions. Fields: Status.",
        "Mail - Compose: Send is not done here (it is done in 1 of 2 transactions).",
    ]


def test_an_extra_step_prints_the_analysts_description():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    for st in annotations["steps"]:
        if st["step_id"] == "b2":
            st["name"] = "Log the order"
            st["description"] = "Only for orders from new customers."
            st["state"] = "edited"
    diffs = _section(_blocks_of(manifest, annotations, stats, analysis, events),
                     "4.1 Differences between transactions")
    assert diffs[1] == ("Log the order (Excel) is done after Look up the order, "
                        "in 1 of 2 transactions. Only for orders from new customers.")


def test_an_order_change_a_repeat_and_a_run_without_differences():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    r3 = "run-3"
    stats["case_stats"].append({"case_id": r3, "label": "Order 3", "start_ts": _ts(130),
                                "end_ts": _ts(170), "wall_clock_ms": 40000,
                                "active_ms": 39000})
    annotations["steps"] += [
        _step("c1", r3, "Look up the order", FIND, 131, []),
        _step("c2", r3, "CRM - Orders: Save", SAVE, 135, []),
        _step("c3", r3, "Mail - Compose: Send", SEND, 140, []),
        _step("b4", R2, "CRM - Orders: Save", SAVE, 80, []),
    ]
    # Run 2 now saves before it looks the order up, and saves twice.
    for st in annotations["steps"]:
        if st["step_id"] == "b3":
            st["time_range"] = {"start": _ts(60), "end": _ts(60)}
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    assert _section(blocks, "4.1 Differences between transactions") == [
        "Transaction 2: Order 2",
        "Here Look up the order is done after CRM - Orders: Save.",
        "Sheet - Log: Save (Excel) is done after Look up the order, in 1 of 3 "
        "transactions. Fields: Status.",
        "Mail - Compose: Send is not done here (it is done in 2 of 3 transactions).",
        "CRM - Orders: Save is done 2 times here.",
        "No differences from the reference transaction: Transaction 3: Order 3.",
    ]


def test_a_repeat_counts_against_the_reference_transaction():
    """Lane FX1, one rule with the Steps level (shared/run-differences-golden.json):
    a step done again is a difference when a transaction does it more often
    than the reference transaction. The reference transaction is compared
    with nothing, so its own repeat is not listed in 4.1 (3.2 prints its
    steps, the repeat among them)."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    annotations["steps"].append(_step("a4", R1, "Look up the order", FIND, 20, []))
    diffs = _section(_blocks_of(manifest, annotations, stats, analysis, events),
                     "4.1 Differences between transactions")
    assert diffs[0] == "Transaction 2: Order 2"
    assert not any(line.endswith("times here.") for line in diffs), diffs
    # Transaction 2 looks the order up three times: more often than the reference.
    annotations["steps"] += [_step("b6", R2, "Look up the order", FIND, 100, []),
                             _step("b7", R2, "Look up the order", FIND, 105, [])]
    diffs = _section(_blocks_of(manifest, annotations, stats, analysis, events),
                     "4.1 Differences between transactions")
    assert diffs[-1] == "Look up the order is done 3 times here."


def test_a_conditional_step_a_transaction_did_not_do_reads_not_done():
    """Lane FX1 (report 2, item 13): the reference transaction's Send happens
    only when the customer asks for it; transaction 2 did not send it, which
    the flow already explains, so the line gives the condition in place of
    how many transactions did it."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    for st in annotations["steps"]:
        if st["step_id"] == "a3":
            st["only_when"] = "the customer asks for a confirmation."
    diffs = _section(_blocks_of(manifest, annotations, stats, analysis, events),
                     "4.1 Differences between transactions")
    assert ("Mail - Compose: Send is not done here: it is done only when the customer "
            "asks for a confirmation.") in diffs
    assert not any("is not done here (it is done in" in line for line in diffs), diffs


def test_a_merged_reference_step_matches_the_same_drafts_in_another_run():
    """Item 1 (BA helper L12b): the analyst merged the reference run's Find
    and Save drafts into one step (draft_keys). Run 2 still has them as two
    consecutive drafts: they read as the merged step (no Extra, no Skipped
    for them), and the step after them is placed after the merged step."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    steps = [st for st in annotations["steps"] if st["step_id"] not in ("a1", "a2")]
    merged = _step("m1", R1, "Look up and save the order", None, 1, ["e1", "e2", "e3"],
                   state="edited", draft_keys=[FIND, SAVE])
    del merged["draft_key"]
    steps.append(merged)
    for st in steps:
        if st["step_id"] == "b2":   # run 2 logs after it saves: Find, Save, Log
            st["time_range"] = {"start": _ts(75), "end": _ts(77)}
    annotations["steps"] = steps
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    assert _section(blocks, "4.1 Differences between transactions") == [
        "Transaction 2: Order 2",
        "Sheet - Log: Save (Excel) is done after Look up and save the order, "
        "in 1 of 2 transactions. Fields: Status.",
        "Mail - Compose: Send is not done here (it is done in 1 of 2 transactions).",
    ]
    steps_text = _section(blocks, "3.2 Process steps")
    # The merged step happened in both runs: run 2's two drafts count as one
    # occurrence.
    assert steps_text[steps_text.index("Step 1: Look up and save the order") + 1].startswith(
        "Contoso CRM, Orders \u00b7 in 2 of 2 transactions")


def test_one_run_has_nothing_to_compare():
    if not _HAVE_DOCX:
        return
    def one_run(s):
        s["case_stats"] = s["case_stats"][:1]
    blocks, _steps = _steps_section(stats_change=one_run)
    assert _section(blocks, "4.1 Differences between transactions") == [
        "Only one transaction was recorded."]


# ---- 5. Systems and information used, 6. Volume and effort, 7's re-keyed data -------------

def test_section_5_names_each_system_and_the_information_entered_in_it():
    """The owner, 2026-09-26: the PDD is for the SME and whoever asks about
    the process being automated, so section 5 names the systems and the
    information the process takes, never a value (the Technical details and
    the viewer hold those). The reference transaction's entries first;
    Excel, which only transaction 2 used, lists what it entered there."""
    if not _HAVE_DOCX:
        return
    blocks = _rendered()
    assert _section(blocks, "5. Systems and information used") == [
        "System | Information entered",
        "Contoso CRM | Order number",
        "Outlook | To, Subject, Password",
        "Excel | Status",
    ]
    assert "customer@example.com" not in _all_text(blocks)


def test_a_workbooks_cells_are_one_entry_for_the_reader():
    """A spreadsheet cell's field name is its address: the document names a
    workbook's cells as one entry, in section 5 and in a step's fields."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    cells = [("c1", 20.1, "B3", "Contoso"), ("c2", 20.2, "A2", "ORD-1"), ("c3", 20.3, "F5", "99,8")]
    for eid, sec, cell, value in cells:
        events.append(_inter(eid, sec, "EXCEL.EXE", LOG_TITLE, "value_changed", cell, "DataItem",
                             value=value))
    annotations["steps"].append(_step("a5", R1, "Log the order", LOG, 20, [c[0] for c in cells],
                                      state="confirmed"))
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    assert "Excel | cells A2 to F5 of Order log.xlsx" in _section(blocks, "5. Systems and information used")
    assert "Fields: cells A2 to F5 of Order log.xlsx." in _section(blocks, "3.2 Process steps")


def test_section_6_is_the_analysts_volume_and_effort_never_the_recorded_times():
    """The recorded times are a walkthrough with explanations: the document
    prints the volume and effort the analyst states (C6 `document.effort`),
    else its gap; the viewer shows the recorded times."""
    if not _HAVE_DOCX:
        return
    blocks = _rendered()
    assert _section(blocks, "6. Volume and effort") == [
        "[To be completed: how often the process is done, and how long one takes]"]
    text = _all_text(blocks)
    for measured in ("Active time", "Elapsed time", "Time per transaction", "walkthrough"):
        assert measured not in text, measured


def test_a_value_re_keyed_in_every_run_says_so_in_the_improvement_scope():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    events.append(_inter("f6", 66.5, "EXCEL.EXE", LOG_TITLE, "value_changed", "Order",
                         value="ORD-2"))
    events.append(_inter("e8", 12.5, "EXCEL.EXE", LOG_TITLE, "value_changed", "Order",
                         value="ORD-1"))
    for st in annotations["steps"]:
        if st["step_id"] == "b2":
            st["evidence"]["interaction_event_ids"].append("f6")
        if st["step_id"] == "a3":
            st["evidence"]["interaction_event_ids"].append("e8")
    scope = _section(_blocks_of(manifest, annotations, stats, analysis, events),
                     "7. Improvement and automation scope")
    assert ("Order number (Contoso CRM) is typed again as Order (Excel) in every "
            "transaction.") in scope
    # A secret, a noise literal or a short value is never counted.
    assert not any("Password" in t and "typed again" in t for t in scope)


def test_a_label_that_only_repeats_the_transactions_name_is_not_printed():
    """The capture app labels an unnamed run "Transaction N" ("Run N" before
    the AD-29 words): beside "Transaction N" such a label says nothing more,
    so it is left out, as in the viewer's list of runs. Any other label is
    printed, an old default of another number too."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    stats["case_stats"][0]["label"] = " Run 1 "
    stats["case_stats"][1]["label"] = "transaction 2"
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    assert _section(blocks, "3.2 Process steps")[1] == (
        "The steps as done in Transaction 1, the reference transaction.")
    assert _section(blocks, "4.1 Differences between transactions")[0] == "Transaction 2"
    stats["case_stats"][0]["label"] = "Transaction 2"
    stats["case_stats"][1]["label"] = "Run 1"
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    assert _section(blocks, "3.2 Process steps")[1] == (
        "The steps as done in Transaction 1: Transaction 2, the reference transaction.")
    assert _section(blocks, "4.1 Differences between transactions")[0] == "Transaction 2: Run 1"


def test_systems_carry_business_names_never_process_tokens():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    stats["meta"]["app_names"] = {}              # the shared system list still names them
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    systems = [row.split(" | ")[0] for row in _section(blocks, "5. Systems and information used")[1:]]
    assert "Outlook" in systems and "Excel" in systems
    text = _all_text(blocks)
    assert not re.search(r"\.exe\b", text, re.IGNORECASE)
    assert "(browser)" not in text


# ---- tables, maps, files ------------------------------------------------------------------

def test_every_table_has_a_grid_and_a_repeating_header():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    with tempfile.TemporaryDirectory() as tmp:
        doc = _render(tmp, manifest, annotations, stats, analysis, events)
        tables = list(doc.tables)
        assert len(tables) == 3          # control, map from the runs, systems and information
        for t in tables:
            assert t.style is not None and t.style.name == "Table Grid"
        for t in tables[1:]:
            assert t.rows[0]._tr.xpath("./w:trPr/w:tblHeader")


def _make_png(width=2, height=2):
    """A small but fully valid PNG (correct CRCs) to stand in for a rendered
    map or a screenshot."""
    def chunk(typ, data):
        body = typ + data
        return (struct.pack(">I", len(data)) + body
                + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)   # 8-bit RGB
    raw = b"".join(b"\x00" + b"\xff\xff\xff" * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def _descr(doc):
    return [s._inline.docPr.get("descr") for s in doc.inline_shapes]


def test_a_wide_as_is_map_gets_a_landscape_page_of_its_own():
    if not _HAVE_DOCX:
        return
    from docx.enum.section import WD_ORIENT
    manifest, annotations, stats, analysis, events = _session()
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "map.png"
        png.write_bytes(_make_png(40, 20))
        doc = _render(tmp, manifest, annotations, stats, analysis, events,
                      process_map_image=str(png))
        blocks = _blocks(doc)
        orientations = [s.orientation for s in doc.sections]
        width_in = doc.inline_shapes[0].width.inches
        alt = _descr(doc)
    assert orientations == [WD_ORIENT.PORTRAIT, WD_ORIENT.LANDSCAPE, WD_ORIENT.PORTRAIT]
    assert alt == ["As-Is process map"]
    assert 9.0 <= width_in <= 9.5
    # The section's heading opens the map's page; the picture has no caption.
    assert _section(blocks, "3. As-Is process") == []
    assert _section(blocks, "3.1 As-Is process map") == []
    assert "Each step and the steps that followed it" not in _all_text(blocks)


def test_the_map_pictures_carry_their_alternative_text():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "map.png"
        png.write_bytes(_make_png(20, 40))           # a tall map stays portrait
        doc = _render(tmp, manifest, annotations, stats, analysis, events,
                      process_map_image=str(png), tobe_map_image=str(png))
        assert _descr(doc) == ["As-Is process map", "To-Be process map"]
        texts = [p.text for p in doc.paragraphs]
        assert "7.1 To-Be process map" in texts
        assert "Proposed To-Be process, drawn by the analyst." in texts


def test_a_steps_screenshots_carry_its_number_and_name_as_their_alternative_text():
    """Lane FX3: a screenshot printed under a step says which step it shows
    (a screen reader, or a picture copied out of the document), as the map
    pictures name their map."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "screenshots").mkdir()
        for name in ("s1.png", "s2.png"):
            (Path(tmp) / "screenshots" / name).write_bytes(_make_png())
        annotations["steps"][0]["evidence"]["screenshot_refs"] = ["screenshots/s1.png"]
        annotations["steps"][3]["evidence"]["screenshot_refs"] = ["screenshots/s2.png"]
        doc = _render(tmp, manifest, annotations, stats, analysis, events)
        assert _descr(doc) == ["Screenshot of step 1: Look up the order",
                               "Screenshot of step 3: Mail - Compose: Send"]


def test_without_a_map_picture_the_map_from_the_runs_is_a_table():
    """The viewer passes a picture of the map; without one (a command line
    export) the section still shows the map from the runs: each step and
    what followed it, with the number of runs."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    with tempfile.TemporaryDirectory() as tmp:
        doc = _render(tmp, manifest, annotations, stats, analysis, events)
        assert len(doc.inline_shapes) == 0
        (Path(tmp) / "process_map_step.bpmn").write_text("<x/>", encoding="utf-8")
        blocks = _blocks(_render(tmp, manifest, annotations, stats, analysis, events))
    assert _section(blocks, "3.1 As-Is process map") == [
        "Each step and the steps that followed it in the transactions:",
        "Step | Followed by",
        "Start | Look up the order (2 of 2 transactions)",
        "Look up the order | CRM - Orders: Save (1 of 2 transactions); "
        "Sheet - Log: Save (1 of 2 transactions)",
        "CRM - Orders: Save | Mail - Compose: Send (1 of 2 transactions); "
        "End (1 of 2 transactions)",
        "Mail - Compose: Send | End (1 of 2 transactions)",
        "Sheet - Log: Save | CRM - Orders: Save (1 of 2 transactions)",
        "The map file is process_map_step.bpmn in the project folder.",
    ]
    assert "7.1 To-Be process map" not in [t for _k, t in blocks]


def test_without_a_map_the_as_is_section_says_why():
    """No map: the transactions were not marked (a recording without start
    markers), or none of them has a step. A project without a recording
    always has its one implicit transaction, so a blank project with no
    steps yet is told it has no steps, never that its transactions were not
    marked."""
    if not _HAVE_DOCX:
        return

    def as_is(change):
        manifest, annotations, stats, analysis, events = _session()
        change(manifest, annotations, stats)
        return _section(_blocks_of(manifest, annotations, stats, analysis, events),
                        "3.1 As-Is process map")

    def no_runs(m, a, s):
        s["case_stats"] = []
        for st in a["steps"]:
            st["case_id"] = None

    def all_hidden(m, a, s):
        del a["pattern_run"]
        for st in a["steps"]:
            st["state"] = "hidden"

    def blank_without_steps(m, a, s):
        m["source"] = "blank"
        s["case_stats"] = [{"case_id": "implicit-run", "implicit": True, "label": None,
                            "parent_case_id": None, "start_ts": None, "end_ts": None,
                            "wall_clock_ms": None, "active_ms": None}]
        a.pop("pattern_run", None)
        a["steps"] = []

    assert as_is(no_runs) == [
        "Transactions were not marked in this recording, so there is no map."]
    assert as_is(all_hidden) == ["None of the transactions has steps, so there is no map."]
    assert as_is(blank_without_steps) == [
        "No steps have been added to this project yet, so there is no map."]


def test_document_notes_render_as_a_last_section_only_when_written():
    """C6 `document.notes` becomes a final "8. Notes" section; an empty or
    blank field adds nothing (no heading, no placeholder)."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    for blank in ("", "  \n  "):
        annotations["document"] = {"notes": blank}
        blocks = _blocks_of(manifest, annotations, stats, analysis, events)
        assert _numbered(blocks) == OUTLINE, repr(blank)
        assert "Notes" not in [t for k, t in blocks if k.startswith("Heading")]
    annotations["document"] = {
        "notes": "Ask Ana about the credit block.\n\nThe log step is skipped on Fridays."}
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    assert _numbered(blocks) == OUTLINE + ["8. Notes"]
    assert _section(blocks, "8. Notes")[:2] == [
        "Ask Ana about the credit block.", "The log step is skipped on Fridays."]


def test_legacy_keys_neither_group_nor_drop_steps():
    """C10: legacy group_annotations (ADR-0028 work items) and phases load
    without error and render nothing of their own."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    annotations["group_annotations"] = [{"case_id": R1, "screen_key": "scr:CRM - Orders",
                                         "name": "Legacy work item", "waste": True}]
    annotations["phases"] = [{"phase_id": "ph1", "name": "Legacy phase",
                              "step_ids": ["a1"]}]
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    text = _all_text(blocks)
    assert "Legacy work item" not in text and "Legacy phase" not in text
    assert [t for k, t in blocks if k == "Heading 3"] == [
        "Step 1: Look up the order", "Step 2: CRM - Orders: Save", "Step 3: Mail - Compose: Send"]


def test_write_pdd_works_without_analysis_or_events():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, _analysis, _events = _session()
    blocks = _blocks_of(manifest, annotations, stats, None, None)
    assert _numbered(blocks) == OUTLINE
    rows = _section(blocks, "5. Systems and information used")
    assert rows[0] == "System | Information entered"
    assert rows[1:] and all(r.endswith(" | not available to this export") for r in rows[1:]), rows


def test_failed_analysis_stages_change_nothing_in_the_document():
    """C12: the document reads no analysis stage, so a failed one can print
    neither a measured negative nor a finding; the document is the same as
    with every stage run."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    before = _all_text(_blocks_of(manifest, annotations, stats, analysis, events))
    stages = ("case_quality", "facts", "findings", "automation_candidates", "efficiency")
    for stage in stages:
        analysis[stage] = None
    analysis["stage_errors"] = [{"stage": s, "error": "KeyError: 'x'"} for s in stages]
    after = _all_text(_blocks_of(manifest, annotations, stats, analysis, events))
    strip = lambda t: re.sub(r"Project folder \| \S+", "", t)  # noqa: E731
    assert strip(after) == strip(before)
    for negative in ("Nothing stood out", "could not run"):
        assert negative not in after


def test_screenshot_refs_embed_only_inside_the_session_folder():
    """SEC Vuln 2: a '..' or absolute screenshot_ref is skipped; an in-folder
    ref is embedded."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    with tempfile.TemporaryDirectory() as outer:
        outer = Path(outer)
        secret = outer / "secret.png"
        secret.write_bytes(_make_png())
        session = outer / "session"
        (session / "shots").mkdir(parents=True)
        (session / "shots" / "s1.png").write_bytes(_make_png())
        step = annotations["steps"][0]
        step["evidence"]["screenshot_refs"] = ["../secret.png", str(secret)]
        doc = _render(session, manifest, annotations, stats, analysis, events)
        assert len(doc.inline_shapes) == 0
        step["evidence"]["screenshot_refs"] = ["shots/s1.png"]
        doc = _render(session, manifest, annotations, stats, analysis, events)
        assert len(doc.inline_shapes) == 1


def test_the_document_is_tool_neutral_and_has_no_dash_punctuation():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    annotations["document"] = dict(FIELDS)
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "map.png"
        png.write_bytes(_make_png())
        blocks = _blocks(_render(tmp, manifest, annotations, stats, analysis, events,
                                 process_map_image=str(png), tobe_map_image=str(png)))
    text = _all_text(blocks)
    for pattern in (r"robot", r"uipath", r"blue\s*prism", r"\bbot\b"):
        assert not re.search(pattern, text, re.IGNORECASE), pattern
    # No en dash or em dash anywhere; the document's own sentences carry no
    # spaced hyphen either (the step names come from window titles and may).
    assert chr(0x2013) not in text and chr(0x2014) not in text
    own = text
    for name in ("CRM - Orders: Save", "Mail - Compose: Send", "Sheet - Log: Save",
                 "Contoso CRM - Orders"):
        own = own.replace(name, "")
    assert " - " not in own and " -- " not in own



# ---- analyst-added content (contract C16) -------------------------------------------

def _pictures(doc):
    """The sha1 of each embedded picture's bytes, in document order."""
    import hashlib
    return [hashlib.sha1(doc.part.related_parts[rid].blob).hexdigest()
            for rid in doc.element.body.xpath(".//a:blip/@r:embed")]


def _sha(data):
    import hashlib
    return hashlib.sha1(data).hexdigest()


def test_the_system_set_on_a_step_wins_in_its_line_and_in_section_5():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    annotations["steps"][0]["system"] = "Order desk"            # a1, run 1
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    steps = _section(blocks, "3.2 Process steps")
    assert steps[0] == "The process runs through Order desk, Contoso CRM, Outlook and Excel."
    assert steps[steps.index("Step 1: Look up the order") + 1].startswith("Order desk, Orders \u00b7 ")
    assert "Order desk | Order number" in _section(blocks, "5. Systems and information used")


def test_a_step_without_a_time_says_no_time():
    """C16: a step added by hand without a time (time_range null) prints no
    place in the recording."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    annotations["steps"].append({"step_id": "h1", "case_id": R1, "name": "Phone the customer",
                                 "state": "manually_authored", "time_range": None,
                                 "order": 1, "system": "Phone"})
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    steps = _section(blocks, "3.2 Process steps")
    # After the timed steps of its run.
    assert [t for k, t in blocks if k == "Heading 3"][-1] == "Step 4: Phone the customer"
    assert steps[steps.index("Step 4: Phone the customer") + 1] == (
        "Phone \u00b7 in 1 of 2 transactions")
    # Its system is listed, with nothing entered in it; no time anywhere.
    assert "Phone | none" in _section(blocks, "5. Systems and information used")


def test_the_screenshot_the_analyst_chose_is_the_one_printed():
    """C16: `pdd_screenshot` names the one screenshot the PDD prints under a
    step (a recorder screenshot's path or an analyst screenshot's id); a
    recorder screenshot in `hidden_screenshots` is never printed; a choice
    that cannot be printed (hidden, missing, outside the folder) falls back
    to the step's first screenshot, and an analyst file stays in the folder.
    Lane LF-PIPE: the PDD prints one screenshot per step, the chosen one
    else the first (recorder screenshots first, then the analyst's)."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    shots = {"screenshots/s1.png": _make_png(2, 2), "screenshots/s2.png": _make_png(3, 2),
             "screenshots/analyst/a1.png": _make_png(4, 2)}
    with tempfile.TemporaryDirectory() as outer:
        outer = Path(outer)
        (outer / "secret.png").write_bytes(_make_png(5, 2))
        session = outer / "session"
        for rel, data in shots.items():
            (session / rel).parent.mkdir(parents=True, exist_ok=True)
            (session / rel).write_bytes(data)
        step = annotations["steps"][0]
        step["evidence"]["screenshot_refs"] = ["screenshots/s1.png", "screenshots/s2.png"]
        sha = {rel: _sha(data) for rel, data in shots.items()}

        def printed(**change):
            for key in ("pdd_screenshot", "hidden_screenshots"):
                step.pop(key, None)
            step.update(change)
            return _pictures(_render(session, manifest, annotations, stats, analysis, events))

        first = [sha["screenshots/s1.png"]]
        assert printed() == first
        assert printed(pdd_screenshot="screenshots/s2.png") == [sha["screenshots/s2.png"]]
        assert printed(hidden_screenshots=["screenshots/s1.png"]) == [sha["screenshots/s2.png"]]
        assert printed(pdd_screenshot="screenshots/s1.png",
                       hidden_screenshots=["screenshots/s1.png"]) == [sha["screenshots/s2.png"]]
        assert printed(pdd_screenshot="screenshots/gone.png") == first
        assert printed(pdd_screenshot="../secret.png") == first
        annotations["analyst_screenshots"] = [
            {"id": "a1", "file": "a1.png", "step_id": step["step_id"]},
            {"id": "evil", "file": "../../secret.png", "step_id": None}]
        assert printed() == first
        assert printed(pdd_screenshot="a1") == [sha["screenshots/analyst/a1.png"]]
        # An analyst file name never leaves screenshots/analyst/.
        assert printed(pdd_screenshot="evil") == first
        # The recorder's screenshots taken off the step: the analyst's prints.
        assert printed(hidden_screenshots=["screenshots/s1.png", "screenshots/s2.png"]) == [
            sha["screenshots/analyst/a1.png"]]


def test_attachments_are_listed_in_a_last_section_and_under_their_step():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    annotations["attachments"] = [
        {"id": "x1", "file": "sop.pdf", "label": "Order desk SOP", "step_id": None},
        {"id": "x2", "file": "attachments/form.docx", "label": "", "step_id": "a1"}]
    assert pdd_export._file_name("attachments" + chr(92) + "form.docx") == "form.docx"
    assert pdd_export._file_name("..") == "" and pdd_export._file_name(None) == ""
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    assert _numbered(blocks) == OUTLINE + ["8. Attachments"]
    headings = [t for k, t in blocks if k == "Heading 3"]
    steps = _section(blocks, "3.2 Process steps")
    first = steps[steps.index(headings[0]):steps.index(headings[1])]
    assert first[0] == "Step 1: Look up the order" and "Attachments: form.docx." in first
    assert sum(t.startswith("Attachments:") for t in steps) == 1
    assert _section(blocks, "8. Attachments") == [
        "The files are in the project folder's attachments folder.",
        "Attachment | File", "Order desk SOP | sop.pdf", "form.docx | form.docx"]


# ---- sub-processes (contract C19) ------------------------------------------------------

def _sub_step(sid, case_id, name, start, end, eids, **extra):
    """A drafted sub-step: its action_key, name_source "action", a draft."""
    step = {"step_id": sid, "case_id": case_id, "name": name, "state": "auto_suggested",
            "action_key": f"crm|CRM - Orders|{name}", "name_source": "action",
            "description": "", "flags": {"waste": False},
            "time_range": {"start": _ts(start), "end": _ts(end)},
            "evidence": {"interaction_event_ids": eids, "screenshot_refs": []}}
    step.update(extra)
    return step


def _hand_step(sid, case_id, name, order, **extra):
    step = {"step_id": sid, "case_id": case_id, "name": name, "state": "manually_authored",
            "time_range": None, "order": order,
            "evidence": {"interaction_event_ids": [], "screenshot_refs": []}}
    step.update(extra)
    return step


def _sub_session(open_run_1=True):
    """_session with sub-processes. Run 2's Save (b3) is opened as a
    sub-process: Enter the order number and Click Save, drafted from its
    recorded actions. With `open_run_1`, so is run 1's (a2), with Check
    stock between them (a sub-process added by hand, with Open the stock
    list and Read the stock), and its Click Save ends the sub-process when
    the order is on hold. Run 1's Send (a3) is grouped into Tell the
    customer."""
    manifest, annotations, stats, analysis, events = _session()
    events += [
        _inter("e10", 4.5, "crm.exe", CRM_TITLE, "value_changed", "Order number", value="ORD-1"),
        _inter("f10", 69.5, "crm.exe", CRM_TITLE, "value_changed", "Order number", value="ORD-2")]
    steps = {s["step_id"]: s for s in annotations["steps"]}
    if open_run_1:
        steps["a2"]["state"] = "edited"
        check = _hand_step("s2", R1, "Check stock", None,
                           time_range={"start": _ts(4.9), "end": _ts(5)},
                           sub_steps=[_hand_step("n1", R1, "Open the stock list", 1),
                                      _hand_step("n2", R1, "Read the stock", 2)])
        del check["order"]
        steps["a2"]["sub_steps"] = [
            _sub_step("s1", R1, "Enter the order number", 4.5, 4.8, ["e10"]), check,
            _sub_step("s3", R1, "Click Save", 5, 5.5, ["e3"],
                      links=[{"to": "end", "when": "the order is on hold"}])]
    steps["b3"]["state"] = "edited"
    steps["b3"]["sub_steps"] = [
        _sub_step("t1", R2, "Enter the order number", 69.5, 69.8, ["f10"]),
        _sub_step("t3", R2, "Click Save", 70, 70.5, ["f5"])]
    send = steps["a3"]
    group = {"step_id": "g1", "case_id": R1, "name": "Tell the customer", "group": True,
             "state": "manually_authored", "description": "Tell the customer the order is booked.",
             "flags": {"waste": False}, "time_range": dict(send["time_range"]),
             "evidence": {"interaction_event_ids": list(send["evidence"]["interaction_event_ids"]),
                          "screenshot_refs": []},
             "sub_steps": [send]}
    annotations["steps"] = [s for s in annotations["steps"] if s is not send] + [group]
    return manifest, annotations, stats, analysis, events


_CHAPTERS = ["3.3 Sub-process 2: CRM - Orders: Save", "3.4 Sub-process 2.2: Check stock",
             "3.5 Sub-process 3: Tell the customer"]
_CHAPTERS_AT = OUTLINE.index("3.2 Process steps") + 1


def test_each_numbered_sub_process_has_a_chapter_after_the_steps_depth_first():
    if not _HAVE_DOCX:
        return
    blocks = _blocks_of(*_sub_session())
    assert _numbered(blocks) == OUTLINE[:_CHAPTERS_AT] + _CHAPTERS + OUTLINE[_CHAPTERS_AT:]
    assert [t for k, t in blocks if k == "Heading 3"] == [
        "Step 1: Look up the order", "Step 2: CRM - Orders: Save", "Step 3: Tell the customer",
        "Step 2.1: Enter the order number", "Step 2.2: Check stock", "Step 2.3: Click Save",
        "Step 2.2.1: Open the stock list", "Step 2.2.2: Read the stock",
        "Step 3.1: Mail - Compose: Send"]


def test_no_step_number_reads_as_a_section_number():
    """Lane FX1 (report 2, item 9; report 3, F10): chapter 3 numbers its
    sections 3.1 to 3.5 and a sub-process numbers its steps 3.1, 3.2...: a
    step's number always follows the word Step (and step in a flow line), and
    a pointer names its section, so no heading or line reads a step's number
    where a section's stands."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _sub_session()
    save = next(s for s in annotations["steps"] if s["step_id"] == "a2")
    check = next(s for s in save["sub_steps"] if s["step_id"] == "s2")
    check["links"] = [{"to": "s1", "when": "the stock is missing"}]
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    sections = {t.split(" ", 1)[0] for t in _numbered(blocks)}
    assert {"3.1", "3.3", "3.4", "3.5"} <= sections
    steps = [t for k, t in blocks if k == "Heading 3"]
    assert steps and all(t.startswith("Step ") for t in steps), steps
    assert not any(t.split(" ", 1)[0].rstrip(".") in sections for t in steps)
    assert "Step 3.1: Mail - Compose: Send" in steps       # the step 3.1 beside section 3.1
    pointers = [t for _k, t in blocks if t.startswith("Sub-process: see")]
    assert pointers and all(re.fullmatch(r"Sub-process: see section 3\.\d+\.", t) for t in pointers)
    flows = [t for _k, t in blocks if t.startswith("Then ")]
    assert flows and all(re.search(r" step \d+(\.\d+)*, ", t) for t in flows), flows


def test_a_step_that_is_a_sub_process_points_at_its_chapter():
    if not _HAVE_DOCX:
        return
    blocks = _blocks_of(*_sub_session())
    steps = _section(blocks, "3.2 Process steps")
    two, three = steps.index("Step 2: CRM - Orders: Save"), steps.index("Step 3: Tell the customer")
    assert steps[three - 1] == "Sub-process: see section 3.3."
    assert steps[-1] == "Sub-process: see section 3.5."
    assert sum(t.startswith("Sub-process:") for t in steps) == 2
    # The rest of step 2's block is as before: its context line.
    assert steps[two + 1].startswith("Contoso CRM, Orders")
    chapter = _section(blocks, _CHAPTERS[0])
    check, save = chapter.index("Step 2.2: Check stock"), chapter.index("Step 2.3: Click Save")
    assert chapter[check + 1:save] == [
        "in 1 of 2 transactions · Transaction 1 at 0:04",
        "Sub-process: see section 3.4."]
    assert not any(t.startswith("Sub-process:") for t in _section(blocks, _CHAPTERS[1]))


def test_a_chapter_prints_its_map_then_the_reference_transactions_first_visit():
    """Without a picture the map is the table 3.1 falls back to, counted
    over the transactions that ran the sub-process; then the reference
    transaction's steps, printed like 3.2's (their context line, fields,
    flow), numbered in the chapter."""
    if not _HAVE_DOCX:
        return
    blocks = _blocks_of(*_sub_session())
    chapter = _section(blocks, _CHAPTERS[0])
    assert chapter[:7] == [
        "Each step and the steps that followed it in the transactions:",
        "Step | Followed by",
        "Start | Enter the order number (2 of 2 transactions)",
        "Enter the order number | Check stock (1 of 2 transactions); "
        "Click Save (1 of 2 transactions)",
        "Check stock | Click Save (1 of 2 transactions)",
        "Click Save | End (2 of 2 transactions)",
        "2 of these 3 steps are drafts not confirmed yet."]
    one = chapter.index("Step 2.1: Enter the order number")
    assert chapter[one + 1:one + 3] == [
        "Contoso CRM, Orders · in 2 of 2 transactions · Transaction 1 at 0:04",
        "Fields: Order number."]
    save = chapter.index("Step 2.3: Click Save")
    assert chapter[save + 1].startswith("Contoso CRM, Orders · ")
    assert chapter[save + 2:] == ["The sub-process ends here when the order is on hold."]
    deeper = _section(blocks, _CHAPTERS[1])
    assert deeper[:5] == ["Each step and the steps that followed it in the transactions:",
                          "Step | Followed by",
                          "Start | Open the stock list (1 of 1 transaction)",
                          "Open the stock list | Read the stock (1 of 1 transaction)",
                          "Read the stock | End (1 of 1 transaction)"]
    # A step added by hand without a time prints no time and no place.
    first = deeper.index("Step 2.2.1: Open the stock list")
    assert deeper[first + 1] == "in 1 of 1 transaction"


def test_a_link_inside_a_chapter_is_numbered_as_the_chapter_numbers_it():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _sub_session()
    a2 = next(s for s in annotations["steps"] if s["step_id"] == "a2")
    a2["sub_steps"][2]["links"] = [{"to": "s1", "when": "the number is wrong"},
                                   {"to": "end"}]
    a2["sub_steps"][0]["links"] = [{"to": "s3", "when": "nothing to check"}]
    chapter = _section(_blocks_of(manifest, annotations, stats, analysis, events),
                       _CHAPTERS[0])
    check = chapter.index("Step 2.2: Check stock")
    assert chapter[check - 1] == "Then skips to step 2.3, Click Save, when nothing to check."
    assert chapter[-2:] == ["Then goes back to step 2.1, Enter the order number, "
                            "when the number is wrong.", "The sub-process ends here."]


def test_a_group_prints_its_name_line_description_flow_and_pointer_not_its_members_detail():
    """A group's block in 3.2: no fields and no screenshot (its chapter
    prints its steps with theirs), its description when written, its flow."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _sub_session()
    group = next(s for s in annotations["steps"] if s["step_id"] == "g1")
    group["only_when"] = "the customer asked for a mail"
    group["links"] = [{"to": "a1", "when": "the order changes"}]
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "shots").mkdir()
        (Path(tmp) / "shots" / "send.png").write_bytes(_make_png(3, 2))
        group["evidence"]["screenshot_refs"] = ["shots/send.png"]
        group["sub_steps"][0]["evidence"]["screenshot_refs"] = ["shots/send.png"]
        doc = _render(tmp, manifest, annotations, stats, analysis, events)
        blocks = _blocks(doc)
        pictures = len(doc.inline_shapes)
    steps = _section(blocks, "3.2 Process steps")
    at = steps.index("Step 3: Tell the customer")
    assert steps[at + 1:] == [
        "Outlook, Order confirmation · in 1 of 2 transactions · Transaction 1 at 0:10",
        "Only when the customer asked for a mail.",
        "Tell the customer the order is booked.",
        "Then goes back to step 1, Look up the order, when the order changes.",
        "Sub-process: see section 3.5."]
    # Its member prints in its chapter, the screenshot with it: one picture.
    chapter = _section(blocks, _CHAPTERS[2])
    send = chapter.index("Step 3.1: Mail - Compose: Send")
    assert chapter[send + 1:] == [
        "Outlook, Order confirmation · in 1 of 1 transaction · Transaction 1 at 0:10",
        "Fields: To, Subject, Password.", "Flagged as waste."]
    assert pictures == 1


def test_a_sub_process_the_reference_did_not_open_points_at_a_chapter_without_its_steps():
    """Run 2 opened Save, run 1 (the reference) did not: the node is a
    sub-process, numbered by run 1's step, so that step points at the
    chapter, which draws run 2's steps and says the reference has none."""
    if not _HAVE_DOCX:
        return
    blocks = _blocks_of(*_sub_session(open_run_1=False))
    steps = _section(blocks, "3.2 Process steps")
    assert steps[steps.index("Step 3: Tell the customer") - 1] == "Sub-process: see section 3.3."
    assert _section(blocks, "3.3 Sub-process 2: CRM - Orders: Save") == [
        "Each step and the steps that followed it in the transactions:",
        "Step | Followed by",
        "Start | Enter the order number (1 of 1 transaction)",
        "Enter the order number | Click Save (1 of 1 transaction)",
        "Click Save | End (1 of 1 transaction)",
        "The reference transaction has no steps in this sub-process."]
    assert _numbered(blocks)[_CHAPTERS_AT:_CHAPTERS_AT + 2] == [
        "3.3 Sub-process 2: CRM - Orders: Save", "3.4 Sub-process 3: Tell the customer"]


def test_what_the_analyst_adds_by_step_id_prints_at_every_level():
    """C16's screenshots and attachments keyed by step_id resolve for a
    sub-step as for a step: its analyst screenshot, the one chosen for the
    PDD, and its attachments print under it in its chapter."""
    if not _HAVE_DOCX:
        return
    import hashlib
    manifest, annotations, stats, analysis, events = _sub_session()
    annotations["attachments"] = [
        {"id": "x1", "file": "stock.xlsx", "label": "Stock sheet", "step_id": "n1"}]
    annotations["analyst_screenshots"] = [
        {"id": "sh1", "file": "sh1.png", "step_id": "s1"},
        {"id": "sh2", "file": "sh2.png", "step_id": "s1"}]
    a2 = next(s for s in annotations["steps"] if s["step_id"] == "a2")
    a2["sub_steps"][0]["pdd_screenshot"] = "sh2"
    with tempfile.TemporaryDirectory() as tmp:
        shots = Path(tmp) / "screenshots" / "analyst"
        shots.mkdir(parents=True)
        one, two = _make_png(3, 2), _make_png(4, 2)
        (shots / "sh1.png").write_bytes(one)
        (shots / "sh2.png").write_bytes(two)
        doc = _render(tmp, manifest, annotations, stats, analysis, events)
        blocks = _blocks(doc)
        shas = _pictures(doc)
    assert shas == [hashlib.sha1(two).hexdigest()]
    deeper = _section(blocks, _CHAPTERS[1])
    first = deeper.index("Step 2.2.1: Open the stock list")
    assert deeper[first + 2] == "Attachments: Stock sheet."
    assert _section(blocks, "8. Attachments")[-1] == "Stock sheet | stock.xlsx"


def test_an_empty_sub_process_says_it_has_no_steps():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    for s in annotations["steps"]:
        if s["step_id"] == "a2":
            s["sub_steps"] = []
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    assert _section(blocks, "3.3 Sub-process 2: CRM - Orders: Save") == [
        "No steps have been added to this sub-process yet, so there is no map."]


def test_the_sections_after_the_steps_read_the_main_level_only():
    if not _HAVE_DOCX:
        return
    blocks = _blocks_of(*_sub_session())
    start = next(i for i, (_k, t) in enumerate(blocks)
                 if t == "4. Variations, rules and exceptions")
    after = _all_text(blocks[start:])
    for name in ("Enter the order number", "Check stock", "Open the stock list",
                 "Read the stock", "Click Save"):
        assert name not in after, name
    assert len(_section(blocks, "5. Systems and information used")) > 1


def test_the_map_pictures_manifest_gives_each_map_its_picture():
    """--pdd-map-images: the main map's entry wins over --pdd-map-image; a
    chapter prints its own picture on a page of its own, its number in the
    alternative text; an entry whose file is missing is left out, so that
    map prints as a table; a relative file is read beside the manifest."""
    if not _HAVE_DOCX:
        return
    import hashlib
    from docx.enum.section import WD_ORIENT
    manifest, annotations, stats, analysis, events = _sub_session()
    with tempfile.TemporaryDirectory() as tmp:
        pics = Path(tmp) / "pics"
        pics.mkdir()
        main, save, other = _make_png(40, 20), _make_png(30, 20), _make_png(20, 40)
        (pics / "main.png").write_bytes(main)
        (pics / "save.png").write_bytes(save)
        (Path(tmp) / "other.png").write_bytes(other)
        index = pics / "maps.json"
        index.write_text(json.dumps({"maps": [
            {"path": [], "png": str(pics / "main.png")},
            {"path": ["CRM - Orders: Save"], "png": "save.png"},
            {"path": ["CRM - Orders: Save", "Check stock"], "png": "gone.png"},
            {"path": "not a path", "png": "save.png"}]}), encoding="utf-8")
        doc = _render(tmp, manifest, annotations, stats, analysis, events,
                      process_map_image=str(Path(tmp) / "other.png"), map_images=str(index))
        blocks = _blocks(doc)
        shas = _pictures(doc)
        alt = _descr(doc)
        orientation = [s.orientation for s in doc.sections]
    assert alt == ["As-Is process map", "As-Is process map, sub-process 2"]
    assert shas == [hashlib.sha1(main).hexdigest(), hashlib.sha1(save).hexdigest()]
    assert orientation.count(WD_ORIENT.LANDSCAPE) == 2
    assert _numbered(blocks) == OUTLINE[:_CHAPTERS_AT] + _CHAPTERS + OUTLINE[_CHAPTERS_AT:]
    # The chapter's picture takes its map's place; its steps follow.
    assert _section(blocks, _CHAPTERS[0])[0] == "2 of these 3 steps are drafts not confirmed yet."
    assert _section(blocks, _CHAPTERS[1])[:2] == [
        "Each step and the steps that followed it in the transactions:", "Step | Followed by"]


def test_an_unreadable_manifest_prints_the_tables():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _sub_session()
    with tempfile.TemporaryDirectory() as tmp:
        index = Path(tmp) / "maps.json"
        index.write_text("{not json", encoding="utf-8")
        doc = _render(tmp, manifest, annotations, stats, analysis, events, map_images=str(index))
        assert len(doc.inline_shapes) == 0
        blocks = _blocks(doc)
    assert _section(blocks, "3.1 As-Is process map")[0] == (
        "Each step and the steps that followed it in the transactions:")
    assert _numbered(blocks)[_CHAPTERS_AT:_CHAPTERS_AT + 3] == _CHAPTERS


def test_sub_processes_keep_the_document_free_of_old_words_and_dashes():
    if not _HAVE_DOCX:
        return
    text = _all_text(_blocks_of(*_sub_session()))
    left = _OLD_WORDS.findall(text.replace("runs through", ""))
    assert not left, left
    assert chr(0x2013) not in text and chr(0x2014) not in text


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")


def test_lane_lf_pipe_what_counts_as_a_field_entered():
    """The fields the step pane, the Data section and the Technical details
    list (the viewer's step-facts.js _entered, the same rules): #1 a secret
    the recorder redacted reads "Password typed (hidden)", never missing or
    "cleared"; #4 an empty web field (U+FFFC) is no value; #25 the address
    bar is a navigation, never a field; #7 and #13 a choice named by its
    own option ("Croatia", a cell "A2") names no field, while the
    dropdown's own value does."""
    E = pdd_export._entered
    assert E({"kind": "value_changed", "name": "Password", "value_redacted": True}) == (
        "Password", "typed (hidden)")
    assert pdd_export.SECRET_VALUE == "typed (hidden)"
    assert E({"kind": "value_changed", "name": "Quantity", "value": "\ufffc"}) is None
    assert E({"kind": "value_changed", "name": "Quantity", "value": " \ufffc "}) is None
    assert E({"kind": "value_changed", "name": "Quantity", "value": "2"}) == ("Quantity", "2")
    assert E({"kind": "value_changed", "name": "Address and search bar",
              "class_name": "OmniboxViewViews", "value": "127.0.0.1:8765/orderdesk.html#order"}) is None
    assert E({"kind": "selection_changed", "control_type": "ListItem", "name": "Croatia",
              "selected_value": "Croatia"}) is None
    assert E({"kind": "selection_changed", "control_type": "DataItem", "name": "A2",
              "selected_value": "A2"}) is None
    assert E({"kind": "value_changed", "control_type": "ComboBox", "name": "Country",
              "value": "Croatia"}) == ("Country", "Croatia")
    assert E({"kind": "selection_changed", "name": "Plant", "selected_value": "1000"}) == (
        "Plant", "1000")
