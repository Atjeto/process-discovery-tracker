"""The Technical details workbook (contract C20): what the recording holds for
a developer, as a spreadsheet (normalize.py --tech-out <file.xlsx>).

The PDD says what the process is; this says what the recording measured of
the programs it runs in, for the developers who build from it (their
Solution Design Document is written outside the app). It reads what the PDD
reads, through pdd_export's session: the same steps, the same step numbers,
the same fields and the same re-keying rule. Written with the standard
library (xlsx_writer.py). Its sheets:

  About               the project, its version (handoff_versions), the
                      reference transaction, one line on each sheet and on
                      the recorder's words;
  Steps and controls  one row per recorded interaction of the reference
                      transaction, in step order: the PDD's step number and
                      name ("Step 3", and "Step 3.2" for a sub-step its
                      chapter prints), the action and its value, the control
                      (type, automation id, name, class name), how the
                      recorder identified it (identity source, confidence),
                      the window title, the program and the system, and the
                      library activity the step is with its code (contract
                      C21);
  Data fields         one row per field typed or chosen in a step (the
                      rows of the PDD's data table), with the field's
                      identity and one column per transaction holding what
                      was entered there; a password field reads "(not
                      recorded: secret field)", as recorded;
  Re-keyed values     the PDD's re-keyed data (pdd_export.rekey_pairs): a
                      value typed in one system and again in another in the
                      same transaction, as the source system and field, the
                      target system and field, the values and in how many
                      transactions;
  Applications        one row per program and system: the recorder's
                      coverage hint, whether it ran on a remote or terminal
                      surface (capture_detail's rule) and its steps.

A cell the recording has no value for stays empty. Pure apart from reading
the app vocabularies (through pdd_export's session); no python-docx.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from _dt import parse_ts_or_none as _parse_ts
from capture_detail import _WALL_FRAMEWORKS
from handoff_versions import version_line
from pdd_export import (DEFAULT_REQUEST_CODE, DEFAULT_REQUEST_NAME, _Session, _align_key, _members,
                        _step_name, rekey_pairs)
from step_context import step_system
from xlsx_writer import Sheet, write_workbook

ABOUT = "About"
STEPS = "Steps and controls"
DATA = "Data fields"
REKEYED = "Re-keyed values"
APPS = "Applications"

# A password field's value (the recorder never read it): the PDD's words.
SECRET = "(not recorded: secret field)"
NOT_RECORDED = "Not recorded"

STEPS_HEADER = ("Step", "Step name", "Action", "Value", "Control type", "Automation id", "Name",
                "Class name", "Identity source", "Confidence", "Window title", "Program", "System",
                "Activity", "Code")
_STEPS_WIDTHS = (9, 30, 9, 24, 14, 24, 26, 22, 15, 11, 40, 16, 16, 30, 12)
DATA_HEADER = ("Field", "Automation id", "Control type", "System and screen", "Step")
_DATA_WIDTHS = (24, 24, 14, 30, 30)
REKEYED_HEADER = ("Source system", "Source field", "Target system", "Target field", "Values",
                  "Transactions")
_REKEYED_WIDTHS = (18, 24, 18, 24, 30, 13)
APPS_HEADER = ("Program", "System", "Coverage", "Remote or terminal", "Steps")
_APPS_WIDTHS = (22, 22, 12, 19, 8)

# One line on each sheet, and on the recorder's words, for the About sheet.
SHEET_LINES = (
    (STEPS, "Every recorded click, entry and choice of the reference transaction, in the order "
            "of its steps, with the control it acted on, how the recorder identified it and the "
            "library activity its step is, with the activity's code."),
    (DATA, "Every field typed or chosen in a step, with what was entered in it in each "
           "transaction. A password field was not recorded."),
    (REKEYED, "The values typed in one system and typed again in another in the same "
              "transaction, as the PDD's data section lists them."),
    (APPS, "The programs the recording ran in, how much the recorder could see in each, and "
           "their steps."),
)
WORD_LINES = (
    ("Identity source", "How the recorder identified the control: automation_id (the most "
                        "stable), name, class_name, ocr or none."),
    ("Confidence", "From 0 to 1: how far that identity can be trusted. It is at most 0.3 on a "
                   "remote or terminal window."),
    ("Coverage", "What the program shows the recorder: rich (automation ids), basic (control "
                 "types without ids) or minimal (class names only)."),
)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _number(value: Any):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


# ---- Steps and controls --------------------------------------------------------

def _printed_steps(s) -> list[dict]:
    """The steps the PDD's 3.2 prints: the reference transaction's, else
    (no transaction with steps) every step in time order."""
    return s.run_steps(s.pattern_index) if s.pattern_index is not None else list(s.steps)


def _sub_labels(s) -> dict[str, str]:
    """{step_id: "Step 2.1"} of the sub-steps the PDD's chapters print (the
    reference transaction's first visit of each numbered sub-process)."""
    labels: dict[str, str] = {}
    for lv in s.levels[1:]:
        if lv.number is None:
            continue
        for i, st in enumerate(lv.first, start=1):
            sid = st.get("step_id") if isinstance(st, dict) else None
            if isinstance(sid, str) and sid:
                labels[sid] = f"Step {lv.number}.{i}"
    return labels


