"""Tests for pdd_export: the PDD built around the pattern run (C3), the
analyst's document sections (C6), one measured timings table, and the
differences between runs.

The fixture is a synthetic two-run session: run 1 is the pattern (Find,
Save, Send, plus one hidden step); run 2 does Find, an extra Log step and
Save, and skips Send.

Deps-gated: write_pdd needs python-docx, which the full-deps gate (bundled
python plus the system pytest) has; without it these tests no-op.

Run with pytest:
    pytest normalization/test/test_pdd_export.py
"""

from __future__ import annotations
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


def _ts(sec):
    return (T0 + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _step(sid, case_id, name, key, sec, eids, state="auto_suggested", **extra):
    step = {"step_id": sid, "case_id": case_id, "name": name, "draft_key": key,
            "state": state, "description": "", "flags": {"waste": False},
            "time_range": {"start": _ts(sec), "end": _ts(sec + 2)},
            "evidence": {"interaction_event_ids": eids, "screenshot_refs": []}}
    step.update(extra)
    return step


def _inter(eid, sec, proc, kind, name, control_type="Edit", **data):
    return {"event_id": eid, "type": "interaction", "timestamp": _ts(sec),
            "data": {"kind": kind, "process_name": proc, "name": name,
                     "control_type": control_type, **data}}


def _session():
    """(manifest, annotations, stats, analysis, events) of the fixture."""
    manifest = {"session_id": "sess-pdd", "engagement_id": "ENG-1",
                "started_at": _ts(0), "config": {"worker": {"id": "w1"}}}
    annotations = {"steps": [
        _step("a1", R1, "Look up the order", FIND, 1, ["e1", "e2"],
              state="confirmed", description="Search the order by its number."),
        _step("a2", R1, "CRM - Orders: Save", SAVE, 5, ["e3"], state="confirmed"),
        _step("hid", R1, "Hidden noise step", "crm|CRM - Orders|Button:noise", 7,
              ["e9"], state="hidden"),
        _step("a3", R1, "Mail - Compose: Send", SEND, 10, ["e4", "e5", "e6"],
              state="confirmed", flags={"waste": True}),
        _step("b1", R2, "Look up the order", FIND, 61, ["f1", "f2"]),
        _step("b2", R2, "Sheet - Log: Save", LOG, 65, ["f3", "f4"]),
        _step("b3", R2, "CRM - Orders: Save", SAVE, 70, ["f5"]),
    ], "pattern_run": {"case_id": R1, "confirmed_at": _ts(200)}}
    events = [
        _inter("e1", 1, "crm.exe", "value_changed", "Order number", value="ORD-1"),
        _inter("e2", 2, "crm.exe", "invoked", "Find", "Button"),
        _inter("e3", 5, "crm.exe", "invoked", "Save", "Button"),
        _inter("e9", 7, "crm.exe", "value_changed", "Noise field", value="NOISE-VALUE"),
        _inter("e4", 10, "OUTLOOK.EXE", "value_changed", "To", value="customer@example.com"),
        _inter("e5", 11, "OUTLOOK.EXE", "value_changed", "Password", value_redacted=True),
        _inter("e6", 12, "OUTLOOK.EXE", "invoked", "Send", "Button"),
        _inter("f1", 61, "crm.exe", "value_changed", "Order number", value="ORD-2"),
        _inter("f2", 62, "crm.exe", "invoked", "Find", "Button"),
        _inter("f3", 65, "EXCEL.EXE", "value_changed", "Status", value="Logged"),
        _inter("f4", 66, "EXCEL.EXE", "invoked", "Save", "Button"),
        _inter("f5", 70, "crm.exe", "invoked", "Save", "Button"),
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
        "step_variants": [{"variant": ["x"], "frequency": 1},
                          {"variant": ["y"], "frequency": 1}],
        "meta": {
            "raw_event_count": 40, "interaction_count": 12, "step_count": 7,
            "step_state_breakdown": {"auto_suggested": 3, "manually_authored": 0,
                                     "edited": 0, "confirmed": 3, "hidden": 1},
            "vocab_coverage": {"crm.exe": {"total_interactions": 7},
                               "OUTLOOK.EXE": {"total_interactions": 3},
                               "EXCEL.EXE": {"total_interactions": 2}},
            "app_names": {"crm.exe": "Contoso CRM",
                          "OUTLOOK.EXE": "Microsoft Outlook (classic)",
                          "EXCEL.EXE": "Microsoft Excel"},
        },
    }
    analysis = {
        "case_quality": {"mode": "markers", "case_count": 2, "coverage": 1.0,
                         "tier2_unlocked": True},
        "facts": {"active_ms": 102000, "idle_ms": 0, "session_span_ms": 120000,
                  "top_apps": [{"app": "crm.exe", "ms": 60000, "share": 0.59}],
                  "app_switches": 4, "switches_per_hour": 120.0,
                  "longest_focus_ms": 20000, "rekey_count": 0,
                  "repeated_sequence_count": 1, "app_time_source": "activity"},
        "findings": [
            {"id": "screen_time_sink-x", "detector": "screen_time_sink", "tier": 1,
             "claim": "Contoso CRM accounts for 59% of measured foreground time.",
             "evidence": {"app": "crm.exe", "share": 0.59, "screenshot_refs": []},
             "confidence_note": "Foreground-window time."},
            {"id": "repetition-y", "detector": "repetition", "tier": 2,
             "claim": "The step sequence \"Look up the order → CRM - Orders: "
                      "Save\" in Contoso CRM was repeated 2 times.",
             "evidence": {"segment_signature": "sigA", "instance_count": 2},
             "confidence_note": "Counts exact repeats."},
        ],
        "automation_candidates": [
            {"segment_signature": "sigA", "app": "crm.exe",
             "step_labels": ["Look up the order", "CRM - Orders: Save"],
             "instance_count": 2, "total_elapsed_ms": 12000,
             "mean_elapsed_ms": 6000, "data_sufficiency": "multi_instance"},
            {"segment_signature": "sigB", "app": "OUTLOOK.EXE",
             "step_labels": ["Mail - Compose: Send"], "instance_count": 3,
             "total_elapsed_ms": 9000, "mean_elapsed_ms": 3000,
             "data_sufficiency": "multi_instance"},
            {"segment_signature": "sigC", "app": "x.exe", "step_labels": ["One-off"],
             "instance_count": 1, "data_sufficiency": "single_instance"},
        ],
        "efficiency": {"process_efficiency_ratio": 0.6},
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


def _rendered():
    """The body blocks of the fixture's PDD."""
    manifest, annotations, stats, analysis, events = _session()
    with tempfile.TemporaryDirectory() as tmp:
        doc = _render(tmp, manifest, annotations, stats, analysis, events)
        return _blocks(doc)


OUTLINE = [
    "1. Findings", "2. Document control", "3. Introduction", "3.1 Purpose",
    "3.2 Scope", "3.3 Key contacts", "4. As-is process", "4.1 Overview",
    "4.2 Applications used", "4.3 As-is process map", "4.4 Measured timings",
    "4.5 Detailed process steps", "4.6 Input data", "5. Automation assessment",
    "5.1 In scope", "5.2 Out of scope", "5.3 Automation candidates",
    "6. Exceptions and variations", "6.1 Differences between runs",
    "6.2 Business rules and exceptions", "6.3 Rework", "6.4 Application errors",
]


# ---- the outline, the title, the document fields (C6) --------------------------

def test_the_section_outline_is_complete_and_contiguous():
    if not _HAVE_DOCX:
        return
    blocks = _rendered()
    assert _numbered(blocks) == OUTLINE
    assert blocks[0] == ("Title", "Process Definition Document")


def test_document_fields_replace_their_placeholders():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    annotations["document"] = {
        "title": "Order intake", "purpose": "Book every customer order.",
        "scope": "From the order email to the confirmation mail.",
        "contacts": "Ana (process owner)\nBo (analyst)",
        "business_rules": "Orders over 10,000 need a second approval.",
        "exceptions": "A blocked customer goes to credit control.",
        "notes": ""}
    with tempfile.TemporaryDirectory() as tmp:
        blocks = _blocks(_render(tmp, manifest, annotations, stats, analysis, events))
    assert blocks[0] == ("Title", "Order intake")
    assert blocks[1] == ("p", "Process Definition Document")
    assert _section(blocks, "3.1 Purpose") == ["Book every customer order."]
    assert _section(blocks, "3.2 Scope") == ["From the order email to the confirmation mail."]
    contacts = _section(blocks, "3.3 Key contacts")
    assert contacts[-2:] == ["Ana (process owner)", "Bo (analyst)"]
    rules = _section(blocks, "6.2 Business rules and exceptions")
    assert rules == ["Business rules", "Orders over 10,000 need a second approval.",
                     "Exceptions", "A blocked customer goes to credit control."]
    assert "Process | Order intake" in _section(blocks, "2. Document control")
    assert "[To be completed" not in "".join(
        _section(blocks, "3.1 Purpose") + _section(blocks, "3.2 Scope") + contacts + rules)


def test_empty_document_fields_keep_short_placeholders():
    if not _HAVE_DOCX:
        return
    blocks = _rendered()
    for heading in ("3.1 Purpose", "3.2 Scope"):
        texts = _section(blocks, heading)
        assert len(texts) == 1 and texts[0].startswith("[To be completed:"), heading
    assert _section(blocks, "3.3 Key contacts")[-1].startswith("[To be completed:")
    rules = _section(blocks, "6.2 Business rules and exceptions")
    assert [t.startswith("[To be completed:") for t in rules] == [False, True, False, True]
    assert "Process | Not named yet" in _section(blocks, "2. Document control")


# ---- the pattern run (C3) and the detailed steps ------------------------------

def _steps_section(annotations_change=None, stats_change=None):
    manifest, annotations, stats, analysis, events = _session()
    if annotations_change:
        annotations_change(annotations)
    if stats_change:
        stats_change(stats)
    with tempfile.TemporaryDirectory() as tmp:
        blocks = _blocks(_render(tmp, manifest, annotations, stats, analysis, events))
    return blocks, _section(blocks, "4.5 Detailed process steps")


def test_the_chosen_pattern_run_is_the_detailed_process():
    if not _HAVE_DOCX:
        return
    def choose_run_2(a):
        a["pattern_run"] = {"case_id": R2}
    blocks, steps = _steps_section(choose_run_2)
    assert steps[0] == ("The steps below are those of Run 2: Order 2, the pattern "
                        "run: the analyst chose it as the pattern.")
    headings = [t for k, t in blocks if k == "Heading 3"]
    assert headings == ["1. Look up the order", "2. Sheet - Log: Save",
                        "3. CRM - Orders: Save"]
    assert "3 of its 3 steps are drafts the analyst has not confirmed yet." in steps


def test_without_a_valid_choice_the_first_run_with_steps_is_the_pattern():
    if not _HAVE_DOCX:
        return
    def unknown_run(a):
        a["pattern_run"] = {"case_id": "no-such-run"}
    blocks, steps = _steps_section(unknown_run)
    assert steps[0].startswith("The steps below are those of Run 1: Order 1, the "
                               "pattern run: no run has been chosen as the pattern yet")
    assert [t for k, t in blocks if k == "Heading 3"] == [
        "1. Look up the order", "2. CRM - Orders: Save", "3. Mail - Compose: Send"]
    assert "All 3 steps of this run are confirmed by the analyst." in steps

    def run_1_all_hidden(a):
        del a["pattern_run"]
        for st in a["steps"]:
            if st["case_id"] == R1:
                st["state"] = "hidden"
    blocks, steps = _steps_section(run_1_all_hidden)
    assert steps[0].startswith("The steps below are those of Run 2: Order 2")


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
    assert steps[0] == ("Runs were not marked in this recording, so there is no "
                        "pattern run; every step is listed in time order.")
    assert [t for k, t in blocks if k == "Heading 3"] == [
        "1. Look up the order", "2. CRM - Orders: Save", "3. Mail - Compose: Send",
        "4. Look up the order", "5. Sheet - Log: Save", "6. CRM - Orders: Save"]
    assert _section(blocks, "6.1 Differences between runs") == [
        "Runs were not marked in this recording, so there are no runs to compare."]


def test_a_step_shows_its_description_fields_and_waste_flag():
    if not _HAVE_DOCX:
        return
    blocks = _rendered()
    steps = _section(blocks, "4.5 Detailed process steps")
    i = steps.index("1. Look up the order")
    assert steps[i + 1:i + 5] == ["Search the order by its number.",
                                  "Fields entered in this run:",
                                  "Field | Value entered", "Order number | ORD-1"]
    j = steps.index("3. Mail - Compose: Send")
    assert steps[j + 1:j + 6] == ["Fields entered in this run:", "Field | Value entered",
                                  "To | customer@example.com",
                                  "Password | (not recorded: secret field)",
                                  "Flagged as waste."]


def test_a_step_description_shows_only_when_the_analyst_wrote_it():
    """A draft's description is the narration the drafting generates from its
    interactions ("Clicked Save."), which repeats the step's fields table. It
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
                    "4.5 Detailed process steps")
    assert body[body.index("1. Look up the order") + 1] == "Search the order by its number."
    assert body[body.index("2. CRM - Orders: Save") + 1] == "3. Mail - Compose: Send"
    assert "Clicked Save." not in body
    assert body[body.index("3. Mail - Compose: Send") + 1] == (
        narration("a3") + " Ana: then I send it.")
    no_events = _section(_blocks_of(manifest, annotations, stats, analysis, None),
                         "4.5 Detailed process steps")
    assert no_events[no_events.index("2. CRM - Orders: Save") + 1] == "Clicked Save."


def test_document_notes_render_as_a_last_section_only_when_written():
    """C6 `document.notes` becomes a final "7. Notes" section; an empty or
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
    assert _numbered(blocks) == OUTLINE + ["7. Notes"]
    assert _section(blocks, "7. Notes")[:2] == [
        "Ask Ana about the credit block.", "The log step is skipped on Fridays."]


def test_input_data_lists_each_field_once_with_its_step():
    if not _HAVE_DOCX:
        return
    blocks = _rendered()
    assert _section(blocks, "4.6 Input data") == [
        "Field | Step | Example value",
        "Order number | Look up the order | ORD-1",
        "To | Mail - Compose: Send | customer@example.com",
        "Password | Mail - Compose: Send | (not recorded: secret field)",
        "Status | Sheet - Log: Save | Logged",
    ]


def test_hidden_steps_never_appear():
    if not _HAVE_DOCX:
        return
    text = _all_text(_rendered())
    assert "Hidden noise step" not in text
    assert "Noise field" not in text and "NOISE-VALUE" not in text
    # Positive control: the visible steps of the same run do render.
    assert "Mail - Compose: Send" in text


# ---- 4.4 measured timings -----------------------------------------------------

def test_the_timings_table_has_one_row_per_run_and_no_median():
    if not _HAVE_DOCX:
        return
    blocks = _rendered()
    timings = _section(blocks, "4.4 Measured timings")
    assert timings[:3] == [
        "Run | Steps | Active time | Elapsed time (wall clock)",
        "Run 1: Order 1 | 3 | 44s | 50s",            # the hidden step is not counted
        "Run 2: Order 2 | 3 | 58s | 1m",
    ]
    assert timings[3].startswith("Active time is the time an application window")
    assert "Active time over 2 runs: mean 51s, minimum 44s, maximum 58s." in timings
    assert "Elapsed time over 2 runs: mean 55s, minimum 50s, maximum 1m." in timings
    text = _all_text(blocks).lower()
    assert "median" not in text and "percentile" not in text and "p90" not in text
    # DA gap 7: section 1 names the elapsed time the same way, same numbers.
    assert ("Elapsed time per run (wall clock): mean 55s, fastest 50s, slowest 1m, "
            "across 2 timed runs.") in _all_text(blocks)


def test_the_efficiency_ratio_needs_the_analysts_judgment():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    with tempfile.TemporaryDirectory() as tmp:
        blocks = _blocks(_render(tmp, manifest, annotations, stats, analysis, events))
    assert "Value-add share" not in _all_text(blocks)
    annotations["analysis_overrides"] = [{"process_label": "Look up the order",
                                          "bnva_ms": 5000}]
    with tempfile.TemporaryDirectory() as tmp:
        blocks = _blocks(_render(tmp, manifest, annotations, stats, analysis, events))
    assert ("Value-add share: 60% of the measured step time, after the analyst "
            "judged which time adds value.") in _section(blocks, "4.4 Measured timings")


# ---- 6.1 differences, 6.3 rework ----------------------------------------------

def test_the_differences_list_exactly_the_extra_and_the_skipped_step():
    if not _HAVE_DOCX:
        return
    diffs = _section(_rendered(), "6.1 Differences between runs")
    assert diffs[1:] == [
        "Run 2: Order 2",
        "Extra step: Sheet - Log: Save (after Look up the order).",
        "Skipped: Mail - Compose: Send (step 3 of the pattern run).",
    ]


def test_an_order_change_and_a_run_without_differences():
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
    ]
    # Run 2 now saves before it looks the order up.
    for st in annotations["steps"]:
        if st["step_id"] == "b3":
            st["time_range"] = {"start": _ts(60), "end": _ts(60)}
    with tempfile.TemporaryDirectory() as tmp:
        blocks = _blocks(_render(tmp, manifest, annotations, stats, analysis, events))
    assert _section(blocks, "6.1 Differences between runs")[1:] == [
        "Run 2: Order 2",
        "Different order: Look up the order (in this run after CRM - Orders: Save).",
        "Extra step: Sheet - Log: Save (after Look up the order).",
        "Skipped: Mail - Compose: Send (step 3 of the pattern run).",
        "No differences from the pattern run: Run 3: Order 3.",
    ]


def test_a_merged_pattern_step_matches_the_same_drafts_in_another_run():
    """Item 1 (BA helper L12b): the analyst merged the pattern run's Find and
    Save drafts into one step (draft_keys). Run 2 still has them as two
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
    assert _section(blocks, "6.1 Differences between runs")[1:] == [
        "Run 2: Order 2",
        "Extra step: Sheet - Log: Save (after Look up and save the order).",
        "Skipped: Mail - Compose: Send (step 2 of the pattern run).",
    ]


def test_rework_lists_a_step_done_twice_within_a_run():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    assert _section(_blocks_of(manifest, annotations, stats, analysis, events),
                    "6.3 Rework") == ["No step was done more than once within a run."]
    annotations["steps"].append(_step("b4", R2, "CRM - Orders: Save", SAVE, 80, []))
    blocks = _blocks_of(manifest, annotations, stats, analysis, events)
    assert _section(blocks, "6.3 Rework") == [
        "Steps done more than once within one run:",
        "Run 2: Order 2: CRM - Orders: Save (2 times)."]
    # A repeat is rework, not a difference from the pattern run.
    assert "CRM - Orders: Save" not in "".join(
        _section(blocks, "6.1 Differences between runs")[1:])


def _blocks_of(manifest, annotations, stats, analysis, events):
    with tempfile.TemporaryDirectory() as tmp:
        return _blocks(_render(tmp, manifest, annotations, stats, analysis, events))


# ---- readable names, tool-neutral wording, section 1 and 5.3 --------------------

def test_applications_carry_readable_names_never_process_tokens():
    if not _HAVE_DOCX:
        return
    blocks = _rendered()
    assert _section(blocks, "4.2 Applications used")[:4] == [
        "Application | Interactions recorded | Role in process",
        "Contoso CRM | 7 | ", "Microsoft Outlook (classic) | 3 | ",
        "Microsoft Excel | 2 | "]
    text = _all_text(blocks)
    assert "Mail - Compose: Send | Microsoft Outlook (classic) | 3 | 9s | 3s" in text
    for token in ("crm.exe", "OUTLOOK.EXE", "EXCEL.EXE", "x.exe"):
        assert token not in text
    assert not re.search(r"\.exe\b", text, re.IGNORECASE)


def test_the_document_is_tool_neutral():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    annotations["document"] = {"title": "Order intake", "purpose": "p", "scope": "s"}
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "map.png"
        png.write_bytes(_make_png())
        blocks = _blocks(_render(tmp, manifest, annotations, stats, analysis, events,
                                 process_map_image=str(png), tobe_map_image=str(png)))
    text = _all_text(blocks)
    assert "5.4 Proposed to-be process" in text            # every section rendered
    for pattern in (r"robot", r"uipath", r"blue\s*prism", r"\bbot\b"):
        assert not re.search(pattern, text, re.IGNORECASE), pattern
    # Law 3 of the lane: no en dash or em dash in the rendered text.
    assert chr(0x2013) not in text and chr(0x2014) not in text


def test_section_1_renders_the_selected_findings_with_the_case_based_label():
    if not _HAVE_DOCX:
        return
    blocks = _rendered()
    text = _all_text(blocks)
    assert "1. Contoso CRM accounts for 59% of measured foreground time." in text
    assert ("2. Across runs: The step sequence \"Look up the order → CRM - Orders: "
            "Save\" in Contoso CRM was repeated 2 times.") in text
    manifest, annotations, stats, analysis, events = _session()
    annotations["memo_selection"] = ["screen_time_sink-x"]
    text = _all_text(_blocks_of(manifest, annotations, stats, analysis, events))
    assert "Contoso CRM accounts for 59%" in text
    assert "Across runs:" not in text


def test_candidates_skip_what_section_1_already_says():
    if not _HAVE_DOCX:
        return
    cands = _section(_rendered(), "5.3 Automation candidates")
    assert cands[1:4] == [
        "Section 1 already describes 1 candidate (finding 2); it is not repeated here.",
        "Step sequence | Application | Times run | Total time | Average per run",
        "Mail - Compose: Send | Microsoft Outlook (classic) | 3 | 9s | 3s",
    ]
    assert not any("Look up the order →" in t for t in cands)


def test_failed_analysis_stages_render_as_could_not_run():
    """C12: every section that would render a failed stage says the check
    could not run on this recording, never a measured negative."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    stages = ("case_quality", "facts", "findings", "automation_candidates", "efficiency")
    for stage in stages:
        analysis[stage] = None
    analysis["stage_errors"] = [{"stage": s, "error": "KeyError: 'x'"} for s in stages]
    with tempfile.TemporaryDirectory() as tmp:
        doc = _render(tmp, manifest, annotations, stats, analysis, events)
        blocks = _blocks(doc)
    text = _all_text(blocks)
    for phrase in ("The automatic checks could not run on this recording",
                   "The run check could not run on this recording",
                   "The automation-candidate check could not run on this recording",
                   "The process-efficiency check could not run on this recording"):
        assert phrase in text, f"missing: {phrase}"
    for negative in ("Nothing stood out", "No runs were marked",
                     "No sequence of steps was repeated"):
        assert negative not in text, f"measured negative rendered: {negative}"
    fact_table = next(t for t in doc.tables if t.rows[0].cells[0].text == "Active time")
    assert {c.text for c in fact_table.rows[1].cells} == {"could not run on this recording"}


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
        "1. Look up the order", "2. CRM - Orders: Save", "3. Mail - Compose: Send"]