def _ids(step: dict) -> list[str]:
    ids = ((step or {}).get("evidence") or {}).get("interaction_event_ids") or []
    return [eid for eid in ids if isinstance(eid, str) and eid]


def _owners(step: dict, label: str, labels: dict[str, str]) -> tuple[dict, set]:
    """({event id: (label, step)}, hidden ids) of a printed step: each of its
    interactions with the deepest printed sub-step that holds it (else the
    step), and the interactions of its hidden sub-steps (left out: a hidden
    step never appears)."""
    owner: dict[str, tuple[str, dict]] = {}
    hidden: set[str] = set()

    def hide(st):
        hidden.update(_ids(st))
        for sub in st.get("sub_steps") or []:
            if isinstance(sub, dict):
                hide(sub)

    def walk(st, lab, holder):
        for eid in _ids(st):
            owner[eid] = (lab, holder)
        for sub in st.get("sub_steps") or []:
            if not isinstance(sub, dict):
                continue
            if sub.get("state") == "hidden":
                hide(sub)
                continue
            sid = sub.get("step_id")
            if isinstance(sid, str) and sid in labels:
                walk(sub, labels[sid], sub)
            else:
                walk(sub, lab, holder)

    walk(step, label, step)
    return owner, hidden


def _action(data: dict) -> tuple[str, str]:
    """(action, value) of one interaction, in plain words."""
    kind = data.get("kind")
    if kind == "invoked":
        return "Click", ""
    if kind in ("value_changed", "text_changed"):
        return "Type", SECRET if data.get("value_redacted") is True else _text(data.get("value"))
    if kind == "selection_changed":
        return "Select", _text(data.get("selected_value"))
    if kind == "toggle_changed":
        return "Toggle", _text(data.get("toggle_state"))
    if kind == "focus_changed":
        return "Focus", ""
    return (_text(kind).replace("_", " ").capitalize() or "Other"), ""


def _time(s, eid: str):
    t = _parse_ts(s.times.get(eid))
    return (t is None, t.timestamp() if t is not None else 0.0)


def steps_rows(s) -> list[list[Any]]:
    """The rows of Steps and controls (STEPS_HEADER). Activity and Code are
    the name and the code of the library activity the row's step is
    (contract C21, `library_activity`), empty when it is none."""
    labels = _sub_labels(s)
    rows: list[list[Any]] = []
    seen: set[str] = set()
    for number, step in enumerate(_printed_steps(s), start=1):
        owner, hidden = _owners(step, f"Step {number}", labels)
        ids = [eid for eid in owner if eid not in hidden and eid not in seen and eid in s.interactions]
        # In time order; ids of one moment keep the order the steps list them.
        for eid in sorted(ids, key=lambda e: _time(s, e)):
            seen.add(eid)
            label, holder = owner[eid]
            data = s.interactions[eid]
            action, value = _action(data)
            app, title = _text(data.get("process_name")), _text(data.get("window_title"))
            system = (step_system(holder) or step_system(step) or s.ctx.where_data(app, title)[0])
            activity = s.activity(holder)
            rows.append([label, _step_name(holder), action, value, _text(data.get("control_type")),
                         _text(data.get("automation_id")), _text(data.get("name")),
                         _text(data.get("class_name")), _text(data.get("identity_source")),
                         _number(data.get("confidence")), title, app, system,
                         activity.name if activity is not None else "",
                         activity.code if activity is not None else ""])
    return rows


# ---- Data fields -------------------------------------------------------------------

OUTSIDE = "Outside the transactions"


def data_rows(s) -> tuple[list[str], list[list[Any]]]:
    """(header, rows) of Data fields: DATA_HEADER, then one column per
    transaction (the PDD's names for them) and, when a step outside the
    transactions entered a field, one for those ("Value" alone when the
    transactions were not marked). A row per (field, step) as the PDD's
    data table keys it, in its order: the reference transaction's first."""
    rows: dict[tuple, dict] = {}

    def add(unit, column):
        for field, value, data, _ts, member in s.entries(unit):
            key = (field, _align_key(unit))
            row = rows.get(key)
            if row is None:
                system, screen = s.entry_where(member, data)
                row = rows[key] = {
                    "head": [field, _text(data.get("automation_id")), _text(data.get("control_type")),
                             ", ".join(x for x in (system, screen) if x), _step_name(unit)],
                    "cells": {}}
            values = row["cells"].setdefault(column, {})
            values.setdefault(value, None)

    order = ([s.pattern_index] if s.pattern_index is not None else []) + [
        i for i in range(len(s.runs)) if i != s.pattern_index]
    for i in order:
        for unit in s.units[i]:
            add(unit, i)
    outside = s.steps_by_run.get(None, []) if s.runs else s.steps
    for unit in outside:
        add(unit, OUTSIDE)
    columns: list = list(range(len(s.runs)))
    # The one implicit run of a project without a recording (C16) is no
    # marked transaction: its column is the value.
    names = ["Value"] * len(columns) if s.implicit else [s.run_label(i) for i in columns]
    if any(OUTSIDE in r["cells"] for r in rows.values()):
        columns.append(OUTSIDE)
        names.append(OUTSIDE if s.runs else "Value")
    out = [r["head"] + ["; ".join(r["cells"].get(c, {})) for c in columns] for r in rows.values()]
    return list(DATA_HEADER) + names, out


# ---- Re-keyed values ---------------------------------------------------------------

def rekeyed_rows(s) -> list[list[Any]]:
    """The rows of Re-keyed values (REKEYED_HEADER), the PDD's re-keyed
    pairs in its order."""
    runs = len(s.runs) or 1
    return [[src[1], src[0], dst[1], dst[0], "; ".join(values), f"{n} of {runs}"]
            for src, dst, n, values in rekey_pairs(s)]


# ---- Applications ------------------------------------------------------------------

def apps_rows(s) -> list[list[Any]]:
    """The rows of Applications (APPS_HEADER): one per program and system
    the recorded interactions ran in, in the order the recording first met
    them. Coverage is the recorder's hint on the program's first interaction
    that carries one; Remote or terminal says whether an interaction came
    through a remote or terminal surface (capture_detail's rule); Steps
    counts the process's distinct steps (the PDD's rule for one step across
    the transactions) with an interaction there."""
    progs: dict[str, dict] = {}
    for data in s.interactions.values():
        app = _text(data.get("process_name"))
        if not app:
            continue
        rec = progs.setdefault(app, {"hint": "", "frameworks": set(), "systems": {}})
        hint = _text(data.get("coverage_hint")).lower()
        if hint and not rec["hint"]:
            rec["hint"] = hint
        fw = _text(data.get("framework")).lower()
        if fw:
            rec["frameworks"].add(fw)
        system = s.ctx.where_data(app, data.get("window_title"))[0] or app
        rec["systems"].setdefault(system, set())
    outside = s.steps_by_run.get(None, []) if s.runs else s.steps
    for unit in s.run_units() + outside:
        key = _align_key(unit)
        for member in _members(unit):
            for eid in _ids(member):
                data = s.interactions.get(eid)
                app = _text(data.get("process_name")) if isinstance(data, dict) else ""
                if app in progs:
                    system = s.ctx.where_data(app, data.get("window_title"))[0] or app
                    progs[app]["systems"].setdefault(system, set()).add(key)
    rows = []
    for app, rec in progs.items():
        remote = ("Yes" if rec["frameworks"] & _WALL_FRAMEWORKS
                  else "No" if rec["frameworks"] else NOT_RECORDED)
        for system, keys in rec["systems"].items():
            rows.append([app, system, rec["hint"] or NOT_RECORDED, remote, len(keys)])
    return rows