# ---- files, images, containment -----------------------------------------------

def test_write_pdd_works_without_analysis_or_events():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, _analysis, _events = _session()
    with tempfile.TemporaryDirectory() as tmp:
        blocks = _blocks(_render(tmp, manifest, annotations, stats, None, None))
    assert _numbered(blocks) == OUTLINE
    assert _section(blocks, "4.6 Input data") == [
        "The recorded field entries were not available to this export."]


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


def test_the_maps_are_embedded_when_provided_and_to_be_is_omitted_otherwise():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis, events = _session()
    with tempfile.TemporaryDirectory() as tmp:
        doc = _render(tmp, manifest, annotations, stats, analysis, events)
        assert len(doc.inline_shapes) == 0
        texts = [p.text for p in doc.paragraphs]
        assert not any("Proposed to-be process" in t for t in texts)
        assert any("not embedded in this document" in t for t in texts)
        png = Path(tmp) / "map.png"
        png.write_bytes(_make_png())
        doc = _render(tmp, manifest, annotations, stats, analysis, events,
                      process_map_image=str(png), tobe_map_image=str(png))
        texts = [p.text for p in doc.paragraphs]
    assert len(doc.inline_shapes) == 2
    assert "5.4 Proposed to-be process" in texts
    assert any("NOT mined" in t for t in texts)          # provenance caption
    assert not any("not embedded in this document" in t for t in texts)


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


def test_the_overview_counts_runs_applications_and_step_states():
    if not _HAVE_DOCX:
        return
    overview = _section(_rendered(), "4.1 Overview")
    assert overview[:3] == [
        "This process was recorded on 2026-05-14 by w1: 2 runs, in 3 applications "
        "(Contoso CRM, Microsoft Outlook (classic), Microsoft Excel).",
        "Each run took between 50s and 1m of elapsed time (mean 55s); section 4.4 "
        "has the timings of every run.",
        "Steps: 7 in total (3 confirmed, 3 drafted and not yet confirmed); 1 hidden "
        "by the analyst and left out of this document.",
    ]


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