# ---- The workbook ------------------------------------------------------------------

def project_name(s) -> str:
    """The name the viewer shows for the project (viewer/session-summary.js
    displayName): the document's title, else the name given to the
    recording, else the request's name or code (never the capture app's
    defaults), else the folder's name."""
    manifest = s.manifest
    config = manifest.get("config") if isinstance(manifest.get("config"), dict) else {}
    request_name = _text(manifest.get("engagement_name")) or _text(config.get("engagement_name"))
    request_code = _text(manifest.get("engagement_id"))
    return (s.field("title") or _text(manifest.get("label"))
            or (request_name if request_name != DEFAULT_REQUEST_NAME else "")
            or (request_code if request_code != DEFAULT_REQUEST_CODE else "")
            or s.folder.resolve().name)


def _reference_line(s) -> str:
    if s.pattern_index is not None and not s.implicit:
        return (f"The reference transaction is {s.run_label(s.pattern_index)}: Steps and "
                "controls lists its steps, numbered as the PDD numbers them.")
    if s.pattern_index is not None:
        return "Transactions were not marked in this project, so every step is listed in order."
    return "No transaction has steps, so Steps and controls lists every step in time order."


def about_rows(s, handoff: int | None) -> list[list[Any]]:
    """The About sheet: the project, the version, the reference transaction,
    then one line on each sheet and on the recorder's words."""
    rows: list[list[Any]] = [
        ["Technical details: " + project_name(s)],
        [version_line(s.annotations, handoff)],
        [_reference_line(s)],
        [],
        ["Sheet", "What it lists"],
    ]
    rows += [[name, line] for name, line in SHEET_LINES]
    rows += [[], ["Word", "What it means"]]
    rows += [[word, line] for word, line in WORD_LINES]
    return rows


def tech_sheets(*, session_folder, annotations, stats, manifest, events,
                handoff: int | None = None, library=None) -> list[Sheet]:
    """The workbook's sheets, for the inputs the PDD reads (the derived event
    stream, the steps, stats.json and the manifest) and the activity library
    the steps name (contract C21; None: the project's library.json)."""
    s = _Session(session_folder, annotations, stats, manifest, events, library=library)
    about = about_rows(s, handoff)
    head_rows = {0, 4, 5 + len(SHEET_LINES) + 1}
    data_header, data = data_rows(s)
    return [
        Sheet(ABOUT, about, bold_rows=head_rows, widths=[22, 110]),
        Sheet(STEPS, [list(STEPS_HEADER)] + steps_rows(s), bold_rows={0}, freeze=1,
              widths=list(_STEPS_WIDTHS)),
        Sheet(DATA, [data_header] + data, bold_rows={0}, freeze=1,
              widths=list(_DATA_WIDTHS) + [22] * (len(data_header) - len(DATA_HEADER))),
        Sheet(REKEYED, [list(REKEYED_HEADER)] + rekeyed_rows(s), bold_rows={0}, freeze=1,
              widths=list(_REKEYED_WIDTHS)),
        Sheet(APPS, [list(APPS_HEADER)] + apps_rows(s), bold_rows={0}, freeze=1,
              widths=list(_APPS_WIDTHS)),
    ]


def write_tech_details(out_path: str | Path, *, session_folder, annotations, stats, manifest,
                       events, handoff: int | None = None, library=None) -> None:
    """Write the Technical details workbook to `out_path` (normalize.py
    --tech-out; `handoff` is --handoff, the version it is made for;
    `library` the activity library of the run, contract C21)."""
    write_workbook(out_path, tech_sheets(session_folder=session_folder, annotations=annotations,
                                         stats=stats, manifest=manifest, events=events,
                                         handoff=handoff, library=library))
